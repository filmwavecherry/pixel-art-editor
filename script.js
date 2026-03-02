// --- State ---
let sourceWidth = 0;
let sourceHeight = 0;
let sourcePixels = null; // Uint8ClampedArray at full resolution

let pixelatedData = null; // cached ImageData at small size
let cachedPixelSize = -1;

// --- Video state ---
let videoEl = null, videoObjectURL = null;
let videoDuration = 0, videoMode = false; // videoDuration = full raw duration
let trimStart = 0, trimEnd = 0;
let rafId = null, lastFrameTime = 0, targetInterval = 1000 / DEFAULT_FPS;
let frameCanvas = null, frameCtx = null;
let trimDragMode = null, trimDragWindowOffset = 0;

const settings = {
  pixelSize: 8,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  fps: DEFAULT_FPS,
};

const defaults = {
  pixelSize: { slider: 40, value: 8 },
  brightness: { slider: 0, value: 0 },
  contrast: { slider: 0, value: 0 },
  saturation: { slider: 0, value: 0 },
  temperature: { slider: 0, value: 0 },
  tint: { slider: 0, value: 0 },
  fps: { slider: 38, value: DEFAULT_FPS },
};

// --- DOM refs ---
const uploadArea = document.getElementById('upload-area');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const app = document.getElementById('app');
const canvasContainer = document.getElementById('canvas-container');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const changeFileBtn = document.getElementById('change-image-btn');
const downloadBtn = document.getElementById('download-btn');
const playbackTrack = document.getElementById('playback-track');

// --- Zoom & pan state ---
let zoomLevel = 1.0;
let panX = 0, panY = 0;
const zoomDisplay = document.getElementById('zoom-display');

function applyTransform() {
  const cx = canvasContainer.clientWidth  / 2 + panX;
  const cy = canvasContainer.clientHeight / 2 + panY;
  const hw = canvas.width  / 2;
  const hh = canvas.height / 2;
  canvas.style.transform = `translate(${cx}px, ${cy}px) scale(${zoomLevel}) translate(${-hw}px, ${-hh}px)`;
}

const sliders = {
  pixelSize: document.getElementById('pixel-size'),
  brightness: document.getElementById('brightness'),
  contrast: document.getElementById('contrast'),
  saturation: document.getElementById('saturation'),
  temperature: document.getElementById('temperature'),
  tint: document.getElementById('tint'),
  fps: document.getElementById('fps-slider'),
};

const vals = {
  pixelSize: document.getElementById('pixel-size-val'),
  brightness: document.getElementById('brightness-val'),
  contrast: document.getElementById('contrast-val'),
  saturation: document.getElementById('saturation-val'),
  temperature: document.getElementById('temperature-val'),
  tint: document.getElementById('tint-val'),
  fps: document.getElementById('fps-val'),
};

// --- Upload dispatcher ---
function handleFileUpload(file) {
  if (!file) return;
  if (file.size / 1024 / 1024 > MAX_FILE_SIZE_MB) {
    alert(`File too large. Max ${MAX_FILE_SIZE_MB}MB.`);
    return;
  }
  if (file.type.startsWith('image/')) {
    resetVideoState();
    loadImage(file);
  } else if (file.type.startsWith('video/')) {
    resetImageState();
    loadVideo(file);
  } else {
    alert('Unsupported file type.');
  }
}

// --- Image loading ---
function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    sourceWidth = img.naturalWidth;
    sourceHeight = img.naturalHeight;

    const offscreen = document.createElement('canvas');
    offscreen.width = sourceWidth;
    offscreen.height = sourceHeight;
    const offCtx = offscreen.getContext('2d');
    offCtx.drawImage(img, 0, 0);
    sourcePixels = offCtx.getImageData(0, 0, sourceWidth, sourceHeight).data;

    URL.revokeObjectURL(url);

    pixelatedData = null;
    cachedPixelSize = -1;

    uploadArea.hidden = true;
    app.hidden = false;
    showVideoControls(false);
    changeFileBtn.textContent = 'Change file';
    downloadBtn.textContent = 'Download PNG';

    render();
  };
  img.src = url;
}

