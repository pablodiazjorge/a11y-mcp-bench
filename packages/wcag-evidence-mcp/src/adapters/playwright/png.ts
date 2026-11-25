import { inflateSync } from 'node:zlib';
import type { Frame } from '../../core/browser.ts';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * Decodes the PNG of a screenshot into RGBA bytes, for the pixel comparison of 2.4.7. Decoded here
 * with Node's zlib, so that no package is added for it. Chromium writes 8 bits per channel, in
 * color, with or without alpha, and not interlaced; anything else throws, since this decoder reads
 * nothing else.
 */
export function decodePng(png: Uint8Array): Frame {
  if (SIGNATURE.some((byte, index) => png[index] !== byte)) throw new Error('not a PNG');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let width = 0;
  let height = 0;
  let header: Uint8Array | undefined;
  const data: Uint8Array[] = [];
  for (let offset = SIGNATURE.length; offset + 8 <= png.length;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    const body = png.subarray(start, start + length);
    // Each chunk is its length, its type, its data and a checksum of 4 bytes.
    offset = start + length + 4;
    if (type === 'IHDR' && length >= 13) {
      header = body;
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      break;
    }
  }
  const [bitDepth, colorType, , , interlace] = header?.subarray(8) ?? [];
  if (header === undefined || bitDepth !== 8 || interlace !== 0)
    throw new Error('an unexpected PNG');
  if (colorType !== 2 && colorType !== 6) throw new Error('an unexpected PNG');
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  // A capture inflates to exactly this; more would be a page of zeros sent to fill the memory.
  const raw = inflateSync(Buffer.concat(data), { maxOutputLength: height * (stride + 1) });
  if (raw.length < height * (stride + 1)) throw new Error('a short PNG');
  const pixels = new Uint8Array(width * height * 4);
  let above = new Uint8Array(stride);
  let line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    for (let x = 0; x < stride; x++) {
      const value = raw[start + 1 + x] ?? 0;
      const left = x >= channels ? (line[x - channels] ?? 0) : 0;
      const up = above[x] ?? 0;
      const upLeft = x >= channels ? (above[x - channels] ?? 0) : 0;
      line[x] = (value + predict(filter, left, up, upLeft)) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const to = (y * width + x) * 4;
      const from = x * channels;
      pixels[to] = line[from] ?? 0;
      pixels[to + 1] = line[from + 1] ?? 0;
      pixels[to + 2] = line[from + 2] ?? 0;
      pixels[to + 3] = channels === 4 ? (line[from + 3] ?? 0) : 255;
    }
    [above, line] = [line, above];
  }
  return { width, height, data: pixels };
}

/** The value that a PNG filter adds back to a byte, from its neighbors to the left and above. */
function predict(filter: number | undefined, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return Math.floor((left + up) / 2);
    case 4: {
      const estimate = left + up - upLeft;
      const toLeft = Math.abs(estimate - left);
      const toUp = Math.abs(estimate - up);
      const toUpLeft = Math.abs(estimate - upLeft);
      if (toLeft <= toUp && toLeft <= toUpLeft) return left;
      return toUp <= toUpLeft ? up : upLeft;
    }
    default:
      throw new Error('an unexpected PNG filter');
  }
}
