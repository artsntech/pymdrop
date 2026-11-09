# --- Build stage ---
FROM golang:1.23-alpine AS builder

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY *.go ./

# Force amd64 architecture (most common on servers) and disable CGO for a static binary.
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-s -w" \
    -o pymdrop .

# --- Runtime stage ---
FROM alpine:3.19

# Install TLS certificates and create a non-root user
RUN apk add --no-cache ca-certificates && \
    adduser -D -u 10001 pymdrop

WORKDIR /app

COPY --from=builder /build/pymdrop .

# Grant execution permissions to the binary
RUN chmod +x /app/pymdrop

USER 10001

EXPOSE 8080

ENTRYPOINT ["/app/pymdrop"]
