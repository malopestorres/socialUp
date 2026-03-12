# Configuração do Webhook Stripe

Este documento explica como configurar o webhook Stripe para o SocialUp.

## Endpoint do backend

O backend espera eventos em:

`POST /billing/stripe/webhook`

Exemplo de URL completa:

`https://api.socialup.space/billing/stripe/webhook`

## Variáveis de ambiente obrigatórias

No backend (`.env`):

- `STRIPE_SECRET_KEY=sk_...`
- `STRIPE_WEBHOOK_SECRET=whsec_...`

Depois de atualizar o `.env`, reinicie o backend.

## Passo a passo no painel Stripe

1. Acesse `Developers` → `Webhooks`.
2. Clique em `Add destination` (Adicionar destino).
3. Informe a URL pública do webhook:
   - `https://SEU_BACKEND/billing/stripe/webhook`
4. Selecione os eventos:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.expired`
   - `checkout.session.async_payment_failed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Salve o destino.
6. Abra o destino criado e copie o `Signing secret` (`whsec_...`).
7. Cole no `.env` em `STRIPE_WEBHOOK_SECRET`.
8. Reinicie o backend.

## Nome do destino

Se o Stripe pedir **nome do destino**, pode ser qualquer nome descritivo.

Sugestão:

`SocialUp Backend Billing Webhook`

O nome é apenas organizacional e não impacta o funcionamento técnico.

## Como validar se está funcionando

No painel do Stripe, entre no destino criado e verifique:

- `Deliveries` com status `200`.
- Sem erro de assinatura (`signature verification`).
- Sem erro `404` (URL errada) ou `500` (erro no backend).

## Teste local com Stripe CLI

Use este fluxo para testar sem URL pública.

### 1) Pré-requisitos

- Backend rodando localmente (exemplo: `http://localhost:4000`)
- Stripe CLI instalado e autenticado:
  - `stripe login`

### 2) Encaminhar webhook para localhost

Rode:

```bash
stripe listen --forward-to http://localhost:4000/billing/stripe/webhook
```

O comando mostrará um `whsec_...` temporário no terminal.

### 3) Configurar segredo local

No `.env` local, use o segredo exibido no passo anterior:

- `STRIPE_WEBHOOK_SECRET=whsec_...`

Reinicie o backend após atualizar o `.env`.

### 4) Disparar eventos de teste

Exemplos:

```bash
stripe trigger checkout.session.completed
stripe trigger invoice.paid
stripe trigger invoice.payment_failed
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
```

Se algum evento não tiver trigger pronto no CLI, use o botão **Send test event** no Dashboard do Stripe.

### 5) Verificação

- Veja no terminal do `stripe listen` se o evento foi enviado.
- Veja no backend se respondeu `200`.
- Confira no banco/UI se o status da assinatura foi atualizado.

## Subdomínio para webhook (`api.socialup.space`)

Se `api.socialup.space` ainda não existe, crie no Cloudflare.

### Opção A: backend em servidor com IP público

1. Cloudflare DNS: criar registro `A` para `api` apontando para IP do servidor.
2. SSL/TLS ativo (HTTPS válido).
3. Backend respondendo em `https://api.socialup.space`.

### Opção B: backend via Cloudflare Tunnel

1. Criar/usar túnel nomeado.
2. Public hostname no tunnel:
   - `api.socialup.space` -> `http://localhost:4000` (ou porta do backend no servidor)
3. Confirmar que abre:
   - `https://api.socialup.space/health` (ou rota equivalente)

Depois, no Stripe, use:

`https://api.socialup.space/billing/stripe/webhook`

## Observações importantes

- O Stripe possui modo `Test` e `Live`; configure no ambiente correto.
- Se trocar domínio/URL do backend, atualize o destino no Stripe.
- Se recriar o destino, o `whsec_...` muda e precisa ser atualizado no `.env`.
