# Assistente Bee Up

## Objetivo

O Assistente Bee Up sera o assistente lateral do painel SocialUp. Ele deve:

- responder duvidas sobre uso do sistema
- explicar erros temporarios e erros recorrentes
- consultar limites do plano do usuario
- orientar navegacao no painel
- executar acoes seguras, como reagendar postagem ou gerar novo QR do WhatsApp
- registrar incidentes internos para suporte
- sinalizar erros graves de forma organizada, sem tentar "consertar" sozinho

O Bee Up nao repara o sistema por conta propria. Ele gerencia, orienta, registra e aciona fluxos seguros para que o suporte e o desenvolvedor atuem depois.

## UX

O Bee Up sera exposto como um chat lateral fixo.

- usuario abre o painel
- clica no botao do Bee Up
- uma lateral abre com historico, sugestoes e campo de mensagem
- o Bee Up responde usando contexto do sistema e ferramentas reais do backend

O Bee Up tambem pode gerar alertas internos do proprio assistente. Esses alertas nao substituem os avisos gerais ja existentes; eles servem para acoes e incidentes do assistente.

## Escopo inicial

Primeira fase funcional:

- chat lateral
- historico por usuario
- base de conhecimento editavel pelo root
- busca semantica em documentos internos
- acoes seguras iniciais

## Status atual da implementacao

Ja implementado nesta primeira rodada:

- rotas backend do Bee Up
- persistencia de threads, mensagens, logs de acao, incidentes e alertas
- base de conhecimento editavel pelo root
- chunking de documentos no backend
- busca por similaridade com embedding local em memoria
- fallback de resposta local com contexto do sistema
- integracao real com Gemini para resposta final
- function calling do Gemini controlado pelo backend
- chat lateral flutuante no frontend, abrindo e fechando pelo lado direito
- tela root para alimentar a base do Bee Up

Ja funcional no codigo:

- consultar limite do plano
- listar falhas recentes
- checar status das contas
- solicitar novo QR do WhatsApp
- reagendar postagem elegivel
- abrir incidente interno de suporte
- sugerir navegacao por view do painel
- usar Gemini para decidir quando chamar uma tool segura
- usar Gemini para redigir a resposta final em cima da base Bee Up e do estado real do sistema

Ainda nao entrou nesta rodada:

- integracao com GitHub
- envio externo para WhatsApp do suporte
- alertas proativos fora do drawer do Bee Up
- pgvector

Acoes seguras iniciais:

- consultar limite do plano
- listar falhas recentes
- listar status de conexoes
- gerar novo QR do WhatsApp
- reagendar postagem com atraso definido
- abrir incidente de suporte

## Arquitetura

O Bee Up sera dividido em quatro camadas.

### 1. Conhecimento

Base de conhecimento cadastrada no painel pelo root:

- FAQ
- tutoriais
- regras de Instagram e WhatsApp
- explicacoes de plano e cobranca
- incidentes conhecidos
- respostas de suporte reaproveitaveis

Cada documento sera quebrado em chunks. Cada chunk tera embedding para busca vetorial.

### 2. Contexto vivo

O Bee Up nao respondera so com RAG. Ele tambem consultara o estado real do sistema:

- usuario autenticado
- view atual
- plano atual
- conexoes sociais
- jobs recentes
- logs recentes
- avisos e incidentes ligados ao usuario

### 3. Ferramentas

O modelo pede uma acao. O backend valida e executa.

Ferramentas planejadas:

- `get_plan_limits`
- `get_recent_failures`
- `get_connection_status`
- `generate_whatsapp_qr`
- `reschedule_job`
- `open_support_incident`
- `open_view`

Ferramentas sensiveis devem exigir validacao do backend e, quando necessario, confirmacao do usuario.

## Integracao atual com Gemini

Nesta fase o Bee Up passou a usar Gemini por cima da base que ja estava pronta.

Fluxo atual:

1. usuario envia a mensagem
2. backend busca contexto relevante na base Bee Up
3. backend envia historico recente, view atual e contexto para o Gemini
4. Gemini pode:
   - responder direto
   - pedir uma tool segura
5. backend valida e executa a tool
6. backend devolve o resultado da tool para o Gemini
7. Gemini monta a resposta final em pt-BR
8. se a API do Gemini falhar ou estiver sem chave, o Bee Up cai para o modo local sem quebrar o chat

Observacao importante:

- a decisao final de seguranca continua no backend
- Gemini nao executa banco, QR, reagendamento ou incidente sozinho
- o backend continua sendo o dono das acoes

### Variaveis de ambiente

O Bee Up agora aceita estas configuracoes:

- `BEE_UP_GEMINI_API_KEY`
- `GEMINI_API_KEY`
- `BEE_UP_GEMINI_MODEL` (padrao: `gemini-2.5-flash`)
- `BEE_UP_GEMINI_API_BASE` (padrao: `https://generativelanguage.googleapis.com/v1beta`)
- `BEE_UP_GEMINI_TIMEOUT_MS` (padrao: `12000`)

Se `BEE_UP_GEMINI_API_KEY` nao estiver definida, o Bee Up continua operando no modo local.

### 4. Incidentes

O Bee Up deve registrar incidentes estruturados quando detectar erro recorrente ou pedido explicito do usuario.

Exemplos:

- Instagram exigindo novo login em massa
- varias falhas com mesma assinatura de erro
- QR do WhatsApp expirando repetidamente
- falha grave de integracao externa

## Banco de dados

Tabelas planejadas:

- `AiKnowledgeDocument`
- `AiKnowledgeChunk`
- `AiAgentThread`
- `AiAgentMessage`
- `AiActionLog`
- `AiIncident`
- `AiIncidentEvent`
- `AiUserAlert`

