import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const errors: string[] = [];
let fourBar = '';

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  fourBar ||= await readFile('src/examples/four-bar.csv', 'utf8');
  await page.goto('./');
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function open(page: Page, text: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open' }).click();
  await (
    await chooser
  ).setFiles({ name: 'test.csv', mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });
}

test('shows which way an under-defined sketch can move', async ({ page }) => {
  // Without the rocker length, B and C can swing: one degree of freedom.
  await open(page, fourBar.replace(/^C6,.*\r?\n/m, ''));
  const status = page.getByTestId('sketch-status');
  await expect(status).toHaveText('1 degree of freedom');
  await expect(page.locator('.freedom .mark')).toHaveCount(2);
  await status.click();
  await expect(page.locator('.freedom .mark')).toHaveCount(0);
  await status.click();
  await expect(page.locator('.freedom .mark')).toHaveCount(2);
});

test('highlights the links behind an extra degree of freedom', async ({ page }) => {
  // A pendulum hanging from B adds a second degree of freedom.
  await open(
    page,
    fourBar
      .replace('P5,80.4462575647,93.805849408,0,C', 'P5,80.4462575647,93.805849408,0,C\r\nP6,150,40,0,E')
      .replace('L6,P4,P5,0', 'L6,P4,P5,0\r\nL7,P4,P6,0'),
  );
  await page.getByRole('tab', { name: 'Mechanism' }).click();
  await expect(page.getByTestId('mechanism-status')).toHaveText('2 DOF');
  await expect(
    page.getByText(/With the Crank held still, Link \d can still move \(highlighted\)/),
  ).toBeVisible();
  await expect(page.locator('line.loose')).toHaveCount(1);
  await expect(page.locator('.freedom.over .mark')).toHaveCount(1);
});

test('treats a dimensioned point on a link as a pivot, not a slot', async ({ page }) => {
  // Rocker pivoted on a fixed pin 40 mm along a bar: the pin can't slide.
  const lever = fourBar
    .replace(
      'P5,80.4462575647,93.805849408,0,C',
      'P5,80.4462575647,93.805849408,0,C\r\nP6,160,60,0,\r\nP7,240,60,0,\r\nP8,200,60,1,',
    )
    .replace('L6,P4,P5,0', 'L6,P4,P5,0\r\nL7,P6,P7,0\r\nL8,P4,P6,0')
    .replace(
      'C8,distance,L6,,,45,0,1,7',
      'C8,distance,L6,,,45,0,1,7\r\nC9,point_on_line,P8,L7,,,0,,\r\nC10,distance,P6,P8,,40,0,,',
    );
  await open(page, lever);
  await page.getByRole('tab', { name: 'Mechanism' }).click();
  await expect(page.locator('rect.slot')).toHaveCount(0);
});
