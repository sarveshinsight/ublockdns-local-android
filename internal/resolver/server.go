package resolver

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"sort"
	"strings"
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
	topQueried   map[string]int
	topBlocked   map[string]int
	history      map[int64]*HourlyStat
}

type DomainStat struct {
	Queries int `json:"queries"`
	Blocked int `json:"blocked"`
}

type HourlyStat struct {
	Timestamp int64                  `json:"timestamp"`
	Queries   int                    `json:"queries"`
	Blocked   int                    `json:"blocked"`
	Domains   map[string]*DomainStat `json:"domains"`
}

type LogEntry struct {
	Domain string `json:"domain"`
	Type   string `json:"type"`
	Action string `json:"action"`
	Speed  string `json:"speed"`
	Seen   string `json:"seen"`
	Rule   string `json:"rule,omitempty"`
	ListID int    `json:"list_id,omitempty"`
}

func NewServer(addr string, upstream string, engine *filtering.Engine) *Server {
	s := &Server{
		addr:       addr,
		upstream:   upstream,
		engine:     engine,
		topQueried: make(map[string]int),
		topBlocked: make(map[string]int),
		history:    make(map[int64]*HourlyStat),
		client: &dns.Client{
			Net:     "udp4", // Force IPv4
			Timeout: 5 * time.Second,
		},
	}
	s.loadHistory()
	go s.historySaver()
	return s
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
	log.Printf("ReloadConfig starting with %d blocklists and %d custom rules", len(cfg.Blocklists), len(cfg.CustomRules))
	ctx := context.Background()
	dataDir := "./data"
	paths, err := filtering.DownloadLists(ctx, dataDir, cfg.Blocklists)
	if err != nil {
		log.Printf("ReloadConfig DownloadLists error: %v", err)
		return err
	}

	newEngine, err := filtering.NewEngine(paths, cfg.CustomRules)
	if err != nil {
		log.Printf("ReloadConfig NewEngine error: %v", err)
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.upstream = cfg.UpstreamDNS
	s.engine = newEngine
	log.Printf("ReloadConfig SUCCESS")
	return nil
}

func (s *Server) SetUpstream(up string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.upstream = up
}

func (s *Server) GetRecentQueries() []LogEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]LogEntry(nil), s.recentLogs...) // return copy
}

type DomainCount struct {
	Domain string `json:"domain"`
	Count  int    `json:"count"`
}

func (s *Server) GetStats() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	blockRate := 0.0
	if s.totalQueries > 0 {
		blockRate = float64(s.blocked) / float64(s.totalQueries) * 100
	}
	
	topQ := make([]DomainCount, 0, len(s.topQueried))
	for d, c := range s.topQueried {
		topQ = append(topQ, DomainCount{d, c})
	}
	sort.Slice(topQ, func(i, j int) bool { return topQ[i].Count > topQ[j].Count })
	if len(topQ) > 10 {
		topQ = topQ[:10]
	}

	topB := make([]DomainCount, 0, len(s.topBlocked))
	for d, c := range s.topBlocked {
		topB = append(topB, DomainCount{d, c})
	}
	sort.Slice(topB, func(i, j int) bool { return topB[i].Count > topB[j].Count })
	if len(topB) > 10 {
		topB = topB[:10]
	}

	histArr := make([]*HourlyStat, 0, len(s.history))
	for _, h := range s.history {
		histArr = append(histArr, h)
	}
	sort.Slice(histArr, func(i, j int) bool { return histArr[i].Timestamp < histArr[j].Timestamp })

	return map[string]interface{}{
		"total_queries": s.totalQueries,
		"blocked":       s.blocked,
		"block_rate":    blockRate,
		"top_queried":   topQ,
		"top_blocked":   topB,
		"history":       histArr,
	}
}

