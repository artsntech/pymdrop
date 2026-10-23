package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/subtle"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/andybalholm/brotli"
	"github.com/tdewolff/minify/v2"
	"github.com/tdewolff/minify/v2/css"
	"github.com/tdewolff/minify/v2/html"
	"github.com/tdewolff/minify/v2/js"
)

const (
	// Images smaller than this (icons, tracking pixels) are not worth
	// the cost of decoding and re-encoding.
	minImageBytes = 3 * 1024

	imageCacheControl = "public, max-age=86400"
)

var globalMinifier *minify.M

func init() {
	globalMinifier = minify.New()

	globalMinifier.AddFunc("text/html", html.Minify)
	globalMinifier.AddFunc("text/css", css.Minify)
	globalMinifier.AddFunc("application/javascript", js.Minify)
	globalMinifier.AddFunc("text/javascript", js.Minify)
}

type ProxyStreamEngine struct {
	httpClient *http.Client
	pool       *CompressorPool
	cfg        Config
}

func NewProxyStreamEngine(pool *CompressorPool, cfg Config) *ProxyStreamEngine {
	return &ProxyStreamEngine{
		httpClient: &http.Client{
			Timeout:   15 * time.Second,
			Transport: newSafeTransport(cfg.AllowPrivate),
		},
		pool: pool,
		cfg:  cfg,
	}
}

func setCommonHeaders(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Expose-Headers", "X-Original-Size, X-Compressed-Size, X-PymDrop-Fallback")
	h.Set("Timing-Allow-Origin", "*")

	// Private Network Access: We only respond when Chrome asks..
	if r.Header.Get("Access-Control-Request-Private-Network") == "true" {
		h.Set("Access-Control-Allow-Private-Network", "true")
	}
}

// readLimited reads up to max bytes. If the response is larger, returns what has 
// already been read and truncated=true; the caller streams the rest without 
// keeping it in memory.
func readLimited(body io.Reader, max int64) (data []byte, truncated bool, err error) {
	data, err = io.ReadAll(io.LimitReader(body, max+1))
	if err != nil {
		return nil, false, err
	}

	if int64(len(data)) > max {
		return data, true, nil
	}

	return data, false, nil
}

// streamRest writes what has already been read and continue copying the rest of the body
func streamRest(w http.ResponseWriter, contentType string, head []byte, rest io.Reader) {
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(head)
	_, _ = io.Copy(w, rest)
}

func isMinifiable(cleanType string) bool {
	switch cleanType {
	case "text/html", "text/css", "application/javascript", "text/javascript":
		return true
	}
	return false
}

func (e *ProxyStreamEngine) ServeHTTPAndMinify(w http.ResponseWriter, r *http.Request) {
	globalStats.TotalRequests.Add(1)

	setCommonHeaders(w, r)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not supported", http.StatusMethodNotAllowed)
		return
	}

	pq, err := parseProxyQuery(r.URL.RawQuery)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if e.cfg.Token != "" &&
		subtle.ConstantTimeCompare([]byte(pq.Token), []byte(e.cfg.Token)) != 1 {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pq.Target.String(), nil)
	if err != nil {
		http.Error(w, "invalid URL", http.StatusBadRequest)
		return
	}

	// Preserve the headers that influence the content returned by the site.
	for _, name := range []string{"User-Agent", "Accept-Language", "Referer"} {
		if v := r.Header.Get(name); v != "" {
			req.Header.Set(name, v)
		}
	}

	// Requests Brotli (and gzip as a fallback) from the origin. Go automatically 
	// decompresses the response, but declaring br prevents the origin server 
	// from sending a worse version when it could send Brotli.
	req.Header.Set("Accept-Encoding", "br, gzip")

	accept := r.Header.Get("Accept")
	if strings.Contains(accept, "image/") {
		accept = "image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5"
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}

	resp, err := e.httpClient.Do(req)
	if err != nil {
		log.Printf("network error (%s): %v", pq.Target.Host, err)
		http.Error(w, "Network error", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		w.WriteHeader(resp.StatusCode)
		return
	}

	contentType := resp.Header.Get("Content-Type")
	cleanType := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))

	if pq.BlockMedia &&
		(strings.HasPrefix(cleanType, "video/") || strings.HasPrefix(cleanType, "audio/")) {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	switch {
	case cleanType == "image/jpeg" || cleanType == "image/jpg" || cleanType == "image/png":
		e.serveImage(ctx, w, resp, cleanType, pq)

	case isMinifiable(cleanType):
		e.serveText(w, r, resp, cleanType, contentType)

	default:
		if contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		_, _ = io.Copy(w, resp.Body)
	}
}

