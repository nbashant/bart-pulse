import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const shotDir = join(process.cwd(), 'artifacts/screenshots');
const base = '/?demo=1';

test.describe('visual smoke and screenshot capture', () => {
  test.beforeEach(() => {
    mkdirSync(shotDir, { recursive: true });
  });

  test('captures required desktop and tablet states', async ({ page }) => {
    await capture(page, 1440, 900, 'desktop-1440x900-default');
    await page.getByTestId('station-marker-MCAR').click();
    await captureCurrent(page, 'desktop-1440x900-selected-station');
    await page.getByTestId('detail-close-button').click();
    await clickVisibleSvgMarker(page, '[data-train-marker]');
    await captureCurrent(page, 'desktop-1440x900-selected-train');
    await page.getByTestId('line-filter-Yellow').click();
    await captureCurrent(page, 'desktop-1440x900-focused-line');
    await page.getByTestId('zoom-in-button').click();
    const map = page.getByTestId('bart-map');
    const box = await map.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + 720, box!.y + 440);
    await page.mouse.down();
    await page.mouse.move(box!.x + 790, box!.y + 475);
    await page.mouse.up();
    await captureCurrent(page, 'desktop-1440x900-zoom-pan');
    await page.getByTestId('service-toggle').click();
    await captureCurrent(page, 'desktop-1440x900-service-open');

    await capture(page, 1280, 800, 'desktop-1280x800-default');
    await capture(page, 834, 1112, 'tablet-834x1112-default');
  });

  test('captures required mobile states and checks viewport fit', async ({ page }) => {
    await capture(page, 390, 844, 'mobile-390x844-closed');
    await page.getByTestId('station-search-input').fill('mac');
    await captureCurrent(page, 'mobile-390x844-search-open');
    await page.getByTestId('station-result-MCAR').click();
    await captureCurrent(page, 'mobile-390x844-station-sheet');
    await page.getByTestId('detail-close-button').click();
    await page.getByTestId('fit-map-button').click();
    await clickVisibleSvgMarker(page, '[data-train-marker]');
    await captureCurrent(page, 'mobile-390x844-train-sheet');
    await page.getByTestId('service-toggle').click();
    await captureCurrent(page, 'mobile-390x844-service-open');
    await capture(page, 360, 740, 'mobile-360x740-default');
  });
});

async function capture(page: import('@playwright/test').Page, width: number, height: number, name: string) {
  await page.setViewportSize({ width, height });
  await page.goto(base, { waitUntil: 'networkidle' });
  await assertVisualSmoke(page);
  await captureCurrent(page, name);
}

async function captureCurrent(page: import('@playwright/test').Page, name: string) {
  await assertVisualSmoke(page);
  await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: true });
}

async function assertVisualSmoke(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('bart-map')).toBeVisible();
  await expect(page.locator('[data-testid^="route-path-"]').first()).toBeVisible();
  await expect(page.locator('[data-station-marker]').first()).toBeVisible();
  await expect(page.locator('[data-train-marker]').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const mapBox = await page.getByTestId('bart-map').boundingBox();
  expect(mapBox?.width || 0).toBeGreaterThan(300);
  expect(mapBox?.height || 0).toBeGreaterThan(500);
}

async function clickVisibleSvgMarker(page: import('@playwright/test').Page, selector: string) {
  const point = await page.locator(selector).evaluateAll((elements) => {
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
      const top = document.elementFromPoint(x, y);
      if (top && (element === top || element.contains(top))) return { x, y };
    }
    return null;
  });
  expect(point).toBeTruthy();
  await page.mouse.click(point!.x, point!.y);
}
