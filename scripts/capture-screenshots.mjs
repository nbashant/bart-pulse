import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir = join(process.cwd(), 'artifacts/screenshots');
mkdirSync(outDir, { recursive: true });

const shots = [
  { name: 'desktop-1440x900-default', viewport: { width: 1440, height: 900 } },
  { name: 'desktop-1280x800-default', viewport: { width: 1280, height: 800 } },
  { name: 'tablet-834x1112-default', viewport: { width: 834, height: 1112 } },
  { name: 'mobile-390x844-closed', viewport: { width: 390, height: 844 }, mobile: true },
  { name: 'selected-station', viewport: { width: 1440, height: 900 }, action: async (page) => page.getByTestId('station-marker-MCAR').click() },
  { name: 'selected-train', viewport: { width: 1440, height: 900 }, action: async (page) => page.locator('[data-train-marker]').first().click() },
  { name: 'focused-yellow-line', viewport: { width: 1440, height: 900 }, action: async (page) => page.getByTestId('line-filter-Yellow').click() },
  {
    name: 'zoom-pan',
    viewport: { width: 1440, height: 900 },
    action: async (page) => {
      await page.getByTestId('zoom-in-button').click();
      const box = await page.getByTestId('bart-map').boundingBox();
      await page.mouse.move(box.x + 720, box.y + 440);
      await page.mouse.down();
      await page.mouse.move(box.x + 810, box.y + 480);
      await page.mouse.up();
    },
  },
  { name: 'service-open', viewport: { width: 1440, height: 900 }, action: async (page) => page.getByTestId('service-toggle').click() },
  {
    name: 'mobile-panel-open',
    viewport: { width: 390, height: 844 },
    mobile: true,
    action: async (page) => {
      await page.getByTestId('station-search-input').fill('mac');
      await page.getByTestId('station-result-MCAR').click();
    },
  },
];

const browser = await chromium.launch();
for (const shot of shots) {
  const page = await browser.newPage({
    viewport: shot.viewport,
    isMobile: Boolean(shot.mobile),
    hasTouch: Boolean(shot.mobile),
  });
  await page.goto('http://127.0.0.1:5173/?demo=1', { waitUntil: 'networkidle' });
  if (shot.action) await shot.action(page);
  await page.screenshot({ path: join(outDir, `${shot.name}.png`), fullPage: true });
  await page.close();
}
await browser.close();

console.log(`Saved ${shots.length} screenshots to ${outDir}`);
