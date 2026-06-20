# uBlockDNS for Android

**uBlockDNS** is a completely local, self-hosted DNS ad-blocker designed directly for Android. It brings network-wide DNS-level ad and tracker blocking to your phone, but unlike cloud-based DNS providers, **all DNS resolution and blocklist parsing happens entirely on your own device**.

It features a built-in React-based dashboard (styled with a beautiful OLED Dark Mode design) that replicates premium cloud dashboards, allowing you to view real-time traffic, configure blocklists, and manage custom rules right from your phone.

## Highlights
- **100% Local Privacy**: No DNS queries are sent to external UblockDNS servers for filtering. Your privacy stays on your device.
- **Android VPN Service**: Uses a native Android VpnService to seamlessly route all your phone's DNS traffic to the local Go-based resolver. No root required!
- **Gomobile Backend**: The high-performance Go DNS server runs natively inside the Android app using Gomobile bindings.
- **Modern Dashboard**: Sleek, OLED dark-mode dashboard with real-time stats and query logs embedded in a WebView.
- **Data Science Analytics**: Includes beautiful interactive charts for Query Volume over time, Cumulative Queries, Block Rate Trends, and Query Type Distribution.
- **Auto-Updater**: Built-in background worker automatically checks for new APK updates from GitHub and notifies you when a new version is available for 1-tap installation.
- **Auto-Syncing**: Active blocklists are automatically re-downloaded and synced in the background using Android WorkManager.

## How it Works
1. **The Backend**: The app bundles a lightweight Go (Golang) server compiled to a native Android library via `gomobile`. This backend runs an embedded HTTP API and a UDP DNS resolver.
2. **The Intercept**: When you tap "Connect", Android establishes a local loopback VPN. It intercepts all outbound port 53 (DNS) traffic and forwards it to the embedded Go DNS resolver.
3. **The Filtering**: The Go resolver checks domains against your active blocklists and custom rules. Blocked domains are returned as `0.0.0.0`, while allowed domains are forwarded to your chosen upstream DNS (like Cloudflare or Quad9).
4. **The UI**: The beautiful dashboard you see is a React JS application. It is compiled to static files and served directly by the Go backend on `localhost:8080`, rendering inside an Android WebView.

## How to Install / Download

You don't need to build the app from source to use it! The GitHub Actions CI automatically builds and signs the APK on every release.

1. Navigate to the **[Releases](../../releases/latest)** section of this repository.
2. Under "Assets", find and download the latest `ublockdns-*.apk` file.
3. Open the downloaded file on your Android device. Your phone may prompt you to "Allow installation from unknown sources" for your browser or file manager.
4. Install the app, open it, and tap the **Protection** switch to start the local VPN!

*(Note: The app will automatically notify you when future updates are released so you don't have to keep checking GitHub).*

## Building from Source

If you wish to compile the Android app yourself:

### Prerequisites
- Node.js (v20+)
- Go (1.21+)
- Gomobile (`go install golang.org/x/mobile/cmd/gomobile@latest`)
- Android Studio / Android SDK (API 34)

### Steps
1. **Build the React Frontend:**
   ```bash
   cd web
   npm install
   npm run build
   cd ..
   ```

2. **Compile the Go Library:**
   ```bash
   gomobile init
   gomobile bind -target=android -androidapi 24 -o android-app/app/libs/mobile.aar ./mobile
   ```

3. **Build the APK:**
   Open the `android-app` folder in Android Studio and click **Build > Build Bundle(s) / APK(s) > Build APK(s)**, or use the Gradle wrapper from the command line:
   ```bash
   cd android-app
   ./gradlew assembleDebug
   ```

## Architecture
- **Backend**: Go (Golang) using `github.com/miekg/dns` for high-performance UDP DNS resolution.
- **Frontend**: React + Recharts, styled with modern OLED CSS and Lucide icons.
- **Filtering**: Adguard-compatible `urlfilter` for high-speed domain matching.
- **Android Integration**: Java-based `VpnService`, `WorkManager` for background syncing, and a `JavascriptInterface` bridge for native intents like app updates.