// --- Video loading ---
function loadVideo(file) {
  videoObjectURL = URL.createObjectURL(file);

  videoEl = document.createElement('video');
  videoEl.muted = true;
  videoEl.preload = 'auto';
  videoEl.src = videoObjectURL;

  // Re-render current frame on seek while paused
  videoEl.addEventListener('seeked', () => {
    if (videoEl.paused) renderVideoFrame();
  });

  videoEl.addEventListener('loadedmetadata', () => {
    videoDuration = videoEl.duration; // full, unclamped

    sourceWidth = videoEl.videoWidth;
    sourceHeight = videoEl.videoHeight;

    frameCanvas = document.createElement('canvas');
    frameCanvas.width = sourceWidth;
    frameCanvas.height = sourceHeight;
    frameCtx = frameCanvas.getContext('2d');

    trimStart = 0;
    trimEnd = Math.min(videoDuration, MAX_CLIP_DURATION_SEC);
    videoEl.currentTime = trimStart;

    videoMode = true;
    uploadArea.hidden = true;
    app.hidden = false;
    showVideoControls(true);
    changeFileBtn.textContent = 'Change file';
    downloadBtn.textContent = 'Download MP4';

    updatePlaybackBar();
    videoEl.play();
    startVideoLoop();
  });
}

// --- Reset state ---
function resetImageState() {
  sourcePixels = null;
  sourceWidth = 0;
  sourceHeight = 0;
  pixelatedData = null;
  cachedPixelSize = -1;
}

function resetVideoState() {
  stopVideoLoop();
  trimDragMode = null;
  if (videoEl) {
    videoEl.pause();
    videoEl.src = '';
    videoEl = null;
  }
  if (videoObjectURL) {
    URL.revokeObjectURL(videoObjectURL);
    videoObjectURL = null;
  }
  videoDuration = 0;
  videoMode = false;
  trimStart = 0;
  trimEnd = 0;
  frameCanvas = null;
  frameCtx = null;
}

// --- Pixelation ---
function pixelate() {
  const blockSize = settings.pixelSize;
  const outW = Math.floor(sourceWidth / blockSize);
  const outH = Math.floor(sourceHeight / blockSize);

  const out = new ImageData(outW, outH);
  const outData = out.data;

  for (let by = 0; by < outH; by++) {
    for (let bx = 0; bx < outW; bx++) {
      const i = (by * blockSize * sourceWidth + bx * blockSize) * 4;
      const outIdx = (by * outW + bx) * 4;
      outData[outIdx]     = sourcePixels[i];
      outData[outIdx + 1] = sourcePixels[i + 1];
      outData[outIdx + 2] = sourcePixels[i + 2];
      outData[outIdx + 3] = 255;
    }
  }

  return out;
}

// --- Color correction ---
function clamp(v) {
  return Math.max(0, Math.min(255, v));
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255),
  ];
}

function applyColorCorrection(imageData) {
  const { brightness, contrast, saturation, temperature, tint } = settings;
  const src = imageData.data;
  const out = new ImageData(imageData.width, imageData.height);
  const dst = out.data;
  const contrastFactor = (100 + contrast) / 100;
  const satFactor = (100 + saturation) / 100;
  const tempShift = temperature * 0.5;
  const tintShift = tint * 0.5;

  for (let i = 0; i < src.length; i += 4) {
    let r = src[i], g = src[i + 1], b = src[i + 2];

    r += brightness;
    g += brightness;
    b += brightness;

    r = (r - 128) * contrastFactor + 128;
    g = (g - 128) * contrastFactor + 128;
    b = (b - 128) * contrastFactor + 128;

    r += tempShift;
    b -= tempShift;

    g += tintShift;

    if (saturation !== 0) {
      const [h, s, l] = rgbToHsl(clamp(r), clamp(g), clamp(b));
      const newS = Math.min(Math.max(s * satFactor, 0), 1);
      [r, g, b] = hslToRgb(h, newS, l);
    }

    dst[i]     = clamp(r);
    dst[i + 1] = clamp(g);
    dst[i + 2] = clamp(b);
    dst[i + 3] = 255;
  }

  return out;
}

