import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./');
  await page.getByRole('tab', { name: 'Cam' }).click();
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const panel = (page: import('@playwright/test').Page) => page.getByLabel('Properties');

test('starts a cam from the standard program and checks it', async ({ page }) => {
  await page.getByRole('button', { name: 'Start from dwell, rise, dwell, return' }).first().click();
  await expect(panel(page).getByText('360° of 360°')).toBeVisible();
  await expect(panel(page).getByText('All checks pass')).toBeVisible();
  await expect(page.locator('path.body')).toHaveCount(1);

  // A constant-velocity rise breaks the fundamental law.
  await panel(page).getByLabel('S2 motion law').selectOption('constant_velocity');
  await expect(panel(page).getByText(/Velocity jumps at 60°/)).toBeVisible();

  // Durations that don't add up are reported.
  await panel(page).getByLabel('S1 duration').fill('50');
  await panel(page).getByLabel('S1 duration').press('Enter');
  await expect(panel(page).getByText('350° of 360°')).toBeVisible();
  await expect(panel(page).getByText(/must add up to 360°/)).toBeVisible();
});

test('plays the example cam and exports its SVAJ and profile', async ({ page }) => {
  await page.getByRole('button', { name: 'Load the cam example' }).click();
  await expect(panel(page).getByText('All checks pass')).toBeVisible();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.readout')).not.toContainText('θ = 0.0°');
  await page.getByRole('button', { name: 'Pause' }).click();

  await page.getByRole('tab', { name: 'Plots' }).click();
  await expect(page.locator('.u-wrap')).toHaveCount(4); // s, v, a, j: one unit each

  await page.getByRole('tab', { name: 'Results' }).click();
  await expect(page.getByText(/Pressure angle\. Peaks at 23\.\d+°/)).toBeVisible();
  const svaj = page.waitForEvent('download');
  await page.getByRole('button', { name: 'SVAJ CSV' }).click();
  const d = await svaj;
  expect(d.suggestedFilename()).toBe('Dwell-rise-dwell_cam_cam_svaj.csv');
  const csv = await readFile((await d.path())!, 'utf8');
  expect(csv.slice(1).split('\r\n')[0]).toMatch(/^cam_angle \[deg\],time \[s\],s \[mm\],v \[mm\/s\]/);
  const dxf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'DXF' }).click();
  expect((await dxf).suggestedFilename()).toBe('Dwell-rise-dwell_cam_cam.dxf');
});

test('switches follower types and flags undercut', async ({ page }) => {
  await page.getByRole('button', { name: 'Load the cam example' }).click();
  await panel(page).getByLabel('Follower type').selectOption('translating_flat');
  await panel(page).getByLabel('Base circle radius').fill('10');
  await panel(page).getByLabel('Base circle radius').press('Enter');
  await expect(panel(page).getByText(/Undercut: the flat face cannot follow/)).toBeVisible();
  await expect(page.locator('path.undercut').first()).toBeVisible();
});
