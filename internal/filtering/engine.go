package filtering

import (
	"bufio"
	"crypto/md5"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"

	"github.com/AdguardTeam/urlfilter"
	"github.com/AdguardTeam/urlfilter/filterlist"
	"github.com/AdguardTeam/urlfilter/rules"
	bloom "github.com/bits-and-blooms/bloom/v3"
	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/ugzv/ublockdnsclient/internal/db"
)

type Engine struct {
	customEngine *urlfilter.DNSEngine
	bloomFilter  *bloom.BloomFilter
	lruCache     *lru.Cache[string, bool]
}

// RouteActiveLists copies active lists from the master directory to the active directory,
// and copies disabled lists from master to disabled. It returns the paths to the active lists.
func RouteActiveLists(dataDir string, activeURLs []string, allURLs []string) ([]string, error) {
	masterDir := filepath.Join(dataDir, "master")
	activeDir := filepath.Join(dataDir, "active")
	disabledDir := filepath.Join(dataDir, "disabled")

	os.MkdirAll(activeDir, 0755)
	os.MkdirAll(disabledDir, 0755)

	cleanDir(activeDir)
	cleanDir(disabledDir)

	activeMap := make(map[string]bool)
	for _, u := range activeURLs {
		activeMap[u] = true
	}

	var activePaths []string

	for _, u := range allURLs {
		hash := fmt.Sprintf("%x", md5.Sum([]byte(u)))
		masterPath := filepath.Join(masterDir, fmt.Sprintf("list_%s.txt", hash))

		if _, err := os.Stat(masterPath); os.IsNotExist(err) {
			continue
		}

		if activeMap[u] {
			activePath := filepath.Join(activeDir, fmt.Sprintf("list_%s.txt", hash))
			copyFile(masterPath, activePath)
			activePaths = append(activePaths, activePath)
		} else {
			disabledPath := filepath.Join(disabledDir, fmt.Sprintf("list_%s.txt", hash))
			copyFile(masterPath, disabledPath)
		}
	}

	return activePaths, nil
}

func cleanDir(dir string) {
	d, err := os.Open(dir)
	if err != nil {
		return
	}
	defer d.Close()
	names, err := d.Readdirnames(-1)
	if err != nil {
		return
	}
	for _, name := range names {
		os.RemoveAll(filepath.Join(dir, name))
	}
}

func copyFile(src, dst string) error {
	err := os.Link(src, dst)
	if err == nil {
		return nil
	}
	source, err := os.Open(src)
	if err != nil {
		return err
	}
	defer source.Close()
	destination, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destination.Close()
	_, err = io.Copy(destination, source)
	return err
}

func extractDomain(line string) string {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "!") {
		return ""
	}
	// Hosts file format: "0.0.0.0 example.com"
	if strings.HasPrefix(line, "0.0.0.0 ") || strings.HasPrefix(line, "127.0.0.1 ") {
		parts := strings.Fields(line)
		if len(parts) >= 2 {
			return parts[1]
		}
	}
	// Adblock format: "||example.com^"
	if strings.HasPrefix(line, "||") {
		line = strings.TrimPrefix(line, "||")
		line = strings.TrimSuffix(line, "^")
		return line
	}
	// Plain domain
	return line
}

