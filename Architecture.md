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
2. **Pixelate** — nearest-neighbor downscale with vivid color preservation: per-block, blend avg color toward most-chromatic pixel when chroma gap is large. Result: small `ImageData`.
3. **Color correct** — brightness/contrast/temperature/tint (linear), saturation (HSL). Returns new `ImageData`.
4. **Render** — draw corrected data to offscreen canvas → scale up to display size via `drawImage` with `imageSmoothingEnabled = false` → blit to main canvas.

Image mode caches pixelated data when pixel size unchanged. Video mode re-pixelates every frame (content always changes).

## Video playback
- RAF loop throttled by `targetInterval = 1000 / fps` with drift correction
- Each tick: `frameCtx.drawImage(videoEl)` → `getImageData` → pixelate → renderToCanvas
- Trim: video seeks to `trimStart` when `currentTime >= trimEnd`
- Click canvas to pause/play (suppressed if mouse moved > 4px during mousedown)

## MP4 export (ffmpeg.wasm)
- Lazy-loaded on first export: `@ffmpeg/ffmpeg@0.12.10` + `@ffmpeg/core@0.12.10`
- Single-threaded core (no SharedArrayBuffer / COOP-COEP headers needed)
- Files fetched via `toBlobURL` from jsDelivr CDN, loaded into ffmpeg worker as blob: URLs
- Frame extraction: seek to each timestamp → pixelate → color correct → scale up → `toBlob('image/png')` → write to ffmpeg virtual FS
- Encode: `libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart`
- Progress bar: 0–50% extraction, 50–100% ffmpeg encode (via `progress` event)

## UI behavior
- Upload area detects MIME type on drop/select → routes to `loadImage()` or `loadVideo()`
- `#video-controls` hidden until a video is loaded; hidden again on "Change file"
- Shared sliders (pixel size, color) always visible, work in both modes
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
