import { expect, test, type Page } from '@playwright/test';
import { chooseTool, DISK, downloadAndReadAlpha, openTestImage, tapImage, toScreen } from './helpers';

/** Remove the green background with one Magic Wand tap, leaving the disk. */
async function removeBackground(page: Page): Promise<void> {
  await chooseTool(page, 'Magic Wand');
  await tapImage(page, 10, 10);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
}

/** Drag the mouse through image points. */
async function drag(page: Page, points: [number, number][]): Promise<void> {
  const first = await toScreen(page, ...points[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const s = await toScreen(page, ...p);
    await page.mouse.move(s.x, s.y, { steps: 6 });
  }
  await page.mouse.up();
}

test('Edges: shrinking moves the edge in, as one step that Undo reverts', async ({ page }) => {
  await openTestImage(page);
  await removeBackground(page);
  await page.getByRole('button', { name: 'Refine edges' }).click();
  const panel = page.getByRole('dialog', { name: 'Refine edges' });
  // Moving the slider again replaces the step rather than adding one.
  await panel.getByRole('slider', { name: 'Edge position' }).fill('-2');
  await page.waitForTimeout(300);
  await panel.getByRole('slider', { name: 'Edge position' }).fill('-4');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  const near = DISK.x + DISK.r - 2;
  const [shrunk, centre] = await downloadAndReadAlpha(page, [[near, DISK.y], [DISK.x, DISK.y]]);
  expect(shrunk).toBe(0);
  expect(centre).toBe(255);

  // So one Undo goes back to before the panel opened.
  await page.getByRole('button', { name: 'Undo' }).click();
  const [restored, background] = await downloadAndReadAlpha(page, [[near, DISK.y], [10, 10]]);
  expect(restored).toBe(255);
  expect(background).toBe(0);
});

test('Edges: clean-up removes a stray speck but keeps the subject', async ({ page }) => {
  await openTestImage(page);
  await removeBackground(page);
  // Bring back a small dot of background: a speck.
  await chooseTool(page, 'Brush');
  await page.getByRole('button', { name: 'Keep' }).click();
  // A small brush, so the dot is speck-sized at any zoom.
  for (let i = 0; i < 6; i++) await page.keyboard.press('[');
  await drag(page, [[30, 30], [31, 30]]);
  const [speck] = await downloadAndReadAlpha(page, [[30, 30]]);
  expect(speck).toBe(255);

  await page.getByRole('button', { name: 'Refine edges' }).click();
  await page.getByRole('dialog', { name: 'Refine edges' }).getByRole('slider', { name: 'Clean up specks' }).fill('10');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  const [gone, centre] = await downloadAndReadAlpha(page, [[30, 30], [DISK.x, DISK.y]]);
  expect(gone).toBe(0);
  expect(centre).toBe(255);
});

test('Refine brush works the edge out again from the colours around it', async ({ page }) => {
  await openTestImage(page);
  await removeBackground(page);
  // Wreck the disk's right edge with a Remove stroke...
  const edge: [number, number][] = [[DISK.x + DISK.r - 2, DISK.y - 30], [DISK.x + DISK.r - 2, DISK.y + 30]];
  await chooseTool(page, 'Brush');
  await drag(page, edge);
  const inside: [number, number] = [DISK.x + DISK.r - 4, DISK.y];
  const outside: [number, number] = [DISK.x + DISK.r + 4, DISK.y];
  expect((await downloadAndReadAlpha(page, [inside]))[0]).toBe(0);

  // ...then paint over it with Refine: the disk comes back, the background stays removed.
  await page.getByRole('group', { name: 'Brush type' }).getByRole('button', { name: 'Hair' }).click();
  await expect(page.getByRole('group', { name: 'Mode' })).toBeHidden();
  await drag(page, edge);
  const [back, stillGone] = await downloadAndReadAlpha(page, [inside, outside]);
  expect(back).toBe(255);
  expect(stillGone).toBe(0);
});
