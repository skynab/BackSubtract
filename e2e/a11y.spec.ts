import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { encodePng } from '../scripts/png.mjs';
import { chooseTool, openTestImage } from './helpers';

/**
 * Accessibility: axe's WCAG 2.2 AA and best-practice rules on every screen, dialog and
 * menu, in light and dark and right to left; and the keyboard: every control in reach of
 * Tab, in order, showing where focus is, and focus back where it was when a dialog closes.
 */

const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** No axe findings on the page, or only within `include` (a menu over the page, say). */
async function expectAccessible(page: Page, where: string, include?: string): Promise<void> {
  const axe = new AxeBuilder({ page }).withTags(RULES);
  if (include) axe.include(include);
  const { violations } = await axe.analyze();
  const found = violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join('; ')})`);
  expect(found, where).toEqual([]);
}

function flatImage(name: string) {
  const w = 120;
  const h = 90;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([200, 40, 40, 255], i * 4);
  return { name, mimeType: 'image/png', buffer: encodePng(w, h, rgba) };
}

for (const scheme of ['light', 'dark'] as const) {
  test(`every screen, dialog and menu passes axe, in ${scheme}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await expectAccessible(page, 'start screen');
    await page.getByRole('button', { name: 'BackSubtract' }).click();
    await expectAccessible(page, 'About');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Donate' }).click();
    await expectAccessible(page, 'Donate');
    await page.keyboard.press('Escape');

    await openTestImage(page);
    await expectAccessible(page, 'editor, with Auto');
    for (const tool of ['Select', 'Magic Wand', 'Color', 'Lasso', 'Brush', 'Shape']) {
      await chooseTool(page, tool);
      await expectAccessible(page, `editor, with ${tool}`);
    }
    await page.getByRole('button', { name: 'Refine edges' }).click();
    await expectAccessible(page, 'Edges panel');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Background', exact: true }).click();
    await expectAccessible(page, 'background settings');
    await page.keyboard.press('Escape');
    // The menu covers the tools while it's open, which axe counts against their size.
    await page.getByRole('button', { name: 'Download options' }).click();
    await expectAccessible(page, 'Download menu', '.download-menu');
    await page.keyboard.press('Escape');
    await chooseTool(page, 'Auto');
    await page.getByRole('button', { name: /^Remove background/ }).click();
    await expectAccessible(page, '"Download the AI model?"');
    await page.keyboard.press('Escape');

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open another image' }).click();
    await (await chooser).setFiles([flatImage('a.png'), flatImage('b.png')]);
    await expect(page.getByRole('button', { name: 'Close batch' })).toBeVisible();
    await expectAccessible(page, 'batch grid');
  });
}

test('right to left (Hebrew) passes axe', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox').selectOption('he');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expectAccessible(page, 'start screen in Hebrew');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.dropzone button').first().click();
  await (await chooser).setFiles(flatImage('a.png'));
  await expect(page.locator('canvas[role="img"]')).toBeVisible();
  await expectAccessible(page, 'editor in Hebrew');
});

/** The focused element's name, and whether it shows a focus ring. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { name: '(nothing)', ring: false };
    const s = getComputedStyle(el);
    const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
    return { name: el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.textContent?.trim() ?? '', ring };
  });

test('Tab reaches every control in order, each showing a focus ring', async ({ page, browserName }) => {
  test.skip(
    browserName === 'webkit',
    'Safari moves Tab only between form fields unless "Press Tab to highlight each item" is on, and Playwright\'s WebKit skips buttons too',
  );
  await openTestImage(page);
  // From the first control on the page.
  await page.getByRole('button', { name: 'BackSubtract' }).focus();
  await page.keyboard.press('Shift+Tab');
  const names: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const { name, ring } = await focused(page);
    if (name === '(nothing)' || names.includes(name)) break;
    expect(ring, `focus ring on ${name}`).toBe(true);
    names.push(name);
  }
  // Top bar, view switch, tools, the tool's own row, then the actions.
  const order = ['BackSubtract', 'Show the result', 'Show the original', 'Magic Wand', 'Shape', 'Open another image', 'Refine edges', 'Download options'];
  const positions = order.map((n) => names.findIndex((m) => m.includes(n)));
  expect(positions.every((p) => p >= 0), `reached: ${names.join(', ')}`).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
});

test('a dialog gives focus back to what opened it, however it closes', async ({ page }) => {
  await page.goto('/');
  const brand = page.getByRole('button', { name: 'BackSubtract' });
  const about = page.getByRole('dialog', { name: 'About BackSubtract' });
  const ways: [string, () => Promise<void>][] = [
    ['its close button', () => about.getByRole('button', { name: 'Close' }).click()],
    ['Escape', () => page.keyboard.press('Escape')],
    // A click on the backdrop, outside the dialog's box.
    ['a click outside', () => page.mouse.click(4, 4)],
  ];
  for (const [way, close] of ways) {
    await brand.focus();
    await page.keyboard.press('Enter');
    await expect(about).toBeVisible();
    await close();
    await expect(about, way).toBeHidden();
    await expect(brand, `focus after closing About with ${way}`).toBeFocused();
  }

  // A dialog's own buttons too: "Not now" in the model download question.
  await openTestImage(page);
  const auto = page.getByRole('button', { name: /^Remove background/ });
  await auto.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Download the AI model?' }).getByRole('button', { name: 'Not now' }).click();
  await expect(auto).toBeFocused();
});
