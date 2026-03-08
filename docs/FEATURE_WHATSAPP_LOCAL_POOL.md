# Feature Spec: WhatsApp Local Instance Pool (Green API, sem Partner, legado)

> Nota: este documento foi escrito para o fluxo antigo de Green API.  
> Em 05/03/2026 o runtime principal foi migrado para Evolution API, entao este spec deve ser considerado historico ate a versao "pool Evolution" ser escrita.

Data: 2026-03-05  
Status: Planejado (nao implementar agora)

## 1. Contexto

Hoje o fluxo WhatsApp usa Green API por instancia (`idInstance` + `apiTokenInstance`).

Sem conta Partner, a Green API **nao** permite por API:

- criar instancia
- listar todas as instancias da conta
- excluir instancia da conta

Isso cria um gargalo operacional: o operador precisa abrir o painel da Green API, copiar credenciais e conectar manualmente em cada nova conta do sistema.

## 2. Objetivo

Implementar um **pool local** de instancias WhatsApp pre-cadastradas manualmente no SocialUp, para que:

1. o operador (root) cadastre no SocialUp as instancias criadas manualmente no painel Green API
2. ao criar uma nova conta WhatsApp no SocialUp, o backend pegue automaticamente a primeira instancia disponivel e associe
3. ao excluir a conta WhatsApp no SocialUp, a instancia seja liberada no pool local
4. o usuario final nao precise digitar `idInstance`/`apiTokenInstance` em cada conexao

## 3. Nao objetivos

- criar/listar/excluir instancias da Green API diretamente por API (isso exige Partner)
- trocar plano da Green API
- remover o suporte existente de envio de status

## 4. Regras de negocio (MVP)

### 4.1 Estados do pool local

Cada instancia local tera um estado de alocacao:

- `AVAILABLE`: livre para ser associada
- `ALLOCATED`: em uso por uma `SocialConnection`
- `DISABLED`: bloqueada manualmente (nao aloca)
- `ARCHIVED`: removida do uso ativo

### 4.2 Estado de autenticacao Green API (snapshot)

Snapshot sincronizado de `getStateInstance`:

- `notAuthorized`
- `authorized`
- `sleepMode`
- `starting`
- `blocked`
- `yellowCard`
- `unknown`

### 4.3 Regra de escolha da instancia

No momento de criar nova conexao WhatsApp:

1. filtrar apenas `AVAILABLE` e nao `ARCHIVED`
2. priorizar `notAuthorized`
3. depois `starting` e `unknown`
4. ultimo fallback: `authorized` (apenas se produto decidir permitir)
5. pegar a mais antiga (`createdAt ASC`) para rotacao simples

Observacao: para o comportamento desejado no pedido atual, preferir estritamente `notAuthorized`.

## 5. Modelo de dados proposto (Prisma)

Novo modelo:

```prisma
model WhatsappInstancePool {
  id                  String   @id @default(cuid())
  provider            String   @default("GREEN_API")
  idInstance          String   @unique
  apiTokenCipher      String
  apiUrl              String
  mediaUrl            String
  allocationStatus    String   @default("AVAILABLE") // AVAILABLE | ALLOCATED | DISABLED | ARCHIVED
  authStateSnapshot   String   @default("unknown")
  assignedConnectionId String? @unique
  assignedCompanyId   String?
  lastStateCheckAt    DateTime?
  lastStateAt         DateTime?
  lastError           String?
  notes               String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}
```

Alteracao em `SocialConnection`:

```prisma
model SocialConnection {
  // ...
  whatsappPoolInstanceId String?
}
```

## 6. API backend proposta

Todas protegidas por admin auth; algumas somente root.

### 6.1 Gestao do pool (root)

- `GET /whatsapp/pool`
  - lista instancias locais e estado
- `POST /whatsapp/pool`
  - cadastra instancia manualmente (`idInstance`, `apiTokenInstance`, `apiUrl`, `mediaUrl`)
- `PUT /whatsapp/pool/:id`
  - atualiza token/url/notes/status
- `POST /whatsapp/pool/:id/sync-state`
  - chama `getStateInstance` e atualiza snapshot
- `POST /whatsapp/pool/:id/disable`
- `POST /whatsapp/pool/:id/enable`
- `POST /whatsapp/pool/:id/archive`

### 6.2 Associacao automatica em conexao

Reusar rota existente:

- `POST /connections` com `platform=whatsapp`

Novo comportamento:

1. nao exigir `loginIdentifier`/`secret` no payload de WhatsApp
2. alocar instancia do pool conforme regra
3. gravar credenciais na `SocialConnection` (ou referenciar `whatsappPoolInstanceId`)
4. marcar pool como `ALLOCATED`
5. iniciar fluxo de QR (`AUTH_IN_PROGRESS`)

### 6.3 Exclusao de conexao

Na rota existente:

- `DELETE /connections/:id`

Novo comportamento para WhatsApp:

