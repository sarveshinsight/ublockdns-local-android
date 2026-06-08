package resolver

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/miekg/dns"
	"github.com/ugzv/ublockdnsclient/internal/config"
	"github.com/ugzv/ublockdnsclient/internal/filtering"
)

type Server struct {
	addr     string
	upstream string
	engine   *filtering.Engine
	client   *dns.Client
	mu       sync.RWMutex

	// Stats and Logs
	totalQueries uint64
	blocked      uint64
	recentLogs   []LogEntry
}

type LogEntry struct {
	Domain string `json:"domain"`
	Type   string `json:"type"`
	Action string `json:"action"`
	Speed  string `json:"speed"`
	Seen   string `json:"seen"`
}

func NewServer(addr string, upstream string, engine *filtering.Engine) *Server {
	return &Server{
		addr:     addr,
		upstream: upstream,
		engine:   engine,
		client: &dns.Client{
			Net:     "udp4", // Force IPv4
			Timeout: 5 * time.Second,
		},
	}
}

func (s *Server) ListenAndServe() error {
	mux := dns.NewServeMux()
	mux.HandleFunc(".", s.handleRequest)
	
	server := &dns.Server{
		Addr:    s.addr,
		Net:     "udp4", // Force IPv4 to fix Alpine mapping issue
		Handler: mux,
	}
	log.Printf("Starting DNS server on %s, forwarding to %s", s.addr, s.upstream)
	return server.ListenAndServe()
}

func (s *Server) ReloadConfig(cfg *config.Config) error {
	ctx := context.Background()
	dataDir := "./data"
	paths, err := filtering.DownloadLists(ctx, dataDir, cfg.Blocklists)
	if err != nil {
		return err
	}

	newEngine, err := filtering.NewEngine(paths, cfg.CustomRules)
	if err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.upstream = cfg.UpstreamDNS
	s.engine = newEngine
	return nil
}

func (s *Server) GetRecentQueries() []LogEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]LogEntry(nil), s.recentLogs...) // return copy
}

func (s *Server) GetStats() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	blockRate := 0.0
	if s.totalQueries > 0 {
		blockRate = float64(s.blocked) / float64(s.totalQueries) * 100
	}
	
	return map[string]interface{}{
		"total_queries": s.totalQueries,
		"blocked":       s.blocked,
		"block_rate":    blockRate,
	}
}

func (s *Server) handleRequest(w dns.ResponseWriter, r *dns.Msg) {
	start := time.Now()
	
	log.Printf("Received DNS query for: %v", r.Question)
	
	m := new(dns.Msg)
	m.SetReply(r)
	m.Compress = false

	if len(r.Question) == 0 {
		m.Rcode = dns.RcodeFormatError
		w.WriteMsg(m)
		return
	}

	q := r.Question[0]
	qtypeStr := dns.TypeToString[q.Qtype]

	s.mu.RLock()
	eng := s.engine
	up := s.upstream
	s.mu.RUnlock()

	s.mu.Lock()
	s.totalQueries++
	s.mu.Unlock()
	
	// Pre-build log entry
	logEntry := LogEntry{
		Domain: q.Name,
		Type:   qtypeStr,
		Action: "ALLOWED",
		Speed:  "",
		Seen:   time.Now().Format(time.RFC3339),
	}

	isBlocked := false
	if eng != nil {
		isBlocked = eng.Check(q.Name, q.Qtype)
	}

	if isBlocked {
		s.mu.Lock()
		s.blocked++
		s.mu.Unlock()
		logEntry.Action = "BLOCKED"
	}

	if isBlocked {
		switch q.Qtype {
		case dns.TypeA:
			rr, _ := dns.NewRR(q.Name + " 300 IN A 0.0.0.0")
			if rr != nil {
				m.Answer = append(m.Answer, rr)
			}
		case dns.TypeAAAA:
			rr, _ := dns.NewRR(q.Name + " 300 IN AAAA ::")
			if rr != nil {
				m.Answer = append(m.Answer, rr)
			}
		default:
			m.Rcode = dns.RcodeNameError // NXDOMAIN
		}
		
		logEntry.Speed = time.Since(start).String()
		s.addLog(logEntry)
		w.WriteMsg(m)
		return
	}

	// up is already captured above

	resp, _, err := s.client.Exchange(r, up)
	if err != nil {
		log.Printf("Upstream error for %s: %v", q.Name, err)
		m.Rcode = dns.RcodeServerFailure
		
		logEntry.Speed = time.Since(start).String()
		s.addLog(logEntry)
		w.WriteMsg(m)
		return
	}

	logEntry.Speed = time.Since(start).String()
	s.addLog(logEntry)
	w.WriteMsg(resp)
}

func (s *Server) addLog(l LogEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.recentLogs = append([]LogEntry{l}, s.recentLogs...)
	if len(s.recentLogs) > 100 {
		s.recentLogs = s.recentLogs[:100]
	}
}