// --- Render (shared) ---
function renderToCanvas(pixData) {
  const corrected = applyColorCorrection(pixData);

  const small = document.createElement('canvas');
  small.width = corrected.width;
  small.height = corrected.height;
  small.getContext('2d').putImageData(corrected, 0, 0);

  const maxDisplay = 600;
  const aspect = corrected.width / corrected.height;
  let displayW, displayH;
  if (aspect >= 1) {
    displayW = Math.min(maxDisplay, corrected.width * settings.pixelSize);
    displayH = Math.round(displayW / aspect);
  } else {
    displayH = Math.min(maxDisplay, corrected.height * settings.pixelSize);
    displayW = Math.round(displayH * aspect);
  }

  canvas.width = displayW;
  canvas.height = displayH;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, displayW, displayH);
  applyTransform();
}

function render() {
  if (!sourcePixels) return;

  if (settings.pixelSize !== cachedPixelSize) {
    pixelatedData = pixelate();
    cachedPixelSize = settings.pixelSize;
  }

  renderToCanvas(pixelatedData);
}

// --- Video RAF loop ---
function rafLoop(now) {
  rafId = requestAnimationFrame(rafLoop);

  const elapsed = now - lastFrameTime;
  if (elapsed < targetInterval) return;
  lastFrameTime = now - (elapsed % targetInterval);

  if (!videoEl || videoEl.paused || videoEl.readyState < 2) return;

  if (videoEl.currentTime >= trimEnd) {
    videoEl.currentTime = trimStart;
    return;
  }

  renderVideoFrame();
}

function startVideoLoop() {
  if (rafId) return;
  lastFrameTime = 0;
  rafId = requestAnimationFrame(rafLoop);
}

function stopVideoLoop() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function renderVideoFrame() {
  if (!videoEl || !frameCtx) return;
  frameCtx.drawImage(videoEl, 0, 0);
  sourcePixels = frameCtx.getImageData(0, 0, sourceWidth, sourceHeight).data;
  const pixData = pixelate();
  renderToCanvas(pixData);
  updatePlaybackBar();
}

// --- Video UI helpers ---
function showVideoControls(show) {
  document.getElementById('video-controls').hidden = !show;
  document.getElementById('playback-bar').hidden = !show;
}

