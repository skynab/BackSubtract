import { expect, test, type Locator, type Page } from '@playwright/test';
import { encodePng } from '../scripts/png.mjs';
import { chooseTool, DISK, download, downloadAndReadAlpha, openTestImage, readImage, screenColor, tapImage, toScreen } from './helpers';

/** Remove the green background with one Magic Wand tap, leaving the disk. */
async function removeBackground(page: Page): Promise<void> {
  await chooseTool(page, 'Magic Wand');
  await tapImage(page, 10, 10);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
}

async function openOptions(page: Page) {
  await page.getByRole('button', { name: 'Download options' }).click();
  return page.getByRole('dialog', { name: 'Download options' });
}

test('the AI tools are marked, and the others are not', async ({ page }) => {
  await openTestImage(page);
  const tools = page.getByRole('toolbar', { name: 'Tools' });
  for (const name of ['Auto', 'Select']) {
    await expect(tools.getByRole('button', { name })).toHaveAttribute('title', /Uses an AI model/);
  }
  await expect(tools.locator('.ai-badge')).toHaveCount(2);
  await expect(tools.getByRole('button', { name: 'Lasso' })).not.toHaveAttribute('title', /AI/);
});

test('Lasso: a rough loop around the disk snaps to its edge and cuts it out', async ({ page }) => {
  await openTestImage(page);
  await chooseTool(page, 'Lasso');
  // Drag a wobbly loop 6–9 screen px outside the disk's edge: within the lasso's reach (10 screen px) at any zoom.
  const origin = await toScreen(page, 0, 0);
  const scale = (await toScreen(page, 100, 0)).x / 100 - origin.x / 100;
  const gap = 7.5 / scale;
  const points: { x: number; y: number }[] = [];
  for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.1) {
    const r = DISK.r + gap + (1.5 / scale) * Math.sin(a * 5);
    points.push(await toScreen(page, DISK.x + r * Math.cos(a), DISK.y + r * Math.sin(a)));
  }
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  // Keep is the default: on an untouched image, everything outside the loop goes.
  const { pixels } = await download(page, [
    [DISK.x, DISK.y],
    [DISK.x + DISK.r - 4, DISK.y],
    // Between the disk and the loop.
    [DISK.x + DISK.r + Math.max(2, Math.round(gap / 2)), DISK.y],
    [DISK.x, DISK.y - DISK.r - Math.max(2, Math.round(gap / 2))],
    [10, 10],
  ]);
  const [centre, inside, outside, above, corner] = pixels.map((p) => p[3]);
  expect(centre).toBe(255);
  expect(inside).toBe(255);
  // Inside the drawn loop but outside the disk: the line followed the edge, not the pointer.
  expect(outside).toBe(0);
  expect(above).toBe(0);
  expect(corner).toBe(0);
});

async function choosePolygonLasso(page: Page): Promise<void> {
  await chooseTool(page, 'Lasso');
  const polygon = page.getByRole('group', { name: 'Lasso type' }).getByRole('button', { name: 'Polygon' });
  await polygon.click();
  await expect(polygon).toHaveAttribute('aria-pressed', 'true');
}

test('Polygon lasso: corners tapped around the disk cut out exactly that outline', async ({ page }) => {
  await openTestImage(page);
  await choosePolygonLasso(page);
  const undo = page.getByRole('button', { name: 'Undo' });
  // An octagon 20 px outside the disk, starting on the right.
  const corners: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    corners.push([Math.round(DISK.x + (DISK.r + 20) * Math.cos(a)), Math.round(DISK.y + (DISK.r + 20) * Math.sin(a))]);
  }
  for (const [x, y] of corners) await tapImage(page, x, y);
  // A stray corner far to the left, taken back.
  await tapImage(page, 10, 150);
  await page.keyboard.press('Backspace');
  await expect(undo).toBeDisabled();

  // Tapping the first corner again closes the outline.
  await tapImage(page, ...corners[0]);
  await expect(undo).toBeEnabled();

  const [centre, between, stray, corner] = await downloadAndReadAlpha(page, [
    [DISK.x, DISK.y],
    // Inside the octagon but outside the disk: the sides stay where they were drawn.
    [DISK.x + DISK.r + 10, DISK.y],
    // Only inside the outline with the stray corner.
    [40, 145],
    [10, 10],
  ]);
  expect(centre).toBe(255);
  expect(between).toBe(255);
  expect(stray).toBe(0);
  expect(corner).toBe(0);
});

