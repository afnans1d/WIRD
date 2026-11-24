import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function blend(dst, src, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  return [
    Math.round(lerp(dst[0], src[0], a)),
    Math.round(lerp(dst[1], src[1], a)),
    Math.round(lerp(dst[2], src[2], a)),
  ];
}

const PETAL_COLORS = [
  hexToRgb('#FDE68A'), // Warm yellow
  hexToRgb('#FCD5B5'), // Peach
  hexToRgb('#FAD2E1'), // Cotton candy pink
  hexToRgb('#DCD3F8'), // Lavender
  hexToRgb('#A8D5EE'), // Ocean blue
  hexToRgb('#BDEBD6'), // Mint
  hexToRgb('#C2E5B4'), // Green
  hexToRgb('#F9A89B'), // Coral
];

const BG_TOP = hexToRgb('#FBF5E6');
const BG_BOTTOM = hexToRgb('#ECE7FC');
const CENTER_FILL = hexToRgb('#FBF5E6');
const CENTER_RING = hexToRgb('#D6CBB8');
const CRESCENT_FILL = hexToRgb('#38286E');
const STAR_FILL = hexToRgb('#F8CE70');

function renderIcon(size, maskable = false) {
  const png = new PNG({ width: size, height: size });
  const cx = size / 2;
  const cy = size / 2;
  // Maskable icons keep artwork inside the central 72% safe zone
  const scale = maskable ? (size / 512) * 0.76 : size / 512;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      const tGrad = (x + y) / (2 * size);
      let color = [
        Math.round(lerp(BG_TOP[0], BG_BOTTOM[0], tGrad)),
        Math.round(lerp(BG_TOP[1], BG_BOTTOM[1], tGrad)),
        Math.round(lerp(BG_TOP[2], BG_BOTTOM[2], tGrad)),
      ];

      // Subtle warm glow top-left
      const dWarm = Math.hypot(x - size * 0.25, y - size * 0.25) / (size * 0.55);
      if (dWarm < 1) {
        color = blend(color, hexToRgb('#FDE68A'), (1 - dWarm) * 0.45);
      }

      // Subtle mint glow bottom-right
      const dMint = Math.hypot(x - size * 0.78, y - size * 0.78) / (size * 0.55);
      if (dMint < 1) {
        color = blend(color, hexToRgb('#BDEBD6'), (1 - dMint) * 0.42);
      }

      // Transform to 512x512 coordinate space centered at (0,0)
      const px = (x - cx) / scale;
      const py = (y - cy) / scale;

      // Draw 8 pastel petals
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        const cos = Math.cos(-angle);
        const sin = Math.sin(-angle);
        const rx = px * cos - py * sin;
        const ry = px * sin + py * cos;

        // Ellipse centered at (0, -94) with radii (34, 64)
        const ex = rx / 34;
        const ey = (ry + 94) / 64;
        const dist = Math.hypot(ex, ey);
        if (dist < 1.03) {
          const edgeAlpha = dist <= 0.97 ? 0.92 : Math.max(0, (1.03 - dist) / 0.06) * 0.92;
          color = blend(color, PETAL_COLORS[i], edgeAlpha);
        }
      }

      // Center circle radius 68 with subtle border
      const rCenter = Math.hypot(px, py);
      if (rCenter < 71) {
        if (rCenter >= 67) {
          const ringAlpha = rCenter <= 69.5 ? 1 : Math.max(0, (71 - rCenter) / 1.5);
          color = blend(color, CENTER_RING, ringAlpha);
        } else {
          color = blend(color, CENTER_FILL, 1);
        }
      }

      // Crescent inside center
      const dOuter = Math.hypot(px + 2, py);
      const dInner = Math.hypot(px - 10, py + 2);
      if (dOuter < 33 && dInner > 25) {
        const outerEdge = Math.min(1, Math.max(0, (33 - dOuter) / 1.5));
        const innerEdge = Math.min(1, Math.max(0, (dInner - 25) / 1.5));
        color = blend(color, CRESCENT_FILL, outerEdge * innerEdge);
      }

      // Star dot
      const dStar = Math.hypot(px - 20, py + 10);
      if (dStar < 7) {
        const starEdge = Math.min(1, Math.max(0, (7 - dStar) / 1.5));
        color = blend(color, STAR_FILL, starEdge);
      }

      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = 255;
    }
  }

  return PNG.sync.write(png);
}

const outDir = path.resolve('public');
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, 'pwa-192x192.png'), renderIcon(192, false));
fs.writeFileSync(path.join(outDir, 'pwa-512x512.png'), renderIcon(512, false));
fs.writeFileSync(path.join(outDir, 'pwa-maskable-512x512.png'), renderIcon(512, true));
fs.writeFileSync(path.join(outDir, 'apple-touch-icon.png'), renderIcon(180, false));
console.log('Generated PWA PNG icons in public/.');
