package db

import (
	"database/sql"
	"fmt"
	"log"
	"path/filepath"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

func InitDB(dataDir string) error {
	dbPath := filepath.Join(dataDir, "ublockdns.db")
	
	// Open the database
	var err error
	DB, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	// Optimize SQLite settings for performance
	_, err = DB.Exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA synchronous = NORMAL;
		PRAGMA busy_timeout = 5000;
		PRAGMA cache_size = -20000; -- 20MB cache
		PRAGMA foreign_keys = ON;
	`)
	if err != nil {
		log.Printf("DB PRAGMA error: %v", err)
	}

	// Initialize schema
	schema := `
	CREATE TABLE IF NOT EXISTS query_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		domain TEXT,
		type TEXT,
		action TEXT,
		speed TEXT,
		rule TEXT,
		list_id INTEGER,
		time DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	
	CREATE TABLE IF NOT EXISTS domain_history (
		domain TEXT PRIMARY KEY,
		count INTEGER DEFAULT 0,
		blocked_count INTEGER DEFAULT 0
	);
	
	CREATE TABLE IF NOT EXISTS time_history (
		bucket INTEGER PRIMARY KEY,
		queries INTEGER DEFAULT 0,
		blocked INTEGER DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS domain_time_history (
		domain TEXT,
		bucket INTEGER,
		queries INTEGER DEFAULT 0,
		blocked INTEGER DEFAULT 0,
		PRIMARY KEY(domain, bucket)
	);
	
	CREATE TABLE IF NOT EXISTS blocklist_domains (
		domain TEXT PRIMARY KEY
	);
	`
	
	_, err = DB.Exec(schema)
	if err != nil {
		return fmt.Errorf("failed to initialize schema: %w", err)
	}

	log.Println("SQLite database initialized successfully.")
	return nil
}