test('Polygon lasso: Esc throws the outline away, and Enter closes one', async ({ page }) => {
  await openTestImage(page);
  await choosePolygonLasso(page);
  await page.getByRole('button', { name: 'Remove' }).click();
  const undo = page.getByRole('button', { name: 'Undo' });

  for (const [x, y] of [[20, 20], [80, 20], [80, 80]] as const) await tapImage(page, x, y);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await expect(undo).toBeDisabled();

  // A box inside the disk.
  for (const [x, y] of [[170, 120], [230, 120], [230, 180], [170, 180]] as const) await tapImage(page, x, y);
  await page.keyboard.press('Enter');
  await expect(undo).toBeEnabled();

  const [centre, disk, corner] = await downloadAndReadAlpha(page, [[DISK.x, DISK.y], [DISK.x, DISK.y - 60], [50, 50]]);
  expect(centre).toBe(0);
  expect(disk).toBe(255);
  expect(corner).toBe(255);
});

test('Crop to subject with a margin and a square shape', async ({ page }) => {
  await openTestImage(page);
  await removeBackground(page);
  const menu = await openOptions(page);
  await menu.getByLabel('Crop to subject').check();
  await menu.locator('.menu-slider input').fill('10');
  await menu.getByRole('group', { name: 'Shape' }).getByRole('button', { name: '1:1' }).click();
  await page.keyboard.press('Escape');

  const { width, height, pixels } = await download(page, [[2, 2]]);
  // The disk is about 181 px across; 10% of that on each side makes about 217.
  expect(width).toBe(height);
  expect(width).toBeGreaterThan(210);
  expect(width).toBeLessThan(225);
  // The margin is transparent.
  expect(pixels[0][3]).toBe(0);
});

/** Choose a background in the open Download options. */
async function chooseBackground(menu: Locator, name: string) {
  const button = menu.getByRole('group', { name: 'Background' }).getByRole('button', { name, exact: true });
  await button.click();
  return button;
}

/** A small solid-colour PNG, to pick as an Image background. */
function solidPng(rgb: [number, number, number], w = 40, h = 30): Buffer {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([...rgb, 255], i * 4);
  return encodePng(w, h, rgba);
}

test('a Color background fills what was removed, in PNG too, and shows on the canvas while the menu is open', async ({ page }) => {
  await openTestImage(page);
  await removeBackground(page);
  const before = await screenColor(page, 10, 10);
  const menu = await openOptions(page);
  await expect(await chooseBackground(menu, 'Color')).toHaveAttribute('aria-pressed', 'true');
  await menu.getByRole('button', { name: 'Black' }).click();
  // The canvas shows the download's background in place of the checkerboard.
  await expect.poll(() => screenColor(page, 10, 10)).toEqual([0, 0, 0]);
  await page.keyboard.press('Escape');
  await expect.poll(() => screenColor(page, 10, 10)).toEqual(before);

  const { pixels } = await download(page, [[10, 10], [DISK.x, DISK.y]]);
  expect(pixels[0]).toEqual([0, 0, 0, 255]);
  expect(pixels[1]).toEqual([220, 40, 40, 255]);
});

