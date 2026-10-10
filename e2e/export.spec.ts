import { expect, test, type Page } from '@playwright/test';
import { chooseTool, DISK, download, openTestImage, readImage, tapImage, toScreen } from './helpers';

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
  // Drag a wobbly loop 8–14 px outside the disk's edge.
  const points: { x: number; y: number }[] = [];
  for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.1) {
    const r = DISK.r + 11 + 3 * Math.sin(a * 5);
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
    [DISK.x + DISK.r + 5, DISK.y],
    [DISK.x, DISK.y - DISK.r - 5],
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

test('Copy puts the transparent PNG on the clipboard', async ({ page, context }) => {
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
