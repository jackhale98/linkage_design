import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./');
  await page.getByRole('button', { name: 'Load the four-bar example' }).click();
  await page.getByRole('tab', { name: 'Forces' }).click();
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const panel = (page: Page) => page.locator('aside');

test('solves joint reactions and draws them on the mechanism', async ({ page }) => {
  await expect(panel(page).getByText(/analysis over \d+ positions/)).toBeVisible();
  await expect(panel(page).getByText(/Power balance check: passed/)).toBeVisible();
  // Reactions and the input torque are drawn over the mechanism.
  await expect(page.locator('path.arrow.reaction').first()).toBeVisible();
  await expect(page.locator('path.torque.driver')).toHaveCount(1);
  await panel(page).getByRole('checkbox', { name: 'Joint reaction forces' }).uncheck();
  await expect(page.locator('path.arrow.reaction')).toHaveCount(0);
});

test('adds a load, switches mode and exports a forces CSV', async ({ page }) => {
  const before = await panel(page).locator('.loads > li').count();
  await panel(page).getByRole('button', { name: '+ Torque' }).click();
  await expect(panel(page).locator('.loads > li')).toHaveCount(before + 1);
  await panel(page).getByRole('radio', { name: 'Static' }).click();
  await expect(panel(page).getByText(/Static analysis over/)).toBeVisible();
  await expect(panel(page).getByText(/Power balance check: passed/)).toBeVisible();

  // Undo restores the previous analysis mode.
  await page.keyboard.press('Control+z');
  await expect(panel(page).getByText(/Kinetostatic analysis over/)).toBeVisible();

  await page.getByRole('tab', { name: 'Results' }).click();
  await expect(page.getByText('Joint forces (peak over the cycle)')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Forces CSV' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('Four-bar_with_coupler_point_forces.csv');
  const csv = await readFile((await d.path())!, 'utf8');
  expect(csv.startsWith('﻿')).toBe(true);
  const header = csv.slice(1).split('\r\n')[0]!;
  expect(header).toMatch(/^input/);
  expect(header).toContain('[N]');
});

test('plots the input torque', async ({ page }) => {
  await page.getByRole('tab', { name: 'Plots' }).click();
  await expect(page.locator('.u-wrap')).toHaveCount(1);
  await expect(page.getByRole('checkbox', { name: /^Input torque\b/ })).toBeChecked();
});
