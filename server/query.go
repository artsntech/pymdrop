package main

import (
	"errors"
	"net/url"
	"strconv"
	"strings"
)

type proxyQuery struct {
	Target     *url.URL
	Quality    int
	Grayscale  bool
	BlockMedia bool
	Token      string
}

// parseProxyQuery Reads the query string of the request to /proxy.
// It supports two formats for the "url" parameter:
//
// 1. Raw and ALWAYS the last parameter (this is the format used by the 
// extension's declarativeNetRequest rules, which cannot encode the URL):
// /proxy?quality=50&grayscale=true&url=https://site.com/a.jpg?w=1&h=2
// Everything that comes after url= belongs to the destination URL.
//
// 2. Encoded (percent-encoding), in any position:
// /proxy?url=https%3A%2F%2Fsite.com%2Fa.jpg&quality=50
func parseProxyQuery(rawQuery string) (*proxyQuery, error) {
	rawTarget, params, err := splitTargetURL(rawQuery)
	if err != nil {
		return nil, err
	}

	target, err := url.Parse(rawTarget)
	if err != nil || target.Host == "" {
		return nil, errors.New("Invalid URL")
	}

	if target.Scheme != "http" && target.Scheme != "https" {
		return nil, errors.New("Only HTTP and HTTPS are supported.")
	}

	quality := 60
	if v := params.Get("quality"); v != "" {
		if n, convErr := strconv.Atoi(v); convErr == nil {
			quality = n
		}
	}
	if quality < 1 {
		quality = 1
	}
	if quality > 100 {
		quality = 100
	}

	return &proxyQuery{
		Target:     target,
		Quality:    quality,
		Grayscale:  params.Get("grayscale") == "true",
		BlockMedia: params.Get("block_media") == "true",
		Token:      params.Get("token"),
	}, nil
}

func splitTargetURL(rawQuery string) (string, url.Values, error) {
	idx := -1

	if strings.HasPrefix(rawQuery, "url=") {
		idx = 0
	} else if i := strings.Index(rawQuery, "&url="); i >= 0 {
		idx = i + 1
	}

	if idx < 0 {
		return "", nil, errors.New("URL missing")
	}

	head := strings.TrimSuffix(rawQuery[:idx], "&")
	rawTarget := rawQuery[idx+len("url="):]

	// ParseQuery always returns a non-null map; errors 
	// in isolated pairs are intentionally ignored.
	params, _ := url.ParseQuery(head)

	lower := strings.ToLower(rawTarget)
	if strings.HasPrefix(lower, "http%3a") || strings.HasPrefix(lower, "https%3a") {
		// Encoded format: the URL ends at the first '&'.
		encoded, rest := rawTarget, ""
		if i := strings.Index(rawTarget, "&"); i >= 0 {
			encoded, rest = rawTarget[:i], rawTarget[i+1:]
		}

		decoded, decodeErr := url.QueryUnescape(encoded)
		if decodeErr != nil {
			return "", nil, errors.New("Invalid URL")
		}

		rawTarget = decoded

		extra, _ := url.ParseQuery(rest)
		for k, v := range extra {
			params[k] = v
		}
	}

	return rawTarget, params, nil
}
