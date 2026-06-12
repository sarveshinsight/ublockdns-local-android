package api

import (
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"path/filepath"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/ugzv/ublockdnsclient/internal/config"
	"github.com/ugzv/ublockdnsclient/internal/resolver"
	"github.com/ugzv/ublockdnsclient/internal/updater"
)

//go:embed *
var WebFS embed.FS


type Server struct {
	addr        string
	config      *config.Config
	dnsResolver *resolver.Server
	configPath  string
	updater     *updater.Updater
}

func NewServer(addr string, cfg *config.Config, dnsResolver *resolver.Server, configPath string, updater *updater.Updater) *Server {
	return &Server{
		addr:        addr,
		config:      cfg,
		dnsResolver: dnsResolver,
		configPath:  configPath,
		updater:     updater,
	}
}

func (s *Server) Start() error {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"https://*", "http://*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Route("/api", func(r chi.Router) {
		r.Get("/config", s.handleGetConfig)
		r.Post("/config", s.handleUpdateConfig)
		r.Get("/logs", s.handleGetLogs)
		r.Get("/stats", s.handleGetStats)
		r.Get("/domain/{domain}", s.handleGetDomain)
		r.Get("/catalog", s.handleGetCatalog)
		r.Get("/updater/status", s.handleGetUpdaterStatus)
		r.Post("/updater/force", s.handleForceUpdate)
	})

	// Serve the static frontend using embedded filesystem
	var staticFS http.FileSystem

	// Check if embedded filesystem is populated (for Android)
	dir, err := WebFS.ReadDir("web_dist")
	if err == nil && len(dir) > 0 {
		subFS, _ := fs.Sub(WebFS, "web_dist")
		staticFS = http.FS(subFS)
	} else {
		// Fallback for Desktop
		staticFS = http.Dir("./web/dist")
	}

	r.Handle("/*", http.FileServer(staticFS))

	log.Printf("Starting API server on %s", s.addr)
	return http.ListenAndServe(s.addr, r)
}

func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.config)
}

func (s *Server) handleUpdateConfig(w http.ResponseWriter, r *http.Request) {
	var newCfg config.Config
	if err := json.NewDecoder(r.Body).Decode(&newCfg); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Update the struct
	s.config.Blocklists = newCfg.Blocklists
	s.config.CustomRules = newCfg.CustomRules
	s.config.UpstreamDNS = newCfg.UpstreamDNS

	// Save to disk
	if err := config.SaveConfig(s.configPath, s.config); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Apply upstream change instantly so user doesn't have to wait for blocklists
	s.dnsResolver.SetUpstream(s.config.UpstreamDNS)

	// Trigger updater to download any new lists
	select {
	case s.updater.ForceSync <- true:
	default:
	}

	// Reload the DNS filtering engine asynchronously to prevent API timeout
	cfgCopy := *s.config
	go func() {
		dataDir := filepath.Dir(s.configPath)
		if err := s.dnsResolver.ReloadConfig(&cfgCopy, dataDir); err != nil {
			log.Printf("Error reloading config asynchronously: %v", err)
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.config)
}

func (s *Server) handleGetLogs(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 {
		limit = l
	}

	w.Header().Set("Content-Type", "application/json")
	logs := s.dnsResolver.GetRecentQueries(limit)
	json.NewEncoder(w).Encode(logs)
}

func (s *Server) handleGetStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	stats := s.dnsResolver.GetStats()
	json.NewEncoder(w).Encode(stats)
}

func (s *Server) handleGetDomain(w http.ResponseWriter, r *http.Request) {
	domain := chi.URLParam(r, "domain")
	if domain == "" {
		http.Error(w, "missing domain", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	stats := s.dnsResolver.GetDomainStats(domain)
	json.NewEncoder(w).Encode(stats)
}

func (s *Server) handleGetCatalog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config.Catalog)
}

func (s *Server) handleGetUpdaterStatus(w http.ResponseWriter, r *http.Request) {
	last, next := s.updater.GetStatus()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int64{
		"lastUpdate": last,
		"nextUpdate": next,
	})
}

func (s *Server) handleForceUpdate(w http.ResponseWriter, r *http.Request) {
	// Non-blocking send
	select {
	case s.updater.ForceSync <- true:
	default:
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "Update triggered"})
}
