package main

import (
	"context"
	"log"
	"os"

	"github.com/ugzv/ublockdnsclient/internal/api"
	"github.com/ugzv/ublockdnsclient/internal/config"
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

	// Initialize DNS server with nil engine
	server := resolver.NewServer(cfg.ListenAddr, cfg.UpstreamDNS, nil)

	// Load blocklists asynchronously so UI starts immediately
	go func() {
		if err := server.ReloadConfig(cfg); err != nil {
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
	dataDir := "./data"
	updaterSvc := updater.NewUpdater(dataDir, func() {
		if err := server.ReloadConfig(cfg); err != nil {
			log.Printf("Failed to reload config after master sync: %v", err)
		} else {
			log.Println("Successfully reloaded config after master sync")
		}
	})
	go updaterSvc.Start(context.Background())

	// Start API server
	apiServer := api.NewServer("0.0.0.0:8080", cfg, server, configPath)
	if err := apiServer.Start(); err != nil {
		log.Fatalf("API server failed: %v", err)
	}
}
