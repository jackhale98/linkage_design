import { expect, test, type Page } from '@playwright/test';

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./');
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function loadExample(page: Page, name: RegExp) {
  await page.locator('summary', { hasText: 'Examples' }).click();
  await page.getByRole('menuitem', { name }).click();
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Properties' });

test('gear pair and rack: meshing gears, tooth forces in the results', async ({ page }) => {
  await page.getByRole('tab', { name: 'Mechanism' }).click();
  await loadExample(page, /Gear pair and rack/);
  await expect(panel(page).getByText('1 degree of freedom · driven')).toBeVisible();
  await expect(page.locator('path.pair')).toHaveCount(4); // two gears, pinion outline and rack teeth
  await panel(page)
    .getByRole('button', { name: /G1 Gear pair/ })
    .click();
  await expect(panel(page).locator('p', { hasText: 'Pitch radii' })).toContainText(
    'Pitch radii 30 and 60 mm (module 3 mm)',
  );
  await page.getByRole('tab', { name: 'Forces' }).click();
  await page.getByRole('tab', { name: 'Results' }).click();
  await expect(page.getByText('Cams and gears')).toBeVisible();
  await expect(page.locator('tr', { hasText: 'gear mesh, tooth force' })).toContainText('200 N');
});

test('cam-driven slide: the mounted cam drives the follower', async ({ page }) => {
  await page.getByRole('tab', { name: 'Motion' }).click();
  await loadExample(page, /Cam-driven slide/);
  await expect(page.getByTestId('mechanism-status')).toHaveText('Full rotation');
  await page.getByRole('tab', { name: 'Results' }).click();
  await page.getByRole('tab', { name: 'Forces' }).click();
  await expect(page.locator('tr', { hasText: 'cam contact' })).not.toContainText('lifts off');
});

test('adding gears between the crank and rocker of a four-bar locks it; deleting frees it', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Load the four-bar example' }).click();
  await page.getByRole('tab', { name: 'Mechanism' }).click();
  await panel(page).getByRole('button', { name: '+ Gears' }).click();
  await expect(page.getByTestId('mechanism-status')).toHaveText('Locked');
  await panel(page).getByRole('button', { name: 'Delete G1' }).click();
  await expect(page.getByTestId('mechanism-status')).not.toHaveText('Locked');
});

test('a cam joint needs a designed cam first', async ({ page }) => {
  await page.getByRole('button', { name: 'Load the four-bar example' }).click();
  await page.getByRole('tab', { name: 'Mechanism' }).click();
  await panel(page).getByRole('button', { name: '+ Cam' }).click();
  await expect(page.getByText('Design a cam in the Cam workspace first')).toBeVisible();
});
