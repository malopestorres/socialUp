import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://www.instagram.com/');
  await page.getByRole('textbox', { name: 'Número de celular, nome de' }).click();
  await page.getByRole('textbox', { name: 'Número de celular, nome de' }).fill('sixsourcesoft');
  await page.getByRole('textbox', { name: 'Senha' }).click();
  await page.getByRole('textbox', { name: 'Senha' }).fill('caveirarola');
  await page.getByRole('button', { name: 'Mostrar senha' }).click();
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.goto('https://www.instagram.com/accounts/onetap/');
  await page.getByRole('button', { name: 'Agora não' }).click();
  await page.getByRole('link', { name: 'Novo post Criar' }).click();
  await page.getByRole('link', { name: 'Postar Postar' }).click();
  await page.getByRole('button', { name: 'Selecionar do computador' }).click();
  await page.getByRole('button', { name: 'Selecionar do computador' }).setInputFiles('2828876-hd_720_1280_24fps.mp4');
  await page.getByRole('button', { name: 'OK' }).click();
  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.getByRole('paragraph').click();
  await page.getByRole('textbox', { name: 'Escreva uma legenda...' }).fill('aqui entra legenda ');
  await page.getByRole('textbox', { name: 'Adicionar localização' }).click();
  await page.getByRole('textbox', { name: 'Adicionar localização' }).fill('Rio de');
  await page.getByRole('button', { name: 'Rio De Janeiro, Brazil Rio De' }).click();
  await page.getByRole('button', { name: 'Acessibilidade Ícone de seta' }).click();
  await page.getByRole('textbox', { name: 'Escrever texto alternativo...' }).click();
  await page.getByRole('textbox', { name: 'Escrever texto alternativo...' }).fill('aqui entra texto alternativo');
  await page.getByRole('button', { name: 'Compartilhar', exact: true }).click();
});