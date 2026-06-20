/**
 * Generates minimal Tauri icon assets for local development.
 * Replace with `npm run tauri icon path/to/your-logo.png` for production branding.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const iconsDir = join(root, "src-tauri", "icons");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function createSolidPng(size, r, g, b) {
  const row = Buffer.alloc(1 + size * 3);
  row[0] = 0;
  for (let x = 0; x < size; x++) {
    const o = 1 + x * 3;
    row[o] = r;
    row[o + 1] = g;
    row[o + 2] = b;
  }

  const raw = Buffer.alloc((1 + size * 3) * size);
  for (let y = 0; y < size; y++) {
    row.copy(raw, y * row.length);
  }

  const compressed = zlib.deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type);
    const crcBuf = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcBuf), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function createMinimalIco(png32) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry[0] = 32;
  entry[1] = 32;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png32.length, 8);
  entry.writeUInt32LE(22, 12);

  return Buffer.concat([header, entry, png32]);
}

mkdirSync(iconsDir, { recursive: true });

try {
  execSync("npx tauri icon public/oxidvault.svg -o src-tauri/icons", {
    cwd: root,
    stdio: "inherit",
  });
  console.log("Icons generated via Tauri CLI.");
} catch {
  const color = { r: 18, g: 20, b: 26 };
  const accent = { r: 59, g: 130, b: 246 };

  const png32 = createSolidPng(32, accent.r, accent.g, accent.b);
  const png128 = createSolidPng(128, color.r, color.g, color.b);
  const png256 = createSolidPng(256, color.r, color.g, color.b);

  writeFileSync(join(iconsDir, "32x32.png"), png32);
  writeFileSync(join(iconsDir, "128x128.png"), png128);
  writeFileSync(join(iconsDir, "128x128@2x.png"), png256);
  writeFileSync(join(iconsDir, "icon.ico"), createMinimalIco(png32));
  writeFileSync(join(iconsDir, "icon.icns"), png128);

  console.log("Fallback icons written to src-tauri/icons/");
}
