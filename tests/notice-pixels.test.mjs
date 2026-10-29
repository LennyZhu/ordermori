import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { inspectNoticePixels, pngCrc } from '../src/domain/noticePixels.ts';

function chunk(type, data) {
  const name = Buffer.from(type), result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE((pngCrc(Buffer.concat([name, data])) ^ 0xffffffff) >>> 0, data.length + 8); return result;
}
function syntheticPng({ blank = false, tailBlank = false, channels = 4, depth = 8, filtered = false } = {}) {
  const width = 1080, height = 40, step = depth / 8, bpp = channels * step, stride = width * bpp;
  const raw = Buffer.alloc(height * (stride + 1)); let previous = Buffer.alloc(stride);
  const paeth = (a,b,c) => { const p = a+b-c, x = Math.abs(p-a), y = Math.abs(p-b), z = Math.abs(p-c); return x <= y && x <= z ? a : y <= z ? b : c; };
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(stride, 255);
    if (!blank && (y >= 2 && y < 8 || !tailBlank && y >= 25 && y < 34)) for (let x = 40; x < 80; x++) for (let c = 0; c < Math.min(3, channels); c++) { row[x * bpp + c * step] = 32; if (step === 2) row[x * bpp + c * step + 1] = 32; }
    const filter = filtered ? y % 5 : 0; raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? row[i-bpp] : 0, up = previous[i], corner = i >= bpp ? previous[i-bpp] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left+up)/2) : paeth(left,up,corner);
      raw[y * (stride + 1) + 1 + i] = (row[i] - predictor) & 255;
    }
    previous = row;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8] = depth; header[9] = channels === 4 ? 6 : 2;
  const compressed = deflateSync(raw); const middle = Math.ceil(compressed.length / 2);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',header), chunk('IDAT',compressed.subarray(0,middle)), chunk('IDAT',compressed.subarray(middle)), chunk('IEND',Buffer.alloc(0))]);
}
const regions = [{ label: '首項商品', top: 2, bottom: 8 }, { label: '末項商品及頁尾', top: 25, bottom: 34 }];
const check = (png) => inspectNoticePixels(async (offset, size) => png.subarray(offset, offset + size), png.length, regions);
test('PNG streaming probes decode all five row filters in RGB/RGBA 8/16-bit without a full bitmap allocation', async () => {
  assert.equal((pngCrc(Buffer.from('123456789')) ^ 0xffffffff) >>> 0, 0xcbf43926);
  for (const channels of [3,4]) for (const depth of [8,16]) for (const filtered of [false,true]) {
    const result = await check(syntheticPng({ channels, depth, filtered })); assert.deepEqual(result, { width: 1080, height: 40, checkedRegions: 2 });
  }
});
test('dimension-correct blank and partially clipped captures are rejected by pixel coverage, not just IHDR size', async () => {
  await assert.rejects(check(syntheticPng({ blank: true })), /空白圖片/);
  await assert.rejects(check(syntheticPng({ tailBlank: true })), /末項商品及頁尾/);
});
test('corrupted chunks and truncated PNG streams fail safely', async () => {
  const png = syntheticPng(); const corrupt = Buffer.from(png); corrupt[corrupt.length-1] ^= 1;
  await assert.rejects(check(corrupt), /完整性校驗失敗/); await assert.rejects(check(png.subarray(0,png.length-4)));
});
