import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://web.whatsapp.com/');
  await page.getByRole('button', { name: 'Status' }).click();
  await page.getByRole('button', { name: 'Meu status Clique para' }).click();
  await page.getByText('Fotos e vídeos').click();
  await page.locator('.x10l6tqk').first().setInputFiles('774.jpg');
  await page.getByRole('textbox', { name: 'Adicione uma legenda' }).fill('teste');
  await page.getByRole('button', { name: 'Abrir o painel de emojis' }).click();
  await page.getByRole('button', { name: '🙁' }).click();
  await page.locator('.x78zum5.x1iyjqo2.xs83m0k.x1r8uery.xdt5ytf.x6s0dn4').click();
  await page.locator('.x10l6tqk.x13vifvy.x1o0tod.xh8yej3 > .xh8yej3.x5yr21d').press('ControlOrMeta+-');
  await page.locator('.x10l6tqk.x13vifvy.x1o0tod.xh8yej3 > .xh8yej3.x5yr21d').press('ControlOrMeta+-');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
});