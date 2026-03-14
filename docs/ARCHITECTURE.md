# SocialUp Architecture

## Overview

SocialUp is a scheduling platform for Instagram and WhatsApp with a local-first stack.

- Instagram runtime: Meta Graph API (official) with OAuth consent flow.
- WhatsApp runtime: Evolution API (QR auth + status send).
- Backend is the source of truth for auth, uploads, jobs, logs, and scheduling state.

Related docs:

- `docs/INSTAGRAM_LOCATION_APPROVAL_PLAYBOOK.md`: passo a passo para habilitar localização com login Instagram após aprovação do app na Meta.
- `docs/DEPLOY_COOLIFY.md`: referência de deploy e operação em produção no Coolify.

## Monorepo Layout

- `apps/backend`: Express API + Prisma + dispatcher loops + RabbitMQ consumers + Redis locks
- `apps/web`: React + TypeScript admin panel
- `packages/shared`: shared DTOs and core enums

Main backend files:

- `apps/backend/src/index.ts`: routes, workers, scheduling rules, logs/avisos
- `apps/backend/src/instagram-graph-api.ts`: Instagram OAuth + Graph API publish
- `apps/backend/src/whatsapp-evolution-api.ts`: WhatsApp QR/session/status via Evolution API
- `apps/backend/src/infra-rabbitmq.ts`: enqueue + consume pipeline for job execution
- `apps/backend/src/infra-redis.ts`: distributed locks (connection execution lock, with local fallback)
- `apps/backend/prisma/schema.prisma`: schema (PostgreSQL via `DATABASE_URL`)

Main frontend files:

- `apps/web/src/App.tsx`: main UI (dashboard, connect accounts, scheduler, history, media, avisos)
- `apps/web/src/api.ts`: HTTP client with admin session token
- `apps/web/src/styles.css`: design system, responsive layout, and visual identity (sidebar/header/buttons)
- Frontend layout baseline: top global header (`full-width`, white background) + compact sidebar navigation below it
- `apps/web/src/assets/logo.svg`: active logo used in panel and login
- `apps/web/src/assets/fonts/K2D-Thin.woff`, `apps/web/src/assets/fonts/K2D-Medium.woff`: primary UI fonts
- Quick emoji picker is shared by scheduler caption and root `Cadastrar avisos` message editor (`renderQuickEmojiPicker` in `App.tsx`), now as a compact floating popover (quick set + "Ver todos"), preserving lightweight UI.

## Core Entities

- `Organization`: top-level business
- `Company`: unit/branch
- `User`: panel admin account
  - Includes `timeZone` (IANA, default `America/Sao_Paulo`) used by frontend for date rendering and "hora atual" logic.
  - Includes per-user billing discount controls:
    - `billingDiscountEnabled` (boolean)
    - `billingDiscountPercent` (0-100)
- `SocialConnection`: Instagram/WhatsApp account for a company
- `Job`: scheduled publication
  - New naming field: `title` (short internal title used in UI lists and notifications; legacy jobs still fallback to `caption` when `title` is empty)
  - Optional field: `firstComment` (Instagram Post/Reel), publicado automaticamente após a mídia principal
  - Optional relink fields for Instagram Post/Reel/Story único:
    - `whatsappRelinkEnabled` (boolean)
    - `whatsappRelinkConnectionIds` (JSON array, multiple WhatsApp accounts)
    - `whatsappRelinkDispatchedAt` (DateTime)
    - `instagramPermalink` (string)
    - Relink now creates `WhatsApp Status (mídia)` using the first media of the Instagram publication.
    - Caption behavior:
      - Instagram Post/Reel: original caption + permalink
      - Instagram Story: permalink only
      - if caption is empty: permalink only
    - Instagram Post with image: backend generates a vertical `9:16` relink image with the original media centered and a blurred version of the same media in the background before sending to WhatsApp.
  - Publication state field: `publicationState` (`PUBLISHED` | `DRAFT`)
    - `PUBLISHED`: entra no worker na data/hora agendada
    - `DRAFT`: permanece salvo no histórico e não entra em execução automática
