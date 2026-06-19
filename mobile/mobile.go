package mobile

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"sync"

	"github.com/miekg/dns"
	"github.com/ugzv/ublockdnsclient/internal/api"
	"github.com/ugzv/ublockdnsclient/internal/config"
	"github.com/ugzv/ublockdnsclient/internal/db"
	"github.com/ugzv/ublockdnsclient/internal/resolver"
	"github.com/ugzv/ublockdnsclient/internal/updater"
)

var (
	GlobalServer  *resolver.Server
	GlobalUpdater *updater.Updater
	cancelFunc    context.CancelFunc
	isRunning     bool
)

// Start initializes the UblockDNS backend.
// dataDir should be the Android app's private files directory (e.g., /data/user/0/com.ublockdns.app/files)
func Start(dataDir string) {
	if isRunning {
		log.Println("Mobile: Backend already running")
		return
	}
	isRunning = true

	log.Printf("Mobile: Starting UblockDNS in %s", dataDir)

	cfg, err := config.Load(filepath.Join(dataDir, "config.yaml"))
	if err != nil || cfg == nil {
		cfg = &config.Config{
			UpstreamDNS: "1.1.1.1:853,8.8.8.8:853",
			ListenAddr:  "127.0.0.1:10053",
		}
	}

	db.InitDB(dataDir)
	db.InitEncryption(dataDir)

	ctx, cancel := context.WithCancel(context.Background())
	cancelFunc = cancel

	GlobalUpdater = updater.NewUpdater(dataDir, func() {
		if GlobalServer != nil {
			// Provide the config when reloading
			cfgCopy, _ := config.Load(filepath.Join(dataDir, "config.yaml"))
			if cfgCopy != nil {
				GlobalServer.ReloadConfig(cfgCopy, dataDir)
			}
		}
	})

	// Start the updater
	GlobalUpdater.Start(ctx)

	GlobalServer = resolver.NewServer("127.0.0.1:10053", cfg.UpstreamDNS, nil)

	// Load blocklists asynchronously so UI and VpnService can start immediately
	go func() {
		err := GlobalServer.ReloadConfig(cfg, dataDir)
		if err != nil {
			log.Printf("Mobile: Failed to reload config: %v", err)
		}
	}()

	// Start the web UI API server
	go func() {
		apiServer := api.NewServer("127.0.0.1:8080", cfg, GlobalServer, filepath.Join(dataDir, "config.yaml"), GlobalUpdater)
		apiServer.Start()
	}()

	log.Println("Mobile: Backend successfully initialized")
}

// Stop shuts down the backend gracefully.
func Stop() {
	if cancelFunc != nil {
		cancelFunc()
	}
	if GlobalServer != nil {
		GlobalServer.Save()
	}
	isRunning = false
	log.Println("Mobile: Backend stopped")
}

// SyncMaster triggers a blocklist update, to be called by Android's WorkManager
func SyncMaster() {
	if GlobalUpdater != nil {
		GlobalUpdater.SyncMaster()
	}
}

var bufPool = sync.Pool{
	New: func() interface{} {
		b := make([]byte, 2048)
		return &b
	},
}

// ProcessPacket takes a raw IPv4 packet from Android's TUN interface,
// parses the UDP payload as a DNS query, processes it, and returns a crafted IPv4 response.
// Returns nil if the packet is not a valid IPv4/UDP DNS packet.
func ProcessPacket(packet []byte, length int) []byte {
	if GlobalServer == nil || length < 28 || length > len(packet) {
		return nil
	}

	packetData := packet[:length]

	// Basic IPv4 parsing
	versionIhl := packetData[0]
	version := versionIhl >> 4
	if version != 4 {
		return nil // Only IPv4 supported
	}
	ihl := int(versionIhl & 0x0F)
	ipHeaderLen := ihl * 4

	if length < ipHeaderLen+8 {
		return nil
	}

	protocol := packetData[9]
	if protocol != 17 { // 17 = UDP
		return nil
	}

	// Swap Source and Destination IPs for the response
	srcIP := packetData[12:16]
	dstIP := packetData[16:20]

	// Parse UDP Header
	udpHeaderStart := ipHeaderLen
	srcPort := packetData[udpHeaderStart : udpHeaderStart+2]
	dstPort := packetData[udpHeaderStart+2 : udpHeaderStart+4]

	// Port 53 check (only process DNS queries)
	if dstPort[0] != 0 || dstPort[1] != 53 {
		return nil
	}

	udpPayloadStart := udpHeaderStart + 8
	dnsQueryBytes := packetData[udpPayloadStart:]

	// Parse DNS Message
	req := new(dns.Msg)
	if err := req.Unpack(dnsQueryBytes); err != nil {
		return nil
	}

	// Process DNS Query via Server
	resp := GlobalServer.ProcessDNSMsg(req)
	if resp == nil {
		return nil
	}

	// Pack DNS Response
	bufPtr := bufPool.Get().(*[]byte)
	defer bufPool.Put(bufPtr)
	buf := (*bufPtr)[:0] // reset length to 0

	respBytes, err := resp.PackBuffer(buf)
	if err != nil {
		return nil
	}

	// Craft IPv4 + UDP Response Packet
	respPacketLen := ipHeaderLen + 8 + len(respBytes)
	respPacket := make([]byte, respPacketLen)

	// Copy original IP header
	copy(respPacket, packetData[:ipHeaderLen])

	// Set Total Length
	respPacket[2] = byte(respPacketLen >> 8)
	respPacket[3] = byte(respPacketLen)

	// Swap IPs
	copy(respPacket[12:16], dstIP)
	copy(respPacket[16:20], srcIP)

	// We need to recalculate IPv4 Checksum (set to 0 first)
	respPacket[10] = 0
	respPacket[11] = 0

	var ipSum uint32
	for i := 0; i < ipHeaderLen; i += 2 {
		ipSum += uint32(respPacket[i])<<8 | uint32(respPacket[i+1])
	}
	for ipSum > 0xffff {
		ipSum = (ipSum >> 16) + (ipSum & 0xffff)
	}
	ipChecksum := ^uint16(ipSum)
	respPacket[10] = byte(ipChecksum >> 8)
	respPacket[11] = byte(ipChecksum)

	// Set UDP Header
	copy(respPacket[ipHeaderLen:ipHeaderLen+2], dstPort)   // Src Port
	copy(respPacket[ipHeaderLen+2:ipHeaderLen+4], srcPort) // Dst Port

	udpLen := 8 + len(respBytes)
	respPacket[ipHeaderLen+4] = byte(udpLen >> 8)
	respPacket[ipHeaderLen+5] = byte(udpLen)

	// UDP Checksum (optional, set to 0 to ignore)
	respPacket[ipHeaderLen+6] = 0
	respPacket[ipHeaderLen+7] = 0

	// Copy DNS Response Payload
	copy(respPacket[ipHeaderLen+8:], respBytes)

	return respPacket
}

func GetNotificationText() string {
	if GlobalServer == nil {
		return "Starting..."
	}
	stats := GlobalServer.GetStats(24)
	total := stats["total_queries"].(int)
	blocked := stats["blocked"].(int)
	
	txt := ""
	if total == 0 {
		txt = "Blocking trackers and ads locally"
	} else {
		txt = fmt.Sprintf("%d Queries | %d Blocked", total, blocked)
		if topB, ok := stats["top_blocked"].([]resolver.DomainCount); ok && len(topB) > 0 {
			txt += "\nBlocked: "
			for i, v := range topB {
				if i > 0 { txt += ", " }
				txt += v.Domain
				if i >= 2 { break }
			}
		}
	}
	return txt
}
