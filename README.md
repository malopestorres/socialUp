# SocialUp Local

Sistema centralizado para automacao de postagens:

- `apps/backend`: API Express + Prisma + SQLite + Playwright (Instagram) + Evolution API (WhatsApp)
- `apps/web`: painel web em React + TypeScript
- `packages/shared`: tipos compartilhados

## Requisitos

- Node.js 20+
- npm 10+

## Instalacao

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
```

## Rodando localmente

Terminal 1:

```bash
npm run dev:backend
```

Terminal 2:

```bash
npm run dev:web
```

Atalho para stack WhatsApp local (Evolution API + Postgres local):

```bash
npm run dev:whatsapp
```

Para parar:

```bash
npm run stop:whatsapp
```

## Fluxo

1. Crie uma Organization.
2. Crie uma Company vinculada.
3. Conecte uma conta do Instagram ou WhatsApp para a unidade.
4. Faça upload da midia e crie Jobs no painel escolhendo a Company.
5. O backend executa Instagram com Playwright e WhatsApp com Evolution API, atualizando o status no painel.

## Observacoes

- Todo armazenamento e local no servidor.
- O backend e a fonte da verdade.
- Instagram usa navegadores persistidos com Playwright.
- WhatsApp usa uma instancia autenticada na Evolution API.

## WhatsApp (Evolution API)

Para contas WhatsApp no painel:

- `loginIdentifier` = `instanceName`
- `secret` = API Key da instancia (opcional se `EVOLUTION_API_KEY` estiver no backend)

Variaveis opcionais do backend:

- `EVOLUTION_API_BASE_URL` (padrao: `http://localhost:8080`)
- `EVOLUTION_API_KEY` (recomendado, API Key global da Evolution)
- `EVOLUTION_API_QR_POLL_INTERVAL_MS` (padrao: `4000`)
- `EVOLUTION_API_TIMEOUT_MS` (padrao: `45000`)
- `EVOLUTION_INSTANCE_INTEGRATION` (padrao: `WHATSAPP-BAILEYS`)
- `EVOLUTION_HARD_CODED_INSTANCE_NAME` (opcional, modo hardcoded local)
- `EVOLUTION_HARD_CODED_INSTANCE_API_KEY` (opcional, sobrescreve API key no hardcoded)