function formatTime(s) {
  s = Math.max(0, s);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// Updates the unified playback bar: trim window, playhead, time display
function updatePlaybackBar() {
  if (!videoEl || !videoDuration) return;

  const startPct = (trimStart / videoDuration) * 100;
  const endPct   = (trimEnd   / videoDuration) * 100;
  const nowPct   = Math.min(Math.max(videoEl.currentTime / videoDuration, 0), 1) * 100;

  document.getElementById('pb-trim-selection').style.left  = startPct + '%';
  document.getElementById('pb-trim-selection').style.width = (endPct - startPct) + '%';
  document.getElementById('pb-trim-start-handle').style.left = startPct + '%';
  document.getElementById('pb-trim-end-handle').style.left   = endPct + '%';
  document.getElementById('pb-playhead').style.left = nowPct + '%';

  const clipDur = trimEnd - trimStart;
  document.getElementById('playback-time').textContent =
    formatTime(Math.max(videoEl.currentTime - trimStart, 0)) + ' / ' + formatTime(clipDur);
  document.getElementById('playback-pause-btn').textContent = videoEl.paused ? '▶' : '⏸';
  document.getElementById('trim-time-display').textContent =
    formatTime(trimStart) + ' – ' + formatTime(trimEnd);
}

// --- FPS mapping ---
function sliderToFps(v) {
  return Math.round(MIN_FPS + (MAX_FPS - MIN_FPS) * (v / 100));
}

// --- Download (image) ---
function download() {
  if (!pixelatedData) return;

  const corrected = applyColorCorrection(pixelatedData);
  const blockSize = settings.pixelSize;
  const outW = corrected.width * blockSize;
  const outH = corrected.height * blockSize;

  const dl = document.createElement('canvas');
  dl.width = outW;
  dl.height = outH;
  const dlCtx = dl.getContext('2d');

  const small = document.createElement('canvas');
  small.width = corrected.width;
  small.height = corrected.height;
  small.getContext('2d').putImageData(corrected, 0, 0);

  dlCtx.imageSmoothingEnabled = false;
  dlCtx.drawImage(small, 0, 0, outW, outH);

  const link = document.createElement('a');
  link.download = 'pixel-art.png';
  link.href = dl.toDataURL('image/png');
  link.click();
}

// --- Download (video) ---
function showDownloadOverlay(show, text) {
  const overlay = document.getElementById('download-overlay');
  overlay.hidden = !show;
  if (text) document.getElementById('download-status-text').textContent = text;
}

function updateDownloadProgress(fraction) {
  document.getElementById('download-progress-bar-fill').style.width =
    Math.round(fraction * 100) + '%';
}

function seekTo(t) {
  return new Promise(resolve => {
    const onSeeked = () => { videoEl.removeEventListener('seeked', onSeeked); resolve(); };
    videoEl.addEventListener('seeked', onSeeked);
    videoEl.currentTime = t;
  });
}

async function downloadMp4() {
  if (!videoEl) return;

  if (typeof VideoEncoder === 'undefined') {
    alert('MP4 export requires WebCodecs (Chrome 94+). Try updating your browser.');
    return;
  }

  stopVideoLoop();
  showDownloadOverlay(true, 'Rendering frames...');

  try {
    const fps = settings.fps;
    const clipDuration = trimEnd - trimStart;
    const totalFrames = Math.max(1, Math.round(clipDuration * fps));

    const blockSize = settings.pixelSize;
    const pixW = Math.max(1, Math.floor(sourceWidth / blockSize));
    const pixH = Math.max(1, Math.floor(sourceHeight / blockSize));
    // H.264 requires even dimensions
    const outW = pixW * blockSize + (pixW * blockSize % 2);
    const outH = pixH * blockSize + (pixH * blockSize % 2);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext('2d');
    outCtx.imageSmoothingEnabled = false;

    const small = document.createElement('canvas');
    small.width = pixW;
    small.height = pixH;
    const smallCtx = small.getContext('2d');

    const { Muxer, ArrayBufferTarget } = await import(
      'https://cdn.jsdelivr.net/npm/mp4-muxer@5/build/mp4-muxer.mjs'
    );

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: 'avc', width: outW, height: outH },
      fastStart: 'in-memory',
    });

    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { throw e; },
    });

    encoder.configure({
      codec: 'avc1.4d0028', // H.264 High profile
      width: outW,
      height: outH,
      bitrate: 4_000_000,
      framerate: fps,
    });

    for (let i = 0; i < totalFrames; i++) {
      const t = Math.min(trimStart + i / fps, trimEnd - 1 / fps);
      await seekTo(t);

      frameCtx.drawImage(videoEl, 0, 0);
      sourcePixels = frameCtx.getImageData(0, 0, sourceWidth, sourceHeight).data;
      const pixData = pixelate();
      const corrected = applyColorCorrection(pixData);

      smallCtx.putImageData(corrected, 0, 0);
      outCtx.clearRect(0, 0, outW, outH);
      outCtx.drawImage(small, 0, 0, outW, outH);

      const timestamp = Math.round((i / fps) * 1_000_000); // microseconds
      const frame = new VideoFrame(outCanvas, { timestamp });
      encoder.encode(frame, { keyFrame: i % Math.max(1, fps * 2) === 0 });
      frame.close();

      updateDownloadProgress((i + 1) / totalFrames);
    }

    await encoder.flush();
    muxer.finalize();

    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = 'pixel-art.mp4';
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

  } catch (err) {
    console.error('MP4 export failed:', err);
    alert('MP4 export failed. See console for details.');
  } finally {
    showDownloadOverlay(false);
    if (videoEl) {
      videoEl.currentTime = trimStart;
      videoEl.play();
      startVideoLoop();
    }
  }
}

