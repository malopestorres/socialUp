import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://web.whatsapp.com/');
  await page.getByRole('button', { name: 'Status' }).click();
  await page.getByRole('button', { name: 'Add Status' }).click();
  await page.getByText('Fotos e vídeos').click();
  await page.locator('.x10l6tqk').first().setInputFiles('774.jpg');
  await page.getByRole('textbox', { name: 'Adicione uma legenda' }).fill('legenda aqui');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
});