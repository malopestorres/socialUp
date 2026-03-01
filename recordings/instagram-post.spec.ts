import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://www.instagram.com/');
  await page.getByRole('textbox', { name: 'Número de celular, nome de' }).click();
  await page.getByRole('textbox', { name: 'Número de celular, nome de' }).fill('sixsourcesoft');
  await page.getByRole('textbox', { name: 'Senha' }).click();
  await page.getByRole('textbox', { name: 'Senha' }).fill('caveirarola');
  await page.getByRole('button', { name: 'Mostrar senha' }).click();
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('button', { name: 'Agora não' }).click();
  await page.getByRole('link', { name: 'Novo post Criar' }).click();
  await page.getByRole('link', { name: 'Postar Postar' }).click();
  await page.getByRole('button', { name: 'Selecionar do computador' }).click();
  await page.getByRole('button', { name: 'Selecionar do computador' }).setInputFiles('774.jpg');
  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.getByRole('textbox', { name: 'Escreva uma legenda...' }).click();
  await page.getByRole('textbox', { name: 'Escreva uma legenda...' }).fill('legenda aqui');
  await page.getByRole('textbox', { name: 'Adicionar localização' }).click();
  await page.getByRole('textbox', { name: 'Adicionar localização' }).press('Shift+CapsLock');
  await page.getByRole('textbox', { name: 'Adicionar localização' }).fill('RIO DE JANEIRO');
  await page.getByRole('button', { name: 'Rio De Janeiro, Brazil Rio De' }).click();
  await page.getByRole('button', { name: 'Acessibilidade Ícone de seta' }).click();
  await page.getByRole('textbox', { name: 'Escrever texto alternativo...' }).click();
  await page.getByRole('textbox', { name: 'Escrever texto alternativo...' }).fill('TEXTO ALTERNATIVO AQUI');
  await page.getByRole('button', { name: 'Compartilhar', exact: true }).click();
});