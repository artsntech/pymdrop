package main

import (
	"encoding/json"
	"net/http"
	"sync"
	"sync/atomic"
)

// Stats stores aggregated proxy counters. Uses atomic 
// operations to allow concurrent increments without locks.
type Stats struct {
	// Requests to /proxy
	TotalRequests   atomic.Int64
	ImageRequests   atomic.Int64
	TextRequests    atomic.Int64
	PassthroughReqs atomic.Int64

	// Processed images
	ImagesProcessed  atomic.Int64
	ImagesPassthru   atomic.Int64
	ImagesByFallback sync.Map // map[string]*atomic.Int64 keyed by fallback reason

	// Bytes
	BytesIn    atomic.Int64 // Bytes received from origins
	BytesOut   atomic.Int64 // Bytes sent to clients
	BytesSaved atomic.Int64 // Bytes saved (in - out) when positive

	// Distribution by Content-Type
	ByContentType sync.Map // map[string]*atomic.Int64
}

var globalStats = &Stats{}

// IncByFallback increments the counter for the fallback reason.
func (s *Stats) IncByFallback(reason string) {
	if reason == "" {
		reason = "unknown"
	}
	val, _ := s.ImagesByFallback.LoadOrStore(reason, &atomic.Int64{})
	val.(*atomic.Int64).Add(1)
}

// IncByContentType increments the counter for the content type.
func (s *Stats) IncByContentType(ct string) {
	if ct == "" {
		ct = "unknown"
	}
	val, _ := s.ByContentType.LoadOrStore(ct, &atomic.Int64{})
	val.(*atomic.Int64).Add(1)
}

// Snapshot returns an immutable copy of the counters for JSON serialization.
func (s *Stats) Snapshot() map[string]any {
	fallbacks := map[string]int64{}
	s.ImagesByFallback.Range(func(k, v any) bool {
		fallbacks[k.(string)] = v.(*atomic.Int64).Load()
		return true
	})

	types := map[string]int64{}
	s.ByContentType.Range(func(k, v any) bool {
		types[k.(string)] = v.(*atomic.Int64).Load()
		return true
	})

	in := s.BytesIn.Load()
	out := s.BytesOut.Load()

	var ratio float64
	if in > 0 {
		ratio = float64(out) / float64(in) * 100
	}

	return map[string]any{
		"total_requests":   s.TotalRequests.Load(),
		"image_requests":   s.ImageRequests.Load(),
		"text_requests":    s.TextRequests.Load(),
		"passthrough_reqs": s.PassthroughReqs.Load(),
		"images_processed": s.ImagesProcessed.Load(),
		"images_passthru":  s.ImagesPassthru.Load(),
		"fallbacks":        fallbacks,
		"bytes_in":         in,
		"bytes_out":        out,
		"bytes_saved":      s.BytesSaved.Load(),
		"ratio_percent":    ratio,
		"by_content_type":  types,
	}
}

// StatsHandler exposes the metrics in JSON.
func StatsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(globalStats.Snapshot())
}

// StatsResetHandler resets the counters. Useful during development. 
// DO NOT expose publicly in production.
func StatsResetHandler(w http.ResponseWriter, r *http.Request) {
	globalStats = &Stats{}
	w.WriteHeader(http.StatusNoContent)
}