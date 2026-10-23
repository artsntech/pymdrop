package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg := LoadConfig()

	pool := NewCompressorPool(500, cfg.MaxPixels)
	pool.Start(ctx)

	engine := NewProxyStreamEngine(pool, cfg)

	mux := http.NewServeMux()
	mux.HandleFunc("/proxy", engine.ServeHTTPAndMinify)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/stats", StatsHandler)
	mux.HandleFunc("/stats/reset", StatsResetHandler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		<-ctx.Done()

		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		_ = srv.Shutdown(shutdownCtx)
	}()

	log.Printf("🚀 PymDrop Engine running on port :%s", port)
	log.Printf("📡 Endpoint:     http://localhost:%s/proxy?url=...", port)
	log.Printf("📊 Statistics: http://localhost:%s/stats", port)
	log.Printf("❤️  Health:       http://localhost:%s/healthz", port)

	if cfg.Token == "" {
		log.Printf("WARNING: PYMDROP_TOKEN not set; the proxy accepts requests from any origin")
	}

	if cfg.AllowPrivate {
		log.Printf("WARNING: PYMDROP_ALLOW_PRIVATE=1; SSRF protection is disabled")
	}

	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("failed to start server: %v", err)
	}
}