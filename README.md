# SocialUp Local

Sistema local, multi-empresa e sem cloud para automacao de postagens:

- `apps/backend`: API Express + Prisma + SQLite + uploads locais
- `apps/web`: painel web em React + TypeScript
- `apps/agent`: agente desktop em Electron + Playwright
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

Terminal 3:

```bash
npm run dev:agent
```

## Fluxo

1. Crie uma Organization.
2. Crie uma Company vinculada.
3. Crie um Agent e gere/rotacione o token.
4. No Electron, informe a URL da API e o token para parear.
5. Faça upload da midia e crie Jobs no painel escolhendo a Company.
6. O Agent busca apenas Jobs da propria Company, executa via Playwright e atualiza o status.

## Observacoes

- Todo armazenamento e local.
- O backend e a fonte da verdade.
- O Agent nao guarda estado de negocio; guarda apenas o pareamento local.
- A automacao usa navegadores headful com perfil persistido.

