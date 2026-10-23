package main

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"

	"github.com/gen2brain/webp"
)

type ProcessImageResult struct {
	Data        []byte
	ContentType string
	Fallback    string // "small", "no-gain", "too-large", "unsupported", "error", ""
}

func passthrough(data []byte, contentType, reason string) *ProcessImageResult {
	return &ProcessImageResult{
		Data:        data,
		ContentType: contentType,
		Fallback:    reason,
	}
}

// TransformImage decodes JPEG/PNG, optionally applies grayscale, and
// re-encodes to WebP. Returns the original when recompression is not worth it,
// EXCEPT when the user explicitly requested grayscale — in that case the
// conversion is always applied, even if the bytes slightly increase, because
// that's what the user asked for.
func TransformImage(
	inputData []byte,
	contentType string,
	quality int,
	toGrayscale bool,
	maxPixels int,
) (*ProcessImageResult, error) {

	var (
		cfg image.Config
		img image.Image
		err error
	)

	// Verify dimensions BEFORE decoding (protection against giant images).
	switch contentType {
	case "image/jpeg", "image/jpg":
		cfg, err = jpeg.DecodeConfig(bytes.NewReader(inputData))
	case "image/png":
		cfg, err = png.DecodeConfig(bytes.NewReader(inputData))
	default:
		return passthrough(inputData, contentType, "unsupported"), nil
	}

	if err != nil {
		return nil, err
	}

	// Anti "decompression bomb": Do not decode images above the limit..
	if maxPixels > 0 && cfg.Width*cfg.Height > maxPixels {
		return passthrough(inputData, contentType, "too-large"), nil
	}

	switch contentType {
	case "image/jpeg", "image/jpg":
		img, err = jpeg.Decode(bytes.NewReader(inputData))
	case "image/png":
		img, err = png.Decode(bytes.NewReader(inputData))
	}

	if err != nil {
		return nil, err
	}

	if quality < 1 {
		quality = 1
	}
	if quality > 100 {
		quality = 100
	}

	if toGrayscale {
		img = toGray(img)
	}

	var out bytes.Buffer

	err = webp.Encode(
		&out,
		img,
		webp.Options{
			Lossless: false,
			Quality:  quality,
		},
	)
	if err != nil {
		return nil, err
	}

	// If grayscale was NOT requested and the result is larger or equal,
	// serve the original. In grayscale, the user explicitly requested the
	// conversion — we respect it even if bytes slightly increase.
	if !toGrayscale && out.Len() >= len(inputData) {
		return passthrough(inputData, contentType, "no-gain"), nil
	}

	return &ProcessImageResult{
		Data:        out.Bytes(),
		ContentType: "image/webp",
	}, nil
}

// toGray convert to grayscale while preserving transparency (PNGs with alpha)..
func toGray(src image.Image) image.Image {
	b := src.Bounds()

	// Fast path: opaque images (JPEG, most PNGs).
	if o, ok := src.(interface{ Opaque() bool }); ok && o.Opaque() {
		gray := image.NewGray(b)
		draw.Draw(gray, b, src, b.Min, draw.Src)
		return gray
	}

	// Slow path: preserve the alpha channel (PNGs with transparency).
	out := image.NewNRGBA(b)

	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			c := color.NRGBAModel.Convert(src.At(x, y)).(color.NRGBA)
			l := uint8((19595*uint32(c.R) + 38470*uint32(c.G) + 7471*uint32(c.B) + 1<<15) >> 16)
			out.SetNRGBA(x, y, color.NRGBA{R: l, G: l, B: l, A: c.A})
		}
	}

	return out
}