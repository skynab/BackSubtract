import { expect, test } from '@playwright/test';
import { chooseTool, DISK, downloadAndReadAlpha, IMAGE_H, IMAGE_W, openTestImage, screenColor, tapImage, toScreen } from './helpers';

test('start screen, language switch and right-to-left layout', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Remove the background from any photo' })).toBeVisible();

  const language = page.getByRole('combobox');
  await language.selectOption('es');
  await expect(page.getByRole('heading', { name: 'Quita el fondo de cualquier foto' })).toBeVisible();

  await language.selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await language.selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('every language fits a small phone: nothing off screen, no tool label spilling over', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile', 'A phone layout check');
  await page.setViewportSize({ width: 375, height: 740 });
  await openTestImage(page);
  const codes = await page.getByRole('combobox').locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(codes.length).toBeGreaterThanOrEqual(13);
  for (const code of codes) {
    await page.getByRole('combobox').selectOption(code);
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    const problems = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const out: string[] = [];
      for (const e of document.querySelectorAll('.bottombar *, .topbar *, .view-controls *')) {
        const r = e.getBoundingClientRect();
        if (r.width && (r.right > vw + 0.5 || r.left < -0.5)) out.push(`off screen: ${e.textContent?.trim().slice(0, 20)}`);
      }
      for (const b of document.querySelectorAll('.tool')) {
        const box = b.getBoundingClientRect();
        const label = b.querySelector(':scope > span:last-child')!;
        const range = document.createRange();
        range.selectNodeContents(label);
        if ([...range.getClientRects()].some((t) => t.left < box.left - 0.5 || t.right > box.right + 0.5)) out.push(`spills: ${label.textContent}`);
      }
      if (document.documentElement.scrollWidth > vw) out.push('page scrolls sideways');
      return [...new Set(out)];
    });
    expect(problems, code).toEqual([]);
  }
});