- `AgentLog`: operation logs and errors
- `Aviso`: user notifications (bell + notices page)
- `Plan`: catálogo de planos com limites operacionais e metadados Stripe
  - Em plano pago, o root vincula `stripeProductId` e o backend resolve/atualiza automaticamente os Price IDs por modo/ciclo:
    - Assinatura recorrente: `stripeMonthlyPriceId`, `stripeYearlyPriceId`
    - PIX avulso: `stripePixMonthlyPriceId`, `stripePixYearlyPriceId`
- `UserPlanSubscription`: plano ativo por usuário (status, trial, ciclo, bloqueio e datas)

`Job.publicationType`:

- `instagram_post`
- `instagram_reel`
- `instagram_story`
- `whatsapp_status_midia`
- `whatsapp_status_texto` (code path kept for future)

## Authentication Flows

### Admin Panel

- `POST /auth/login`
- `GET /auth/me`
- `PUT /auth/profile`
- `POST /auth/logout`

Session token is persisted by frontend (local/session storage).
`/auth/login`, `/auth/me` and `/auth/profile` now return/update `user.timeZone`.

### Instagram (Meta OAuth)

1. User clicks `Abrir login` on an Instagram connection.
2. Backend `POST /connections/:id/open-visual-auth` generates OAuth URL with state.
3. Frontend opens consent in a new browser tab.
4. Meta redirects to backend callback: `GET /oauth/instagram/callback`.
5. Backend exchanges code for access token, resolves Instagram Business account, stores token and IG user id in `SocialConnection`, sets `authStatus=CONNECTED`.
6. User can close the OAuth tab; frontend refreshes connection status automatically.

Notes:

- `Marcar conectada` is no longer used for Instagram.
- If token is invalid/expired, workers return `LOGIN_REQUIRED_INSTAGRAM` and connection goes back to `AUTH_REQUIRED`.
- OAuth flow is configurable:
  - `INSTAGRAM_OAUTH_FLOW=instagram_login` (default, opens `instagram.com/oauth/authorize`)
  - `INSTAGRAM_OAUTH_FLOW=facebook_login` (legacy, opens `facebook.com/dialog/oauth`)

### WhatsApp (Evolution API)

1. User clicks `Gerar novo QR`.
2. Backend requests/polls QR from Evolution API.
3. User scans QR in phone.
4. Connection becomes `CONNECTED`.

## Publication Workers

Execution is split into two layers:

- Dispatcher loops (backend polling): select due jobs and move `PENDING`/`WAITING_LOGIN` -> `RUNNING`.
- RabbitMQ consumer: receives queued jobs and executes publish logic.

Current dispatchers:

- `startServerInstagramJobWorker()` (dispatcher only)
- `startServerWhatsappJobWorker()` (dispatcher only)
- `startInstagramTokenKeepAliveWorker()` (token keep-alive polling, Instagram only)

Current execution consumer:

- `startRabbitJobExecutionConsumer()` -> `processQueuedJobMessage(...)`

### Dispatch Layer (Polling)

- Polls due jobs with `publicationState=PUBLISHED`.
- Validates:
  - social connection exists
  - connection platform matches job type
  - connection auth status is usable (`CONNECTED`)
- If auth is missing, moves job to `WAITING_LOGIN`.
- Marks valid jobs as `RUNNING` and enqueues execution message in RabbitMQ.
- Before queueing, dispatch layer also validates billing/subscription state of job owner.
- If billing is blocked/expired, job is moved to failure with aviso/log of bloqueio.

### Execution Layer (RabbitMQ Consumer)

- Consumes `socialup.jobs.execute` queue.
- Applies distributed connection lock via Redis (`job:connection:executing:<connectionId>`), preventing parallel publish on same account across worker instances.
- Runs platform-specific execution:
  - Instagram: Graph API publish (`post`, `reel`, `story`, carousel/story sequence rules)
  - WhatsApp: Evolution API status send (+ persistence check in `status@broadcast`)
- Updates final job status:
  - Instagram: `COMPLETED`, `FAILED`, `WAITING_LOGIN`, or auto-retry back to `PENDING`
  - WhatsApp: `COMPLETED` (when persisted), `SENT_UNCONFIRMED`, `FAILED`, or `WAITING_LOGIN`
