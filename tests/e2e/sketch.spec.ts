import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./');
  await expect(page.getByRole('tab', { name: 'Sketch' })).toBeVisible();
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** Canvas-relative mouse helpers using the rendered SVG geometry. */
async function canvas(page: Page) {
  const box = (await page.locator('.viewport').boundingBox())!;
  const at = (x: number, y: number) => [box.x + x, box.y + y] as const;
  const attr = (sel: string, a: string) => page.locator(sel).getAttribute(a).then(Number);
  return {
    click: (x: number, y: number) => page.mouse.click(...at(x, y)),
    dblclick: (x: number, y: number) => page.mouse.dblclick(...at(x, y)),
    async drag(from: [number, number], to: [number, number]) {
      await page.mouse.move(...at(...from));
      await page.mouse.down();
      await page.mouse.move(...at(...to), { steps: 6 });
      await page.mouse.up();
    },
    async point(id: string): Promise<[number, number]> {
      const sel = `circle.point[data-id="${id}"]`;
      return [await attr(sel, 'cx'), await attr(sel, 'cy')];
    },
    async lineMid(id: string): Promise<[number, number]> {
      const sel = `line.line[data-id="${id}"]`;
      const [x1, y1, x2, y2] = (await Promise.all(['x1', 'y1', 'x2', 'y2'].map((a) => attr(sel, a)))) as [
        number,
        number,
        number,
        number,
      ];
      return [(x1 + x2) / 2, (y1 + y2) / 2];
    },
  };
}

async function saveProject(page: Page): Promise<string> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save CSV' }).click();
  return readFile((await (await download).path())!, 'utf8');
}

const status = (page: Page) => page.getByTestId('sketch-status');

test('draws a closed triangle with the line tool', async ({ page }) => {
  const c = await canvas(page);
  await page.keyboard.press('l');
  for (const [x, y] of [
    [300, 450],
    [600, 450],
    [450, 250],
  ] as const)
    await c.click(x, y);
  const start = await c.point('P1');
  await c.click(...start); // closing onto the first point ends the chain
  await expect(page.locator('line.line')).toHaveCount(3);
  await expect(page.locator('circle.point')).toHaveCount(3);
  // The first segment was within 3 degrees of horizontal, so it got a horizontal constraint.
  const csv = await saveProject(page);
  expect(csv).toMatch(/\r\nL1,P1,P2,0\r\nL2,P2,P3,0\r\nL3,P3,P1,0\r\n/);
  expect(csv).toMatch(/\r\nC1,horizontal,L1,/);
  await expect(status(page)).toHaveText(/5 degrees of freedom/);
});

test('dimensions a line, accepting an expression', async ({ page }) => {
  const c = await canvas(page);
  await page.keyboard.press('l');
  await c.click(300, 450);
  await c.click(600, 450);
  await page.keyboard.press('Escape');
  await page.keyboard.press('d');
  const mid = await c.lineMid('L1');
  await c.click(mid[0] - 40, mid[1]);
  await c.click(mid[0], mid[1] + 40);
  const editor = page.getByRole('textbox', { name: 'Distance value' });
  await expect(editor).toBeFocused();
  await editor.fill('=2*40+5');
  await editor.press('Enter');
  await expect(editor).toBeHidden();
  await expect(page.locator('.dim-text')).toHaveText('85');
  expect(await saveProject(page)).toMatch(/\r\nC2,distance,L1,,,85,0,/);
});

test('edits the example, stays fully defined, and undoes', async ({ page }) => {
  await page.getByRole('button', { name: 'Load the four-bar example' }).click();
  await expect(status(page)).toHaveText('Fully defined');
  await page.locator('.dim-text', { hasText: /^110$/ }).dblclick({ force: true });
  const editor = page.getByRole('textbox', { name: 'Distance value' });
  await editor.fill('120');
  await editor.press('Enter');
  await expect(page.locator('.dim-text', { hasText: /^120$/ })).toBeVisible();
  await expect(status(page)).toHaveText('Fully defined');
  await page.locator('body').press('ControlOrMeta+z');
  await expect(page.locator('.dim-text', { hasText: /^110$/ })).toBeVisible();
});

test('refuses an impossible dimension and keeps the old value', async ({ page }) => {
  await page.getByRole('button', { name: 'Load the four-bar example' }).click();
  await page.locator('.dim-text', { hasText: /^50$/ }).dblclick({ force: true });
  const editor = page.getByRole('textbox', { name: 'Distance value' });
  await editor.fill('500');
  await editor.press('Enter');
  await expect(page.locator('.toast.warning')).toContainText("Can't reach that value");
  await expect(editor).toBeVisible();
  await editor.press('Escape');
  await expect(page.locator('.dim-text', { hasText: /^50$/ })).toBeVisible();
});

test('applies relations from the keyboard and refuses conflicts', async ({ page }) => {
  const c = await canvas(page);
  await page.keyboard.press('l');
  await c.click(300, 450);
  await c.click(500, 300);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await c.click(...(await c.lineMid('L1')));
  await expect(page.getByRole('heading', { name: 'Line L1' })).toBeVisible();
  await page.keyboard.press('v');
  const [x1, x2] = await Promise.all(['x1', 'x2'].map((a) => page.locator('line.line').getAttribute(a)));
  expect(Number(x1)).toBeCloseTo(Number(x2), 3);
  await page.keyboard.press('h');
  await expect(page.locator('.toast.warning')).toContainText(
    'Horizontal conflicts with the existing constraints',
  );
});

test('drags free geometry but not fully defined geometry', async ({ page }) => {
  await page.getByRole('button', { name: 'Load the four-bar example' }).click();
  const c = await canvas(page);
  const b = await c.point('P4');
  await c.drag(b, [b[0] + 60, b[1] - 60]);
  expect(await c.point('P4')).toEqual(b);
  // Make the crank angle a reference: the linkage gains one degree of freedom.
  await page.locator('.dim-text', { hasText: '60°' }).click({ force: true });
  await page.getByLabel("Reference (measured, doesn't drive geometry)").check();
  await expect(status(page)).toHaveText('1 degree of freedom');
  await page.keyboard.press('Escape');
  const a = await c.point('P3');
  await c.drag(a, [a[0] - 40, a[1] - 20]);
  const moved = await c.point('P3');
  expect(Math.hypot(moved[0] - a[0], moved[1] - a[1])).toBeGreaterThan(10);
  await expect(page.locator('.dim-text', { hasText: /^\(\d+(\.\d+)?°\)$/ })).toBeVisible();
});

test('deletes the selection with its constraints', async ({ page }) => {
  await page.getByRole('button', { name: 'Load the four-bar example' }).click();
  const c = await canvas(page);
  await c.click(...(await c.lineMid('L6')));
  await page.keyboard.press('Delete');
  await expect(page.locator('line.line')).toHaveCount(5);
  await expect(page.locator('.dim-text', { hasText: /^45$/ })).toHaveCount(0);
  await expect(status(page)).toHaveText('1 degree of freedom');
});

test('edits points from the tables panel', async ({ page }) => {
  await page.getByRole('button', { name: 'Load the four-bar example' }).click();
  await page.getByRole('tab', { name: 'Tables' }).click();
  const fixed = page.getByLabel('P2 fixed');
  await expect(fixed).not.toBeChecked();
  const x = page.getByLabel('P1 x');
  await x.fill('10');
  await x.press('Enter');
  // P1 is fixed, so typed coordinates can't move it.
  await expect(x).toHaveValue('0');
});
