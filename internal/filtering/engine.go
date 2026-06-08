package filtering

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
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

// DownloadLists downloads the given URLs to a local data directory.
func DownloadLists(ctx context.Context, dataDir string, urls []string) ([]string, error) {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, err
	}

	var paths []string
	for i, u := range urls {
		log.Printf("Downloading blocklist %d: %s", i+1, u)
		req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
		if err != nil {
			log.Printf("Failed to create request for %s: %v", u, err)
			continue
		}

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			log.Printf("Failed to download %s: %v", u, err)
			continue
		}

		filename := filepath.Join(dataDir, fmt.Sprintf("list_%d.txt", i))
		f, err := os.Create(filename)
		if err != nil {
			resp.Body.Close()
			return nil, err
		}

		_, err = io.Copy(f, resp.Body)
		f.Close()
		resp.Body.Close()
		if err != nil {
			log.Printf("Failed to save %s: %v", u, err)
			continue
		}
		paths = append(paths, filename)
	}
	return paths, nil
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

// Check returns true if the domain is blocked.
func (e *Engine) Check(domain string, qtype uint16) bool {
	// urlfilter requires domain ending without dot
	domain = strings.TrimSuffix(domain, ".")
	
	res, matched := e.dnsEngine.Match(domain)
	if !matched {
		return false
	}
	
	if res.NetworkRule != nil {
		if res.NetworkRule.Whitelist {
			return false
		}
		return true
	}
	
	// Also check if any host rules matched (e.g. from /etc/hosts style lists)
	if len(res.HostRulesV4) > 0 || len(res.HostRulesV6) > 0 {
		return true
	}
	
	return false
}
