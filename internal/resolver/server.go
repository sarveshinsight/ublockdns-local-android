package resolver

import (
	"context"
	"database/sql"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/miekg/dns"
	"github.com/ugzv/ublockdnsclient/internal/config"
	"github.com/ugzv/ublockdnsclient/internal/db"
	"github.com/ugzv/ublockdnsclient/internal/filtering"
)

type Server struct {
	addr      string
	upstream  string
	engine    *filtering.Engine
	udpClient *dns.Client
	tlsClient *dns.Client
	mu        sync.RWMutex
	logQueue chan LogEntry
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

type DomainCount struct {
	Domain string `json:"domain"`
	Count  int    `json:"count"`
}

func NewServer(addr string, upstream string, engine *filtering.Engine) *Server {
	s := &Server{
		addr:     addr,
		upstream: upstream,
		engine:   engine,
		logQueue: make(chan LogEntry, 10000), // Buffer up to 10k logs
		udpClient: &dns.Client{
			Net:     "udp4", // Force IPv4
			Timeout: 5 * time.Second,
		},
		tlsClient: &dns.Client{
			Net:     "tcp-tls",
			Timeout: 5 * time.Second,
		},
	}
	go s.startLogFlusher()
	return s
}

func (s *Server) ListenAndServe() error {
	mux := dns.NewServeMux()
	mux.HandleFunc(".", s.handleRequest)

	server := &dns.Server{
		Addr:    s.addr,
		Net:     "udp4",
		Handler: mux,
	}
	log.Printf("Starting DNS server on %s, forwarding to %s", s.addr, s.upstream)
	return server.ListenAndServe()
}

func (s *Server) ReloadConfig(cfg *config.Config, dataDir string) error {
	log.Printf("ReloadConfig starting with %d blocklists and %d custom rules", len(cfg.Blocklists), len(cfg.CustomRules))
	var allURLs []string
	for _, l := range config.Catalog {
		allURLs = append(allURLs, l.URL)
	}

	paths, err := filtering.RouteActiveLists(dataDir, cfg.Blocklists, allURLs)
	if err != nil {
		log.Printf("ReloadConfig RouteActiveLists error: %v", err)
		return err
	}

	newEngine, err := filtering.NewEngine(paths, cfg.CustomRules, dataDir)
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

func (s *Server) GetRecentQueries(limit int) []LogEntry {
	rows, err := db.DB.Query("SELECT domain, type, action, speed, time, rule, list_id FROM query_logs ORDER BY id DESC LIMIT ?", limit)
	var logs []LogEntry
	if err != nil {
		return logs
	}
	defer rows.Close()
	for rows.Next() {
		var l LogEntry
		var t string
		var rule sql.NullString
		var listID sql.NullInt64
		if err := rows.Scan(&l.Domain, &l.Type, &l.Action, &l.Speed, &t, &rule, &listID); err != nil {
			log.Printf("scan error: %v", err)
			continue
		}
		l.Seen = t
		if rule.Valid {
			l.Rule = rule.String
		}
		if listID.Valid {
			l.ListID = int(listID.Int64)
		}
		l.Domain = db.DecryptDomain(l.Domain)
		logs = append(logs, l)
	}
	return logs
}

func (s *Server) GetStats(hours int) map[string]interface{} {
	var totalQ, totalB int
	if err := db.DB.QueryRow("SELECT COALESCE(SUM(count), 0), COALESCE(SUM(blocked_count), 0) FROM domain_history").Scan(&totalQ, &totalB); err != nil {
		log.Printf("scan error: %v", err)
	}

	blockRate := 0.0
	if totalQ > 0 {
		blockRate = float64(totalB) / float64(totalQ) * 100
	}

	topQ := []DomainCount{}
	rowsQ, _ := db.DB.Query("SELECT domain, count FROM domain_history ORDER BY count DESC LIMIT 10")
	if rowsQ != nil {
		defer rowsQ.Close()
		for rowsQ.Next() {
			var dc DomainCount
			if err := rowsQ.Scan(&dc.Domain, &dc.Count); err != nil {
				log.Printf("scan error: %v", err)
				continue
			}
			dc.Domain = db.DecryptDomain(dc.Domain)
			topQ = append(topQ, dc)
		}
	}

	topB := []DomainCount{}
	rowsB, _ := db.DB.Query("SELECT domain, blocked_count FROM domain_history WHERE blocked_count > 0 ORDER BY blocked_count DESC LIMIT 10")
	if rowsB != nil {
		defer rowsB.Close()
		for rowsB.Next() {
			var dc DomainCount
			if err := rowsB.Scan(&dc.Domain, &dc.Count); err != nil {
				log.Printf("scan error: %v", err)
				continue
			}
			dc.Domain = db.DecryptDomain(dc.Domain)
			topB = append(topB, dc)
		}
	}

	minBucket := int64(0)
	if hours > 0 {
		minBucket = time.Now().Add(time.Duration(-hours) * time.Hour).Unix()
	}

	histArr := []map[string]interface{}{}
	rowsH, _ := db.DB.Query("SELECT bucket, queries, blocked FROM time_history WHERE bucket >= ? ORDER BY bucket ASC", minBucket)
	if rowsH != nil {
		defer rowsH.Close()
		for rowsH.Next() {
			var bucket int64
			var q, b int
			if err := rowsH.Scan(&bucket, &q, &b); err != nil {
				log.Printf("scan error: %v", err)
				continue
			}
			histArr = append(histArr, map[string]interface{}{
				"timestamp": bucket,
				"queries":   q,
				"blocked":   b,
			})
		}
	}

	return map[string]interface{}{
		"total_queries": totalQ,
		"blocked":       totalB,
		"block_rate":    blockRate,
		"top_queried":   topQ,
		"top_blocked":   topB,
		"history":       histArr,
	}
}

func (s *Server) GetDomainStats(domain string) map[string]interface{} {
	var totalQ, totalB int
	encDomain := db.EncryptDomain(domain)
	err := db.DB.QueryRow("SELECT count, blocked_count FROM domain_history WHERE domain = ?", encDomain).Scan(&totalQ, &totalB)
	if err != nil && err != sql.ErrNoRows {
		log.Printf("scan error: %v", err)
	}

	s.mu.RLock()
	eng := s.engine
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

	histArr := []map[string]interface{}{}
	rowsH, _ := db.DB.Query("SELECT bucket, queries, blocked FROM domain_time_history WHERE domain = ? ORDER BY bucket ASC", domain)
	if rowsH != nil {
		defer rowsH.Close()
		for rowsH.Next() {
			var bucket int64
			var q, b int
			rowsH.Scan(&bucket, &q, &b)
			histArr = append(histArr, map[string]interface{}{
				"timestamp": bucket,
				"queries":   q,
				"blocked":   b,
			})
		}
	}

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

func (s *Server) ProcessDNSMsg(r *dns.Msg) *dns.Msg {
	start := time.Now()

	m := new(dns.Msg)
	m.SetReply(r)
	m.Compress = false

	if len(r.Question) == 0 {
		m.Rcode = dns.RcodeFormatError
		return m
	}

	q := r.Question[0]
	qtypeStr := dns.TypeToString[q.Qtype]

	s.mu.RLock()
	eng := s.engine
	up := s.upstream
	s.mu.RUnlock()

	isBlocked := false
	ruleTxt := ""
	listID := 0
	if eng != nil {
		isBlocked, ruleTxt, listID = eng.Check(q.Name, q.Qtype)
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

		speed := time.Since(start).String()
		s.logQueryAsync(q.Name, qtypeStr, "BLOCKED", speed, ruleTxt, listID)
		return m
	}

	// Route to upstream
	upstreams := strings.Split(up, ",")
	var validUpstreams []string
	for _, u := range upstreams {
		u = strings.TrimSpace(u)
		if u != "" {
			validUpstreams = append(validUpstreams, u)
		}
	}
	if len(validUpstreams) == 0 {
		log.Printf("WARNING: all configured upstreams failed or empty, using TLS fallback")
		validUpstreams = []string{"1.1.1.1:853"}
	}

	type result struct {
		resp *dns.Msg
		err  error
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	resc := make(chan result, len(validUpstreams))
	for _, u := range validUpstreams {
		go func(addr string) {
			var res *dns.Msg
			var err error
			if strings.HasSuffix(addr, ":853") {
				res, _, err = s.tlsClient.ExchangeContext(ctx, r.Copy(), addr)
			} else {
				res, _, err = s.udpClient.ExchangeContext(ctx, r.Copy(), addr)
			}
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
			cancel() // Cancel remaining requests
			break
		}
		err = res.err
	}

	if err != nil || resp == nil {
		m.Rcode = dns.RcodeServerFailure
		speed := time.Since(start).String()
		s.logQueryAsync(q.Name, qtypeStr, "ALLOWED", speed, "", 0)
		return m
	}

	speed := time.Since(start).String()
	s.logQueryAsync(q.Name, qtypeStr, "ALLOWED", speed, "", 0)
	return resp
}

func (s *Server) handleRequest(w dns.ResponseWriter, r *dns.Msg) {
	resp := s.ProcessDNSMsg(r)
	if resp != nil {
		w.WriteMsg(resp)
	}
}

func (s *Server) startLogFlusher() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	var batch []LogEntry

	flush := func() {
		if len(batch) == 0 {
			return
		}

		s.mu.Lock()
		currentBatch := batch
		batch = nil
		s.mu.Unlock()

		tx, err := db.DB.Begin()
		if err != nil {
			return
		}

		qStmt, _ := tx.Prepare("INSERT INTO query_logs (domain, type, action, speed, rule, list_id) VALUES (?, ?, ?, ?, ?, ?)")
		dStmt, _ := tx.Prepare(`INSERT INTO domain_history (domain, count, blocked_count) VALUES (?, 1, ?) ON CONFLICT(domain) DO UPDATE SET count = count + 1, blocked_count = blocked_count + ?`)
		tStmt, _ := tx.Prepare(`INSERT INTO time_history (bucket, queries, blocked) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET queries = queries + 1, blocked = blocked + ?`)
		dtStmt, _ := tx.Prepare(`INSERT INTO domain_time_history (domain, bucket, queries, blocked) VALUES (?, ?, 1, ?) ON CONFLICT(domain, bucket) DO UPDATE SET queries = queries + 1, blocked = blocked + ?`)

		bucket := time.Now().Truncate(5 * time.Minute).Unix()
		for _, l := range currentBatch {
			b := 0
			if l.Action == "BLOCKED" {
				b = 1
			}

			encDomain := db.EncryptDomain(l.Domain)

			if qStmt != nil {
				qStmt.Exec(encDomain, l.Type, l.Action, l.Speed, l.Rule, l.ListID)
			}
			if dStmt != nil {
				dStmt.Exec(encDomain, b, b)
			}

			if tStmt != nil {
				tStmt.Exec(bucket, b, b)
			}
			if dtStmt != nil {
				dtStmt.Exec(encDomain, bucket, b, b)
			}
		}

		if qStmt != nil {
			qStmt.Close()
		}
		if dStmt != nil {
			dStmt.Close()
		}
		if tStmt != nil {
			tStmt.Close()
		}
		if dtStmt != nil {
			dtStmt.Close()
		}

		// Cleanup old logs
		tx.Exec("DELETE FROM query_logs WHERE time < datetime('now', '-24 hours')")
		thirtyDaysAgo := time.Now().Add(-30 * 24 * time.Hour).Unix()
		tx.Exec("DELETE FROM time_history WHERE bucket < ?", thirtyDaysAgo)
		tx.Exec("DELETE FROM domain_time_history WHERE bucket < ?", thirtyDaysAgo)
		tx.Commit()
	}

	for {
		select {
		case l := <-s.logQueue:
			s.mu.Lock()
			batch = append(batch, l)
			needsFlush := len(batch) >= 50
			s.mu.Unlock()
			if needsFlush {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

func (s *Server) logQueryAsync(domain, qtype, action, speed, rule string, listID int) {
	// Trim trailing dot
	domain = strings.TrimSuffix(domain, ".")

	// Non-blocking send
	select {
	case s.logQueue <- LogEntry{
		Domain: domain,
		Type:   qtype,
		Action: action,
		Speed:  speed,
		Rule:   rule,
		ListID: listID,
	}:
	default:
		// Queue full, drop log to avoid blocking DNS resolution
	}
}

func (s *Server) Save() {
	// No-op, SQLite handles persistence
}
