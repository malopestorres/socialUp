import { test, expect, devices } from '@playwright/test';

test.use({
  ...devices['Pixel 7'],
});

test('test', async ({ page }) => {
  await page.goto('https://web.whatsapp.com/mobile/');
});