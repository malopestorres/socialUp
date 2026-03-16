# Bee Up - Proxima Fase Profissional

Este documento define a proxima fase do Assistente Bee Up com foco em robustez, acoes operacionais reais e melhor qualidade de recuperacao de contexto.

O objetivo nao e trocar a base principal do sistema. O objetivo e profissionalizar o Bee Up em cima do stack que ja existe hoje.

## Direcao recomendada

Manter:

- PostgreSQL como base principal
- Prisma como acesso principal aos dados
- Gemini como modelo de resposta

E evoluir para:

- embeddings reais do Gemini
- busca vetorial com pgvector
- camada formal de tools com confirmacao
- logs e auditoria de acoes
- avaliacao de qualidade das respostas

## O que nao recomendamos agora

Nao recomendamos neste momento:

- migrar a memoria principal do Bee Up para Turso
- separar a base operacional do assistente em outro banco
- criar PR automatico via IA
- permitir acoes destrutivas sem confirmacao

Motivo:

- o Bee Up depende de jobs, billing, contas, logs, notificacoes e permissao real do usuario
- tudo isso ja esta no PostgreSQL
- separar a base agora aumentaria complexidade sem ganho proporcional

## Arquitetura alvo

### 1. Base operacional

Continuar no PostgreSQL com:

- jobs
- social connections
- billing
- notifications
- logs
- ai incidents
- ai knowledge
- ai threads

### 2. Memoria do Bee Up

Evoluir de:

- embedding local salvo em JSON

Para:

- embedding real do Gemini
- coluna vetorial no Postgres com pgvector
- busca hibrida:
  - vetorial
  - lexical
  - filtros por categoria e status

### 3. Raciocinio e resposta

Usar Gemini para:

- resposta final ao usuario
- escolha de tool quando necessario
- resumo de erro
- explicacao amigavel de billing e plano

### 4. Acoes

Criar tools formais com validacao e auditoria.

## Prioridade de implementacao

### Fase 1. Recuperacao profissional

1. Ativar `pgvector` no PostgreSQL
2. Adicionar campo vetorial para chunks da base Bee Up
3. Gerar embeddings reais com Gemini ao salvar documento
4. Trocar a busca atual do Bee Up para:
   - score vetorial
   - score lexical
   - reranking simples

Resultado esperado:

- respostas mais semanticas
- menos dependencia de palavras identicas
- melhor recuperacao para FAQ extensa

### Fase 2. Tools seguras

Criar ou formalizar as tools abaixo:

- `get_plan_limits`
- `get_billing_status`
- `get_recent_failures`
- `get_connection_status`
- `generate_whatsapp_qr`
- `reschedule_job`
- `open_view`
- `open_support_incident`

Adicionar depois:

- `cancel_scheduled_job`
- `update_scheduled_job_datetime`
- `update_scheduled_job_profile`
- `bulk_update_jobs`
- `bulk_cancel_jobs`
- `bulk_mark_draft`
- `bulk_mark_published`

Regra:

- toda acao mutavel precisa de confirmacao
- toda acao mutavel gera log em `AiActionLog`
- toda acao sensivel valida ownership e permissao

### Fase 3. Fluxos guiados

O Bee Up deve sair de "responder perguntas" e entrar em "conduzir tarefas".

Exemplos:

- "Quero reagendar a postagem que falhou"
- "Quero cancelar o agendamento de amanha"
- "Quero mover 5 postagens para outro perfil"
- "Quero gerar novo QR do WhatsApp"
- "Quero entender meu plano e o que o bloqueio significa"

Fluxo recomendado:

1. Bee Up interpreta
2. consulta estado real
3. mostra resumo da acao
4. pede confirmacao
5. executa
6. devolve resultado amigavel

### Fase 4. Supervisao e confiabilidade

Adicionar camadas para:

- incidentes repetidos
- erros recorrentes por categoria
- alertas internos para o usuario
- alertas administrativos
- historico de decisoes do Bee Up

## Confirmacoes obrigatorias

As acoes abaixo nunca devem rodar sem confirmacao explicita:

- cancelar agendamento
- editar data e horario de postagem
- editar perfil de postagem
- bulk actions
- abrir incidente manual se o usuario nao pediu

Modelo recomendado de confirmacao:

- resumo da acao
- impacto
- quantidade de itens afetados
- botao confirmar
- botao cancelar

## Acoes complexas do Bee Up

### Cancelar agendamento

Tool:

- `cancel_scheduled_job`

Validacoes:

- job pertence ao usuario
- job ainda esta elegivel para cancelamento
- job nao esta executando
- publicationState e status permitem cancelamento

Resposta esperada:

- dizer qual postagem foi cancelada
- dizer a data antiga
- sugerir abrir Historico se quiser revisar

### Trocar data e horario de uma postagem

Tool:

- `update_scheduled_job_datetime`

Validacoes:

- job pertence ao usuario
- job ainda nao foi concluido
- novo horario e valido no fuso do usuario

Resposta esperada:

- confirmar a nova data
- confirmar o fuso considerado

### Trocar perfil da postagem

Tool:

- `update_scheduled_job_profile`

Validacoes:

- perfil de destino pertence ao usuario
- publicacao e compativel com o perfil
- job ainda e editavel

### Bulk action em varias publicacoes

Tools sugeridas:

- `bulk_cancel_jobs`
- `bulk_mark_draft`
- `bulk_mark_published`
- `bulk_update_jobs`

Recomendacao tecnica:

- nunca deixar o LLM escolher IDs sozinho
- o frontend manda a selecao
- o Bee Up apenas confirma e executa sobre a selecao recebida

## Estrutura recomendada de tools

Toda tool deve devolver:

- `summary`
- `details`
- `payload`
- `logStatus`
- `errorMessage`
- `actions`

Toda tool mutavel deve registrar:

- usuario
- thread
- input bruto
- input normalizado
- resultado
- falha, se houver

## Evolucao da base Bee Up

Hoje:

- `AiKnowledgeDocument`
- `AiKnowledgeChunk`
- embedding local

Proximo passo:

- adicionar campo vetorial real por chunk
- guardar modelo de embedding usado
- guardar versao do chunk
- permitir reindexacao de documentos

Campos sugeridos por chunk:

- `embeddingModel`
- `embeddingVersion`
- `embeddedAt`
- `vectorStatus`

## Avaliacao de qualidade

Criar uma bateria pequena de perguntas reais.

Categorias minimas:

- autenticacao Instagram
- erro temporario Meta
- QR do WhatsApp
- limite do plano
- bloqueio por cobranca
- reagendamento
- cancelamento
- bulk actions

Para cada pergunta, medir:

- acertou o contexto?
- sugeriu a rota certa?
- pediu tool quando precisava?
- evitou inventar?
- foi simpatico sem exagero?

## Ordem pratica de desenvolvimento

1. Implementar `pgvector`
2. Ligar embeddings reais do Gemini
3. Criar pipeline de reindexacao da base Bee Up
4. Formalizar tools mutaveis com confirmacao
5. Implementar cancelamento e edicao individual
6. Implementar bulk actions guiadas
7. Criar bateria de avaliacao
8. Adicionar painel interno simples de auditoria do Bee Up

## Resumo executivo

O Bee Up ja tem uma boa base.

A proxima fase profissional nao e trocar o banco do assistente. E:

- melhorar recuperacao de contexto
- profissionalizar tools
- adicionar confirmacao para acoes
- permitir operacoes reais com seguranca
- criar rastreabilidade para suporte e manutencao

Essa e a direcao que deixa o Bee Up mais util, mais confiavel e mais facil de escalar no proprio sistema.