test('About opens from the app name and closes with Escape', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'BackSubtract' }).click();
  const dialog = page.getByRole('dialog', { name: 'About BackSubtract' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('opening an image shows the editor without horizontal scrolling', async ({ page }) => {
  await openTestImage(page);
  await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible();
  // Auto asks before its first model download instead of starting one.
  await expect(page.getByRole('button', { name: /Remove background \(\d+ MB one-time download\)/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('Magic Wand removes the background, and the download is transparent there', async ({ page }) => {
  await openTestImage(page);
  await chooseTool(page, 'Magic Wand');
  await tapImage(page, 10, 10);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  const [corner, centre] = await downloadAndReadAlpha(page, [[10, 10], [DISK.x, DISK.y]]);
  expect(corner).toBe(0);
  expect(centre).toBe(255);
});

test('Keep brings back what Remove hid; undo and redo work', async ({ page }) => {
  await openTestImage(page);
  await chooseTool(page, 'Color');
  await tapImage(page, 10, 10); // remove the green background everywhere
  const undo = page.getByRole('button', { name: 'Undo' });
  const redo = page.getByRole('button', { name: 'Redo' });
  await expect(undo).toBeEnabled();

  // Keep + tap the same colour restores it.
  await page.getByRole('button', { name: 'Keep' }).click();
  await tapImage(page, 10, 10);
  // The tap is worked out in the image worker; wait for it rather than racing it.
  await expect.poll(async () => (await downloadAndReadAlpha(page, [[10, 10]]))[0]).toBe(255);
  let corner: number;

  await undo.click();
  await expect(redo).toBeEnabled();
  [corner] = await downloadAndReadAlpha(page, [[10, 10]]);
  expect(corner).toBe(0);

  await redo.click();
  [corner] = await downloadAndReadAlpha(page, [[10, 10]]);
  expect(corner).toBe(255);
});

test('holding Undo lists every step and jumps straight to one', async ({ page }) => {
  await openTestImage(page);
  const list = page.getByRole('dialog', { name: 'History' });
  // Right-click opens the same list as press-and-hold. Checking it after each tap also waits for the tap to land.
  const expectSteps = async (steps: string[]) => {
    await page.getByRole('button', { name: 'Undo' }).click({ button: 'right' });
    await expect(list.getByRole('button')).toHaveText(['Opened image', ...steps]);
    await expect(list.getByRole('button', { name: steps.at(-1) })).toHaveAttribute('aria-current', 'step');
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
  };

  await chooseTool(page, 'Color');
  await tapImage(page, 10, 10); // remove the background
  await expectSteps(['Color · Remove']);
  await page.getByRole('button', { name: 'Keep' }).click();
  await tapImage(page, 10, 10); // bring it back
  await expectSteps(['Color · Remove', 'Color · Keep']);
  await chooseTool(page, 'Magic Wand');
  await tapImage(page, DISK.x, DISK.y); // remove the disk
  await expectSteps(['Color · Remove', 'Color · Keep', 'Magic Wand · Remove']);

  await page.getByRole('button', { name: 'Undo' }).click({ button: 'right' });
  await list.getByRole('button', { name: 'Color · Remove' }).click();
  await expect(list.getByRole('button', { name: 'Color · Remove' })).toHaveAttribute('aria-current', 'step');
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled();

  const [corner, centre] = await downloadAndReadAlpha(page, [[10, 10], [DISK.x, DISK.y]]);
  expect(corner).toBe(0);
  expect(centre).toBe(255);
});

test('the view switch toggles between result, overlay and original', async ({ page }) => {
  await openTestImage(page);
  const view = page.getByRole('group', { name: 'View' });
  for (const name of ['Overlay', 'Original', 'Result']) {
    await view.getByRole('button', { name }).click();
    await expect(view.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
  }
});

test('the background can be made high-contrast and set moving, and both are remembered', async ({ page }) => {
  await openTestImage(page);
  await chooseTool(page, 'Magic Wand');
  await tapImage(page, 10, 10); // the background is now transparent, showing the checkerboard
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  await page.getByRole('button', { name: 'Background' }).click();
  const panel = page.getByRole('dialog', { name: 'Background' });
  await panel.getByRole('slider', { name: 'Contrast' }).fill('100');
  await panel.getByLabel('Move the background').check();

  // At full contrast the checkerboard is pure white and black.
  const seen = new Set<string>();
  for (const [x, y] of [[20, 20], [24, 20], [28, 20], [32, 20], [20, 24], [24, 24], [28, 24], [32, 24]]) {
    const c = await screenColor(page, x, y);
    seen.add(c.every((v) => v > 245) ? 'white' : c.every((v) => v < 10) ? 'black' : 'other');
  }
  expect(seen.has('white') && seen.has('black')).toBe(true);

  await page.reload();
  await page.getByRole('button', { name: 'Background' }).click();
  await expect(page.getByRole('dialog', { name: 'Background' }).getByRole('slider', { name: 'Contrast' })).toHaveValue('100');
  await expect(page.getByLabel('Move the background')).toBeChecked();
});

test('hovering with Color previews the change without applying it', async ({ page }) => {
  test.skip(!!test.info().project.use.hasTouch, 'Touch screens have no hover');
  await openTestImage(page);
  await chooseTool(page, 'Color');
  const before = await screenColor(page, 30, 30);

  // Rest the pointer on the green background: it turns red where a tap would remove it.
  const p = await toScreen(page, 10, 10);
  await page.mouse.move(p.x, p.y);
  await expect.poll(async () => (await screenColor(page, 30, 30))[0]).toBeGreaterThan(before[0] + 40);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  // The disk isn't that colour, so it stays as it was.
  expect(await screenColor(page, DISK.x, DISK.y)).toEqual([220, 40, 40]);

  // Leaving the image hides the preview again.
  await page.mouse.move(5, 5);
  await expect.poll(() => screenColor(page, 30, 30)).toEqual(before);
});

test('a brush stroke hides what it covers', async ({ page }) => {
  await openTestImage(page);
  await chooseTool(page, 'Brush');
  const from = await toScreen(page, DISK.x - 40, DISK.y);
  const to = await toScreen(page, DISK.x + 40, DISK.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  const [stroke, untouched] = await downloadAndReadAlpha(page, [[DISK.x, DISK.y], [10, 10]]);
  expect(stroke).toBe(0);
  expect(untouched).toBe(255);
});

test('Shift+click paints a straight brush line from where the last stroke ended', async ({ page }) => {
  test.skip(!!test.info().project.use.hasTouch, 'Needs a keyboard and mouse');
  await openTestImage(page);
  await chooseTool(page, 'Brush');
  const a = await toScreen(page, DISK.x - 60, DISK.y);
  const b = await toScreen(page, DISK.x + 60, DISK.y);
  await page.mouse.click(a.x, a.y);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  // Holding Shift over the image shows the line a click would paint.
  await page.mouse.move(b.x, b.y);
  await page.keyboard.down('Shift');
  await expect.poll(() => page.locator('path.line-preview').getAttribute('d')).toMatch(/^M.+L.+/);
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up('Shift');
  await expect.poll(() => page.locator('path.line-preview').getAttribute('d')).toBe('');

  const [start, middle, end, aside] = await downloadAndReadAlpha(page, [
    [DISK.x - 60, DISK.y], [DISK.x, DISK.y], [DISK.x + 60, DISK.y], [DISK.x, DISK.y - 40],
  ]);
  expect([start, middle, end]).toEqual([0, 0, 0]);
  expect(aside).toBe(255);

  // The line is one step: one Undo takes it away and leaves the first click.
  await page.getByRole('button', { name: 'Undo' }).click();
  const [first, middleBack] = await downloadAndReadAlpha(page, [[DISK.x - 60, DISK.y], [DISK.x, DISK.y]]);
  expect(first).toBe(0);
  expect(middleBack).toBe(255);
});

test('a soft brush fades out instead of cutting a hard edge', async ({ page }) => {
  await openTestImage(page);
  await chooseTool(page, 'Brush');
  await page.getByRole('slider', { name: 'Hardness' }).fill('0');

  // Brush radius in image pixels: 20 screen px (the default 40 px brush) at the initial fit.
  const box = (await page.getByRole('img', { name: 'Image editor' }).boundingBox())!;
  const radius = 20 / Math.min((box.width - 48) / IMAGE_W, (box.height - 48) / IMAGE_H);
  const y = 40;
  const from = await toScreen(page, 60, y);
  const to = await toScreen(page, 340, y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 20 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  const [centre, rim] = await downloadAndReadAlpha(page, [[200, y], [200, Math.round(y + radius * 0.75)]]);
  expect(centre).toBe(0);
  // Three quarters of the way out, a soft brush has only partly hidden the image.
  expect(rim).toBeGreaterThan(100);
  expect(rim).toBeLessThan(250);
});

test('Shape removes a dragged box and Keep with an ellipse brings part of it back', async ({ page }) => {
  await openTestImage(page);
  await chooseTool(page, 'Shape');
  const drag = async (x0: number, y0: number, x1: number, y1: number) => {
    const from = await toScreen(page, x0, y0);
    const to = await toScreen(page, x1, y1);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  };

  await drag(DISK.x - 100, DISK.y - 100, DISK.x + 100, DISK.y + 100); // Remove is the default
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  await page.getByRole('button', { name: 'Keep' }).click();
  await page.getByRole('group', { name: 'Shape' }).getByRole('button', { name: 'Ellipse' }).click();
  await drag(DISK.x - 30, DISK.y - 30, DISK.x + 30, DISK.y + 30);

  const [centre, inBox, outside] = await downloadAndReadAlpha(page, [[DISK.x, DISK.y], [DISK.x - 80, DISK.y - 80], [10, 10]]);
  expect(centre).toBe(255);
  expect(inBox).toBe(0);
  expect(outside).toBe(255);
});

test('work survives a reload', async ({ page }) => {
  await openTestImage(page);
  await chooseTool(page, 'Magic Wand');
  await tapImage(page, 10, 10);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  // Autosave runs shortly after each change.
  await page.waitForTimeout(1500);

  await page.reload();
  await expect(page.getByText('Welcome back — your last image was restored.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  const [corner] = await downloadAndReadAlpha(page, [[10, 10]]);
  expect(corner).toBe(0);
});

test('an iPhone HEIC photo the browser cannot decode gets a helpful message', async ({ page }) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose image' }).click();
  // Windows often reports no type for .heic files, so the name alone must be enough.
  await (await chooser).setFiles({ name: 'IMG_0001.HEIC', mimeType: '', buffer: Buffer.from('not really heic') });
  await expect(page.getByText(/can't open iPhone HEIC photos/)).toBeVisible();
});
