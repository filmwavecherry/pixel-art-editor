# Architecture

## Stack
Plain HTML/CSS/JS — no build step, no frameworks, no bundler. Runs directly in the browser.

## Files
```
index.html    — page structure and DOM
style.css     — all styling
constants.js  — shared constants (fps range, file size limits, encode quality)
script.js     — all application logic
```

## Rendering pipeline
1. **Load** — image: draw to offscreen canvas → extract `Uint8ClampedArray`. Video: hidden `<video>` element, never added to DOM.
2. **Pixelate** — nearest-neighbor downscale: for each output block, sample the top-left source pixel. Result: small `ImageData`.
3. **Color correct** — brightness/contrast/temperature/tint (linear), saturation (HSL). Returns new `ImageData`.
4. **Quantize** (optional) — adaptive median-cut palette or named palette (Game Boy, Pico-8, CGA, NES). Each pixel mapped to nearest palette color via CIE Lab distance.
5. **Render** — draw corrected data to offscreen canvas → scale up to display size via `drawImage` with `imageSmoothingEnabled = false` → blit to main canvas.

Image mode caches pixelated data when pixel size unchanged. Video mode re-pixelates every frame (content always changes).

## Video playback
- RAF loop throttled by `targetInterval = 1000 / fps` with drift correction
- Each tick: `frameCtx.drawImage(videoEl)` → `getImageData` → pixelate → renderToCanvas
- Trim: video seeks to `trimStart` when `currentTime >= trimEnd`
- Click canvas to pause/play (suppressed if mouse moved > 4px during mousedown)

## MP4 export (WebCodecs)
- Uses native browser `VideoEncoder` API — no external libraries loaded at runtime
- `mp4-muxer` lazy-imported from jsDelivr CDN on first export
- Frame loop: seek to each timestamp → pixelate → color correct → quantize → draw to output canvas → `VideoFrame` → `encoder.encode()`
- Codec: H.264 High profile (`avc1.4d0028`), 4Mbps, H.264 requires even dimensions (padded if needed)
- Progress bar updates per frame

## Palette / quantization
- `PALETTES` constant: named palettes with limited/extended variants
- Adaptive palette: median-cut on pixelated frame data, vivid-color-biased representative selection per bucket
- Video mode: palette sampled from 8 frames across the trim range and cached to prevent per-frame flicker
- `getActivePalette()` returns the active palette array or null (no quantization)

## UI behavior
- Upload area detects MIME type on drop/select → routes to `loadImage()` or `loadVideo()`
- `#video-controls` hidden until a video is loaded; hidden again on "Change file"
- Shared sliders (pixel size, color, palette) always visible, work in both modes
- Reset button iterates `defaults` object — any key added to `defaults` resets automatically

## Zoom / pan
- CSS `transform: translate + scale` on canvas element, `transform-origin: 0 0`
- Zoom: logarithmic slider (0–100 → 0.5×–10×); also pinch-to-zoom via `wheel` + `ctrlKey`
- Pan: mouse drag on canvas container; two-finger scroll via `wheel` deltaX/deltaY

## Key constraints
- No pre-resize of source: always work at full native resolution
- `image-rendering: pixelated` on canvas prevents browser blurring
- Max clip duration: 30s (clamped at load)
- Max file size: 500MB
