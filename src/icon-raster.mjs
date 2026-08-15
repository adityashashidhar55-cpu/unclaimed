/**
 * The app icon, rasterised to PNG without a rasteriser.
 *
 * Why this file exists: `<link rel="apple-touch-icon">` must point at a PNG.
 * Safari ignores SVG there, so an SVG-only icon set means every iPhone that
 * adds the site to its home screen gets a grey screenshot of the page instead
 * of a logo. The site is otherwise dependency-free and the npm registry is
 * unreachable from this sandbox, so `sharp` and `resvg` are not options.
 *
 * A full SVG renderer would be absurd here. The icon is three shapes — a
 * background, a ring, and a tick — so this draws those three shapes directly
 * with signed distance fields and 3× supersampling, then deflates the result
 * into a PNG with the zlib that ships with Node. The output is byte-identical
 * across runs, so it does not churn the diff on every build.
 */
import zlib from 'node:zlib';

/* -- palette, kept in step with theme.css ------------------------------- */
const INK = [0x0f, 0x3d, 0x47]; // deep teal, the icon background
const INK_2 = [0x12, 0x5a, 0x63]; // the lit corner of the gradient
const RING = [0x4f, 0xd1, 0xc5]; // turquoise ring
const TICK = [0xff, 0xff, 0xff];

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Distance from p to the segment ab — the whole tick is two of these. */
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : clamp01((wx * vx + wy * vy) / len2);
  const dx = wx - vx * t;
  const dy = wy - vy * t;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * One pixel of the icon, at one supersample position, in RGB.
 * Coordinates are normalised 0..1 so the same maths draws every size.
 */
function shade(u, v) {
  /* Background: a soft diagonal lift so the icon does not read as a flat
     square at 40px on a home screen. */
  const lift = clamp01(1 - Math.hypot(u - 0.3, v - 0.12) / 0.95);
  let rgb = mix(INK, INK_2, lift * lift);

  const cx = 0.5;
  const cy = 0.5;
  const d = Math.hypot(u - cx, v - cy);

  /* Ring: an annulus at r=0.27, stroke 0.055, so half-width 0.0275. */
  const ringA = clamp01((0.0275 - Math.abs(d - 0.27)) / 0.004 + 0.5);
  if (ringA > 0) rgb = mix(rgb, RING, ringA);

  /* Tick: two segments with round joins, same geometry as the SVG. */
  const t1 = segDist(u, v, cx - 0.115, cy + 0.005, cx - 0.04, cy + 0.09);
  const t2 = segDist(u, v, cx - 0.04, cy + 0.09, cx + 0.12, cy - 0.085);
  const tickA = clamp01((0.0275 - Math.min(t1, t2)) / 0.004 + 0.5);
  if (tickA > 0) rgb = mix(rgb, TICK, tickA);

  return rgb;
}

/** Raw RGB pixels, 3× supersampled. */
function raster(size) {
  const SS = 3;
  const px = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 3;
      px[i] = Math.round(r / n);
      px[i + 1] = Math.round(g / n);
      px[i + 2] = Math.round(b / n);
    }
  }
  return px;
}

/* -- PNG container ------------------------------------------------------ */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A square PNG of the app icon, `size` pixels on a side. */
export function iconPng(size) {
  const px = raster(size);

  /* Filter byte 0 (None) per scanline. The image is smooth gradients and two
     hard shapes; Paeth would compress a little better and cost readability. */
  const rows = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 3 + 1)] = 0;
    px.copy(rows, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
