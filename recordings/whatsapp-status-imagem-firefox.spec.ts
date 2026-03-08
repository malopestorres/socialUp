import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://web.whatsapp.com/');
  await page.getByRole('button', { name: 'Status' }).click();
  await page.getByRole('button', { name: 'Add Status', exact: true }).click();
  await page.getByLabel('Photos & videos').locator('div').filter({ hasText: /^ic-filter$/ }).click();
  await page.locator('.x10l6tqk').first().setInputFiles('774.jpg');
  await page.getByRole('textbox', { name: 'Add a caption' }).getByRole('paragraph').click();
  await page.getByRole('textbox', { name: 'Add a caption' }).fill('legenda');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
});