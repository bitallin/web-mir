/**
 * Minimal pixel canvas and PNG encoder shared by the placeholder asset
 * generators. Output is deterministic: the same drawing calls always produce
 * the same bytes, so regenerating a clean tree is a no-op diff.
 */
import { deflateSync } from 'node:zlib';

export type Rgba = readonly [number, number, number, number];

export const OPAQUE = 255;

export function rgb(hex: number): Rgba {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff, OPAQUE];
}

export class Raster {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 4);
  }

  pixel(x: number, y: number, color: Rgba): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return;
    }
    const offset = (y * this.width + x) * 4;
    this.data[offset] = color[0];
    this.data[offset + 1] = color[1];
    this.data[offset + 2] = color[2];
    this.data[offset + 3] = color[3];
  }

  rect(x: number, y: number, width: number, height: number, color: Rgba): void {
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        this.pixel(x + column, y + row, color);
      }
    }
  }

  /** Filled ellipse anchored at its centre; used for tails, staffs and heads. */
  ellipse(centerX: number, centerY: number, radiusX: number, radiusY: number, color: Rgba): void {
    for (let y = -radiusY; y <= radiusY; y += 1) {
      for (let x = -radiusX; x <= radiusX; x += 1) {
        const normX = radiusX === 0 ? 0 : x / (radiusX + 0.5);
        const normY = radiusY === 0 ? 0 : y / (radiusY + 0.5);
        if (normX * normX + normY * normY <= 1) {
          this.pixel(centerX + x, centerY + y, color);
        }
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, color: Rgba): void {
    let x = x0;
    let y = y0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const stepX = x0 < x1 ? 1 : -1;
    const stepY = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      this.pixel(x, y, color);
      if (x === x1 && y === y1) {
        return;
      }
      const doubled = error * 2;
      if (doubled >= dy) {
        error += dy;
        x += stepX;
      }
      if (doubled <= dx) {
        error += dx;
        y += stepY;
      }
    }
  }

  mirrorFrom(source: Raster): void {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const from = (y * this.width + (this.width - 1 - x)) * 4;
        const to = (y * this.width + x) * 4;
        this.data[to] = source.data[from] ?? 0;
        this.data[to + 1] = source.data[from + 1] ?? 0;
        this.data[to + 2] = source.data[from + 2] ?? 0;
        this.data[to + 3] = source.data[from + 3] ?? 0;
      }
    }
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([typeBytes, Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload), 0);
  return Buffer.concat([length, payload, crc]);
}

export function encodePng(raster: Raster): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(raster.width, 0);
  header.writeUInt32BE(raster.height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = raster.width * 4;
  const raw = Buffer.alloc((stride + 1) * raster.height);
  for (let y = 0; y < raster.height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(raster.data.buffer, raster.data.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', new Uint8Array()),
  ]);
}