// --- Events ---
browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => handleFileUpload(fileInput.files[0]));

uploadArea.addEventListener('click', (e) => {
  if (e.target !== browseBtn) fileInput.click();
});

uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('drag-over');
});

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('drag-over');
});

uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('drag-over');
  handleFileUpload(e.dataTransfer.files[0]);
});

// Logarithmic mapping: slider 0–100 → pixel size 2–128
function sliderToPixelSize(v) {
  return Math.round(2 * Math.pow(64, v / 100));
}

let pixelSizeThrottleTimer = null;
sliders.pixelSize.addEventListener('input', () => {
  const size = sliderToPixelSize(parseInt(sliders.pixelSize.value, 10));
  settings.pixelSize = size;
  vals.pixelSize.textContent = size;
  if (pixelSizeThrottleTimer) return;
  pixelSizeThrottleTimer = setTimeout(() => {
    pixelSizeThrottleTimer = null;
    if (!videoMode) render();
    else if (videoEl && videoEl.paused) renderVideoFrame();
  }, 50);
});

['brightness', 'contrast', 'saturation', 'temperature', 'tint'].forEach(key => {
  sliders[key].addEventListener('input', () => {
    const v = parseInt(sliders[key].value, 10);
    settings[key] = v;
    vals[key].textContent = v;
    if (!videoMode) render();
    else if (videoEl && videoEl.paused) renderVideoFrame();
  });
});

sliders.fps.addEventListener('input', () => {
  const fps = sliderToFps(parseInt(sliders.fps.value, 10));
  settings.fps = fps;
  vals.fps.textContent = fps + ' fps';
  targetInterval = 1000 / fps;
});

downloadBtn.addEventListener('click', () => {
  if (videoMode) downloadMp4();
  else download();
});

document.getElementById('reset-btn').addEventListener('click', () => {
  Object.entries(defaults).forEach(([key, { slider, value }]) => {
    settings[key] = value;
    if (sliders[key]) sliders[key].value = slider;
    if (vals[key]) vals[key].textContent = key === 'fps' ? value + ' fps' : value;
  });
  targetInterval = 1000 / settings.fps;
  if (!videoMode) render();
  else if (videoEl && videoEl.paused) renderVideoFrame();
});

changeFileBtn.addEventListener('click', () => {
  stopVideoLoop();
  resetVideoState();
  resetImageState();
  showVideoControls(false);
  uploadArea.hidden = false;
  app.hidden = true;
  fileInput.value = '';
});

// --- Unified playback bar drag (trim handles + window slide + seek) ---
const minGap = 1 / DEFAULT_FPS;
const HANDLE_HIT_PX = 10;

function getTrackFraction(e) {
  const rect = playbackTrack.getBoundingClientRect();
  return Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
}

// --- Playback bar ---
document.getElementById('playback-pause-btn').addEventListener('click', () => {
  if (!videoEl) return;
  if (videoEl.paused) {
    videoEl.play();
    startVideoLoop();
  } else {
    videoEl.pause();
    stopVideoLoop();
  }
  updatePlaybackBar();
});

playbackTrack.addEventListener('mousedown', (e) => {
  if (!videoMode || !videoDuration) return;
  e.stopPropagation();

  const rect = playbackTrack.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const frac = x / rect.width;
  const startFrac = trimStart / videoDuration;
  const endFrac   = trimEnd   / videoDuration;
  const startPx   = startFrac * rect.width;
  const endPx     = endFrac   * rect.width;

  if (Math.abs(x - startPx) <= HANDLE_HIT_PX) {
    trimDragMode = 'start';
  } else if (Math.abs(x - endPx) <= HANDLE_HIT_PX) {
    trimDragMode = 'end';
  } else if (frac >= startFrac && frac <= endFrac) {
    trimDragMode = 'window';
    trimDragWindowOffset = frac - startFrac;
  } else {
    trimDragMode = 'seek';
    videoEl.currentTime = Math.min(Math.max(frac * videoDuration, 0), videoDuration);
    updatePlaybackBar();
  }
});

// --- Zoom ---
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;
const zoomSlider = document.getElementById('zoom-slider');