func NewEngine(listPaths []string, customRules []string, dataDir string) (*Engine, error) {
	var customEngine *urlfilter.DNSEngine

	if len(customRules) > 0 {
		text := strings.Join(customRules, "\n")
		fl := filterlist.NewString(&filterlist.StringConfig{
			ID:             rules.ListID(9999),
			RulesText:      text,
			IgnoreCosmetic: true,
		})
		storage, _ := filterlist.NewRuleStorage([]filterlist.Interface{fl})
		customEngine = urlfilter.NewDNSEngine(storage)
	}

	cache, _ := lru.New[string, bool](100000)
	bf := bloom.NewWithEstimates(5000000, 0.01)
	bloomPath := filepath.Join(dataDir, "bloom.bin")

	// Check if we can use the cached SQLite database and binary bloom filter
	db.DB.Exec("CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT)")
	
	pathsHash := fmt.Sprintf("%x", md5.Sum([]byte(strings.Join(listPaths, ","))))
	var lastHash string
	db.DB.QueryRow("SELECT value FROM app_state WHERE key = 'last_parsed_hash'").Scan(&lastHash)

	if pathsHash == lastHash {
		f, err := os.Open(bloomPath)
		if err == nil {
			_, err = bf.ReadFrom(f)
			f.Close()
			if err == nil {
				log.Printf("Successfully loaded Bloom Filter from binary cache.")
				return &Engine{
					customEngine: customEngine,
					bloomFilter:  bf,
					lruCache:     cache,
				}, nil
			}
		}
		log.Printf("Failed to load from binary cache, rebuilding from scratch...")
	}

	log.Printf("Parsing %d blocklists and building Bloom Filter / SQLite DB...", len(listPaths))

	tx, err := db.DB.Begin()
	if err != nil {
		return nil, fmt.Errorf("failed to begin tx: %v", err)
	}

	_, err = tx.Exec("DELETE FROM blocklist_domains")
	if err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("failed to clear blocklist_domains: %v", err)
	}

	stmt, err := tx.Prepare("INSERT OR IGNORE INTO blocklist_domains (domain) VALUES (?)")
	if err != nil {
		tx.Rollback()
		return nil, err
	}
	// Do not defer stmt.Close() since we will close it manually in the loop

	domainCount := 0
	batchSize := 50000

	for _, path := range listPaths {
		file, err := os.Open(path)
		if err != nil {
			log.Printf("Failed to open list %s: %v", path, err)
			continue
		}
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			d := extractDomain(scanner.Text())
			if d != "" {
				bf.AddString(d)
				stmt.Exec(d)
				domainCount++

				// Batch commit to prevent SQLite transaction memory from ballooning
				if domainCount%batchSize == 0 {
					log.Printf("Parsed %d domains so far...", domainCount)
					stmt.Close()
					tx.Commit()

					tx, err = db.DB.Begin()
					if err != nil {
						log.Printf("Failed to begin batch tx: %v", err)
						continue
					}
					stmt, err = tx.Prepare("INSERT OR IGNORE INTO blocklist_domains (domain) VALUES (?)")
					if err != nil {
						log.Printf("Failed to prepare batch stmt: %v", err)
						continue
					}
				}
			}
		}
		if err := scanner.Err(); err != nil {
			log.Printf("Error reading file %s: %v", path, err)
		}
		file.Close()
	}

	stmt.Close()
	err = tx.Commit()
	if err != nil {
		log.Printf("failed to commit final tx: %v", err)
	}

	db.DB.Exec("INSERT INTO app_state (key, value) VALUES ('last_parsed_hash', ?) ON CONFLICT(key) DO UPDATE SET value = ?", pathsHash, pathsHash)

	// Save Bloom filter to binary cache
	f, err := os.Create(bloomPath)
	if err == nil {
		bf.WriteTo(f)
		f.Close()
	} else {
		log.Printf("Failed to save bloom filter: %v", err)
	}

	log.Printf("Successfully indexed %d domains into Bloom Filter and SQLite.", domainCount)

	// Force Go to immediately release parsed memory back to the OS
	debug.FreeOSMemory()

	return &Engine{
		customEngine: customEngine,
		bloomFilter:  bf,
		lruCache:     cache,
	}, nil
}

// Check returns true if the domain is blocked, along with the rule text and list ID.
func (e *Engine) Check(domain string, qtype uint16) (bool, string, int) {
	domain = strings.TrimSuffix(domain, ".")
	domain = strings.ToLower(domain)

	// 1. Check Custom Rules (InMemory)
	if e.customEngine != nil {
		res, matched := e.customEngine.Match(domain)
		if matched && res.NetworkRule != nil {
			return true, res.NetworkRule.Text(), 9999
		}
	}

	// 2. Check LRU Cache
	if cachedBlocked, ok := e.lruCache.Get(domain); ok {
		if cachedBlocked {
			return true, "LRU Cache / Blocklist", 0
		}
		return false, "", 0
	}

	// 3. Prepare domains to check (exact + parents)
	domainsToCheck := []string{domain}
	parts := strings.Split(domain, ".")
	for i := 1; i < len(parts)-1; i++ {
		domainsToCheck = append(domainsToCheck, strings.Join(parts[i:], "."))
	}

	// 4. Check Bloom Filter -> SQLite
	isBlocked := false
	matchedDomain := ""
	for _, d := range domainsToCheck {
		if e.bloomFilter.TestString(d) {
			// Bloom says it might be blocked. Verify with SQLite.
			var exists int
			err := db.DB.QueryRow("SELECT 1 FROM blocklist_domains WHERE domain = ?", d).Scan(&exists)
			if err == nil {
				isBlocked = true
				matchedDomain = d
				break
			}
		}
	}

	// 5. Update LRU and Return
	if isBlocked {
		e.lruCache.Add(domain, true)
		return true, "Blocklist: " + matchedDomain, 0
	}

	e.lruCache.Add(domain, false)
	return false, "", 0
}
