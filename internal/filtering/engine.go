package filtering

import (
	"crypto/md5"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/AdguardTeam/urlfilter"
	"github.com/AdguardTeam/urlfilter/filterlist"
	"github.com/AdguardTeam/urlfilter/rules"
)

type Engine struct {
	dnsEngine *urlfilter.DNSEngine
}

// RouteActiveLists copies active lists from the master directory to the active directory,
// and copies disabled lists from master to disabled. It returns the paths to the active lists.
func RouteActiveLists(dataDir string, activeURLs []string, allURLs []string) ([]string, error) {
	masterDir := filepath.Join(dataDir, "master")
	activeDir := filepath.Join(dataDir, "active")
	disabledDir := filepath.Join(dataDir, "disabled")

	// Ensure directories exist
	os.MkdirAll(activeDir, 0755)
	os.MkdirAll(disabledDir, 0755)

	// Clean active and disabled directories before routing
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
		
		// If the master list doesn't exist yet (e.g. background updater hasn't downloaded it), skip
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
	// Fast copy using Hardlink if possible, fallback to standard copy
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

func NewEngine(listPaths []string, customRules []string) (*Engine, error) {
	var lists []filterlist.Interface

	// Load file-based blocklists
	for i, path := range listPaths {
		fl, err := filterlist.NewFile(&filterlist.FileConfig{
			ID:   rules.ListID(i + 1),
			Path: path,
		})
		if err != nil {
			log.Printf("Failed to load list %s: %v", path, err)
			continue
		}
		lists = append(lists, fl)
	}

	// Add custom rules
	if len(customRules) > 0 {
		customID := rules.ListID(len(listPaths) + 1)
		text := strings.Join(customRules, "\n")
		fl := filterlist.NewString(&filterlist.StringConfig{
			ID:             customID,
			RulesText:      text,
			IgnoreCosmetic: true,
		})
		lists = append(lists, fl)
	}

	storage, err := filterlist.NewRuleStorage(lists)
	if err != nil {
		return nil, fmt.Errorf("failed to create rule storage: %w", err)
	}

	dnsEngine := urlfilter.NewDNSEngine(storage)
	return &Engine{dnsEngine: dnsEngine}, nil
}

// Check returns true if the domain is blocked, along with the rule text and list ID.
func (e *Engine) Check(domain string, qtype uint16) (bool, string, int) {
	// urlfilter requires domain ending without dot
	domain = strings.TrimSuffix(domain, ".")
	
	res, matched := e.dnsEngine.Match(domain)
	if !matched {
		return false, "", 0
	}
	
	if res.NetworkRule != nil {
		if res.NetworkRule.Whitelist {
			return false, "", 0
		}
		return true, res.NetworkRule.Text(), int(res.NetworkRule.GetFilterListID())
	}
	
	// Also check if any host rules matched (e.g. from /etc/hosts style lists)
	if len(res.HostRulesV4) > 0 {
		return true, res.HostRulesV4[0].Text(), int(res.HostRulesV4[0].GetFilterListID())
	}
	if len(res.HostRulesV6) > 0 {
		return true, res.HostRulesV6[0].Text(), int(res.HostRulesV6[0].GetFilterListID())
	}
	
	return false, "", 0
}