func (s *Server) GetDomainStats(domain string) map[string]interface{} {
	s.mu.RLock()
	eng := s.engine
	totalQ := s.topQueried[domain]
	totalB := s.topBlocked[domain]
	s.mu.RUnlock()
	
	isBlocked := false
	ruleTxt := ""
	listID := 0
	if eng != nil {
		isBlocked, ruleTxt, listID = eng.Check(domain, dns.TypeA)
	}

	blockRate := 0.0
	if totalQ > 0 {
		blockRate = float64(totalB) / float64(totalQ) * 100
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	histArr := make([]map[string]interface{}, 0)
	for _, h := range s.history {
		q := 0
		b := 0
		if dstat, ok := h.Domains[domain]; ok {
			q = dstat.Queries
			b = dstat.Blocked
		}
		histArr = append(histArr, map[string]interface{}{
			"timestamp": h.Timestamp,
			"queries":   q,
			"blocked":   b,
		})
	}
	sort.Slice(histArr, func(i, j int) bool { return histArr[i]["timestamp"].(int64) < histArr[j]["timestamp"].(int64) })

	return map[string]interface{}{
		"domain":     domain,
		"queries":    totalQ,
		"blocked":    totalB,
		"block_rate": blockRate,
		"history":    histArr,
		"is_blocked": isBlocked,
		"rule":       ruleTxt,
		"list_id":    listID,
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
	s.topQueried[q.Name]++
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
	ruleTxt := ""
	listID := 0
	if eng != nil {
		isBlocked, ruleTxt, listID = eng.Check(q.Name, q.Qtype)
	}

	if isBlocked {
		s.mu.Lock()
		s.blocked++
		s.topBlocked[q.Name]++
		s.mu.Unlock()
		logEntry.Action = "BLOCKED"
		logEntry.Rule = ruleTxt
		logEntry.ListID = listID
	}

	if isBlocked {
		switch q.Qtype {
		case dns.TypeA:
			rr, _ := dns.NewRR(q.Name + " 10 IN A 0.0.0.0")
			if rr != nil {
				m.Answer = append(m.Answer, rr)
			}
		case dns.TypeAAAA:
			rr, _ := dns.NewRR(q.Name + " 10 IN AAAA ::")
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

	// Handle multi-upstream routing concurrently for fastest response
	upstreams := strings.Split(up, ",")
	
	type result struct {
		resp *dns.Msg
		err  error
	}
	
	// Filter valid upstreams
	var validUpstreams []string
	for _, u := range upstreams {
		u = strings.TrimSpace(u)
		if u != "" {
			validUpstreams = append(validUpstreams, u)
		}
	}
	
	if len(validUpstreams) == 0 {
		validUpstreams = []string{"1.1.1.1:53"} // Fallback
	}

	log.Printf("Routing %s to upstreams: %v", q.Name, validUpstreams)

	resc := make(chan result, len(validUpstreams))
	
	for _, u := range validUpstreams {
		go func(addr string) {
			netType := "udp4"
			if strings.HasSuffix(addr, ":853") {
				netType = "tcp-tls"
			}
			
			client := &dns.Client{
				Net:     netType,
				Timeout: 5 * time.Second,
			}
			
			res, _, err := client.Exchange(r.Copy(), addr)
			resc <- result{res, err}
		}(u)
	}

	var resp *dns.Msg
	var err error
	
	for i := 0; i < len(validUpstreams); i++ {
		res := <-resc
		if res.err == nil && res.resp != nil {
			resp = res.resp
			err = nil
			break // Fastest successful response wins
		}
		err = res.err
	}

	if err != nil || resp == nil {
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
	if len(s.recentLogs) > 5000 {
		s.recentLogs = s.recentLogs[:5000]
	}

	// Bucket by 5-minute intervals
	bucket := time.Now().Truncate(5 * time.Minute).Unix()
	if s.history[bucket] == nil {
		s.history[bucket] = &HourlyStat{Timestamp: bucket, Domains: make(map[string]*DomainStat)}
	}
	s.history[bucket].Queries++
	
	if s.history[bucket].Domains == nil {
		s.history[bucket].Domains = make(map[string]*DomainStat)
	}
	if s.history[bucket].Domains[l.Domain] == nil {
		s.history[bucket].Domains[l.Domain] = &DomainStat{}
	}
	s.history[bucket].Domains[l.Domain].Queries++

	if l.Action == "BLOCKED" {
		s.history[bucket].Blocked++
		s.history[bucket].Domains[l.Domain].Blocked++
	}
	
	// Aggressive cleanup: keep only last 30 days (30 * 24 * 12 = 8640 buckets)
	cutoff := bucket - (30 * 24 * 3600)
	for ts := range s.history {
		if ts < cutoff {
			delete(s.history, ts)
		}
	}
}

func (s *Server) loadHistory() {
	b, err := os.ReadFile("history.json")
	if err == nil {
		var h map[int64]*HourlyStat
		if err := json.Unmarshal(b, &h); err == nil {
			s.history = h
		}
	}
}

func (s *Server) saveHistory() {
	s.mu.RLock()
	b, err := json.Marshal(s.history)
	s.mu.RUnlock()
	if err == nil {
		os.WriteFile("history.json", b, 0644)
	}
}

func (s *Server) historySaver() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		s.saveHistory()
	}
}
