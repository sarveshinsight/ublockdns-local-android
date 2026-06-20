package updater

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

const (
	GitHubRepo  = "sarveshinsight/ublockdns-local-android"
	GitHubAPI   = "https://api.github.com/repos/" + GitHubRepo + "/releases/latest"
)

// AppUpdate holds information about an available app update.
type AppUpdate struct {
	Available    bool   `json:"available"`
	CurrentVer   string `json:"current_version"`
	LatestVer    string `json:"latest_version"`
	DownloadURL  string `json:"download_url"`
	ReleaseNotes string `json:"release_notes"`
	SizeBytes    int64  `json:"size_bytes"`
	PublishedAt  string `json:"published_at"`
}

type githubRelease struct {
	TagName     string        `json:"tag_name"`
	Name        string        `json:"name"`
	Body        string        `json:"body"`
	HtmlUrl     string        `json:"html_url"`
	PublishedAt string        `json:"published_at"`
	Assets      []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
	ContentType        string `json:"content_type"`
}

// CheckForUpdate checks GitHub Releases for a newer version.
func CheckForUpdate(currentVersion string) (*AppUpdate, error) {
	client := &http.Client{Timeout: 15 * time.Second}

	req, err := http.NewRequest("GET", GitHubAPI, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "UblockDNS-Updater/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch release info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		// No releases yet
		return &AppUpdate{
			Available:  false,
			CurrentVer: currentVersion,
			LatestVer:  currentVersion,
		}, nil
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub API returned status %d", resp.StatusCode)
	}

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("failed to decode release: %w", err)
	}

	latestVer := strings.TrimPrefix(release.TagName, "v")
	currentClean := strings.TrimPrefix(currentVersion, "v")

	update := &AppUpdate{
		CurrentVer:   currentClean,
		LatestVer:    latestVer,
		ReleaseNotes: truncateNotes(release.Body, 500),
		PublishedAt:  release.PublishedAt,
	}

	// Find APK asset
	for _, asset := range release.Assets {
		if strings.HasSuffix(strings.ToLower(asset.Name), ".apk") {
			update.DownloadURL = asset.BrowserDownloadURL
			update.SizeBytes = asset.Size
			break
		}
	}

	// Fallback to GitHub release page if no APK is found
	if update.DownloadURL == "" {
		update.DownloadURL = release.HtmlUrl
	}

	// Compare versions (simple string comparison; works for semver like 1.0 < 1.1 < 2.0)
	update.Available = compareVersions(currentClean, latestVer)

	if update.Available {
		log.Printf("AppUpdater: update available %s -> %s", currentClean, latestVer)
	}

	return update, nil
}

// compareVersions returns true if latest > current using semver-like comparison.
func compareVersions(current, latest string) bool {
	currentParts := strings.Split(current, ".")
	latestParts := strings.Split(latest, ".")

	maxLen := len(currentParts)
	if len(latestParts) > maxLen {
		maxLen = len(latestParts)
	}

	for i := 0; i < maxLen; i++ {
		var c, l int
		if i < len(currentParts) {
			fmt.Sscanf(currentParts[i], "%d", &c)
		}
		if i < len(latestParts) {
			fmt.Sscanf(latestParts[i], "%d", &l)
		}
		if l > c {
			return true
		}
		if l < c {
			return false
		}
	}
	return false
}

func truncateNotes(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
