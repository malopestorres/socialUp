# SocialUp Architecture

## Overview

SocialUp is a scheduling platform for Instagram and WhatsApp with a local-first stack.

- Instagram runtime: Meta Graph API (official) with OAuth consent flow.
- WhatsApp runtime: Evolution API (QR auth + status send).
- Backend is the source of truth for auth, uploads, jobs, logs, and worker execution.

Related docs:

- `docs/INSTAGRAM_LOCATION_APPROVAL_PLAYBOOK.md`: passo a passo para habilitar localização com login Instagram após aprovação do app na Meta.

## Monorepo Layout

- `apps/backend`: Express API + Prisma + worker loops
- `apps/web`: React + TypeScript admin panel
- `packages/shared`: shared DTOs and core enums

Main backend files:

- `apps/backend/src/index.ts`: routes, workers, scheduling rules, logs/avisos
- `apps/backend/src/instagram-graph-api.ts`: Instagram OAuth + Graph API publish
- `apps/backend/src/whatsapp-evolution-api.ts`: WhatsApp QR/session/status via Evolution API
- `apps/backend/prisma/schema.prisma`: schema (SQLite)

Main frontend files:

- `apps/web/src/App.tsx`: main UI (dashboard, connect accounts, scheduler, history, media, avisos)
- `apps/web/src/api.ts`: HTTP client with admin session token
- `apps/web/src/styles.css`: design system, responsive layout, and visual identity (sidebar/header/buttons)
- Frontend layout baseline: top global header (`full-width`, white background) + compact sidebar navigation below it
- `apps/web/src/assets/logo.svg`: active logo used in panel and login
- `apps/web/src/assets/fonts/K2D-Thin.woff`, `apps/web/src/assets/fonts/K2D-Medium.woff`: primary UI fonts

## Core Entities

- `Organization`: top-level business
- `Company`: unit/branch
- `User`: panel admin account
- `SocialConnection`: Instagram/WhatsApp account for a company
- `Job`: scheduled publication
  - New naming field: `title` (short internal title used in UI lists and notifications; legacy jobs still fallback to `caption` when `title` is empty)
- `AgentLog`: operation logs and errors
- `Aviso`: user notifications (bell + notices page)

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

Backend runs two internal polling workers:

- `startServerInstagramJobWorker()`
- `startServerWhatsappJobWorker()`

### Instagram Worker (Graph API)

- Polls due jobs (`PENDING`, `WAITING_LOGIN`) for:
  - `instagram_post`
  - `instagram_reel`
  - `instagram_story`
- Uses `executeInstagramJobWithGraphApi(...)`.
- Publish host:
  - `instagram_login`: `graph.instagram.com`
  - `facebook_login`: `graph.facebook.com`
- Flow:
  1. Validate connected account + access token.
  1.1. Before execution, worker runs proactive token refresh (cooldown-based, per connection) to reduce `WAITING_LOGIN` during normal operation.
  1.2. Dedicated keep-alive worker periodically refreshes tokens for Instagram connections in `CONNECTED`.
  1.3. If keep-alive receives `LOGIN_REQUIRED_INSTAGRAM`, connection is forcefully moved to `AUTH_REQUIRED` and secret is cleared (forced disconnect), so UI shows reconnection flow (`Abrir login`) again.
  2. For `instagram_post` and `instagram_reel`, backend tenta `location_id` explícito (quando existir), depois nome legado (quando existir), e por fim localização automática da Page vinculada à conta Instagram Business (`/me/accounts`).
  3. If location resolution/payload fails, publish continues without location (location is optional). `instagram_story` sempre segue sem localização.
  4. Erros transitórios de rede/API (ex.: `fetch failed`, timeout, HTTP 5xx) entram em retentativa automática silenciosa (`PENDING`) com delay, sem aviso de falha para o usuário nessa etapa.
  4.1. Exceção para `instagram_story` em sequência (múltiplas mídias): o sistema não retenta o job inteiro automaticamente para evitar duplicação de stories já publicados parcialmente.
  4.1.1. Em `media_publish`, erros de throttle da Meta (`too many actions`) entram em backoff progressivo por tentativa no mesmo `creation_id`, com teto de tempo por publicação.
  4.2. Para sequência de stories, há intervalo curto entre itens, cache-buster por etapa na URL de mídia, validação de `publishedMediaId` duplicado e bloqueio de conteúdo duplicado por fingerprint (sha256 local) para reduzir inconsistência de ordem/perda de item.
  5. Quando a retentativa automática esgota, o job cai em `FAILED`; quando erro é de autenticação, vai para `WAITING_LOGIN`.
  6. Create media container (`/{ig-user-id}/media`).
  7. Poll processing for reel/video story containers.
  8. Publish container (`/{ig-user-id}/media_publish`).
  9. Mark job `COMPLETED` or `FAILED`/`WAITING_LOGIN`.
- Emits `Aviso` and `AgentLog`.

### WhatsApp Worker (Evolution API)

- Polls due jobs for:
  - `whatsapp_status_midia`
  - `whatsapp_status_texto`
- Sends status via Evolution API.
- Marks `SENT_UNCONFIRMED`, `FAILED`, or `WAITING_LOGIN`.
- Emits `Aviso` and `AgentLog`.

## Upload and Media URL Strategy

- Upload endpoint: `POST /upload` (Multer), files under `apps/backend/uploads`.
- Jobs store `filePath` (`/uploads/...`).
- No formulário de agendamento, `instagram_post` e `instagram_story` entram automaticamente em modo sequencial quando há mais de 1 mídia enviada (não há toggle manual).
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
- `POST /jobs/:id/cancel`
- `POST /jobs/:id/activate`

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

## Operational Notes

- Instagram Graph publishing only works with supported Instagram professional/business setup and app permissions.
- If OAuth succeeds but account resolution fails, backend keeps connection in `AUTH_REQUIRED` and logs the exact failure code.
- For local development, `INSTAGRAM_GRAPH_PUBLIC_BASE_URL` must expose `/uploads/*` publicly.
- Notification bell is polling-based and accumulates avisos until read.
- A tela de avisos é acessada pelo sino (popover + "Ver todos"), sem item dedicado no menu lateral.
- Leitura dos avisos é explícita via ação "Marcar todos como lido" no popover do sino.
- Avisos de falha usam mensagens amigáveis para usuário final; detalhes técnicos completos permanecem em `AgentLog` e `Job.lastError`.
