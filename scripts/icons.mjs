import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
await sharp('build/icon.svg').png().toFile('build/icon.png');
// ICO supports PNG payloads. Each directory entry points at one complete PNG.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(
  sizes.map((size) => sharp('build/icon.svg').resize(size, size).png().toBuffer()),
);
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((image, index) => {
  const start = 6 + index * 16;
  header[start] = sizes[index] % 256;
  header[start + 1] = sizes[index] % 256;
  header.writeUInt16LE(1, start + 4);
  header.writeUInt16LE(32, start + 6);
  header.writeUInt32LE(image.length, start + 8);
  header.writeUInt32LE(offset, start + 12);
  offset += image.length;
});
await writeFile('build/icon.ico', Buffer.concat([header, ...images]));
const icnsChunks = [];
for (const [tag, size] of [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
]) {
  const png = await sharp('build/icon.svg').resize(size, size).png().toBuffer();
  const chunk = Buffer.alloc(8);
  chunk.write(tag);
  chunk.writeUInt32BE(png.length + 8, 4);
  icnsChunks.push(chunk, png);
}
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns');
icnsHeader.writeUInt32BE(8 + icnsChunks.reduce((total, chunk) => total + chunk.length, 0), 4);
await writeFile('build/icon.icns', Buffer.concat([icnsHeader, ...icnsChunks]));
