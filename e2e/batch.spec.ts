import { expect, test, type Page } from '@playwright/test';
import { encodePng } from '../scripts/png.mjs';
import { cacheAutoModel, chooseTool, confirmDownload, fakeAi, openTestImage, readImage, screenColorAt, tapImage } from './helpers';

/**
 * Batch Auto, against the stand-in AI worker (its Auto keeps whatever differs clearly
 * from the top-left corner's colour), so each test image is a disk on a flat background.
 */

type File = { name: string; mimeType: string; buffer: Buffer };

/** A `w` × `h` PNG: a disk of `fg` in the middle of `bg`. */
function diskImage(name: string, w: number, h: number, fg: number[], bg: number[]): File {
  const rgba = new Uint8Array(w * h * 4);
  const r = Math.min(w, h) * 0.3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inDisk = (x - w / 2) ** 2 + (y - h / 2) ** 2 <= r * r;
      rgba.set([...(inDisk ? fg : bg), 255], (y * w + x) * 4);
    }
  }
  return { name, mimeType: 'image/png', buffer: encodePng(w, h, rgba) };
}

const RED = [220, 40, 40];
const GREEN = [30, 170, 70];
const BLUE = [40, 60, 220];
const YELLOW = [240, 220, 40];

const cat = () => diskImage('cat.png', 200, 150, RED, GREEN);
const dog = () => diskImage('dog.png', 120, 160, BLUE, YELLOW);

/** Pick files in the system file picker opened by `button`. */
async function choose(page: Page, button: string, files: File[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: button, exact: true }).click();
  const c = await chooser;
  expect(c.isMultiple()).toBe(true);
  await c.setFiles(files);
}