func (e *ProxyStreamEngine) serveImage(
	ctx context.Context,
	w http.ResponseWriter,
	resp *http.Response,
	cleanType string,
	pq *proxyQuery,
) {
	globalStats.ImageRequests.Add(1)
	globalStats.IncByContentType(cleanType)

	imgBytes, truncated, err := readLimited(resp.Body, e.cfg.MaxBodyBytes)
	if err != nil {
		http.Error(w, "Error reading image", http.StatusBadGateway)
		return
	}

	globalStats.BytesIn.Add(int64(len(imgBytes)))

	if truncated {
		globalStats.PassthroughReqs.Add(1)
		streamRest(w, cleanType, imgBytes, resp.Body)
		return
	}

	writeImage := func(data []byte, contentType, fallback string) {
		globalStats.BytesOut.Add(int64(len(data)))

		if fallback != "" {
			globalStats.ImagesPassthru.Add(1)
			globalStats.IncByFallback(fallback)
		} else {
			globalStats.ImagesProcessed.Add(1)
			if saved := int64(len(imgBytes)) - int64(len(data)); saved > 0 {
				globalStats.BytesSaved.Add(saved)
			}
		}

		h := w.Header()
		h.Set("Content-Type", contentType)
		h.Set("Content-Length", strconv.Itoa(len(data)))
		h.Set("X-Original-Size", strconv.Itoa(len(imgBytes)))
		h.Set("X-Compressed-Size", strconv.Itoa(len(data)))
		h.Set("Cache-Control", imageCacheControl)
		if fallback != "" {
			h.Set("X-PymDrop-Fallback", fallback)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	}

	if len(imgBytes) < minImageBytes {
		writeImage(imgBytes, cleanType, "small")
		return
	}

	resultChan := make(chan Result, 1)

	job := Job{
		URL:          pq.Target.String(),
		OriginalData: imgBytes,
		ContentType:  cleanType,
		Quality:      pq.Quality,
		Grayscale:    pq.Grayscale,
		ResultChan:   resultChan,
	}

	select {
	case e.pool.jobQueue <- job:
	case <-ctx.Done():
		http.Error(w, "Processing timeout", http.StatusGatewayTimeout)
		return
	}

	var result Result

	select {
	case result = <-resultChan:
	case <-ctx.Done():
		http.Error(w, "Processing timeout", http.StatusGatewayTimeout)
		return
	}

	if result.Error != nil {
		log.Printf("failed to process %s: %v", pq.Target, result.Error)
		writeImage(imgBytes, cleanType, "error")
		return
	}

	writeImage(result.ProcessedData, result.ContentType, result.Fallback)
}

func (e *ProxyStreamEngine) serveText(
	w http.ResponseWriter,
	r *http.Request,
	resp *http.Response,
	cleanType string,
	contentType string,
) {
	globalStats.TextRequests.Add(1)
	globalStats.IncByContentType(cleanType)

	textBytes, truncated, err := readLimited(resp.Body, e.cfg.MaxBodyBytes)
	if err != nil {
		http.Error(w, "Error reading response", http.StatusBadGateway)
		return
	}

	globalStats.BytesIn.Add(int64(len(textBytes)))

	if truncated {
		globalStats.PassthroughReqs.Add(1)
		streamRest(w, contentType, textBytes, resp.Body)
		return
	}

	var out bytes.Buffer

	if err := globalMinifier.Minify(cleanType, &out, bytes.NewReader(textBytes)); err != nil {
		out.Reset()
		out.Write(textBytes)
	}

	result := out.Bytes()

	h := w.Header()
	h.Set("Content-Type", contentType)
	h.Set("X-Original-Size", strconv.Itoa(len(textBytes)))
	h.Set("X-Compressed-Size", strconv.Itoa(len(result)))
	h.Add("Vary", "Accept-Encoding")

	acceptEncoding := r.Header.Get("Accept-Encoding")

	switch {
	case strings.Contains(acceptEncoding, "br"):
		var brBuf bytes.Buffer
		bw := brotli.NewWriter(&brBuf)
		_, _ = bw.Write(result)
		_ = bw.Close()

		globalStats.BytesOut.Add(int64(brBuf.Len()))

		h.Set("Content-Encoding", "br")
		h.Set("Content-Length", fmt.Sprintf("%d", brBuf.Len()))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(brBuf.Bytes())

	case strings.Contains(acceptEncoding, "gzip"):
		var gz bytes.Buffer
		zw := gzip.NewWriter(&gz)
		_, _ = zw.Write(result)
		_ = zw.Close()

		globalStats.BytesOut.Add(int64(gz.Len()))

		h.Set("Content-Encoding", "gzip")
		h.Set("Content-Length", fmt.Sprintf("%d", gz.Len()))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(gz.Bytes())

	default:
		globalStats.BytesOut.Add(int64(len(result)))

		h.Set("Content-Length", fmt.Sprintf("%d", len(result)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(result)
	}
}