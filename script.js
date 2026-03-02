// --- State ---
let sourceWidth = 0;
let sourceHeight = 0;
let sourcePixels = null; // Uint8ClampedArray at full resolution

let pixelatedData = null; // cached ImageData at small size
let cachedPixelSize = -1;

const settings = {
  pixelSize: 8,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
};

const defaults = {
  pixelSize: { slider: 40, value: 8 },
  brightness: { slider: 0, value: 0 },
  contrast: { slider: 0, value: 0 },
  saturation: { slider: 0, value: 0 },
  temperature: { slider: 0, value: 0 },
  tint: { slider: 0, value: 0 },
};

// --- DOM refs ---
const uploadArea = document.getElementById('upload-area');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const app = document.getElementById('app');
const canvasContainer = document.getElementById('canvas-container');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// --- Zoom & pan state ---
let zoomLevel = 1.0;
let panX = 0, panY = 0;
const zoomDisplay = document.getElementById('zoom-display');

function applyTransform() {
  const cx = canvasContainer.clientWidth  / 2 + panX;
  const cy = canvasContainer.clientHeight / 2 + panY;
  const hw = canvas.width  / 2;
  const hh = canvas.height / 2;
  // translate to container center, scale, then offset by half canvas size
  // result: canvas center sits at container center, zoom scales from there
  canvas.style.transform = `translate(${cx}px, ${cy}px) scale(${zoomLevel}) translate(${-hw}px, ${-hh}px)`;
}

const sliders = {
  pixelSize: document.getElementById('pixel-size'),
  brightness: document.getElementById('brightness'),
  contrast: document.getElementById('contrast'),
  saturation: document.getElementById('saturation'),
  temperature: document.getElementById('temperature'),
  tint: document.getElementById('tint'),
};

const vals = {
  pixelSize: document.getElementById('pixel-size-val'),
  brightness: document.getElementById('brightness-val'),
  contrast: document.getElementById('contrast-val'),
  saturation: document.getElementById('saturation-val'),
  temperature: document.getElementById('temperature-val'),
  tint: document.getElementById('tint-val'),
};

// --- Image loading ---
function loadImage(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    sourceWidth = img.naturalWidth;
    sourceHeight = img.naturalHeight;

    // Extract full-resolution pixel data
    const offscreen = document.createElement('canvas');
    offscreen.width = sourceWidth;
    offscreen.height = sourceHeight;
    const offCtx = offscreen.getContext('2d');
    offCtx.drawImage(img, 0, 0);
    sourcePixels = offCtx.getImageData(0, 0, sourceWidth, sourceHeight).data;

    URL.revokeObjectURL(url);

    // Reset cache and show UI
    pixelatedData = null;
    cachedPixelSize = -1;

    uploadArea.hidden = true;
    app.hidden = false;

    render();
  };
  img.src = url;
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
      let sumR = 0, sumG = 0, sumB = 0;
      let maxChroma = 0;
      let vividR = 0, vividG = 0, vividB = 0;
      let count = 0;

      const srcStartX = bx * blockSize;
      const srcStartY = by * blockSize;

      for (let py = 0; py < blockSize; py++) {
        for (let px = 0; px < blockSize; px++) {
          const sx = srcStartX + px;
          const sy = srcStartY + py;
          if (sx >= sourceWidth || sy >= sourceHeight) continue;

          const i = (sy * sourceWidth + sx) * 4;
          const r = sourcePixels[i];
          const g = sourcePixels[i + 1];
          const b = sourcePixels[i + 2];

          sumR += r;
          sumG += g;
          sumB += b;

          const chroma = Math.max(r, g, b) - Math.min(r, g, b);
          if (chroma > maxChroma) {
            maxChroma = chroma;
            vividR = r;
            vividG = g;
            vividB = b;
          }
          count++;
        }
      }

      const avgR = sumR / count;
      const avgG = sumG / count;
      const avgB = sumB / count;

      const avgChroma = Math.max(avgR, avgG, avgB) - Math.min(avgR, avgG, avgB);
      const blendFactor = Math.min(Math.max((maxChroma - avgChroma) / 80, 0), 1);

      const outIdx = (by * outW + bx) * 4;
      outData[outIdx]     = Math.round(avgR + (vividR - avgR) * blendFactor);
      outData[outIdx + 1] = Math.round(avgG + (vividG - avgG) * blendFactor);
      outData[outIdx + 2] = Math.round(avgB + (vividB - avgB) * blendFactor);
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