function sliderToZoom(v) {
  return 0.5 * Math.pow(20, v / 100);
}

function zoomToSlider(z) {
  return 100 * Math.log(z / 0.5) / Math.log(20);
}

function applyZoom(newZoom, originX, originY) {
  const cx = canvasContainer.clientWidth  / 2;
  const cy = canvasContainer.clientHeight / 2;
  const ox = originX ?? cx;
  const oy = originY ?? cy;

  const prevZoom = zoomLevel;
  zoomLevel = Math.min(Math.max(newZoom, MIN_ZOOM), MAX_ZOOM);

  const r = zoomLevel / prevZoom;
  panX = (ox - cx) * (1 - r) + panX * r;
  panY = (oy - cy) * (1 - r) + panY * r;

  zoomDisplay.textContent = Math.round(zoomLevel * 100) + '%';
  zoomSlider.value = zoomToSlider(zoomLevel);
  applyTransform();
}

document.getElementById('zoom-reset-btn').addEventListener('click', () => {
  panX = 0;
  panY = 0;
  applyZoom(1);
});

zoomSlider.addEventListener('input', (e) => {
  applyZoom(sliderToZoom(parseInt(e.target.value, 10)));
});

canvasContainer.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey) {
    const rect = canvasContainer.getBoundingClientRect();
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    const factor = Math.pow(0.99, e.deltaY);
    applyZoom(zoomLevel * factor, ox, oy);
  } else {
    panX -= e.deltaX;
    panY -= e.deltaY;
    applyTransform();
  }
}, { passive: false });

// --- Pan (drag) + click-to-pause ---
let isPanning = false;
let panMoved = false;
let panStartX = 0, panStartY = 0, panOriginX = 0, panOriginY = 0;

canvasContainer.addEventListener('mousedown', (e) => {
  isPanning = true;
  panMoved = false;
  panStartX = e.clientX;
  panStartY = e.clientY;
  panOriginX = panX;
  panOriginY = panY;
  canvasContainer.classList.add('panning');
});

window.addEventListener('mousemove', (e) => {
  if (trimDragMode) {
    const frac = getTrackFraction(e);
    const windowSize = trimEnd - trimStart;

    if (trimDragMode === 'start') {
      let t = frac * videoDuration;
      t = Math.max(0, Math.min(t, trimEnd - minGap));
      t = Math.max(t, trimEnd - MAX_CLIP_DURATION_SEC);
      trimStart = t;
      if (videoEl && videoEl.paused) videoEl.currentTime = trimStart;
    } else if (trimDragMode === 'end') {
      let t = frac * videoDuration;
      t = Math.min(videoDuration, Math.max(t, trimStart + minGap));
      t = Math.min(t, trimStart + MAX_CLIP_DURATION_SEC);
      trimEnd = t;
    } else if (trimDragMode === 'window') {
      let newStart = (frac - trimDragWindowOffset) * videoDuration;
      newStart = Math.max(0, Math.min(newStart, videoDuration - windowSize));
      trimStart = newStart;
      trimEnd = newStart + windowSize;
      if (videoEl && videoEl.paused) videoEl.currentTime = trimStart;
    } else if (trimDragMode === 'seek') {
      videoEl.currentTime = Math.min(Math.max(frac * videoDuration, 0), videoDuration);
    }

    updatePlaybackBar();
    return;
  }

  if (!isPanning) return;
  const dx = e.clientX - panStartX;
  const dy = e.clientY - panStartY;
  if (!panMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) panMoved = true;
  panX = panOriginX + dx;
  panY = panOriginY + dy;
  applyTransform();
});

window.addEventListener('mouseup', () => {
  if (trimDragMode) {
    trimDragMode = null;
    return;
  }

  if (!isPanning) return;
  isPanning = false;
  canvasContainer.classList.remove('panning');
  if (!panMoved && videoMode && videoEl) {
    if (videoEl.paused) {
      videoEl.play();
      startVideoLoop();
    } else {
      videoEl.pause();
      stopVideoLoop();
    }
    updatePlaybackBar();
  }
});
