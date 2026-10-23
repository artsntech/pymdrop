package main

import (
	"fmt"
	"net"
	"net/http"
	"syscall"
	"time"
)

// Ranges that should never be accessible through the proxy (SSRF).
// Includes the GCP/AWS metadata server (169.254.169.254, link-local).
var blockedNets = mustParseCIDRs(
	"0.0.0.0/8",
	"100.64.0.0/10", // CGNAT
	"192.0.0.0/24",
	"198.18.0.0/15",
	"240.0.0.0/4",
)

func mustParseCIDRs(cidrs ...string) []*net.IPNet {
	nets := make([]*net.IPNet, 0, len(cidrs))
	for _, c := range cidrs {
		_, n, err := net.ParseCIDR(c)
		if err != nil {
			panic(err)
		}
		nets = append(nets, n)
	}
	return nets
}

func isBlockedIP(ip net.IP) bool {
	if ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() {
		return true
	}

	for _, n := range blockedNets {
		if n.Contains(ip) {
			return true
		}
	}

	return false
}

// newSafeTransport devolve um Transport que valida o IP *já resolvido* no
// momento da ligação. Isto cobre redirecionamentos e DNS rebinding, ao
// contrário de validar apenas o hostname recebido no pedido.
func newSafeTransport(allowPrivate bool) *http.Transport {
	dialer := &net.Dialer{
		Timeout:   8 * time.Second,
		KeepAlive: 30 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			if allowPrivate {
				return nil
			}

			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}

			ip := net.ParseIP(host)
			if ip == nil || isBlockedIP(ip) {
				return fmt.Errorf("destino bloqueado: %s", host)
			}

			return nil
		},
	}

	return &http.Transport{
		DialContext:           dialer.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   10,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   8 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
	}
}
