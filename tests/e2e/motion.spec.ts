import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./');
  await page.getByRole('button', { name: 'Load the four-bar example' }).click();
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const status = (page: Page) => page.getByTestId('mechanism-status');
const readout = (page: Page) => page.locator('.readout');

async function loadExample(page: Page, name: RegExp) {
  await page.locator('summary', { hasText: 'Examples' }).click();
  await page.getByRole('menuitem', { name }).click();
}

test('animates the four-bar and scrubs through the cycle', async ({ page }) => {
  await page.getByRole('tab', { name: 'Motion' }).click();
  await expect(status(page)).toHaveText('Full rotation');
  await expect(readout(page)).toContainText('θ = 0.0°');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(readout(page)).not.toContainText('θ = 0.0°');
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByLabel('Driver position').fill('90');
  await expect(readout(page)).toContainText('θ = 90.0°');
  // The traced coupler point draws a closed coupler curve.
  await expect(page.locator('path.trace')).toHaveCount(1);
});

test('plots quantities and exports a kinematics CSV', async ({ page }) => {
  await page.getByRole('tab', { name: 'Motion' }).click();
  await page.getByRole('tab', { name: 'Plots' }).click();
  await expect(page.locator('.u-wrap')).toHaveCount(1);
  // Adding an angle (different unit) adds a second chart rather than a second axis.
  await page.locator('summary', { hasText: /^Rocker$/ }).click();
  await page
    .getByRole('checkbox', { name: /^angle\b/ })
    .last()
    .check();
  await expect(page.locator('.u-wrap')).toHaveCount(2);

  await page.getByRole('tab', { name: 'Results' }).click();
  await expect(page.getByText('Grashof crank-rocker: the crank turns fully')).toBeVisible();
  await expect(page.getByText('Turns a full revolution')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Kinematics CSV' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('Four-bar_with_coupler_point_kinematics.csv');
  const csv = await readFile((await d.path())!, 'utf8');
  expect(csv.startsWith('\uFEFF')).toBe(true); // BOM so Excel reads UTF-8
  const lines = csv.slice(1).trimEnd().split('\r\n');
  expect(lines[0]!.startsWith('input [deg],time [s],A_x [mm]')).toBe(true);
  expect(lines).toHaveLength(362);
});

test('splits and re-merges a rigid coupler', async ({ page }) => {
  await page.getByRole('tab', { name: 'Mechanism' }).click();
  await page.getByRole('button', { name: /^Coupler/ }).click();
  await page.getByRole('button', { name: 'Split into separate links' }).click();
  await expect(page.locator('.list li')).toHaveCount(5);
  // Three pinned bars still form a rigid triangle: the linkage still turns fully.
  await expect(status(page)).toHaveText('Full rotation');
  await page.getByRole('button', { name: /^Coupler/ }).click();
  await page.getByRole('button', { name: /^Link \d+ L5/ }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: /^Link \d+ L6/ }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Merge into one rigid link' }).click();
  await expect(page.locator('.list li')).toHaveCount(3);
  await page.locator('body').press('ControlOrMeta+z');
  await expect(page.locator('.list li')).toHaveCount(5);
});

test('explains a locked mechanism', async ({ page }) => {
  await page.getByRole('tab', { name: 'Mechanism' }).click();
  await page.getByRole('button', { name: /^Rocker/ }).click();
  await page.getByLabel('Fixed to ground').check();
  await expect(status(page)).toHaveText('Locked');
  await expect(page.locator('.issue.error')).toContainText('locked');
});

test('makes a sketch dimension the driver', async ({ page }) => {
  await page.getByRole('tab', { name: 'Mechanism' }).click();
  await page.getByRole('radio', { name: 'None' }).click();
  await expect(status(page)).toHaveText('1 DOF · no driver');
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.locator('.dim-text', { hasText: '60°' }).click({ force: true });
  await page.getByRole('button', { name: 'Use as driver' }).click();
  await expect(page.getByRole('tab', { name: 'Motion' })).toHaveAttribute('aria-selected', 'true');
  await expect(status(page)).toHaveText('Full rotation');
  await expect(page.getByLabel('Driven line (its angle is the input)')).toHaveValue('L2');
});

test('runs the other examples', async ({ page }) => {
  await page.getByRole('tab', { name: 'Motion' }).click();
  await loadExample(page, /Slider-crank/);
  await expect(status(page)).toHaveText('Full rotation');
  await loadExample(page, /Quick-return/);
  await expect(status(page)).toHaveText('Full rotation');
  await loadExample(page, /Hydraulic boom/);
  await expect(status(page)).toHaveText('Ready');
  await expect(readout(page)).toContainText('L = 230.00 mm');
});

test('saves and reopens mechanism data', async ({ page }) => {
  await page.getByRole('tab', { name: 'Mechanism' }).click();
  await page.getByRole('button', { name: /^Rocker/ }).click();
  await page.getByLabel('Name', { exact: true }).fill('Output rocker');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save CSV' }).click();
  const csv = await readFile((await (await download).path())!, 'utf8');
  expect(csv).toContain('Output rocker');
  expect(csv).toContain('[driver]\r\nkey,value\r\ntype,rotary\r\nline,L2\r\n');
  await page.getByRole('button', { name: 'New project' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open' }).click();
  await (await chooser).setFiles({ name: 'four.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByRole('button', { name: /^Output rocker/ })).toBeVisible();
  await expect(status(page)).toHaveText('Full rotation');
});

async function centre(page: Page, point: string) {
  const box = (await page.locator(`circle.pin[data-point="${point}"]`).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('drags the mechanism by hand to try it out, then goes back to the drawn pose', async ({ page }) => {
  await page.getByRole('tab', { name: 'Mechanism' }).click();
  const a = await centre(page, 'P3');
  const o = await centre(page, 'P1');
  // Swing the crank pin A round about O2 by about 90 degrees.
  const r = Math.hypot(a.x - o.x, a.y - o.y);
  const t0 = Math.atan2(-(a.y - o.y), a.x - o.x);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) {
    const t = t0 + (k / 10) * (Math.PI / 2);
    await page.mouse.move(o.x + r * Math.cos(t), o.y - r * Math.sin(t));
  }
  await page.mouse.up();
  const moved = await centre(page, 'P3');
  expect(Math.hypot(moved.x - a.x, moved.y - a.y)).toBeGreaterThan(r * 0.8);
  // It stays on its circle about O2: the joints hold.
  expect(Math.hypot(moved.x - o.x, moved.y - o.y)).toBeCloseTo(r, 0);
  await page.getByRole('button', { name: 'Back to drawn pose' }).click();
  const back = await centre(page, 'P3');
  expect(Math.hypot(back.x - a.x, back.y - a.y)).toBeLessThan(1);
});

test('dragging in Motion moves the driver and keeps the plots in step', async ({ page }) => {
  await page.getByRole('tab', { name: 'Motion' }).click();
  await expect(readout(page)).toContainText('θ = 0.0°');
  const a = await centre(page, 'P3');
  const o = await centre(page, 'P1');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  // Crank pin starts on +x of O2; pull it up and over towards +y.
  const r = Math.hypot(a.x - o.x, a.y - o.y);
  for (let k = 1; k <= 10; k++) {
    const t = (k / 10) * (Math.PI / 2);
    await page.mouse.move(o.x + r * Math.cos(t), o.y - r * Math.sin(t));
  }
  await page.mouse.up();
  await expect(readout(page)).toContainText(/θ = (8[5-9]|9[0-5])\.\d°/);
});

test('runs a limited sweep there and back with a resisting load', async ({ page }) => {
  await loadExample(page, /Hydraulic boom/);
  await page.getByRole('tab', { name: 'Mechanism' }).click();
  await page.getByLabel('There and back: include the return stroke').check();
  await page.getByRole('tab', { name: 'Forces' }).click();
  await page.locator('.loads > li .row').first().click();
  await page.getByLabel('Resists the motion (flips with the direction of travel)').check();
  await page.getByLabel('Driver position').fill('150');
  await expect(readout(page)).toContainText('back');
  await page.getByRole('tab', { name: 'Plots' }).click();
  await expect(page.locator('.u-legend')).toContainText('Actuator force (out)');
  await expect(page.locator('.u-legend')).toContainText('Actuator force (back)');
});
