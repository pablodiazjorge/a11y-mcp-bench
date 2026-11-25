// The PNG decoder of the captures of 2.4.7, on images built here with each of the five filters of
// PNG, and on the shapes that it refuses. A capture of Chromium is decoded in keyboard-walk.test.ts.

import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../src/adapters/playwright/png.ts';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(
    [...type].map((letter) => letter.charCodeAt(0)),
    4,
  );
  out.set(data, 8);
  // The checksum is not read by the decoder.
  return out;
}

interface Options {
  readonly width: number;
  readonly height: number;
  readonly channels: 3 | 4;
  readonly filter: number;
  readonly bitDepth?: number;
  readonly colorType?: number;
  readonly interlace?: number;
  readonly short?: boolean;
}

/** The pixel of each position: a pattern that every filter changes in its own way. */
const pixel = (x: number, y: number, channels: number): number[] =>
  [x * 40 + y * 3, 255 - y * 50, (x * y * 17) % 256, 200 - x * 10].slice(0, channels);

/** A PNG of the pattern, each row written with `filter`. */
function encode(options: Options): Uint8Array {
  const { width, height, channels, filter } = options;
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set(
    [
      options.bitDepth ?? 8,
      options.colorType ?? (channels === 4 ? 6 : 2),
      0,
      0,
      options.interlace ?? 0,
    ],
    8,
  );
  const stride = width * channels;
  const rows: number[] = [];
  let above = new Array<number>(stride).fill(0);
  for (let y = 0; y < height; y++) {
    const line = Array.from({ length: width }, (_, x) => pixel(x, y, channels)).flat();
    rows.push(filter);
    line.forEach((value, x) => {
      const left = x >= channels ? (line[x - channels] ?? 0) : 0;
      const up = above[x] ?? 0;
      const upLeft = x >= channels ? (above[x - channels] ?? 0) : 0;
      const estimate = left + up - upLeft;
      const paeth =
        Math.abs(estimate - left) <= Math.abs(estimate - up) &&
        Math.abs(estimate - left) <= Math.abs(estimate - upLeft)
          ? left
          : Math.abs(estimate - up) <= Math.abs(estimate - upLeft)
            ? up
            : upLeft;
      const predicted = [0, left, up, Math.floor((left + up) / 2), paeth][filter] ?? 0;
      rows.push((value - predicted) & 0xff);
    });
    above = line;
  }
  const raw = Uint8Array.from(rows);
  const data = deflateSync(options.short === true ? raw.subarray(0, raw.length / 2) : raw);
  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', data),
    chunk('IEND', new Uint8Array()),
  ];
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}

describe('decodePng', () => {
  it.each([0, 1, 2, 3, 4])('decodes the rows of filter %i, with and without alpha', (filter) => {
    for (const channels of [3, 4] as const) {
      const { width, height, data } = decodePng(encode({ width: 5, height: 4, channels, filter }));

      expect([width, height]).toStrictEqual([5, 4]);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 5; x++) {
          const expected = [...pixel(x, y, channels), ...(channels === 3 ? [255] : [])];
          expect([...data.subarray((y * 5 + x) * 4, (y * 5 + x) * 4 + 4)]).toStrictEqual(expected);
        }
      }
    }
  });

  it('refuses data that inflates to more than the image holds', () => {
    const png = encode({ width: 2, height: 2, channels: 3, filter: 0 });
    // The same header, with a megabyte of zeros as its data.
    const header = png.subarray(0, 8 + 25);
    const data = chunk('IDAT', deflateSync(new Uint8Array(1_000_000)));
    const bomb = Uint8Array.from([...header, ...data, ...chunk('IEND', new Uint8Array())]);

    expect(() => decodePng(bomb)).toThrow();
  });

  it('reads an image whose chunks end without IEND', () => {
    const png = encode({ width: 2, height: 2, channels: 4, filter: 1 });

    expect(decodePng(png.subarray(0, png.length - 12)).width).toBe(2);
  });

  it('refuses a header too short to hold the size', () => {
    const png = encode({ width: 2, height: 2, channels: 3, filter: 0 });
    const short = Uint8Array.from([...png.subarray(0, 8), ...chunk('IHDR', new Uint8Array(8))]);

    expect(() => decodePng(short)).toThrow();
  });

  it.each<[string, Uint8Array]>([
    ['not a PNG', Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9])],
    ['16 bits per channel', encode({ width: 2, height: 2, channels: 3, filter: 0, bitDepth: 16 })],
    ['a palette', encode({ width: 2, height: 2, channels: 3, filter: 0, colorType: 3 })],
    ['interlaced', encode({ width: 2, height: 2, channels: 3, filter: 0, interlace: 1 })],
    ['an unknown filter', encode({ width: 2, height: 2, channels: 3, filter: 5 })],
    ['short data', encode({ width: 4, height: 4, channels: 3, filter: 0, short: true })],
  ])('refuses %s', (_case, png) => {
    expect(() => decodePng(png)).toThrow();
  });
});
