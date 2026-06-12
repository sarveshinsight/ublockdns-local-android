package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/ugzv/ublockdnsclient/internal/api"
	"github.com/ugzv/ublockdnsclient/internal/config"
	"github.com/ugzv/ublockdnsclient/internal/db"
	"github.com/ugzv/ublockdnsclient/internal/resolver"
	"github.com/ugzv/ublockdnsclient/internal/updater"
)

func main() {
	log.Println("Starting local UblockDNS server...")

	// Load configuration
	configPath := "config.yaml"
	if len(os.Args) > 1 {
		configPath = os.Args[1]
	}

	cfg, err := config.Load(configPath)
	if err != nil {
		log.Fatalf("Failed to load config from %s: %v", configPath, err)
	}

	log.Printf("Loaded config: %v blocklists, %v custom rules", len(cfg.Blocklists), len(cfg.CustomRules))

	dataDir := "./data"
	os.MkdirAll(dataDir, 0755)

	// Initialize SQLite Database
	if err := db.InitDB(dataDir); err != nil {
		log.Fatalf("Failed to initialize SQLite database: %v", err)
	}

	// Initialize DNS server with nil engine
	server := resolver.NewServer(cfg.ListenAddr, cfg.UpstreamDNS, nil)

	// Load blocklists asynchronously so UI starts immediately
	go func() {
		if err := server.ReloadConfig(cfg, dataDir); err != nil {
			log.Printf("Failed to initialize filtering engine: %v", err)
		} else {
			log.Println("Filtering engine initialized")
		}
	}()

	// Start DNS server in background
	go func() {
		if err := server.ListenAndServe(); err != nil {
			log.Fatalf("DNS server failed: %v", err)
		}
	}()

	// Start the Master Updater service
	updaterSvc := updater.NewUpdater(dataDir, func() {
		if err := server.ReloadConfig(cfg, dataDir); err != nil {
			log.Printf("Failed to reload config after master sync: %v", err)
		} else {
			log.Println("Successfully reloaded config after master sync")
		}
	})
	go updaterSvc.Start(context.Background())

	// Start API server in background
	apiServer := api.NewServer("0.0.0.0:8080", cfg, server, configPath, updaterSvc)
	go func() {
		if err := apiServer.Start(); err != nil {
			log.Fatalf("API server failed: %v", err)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	server.Save()
	log.Println("Logs and history saved. Goodbye!")
}
