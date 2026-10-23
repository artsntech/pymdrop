# Architecture Decisions

This document explains *why* PymDrop was built the way it was, and the alternatives considered.

---

## Why `declarativeNetRequest` instead of `webRequest`?

In Manifest V2, extensions used `webRequest.onBeforeRequest` with `blocking` to intercept and modify requests. Manifest V3 removed this for privacy and performance reasons.

**The Solution:** `declarativeNetRequest` (DNR). Rules are compiled by the browser and applied *before* the request leaves the network stack. The redirect is resolved in C++.

**Trade-offs:**
* **Pro:** Blazing fast. The original image is never downloaded, saving bandwidth at the network level.
* **Con:** The extension cannot read the image content. It calculates saved bytes by observing the proxy's response headers (`X-Original-Size`, `X-Compressed-Size`) via the non-blocking `webRequest.onHeadersReceived`.

---

## Why Go for the Server?

**Alternatives considered:**
* **Node.js / Python:** Blocked by the event loop / GIL. Image encoding is CPU-bound; these would struggle under concurrent load.
* **Rust:** Excellent, but slower to develop and compile.
* **Go:** Chosen. It compiles to a single binary (perfect for Docker/Cloud Run), has a great concurrency model, and the `gen2brain/webp` library allows native WebP encoding without CGO.

**The Worker Pool:**
`compressor.go` spawns `2 × NumCPU` workers. Why 2x? Because WebP encoding has I/O wait times. 2x is the empirical sweet spot for throughput without blowing up memory usage.

---

## Image Processing Pipeline

```text
DecodeConfig ──> (Check Dimensions) ──> Decode ──> toGray (optional) ──> WebP ──> Compare
```

* **Decompression Bombs:** We check the image header dimensions *before* decoding. If `width × height > 40,000,000`, we pass through. This prevents a 50KB PNG from exhausting 10GB of RAM.
* **Grayscale:** Fast path for opaque images (`image.Gray`), slow path for alpha PNGs (preserves transparency).
* **Why not AVIF?** AVIF saves 30% more bytes, but encoding is 10x slower (seconds per image) and requires complex CGO builds. WebP is the right balance for this use case.

---

## Security Protections

* **SSRF (Server-Side Request Forgery):** `netguard.go` blocks loopback, private IPs, CGNAT, and cloud metadata endpoints (like `169.254.169.254`). This is checked at the `DialContext` level, meaning the IP is validated *after* DNS resolution. This blocks DNS rebinding attacks and malicious redirects.
* **Loops:** The DNR rule excludes the proxy's own domain, preventing infinite redirect loops.
* **Optional Token:** If `PYMDROP_TOKEN` is set, requests require `?token=...` using constant-time comparison to prevent timing attacks.