import { createHash } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const EMBEDDING_DIMENSIONS = 96;

type BeeUpSeedDocument = {
  title: string;
  category: string;
  tags: string[];
  content: string;
};

const documents: BeeUpSeedDocument[] = [
  {
    title: "FAQ - Planos, trial e limites",
    category: "FAQ",
    tags: ["planos", "trial", "limites", "billing"],
    content: `O SocialUp trabalha com planos e limites por ciclo. Quando o usuário perguntar sobre plano, trial, limites de workspace, contas sociais ou publicações, consulte o estado real do sistema antes de responder.

Plano Single: operação solo, até 2 workspaces próprios, 12 contas sociais e 300 publicações por mês. Não deve tratar workspaces como clientes externos e não deve mostrar recursos de agência, bônus de agência ou feedbacks de cliente.

Plano Agency: operação com múltiplos workspaces e colaboração com cliente. Pode ter workspaces de cliente, bônus de agência, convites e aprovação com cliente conforme configuração do plano.

Trial: quando a conta estiver em degustação, explique que o período de testes termina na data indicada pelo sistema. Não invente datas. Se a informação não estiver disponível, oriente o usuário a abrir Meu plano.

Se o usuário pedir upgrade, troca de plano, pagamento ou regularização, a rota preferida é Meu plano.`,
  },
  {
    title: "Workflow - Criar e organizar workspaces",
    category: "WORKFLOW",
    tags: ["workspace", "workspaces", "criar workspace", "organização"],
    content: `Workspace é o espaço onde o usuário organiza contas, mídias e publicações.

Para criar um workspace: abrir Workspaces, clicar em adicionar workspace, informar nome e cor e salvar.

Em plano Single, o usuário pode ter até 2 workspaces próprios. Nesse plano, não mostrar linguagem de cliente, bônus agência ou estrutura de agência.

Em plano Agency, workspaces podem representar clientes ou operações da agência, conforme os recursos habilitados.

Antes de conectar contas sociais, é necessário existir pelo menos um workspace. Se não houver workspace, oriente: crie um workspace antes de conectar contas.

Se o assunto for cadastro, edição, cor, membros ou convite de workspace, a rota preferida é Workspaces.`,
  },
  {
    title: "Workflow - Conectar contas sociais",
    category: "WORKFLOW",
    tags: ["conectar contas", "instagram", "facebook", "threads", "tiktok", "x", "whatsapp"],
    content: `A tela Conectar contas é usada para vincular Instagram, Facebook, Threads, TikTok, X e WhatsApp aos workspaces.

O usuário deve selecionar o workspace correto antes de iniciar a conexão. Cada conta conectada fica associada ao workspace escolhido.

Se não houver workspace, o usuário deve criar um workspace primeiro.

Quando o usuário perguntar onde conectar ou verificar uma conta, a rota preferida é Conectar contas.

Quando o usuário perguntar status de conta conectada, use a ferramenta de status de conexões para consultar o estado real antes de responder.

Quando a conta estiver conectada, a interface deve mostrar as informações da conta e a ação principal deve ser desconectar quando aplicável.`,
  },
  {
    title: "Workflow - WhatsApp QR e autenticação",
    category: "WORKFLOW",
    tags: ["whatsapp", "qr", "autenticação", "conectar contas"],
    content: `Para WhatsApp, o usuário gera um QR Code na tela Conectar contas.

Se existir um QR ainda válido, o sistema deve reaproveitar o mesmo QR. Isso evita geração repetida e limite no provedor.

Se o QR expirou, o sistema deve gerar um novo QR.

Se o usuário abrir o modal, gerar QR e fechar sem escanear, a conta deve continuar como não conectada. O sistema pode reaproveitar o QR dentro da janela válida, mas não deve marcar a conta como conectada.

O rótulo "Autenticando" deve representar tentativa ativa de autenticação. Se o QR expirou ou não foi escaneado, a conta deve voltar para estado não conectado.

Depois de conectado, a caixa deve atualizar em tempo real e mostrar os dados da conta, como nome ou número quando disponíveis. O botão de gerar novo QR não deve aparecer para conta já conectada; a ação principal deve ser desconectar.

Se o usuário pedir novo QR ou falar em WhatsApp, QR, autenticação ou conectar dispositivo, a rota preferida é Conectar contas.`,
  },
  {
    title: "Workflow - Agendar publicações",
    category: "WORKFLOW",
    tags: ["agendar", "publicações", "mídia", "calendário"],
    content: `Para criar uma publicação, o usuário deve acessar Agendar, escolher workspace, conta social, tipo de publicação, mídia, legenda e data.

Publicações podem envolver uma ou várias redes, dependendo das contas conectadas e do tipo de conteúdo.

Se faltar workspace ou conta conectada, orientar o usuário a criar workspace ou conectar conta antes de agendar.

Se o usuário falar em calendário, data, horário, legenda, mídia, stories, reels ou postagem, a rota preferida é Agendar.

Para consultar publicações já criadas, falhas ou histórico, a rota preferida é Publicações.`,
  },
  {
    title: "Workflow - Histórico e reagendamento",
    category: "WORKFLOW",
    tags: ["histórico", "publicações", "falhas", "reagendar"],
    content: `A tela Publicações concentra histórico, status, calendário e ações sobre publicações.

Quando uma publicação falha, o Bee Up deve consultar falhas recentes antes de explicar o motivo. Não inventar causa.

Se uma publicação for elegível para nova tentativa, o Bee Up pode orientar o usuário a reagendar ou usar a ferramenta de reagendamento quando fizer sentido.

Se o usuário pedir para tentar de novo, reenfileirar, reagendar ou corrigir publicação falhada, consulte o estado real e aja com cautela.

Quando a falha depender de equipe técnica, administração ou investigação manual, acione suporte técnico e avise que a equipe técnica já foi acionada.`,
  },
  {
    title: "Policy - Escalonamento para equipe técnica",
    category: "POLICY",
    tags: ["suporte", "equipe técnica", "administração interna", "incidente", "admin"],
    content: `Quando o usuário relatar algo que depende de acesso administrativo interno, da equipe técnica, do produto ou de uma investigação manual, o Bee Up deve abrir um incidente interno.

Nesses casos, responder de forma simples: "A equipe técnica já foi acionada para acompanhar isso."

O Bee Up não deve prometer prazo, não deve inventar que o problema já foi resolvido e não deve orientar o usuário a fazer procedimentos que dependem de acesso administrativo.

Ao abrir incidente, o sistema deve registrar quem relatou, o resumo do problema e notificar a administração interna no painel administrativo.

Exemplos de casos para escalonar: dúvida que depende de ajuste de produto, comportamento inconsistente que não tem solução operacional clara, pedido para alterar regra global, erro que exige análise interna ou ação administrativa interna.`,
  },
  {
    title: "Policy - Regras de plano Single",
    category: "POLICY",
    tags: ["single", "plano", "workspaces", "limites"],
    content: `Plano Single é uma operação solo.

Para contas no Single, não usar linguagem de agência quando estiver falando com o usuário. Não destacar clientes, bônus agência, workspaces de cliente, aprovação com cliente ou feedbacks de cliente.

O Single permite até 2 workspaces próprios. Se mostrar uso de ciclo, usar "Workspaces" em vez de "Workspaces cliente".

Não mostrar "Bônus agência" quando o limite de bônus agência for zero.

Não mostrar caixas de estrutura de cliente/agência para o Single quando isso não ajudar a operação do usuário.

Quando o usuário perguntar por limites do Single, consultar o plano real antes de responder.`,
  },
  {
    title: "Policy - Regras de plano Agency",
    category: "POLICY",
    tags: ["agency", "agência", "clientes", "aprovação", "convites"],
    content: `Plano Agency é voltado a operações com múltiplos workspaces e colaboração com clientes.

Nesse plano, faz sentido falar em workspaces de cliente, bônus da agência, convites e aprovação com cliente quando esses recursos estiverem habilitados.

Se o usuário perguntar sobre colaboração, aprovação, cliente ou convite, orientar para Workspaces quando for cadastro/convite e para Publicações quando for aprovação de conteúdo.

Antes de responder sobre limites de Agency, consultar o plano real e uso atual.`,
  },
  {
    title: "Roadmap - Tools futuras do Bee Up",
    category: "ROADMAP_TOOLS",
    tags: ["tools", "tool calling", "bee up", "roadmap"],
    content: `O Bee Up deve evoluir para usar ferramentas do sistema em vez de responder apenas por texto.

Tools prioritárias: consultar limites do plano, consultar status de contas conectadas, consultar falhas recentes, gerar QR do WhatsApp, reagendar publicação, abrir tela correta do painel, abrir incidente técnico, listar workspaces e consultar uso do ciclo.

Tools futuras: executar diagnósticos por workspace, sugerir correção de cadastro, validar publicação antes do envio, explicar uso de mídia, consultar cobrança, acompanhar incidentes e criar tarefas administrativas.

Regra geral: se a resposta depende de dado real do sistema, usar tool. Se a resposta depende de regra ou tutorial, usar a base Bee Up. Se depende da equipe técnica, abrir incidente e notificar a administração interna.`,
  },
];

function createContentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function hashToken(token: string): number {
  let hash = 0;
  for (let index = 0; index < token.length; index += 1) {
    hash = (hash * 31 + token.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function createLocalEmbedding(text: string): number[] {
  const values = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return values;
  }

  for (const token of tokens) {
    values[hashToken(token) % EMBEDDING_DIMENSIONS] += 1;
  }

  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) {
    return values;
  }

  return values.map((value) => Number((value / norm).toFixed(6)));
}

function buildKnowledgeChunks(content: string): string[] {
  const paragraphs = content
    .split(/\n{2,}/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if (!currentChunk) {
      currentChunk = paragraph;
      continue;
    }

    if (currentChunk.length + paragraph.length + 2 <= 700) {
      currentChunk = `${currentChunk}\n\n${paragraph}`;
      continue;
    }

    chunks.push(currentChunk);
    currentChunk = paragraph;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.length > 0
    ? chunks
    : content
        .match(/[\s\S]{1,700}/g)
        ?.map((chunk) => chunk.trim())
        .filter(Boolean) ?? [];
}

async function upsertChunks(documentId: string, content: string): Promise<void> {
  const chunks = buildKnowledgeChunks(content);
  await prisma.aiKnowledgeChunk.deleteMany({ where: { documentId } });
  if (chunks.length === 0) {
    return;
  }

  await prisma.aiKnowledgeChunk.createMany({
    data: chunks.map((chunk, chunkIndex) => ({
      documentId,
      chunkIndex,
      content: chunk,
      contentHash: createContentHash(chunk),
      embedding: {
        provider: "local",
        values: createLocalEmbedding(chunk),
      } satisfies Prisma.InputJsonValue,
    })),
  });
}

async function main(): Promise<void> {
  const rootUser = await prisma.user.findUnique({
    where: { username: "root" },
    select: { id: true },
  });

  for (const doc of documents) {
    const existing = await prisma.aiKnowledgeDocument.findFirst({
      where: {
        title: doc.title,
        category: doc.category,
      },
      select: { id: true },
    });

    const saved = existing
      ? await prisma.aiKnowledgeDocument.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            content: doc.content,
            tags: doc.tags satisfies Prisma.InputJsonValue,
          },
        })
      : await prisma.aiKnowledgeDocument.create({
          data: {
            title: doc.title,
            category: doc.category,
            status: "ACTIVE",
            content: doc.content,
            tags: doc.tags satisfies Prisma.InputJsonValue,
            createdByUserId: rootUser?.id ?? null,
          },
        });

    await upsertChunks(saved.id, saved.content);
  }

  console.log(`Base Bee Up alimentada com ${documents.length} documentos.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