- Emits `Aviso` + `AgentLog`.
- Consumer also enforces billing state before execution to avoid running blocked accounts.

### WhatsApp Execution Notes

- Status recipients are resolved via Evolution contacts (`/chat/findContacts/:instance`) and filtered to valid personal JIDs:
  - excludes groups (`@g.us`)
  - excludes system contact (`0@s.whatsapp.net`)
  - excludes `@lid` entries for status broadcast stability
- Owner JID (`ownerJid`) is prioritized in recipients to improve self-visibility in `Meu status`.
- Backend sends `statusJidList` explicitly instead of relying only on `allContacts=true`.
- After send, backend polls Evolution (`/chat/findMessages/:instance`) using returned `messageId`:
  - if found in `status@broadcast` fromMe: marks job `COMPLETED`
  - if not found after retries: keeps `SENT_UNCONFIRMED`

### Instagram Execution Notes

- Publish host:
  - `instagram_login`: `graph.instagram.com`
  - `facebook_login`: `graph.facebook.com`
- Before execution, consumer may run proactive token refresh (cooldown-based).
- Keep-alive worker periodically refreshes tokens of connected Instagram accounts.
- Keep-alive refresh failures are soft by default (connection remains `CONNECTED`).
- Automatic disconnection on keep-alive `LOGIN_REQUIRED_INSTAGRAM` is optional via env:
  - `INSTAGRAM_KEEPALIVE_FORCE_DISCONNECT_ON_LOGIN_REQUIRED=true`
- If a real publish attempt returns `LOGIN_REQUIRED_INSTAGRAM`, the job goes `WAITING_LOGIN` and connection transitions to `AUTH_REQUIRED`.
- For `instagram_post` and `instagram_reel`, backend tries:
  1. explicit `location_id` (if provided/forced)
  2. legacy name payload (if available)
  3. automatic page-based fallback (when available)
- Location failure does not block publishing (optional field).
- Transient errors may auto-retry by rescheduling job as `PENDING` with delay.
- Story sequence keeps anti-duplication safeguards and avoids unsafe full-job auto-retry when partial publish already happened.
- Story sequence step now performs up to `2` silent retries behind the scenes (`3` attempts total counting the first try) before failing the sequence.
- If a story sequence fails after partial publish, the original job remains `FAILED`, but the UI offers a dedicated action to create a new job only with the remaining media scheduled for `+20 min`.
- Em `instagram_post` e `instagram_reel`, após publicar a mídia principal, o worker tenta publicar `firstComment` (quando configurado) sem falhar o job principal se o comentário não for aceito.

## Upload and Media URL Strategy

- Upload endpoint: `POST /upload` (Multer), files under `apps/backend/uploads`.
- Jobs store `filePath` (`/uploads/...`).
- No formulário de agendamento, `instagram_post` e `instagram_story` entram automaticamente em modo sequencial quando há mais de 1 mídia enviada (não há toggle manual).
- O scheduler permite legenda por mídia (`fileCaptions`) via modal em cada miniatura; o backend mantém ordem + legendas no bundle interno da mídia.
- No formulário de agendamento existe seleção explícita de estado da publicação (`Publicado` ou `Rascunho`).
- Instagram Graph publish requires public HTTP(S) media URL reachable by Meta.
- Backend composes this URL from `INSTAGRAM_GRAPH_PUBLIC_BASE_URL + filePath`.
- Frontend valida arquivo antes do upload para Instagram imagem (`instagram_post` e imagem de `instagram_story`) com limite de `8 MB`.
- Frontend valida proporção de imagem para `instagram_post` antes do upload (intervalo suportado: `4:5` até `1.91:1`).
- Backend reforça a mesma regra ao criar/editar jobs para impedir envio inválido para a Graph API.
- Backend também valida proporção de `instagram_post` lendo dimensões de JPG/PNG no arquivo local, para cobrir mídias reutilizadas.
- Backend codifica internamente `location_id` junto do `locationName` no banco (sem migração de schema) e decodifica na API/worker.

## Key Backend Routes

Connections:

