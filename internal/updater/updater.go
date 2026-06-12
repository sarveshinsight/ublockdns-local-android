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
	"strconv"
	"time"

	"github.com/ugzv/ublockdnsclient/internal/config"
	"github.com/ugzv/ublockdnsclient/internal/db"
)

type Updater struct {
	dataDir        string
	onSyncComplete func()
	ForceSync      chan bool
}

func NewUpdater(dataDir string, onSyncComplete func()) *Updater {
	return &Updater{dataDir: dataDir, onSyncComplete: onSyncComplete, ForceSync: make(chan bool, 1)}
}

func (u *Updater) Start(ctx context.Context) {
	db.DB.Exec("CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT)")

	var lastUpdateStr string
	err := db.DB.QueryRow("SELECT value FROM app_state WHERE key = 'last_update'").Scan(&lastUpdateStr)
	var lastUpdate time.Time
	if err == nil {
		ts, _ := strconv.ParseInt(lastUpdateStr, 10, 64)
		lastUpdate = time.Unix(ts, 0)
	}

	now := time.Now()
	y, m, d := now.Date()
	todayMidnight := time.Date(y, m, d, 0, 0, 0, 0, now.Location())

	// Catch-up logic: If we never updated today (after 12:00 AM), do it now.
	if lastUpdate.Before(todayMidnight) {
		log.Println("Catch-up sync required. Starting SyncMaster...")
		go u.SyncMaster()
	}

	// The infinite time.Timer loop has been removed for Android power efficiency.
	// Android's native WorkManager will directly call SyncMaster() on a daily basis.

	// Handle ForceSync channel to keep API compatibility without the infinite loop
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-u.ForceSync:
				u.SyncMaster()
			}
		}
	}()
}

func (u *Updater) GetStatus() (lastUpdate int64, nextUpdate int64) {
	var lastUpdateStr string
	db.DB.QueryRow("SELECT value FROM app_state WHERE key = 'last_update'").Scan(&lastUpdateStr)
	ts, _ := strconv.ParseInt(lastUpdateStr, 10, 64)

	now := time.Now()
	nextMidnight := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, now.Location())
	return ts, nextMidnight.Unix()
}

func (u *Updater) SyncMaster() {
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

	// Record successful sync timestamp in SQLite
	nowUnix := fmt.Sprintf("%d", time.Now().Unix())
	db.DB.Exec("INSERT INTO app_state (key, value) VALUES ('last_update', ?) ON CONFLICT(key) DO UPDATE SET value = ?", nowUnix, nowUnix)

	log.Printf("Updater: master list repository sync complete.")

	if u.onSyncComplete != nil {
		u.onSyncComplete()
	}
}