test("Blur fills what was removed with the photo's own background, without the subject's colour", async ({ page }) => {
  await openTestImage(page);
  await removeBackground(page);
  const menu = await openOptions(page);
  await chooseBackground(menu, 'Blur');
  await menu.getByLabel('Strength').fill('100');
  await page.keyboard.press('Escape');

  const { pixels } = await download(page, [[10, 10], [DISK.x + DISK.r + 3, DISK.y], [DISK.x, DISK.y]]);
  const [corner, nextToDisk, centre] = pixels;
  // The background is flat green, so blurred it is still green, right up to the disk: no red halo.
  for (const p of [corner, nextToDisk]) {
    expect(p[3]).toBe(255);
    expect(Math.abs(p[0] - 30)).toBeLessThan(6);
    expect(Math.abs(p[1] - 170)).toBeLessThan(6);
  }
  expect(centre).toEqual([220, 40, 40, 255]);
});

test('an Image background covers the frame, and is still there after a reload', async ({ page }) => {
  await openTestImage(page);
  await removeBackground(page);
  let menu = await openOptions(page);
  const chooser = page.waitForEvent('filechooser');
  await chooseBackground(menu, 'Image');
  await (await chooser).setFiles({ name: 'blue.png', mimeType: 'image/png', buffer: solidPng([20, 40, 230]) });
  await expect(menu.getByRole('button', { name: 'Image', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(menu.getByRole('button', { name: 'Change image' })).toBeVisible();
  // Crop to subject with a margin: the picture covers the whole frame, past the image's edges too.
  await menu.getByLabel('Crop to subject').check();
  await menu.locator('.menu-sub .menu-slider input').fill('30');
  await page.keyboard.press('Escape');

  const { width, pixels } = await download(page, [[1, 1], [DISK.x - DISK.r + 2, DISK.y]]);
  expect(width).toBeGreaterThan(2 * DISK.r * 1.5);
  expect(pixels[0]).toEqual([20, 40, 230, 255]);

  // The photo is kept on the device, so the choice still works next visit.
  await page.reload();
  await expect(page.getByRole('img', { name: 'Image editor' })).toBeVisible();
  menu = await openOptions(page);
  await expect(menu.getByRole('button', { name: 'Image', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  const after = await download(page, [[1, 1]]);
  expect(after.pixels[0]).toEqual([20, 40, 230, 255]);
});

test("JPG doesn't offer None, since it can't be transparent", async ({ page }) => {
  await openTestImage(page);
  await removeBackground(page);
  const menu = await openOptions(page);
  const backgrounds = menu.getByRole('group', { name: 'Background' });
  await expect(backgrounds.getByRole('button', { name: 'None' })).toHaveAttribute('aria-pressed', 'true');
  await menu.getByText('JPG', { exact: true }).click();
  await expect(backgrounds.getByRole('button', { name: 'None' })).toHaveCount(0);
  await expect(backgrounds.getByRole('button', { name: 'Color', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  const { name, pixels } = await download(page, [[10, 10]]);
  expect(name).toBe('disk-no-bg.jpg');
  // White by default (JPG is lossy, so nearly).
  for (const c of pixels[0].slice(0, 3)) expect(c).toBeGreaterThan(245);
});

test('Mask downloads a black-and-white image of what is kept', async ({ page }) => {
  await openTestImage(page);
  await removeBackground(page);
  const menu = await openOptions(page);
  await menu.getByText('Mask', { exact: true }).click();
  await page.keyboard.press('Escape');

  const { name, pixels } = await download(page, [[DISK.x, DISK.y], [10, 10]]);
  expect(name).toBe('disk-mask.png');
  expect(pixels[0]).toEqual([255, 255, 255, 255]);
  expect(pixels[1]).toEqual([0, 0, 0, 255]);
});

test('Copy puts the transparent PNG on the clipboard', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Only Chromium lets Playwright grant clipboard access');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openTestImage(page);
  await removeBackground(page);
  const menu = await openOptions(page);
  await menu.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Image copied.')).toBeVisible();

  const base64 = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const blob = await item.getType('image/png');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  });
  const { pixels } = await readImage(page, Buffer.from(base64, 'base64'), [[DISK.x, DISK.y], [10, 10]]);
  expect(pixels[0][3]).toBe(255);
  expect(pixels[1][3]).toBe(0);
});