- `GET /connections`
- `GET /connections/:id/instagram-location-candidates`
- `POST /connections`
- `PUT /connections/:id`
- `POST /connections/:id/open-visual-auth`
- `POST /connections/:id/regenerate-qr`
- `POST /connections/:id/dismiss-qr`
- `POST /connections/:id/disconnect`
- `DELETE /connections/:id`

Instagram OAuth callback (public route):

- `GET /oauth/instagram/callback`

Jobs:

- `GET /jobs`
- `GET /jobs/instagram-location-suggestions`
- `POST /jobs`
- `PUT /jobs/:id`
- `DELETE /jobs/:id`
- `POST /jobs/:id/retry`
- `POST /jobs/:id/reschedule-failed-media` (reagenda a mídia inteira ou apenas o restante de stories sequenciais para `+20 min`)
- `POST /jobs/:id/cancel`
- `POST /jobs/:id/activate`
- `POST /jobs/:id/publish` (publica um rascunho sem editar o restante do job)

Billing:

- `GET /billing/me` (plano/status atual + consumo do ciclo)
- `GET /billing/plans`
- `POST /billing/plans` (root only)
- `PUT /billing/plans/:id` (root only)
- `DELETE /billing/plans/:id` (root only; bloqueado apenas quando há assinaturas vinculadas)
- `GET /billing/settings` (root only)
- `PUT /billing/settings` (root only)
- `POST /billing/assign-user-plan` (root only; ajuste manual de plano do usuário)
- `GET /billing/stripe/catalog` (root only; lista Products/Prices ativos para vínculo em planos)
- `POST /billing/checkout/start` (usuário inicia checkout Stripe com `planId`, `billingModel`, `cycle`)
- `POST /billing/checkout/confirm` (confirma checkout retornado pelo Stripe via `session_id` e aplica plano)
- `POST /billing/subscription/cancel` (usuário cancela assinatura recorrente para encerrar no fim do ciclo atual)
- `GET /billing/user-discounts` (root only; lista paginada de usuários com busca para gerenciar desconto individual)
- `PUT /billing/user-discounts/:userId` (root only; ativa/desativa desconto e percentual individual)

`GET /jobs/instagram-location-suggestions`:

- Uses Graph API search only.
- Tries connected account token; if unavailable/expired, backend falls back to app access token (`client_credentials`) for suggestions.
- Normalizes user query and tries variants (for example attached prepositions like `Riode` -> `Rio de`) to increase hit rate.
- Has backend timeout guard to avoid long pending requests.
- Is non-blocking for scheduling: timeout/login issues return `warning`, without forcing reconnection.

Avisos:

- `GET /avisos/unread-count`
- `GET /avisos/recent`
- `POST /avisos/mark-all-read`
- `GET /avisos`
- `POST /avisos/broadcast` (root only)

## Environment Variables

### Core Backend

- `DATABASE_URL` (PostgreSQL connection string)
- `STRIPE_SECRET_KEY` (chave secreta Stripe; usar chave de teste em desenvolvimento)
- `STRIPE_CHECKOUT_SUCCESS_URL` (URL de retorno do checkout com `session_id`; fallback local automático)
- `STRIPE_CHECKOUT_CANCEL_URL` (URL de retorno de cancelamento do checkout)
- `STRIPE_PIX_CHECKOUT_EXPIRES_HOURS` (default: `24`, validade máxima da sessão PIX via Checkout)

### Required for Instagram Graph API

- `INSTAGRAM_GRAPH_APP_ID`
- `INSTAGRAM_GRAPH_APP_SECRET`
- `INSTAGRAM_GRAPH_REDIRECT_URI`
- `INSTAGRAM_GRAPH_PUBLIC_BASE_URL` (public URL for uploaded media, ex: tunnel/domain)

### Optional for Instagram Graph API

