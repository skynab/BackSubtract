import { expect, test, type Page } from '@playwright/test';
import { encodePng } from '../scripts/png.mjs';
import { fileUrl, ISNET, REPOS, SELECT, type Repo } from '../src/ml/models';

/**
 * The real AI models, end to end (`npm run test:models`; weekly on CI, see
 * .github/workflows/models.yml). Every other browser test uses the stand-in AI worker,
 * so these are what notice a model, Transformers.js or ONNX Runtime change that breaks
 * Auto or Select, or a model file that's gone or has a different size.
 *
 * They run on the CPU (WebAssembly), as CI has no GPU: the app is told the GPU failed
 * before, so Auto uses IS-Net at fp32 and Select SlimSAM's quantised encoder. BiRefNet
 * needs WebGPU, so only its files are checked.
 */

const W = 640;
const H = 480;
const BALL = { x: 320, y: 250, r: 150 };

/** Small seeded random generator, so the scene is identical on every run. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shaded orange ball with a soft shadow on a studio backdrop, with a little sensor noise. */
function photo(): Buffer {
  const rand = seeded(7);
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let cover = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++)
          if ((x + (sx + 0.5) / 4 - BALL.x) ** 2 + (y + (sy + 0.5) / 4 - BALL.y) ** 2 <= BALL.r ** 2) cover++;
      cover /= 16;
      const light = Math.min(1, Math.hypot(x - (BALL.x - 50), y - (BALL.y - 50)) / (BALL.r * 1.7));
      const ball = [245 - 110 * light, 140 - 100 * light, 40 - 30 * light];
      // A backdrop lighter at the top, and a soft shadow on the floor under the ball.
      const shade = 1 - 0.18 * (y / H) - 0.35 * Math.exp(-(((x - BALL.x) / 170) ** 2) - ((y - (BALL.y + BALL.r + 8)) / 22) ** 2);
      const back = [205 * shade, 214 * shade, 224 * shade];
      const noise = (rand() - 0.5) * 8;
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.max(0, Math.min(255, ball[c] * cover + back[c] * (1 - cover) + noise));
      rgba[i + 3] = 255;
    }
  }
  return encodePng(W, H, rgba);
}

async function openPhoto(page: Page) {
  // As after a failure on the GPU (src/ml/client.ts): the models run on the CPU.
  await page.addInitScript(() => localStorage.setItem('backsubtract.gpuFallback', '1'));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose image' }).click();
  await (await chooser).setFiles({ name: 'ball.png', mimeType: 'image/png', buffer: photo() });
  await expect(page.getByRole('img', { name: 'Image editor' })).toBeVisible();
}

const confirmDownload = (page: Page) =>
  page.getByRole('dialog', { name: 'Download the AI model?' }).getByRole('button', { name: 'Download', exact: true }).click();

/**
 * Downloads the result and compares what it keeps (alpha 128 and above) with the ball:
 * the intersection over union, and how much of the backdrop away from the ball is kept.
 */
async function compareWithBall(page: Page): Promise<{ iou: number; strayBackdrop: number }> {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG' }).click();
  const chunks: Buffer[] = [];
  for await (const c of await (await event).createReadStream()) chunks.push(c as Buffer);
  return page.evaluate(
    async ({ base64, ball }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes]), { premultiplyAlpha: 'none' });
      const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, bmp.width, bmp.height);
      let both = 0;
      let either = 0;
      let far = 0;
      let farKept = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const d = Math.hypot(x + 0.5 - ball.x, y + 0.5 - ball.y);
          const kept = data[(y * width + x) * 4 + 3] >= 128;
          const inBall = d <= ball.r;
          if (kept && inBall) both++;
          if (kept || inBall) either++;
          if (d > ball.r + 20) {
            far++;
            if (kept) farKept++;
          }
        }
      }
      return { iou: both / either, strayBackdrop: farKept / far };
    },
    { base64: Buffer.concat(chunks).toString('base64'), ball: BALL },
  );
}

/** The cached files of a model, with their sizes, as Transformers.js stored them. */
async function cachedSizes(page: Page, repo: Repo): Promise<Record<string, number>> {
  const urls = Object.fromEntries(Object.keys(repo.sizes).map((p) => [p, fileUrl('https://huggingface.co/', repo, p)]));
  return page.evaluate(async (urls) => {
    const cache = await caches.open('transformers-cache');
    const sizes: Record<string, number> = {};
    for (const [path, url] of Object.entries(urls)) {
      const response = await cache.match(url);
      if (response) sizes[path] = (await response.blob()).size;
    }
    return sizes;
  }, urls);
}

test('every model file is at its fixed commit, at the size the app shows', async ({ request }) => {
  for (const repo of REPOS) {
    const response = await request.get(`https://huggingface.co/api/models/${repo.id}/tree/${repo.revision}/onnx`);
    expect(response.ok(), `${repo.id} at ${repo.revision}`).toBe(true);
    const listed = Object.fromEntries(((await response.json()) as { path: string; size: number }[]).map((f) => [f.path, f.size]));
    for (const [path, size] of Object.entries(repo.sizes)) expect(listed[path], `${repo.id}/${path}`).toBe(size);
  }
});

test('Auto with IS-Net cuts out the ball', async ({ page }) => {
  await openPhoto(page);
  await page.getByRole('button', { name: /^Remove background \(\d+ MB one-time download\)$/ }).click();
  await confirmDownload(page);
  await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible({ timeout: 4 * 60_000 });

  const { iou, strayBackdrop } = await compareWithBall(page);
  console.log(`Auto: IoU ${iou.toFixed(3)}, backdrop kept ${(strayBackdrop * 100).toFixed(2)}%`);
  expect(iou).toBeGreaterThan(0.9);
  expect(strayBackdrop).toBeLessThan(0.01);
  // What was downloaded is what the app said it would download.
  expect(await cachedSizes(page, ISNET)).toEqual({ 'onnx/model.onnx': ISNET.sizes['onnx/model.onnx'] });
});

test('Select with SlimSAM cuts out the ball it was tapped on', async ({ page }) => {
  await openPhoto(page);
  await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Select' }).click();
  // The ball is in the middle of the image, which is centred in the editor.
  const box = (await page.getByRole('img', { name: 'Image editor' }).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await confirmDownload(page);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 4 * 60_000 });

  const { iou, strayBackdrop } = await compareWithBall(page);
  console.log(`Select: IoU ${iou.toFixed(3)}, backdrop kept ${(strayBackdrop * 100).toFixed(2)}%`);
  expect(iou).toBeGreaterThan(0.9);
  expect(strayBackdrop).toBeLessThan(0.01);
  const encoder = 'onnx/vision_encoder_quantized.onnx';
  const decoder = 'onnx/prompt_encoder_mask_decoder_quantized.onnx';
  expect(await cachedSizes(page, SELECT)).toEqual({ [encoder]: SELECT.sizes[encoder], [decoder]: SELECT.sizes[decoder] });
});
