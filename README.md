# Local UblockDNS

This is a **completely local**, self-hosted version of UblockDNS. It brings DNS-level ad and tracker blocking to your entire device using community-maintained filter lists, but unlike the cloud version, **all DNS resolution and blocklist parsing happens entirely on your own machine**.

It features a built-in React-based dashboard that replicates the UblockDNS cloud dashboard, allowing you to view real-time traffic, configure blocklists, and manage custom rules.

## Highlights
- **100% Local**: No DNS queries are sent to external UblockDNS servers.
- **Dockerized**: The entire stack (Go DNS server + React UI) is bundled into a single lightweight Docker container.
- **Modern Dashboard**: Sleek, dark-mode dashboard with real-time stats and query logs.
- **Timeseries Analytics**: Real-time traffic graph with adjustable timeframes (Past Hour to Past Month) and leaderboards for Top Queried and Top Blocked domains.
- **Customizable & Live**: Add/remove blocklists and update Upstream DNS settings via the UI without restarting.
- **Auto-Syncing**: Active blocklists are automatically re-downloaded and synced every 24 hours.
- **Native Windows Integration**: Includes native proxy scripts to safely bypass Docker's port restrictions and instantly toggle system DNS.

## Prerequisites
- Docker / Docker Desktop

## Quick Start

### 1. Build the image
Clone this repository and build the Docker image:
```bash
git clone https://github.com/sarveshinsight/ublockdns-local.git
cd ublockdns-local
docker build -t local-ublockdns-ui .
```

### 2. Run the container
Run the container, mounting the `config.yaml` file so your blocklist choices are saved.
*Note: We map to port 10053 to avoid conflicts with Windows native DNS services.*

```bash
docker run -d \
  --name local-ublockdns-ui \
  -v ${PWD}/config.yaml:/root/config.yaml \
  -v ${PWD}/history.json:/root/history.json \
  -p 10053:53/udp \
  -p 8080:8080 \
  local-ublockdns-ui
```

*(On Windows Command Prompt, use `%cd%\config.yaml` instead of `${PWD}`).*

### 3. Access the Dashboard
Open your browser and navigate to:
[http://localhost:8080](http://localhost:8080)

## System-wide DNS Setup (Windows)

Windows natively runs the `dnscache` and `svchost.exe` services on port `53`, which prevents Docker from binding directly to port `53` without breaking Windows Networking.

Because of this, the container exposes the DNS server on **UDP port 10053**. To use this as your system-wide DNS server on Windows, we've provided native integration scripts so you do NOT need third-party apps like YogaDNS.

### Using the Native Windows Scripts
1. Build the lightweight Go proxy by running:
   ```bash
   cd cmd/proxy && go build -o proxy.exe
   ```
2. Double-click **`Start-UblockDNS.bat`**.
   - This script runs a tiny background `proxy.exe` on `127.0.0.2:53` (bypassing the Docker `127.0.0.1` conflict).
   - It intercepts standard port `53` system queries and forwards them to the Docker container on port `10053`.
   - It also automatically updates your Windows Network Adapter to point to this new DNS server.
3. You can click the **ENABLE** and **DISABLE** buttons on your dashboard to toggle this proxy on and off at any time!

## Configuration

The `config.yaml` file controls the upstream DNS server, listen port, and the active blocklists. You can edit this file manually, or you can toggle blocklists directly from the Dashboard UI (which will automatically update `config.yaml` and reload the DNS engine without dropping packets).

## Architecture

- **Backend**: Go (Golang) using `github.com/miekg/dns` for high-performance UDP DNS resolution.
- **Frontend**: React + Vite, styled with modern CSS.
- **Filtering**: Adguard-compatible `urlfilter` for high-speed domain matching.