- `INSTAGRAM_OAUTH_APP_ID` (dedicated OAuth app id; fallback: `INSTAGRAM_GRAPH_APP_ID`)
- `INSTAGRAM_OAUTH_APP_SECRET` (dedicated OAuth app secret; fallback: `INSTAGRAM_GRAPH_APP_SECRET`)
- `INSTAGRAM_OAUTH_REDIRECT_URI` (dedicated OAuth callback; fallback: `INSTAGRAM_GRAPH_REDIRECT_URI`)
- `INSTAGRAM_OAUTH_FLOW` (`instagram_login` default | `facebook_login`)
- `INSTAGRAM_OAUTH_AUTHORIZE_URL` (manual override for OAuth authorize URL)
- `INSTAGRAM_CONTENT_GRAPH_BASE_URL` (manual override for media publish/readiness host)
- `INSTAGRAM_GRAPH_API_VERSION` (default: `v24.0`)
- `INSTAGRAM_GRAPH_SCOPES`
- `INSTAGRAM_GRAPH_TIMEOUT_MS`
- `INSTAGRAM_OAUTH_STATE_TTL_MS`
- `INSTAGRAM_MEDIA_POLL_INTERVAL_MS`
- `INSTAGRAM_MEDIA_POLL_TIMEOUT_MS`
- `INSTAGRAM_MEDIA_PUBLISH_RETRY_ATTEMPTS` (default: `8`)
- `INSTAGRAM_MEDIA_PUBLISH_RETRY_DELAY_MS` (default: `2500`)
- `INSTAGRAM_MEDIA_PUBLISH_THROTTLE_RETRY_DELAY_MS` (default: `15000`, base do backoff para `too many actions`)
- `INSTAGRAM_MEDIA_PUBLISH_RETRY_MAX_TOTAL_MS` (default: `60000`, teto de duração total do retry do `media_publish`)
- `INSTAGRAM_WORKER_AUTO_RETRY_MAX_ATTEMPTS` (default: `3`)
- `INSTAGRAM_WORKER_AUTO_RETRY_DELAY_MS` (default: `20000`)
- `INSTAGRAM_FORCED_LOCATION_ID` (numeric `location_id` fixed for all publicações Instagram)
- `INSTAGRAM_FORCED_LOCATION_NAME` (label exibido no painel quando o ID fixo está ativo)
- `INSTAGRAM_STORY_SEQUENCE_STEP_DELAY_MS` (default: `1500`, atraso entre stories sequenciais)
- `INSTAGRAM_STORY_SEQUENCE_STEP_RETRY_ATTEMPTS` (default: `3`, total de tentativas por story individual)
- `INSTAGRAM_STORY_SEQUENCE_STEP_RETRY_DELAY_MS` (default: `4000`, intervalo entre retries silenciosos por story)
- `FAILED_MEDIA_RESCHEDULE_DELAY_MS` (default: `1200000`, reagendamento rápido de mídia restante para `+20 min`)
- `INSTAGRAM_PROACTIVE_TOKEN_REFRESH_COOLDOWN_MS` (default: `1800000`, cooldown por conexão para refresh proativo)
- `INSTAGRAM_TOKEN_KEEPALIVE_INTERVAL_MS` (default: `300000`, intervalo do worker de keep-alive)
- `INSTAGRAM_TOKEN_KEEPALIVE_BATCH_SIZE` (default: `25`, limite de conexões por ciclo do keep-alive)

### WhatsApp / Evolution API

- `EVOLUTION_API_BASE_URL`
- `EVOLUTION_API_KEY`
- `EVOLUTION_API_TIMEOUT_MS`
- `EVOLUTION_QR_POLL_INTERVAL_MS`
- `EVOLUTION_INSTANCE_INTEGRATION`
- `EVOLUTION_STATUS_TEXT_BACKGROUND`
- `EVOLUTION_STATUS_TEXT_FONT`
- Optional hardcoded test mode:
  - `EVOLUTION_HARD_CODED_INSTANCE_NAME`
  - `EVOLUTION_HARD_CODED_INSTANCE_API_KEY`

### Queue and Locks (RabbitMQ + Redis)

- `RABBITMQ_URL` (default: `amqp://127.0.0.1:5672`)
- `RABBITMQ_JOB_QUEUE` (default: `socialup.jobs.execute`)
- `RABBITMQ_PREFETCH` (default: `3`)
- `REDIS_URL` (recommended in production; if unavailable backend falls back to in-memory lock)
- `REDIS_KEY_PREFIX` (default: `socialup`)
- `JOB_DISPATCH_INTERVAL_MS` (default: `10000`)
- `JOB_DISPATCH_BATCH_SIZE` (default: `10`)
- `JOB_CONSUMER_CONNECTION_LOCK_MS` (default: `900000`)

