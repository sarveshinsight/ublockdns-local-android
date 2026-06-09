package updater

import (
	"context"
	"crypto/md5"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/ugzv/ublockdnsclient/internal/config"
)

type Updater struct {
	dataDir        string
	onSyncComplete func()
}

func NewUpdater(dataDir string, onSyncComplete func()) *Updater {
	return &Updater{dataDir: dataDir, onSyncComplete: onSyncComplete}
}

func (u *Updater) Start(ctx context.Context) {
	u.syncMaster()

	ticker := time.NewTicker(24 * time.Hour)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			u.syncMaster()
		}
	}
}

func (u *Updater) syncMaster() {
	masterDir := filepath.Join(u.dataDir, "master")
	if err := os.MkdirAll(masterDir, 0755); err != nil {
		log.Printf("Updater: failed to create master dir: %v", err)
		return
	}

	log.Printf("Updater: syncing master list repository...")
	client := &http.Client{Timeout: 30 * time.Second}

	for i, list := range config.Catalog {
		hash := fmt.Sprintf("%x", md5.Sum([]byte(list.URL)))
		filename := filepath.Join(masterDir, fmt.Sprintf("list_%s.txt", hash))

		info, err := os.Stat(filename)
		if err == nil && info.Size() > 0 && time.Since(info.ModTime()) < 24*time.Hour {
			continue // Valid cache
		}

		log.Printf("Updater: downloading blocklist %d: %s", i+1, list.URL)
		req, err := http.NewRequestWithContext(context.Background(), "GET", list.URL, nil)
		if err != nil {
			log.Printf("Updater: failed to create request for %s: %v", list.URL, err)
			continue
		}
		
		// Bypass blocklists blocking Go user agents
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

		resp, err := client.Do(req)
		if err != nil {
			log.Printf("Updater: failed to download %s: %v", list.URL, err)
			continue
		}
		
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			log.Printf("Updater: failed to download %s: status %d", list.URL, resp.StatusCode)
			resp.Body.Close()
			continue
		}

		f, err := os.Create(filename)
		if err != nil {
			log.Printf("Updater: failed to create file %s: %v", filename, err)
			resp.Body.Close()
			continue
		}

		_, err = io.Copy(f, resp.Body)
		f.Close()
		resp.Body.Close()
		if err != nil {
			log.Printf("Updater: failed to save %s: %v", list.URL, err)
			continue
		}
	}
	log.Printf("Updater: master list repository sync complete.")
	
	if u.onSyncComplete != nil {
		u.onSyncComplete()
	}
}
