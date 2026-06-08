package main

import (
	"log"
	"os"
	"time"

	"github.com/ugzv/ublockdnsclient/internal/api"
	"github.com/ugzv/ublockdnsclient/internal/config"
	"github.com/ugzv/ublockdnsclient/internal/resolver"
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

	// 24-Hour automatic blocklist updater
	go func() {
		importTime := time.NewTicker(24 * time.Hour)
		defer importTime.Stop()
		for range importTime.C {
			log.Println("Running automatic 24-hour blocklist update...")
			// Reloading config will re-download the remote blocklists
			if err := server.ReloadConfig(cfg); err != nil {
				log.Printf("Failed to automatically update blocklists: %v", err)
			} else {
				log.Println("Successfully updated all blocklists!")
			}
		}
	}()

	// Start API server
	apiServer := api.NewServer("0.0.0.0:8080", cfg, server, configPath)
	if err := apiServer.Start(); err != nil {
		log.Fatalf("API server failed: %v", err)
	}
}
