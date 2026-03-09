# Instagram Location (Depois da Aprovação) - Playbook

Este documento resume o que precisa ser feito para habilitar localização em Post/Reel com a API oficial, mantendo a tela de consentimento do Instagram (Business Login for Instagram), conforme o material do PDF `location-instagram.pdf`.

## Objetivo

- Manter o fluxo de login com tela do Instagram.
- Publicar Post/Reel com `location_id`.
- Buscar sugestões de local automaticamente no backend.

## Pré-requisitos

1. App na Meta configurado como `Business App`.
2. Produto Instagram configurado com `API Setup with Instagram Login`.
3. Conta Instagram profissional (Business/Creator).
4. Redirect URI HTTPS válido e estável.

## Escopos/Permissões

Permissões mínimas citadas para publicação:

1. `instagram_business_basic`
2. `instagram_business_content_publish`

Permissões citadas para busca de locais (Graph):

1. `pages_read_engagement`
2. `business_management`

Observação prática: sem aprovação dessas permissões avançadas, a busca de locais pode retornar vazio/erro fora do contexto de roles de teste.

## Fase 1 - Desenvolvimento (antes do App Review aprovado)

1. Manter app em modo Development.
2. Adicionar contas de teste nas roles do app (Admin/Dev/Tester/Instagram Test User).
3. Testar publicação com `location_id` manual (ID fixo).
4. Se busca automática falhar, usar fallback temporário:
- lista estática local (mock) para UI.
- ou ID fixo por ambiente (`INSTAGRAM_FORCED_LOCATION_ID`).

## Fase 2 - Preparação para App Review

1. Preparar screencast de uso real:
- login da conta.
- criação da postagem.
- uso de localização.
- publicação com sucesso.
2. Documentar claramente por que cada permissão é necessária.
3. Garantir política de privacidade e termos públicos.
4. Revisar todos os domínios e redirect URIs no painel Meta.

## Fase 3 - Após aprovação

1. Colocar app em modo Live.
2. Reautorizar uma conta real para emitir token já com permissões aprovadas.
3. Ativar busca automática no backend para retornar lista de locais.
4. Publicar Post/Reel enviando `location_id` no container de mídia.

## Fluxo técnico esperado no sistema

1. Usuário conecta conta via tela do Instagram.
2. Frontend digita local no campo de localização.
3. Backend chama busca de locais na Graph API.
4. Frontend mostra sugestões.
5. Usuário seleciona sugestão.
6. Backend publica Post/Reel com `location_id`.
7. Se busca falhar, publicação continua sem localização ou com fallback configurado.

## Critérios de aceite

1. Login mantém interface de consentimento do Instagram.
2. Busca de local retorna sugestões para termos comuns (ex.: cidade/bairro).
3. Post/Reel publicado com localização visível.
4. Em falha de busca, postagem não quebra.
5. Logs registram claramente erro de permissão vs erro de rede.

## Checklist de produção

1. App em Live.
2. Permissões aprovadas no App Review.
3. Redirect URI HTTPS estável.
4. Rotina de renovação/reautorização de token.
5. Mensagens de erro amigáveis para usuário final.
6. Fallback seguro quando busca de local estiver indisponível.

