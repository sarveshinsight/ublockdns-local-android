package db

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"log"
	"os"
	"path/filepath"
)

var aesKey []byte

func InitEncryption(dataDir string) {
	keyPath := filepath.Join(dataDir, "db_key.bin")
	key, err := os.ReadFile(keyPath)
	if err == nil && len(key) == 32 {
		aesKey = key
		return
	}

	// Generate new key
	aesKey = make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, aesKey); err != nil {
		log.Fatalf("Failed to generate AES key: %v", err)
	}

	if err := os.WriteFile(keyPath, aesKey, 0600); err != nil {
		log.Printf("Warning: failed to save DB encryption key: %v", err)
	}
}

func EncryptDomain(domain string) string {
	if len(aesKey) == 0 || domain == "" {
		return domain
	}

	block, err := aes.NewCipher(aesKey)
	if err != nil {
		return domain
	}

	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return domain
	}

	// Deterministic IV to allow SQL GROUP BY and ON CONFLICT
	hash := sha256.Sum256([]byte(domain))
	iv := hash[:12]

	ciphertext := aesgcm.Seal(iv, iv, []byte(domain), nil)
	return base64.StdEncoding.EncodeToString(ciphertext)
}

func DecryptDomain(encrypted string) string {
	if len(aesKey) == 0 || encrypted == "" {
		return encrypted
	}

	ciphertext, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil || len(ciphertext) < 12 {
		return encrypted // Not encrypted or invalid
	}

	block, err := aes.NewCipher(aesKey)
	if err != nil {
		return encrypted
	}

	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return encrypted
	}

	iv := ciphertext[:12]
	plaintext, err := aesgcm.Open(nil, iv, ciphertext[12:], nil)
	if err != nil {
		return encrypted // Decryption failed
	}

	return string(plaintext)
}
