# Deploy no Coolify

## Objetivo

Documento único de referência para deploy em produção no Coolify.

## Estratégia recomendada

Subir como aplicações separadas no Coolify:

1. `web` (frontend)
2. `backend` (API)
3. `evolution-api` (WhatsApp)
4. Infra separada:
   - PostgreSQL (backend)
   - Redis (locks/cache)
   - RabbitMQ (fila)
   - Banco da Evolution API (se não usar serviço externo)

## Variáveis críticas do backend

- `DATABASE_URL` (PostgreSQL)
- `REDIS_URL`
- `RABBITMQ_URL`
- `EVOLUTION_API_BASE_URL`
- `EVOLUTION_API_KEY`
- `INSTAGRAM_GRAPH_APP_ID`
- `INSTAGRAM_GRAPH_APP_SECRET`
- `INSTAGRAM_GRAPH_REDIRECT_URI`
- `INSTAGRAM_GRAPH_PUBLIC_BASE_URL`
- `INSTAGRAM_OAUTH_*` (quando usar app OAuth dedicado)

## Nota local (Prisma)

Os scripts Prisma do backend carregam automaticamente o `.env` da raiz do monorepo via `scripts/run-with-root-env.mjs`.

- `npm run prisma:migrate`
- `npm run prisma:seed`

Assim não é necessário `export DATABASE_URL` manualmente no shell.

## Instagram (produção)

As URLs precisam ser públicas e HTTPS:

- Callback OAuth deve apontar para o backend em produção
- Base pública de mídia (`INSTAGRAM_GRAPH_PUBLIC_BASE_URL`) precisa expor `/uploads/*`

## Deploy contínuo

- Fonte: GitHub
- Branch de produção definida no Coolify
- Auto deploy em push
- Secrets e env vars definidos no painel (não versionar secrets no Git)

## Checklist pós-deploy

1. `GET /health` do backend retorna `ok`.
2. Login do painel funcionando.
3. Criação de agendamento salva no banco.
4. Dispatcher move job para `RUNNING`.
5. Consumer processa fila e finaliza status.
6. Avisos/notificações aparecendo no painel.
7. Fluxo de conexão de contas (Instagram/WhatsApp) validado.

## Manutenção

Este arquivo deve ser atualizado sempre que:

- nova dependência de infraestrutura for adicionada,
- alguma variável obrigatória de produção mudar,
- fluxo de autenticação/publicação for alterado.
