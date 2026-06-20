//go:build !android

package main

import (
	"log"
	"net"
)

func main() {
	// Listen on 127.0.0.2:53 (because Docker Desktop usually hijacks 127.0.0.1:53)
	localAddr, err := net.ResolveUDPAddr("udp", "127.0.0.2:53")
	if err != nil {
		log.Fatalf("Error resolving local address: %v", err)
	}

	// Connect to 127.0.0.1:10053
	remoteAddr, err := net.ResolveUDPAddr("udp", "127.0.0.1:10053")
	if err != nil {
		log.Fatalf("Error resolving remote address: %v", err)
	}

	conn, err := net.ListenUDP("udp", localAddr)
	if err != nil {
		log.Fatalf("Error starting proxy on 127.0.0.2:53. Make sure to run as Administrator. %v", err)
	}
	defer conn.Close()

	log.Println("UDP Proxy listening on 127.0.0.2:53 and forwarding to 127.0.0.1:10053")

	buffer := make([]byte, 2048)

	for {
		n, clientAddr, err := conn.ReadFromUDP(buffer)
		if err != nil {
			log.Printf("Error reading from UDP: %v", err)
			continue
		}

		go func(data []byte, cAddr *net.UDPAddr) {
			// Forward to Docker
			upstreamConn, err := net.DialUDP("udp", nil, remoteAddr)
			if err != nil {
				log.Printf("Error dialing upstream: %v", err)
				return
			}
			defer upstreamConn.Close()

			_, err = upstreamConn.Write(data)
			if err != nil {
				log.Printf("Error writing to upstream: %v", err)
				return
			}

			// Read response
			respBuffer := make([]byte, 2048)
			rn, err := upstreamConn.Read(respBuffer)
			if err != nil {
				log.Printf("Error reading from upstream: %v", err)
				return
			}

			// Send back to client
			_, err = conn.WriteToUDP(respBuffer[:rn], cAddr)
			if err != nil {
				log.Printf("Error writing to client: %v", err)
			}
		}(append([]byte(nil), buffer[:n]...), clientAddr)
	}
}