## Operational Notes

- Instagram Graph publishing only works with supported Instagram professional/business setup and app permissions.
- If OAuth succeeds but account resolution fails, backend keeps connection in `AUTH_REQUIRED` and logs the exact failure code.
- For local development, `INSTAGRAM_GRAPH_PUBLIC_BASE_URL` must expose `/uploads/*` publicly.
- Job execution now depends on RabbitMQ queue consumption; if RabbitMQ is down, dispatchers will fail to enqueue and jobs return to `PENDING`.
- Redis is used for distributed connection-level execution lock. If Redis is unavailable, backend uses local in-memory lock (works for single instance, not ideal for horizontal scaling).
- Billing/plan rules are data-driven from DB (`Plan` + `UserPlanSubscription`), not hardcoded in code paths.
- Root can enable/disable automatic trial for new signups and adjust trial days via `/billing/settings`.
- Root can define the "default plan shown for root account" via `/billing/settings` (`rootDisplayPlanId`).
- When trial is disabled, new users are created as `PAYMENT_REQUIRED` and write operations are blocked until plan activation.
- O sistema aceita apenas 1 plano `isTrial=true` por vez (validação no backend em create/update).
- A gestão de planos (trial + CRUD de planos) fica na tela `Configurar planos` do menu lateral, visível apenas para root.
- Limites do `FREE_TRIAL` são recalculados automaticamente pelo backend a partir de `autoTrialDays` e dos limites do plano `START`.
- Em planos pagos, o root vincula apenas `stripeProductId`; os quatro Price IDs (assinatura mensal/anual + PIX mensal/anual) são resolvidos automaticamente pelo backend e mostrados como somente leitura no painel.
- Ao salvar plano pago, backend valida consistência de valor por ciclo: assinatura mensal = PIX mensal e assinatura anual = PIX anual; se divergir, bloqueia o salvamento.
- A listagem de planos (`GET /billing/plans`) recalcula os preços a partir do Stripe em tempo de leitura quando há `stripeProductId`, refletindo alterações feitas diretamente no Stripe sem edição manual no painel.
- `GET /billing/me` também expõe flags de UI para cancelamento de assinatura (`canCancelStripeSubscription`, `stripeCancelAtPeriodEnd`), usadas na tela "Meu plano".
- Root possui modal de "desconto por usuário" em `Configurar planos`:
  - busca por nome/usuário + paginação numérica,
  - grava desconto persistente individual (até remoção manual),
  - tenta sincronizar desconto imediatamente na assinatura Stripe ativa do usuário (quando existir).
- `POST /billing/checkout/start` lê desconto individual do usuário e injeta no Stripe Checkout via cupom (`discounts`) quando ativo.
- Webhook Stripe (`POST /billing/stripe/webhook`) aplica eventos de cobrança em tempo real:
  - `checkout.session.completed` e `checkout.session.async_payment_succeeded`: ativa plano (assinatura/PIX).
  - `checkout.session.expired` e `checkout.session.async_payment_failed`: para PIX avulso vencido/não pago, marca `PAYMENT_REQUIRED` e bloqueia.
  - `invoice.payment_failed` / `invoice.paid` e `customer.subscription.updated` / `customer.subscription.deleted`: sincroniza status da assinatura e bloqueio/desbloqueio.
- Notification bell is polling-based and accumulates avisos until read.
- SPA keeps a lightweight realtime clock tick (30s) and applies the authenticated user's `timeZone` to:
  - status transitions that depend on current time (for example pending -> running-like UI state),
  - date/time rendering in cards, history, logs and notices,
  - default scheduler current-time fallback.
- A tela de avisos é acessada pelo sino (popover + "Ver todos"), sem item dedicado no menu lateral.
- Leitura dos avisos é explícita via ação "Marcar todos como lido" no popover do sino.
- Avisos de falha usam mensagens amigáveis para usuário final; detalhes técnicos completos permanecem em `AgentLog` e `Job.lastError`.
