# Evolution API Server Requirements

## Objetivo

Este documento define o minimo necessario para rodar a Evolution API em servidor proprio (sem Docker), integrada ao SocialUp.

## Requisitos Minimos

- CPU: 2 vCPU
- RAM: 4 GB (recomendado 8 GB para mais de 5 instancias)
- Disco: 20 GB SSD (recomendado 50 GB+ para historico/midia)
- Sistema operacional: Linux 64-bit (Ubuntu 22.04 LTS recomendado)
- Node.js: 20.x (via nvm)
- NPM: 10.x
- Banco: PostgreSQL 14+ (17 recomendado)
- Cache: Redis 6+ (opcional, mas recomendado em producao)

## Portas e Rede

- `8080/tcp`: Evolution API
- `5432/tcp`: PostgreSQL (interno)
- `6379/tcp`: Redis (interno)
- `80/443`: reverse proxy (Nginx/Caddy) para HTTPS

Recomendacao:
- Expor publicamente apenas `80/443`
- Manter `5432` e `6379` fechadas para internet

## Variaveis Essenciais da Evolution

No `.env` da Evolution API, no minimo:

- `SERVER_URL=https://seu-dominio`
- `SERVER_PORT=8080`
- `DATABASE_PROVIDER=postgresql`
- `DATABASE_CONNECTION_URI=postgresql://usuario:senha@host:5432/evolution_db?schema=evolution_api`
- `AUTHENTICATION_API_KEY=<chave-forte>`

Opcional recomendado:

- `CACHE_REDIS_ENABLED=true`
- `CACHE_REDIS_URI=redis://localhost:6379/6`
- `TELEMETRY_ENABLED=false` (se quiser desativar telemetria)
- `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true`

## Setup Basico (Sem Docker)

1. Instalar Node 20 com nvm.
2. Instalar e subir PostgreSQL.
3. (Opcional) Instalar e subir Redis.
4. Clonar Evolution API.
5. Criar `.env`.
6. Executar:
   - `npm install`
   - `npm run db:generate`
   - `npm run db:deploy`
   - `npm run build`
   - `npm run start:prod`

## Operacao em Producao

Use um gerenciador de processo para manter o servico ativo:

- PM2, `systemd` ou supervisor equivalente.

Checklist operacional:

- Healthcheck periodico em `GET /`
- Rotacao de logs
- Backup diario do PostgreSQL
- Monitoramento de CPU/RAM/disco
- Alertas de indisponibilidade

## Integracao com SocialUp

No backend do SocialUp:

- `EVOLUTION_API_BASE_URL=http://localhost:8080` (ou URL interna/reverse proxy)
- `EVOLUTION_API_KEY=<mesma AUTHENTICATION_API_KEY da Evolution>`

No painel SocialUp:

- Em conexao WhatsApp, preencher `Nome da Instancia` (ex: `cliente-centro-01`)
- API key por conexao e opcional quando `EVOLUTION_API_KEY` global ja estiver configurada no backend

## Seguranca

- Sempre usar HTTPS em ambiente externo
- Usar API key forte e rotacionar periodicamente
- Nao versionar `.env` em repositório
- Restringir acesso ao endpoint da Evolution por firewall/IP quando possivel

