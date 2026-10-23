package main

import "os"

// Config gathers the server settings, read from environment variables.
type Config struct {
	// Token, if defined (PYMDROP_TOKEN), is required on all requests (?token=...). 
	// Recommended in production to prevent the proxy from being left open to everyone.
	Token string

	// AllowPrivate (PYMDROP_ALLOW_PRIVATE=1) disables SSRF protection. 
	// Only useful during local development.
	AllowPrivate bool

	// MaxBodyBytes is the maximum size that the server loads into memory per response.
	MaxBodyBytes int64

	// MaxPixels is the pixel limit that we accept for decoding. (anti "decompression bomb").
	MaxPixels int
}

func LoadConfig() Config {
	return Config{
		Token:        os.Getenv("PYMDROP_TOKEN"),
		AllowPrivate: os.Getenv("PYMDROP_ALLOW_PRIVATE") == "1",
		MaxBodyBytes: 25 << 20, // 25 MB
		MaxPixels:    40_000_000,
	}
}