// --- Render ---
function render() {
  if (!sourcePixels) return;

  if (settings.pixelSize !== cachedPixelSize) {
    pixelatedData = pixelate();
    cachedPixelSize = settings.pixelSize;
  }

  const corrected = applyColorCorrection(pixelatedData);

  const small = document.createElement('canvas');
  small.width = corrected.width;
  small.height = corrected.height;
  small.getContext('2d').putImageData(corrected, 0, 0);

  // Scale to fit 600×600 display
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

// --- Download ---
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

// --- Events ---
browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => loadImage(fileInput.files[0]));

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
  loadImage(e.dataTransfer.files[0]);
});

// Logarithmic mapping: slider 0–100 → pixel size 2–64
function sliderToPixelSize(v) {
  return Math.round(2 * Math.pow(32, v / 100));
}

let pixelSizeThrottleTimer = null;
sliders.pixelSize.addEventListener('input', () => {
  const size = sliderToPixelSize(parseInt(sliders.pixelSize.value, 10));
  settings.pixelSize = size;
  vals.pixelSize.textContent = size;
  if (pixelSizeThrottleTimer) return;
  pixelSizeThrottleTimer = setTimeout(() => {
    pixelSizeThrottleTimer = null;
    render();
  }, 50);
});

['brightness', 'contrast', 'saturation', 'temperature', 'tint'].forEach(key => {
  sliders[key].addEventListener('input', () => {
    const v = parseInt(sliders[key].value, 10);
    settings[key] = v;
    vals[key].textContent = v;
    render();
  });
});

document.getElementById('download-btn').addEventListener('click', download);

document.getElementById('reset-btn').addEventListener('click', () => {
  Object.entries(defaults).forEach(([key, { slider, value }]) => {
    settings[key] = value;
    sliders[key].value = slider;
    vals[key].textContent = value;
  });
  render();
});

document.getElementById('change-image-btn').addEventListener('click', () => {
  uploadArea.hidden = false;
  app.hidden = true;
});

// --- Zoom ---
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;
const zoomSlider = document.getElementById('zoom-slider');

// Slider 0–100 → zoom 50%–1000% (very logarithmic). At v=23 → ~100%.
function sliderToZoom(v) {
  return 0.5 * Math.pow(20, v / 100);
}

function zoomToSlider(z) {
  return 100 * Math.log(z / 0.5) / Math.log(20);
}

function applyZoom(newZoom, originX, originY) {
  // originX/Y: screen point to zoom toward (defaults to container center)
  const cx = canvasContainer.clientWidth  / 2;
  const cy = canvasContainer.clientHeight / 2;
  const ox = originX ?? cx;
  const oy = originY ?? cy;

  const prevZoom = zoomLevel;
  zoomLevel = Math.min(Math.max(newZoom, MIN_ZOOM), MAX_ZOOM);

  // Adjust pan so the point under the cursor stays fixed
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
    // Pinch to zoom — ctrlKey is how macOS trackpad sends pinch gestures
    const rect = canvasContainer.getBoundingClientRect();
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    const factor = Math.pow(0.99, e.deltaY);
    applyZoom(zoomLevel * factor, ox, oy);
  } else {
    // Two-finger scroll to pan
    panX -= e.deltaX;
    panY -= e.deltaY;
    applyTransform();
  }
}, { passive: false });

// --- Pan (drag) ---
let isPanning = false;
let panStartX = 0, panStartY = 0, panOriginX = 0, panOriginY = 0;

canvasContainer.addEventListener('mousedown', (e) => {
  isPanning = true;
  panStartX = e.clientX;
  panStartY = e.clientY;
  panOriginX = panX;
  panOriginY = panY;
  canvasContainer.classList.add('panning');
});

window.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  panX = panOriginX + (e.clientX - panStartX);
  panY = panOriginY + (e.clientY - panStartY);
  applyTransform();
});

window.addEventListener('mouseup', () => {
  if (!isPanning) return;
  isPanning = false;
  canvasContainer.classList.remove('panning');
});
