'use strict';

/**
 * Renders the HawHost icon (a rounded tile with three server bars) into
 *   assets/icon.png   256px, window + Linux
 *   assets/tray.ico   16/20/24/32px, system tray
 *   build/icon.ico    16…256px, installer and HawHost.exe
 * No image libraries: shapes are rasterised with 4x4 supersampling and
 * written as PNG (zlib) inside ICO containers.
 *
 *   node scripts/make-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------- PNG

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

// ---------------------------------------------------------------- drawing

function roundRectSdf(px, py, x, y, w, h, r) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const qx = Math.abs(px - cx) - (w / 2 - r);
  const qy = Math.abs(py - cy) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function mix(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

const TOP = [99, 102, 241];     // indigo-500
const BOTTOM = [14, 165, 233];  // sky-500
const BAR = [255, 255, 255];
const LED = [52, 211, 153];     // emerald-400

/** Colour + coverage at a point in unit space (0..1). */
function shade(u, v, small) {
  const layers = [];
  // background tile
  const tile = roundRectSdf(u, v, 0.02, 0.02, 0.96, 0.96, 0.22);
  if (tile <= 0) layers.push({ c: mix(TOP, BOTTOM, (u + v) / 2), a: 1 });
  // three server bars
  const bars = small ? [0.22, 0.44, 0.66] : [0.24, 0.43, 0.62];
  const barH = small ? 0.14 : 0.13;
  for (const by of bars) {
    const d = roundRectSdf(u, v, 0.2, by, 0.6, barH, barH / 2.4);
    if (d <= 0) layers.push({ c: BAR, a: 0.95 });
    const led = Math.hypot(u - 0.31, v - (by + barH / 2)) - (small ? 0.045 : 0.032);
    if (led <= 0) layers.push({ c: LED, a: 1 });
    if (!small) {
      for (const lx of [0.58, 0.66]) {
        const slot = roundRectSdf(u, v, lx, by + barH / 2 - 0.012, 0.055, 0.024, 0.012);
        if (slot <= 0) layers.push({ c: mix(TOP, BOTTOM, 0.5), a: 0.55 });
      }
    }
  }
  let c = [0, 0, 0];
  let a = 0;
  for (const l of layers) {
    c = mix(c, l.c, l.a);
    a = a + l.a * (1 - a);
  }
  return { c, a: layers.length ? Math.max(a, layers[0].a) : 0 };
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 4;
  const small = size <= 32;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const { c, a: al } = shade((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size, small);
          r += c[0] * al; g += c[1] * al; b += c[2] * al; a += al;
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      buf[i + 3] = Math.round((a / n) * 255);
      buf[i] = a ? Math.round(r / a) : 0;
      buf[i + 1] = a ? Math.round(g / a) : 0;
      buf[i + 2] = a ? Math.round(b / a) : 0;
    }
  }
  return png(size, buf);
}

fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });

fs.writeFileSync(path.join(ROOT, 'assets', 'icon.png'), render(256));
fs.writeFileSync(path.join(ROOT, 'assets', 'tray.png'), render(32));
fs.writeFileSync(path.join(ROOT, 'public', 'favicon.png'), render(64));
fs.writeFileSync(path.join(ROOT, 'assets', 'tray.ico'), ico([16, 20, 24, 32].map((s) => ({ size: s, data: render(s) }))));
fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((s) => ({ size: s, data: render(s) }))));
console.log('Icons written to assets/ and build/.');
