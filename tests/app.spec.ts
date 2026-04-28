import { expect, test, type Page } from '@playwright/test';

const base = '/?demo=1';
const lines = ['Yellow', 'Red', 'Orange', 'Green', 'Blue'];

test.describe('BART Track Live interactions', () => {
  test('initial load renders fallback data, map, routes, stations, trains, and status', async ({ page }) => {
    await gotoDemo(page);
    await expect(page.getByTestId('status-chip')).toContainText('Demo');
    await expect(page.getByTestId('bart-map')).toBeVisible();
    await expect(page.locator('[data-testid^="route-path-"]').first()).toBeVisible();
    await expect(page.locator('[data-station-marker]').first()).toBeVisible();
    await expect(page.locator('[data-train-marker]').first()).toBeVisible();
    await expect(page.getByTestId('network-detail')).toContainText('ETD + GTFS');
  });

  test('live ETD payload with official raw hex colors still infers trains', async ({ page }) => {
    await page.route('**/api/bart/etd?*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          root: {
            time: '1:10 PM PDT',
            station: [
              {
                name: 'MacArthur',
                abbr: 'MCAR',
                etd: [
                  {
                    destination: 'San Francisco International Airport',
                    abbreviation: 'SFIA',
                    estimate: [
                      {
                        minutes: '2',
                        platform: '2',
                        direction: 'South',
                        length: '8',
                        color: 'YELLOW',
                        hexcolor: '#ffff33',
                        delay: '0',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      });
    });
    await page.route('**/api/bart/advisories?*', async (route) => {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ root: { bsa: [] } }) });
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('status-chip')).toContainText('Live');
    await expect(page.locator('[data-train-marker]')).toHaveCount(1);
    await expect(page.getByTestId('network-detail')).toContainText('1 inferred train');
  });

  test('refresh handles rapid repeated clicks without losing data', async ({ page }) => {
    await gotoDemo(page);
    const refresh = page.getByTestId('refresh-button');
    await refresh.click();
    await refresh.click();
    await expect(page.getByTestId('status-chip')).toContainText('Demo');
    await expect(page.locator('[data-train-marker]')).toHaveCount(10);
  });

  test('line filters focus every core line, reset to all, and support reclick reset', async ({ page }) => {
    await gotoDemo(page);
    for (const line of lines) {
      await page.getByTestId(`line-filter-${line}`).click();
      await expect(page.getByTestId(`line-filter-${line}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator(`[data-testid="route-path-${line}"]`).first()).toBeVisible();
      await page.getByTestId(`line-filter-${line}`).click();
      await expect(page.getByTestId('all-lines-button')).toHaveAttribute('aria-pressed', 'true');
    }

    await page.getByTestId('line-filter-Blue').click();
    await page.getByTestId('all-lines-button').click();
    await expect(page.getByTestId('all-lines-button')).toHaveClass(/selected/);
  });

  test('all-lines map keeps every inferred train visible for each line', async ({ page }) => {
    await page.goto(`${base}&scenario=crowded`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('status-chip')).toBeVisible();

    for (const line of lines) {
      const expectedCount = Number(await page.getByTestId(`line-filter-${line}`).locator('strong').innerText());
      await expect(page.locator(`[data-train-marker][aria-label^="${line} line train"]`)).toHaveCount(expectedCount);

      await page.getByTestId(`line-filter-${line}`).click();
      await expect(page.getByTestId(`line-filter-${line}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('[data-train-marker]')).toHaveCount(expectedCount);

      await page.getByTestId('all-lines-button').click();
      await expect(page.getByTestId('all-lines-button')).toHaveAttribute('aria-pressed', 'true');
    }
  });

  test('line focus composes with station selection, train selection, and fit reset', async ({ page }) => {
    await gotoDemo(page);
    await page.getByTestId('line-filter-Yellow').click();
    await page.getByTestId('station-marker-MCAR').click();
    await expect(page.getByTestId('station-detail')).toContainText('MacArthur');
    await page.getByTestId('detail-close-button').click();
    await page.getByTestId('fit-map-button').click();
    await clickVisibleSvgMarker(page, '[data-train-marker]');
    await expect(page.getByTestId('train-detail')).toBeVisible();
    await page.getByTestId('fit-map-button').click();
    await expect(page.getByTestId('bart-map')).toBeVisible();
  });

  test('station search covers empty, partial, exact, lowercase, uppercase, no result, clear, and result click', async ({ page }) => {
    await gotoDemo(page);
    const input = page.getByTestId('station-search-input');
    await expect(page.getByTestId('station-result-12TH')).toBeVisible();

    await input.fill('mac');
    await expect(page.getByTestId('station-result-MCAR')).toBeVisible();
    await input.fill('MacArthur');
    await expect(page.getByTestId('station-result-MCAR')).toBeVisible();
    await input.fill('mcar');
    await expect(page.getByTestId('station-result-MCAR')).toBeVisible();
    await input.fill('MCAR');
    await expect(page.getByTestId('station-result-MCAR')).toBeVisible();
    await input.fill('not-a-bart-station');
    await expect(page.getByTestId('station-no-results')).toBeVisible();
    await page.getByTestId('clear-search-button').click();
    await expect(input).toHaveValue('');
    await input.fill('west oak');
    await page.getByTestId('station-result-WOAK').click();
    await expect(page.getByTestId('station-detail')).toContainText('West Oakland');
  });

  test('station marker selection, deselection, long names, and empty departures are handled', async ({ page }) => {
    await gotoDemo(page);
    await page.getByTestId('station-marker-SFIA').click();
    await expect(page.getByTestId('station-detail')).toContainText('San Francisco International Airport');
    await page.getByTestId('detail-close-button').click();
    await expect(page.getByTestId('network-detail')).toBeVisible();

    await page.getByTestId('station-search-input').fill('South San Francisco');
    await page.getByTestId('station-result-SSAN').click();
    await expect(page.getByTestId('station-detail')).toContainText('South San Francisco');
    await expect(page.getByTestId('empty-departures')).toBeVisible();
  });

  test('train marker selection, selected state, delayed display, and station-after-train transitions work', async ({ page }) => {
    await gotoDemo(page);
    await clickVisibleSvgMarker(page, '[data-train-marker]');
    await expect(page.getByTestId('train-detail')).toBeVisible();
    await expect(page.locator('.train-marker.selected')).toHaveCount(1);
    await page.getByTestId('station-marker-BAYF').click();
    await expect(page.getByTestId('station-detail')).toContainText('Bay Fair');
  });

  test('map zoom buttons, wheel zoom, drag pan, empty map click, and fit reset update the view', async ({ page }) => {
    await gotoDemo(page);
    const map = page.getByTestId('bart-map');
    const initial = await map.getAttribute('viewBox');
    await page.getByTestId('zoom-in-button').click();
    await expect.poll(() => map.getAttribute('viewBox')).not.toBe(initial);
    const zoomed = await map.getAttribute('viewBox');
    await page.getByTestId('zoom-out-button').click();
    await expect.poll(() => map.getAttribute('viewBox')).not.toBe(zoomed);

    const box = await map.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    const beforeWheel = await map.getAttribute('viewBox');
    await page.mouse.wheel(0, -240);
    await expect.poll(() => map.getAttribute('viewBox')).not.toBe(beforeWheel);
    const beforePan = await map.getAttribute('viewBox');
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2 + 20);
    await page.mouse.up();
    await expect.poll(() => map.getAttribute('viewBox')).not.toBe(beforePan);
    await page.getByTestId('fit-map-button').click();
    await expect(page.getByTestId('bart-map')).toBeVisible();
    await page.getByTestId('station-marker-MCAR').click();
    await expect(page.getByTestId('station-detail')).toBeVisible();
    await map.click({ position: { x: 900, y: 760 } });
    await expect(page.getByTestId('network-detail')).toBeVisible();
  });

  test('advisory open, empty, error, and long text states render', async ({ page }) => {
    await gotoDemo(page);
    await page.getByTestId('service-toggle').click();
    await expect(page.getByTestId('advisory-item')).toBeVisible();

    await page.goto(`${base}&scenario=advisory-empty`);
    await page.getByTestId('service-toggle').click();
    await expect(page.getByTestId('advisory-empty')).toBeVisible();

    await page.goto(`${base}&scenario=advisory-error`);
    await page.getByTestId('service-toggle').click();
    await expect(page.getByTestId('advisory-error')).toBeVisible();

    await page.goto(`${base}&scenario=long-advisory`);
    await page.getByTestId('service-toggle').click();
    await expect(page.getByTestId('advisory-item')).toContainText('downtown Oakland');
  });

  test('keyboard activation, tab focus, enter/space, and escape close behavior work', async ({ page }) => {
    await gotoDemo(page);
    await page.getByTestId('line-filter-Red').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('line-filter-Red')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('all-lines-button').focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('all-lines-button')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('station-marker-MCAR').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('station-detail')).toContainText('MacArthur');
    await page.getByTestId('service-toggle').click();
    await expect(page.getByTestId('advisory-item')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('network-detail')).toBeVisible();
    await expect(page.getByTestId('advisory-item')).toBeHidden();
  });

  test('error, no-train, crowded-cluster, and reduced-motion scenarios are honest', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'reduced-motion emulation is verified in Chromium project');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}&scenario=api-error`);
    await expect(page.getByTestId('status-chip')).toContainText(/Demo|Offline|Error/i);
    await page.goto(`${base}&scenario=no-trains`);
    await expect(page.getByTestId('no-train-state')).toBeVisible();
    await page.goto(`${base}&scenario=crowded`);
    await expect.poll(() => page.locator('[data-train-marker]').count()).toBeGreaterThan(10);
  });

  test('mobile touch layout keeps map usable with panel states open and closed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDemo(page);
    await expect(page.getByTestId('map-experience')).toBeVisible();
    await expect(page.getByTestId('detail-drawer')).toBeHidden();
    await page.getByTestId('line-filter-Green').click();
    await expect(page.getByTestId('line-filter-Green')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('station-search-input').fill('bay');
    await page.getByTestId('station-result-BAYF').click();
    await expect(page.getByTestId('station-detail')).toContainText('Bay Fair');
    await clickVisibleSvgMarker(page, '[data-train-marker]');
    await expect(page.getByTestId('train-detail')).toBeVisible();
    await page.getByTestId('detail-close-button').click();
    await page.getByTestId('service-toggle').click();
    await expect(page.getByTestId('advisory-item')).toBeVisible();
    await page.getByTestId('zoom-in-button').click();
    await page.getByTestId('zoom-out-button').click();
    await page.getByTestId('fit-map-button').click();
  });

  test('mobile overlays do not cover details or empty/loading messages', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDemo(page);
    await clickVisibleSvgMarker(page, '[data-train-marker]');
    await page.getByTestId('service-toggle').click();
    await expectNoOverlap(page, '[data-testid="detail-drawer"]', '[data-testid="service-panel"]');

    await page.goto(`${base}&scenario=no-trains`);
    await expect(page.getByTestId('no-train-state')).toBeVisible();
    await expectNoOverlap(page, '[data-testid="no-train-state"]', '[data-testid="service-panel"]');

    await page.goto(`${base}&slow=1`);
    await expect(page.getByTestId('loading-state')).toBeVisible();
    await expectNoOverlap(page, '[data-testid="loading-state"]', '[data-testid="service-panel"]');
  });

  test('mobile API failure explains demo fallback', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/bart/etd?*', async (route) => route.abort());
    await page.route('**/api/bart/advisories?*', async (route) => {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ root: { bsa: [] } }) });
    });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('status-chip')).toContainText('Demo');
    await expect(page.getByTestId('feed-copy')).toContainText('ETD offline');
  });

  test('keyboard tab order reaches map controls before markers', async ({ page }) => {
    await gotoDemo(page);
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'zoom-in-button');
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'zoom-out-button');
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'fit-map-button');
  });

  test('resizing between mobile and desktop has no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await gotoDemo(page);
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expectNoHorizontalOverflow(page);
    await page.reload();
    await expect(page.getByTestId('bart-map')).toBeVisible();
  });
});

async function gotoDemo(page: Page) {
  await page.goto(base, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('status-chip')).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectNoOverlap(page: Page, first: string, second: string) {
  const overlap = await page.evaluate(
    ([firstSelector, secondSelector]) => {
      const firstElement = document.querySelector(firstSelector);
      const secondElement = document.querySelector(secondSelector);
      if (!firstElement || !secondElement) return 0;
      const a = firstElement.getBoundingClientRect();
      const b = secondElement.getBoundingClientRect();
      return Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) *
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    },
    [first, second],
  );
  expect(overlap).toBe(0);
}

async function clickVisibleSvgMarker(page: Page, selector: string) {
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
