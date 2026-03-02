# Roadmap

## What I'm building
A web tool for turning images and videos into pixel art, with procedural animation effects for photos.

## Done: V1
Pixel art tool in the browser. Upload image, pixelate, adjust colors, download PNG.
- Nearest-neighbor pixelation (2–128px block size)
- Brightness, contrast, saturation, temperature, tint controls
- Color quantization with adaptive palette or named palettes (Game Boy, Pico-8, CGA, NES)
- Zoom + pan canvas

## Done: V2
Video pixelation support.
- Upload video → live pixelated preview via Canvas RAF loop
- Trim clip (dual-handle timeline, up to 30s)
- Framerate control (1–30 fps)
- Click canvas to pause/play
- Download as MP4 via WebCodecs
- Shared controls (pixel size, color correction, palette) work for both image and video

## Right now: V3
Procedural animation effects for photos (snow, rain, leaves, birds). Exportable as MP4.

Done when:
- At least one procedural effect (e.g. snow) plays on top of a pixelated photo
- User can export the result as MP4

## Later
- Object detection for context-aware effects (blinking lights, smoke)
- More environmental animation features

## Rules
- Finish the current version before starting the next one
- If it's not listed above, it's not in this version
