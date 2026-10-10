import { expect, test, type Page } from '@playwright/test';
import { encodePng } from '../scripts/png.mjs';

export const IMAGE_W = 400;
export const IMAGE_H = 300;
/** The test image: a red disk (radius 90) in the middle of a flat green background. */
export const DISK = { x: 200, y: 150, r: 90 };

export function testImage(): Buffer {
  const rgba = new Uint8Array(IMAGE_W * IMAGE_H * 4);
  for (let y = 0; y < IMAGE_H; y++) {
    for (let x = 0; x < IMAGE_W; x++) {
      const inDisk = (x - DISK.x) ** 2 + (y - DISK.y) ** 2 <= DISK.r ** 2;
      rgba.set(inDisk ? [220, 40, 40, 255] : [30, 170, 70, 255], (y * IMAGE_W + x) * 4);
    }
  }
  return encodePng(IMAGE_W, IMAGE_H, rgba);
}

/** Open the test image through the real "Choose image" button and file picker. */
export async function openTestImage(page: Page): Promise<void> {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose image' }).click();
  await (await chooser).setFiles({ name: 'disk.png', mimeType: 'image/png', buffer: testImage() });
  await expect(page.getByRole('img', { name: 'Image editor' })).toBeVisible();
}

/** Screen position of an image pixel, using the viewer's initial fit (24 px padding, centred). */
export async function toScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = (await page.getByRole('img', { name: 'Image editor' }).boundingBox())!;
  const scale = Math.min((box.width - 48) / IMAGE_W, (box.height - 48) / IMAGE_H);
  return {
    x: box.x + (box.width - IMAGE_W * scale) / 2 + x * scale,
    y: box.y + (box.height - IMAGE_H * scale) / 2 + y * scale,
  };
}

/** Tap an image pixel: a touch tap on touch devices, a click otherwise. */
export async function tapImage(page: Page, x: number, y: number): Promise<void> {
  const p = await toScreen(page, x, y);
  if (test.info().project.use.hasTouch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

export async function chooseTool(page: Page, name: string): Promise<void> {
  const tool = page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name });
  await tool.click();
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
}

/** Decode an image file in the page: its size, and the RGBA at image pixels. */
export async function readImage(
  page: Page,
  bytes: Buffer,
  points: [number, number][],
): Promise<{ width: number; height: number; pixels: [number, number, number, number][] }> {
  return page.evaluate(
    async ({ base64, points }) => {
      const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([data]), { premultiplyAlpha: 'none' });
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const pixels = points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data] as [number, number, number, number]);
      return { width: bmp.width, height: bmp.height, pixels };
    },
    { base64: bytes.toString('base64'), points },
  );
}

/** Click Download and return the file's name, size and the RGBA at image pixels. */
export async function download(page: Page, points: [number, number][] = []) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Download (PNG|WebP|JPG|Mask)$/ }).click();
  const file = await event;
  const chunks: Buffer[] = [];
  for await (const c of await file.createReadStream()) chunks.push(c as Buffer);
  return { name: file.suggestedFilename(), ...(await readImage(page, Buffer.concat(chunks), points)) };
}

/** Download with the current format and return the alpha (0–255) at image pixels. */
export async function downloadAndReadAlpha(page: Page, points: [number, number][]): Promise<number[]> {
  return (await download(page, points)).pixels.map((p) => p[3]);
}

/** The on-screen RGB colour at an image pixel, read from a screenshot of the page. */
export async function screenColor(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const p = await toScreen(page, x, y);
  const base64 = (await page.screenshot({ clip: { x: Math.round(p.x), y: Math.round(p.y), width: 1, height: 1 } })).toString('base64');
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b] as [number, number, number];
  }, base64);
}
