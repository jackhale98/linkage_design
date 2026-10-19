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

async function saveProject(page: Page): Promise<string> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save CSV' }).click();
  const d = await download;
  return readFile((await d.path())!, 'utf8');
}

async function openProject(page: Page, name: string, text: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open' }).click();
  await (await chooser).setFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });
}

test('switches workspaces by click and keyboard', async ({ page }) => {
  await page.getByRole('tab', { name: 'Forces' }).click();
  await expect(page.getByRole('tab', { name: 'Forces' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Forces' })).toBeVisible();
  await page.locator('body').press('5');
  await expect(page.getByRole('tab', { name: 'Cam' })).toHaveAttribute('aria-selected', 'true');
});

test('cycles and remembers the theme', async ({ page }) => {
  const html = page.locator('html');
  await page.getByRole('button', { name: /^Theme:/ }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: /^Theme:/ }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
});

test('saves, starts new, and reopens a project byte-for-byte', async ({ page }) => {
  await page.getByLabel('Project name').fill('Toggle clamp, rev "B"');
  await page.getByRole('button', { name: 'in · lbf' }).click();
  await page.getByLabel('Notes').fill('Line 1\nLine 2');

  const saved = await saveProject(page);
  expect(saved.startsWith('﻿LinkageDesign,1\r\n')).toBe(true);
  expect(saved).toContain('name,"Toggle clamp, rev ""B"""');
  expect(saved).toContain('length_unit,in\r\nforce_unit,lbf');

  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByLabel('Project name')).toHaveValue('Untitled mechanism');

  await openProject(page, 'clamp.csv', saved);
  await expect(page.getByLabel('Project name')).toHaveValue('Toggle clamp, rev "B"');
  await expect(page.getByLabel('Notes')).toHaveValue('Line 1\nLine 2');
  expect(await saveProject(page)).toBe(saved);
});

test('rejects a bad file with line numbers and keeps the current project', async ({ page }) => {
  await page.getByLabel('Project name').fill('Keep me');
  await openProject(page, 'broken.csv', 'LinkageDesign,1\n[project]\nkey,value\nlength_unit,cubits\n');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText("Couldn't open broken.csv");
  await expect(dialog).toContainText('Line 4 [project] length_unit: "cubits" is not one of: mm, m, in');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('Project name')).toHaveValue('Keep me');
});

test('reports warnings for preserved unknown sections', async ({ page }) => {
  await openProject(
    page,
    'future.csv',
    'LinkageDesign,1\n[project]\nkey,value\nname,Future\n[gears]\nid,teeth\nG1,24\n',
  );
  await expect(page.getByLabel('Project name')).toHaveValue('Future');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText("Section [gears] isn't used by this version");
  expect(await saveProject(page)).toContain('[gears]\r\nid,teeth\r\nG1,24\r\n');
});

test('undo and redo edits from the keyboard', async ({ page }) => {
  const name = page.getByLabel('Project name');
  await name.fill('First');
  await name.press('Enter');
  await page.getByRole('button', { name: 'm · N', exact: true }).click();
  await page.locator('body').press('ControlOrMeta+z');
  await expect(page.getByLabel('Length')).toHaveValue('mm');
  await page.locator('body').press('ControlOrMeta+Shift+z');
  await expect(page.getByLabel('Length')).toHaveValue('m');
  await expect(name).toHaveValue('First');
});

test('restores the last session after a reload', async ({ page }) => {
  await page.getByLabel('Project name').fill('Autosaved linkage');
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByLabel('Project name')).toHaveValue('Autosaved linkage');
  await expect(page.getByRole('status')).toContainText('Restored your last session');
});

test('zooms the canvas with the controls', async ({ page }) => {
  const scale = page.locator('.scalebar span');
  const before = await scale.textContent();
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(scale).not.toHaveText(before!);
  await page.locator('body').press('f');
  await expect(scale).toHaveText(before!);
});
