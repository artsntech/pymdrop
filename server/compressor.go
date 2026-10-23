package main

import (
	"context"
	"fmt"
	"log"
	"runtime"
)

type Job struct {
	URL          string
	OriginalData []byte
	ContentType  string
	Quality      int
	Grayscale    bool
	ResultChan   chan Result
}

type Result struct {
	ProcessedData []byte
	ContentType   string
	Fallback      string
	Error         error
}

type CompressorPool struct {
	jobQueue   chan Job
	maxWorkers int
	maxPixels  int
}

func NewCompressorPool(queueSize int, maxPixels int) *CompressorPool {
	// Encoding WebP is CPU-bound work: more workers than ~2x cores
	// only increases memory usage without gaining throughput.
	workers := runtime.NumCPU() * 2
	if workers < 2 {
		workers = 2
	}

	return &CompressorPool{
		jobQueue:   make(chan Job, queueSize),
		maxWorkers: workers,
		maxPixels:  maxPixels,
	}
}

func (p *CompressorPool) Start(ctx context.Context) {
	for i := 0; i < p.maxWorkers; i++ {
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				case job := <-p.jobQueue:
					job.ResultChan <- p.process(job)
				}
			}
		}()
	}
}

// process never panics: a decoder crashing due to a corrupted 
// image must not bring down the entire server.
func (p *CompressorPool) process(job Job) (res Result) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("panic ao processar %s: %v", job.URL, r)
			res = Result{Error: fmt.Errorf("panic: %v", r)}
		}
	}()

	out, err := TransformImage(
		job.OriginalData,
		job.ContentType,
		job.Quality,
		job.Grayscale,
		p.maxPixels,
	)
	if err != nil {
		return Result{Error: err}
	}

	return Result{
		ProcessedData: out.Data,
		ContentType:   out.ContentType,
		Fallback:      out.Fallback,
	}
}