### AiKnowledgeDocument

Documento original cadastrado pelo root.

Campos principais:

- titulo
- categoria
- conteudo
- status
- tags
- criado por
- datas de criacao e atualizacao

### AiKnowledgeChunk

Chunk derivado do documento.

Campos principais:

- documento pai
- indice do chunk
- texto do chunk
- embedding
- hash do conteudo

Observacao:

Na primeira implementacao o embedding sera armazenado em JSON e a busca vetorial sera feita no backend. Depois, quando quisermos performance maior, podemos migrar para `pgvector`.

### AiAgentThread

Conversa do usuario com o Bee Up.

Campos principais:

- usuario
- titulo opcional
- ultima atividade

### AiAgentMessage

Mensagens da conversa.

Campos principais:

- thread
- role: `user`, `assistant`, `tool`
- conteudo
- nome da tool quando aplicavel
- payload opcional

### AiActionLog

Log de acoes executadas ou recusadas pelo Bee Up.

Campos principais:

- usuario
- thread
- nome da acao
- status
- entrada
- saida
- erro

### AiIncident

Registro de incidente.

Campos principais:

- usuario afetado opcional
- severidade
- status
- titulo
- resumo
- fingerprint

### AiIncidentEvent

Eventos dentro do incidente.

Campos principais:

- incidente
- tipo
- mensagem
- payload

### AiUserAlert

Alertas do Bee Up para o usuario.

Campos principais:

- usuario
- tipo
- titulo
- mensagem
- readAt
- payload de acao opcional

## RAG e busca vetorial

O Bee Up usara a seguinte estrategia.

Primeira fase:

- documentos cadastrados no painel
- chunking no backend
- embedding vetorial local em JSON
- score vetorial calculado em memoria no backend
- fallback sem dependencias externas para nao travar o assistente

Segunda fase:

- embeddings do Gemini
- migrar embeddings para `pgvector`
- aplicar indice vetorial
- aumentar escala e relevancia

## Modelo e integracao

O Bee Up foi desenhado para usar Gemini.

Modelo inicial recomendado:

- `Gemini 2.5 Flash` para chat e orquestracao

Embeddings:

- modelo de embeddings do Gemini configurado por env na fase seguinte

Nao dependemos de um "plugin" proprietario. O backend sera a camada de ferramentas e de seguranca. Se no futuro trocarmos de modelo, a camada interna de tools permanece.

Na implementacao atual, o Bee Up ja roda com orquestracao local e RAG local. O proximo passo e trocar a resposta final para Gemini, mantendo a mesma camada de ferramentas do backend.

## Seguranca

Regras:

- toda acao valida se o recurso pertence ao usuario
- root pode operar recursos de todos
- usuario comum so pode atuar sobre seus proprios dados
- acoes destrutivas ou sensiveis exigem confirmacao explicita
- o Bee Up nunca altera cobranca automaticamente
- o Bee Up nao cria PR automaticamente nesta fase

## Gatilhos proativos futuros

Nao fazem parte do primeiro slice, mas estao previstos.

- alertar usuario sobre autenticacao pendente
- alertar QR expirado
- alertar falhas repetidas
- avisar quando retentativa automatica funcionou
- consolidar erro grave e enviar para suporte

## Fluxo de resposta

1. usuario envia mensagem
2. backend identifica thread
3. backend busca contexto vivo do usuario
4. backend busca chunks relevantes no RAG
5. modelo responde ou pede tool
6. backend executa a tool se valida
7. resultado volta para o modelo
8. resposta final e persistida na thread

## Fluxos iniciais importantes

### Gerar novo QR

- Bee Up identifica conta WhatsApp
- backend valida permissao
- backend chama rotina ja existente de regeneracao de QR
- resposta volta com status e orientacao

### Reagendar job

- Bee Up identifica job
- backend valida permissao
- backend calcula nova data
- backend salva job
- Bee Up responde com confirmacao

### Consultar plano

- Bee Up consulta assinatura, uso atual e limites
- responde com linguagem simples

## Frontend

O chat lateral tera:

- botao fixo do Bee Up
- drawer lateral
- lista de mensagens
- campo de pergunta
- sugestoes rapidas
- cards de acao quando houver resposta estruturada

O root tera uma tela dedicada para alimentar a base de conhecimento do Bee Up.

## Rotas implementadas

Backend:

- `GET /bee-up/summary`
- `GET /bee-up/threads`
- `GET /bee-up/threads/:id/messages`
- `POST /bee-up/chat`
- `GET /bee-up/knowledge`
- `POST /bee-up/knowledge`
- `PUT /bee-up/knowledge/:id`
- `DELETE /bee-up/knowledge/:id`
- `POST /bee-up/alerts/:id/read`

Frontend:

- drawer flutuante do Bee Up no lado direito
- tela root `Assistente Bee Up`

## Observacao operacional

As tabelas novas do Bee Up ja estao no schema Prisma e o client foi regenerado. Nesta rodada o `build` do backend e do frontend passou.

O `db push` do Prisma ficou bloqueado porque o Postgres local nao respondeu corretamente durante a atualizacao do schema. Assim que o banco estiver estavel, o passo necessario e:

```bash
npm run prisma:migrate -w apps/backend
```

## Roadmap

### Fase 1

- documentacao
- schema Prisma
- endpoints de threads, mensagens e conhecimento
- chat lateral no frontend
- RAG basico
- tools iniciais

### Fase 2

- alertas do Bee Up
- incidentes
- escalonamento para suporte

### Fase 3

- troca de busca vetorial em memoria para `pgvector`
- enriquecimento automatico de base
- integracao com GitHub issue e notificacoes externas
