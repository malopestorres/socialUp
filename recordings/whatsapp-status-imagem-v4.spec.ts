import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://web.whatsapp.com/');
  await page.getByRole('button', { name: 'Status' }).click();
  await page.getByRole('button').filter({ hasText: 'ic-add' }).nth(3).click();
  await page.getByText('Fotos e vídeos').click();
  await page.locator('.x10l6tqk').first().setInputFiles('933bb8c0-0b61-408c-b9ad-c06fa7e74eae.jpg');
  await page.getByRole('textbox', { name: 'Adicione uma legenda' }).getByRole('paragraph').click();
  await page.getByRole('textbox', { name: 'Adicione uma legenda' }).fill('legenda aqui');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
});