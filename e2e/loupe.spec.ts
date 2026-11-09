import { expect, test, type Page } from '@playwright/test';
import { chooseTool, DISK, openTestImage, screenColorAt, toScreen } from './helpers';

type Pt = { x: number; y: number };

/** Real touch input (Chromium's DevTools protocol): each call lists every finger now on the screen. */
async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Pt[] = []) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })) });
}

async function choosePolygonLasso(page: Page) {
  await chooseTool(page, 'Lasso');
  await page.getByRole('group', { name: 'Lasso type' }).getByRole('button', { name: 'Polygon' }).click();
}

const loupe = (page: Page) => page.locator('svg.loupe');

/** The loupe's centre, in page px. */
async function loupeCentre(page: Page): Promise<Pt> {
  const box = (await page.getByRole('img', { name: 'Image editor' }).boundingBox())!;
  const rim = page.locator('svg.loupe circle.rim');
  return { x: box.x + Number(await rim.getAttribute('cx')), y: box.y + Number(await rim.getAttribute('cy')) };
}

test.describe('touch loupe', () => {
  test.skip(({ hasTouch }) => !hasTouch, 'Only fingers hide the spot they draw on');

  test('magnifies the spot under a finger at twice the zoom, and goes when it lifts', async ({ page }) => {
    await openTestImage(page);
    // The polygon lasso changes nothing until the finger lifts, so the loupe shows the image as it was.
    await choosePolygonLasso(page);
    const origin = await toScreen(page, 0, 0);
    const scale = (await toScreen(page, 100, 0)).x / 100 - origin.x / 100;
    // 8 screen px left of the disk's left edge: in the loupe, the edge is 16 px right of its centre.
    const finger = await toScreen(page, DISK.x - DISK.r - 8 / scale, DISK.y);
    const touch = await fingers(page);
    await touch('touchStart', [{ x: finger.x - 12, y: finger.y }]);
    await touch('touchMove', [finger]);
    await expect(loupe(page)).toHaveAttribute('visibility', 'visible');

    const c = await loupeCentre(page);
    // Clear of the finger, and below the view switch.
    expect(Math.hypot(c.x - finger.x, c.y - finger.y)).toBeGreaterThan(80);
    // Just off the crosshair: green background, then the red disk past the magnified edge.
    expect(await screenColorAt(page, c.x + 12, c.y + 5)).toEqual([30, 170, 70]);
    expect(await screenColorAt(page, c.x + 22, c.y + 5)).toEqual([220, 40, 40]);

    await touch('touchEnd');
    await expect(loupe(page)).toHaveAttribute('visibility', 'hidden');
    // The press added the polygon's first corner where the finger lifted.
    await expect(page.locator('svg.lasso:not(.loupe) circle.start')).toHaveAttribute('visibility', 'visible');
  });

  test('a finger held still gets it after a moment, so a quick tap never flashes it', async ({ page }) => {
    // Time moves only when the test says, so this doesn't depend on how fast the test machine draws.
    await page.clock.install();
    await openTestImage(page);
    await chooseTool(page, 'Shape');
    const p = await toScreen(page, 60, 60);
    const touch = await fingers(page);
    await touch('touchStart', [p]);
    await page.clock.runFor(100);
    await expect(loupe(page)).toHaveAttribute('visibility', 'hidden');
    await page.clock.runFor(100);
    await expect(loupe(page)).toHaveAttribute('visibility', 'visible');
    await touch('touchEnd');
    await page.clock.runFor(50);
    await expect(loupe(page)).toHaveAttribute('visibility', 'hidden');
  });

  test('moving shows it at once, with the shape being drawn, and a second finger (to pinch) puts it away', async ({ page }) => {
    await openTestImage(page);
    await chooseTool(page, 'Shape');
    const p = await toScreen(page, 60, 60);
    const touch = await fingers(page);
    await touch('touchStart', [p]);
    await touch('touchMove', [{ x: p.x + 30, y: p.y + 30 }]);
    await expect(loupe(page)).toHaveAttribute('visibility', 'visible');
    // The shape being drawn is copied into the loupe.
    await expect(page.locator('svg.loupe .loupe-lines path').first()).toHaveAttribute('d', /^M/);
    await touch('touchMove', [{ x: p.x + 30, y: p.y + 30 }, { x: p.x + 120, y: p.y + 120 }]);
    await expect(loupe(page)).toHaveAttribute('visibility', 'hidden');
    await touch('touchEnd');
  });

  test('the brush shows its outline in the loupe', async ({ page }) => {
    await openTestImage(page);
    await chooseTool(page, 'Brush');
    const p = await toScreen(page, 60, 60);
    const touch = await fingers(page);
    await touch('touchStart', [p]);
    await touch('touchMove', [{ x: p.x + 20, y: p.y }]);
    await expect(loupe(page)).toHaveAttribute('visibility', 'visible');
    const ring = page.locator('svg.loupe circle.ring');
    await expect(ring).toHaveAttribute('visibility', 'visible');
    // The default 40 px brush, at twice the zoom.
    await expect(ring).toHaveAttribute('r', '40');
    await touch('touchEnd');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  });
});

test('a mouse never shows the loupe', async ({ page, hasTouch }) => {
  test.skip(hasTouch, 'A desktop check');
  await openTestImage(page);
  await chooseTool(page, 'Shape');
  const a = await toScreen(page, 60, 60);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + 60, { steps: 5 });
  await page.waitForTimeout(250);
  await expect(loupe(page)).toHaveAttribute('visibility', 'hidden');
  await page.mouse.up();
});