1. chamar `logout` na instancia (best effort)
2. liberar instancia no pool:
   - `allocationStatus=AVAILABLE`
   - `assignedConnectionId=null`
   - `assignedCompanyId=null`
   - `authStateSnapshot=notAuthorized` (se logout ok)
3. remover `SocialConnection`

## 7. UI proposta

### 7.1 Nova area: "Pool WhatsApp" (root)

Tela com:

- formulario de cadastro manual da instancia
- tabela com:
  - `idInstance`
  - status de alocacao
  - estado auth
  - conexao associada (se houver)
  - ultima verificacao
  - acoes (`sincronizar`, `desabilitar`, `arquivar`)

### 7.2 Conectar contas

Para WhatsApp:

- remover campos de credencial do formulario final
- mostrar texto: "Instancia sera alocada automaticamente do pool local"
- ao criar conexao, feedback claro:
  - sucesso: "Instancia X alocada"
  - erro: "Nenhuma instancia disponivel"

## 8. Fluxos operacionais

### 8.1 Onboarding de nova conta WhatsApp

1. root cria instancia no painel Green API (manual)
2. root cadastra essa instancia no Pool WhatsApp do SocialUp
3. usuario cria conta WhatsApp no SocialUp
4. backend aloca instancia livre e abre QR
5. usuario escaneia QR
6. conexao fica `CONNECTED`

### 8.2 Conta desautorizada no futuro

1. job tenta enviar e recebe `LOGIN_REQUIRED_WHATSAPP`
2. job vira `WAITING_LOGIN`
3. conexao vira `AUTH_REQUIRED`
4. usuario clica gerar novo QR e reconecta
5. jobs podem ser reenfileirados

### 8.3 Exclusao de conta

1. usuario exclui conexao no SocialUp
2. backend tenta `logout`
3. pool local libera instancia
4. instancia continua existindo no painel Green API (nao Partner)

## 9. Concorrencia e consistencia

### 9.1 Alocacao atomica

Evitar duas conexoes pegarem a mesma instancia:

- usar transacao
- `updateMany` com condicao `allocationStatus=AVAILABLE` e `assignedConnectionId IS NULL`
- checar `count === 1` como lock otimista

### 9.2 Recuperacao de inconsistencias

Criar tarefa de reconciliacao (cron interno):

- detectar instancia `ALLOCATED` com conexao inexistente -> liberar
- detectar conexao WhatsApp com `whatsappPoolInstanceId` nulo -> alertar
- detectar estado Green API divergente -> atualizar snapshot/log

## 10. Seguranca

- armazenar token em campo cifrado (`apiTokenCipher`)
- nunca retornar token em respostas do frontend
- mascarar logs (ex.: mostrar so prefixo do id/token)
- manter endpoint de pool restrito ao root

## 11. Logs e observabilidade

Novos codigos de log sugeridos:

- `WHATSAPP_POOL_INSTANCE_CREATED`
- `WHATSAPP_POOL_INSTANCE_ALLOCATED`
- `WHATSAPP_POOL_INSTANCE_RELEASED`
- `WHATSAPP_POOL_INSTANCE_SYNCED`
- `WHATSAPP_POOL_INSTANCE_DISABLED`
- `WHATSAPP_POOL_INSTANCE_ARCHIVED`
- `WHATSAPP_POOL_EXHAUSTED`

## 12. Plano de implementacao (fases)

### Fase 1 - Base de dados e CRUD do pool

- migracao Prisma
- endpoints CRUD + sync-state
- tela root "Pool WhatsApp"

### Fase 2 - Associacao automatica

- alterar `POST /connections` para alocar automaticamente
- remover obrigatoriedade de credenciais no form WhatsApp
- feedback de erro/sucesso no frontend

### Fase 3 - Liberacao em exclusao

- integrar `DELETE /connections/:id` com release do pool
- logs de auditoria

### Fase 4 - Reconciliacao e robustez

- cron de consistencia
- alertas de pool vazio
- testes de concorrencia

## 13. Criterios de aceite

1. Criar conexao WhatsApp sem digitar credenciais seleciona instancia disponivel automaticamente.
2. Se nao houver instancia disponivel, API retorna erro claro e frontend exibe mensagem clara.
3. Excluir conexao WhatsApp libera a instancia no pool local.
4. Gerar novo QR continua funcional para conexao alocada.
5. Nao ha vazamento de `apiTokenInstance` em resposta da API ou logs.

## 14. Testes recomendados

- unitario: funcao de escolha de instancia (prioridade por estado)
- integracao: alocacao + transacao (2 requisicoes simultaneas)
- integracao: exclusao da conexao libera pool
- e2e manual: criar conta -> QR -> conectar -> postar -> excluir -> reusar instancia

## 15. Limites e observacoes de negocio

- Sem Partner, "excluir instancia" real na Green API continua manual no painel Green API.
- O pool local resolve o gargalo operacional sem custo Partner neste estagio.
- Se no futuro virar Partner, trocar a etapa manual por `createInstance/getInstances/deleteInstanceAccount`.
