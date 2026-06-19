package config

import (
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	UpstreamDNS string   `yaml:"upstream_dns" json:"upstream_dns"`
	ListenAddr  string   `yaml:"listen_addr" json:"listen_addr"`
	Blocklists  []string `yaml:"blocklists" json:"blocklists"`
	CustomRules []string `yaml:"custom_rules" json:"custom_rules"`
}

func Load(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := yaml.Unmarshal(b, &cfg); err != nil {
		return nil, err
	}
	if cfg.ListenAddr == "" {
		cfg.ListenAddr = "0.0.0.0:53"
	}
	if cfg.UpstreamDNS == "" {
		cfg.UpstreamDNS = "1.1.1.1:853,8.8.8.8:853"
	}
	// Sanitize custom rules
	for i, r := range cfg.CustomRules {
		cfg.CustomRules[i] = strings.ReplaceAll(r, ".^", "^")
	}
	return &cfg, nil
}

func SaveConfig(filename string, cfg *Config) error {
	// Sanitize before save
	for i, r := range cfg.CustomRules {
		cfg.CustomRules[i] = strings.ReplaceAll(r, ".^", "^")
	}
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(filename, data, 0600)
}
