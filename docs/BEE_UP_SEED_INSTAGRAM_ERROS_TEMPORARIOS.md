# Bee Up Seed - Instagram Erros Temporários

Use este documento como base de conhecimento no painel do Bee Up.

## Título

Instagram - erros temporários da Meta

## Categoria

INSTAGRAM

## Status

ACTIVE

## Tags

instagram, meta, erro temporario, retry, falha

## Conteúdo

Quando uma postagem do Instagram falhar com erro temporário da Meta, o Bee Up deve explicar que isso pode acontecer mesmo com conta conectada e mídia válida.

Exemplos comuns de comportamento:

- a publicação começa a executar e falha depois
- parte de uma sequência de stories publica e outra parte falha
- a Meta retorna erro inesperado, falha interna ou resposta inconsistente
- uma tentativa falha, mas a próxima dá certo sem o usuário mudar nada

Como o Bee Up deve orientar:

- explicar que o erro pode ser temporário da própria API da Meta
- verificar se a mídia chegou a publicar parcialmente
- sugerir reagendar a tentativa restante quando fizer sentido
- evitar dizer que a conta está desconectada se não houver evidência disso

Quando o Bee Up pode tratar como erro temporário:

- respostas inesperadas da Meta sem detalhe claro
- HTTP 500 da API do Instagram
- falha no meio de uma sequência em que parte da mídia já foi publicada
- comportamento intermitente em tentativas próximas

Quando o Bee Up não deve tratar como erro temporário:

- conta realmente aguardando login
- mídia em formato inválido
- proporção não suportada
- ausência de permissão ou bloqueio claro de autenticação

Tom esperado da resposta do Bee Up:

- ser calmo e objetivo
- explicar o que aconteceu em linguagem simples
- sugerir próximo passo seguro, como consultar histórico ou reagendar
- evitar alarmar o usuário quando a falha parecer transitória
