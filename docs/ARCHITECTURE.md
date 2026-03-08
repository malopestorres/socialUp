# SocialUp Architecture

## Overview

SocialUp is a scheduling platform for Instagram and WhatsApp with a local-first stack.

- Instagram runtime: Meta Graph API (official) with OAuth consent flow.
- WhatsApp runtime: Evolution API (QR auth + status send).
- Backend is the source of truth for auth, uploads, jobs, logs, and worker execution.

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
- `AgentLog`: operation logs and errors
- `Aviso`: user notifications (bell + notices page)
- `InstagramLocationCatalog`: local cache/manual catalog of `location_id` + name for Instagram posts

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
3. Frontend opens Meta consent in popup.
4. Meta redirects to backend callback: `GET /oauth/instagram/callback`.
5. Backend exchanges code for access token, resolves Instagram Business account, stores token and IG user id in `SocialConnection`, sets `authStatus=CONNECTED`.
6. Popup closes and frontend refreshes connection status.

Notes:

- `Marcar conectada` is no longer used for Instagram.
- If token is invalid/expired, workers return `LOGIN_REQUIRED_INSTAGRAM` and connection goes back to `AUTH_REQUIRED`.

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
- Flow:
  1. Validate connected account + access token.
  2. For `instagram_post` and `instagram_reel`, backend tenta resolver `location_id` automaticamente via `/me/accounts` (prioriza Page com `city`), e usa `INSTAGRAM_FORCED_LOCATION_ID` quando configurado.
  3. Auto-location só é aplicada quando o `city` da Page está consistente com o nome da própria Page; se não estiver consistente, publica sem localização para evitar marcar local incorreto.
  4. Erros transitórios de rede/API (ex.: `fetch failed`, timeout, HTTP 5xx) entram em retentativa automática silenciosa (`PENDING`) com delay, sem aviso de falha para o usuário nessa etapa.
  5. Quando a retentativa automática esgota, o job cai em `FAILED`; quando erro é de autenticação, vai para `WAITING_LOGIN`.
  6. If location resolution/payload fails, publish continues without location (location is optional). `instagram_story` sempre segue sem localização.
  7. Create media container (`/{ig-user-id}/media`).
  8. Poll processing for reel/video story containers.
  9. Publish container (`/{ig-user-id}/media_publish`).
  10. Mark job `COMPLETED` or `FAILED`/`WAITING_LOGIN`.
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
- Instagram Graph publish requires public HTTP(S) media URL reachable by Meta.
- Backend composes this URL from `INSTAGRAM_GRAPH_PUBLIC_BASE_URL + filePath`.
- Frontend valida arquivo antes do upload para Instagram imagem (`instagram_post` e imagem de `instagram_story`) com limite de `8 MB`.
- Frontend valida proporção de imagem para `instagram_post` antes do upload (intervalo suportado: `4:5` até `1.91:1`).
- Backend reforça a mesma regra ao criar/editar jobs para impedir envio inválido para a Graph API.
- Backend também valida proporção de `instagram_post` lendo dimensões de JPG/PNG no arquivo local, para cobrir mídias reutilizadas.
- Backend codifica internamente `location_id` junto do `locationName` no banco (sem migração de schema) e decodifica na API/worker.
- Em jobs Instagram sem `location_id` manual, backend tenta resolver automaticamente o primeiro `pageId` com `location` da conta conectada (`/me/accounts`) antes de salvar o job.

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

Instagram location catalog (auth required):

- `GET /instagram-location-catalog`
- `POST /instagram-location-catalog` (root only)
- `DELETE /instagram-location-catalog/:id` (root only)

`GET /jobs/instagram-location-suggestions`:

- Uses local catalog first and merges with Graph API search as complement.
- Tries connected account token; if unavailable/expired, backend falls back to app access token (`client_credentials`) for suggestions.
- Normalizes user query and tries variants (for example attached prepositions like `Riode` -> `Rio de`) to increase hit rate.
- Persists valid suggestions in local catalog for future autocomplete.
- Has backend timeout guard to avoid long pending requests.
- Is non-blocking for scheduling: timeout/login issues return local catalog suggestions + `warning`, without forcing reconnection.

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

- `INSTAGRAM_GRAPH_API_VERSION` (default: `v24.0`)
- `INSTAGRAM_GRAPH_SCOPES`
- `INSTAGRAM_GRAPH_TIMEOUT_MS`
- `INSTAGRAM_OAUTH_STATE_TTL_MS`
- `INSTAGRAM_MEDIA_POLL_INTERVAL_MS`
- `INSTAGRAM_MEDIA_POLL_TIMEOUT_MS`
- `INSTAGRAM_WORKER_AUTO_RETRY_MAX_ATTEMPTS` (default: `3`)
- `INSTAGRAM_WORKER_AUTO_RETRY_DELAY_MS` (default: `20000`)
- `INSTAGRAM_FORCED_LOCATION_ID` (numeric `location_id` fixed for all publicações Instagram)
- `INSTAGRAM_FORCED_LOCATION_NAME` (label exibido no painel quando o ID fixo está ativo)

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
