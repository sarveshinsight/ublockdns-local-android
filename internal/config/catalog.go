package config

type ListInfo struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	Desc string `json:"desc"`
}

var Catalog = []ListInfo{
	{Name: "HaGeZi Multi NORMAL", URL: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/normal.txt", Desc: "Balanced DNS-native ads and tracker blocking"},
	{Name: "HaGeZi Multi PRO", URL: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.txt", Desc: "Stricter DNS-native blocking"},
	{Name: "HaGeZi Threat Intelligence Feed", URL: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/tif.txt", Desc: "DNS-native malware, phishing, scam"},
	{Name: "HaGeZi Phishing URL Blocklist", URL: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/phishing.txt", Desc: "Blocks known phishing and scam websites"},
	{Name: "OISD Big", URL: "https://big.oisd.nl/", Desc: "Broad DNS-native blocklist"},
	{Name: "OISD Small", URL: "https://small.oisd.nl/", Desc: "Lightweight blocklist for low-powered devices"},
	{Name: "OISD NSFW", URL: "https://nsfw.oisd.nl/", Desc: "Blocks adult content and NSFW domains"},
	{Name: "Steven Black's Unified Hosts", URL: "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts", Desc: "Comprehensive malware and adware domain blocklist"},
	{Name: "Peter Lowe's Ad & Tracking List", URL: "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext", Desc: "Blocks ad and tracking servers"},
	{Name: "AdGuard DNS Filter", URL: "https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt", Desc: "AdGuard's specific filter for DNS-level blocking"},
	{Name: "Dan Pollock's hosts file", URL: "https://someonewhocares.org/hosts/hosts", Desc: "Blocks ads, trackers, and shocking sites"},
}
