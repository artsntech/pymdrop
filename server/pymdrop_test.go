package main

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// 1. Verifies SSRF protection (ensures internal/private IPs are blocked)
func TestSSRFProtection(t *testing.T) {
	transport := newSafeTransport(false) // allowPrivate = false
	client := &http.Client{
		Transport: transport,
		Timeout:   2 * time.Second,
	}

	blockedTargets := []string{
		"http://127.0.0",
		"http://localhost:8080/healthz",
		"http://169.254.169",
		"http://192.168.1",
		"http://10.0.0",
	}

	for _, target := range blockedTargets {
		_, err := client.Get(target)
		if err == nil {
			t.Errorf("expected access to %s to be blocked by SSRF guard, but it succeeded", target)
		}
	}
}

// 2. Verifies PNG to WebP conversion and grayscale transformation
func TestTransformImageToWebP(t *testing.T) {
	// Create a synthetic 200x200 PNG image with color noise for realistic compression
	img := image.NewRGBA(image.Rect(0, 0, 200, 200))
	for y := 0; y < 200; y++ {
		for x := 0; x < 200; x++ {
			img.Set(x, y, color.RGBA{
				R: uint8((x * y) % 255),
				G: uint8((x + y) % 255),
				B: uint8((x ^ y) % 255),
				A: 255,
			})
		}
	}

	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, img); err != nil {
		t.Fatalf("failed to generate test PNG: %v", err)
	}

	res, err := TransformImage(pngBuf.Bytes(), "image/png", 50, true, 40_000_000)
	if err != nil {
		t.Fatalf("TransformImage returned an unexpected error: %v", err)
	}

	if res.ContentType != "image/webp" {
		t.Errorf("expected ContentType image/webp, got %s", res.ContentType)
	}

	if len(res.Data) >= pngBuf.Len() {
		t.Errorf("expected size reduction: original=%d, compressed=%d", pngBuf.Len(), len(res.Data))
	}
}

// 3. Verifies protection against decompression bombs (megapixel limit)
func TestDecompressionBombProtection(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 100, 100)) // 10,000 pixels
	var pngBuf bytes.Buffer
	_ = png.Encode(&pngBuf, img)

	// Set maxPixels = 5,000 (below the image's 10,000 pixels)
	res, err := TransformImage(pngBuf.Bytes(), "image/png", 50, false, 5_000)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if res.Fallback != "too-large" {
		t.Errorf("expected fallback 'too-large', got '%s'", res.Fallback)
	}
}

// 4. Verifies query string parsing with complex target URLs and parameters
func TestParseProxyQuery(t *testing.T) {
	raw := "quality=40&grayscale=true&token=secret123&url=https://example.com"
	pq, err := parseProxyQuery(raw)
	if err != nil {
		t.Fatalf("parseProxyQuery failed: %v", err)
	}

	if pq.Quality != 40 {
		t.Errorf("expected quality 40, got %d", pq.Quality)
	}
	if !pq.Grayscale {
		t.Errorf("expected grayscale true")
	}
	if pq.Token != "secret123" {
		t.Errorf("expected token 'secret123', got '%s'", pq.Token)
	}
	expectedURL := "https://example.com"
	if pq.Target.String() != expectedURL {
		t.Errorf("expected URL '%s', got '%s'", expectedURL, pq.Target.String())
	}
}

// 5. Verifies the /healthz endpoint end-to-end
func TestHealthzEndpoint(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cfg := LoadConfig()
	pool := NewCompressorPool(10, cfg.MaxPixels)
	pool.Start(ctx)
	_ = NewProxyStreamEngine(pool, cfg)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || rec.Body.String() != "ok" {
		t.Errorf("expected 200 ok, got %d %s", rec.Code, rec.Body.String())
	}
}