const tiles = (page: Page) => page.getByRole('region', { name: 'Batch' }).getByRole('listitem');
const tile = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name.replace('.', '\\.')}: `) });
const progress = (page: Page, done: number, total: number) => page.getByText(`${done} of ${total} done`, { exact: true });

/**
 * Remove the disk in the middle of the open image with the Magic Wand (the image is
 * centred in the editor), and wait until it's gone from the screen.
 */
async function removeDisk(page: Page): Promise<void> {
  await chooseTool(page, 'Magic Wand');
  const box = (await page.getByRole('img', { name: 'Image editor' }).boundingBox())!;
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const before = await screenColorAt(page, c.x, c.y);
  if (test.info().project.use.hasTouch) await page.touchscreen.tap(c.x, c.y);
  else await page.mouse.click(c.x, c.y);
  await expect.poll(() => screenColorAt(page, c.x, c.y)).not.toEqual(before);
}

/** Read a zip the way unzip tools do (stored entries only, as Download all writes). */
function unzip(buf: Buffer): { name: string; data: Buffer }[] {
  const end = buf.length - 22;
  expect(buf.readUInt32LE(end)).toBe(0x06054b50);
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const nameLen = buf.readUInt16LE(p + 28);
    const size = buf.readUInt32LE(p + 24);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf-8');
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    out.push({ name, data: buf.subarray(start, start + size) });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

/** Click Download all and return the zip's name and files. */
async function downloadAll(page: Page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download all' }).click();
  const file = await event;
  const chunks: Buffer[] = [];
  for await (const c of await file.createReadStream()) chunks.push(c as Buffer);
  return { name: file.suggestedFilename(), files: unzip(Buffer.concat(chunks)) };
}

/** Width, height, and the alpha at the corner and the centre of an exported image. */
async function cornerAndCentre(page: Page, data: Buffer) {
  const probe = await readImage(page, data, []);
  const { pixels, width, height } = await readImage(page, data, [
    [2, 2],
    [Math.floor(probe.width / 2), Math.floor(probe.height / 2)],
  ]);
  return { width, height, corner: pixels[0][3], centre: pixels[1][3] };
}

test('several images open as a batch; once allowed, Auto runs on each, and Download all zips them', async ({ page }) => {
  await page.goto('/');
  await fakeAi(page, { downloadMs: 200 });
  const twin = diskImage('cat.png', 90, 90, BLUE, YELLOW);
  await choose(page, 'Choose image', [cat(), dog(), twin]);

  await expect(tiles(page)).toHaveCount(3);
  // As for a single image, nothing downloads until asked.
  await expect(tile(page, 'dog.png')).toHaveAccessibleName('dog.png: Waiting');
  await page.getByRole('button', { name: 'Remove backgrounds (88 MB one-time download)' }).click();
  await confirmDownload(page);
  await expect(progress(page, 3, 3)).toBeVisible({ timeout: 10_000 });
  await expect(tile(page, 'dog.png')).toHaveAccessibleName('dog.png: Done');

  const zip = await downloadAll(page);
  expect(zip.name).toBe('images-no-bg.zip');
  // Same-named photos don't overwrite each other.
  expect(zip.files.map((f) => f.name)).toEqual(['cat-no-bg.png', 'dog-no-bg.png', 'cat-no-bg (2).png']);
  const sizes = [
    [200, 150],
    [120, 160],
    [90, 90],
  ];
  for (const [i, f] of zip.files.entries()) {
    const img = await cornerAndCentre(page, f.data);
    expect([img.width, img.height], f.name).toEqual(sizes[i]);
    expect(img.corner, f.name).toBe(0);
    expect(img.centre, f.name).toBe(255);
  }
});

test('with the model already downloaded, Auto starts by itself; images scaled down export at full size', async ({ page }) => {
  await page.goto('/');
  await cacheAutoModel(page);
  // Longer than the 4096 px kept for editing.
  const wide = diskImage('wide.png', 5000, 60, RED, GREEN);
  await choose(page, 'Choose image', [cat(), wide]);
  await expect(progress(page, 2, 2)).toBeVisible({ timeout: 10_000 });

  let zip = await downloadAll(page);
  expect((await cornerAndCentre(page, zip.files[1].data)).width).toBe(5000);

  await page.getByRole('button', { name: 'Download options' }).click();
  await page.getByRole('checkbox', { name: 'Full size' }).uncheck();
  await page.keyboard.press('Escape');
  zip = await downloadAll(page);
  const small = await cornerAndCentre(page, zip.files[1].data);
  expect(small.width).toBe(4096);
  expect(small.centre).toBe(255);
});

test('a tile opens the image in the editor with its result, and Back to batch keeps the fix', async ({ page }) => {
  await page.goto('/');
  await cacheAutoModel(page);
  await choose(page, 'Choose image', [cat(), dog()]);
  await expect(progress(page, 2, 2)).toBeVisible({ timeout: 10_000 });

  await tile(page, 'cat.png').click();
  await expect(page.getByRole('img', { name: 'Image editor' })).toBeVisible();
  // The result is an undoable Auto step, and Auto doesn't run again by itself.
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible();

  // Fix: remove the disk too, with the Magic Wand.
  await removeDisk(page);
  await page.getByRole('button', { name: 'Back to batch' }).click();
  await expect(tile(page, 'cat.png')).toHaveAccessibleName('cat.png: Edited');
  await expect(tile(page, 'dog.png')).toHaveAccessibleName('dog.png: Done');

  const zip = await downloadAll(page);
  const fixed = await cornerAndCentre(page, zip.files[0].data);
  expect(fixed.centre).toBe(0);
  expect((await cornerAndCentre(page, zip.files[1].data)).centre).toBe(255);

  // Opening it again brings back its history.
  await tile(page, 'cat.png').click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
});

test('a waiting image opened and left unchanged still gets Auto afterwards', async ({ page }) => {
  await page.goto('/');
  await fakeAi(page, { downloadMs: 100 });
  await choose(page, 'Choose image', [cat(), dog()]);
  await tile(page, 'cat.png').click();
  await expect(page.getByRole('img', { name: 'Image editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to batch' }).click();
  await expect(tile(page, 'cat.png')).toHaveAccessibleName('cat.png: Waiting');

  await page.getByRole('button', { name: 'Remove backgrounds (88 MB one-time download)' }).click();
  await confirmDownload(page);
  await expect(progress(page, 2, 2)).toBeVisible({ timeout: 10_000 });
  const zip = await downloadAll(page);
  const img = await cornerAndCentre(page, zip.files[0].data);
  expect(img.corner).toBe(0);
  expect(img.centre).toBe(255);
});

test('opening an image pauses Auto on the rest, until Back to batch', async ({ page }) => {
  await page.goto('/');
  await cacheAutoModel(page);
  await fakeAi(page, { autoMs: 600 });
  const bird = diskImage('bird.png', 100, 100, BLUE, GREEN);
  await choose(page, 'Choose image', [cat(), dog(), bird]);
  await expect(tile(page, 'cat.png')).toHaveAccessibleName('cat.png: Working…');

  // The image being worked on can't be opened yet; a waiting one can.
  await expect(tile(page, 'cat.png')).toBeDisabled();
  await tile(page, 'dog.png').click();
  await expect(page.getByRole('img', { name: 'Image editor' })).toBeVisible();
  // Auto runs on the open image itself, as it does on any image.
  await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Back to batch' }).click();
  // The third waited meanwhile.
  await expect(tile(page, 'cat.png')).toHaveAccessibleName('cat.png: Done');
  await expect(tile(page, 'dog.png')).toHaveAccessibleName('dog.png: Done');
  await expect(tile(page, 'bird.png')).not.toHaveAccessibleName('bird.png: Done');
  await expect(progress(page, 3, 3)).toBeVisible({ timeout: 10_000 });
});

test('the batch survives a reload, with the image that was open', async ({ page }) => {
  await page.goto('/');
  await cacheAutoModel(page);
  await choose(page, 'Choose image', [cat(), dog()]);
  await expect(progress(page, 2, 2)).toBeVisible({ timeout: 10_000 });
  await tile(page, 'dog.png').click();
  await removeDisk(page);
  // Auto-save waits for a pause in editing.
  await page.waitForTimeout(1500);

  await page.reload();
  await expect(page.getByText('Welcome back — your batch was restored.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Image editor' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Back to batch' }).click();
  await expect(tiles(page)).toHaveCount(2);
  await expect(tile(page, 'cat.png')).toHaveAccessibleName('cat.png: Done');
  await expect(tile(page, 'dog.png')).toHaveAccessibleName('dog.png: Edited');
  const zip = await downloadAll(page);
  expect((await cornerAndCentre(page, zip.files[1].data)).centre).toBe(0);
});

test('Close batch asks first, then the batch is gone, also after a reload', async ({ page }) => {
  await page.goto('/');
  await choose(page, 'Choose image', [cat(), dog()]);
  await expect(tiles(page)).toHaveCount(2);

  const dialog = page.getByRole('dialog', { name: 'Close the batch?' });
  await page.getByRole('button', { name: 'Close batch' }).click();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(tiles(page)).toHaveCount(2);

  await page.getByRole('button', { name: 'Close batch' }).click();
  await dialog.getByRole('button', { name: 'Close batch' }).click();
  await expect(page.getByRole('button', { name: 'Choose image' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Choose image' })).toBeVisible();
  await expect(page.getByText(/Welcome back/)).toHaveCount(0);
});

test('one image still opens in the editor; several over an edited one ask first, then start a batch', async ({ page }) => {
  await openTestImage(page);
  await chooseTool(page, 'Magic Wand');
  await tapImage(page, 10, 10);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  await choose(page, 'Open another image', [cat(), dog()]);
  const dialog = page.getByRole('dialog', { name: 'Open these images?' });
  await dialog.getByRole('button', { name: 'Open images' }).click();
  await expect(tiles(page)).toHaveCount(2);
  await expect(page.getByRole('img', { name: 'Image editor' })).toHaveCount(0);
});

test('dropped images join the open batch; non-images and anything past 50 are left out', async ({ page }) => {
  await page.goto('/');
  await choose(page, 'Choose image', [cat(), dog()]);
  await expect(tiles(page)).toHaveCount(2);

  // Drop an image and a text file onto the page.
  const bird = diskImage('bird.png', 40, 40, BLUE, GREEN);
  await page.evaluate(
    async ({ png }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], 'bird.png', { type: 'image/png' }));
      dt.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
      for (const type of ['dragenter', 'dragover', 'drop']) {
        window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      }
    },
    { png: bird.buffer.toString('base64') },
  );
  await expect(tiles(page)).toHaveCount(3);
  await expect(page.getByText("Some files couldn't be opened, so they were left out.")).toBeVisible();

  const many = Array.from({ length: 48 }, (_, i) => diskImage(`n${i}.png`, 16, 16, RED, GREEN));
  await choose(page, 'Add images', many);
  await expect(page.getByText('A batch holds up to 50 images, so the rest were left out.')).toBeVisible();
  await expect(tiles(page)).toHaveCount(50, { timeout: 20_000 });
  await expect(tile(page, 'n46.png')).toBeVisible();
  await expect(tile(page, 'n47.png')).toHaveCount(0);
});

test('Share sends each image as a file, with one more tap if preparing took too long', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { shared: string[][]; shareCalls: number };
    w.shared = [];
    w.shareCalls = 0;
    navigator.canShare = () => true;
    navigator.share = async (data?: ShareData) => {
      // The first time, act as if the tap was too long ago for the share sheet to open.
      if (w.shareCalls++ === 0) throw new DOMException('Needs a tap', 'NotAllowedError');
      w.shared.push((data?.files ?? []).map((f) => `${f.name} ${f.type}`));
    };
  });
  await page.goto('/');
  await cacheAutoModel(page);
  await choose(page, 'Choose image', [cat(), dog()]);
  await expect(progress(page, 2, 2)).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Download options' }).click();
  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your images are ready' });
  await dialog.getByRole('button', { name: 'Share' }).click();
  await expect(dialog).toBeHidden();
  const shared = await page.evaluate(() => (window as unknown as { shared: string[][] }).shared);
  expect(shared).toEqual([['cat-no-bg.png image/png', 'dog-no-bg.png image/png']]);
});
