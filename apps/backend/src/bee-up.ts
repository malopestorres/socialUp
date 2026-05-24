import express, { type Express, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AdminUserAuth } from "./admin-auth.js";
import { prisma } from "./prisma.js";
import { resolveWhatsappConnectionRuntimeMetadata } from "./whatsapp-evolution-api.js";

type BeeUpAuthRequest = Request & { adminUser?: AdminUserAuth };

type BeeUpBillingPlan = {
  id: string;
  code: string;
  name: string;
  isTrial: boolean;
  maxProfiles: number;
  maxConnections: number;
  maxMonthlyPublications: number;
} | null;

type BeeUpBillingSnapshot = {
  status: string;
  billingModel: string;
  cycle: string | null;
  isBlocked: boolean;
  blockMessage: string | null;
  plan: BeeUpBillingPlan;
  usage: {
    profilesUsed: number;
    connectionsUsed: number;
    postsUsedThisMonth: number;
  };
};

type BeeUpDependencyLogInput = {
  companyId: string;
  level: "INFO" | "WARN" | "ERROR";
  errorCode?: string | null;
  message: string;
  screenshotPath?: string | null;
};

type BeeUpDependencyAvisoInput = {
  userId: string;
  title: string;
  message: string;
  kind?: string;
  createdByUserId?: string | null;
};

type BeeUpRegisterDependencies = {
  isRootUser: (request: BeeUpAuthRequest) => boolean;
  resolveUserBillingAccess: (userId: string) => Promise<BeeUpBillingSnapshot>;
  requestWhatsappQr: (connectionId: string, forceRegenerate: boolean) => Promise<void>;
  getWhatsappConnectionOverlay?: (connectionId: string) => Partial<Record<string, unknown>>;
  appendLog: (input: BeeUpDependencyLogInput) => Promise<void>;
  appendAviso?: (input: BeeUpDependencyAvisoInput) => Promise<void>;
};

type BeeUpKnowledgeDocInput = {
  title: string;
  category?: string;
  status?: string;
  content: string;
  tags?: string[];
};

type BeeUpSource = {
  title: string;
  category: string;
  content: string;
  score: number;
  origin: "SYSTEM" | "ROOT";
};

type BeeUpAction =
  | {
      type: "OPEN_VIEW";
      label: string;
      view: "dashboard" | "companies" | "agents" | "scheduler" | "history" | "profile" | "plan";
    }
  | {
      type: "REFRESH_BEE_UP";
      label: string;
    };

type BeeUpOpenView = Extract<BeeUpAction, { type: "OPEN_VIEW" }>["view"];

type BeeUpToolExecutionResult = {
  name: string;
  summary: string;
  details?: string[];
  actions?: BeeUpAction[];
  payload?: Record<string, unknown>;
  logStatus: "SUCCESS" | "FAILED" | "SKIPPED";
  errorMessage?: string | null;
};

type BeeUpSummaryAlert = {
  id: string;
  kind: "warning" | "info" | "success";
  title: string;
  message: string;
  actions?: BeeUpAction[];
};

const BEE_UP_THREAD_TITLE_MAX_LENGTH = 42;
const BEE_UP_LOCAL_EMBEDDING_DIMENSIONS = 96;
const BEE_UP_SEARCH_LIMIT = 4;
const BEE_UP_DEFAULT_RESCHEDULE_MINUTES = 20;
const BEE_UP_MAX_RESCHEDULE_MINUTES = 60 * 24 * 30;
const BEE_UP_QR_REUSE_WINDOW_MS = Number.parseInt(process.env.EVOLUTION_QR_REUSE_WINDOW_MS || "45000", 10) || 45_000;
const BEE_UP_GEMINI_API_KEY = trimNullable(process.env.BEE_UP_GEMINI_API_KEY) || trimNullable(process.env.GEMINI_API_KEY);
const BEE_UP_GEMINI_MODEL = trimNullable(process.env.BEE_UP_GEMINI_MODEL) || "gemini-2.5-flash";
const BEE_UP_GEMINI_API_BASE =
  trimNullable(process.env.BEE_UP_GEMINI_API_BASE)?.replace(/\/+$/g, "") || "https://generativelanguage.googleapis.com/v1beta";
const BEE_UP_GEMINI_TIMEOUT_MS = Number.parseInt(process.env.BEE_UP_GEMINI_TIMEOUT_MS || "12000", 10) || 12_000;

const beeUpKnowledgeSchema = z.object({
  title: z.string().trim().min(3).max(120),
  category: z.string().trim().min(2).max(40).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  content: z.string().trim().min(20).max(40_000),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});

const beeUpChatSchema = z.object({
  threadId: z.string().trim().min(1).max(64).optional(),
  message: z.string().trim().min(2).max(4_000),
  currentView: z.string().trim().min(1).max(64).optional(),
  toolIntent: z
    .enum(["get_plan_limits", "get_recent_failures", "get_connection_status", "generate_whatsapp_qr"])
    .optional(),
  toolParams: z
    .object({
      workspaceId: z.string().trim().min(1).max(80).optional(),
    })
    .optional(),
});

const beeUpBuiltInDocuments: Array<{ title: string; category: string; content: string }> = [
  {
    title: "Navegação do painel",
    category: "NAVIGACAO",
    content:
      "Dashboard mostra proximos agendamentos e graficos. Perfis gerencia os perfis do usuario. Conectar contas abre a area de Instagram e WhatsApp. Agendar cria publicacoes. Historico mostra postagens criadas, publicadas, com falha ou aguardando login. Meu plano mostra limite, assinatura e uso do ciclo. Meu perfil ajusta nome, usuario e fuso horario.",
  },
  {
    title: "Instagram no SocialUp",
    category: "INSTAGRAM",
    content:
      "Instagram Post aceita legenda e primeiro comentario. Instagram Reel aceita legenda e primeiro comentario. Instagram Story nao usa legenda padrao na publicacao oficial e pode usar o mini editor de story para imagens. Quando a conta exigir autenticacao, o usuario precisa concluir o login oficial. Falhas temporarias da Meta podem acontecer e o historico permite reagendar o restante da sequencia.",
  },
  {
    title: "WhatsApp no SocialUp",
    category: "WHATSAPP",
    content:
      "WhatsApp usa conexao via Evolution API. Quando o QR expira, o usuario pode gerar um novo QR. WhatsApp Status aceita texto ou midia. O relink do Instagram para WhatsApp hoje funciona melhor como status de midia com legenda contendo o link da publicacao original. Stories do Instagram so podem relinkar para WhatsApp quando forem story unico.",
  },
  {
    title: "Planos e limites",
    category: "BILLING",
    content:
      "O limite mensal considera publicacoes do estado publicado dentro do ciclo atual. Se a conta estiver sem plano ativo, expirada ou bloqueada por cobranca, o backend impede novas operacoes de agendamento. A conta administrativa interna pode ter um plano de exibicao proprio no painel para testes e administracao. Trial automatico pode ser ligado ou desligado nas configuracoes basicas de planos.",
  },
  {
    title: "Assistente Bee Up",
    category: "BEE_UP",
    content:
      "O Assistente Bee Up responde duvidas, consulta limites, verifica falhas, checa status de contas, gera novo QR do WhatsApp, orienta navegacao e abre incidentes internos. Nesta primeira fase ele nao corrige bugs sozinho nem cria pull request automatico. Acoes sensiveis devem ser seguras e registradas em log.",
  },
];

type IndexedKnowledgeChunk = {
  id: string;
  title: string;
  category: string;
  content: string;
  origin: "SYSTEM" | "ROOT";
  score: number;
};

type BeeUpChatReply = {
  content: string;
  sources: BeeUpSource[];
  actions: BeeUpAction[];
  mode: "LOCAL_RAG" | "GEMINI_RAG";
  toolName?: string | null;
};

type BeeUpGeminiFunctionCall = {
  name: string;
  args: Record<string, unknown>;
};

type BeeUpGeminiResponse = {
  candidates?: Array<{
    content?: {
      role?: string;
      parts?: Array<{
        text?: string;
        functionCall?: {
          name?: string;
          args?: Record<string, unknown>;
        };
      }>;
    };
  }>;
};

type BeeUpConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

type BeeUpGeminiReply = {
  content: string;
  toolResult: BeeUpToolExecutionResult | null;
  toolName: string | null;
  mode: "GEMINI_RAG";
};

type BeeUpGeminiContentPart = {
  text?: string;
  functionCall?: {
    name?: string;
    args?: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: {
      summary: string;
      details: string[];
      payload: Record<string, unknown> | null;
      logStatus: BeeUpToolExecutionResult["logStatus"];
      errorMessage: string | null;
    };
  };
};

type BeeUpGeminiContent = {
  role: string;
  parts: BeeUpGeminiContentPart[];
};

function trimNullable(value: string | null | undefined): string | null {
  const normalized = (value || "").trim();
  return normalized ? normalized : null;
}

function getFirstName(value: string | null | undefined): string | null {
  const normalized = trimNullable(value);
  if (!normalized) {
    return null;
  }
  const [firstName] = normalized.split(/\s+/g);
  return firstName || null;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function uniqueTokens(value: string): string[] {
  return Array.from(new Set(tokenize(value)));
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function parseOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return trimNullable(value);
}

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function formatBeeUpError(error: unknown): string {
  if (error instanceof Error && trimNullable(error.message)) {
    return truncateText(error.message, 600);
  }
  return "Erro desconhecido no Bee Up.";
}

function formatToolDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "data indefinida";
  }
  return date.toLocaleString("pt-BR");
}

function parseStoredEmbedding(raw: unknown): number[] | null {
  if (!raw) {
    return null;
  }

  if (Array.isArray(raw)) {
    const values = raw.filter((value) => typeof value === "number") as number[];
    return values.length > 0 ? values : null;
  }

  if (typeof raw === "object" && raw && "values" in raw) {
    const values = (raw as { values?: unknown }).values;
    if (Array.isArray(values)) {
      const normalized = values.filter((value) => typeof value === "number") as number[];
      return normalized.length > 0 ? normalized : null;
    }
  }

  return null;
}

function createContentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashToken(token: string): number {
  let hash = 0;
  for (let index = 0; index < token.length; index += 1) {
    hash = (hash * 31 + token.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function createLocalEmbedding(text: string): number[] {
  const values = new Array<number>(BEE_UP_LOCAL_EMBEDDING_DIMENSIONS).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return values;
  }

  for (const token of tokens) {
    const dimension = hashToken(token) % BEE_UP_LOCAL_EMBEDDING_DIMENSIONS;
    values[dimension] += 1;
  }

  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) {
    return values;
  }

  return values.map((value) => value / norm);
}

function cosineSimilarity(left: number[] | null, right: number[] | null): number {
  if (!left || !right || left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    sum += (left[index] || 0) * (right[index] || 0);
  }
  return sum;
}

function lexicalSimilarity(query: string, candidate: string): number {
  const queryTokens = uniqueTokens(query);
  if (queryTokens.length === 0) {
    return 0;
  }

  const candidateText = normalizeText(candidate);
  let matched = 0;
  for (const token of queryTokens) {
    if (candidateText.includes(token)) {
      matched += 1;
    }
  }

  return matched / queryTokens.length;
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

    if ((currentChunk.length + paragraph.length + 2) <= 700) {
      currentChunk = `${currentChunk}\n\n${paragraph}`;
      continue;
    }

    chunks.push(currentChunk);
    currentChunk = paragraph;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  if (chunks.length > 0) {
    return chunks;
  }

  return content
    .match(/[\s\S]{1,700}/g)
    ?.map((chunk) => chunk.trim())
    .filter(Boolean) ?? [];
}

function buildThreadTitle(message: string): string {
  const normalized = normalizeText(message);
  const normalizedCompact = normalized.replace(/\s+/g, " ").trim();
  const greetingTokens = new Set([
    "oi",
    "ola",
    "olá",
    "bom dia",
    "boa tarde",
    "boa noite",
    "hey",
    "hi",
    "hello",
  ]);

  // Evita criar threads com titulo "Oi" e similares.
  if (normalizedCompact.length <= 12 && greetingTokens.has(normalizedCompact)) {
    return "Nova conversa";
  }
  const topicRules: Array<{ matches: (value: string) => boolean; title: string }> = [
    {
      matches: (value) => value.includes("instagram") && (value.includes("autenticacao") || value.includes("login")),
      title: "Instagram e autenticação",
    },
    {
      matches: (value) =>
        value.includes("instagram") &&
        (value.includes("publica") || value.includes("publicar") || value.includes("conectada") || value.includes("conectado")),
      title: "Instagram não publica",
    },
    {
      matches: (value) =>
        (value.includes("meta") || value.includes("instagram")) &&
        (value.includes("erro") || value.includes("falha") || value.includes("temporar")),
      title: "Erros temporários da Meta",
    },
    {
      matches: (value) => value.includes("whatsapp") && (value.includes("qr") || value.includes("qrcode")),
      title: "QR do WhatsApp",
    },
    {
      matches: (value) => value.includes("whatsapp") && value.includes("status"),
      title: "WhatsApp Status",
    },
    {
      matches: (value) => value.includes("limite") && value.includes("plano"),
      title: "Limites do plano",
    },
    {
      matches: (value) =>
        value.includes("assinatura") || value.includes("pix") || value.includes("cobranca") || value.includes("cobranca"),
      title: "Cobrança e assinatura",
    },
    {
      matches: (value) => value.includes("reagend"),
      title: "Reagendamento de postagem",
    },
    {
      matches: (value) => value.includes("falha") || value.includes("falhou"),
      title: "Falhas de postagem",
    },
    {
      matches: (value) => value.includes("perfil") && (value.includes("fuso") || value.includes("conta")),
      title: "Minha conta",
    },
    {
      matches: (value) => value.includes("conectar") && value.includes("conta"),
      title: "Conectar contas",
    },
  ];

  const matchedRule = topicRules.find((rule) => rule.matches(normalized));
  if (matchedRule) {
    return matchedRule.title;
  }

  const cleaned = message.replace(/\s+/g, " ").trim().replace(/[?!.,;:]+$/g, "");
  const stripped = cleaned
    .replace(/^(meu|minha|meus|minhas)\s+/i, "")
    .replace(/^(o que eu faço(?: agora)?|o que faço(?: agora)?|como faço(?: para)?|por que|porque|isso pode ser|pode ser|quero saber|me explique|me explica|veja|preciso saber|preciso entender)\s+/i, "")
    .trim();
  const fallback = stripped || cleaned || "Nova conversa";
  return truncateText(fallback.charAt(0).toUpperCase() + fallback.slice(1), BEE_UP_THREAD_TITLE_MAX_LENGTH);
}

function shouldRefreshThreadTitle(currentTitle: string | null | undefined, message: string): boolean {
  const normalizedCurrent = trimNullable(currentTitle);
  if (!normalizedCurrent) {
    return true;
  }

  const normalizedCurrentKey = normalizeText(normalizedCurrent).replace(/\s+/g, " ").trim();
  if (
    normalizedCurrent.length <= 14 &&
    (normalizedCurrentKey === "nova conversa" ||
      normalizedCurrentKey === "oi" ||
      normalizedCurrentKey === "ola" ||
      normalizedCurrentKey === "olá" ||
      normalizedCurrentKey === "bom dia" ||
      normalizedCurrentKey === "boa tarde" ||
      normalizedCurrentKey === "boa noite" ||
      normalizedCurrentKey === "hey" ||
      normalizedCurrentKey === "hi" ||
      normalizedCurrentKey === "hello")
  ) {
    return true;
  }

  if (normalizedCurrent.length > BEE_UP_THREAD_TITLE_MAX_LENGTH) {
    return true;
  }

  const normalizedMessage = truncateText(message.replace(/\s+/g, " ").trim(), normalizedCurrent.length + 4);
  if (normalizeText(normalizedCurrent) === normalizeText(normalizedMessage)) {
    return true;
  }

  return /[?]/.test(normalizedCurrent) && normalizedCurrent.length > 30;
}

function toJsonInputValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function ownedByUserId(request: BeeUpAuthRequest, dependencies: BeeUpRegisterDependencies): string | undefined {
  return dependencies.isRootUser(request) ? undefined : request.adminUser?.id;
}

function parseDelayMinutesFromMessage(message: string): number {
  const normalized = normalizeText(message);
  const hourMatch = normalized.match(/(\d{1,3})\s*h(?:ora|oras)?/);
  if (hourMatch) {
    const hours = Number.parseInt(hourMatch[1] || "", 10);
    if (Number.isFinite(hours) && hours > 0) {
      return Math.min(hours * 60, BEE_UP_MAX_RESCHEDULE_MINUTES);
    }
  }

  const minuteMatch = normalized.match(/(\d{1,4})\s*min(?:uto|utos)?/);
  if (minuteMatch) {
    const minutes = Number.parseInt(minuteMatch[1] || "", 10);
    if (Number.isFinite(minutes) && minutes > 0) {
      return Math.min(minutes, BEE_UP_MAX_RESCHEDULE_MINUTES);
    }
  }

  return BEE_UP_DEFAULT_RESCHEDULE_MINUTES;
}

function hasBeeUpGeminiEnabled(): boolean {
  return Boolean(BEE_UP_GEMINI_API_KEY);
}

function actionLabelForView(view: BeeUpOpenView): string {
  const actionLabelByView: Record<BeeUpOpenView, string> = {
    dashboard: "Abrir Dashboard",
    companies: "Abrir Workspaces",
    agents: "Abrir Conectar contas",
    scheduler: "Abrir Agendar",
    history: "Abrir Histórico",
    profile: "Abrir Meu perfil",
    plan: "Abrir Meu plano",
  };
  return actionLabelByView[view];
}

function normalizeOpenViewByMessage(view: BeeUpOpenView, message: string): BeeUpOpenView {
  const inferredView = inferViewFromMessage(message);
  if (view === "companies" && inferredView === "agents") {
    return "agents";
  }
  return view;
}

function normalizeBeeUpAction(action: BeeUpAction, message: string): BeeUpAction {
  if (action.type !== "OPEN_VIEW") {
    return action;
  }

  const normalizedView = normalizeOpenViewByMessage(action.view, message);
  return {
    ...action,
    view: normalizedView,
    label: actionLabelForView(normalizedView),
  };
}

function buildBeeUpActions(message: string, toolResult: BeeUpToolExecutionResult | null): BeeUpAction[] {
  const actions: BeeUpAction[] = toolResult?.actions ? toolResult.actions.map((action) => normalizeBeeUpAction(action, message)) : [];

  if (actions.length === 0) {
    const view = inferViewFromMessage(message);
    if (view) {
      actions.push({
        type: "OPEN_VIEW",
        label: actionLabelForView(view),
        view,
      });
    }
  }

  return actions;
}

function buildBeeUpActionsFromReplyText(
  message: string,
  replyContent: string,
  toolResult: BeeUpToolExecutionResult | null,
): BeeUpAction[] {
  const actions = buildBeeUpActions(message, toolResult);
  if (actions.length > 0) {
    return actions;
  }

  const view = inferViewFromMessage(replyContent);
  if (!view) {
    return actions;
  }

  return [
    {
      type: "OPEN_VIEW",
      label: actionLabelForView(view),
      view,
    },
  ];
}

function buildBeeUpGeminiSystemInstruction(request: BeeUpAuthRequest, isFirstTurn: boolean): string {
  const currentUser = request.adminUser;
  const userLabel = currentUser ? `${currentUser.name || currentUser.username} (@${currentUser.username})` : "usuário autenticado";
  const firstName = getFirstName(currentUser?.name || currentUser?.username);

  return [
    "Você é o Assistente Bee Up do painel SocialUp.",
    `Usuário atual: ${userLabel}.`,
    "Responda sempre em pt-BR, com tom humano, claro, prestativo e direto.",
    "Nunca use markdown com asteriscos literais para destacar texto. Se quiser destacar algo, escreva normalmente e deixe a interface cuidar da ênfase.",
    "Use emojis de forma leve e simpática, no máximo 1 ou 2 por resposta, sem exagerar.",
    "Nunca invente status, limites, falhas ou conexões. Quando a informação depender do estado real do sistema ou exigir ação, use uma tool disponível.",
    "Quando a base Bee Up trouxer contexto suficiente, use esse material sem chamar tool desnecessária.",
    "Se uma tool retornar falha ou ambiguidade, explique isso com naturalidade e sugira o próximo passo mais seguro.",
    "Quando o usuário relatar algo que depende de acesso administrativo interno, da equipe técnica, do produto ou de investigação manual para resolver, chame a tool open_support_incident e diga que a equipe técnica já foi acionada.",
    "Nunca use a palavra root em respostas para usuário final. Quando precisar desse conceito, diga administração interna ou acesso administrativo interno.",
    "Não diga que você é um modelo de linguagem. Você é o assistente do sistema.",
    "Quando citar uma action possível, combine isso com o contexto da própria resposta, sem virar lista gigante.",
    "Para assuntos de Instagram, WhatsApp, autenticação, login, QR ou conta conectada, a rota preferida é Conectar contas.",
    "Só sugira Perfis quando o assunto for realmente cadastro de perfis, unidades ou perfis de postagem.",
    isFirstTurn
      ? `Esta é a primeira resposta da conversa. Comece com uma saudação curta, simpática e natural${firstName ? ` chamando o usuário de ${firstName}` : ""}.`
      : "Esta não é a primeira resposta da conversa. Não repita saudação com nome sem necessidade.",
  ].join("\n");
}

function buildBeeUpGeminiPrompt(input: {
  message: string;
  currentView?: string | null;
  sources: BeeUpSource[];
  isFirstTurn: boolean;
}): string {
  const contextLines = [
    `View atual do usuário: ${input.currentView || "desconhecida"}.`,
    `Primeira interação desta conversa: ${input.isFirstTurn ? "sim" : "não"}.`,
  ];

  if (input.sources.length > 0) {
    contextLines.push("Base Bee Up relevante:");
    for (const source of input.sources.slice(0, 3)) {
      contextLines.push(`- [${source.category}] ${source.title}: ${source.content}`);
    }
  } else {
    contextLines.push("Nenhum trecho relevante da base Bee Up foi encontrado para esta pergunta.");
  }

  return [
    contextLines.join("\n"),
    `Pedido do usuário: ${input.message}`,
  ].join("\n\n");
}

function buildBeeUpGeminiToolDeclarations() {
  return [
    {
      name: "get_plan_limits",
      description: "Consulta o plano atual do usuário, uso do ciclo, bloqueio de billing e limites disponíveis.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    {
      name: "get_recent_failures",
      description: "Lista falhas recentes de postagens do usuário para explicar o problema ou orientar o próximo passo.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    {
      name: "get_connection_status",
      description: "Consulta o estado das contas sociais conectadas do usuário, incluindo contas aguardando autenticação.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    {
      name: "generate_whatsapp_qr",
      description: "Solicita um novo QR do WhatsApp para uma conexão do usuário.",
      parameters: {
        type: "OBJECT",
        properties: {
          connectionName: {
            type: "STRING",
            description: "Nome da conta WhatsApp citada pelo usuário, quando houver.",
          },
        },
      },
    },
    {
      name: "reschedule_job",
      description: "Reagenda a postagem elegível mais recente do usuário para uma nova tentativa.",
      parameters: {
        type: "OBJECT",
        properties: {
          delayMinutes: {
            type: "NUMBER",
            description: "Quantos minutos no futuro devem ser usados no reagendamento.",
          },
        },
      },
    },
    {
      name: "open_support_incident",
      description: "Abre um incidente interno de suporte quando o usuário pede escalonamento ou relata algo que precisa de acompanhamento.",
      parameters: {
        type: "OBJECT",
        properties: {
          summary: {
            type: "STRING",
            description: "Resumo curto do problema para registro do incidente.",
          },
        },
      },
    },
    {
      name: "open_view",
      description: "Sugere e abre a view mais adequada do painel.",
      parameters: {
        type: "OBJECT",
        properties: {
          view: {
            type: "STRING",
            enum: ["dashboard", "companies", "agents", "scheduler", "history", "profile", "plan"],
            description: "Identificador da view que deve ser aberta.",
          },
        },
        required: ["view"],
      },
    },
  ];
}

function mapConversationToGeminiContents(messages: BeeUpConversationMessage[]) {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  })) satisfies BeeUpGeminiContent[];
}

function extractBeeUpGeminiText(responseBody: BeeUpGeminiResponse): string {
  const parts = responseBody.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractBeeUpGeminiFunctionCall(responseBody: BeeUpGeminiResponse): BeeUpGeminiFunctionCall | null {
  const parts = responseBody.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.functionCall?.name) {
      return {
        name: part.functionCall.name,
        args: part.functionCall.args && typeof part.functionCall.args === "object" ? part.functionCall.args : {},
      };
    }
  }
  return null;
}

async function callBeeUpGeminiApi(payload: Record<string, unknown>): Promise<BeeUpGeminiResponse> {
  if (!BEE_UP_GEMINI_API_KEY) {
    throw new Error("Bee Up Gemini está sem chave configurada.");
  }

  const endpoint = `${BEE_UP_GEMINI_API_BASE}/models/${encodeURIComponent(BEE_UP_GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(BEE_UP_GEMINI_API_KEY)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(BEE_UP_GEMINI_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Bee Up Gemini HTTP ${response.status}: ${truncateText(errorText || "Falha sem detalhe.", 320)}`);
  }

  return (await response.json()) as BeeUpGeminiResponse;
}

function inferViewFromMessage(message: string): BeeUpOpenView | null {
  const normalized = normalizeText(message);
  if (normalized.includes("plano") || normalized.includes("assinatura") || normalized.includes("cobranca")) {
    return "plan";
  }
  if (
    normalized.includes("instagram") ||
    normalized.includes("whatsapp") ||
    normalized.includes("conectar") ||
    normalized.includes("conexao") ||
    normalized.includes("conectada") ||
    normalized.includes("conectado") ||
    normalized.includes("conta") ||
    normalized.includes("autenticacao") ||
    normalized.includes("autenticada") ||
    normalized.includes("login") ||
    normalized.includes("conta social") ||
    normalized.includes("qr")
  ) {
    return "agents";
  }
  if (
    normalized.includes("meu perfil") ||
    normalized.includes("perfil do usuario") ||
    normalized.includes("perfil da conta")
  ) {
    return "profile";
  }
  if (normalized.includes("historico") || normalized.includes("falha") || normalized.includes("agendamento")) {
    return "history";
  }
  if (normalized.includes("agendar") || normalized.includes("postar")) {
    return "scheduler";
  }
  if (normalized.includes("dashboard") || normalized.includes("home")) {
    return "dashboard";
  }
  if (
    normalized.includes("workspace") ||
    normalized.includes("workspaces") ||
    normalized.includes("criar workspace") ||
    normalized.includes("novo workspace") ||
    normalized.includes("perfil da empresa") ||
    normalized.includes("unidade") ||
    normalized.includes("perfil de postagem") ||
    normalized.includes("perfis")
  ) {
    return "companies";
  }
  return null;
}

function detectToolIntent(message: string): BeeUpToolExecutionResult["name"] | null {
  const normalized = normalizeText(message);
  if ((normalized.includes("qr") || normalized.includes("qrcode")) && normalized.includes("whatsapp")) {
    return "generate_whatsapp_qr";
  }
  if (
    normalized.includes("limite") ||
    normalized.includes("meu plano") ||
    normalized.includes("quantos posts") ||
    normalized.includes("publicacoes restantes") ||
    normalized.includes("assinatura")
  ) {
    return "get_plan_limits";
  }
  if (
    normalized.includes("falha") ||
    normalized.includes("falhou") ||
    normalized.includes("erro") ||
    normalized.includes("deu erro")
  ) {
    return "get_recent_failures";
  }
  if (
    normalized.includes("status da conta") ||
    normalized.includes("contas conectadas") ||
    normalized.includes("conexao") ||
    normalized.includes("autenticacao") ||
    normalized.includes("login do instagram")
  ) {
    return "get_connection_status";
  }
  if (
    normalized.includes("reagenda") ||
    normalized.includes("reagendar") ||
    normalized.includes("reenfileira") ||
    normalized.includes("tentar de novo")
  ) {
    return "reschedule_job";
  }
  if (
    normalized.includes("suporte") ||
    normalized.includes("incidente") ||
    normalized.includes("abrir chamado") ||
    normalized.includes("avisar suporte")
  ) {
    return "open_support_incident";
  }
  if (
    normalized.includes("onde fica") ||
    normalized.includes("ir para") ||
    normalized.includes("abre a tela") ||
    normalized.includes("abrir a tela")
  ) {
    return "open_view";
  }
  return null;
}

function builtInKnowledgeChunks(): IndexedKnowledgeChunk[] {
  const indexed: IndexedKnowledgeChunk[] = [];
  for (const document of beeUpBuiltInDocuments) {
    const chunks = buildKnowledgeChunks(document.content);
    chunks.forEach((chunk, index) => {
      indexed.push({
        id: `system-${document.category}-${index}`,
        title: document.title,
        category: document.category,
        content: chunk,
        origin: "SYSTEM",
        score: 0,
      });
    });
  }
  return indexed;
}

async function indexRootKnowledgeChunks(): Promise<IndexedKnowledgeChunk[]> {
  const chunks = await prisma.aiKnowledgeChunk.findMany({
    where: {
      document: {
        status: "ACTIVE",
      },
    },
    include: {
      document: {
        select: {
          title: true,
          category: true,
        },
      },
    },
  });

  return chunks.map((chunk) => ({
    id: chunk.id,
    title: chunk.document.title,
    category: chunk.document.category,
    content: chunk.content,
    origin: "ROOT" as const,
    score: 0,
  }));
}

async function searchKnowledgeSources(query: string): Promise<BeeUpSource[]> {
  const candidates = [...builtInKnowledgeChunks(), ...(await indexRootKnowledgeChunks())];
  if (candidates.length === 0) {
    return [];
  }

  const queryEmbedding = createLocalEmbedding(query);
  const scored = candidates
    .map((candidate) => {
      const vectorScore = cosineSimilarity(queryEmbedding, createLocalEmbedding(candidate.content));
      const lexicalScore = lexicalSimilarity(query, `${candidate.title}\n${candidate.content}`);
      const score = vectorScore * 0.55 + lexicalScore * 0.45;
      return {
        ...candidate,
        score,
      };
    })
    .filter((candidate) => candidate.score > 0.14)
    .sort((left, right) => right.score - left.score);

  const deduped: typeof scored = [];
  const seenDocuments = new Set<string>();
  for (const candidate of scored) {
    const documentKey = `${candidate.origin}:${candidate.category}:${candidate.title}`;
    if (seenDocuments.has(documentKey)) {
      continue;
    }
    seenDocuments.add(documentKey);
    deduped.push(candidate);
    if (deduped.length >= BEE_UP_SEARCH_LIMIT) {
      break;
    }
  }

  return deduped.map((candidate) => ({
    title: candidate.title,
    category: candidate.category,
    content: truncateText(candidate.content.replace(/\s+/g, " ").trim(), 220),
    score: candidate.score,
    origin: candidate.origin,
  }));
}

async function upsertKnowledgeDocumentChunks(documentId: string, content: string): Promise<void> {
  const chunks = buildKnowledgeChunks(content);
  await prisma.aiKnowledgeChunk.deleteMany({
    where: { documentId },
  });

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

async function resolveVisibleWhatsappConnections(
  request: BeeUpAuthRequest,
  dependencies: BeeUpRegisterDependencies,
) {
  const userId = request.adminUser?.id;
  if (!dependencies.isRootUser(request) && !userId) {
    return [];
  }

  const where: Prisma.SocialConnectionWhereInput = {
    platform: "whatsapp",
  };

  if (!dependencies.isRootUser(request)) {
    where.OR = [
      { createdByUserId: userId },
      { company: { createdByUserId: userId } },
      { company: { members: { some: { userId } } } },
    ];
  }

  return prisma.socialConnection.findMany({
    where,
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
      companyId: true,
      displayName: true,
      authStatus: true,
      loginIdentifier: true,
      createdByUserId: true,
      company: {
        select: {
          name: true,
        },
      },
    },
  });
}

function resolveBeeUpWorkspaceRole(
  workspace: {
    createdByUserId: string | null;
    members: Array<{ userId: string; role: string }>;
  },
  userId: string,
): string | null {
  const membershipRole = workspace.members.find((member) => member.userId === userId)?.role ?? null;
  return membershipRole || (workspace.createdByUserId === userId ? "CENTRAL" : null);
}

function canBeeUpConnectWorkspaceAccounts(
  request: BeeUpAuthRequest,
  dependencies: BeeUpRegisterDependencies,
  workspace: {
    createdByUserId: string | null;
    kind: string;
    status: string;
    members: Array<{ userId: string; role: string }>;
  },
): boolean {
  if (dependencies.isRootUser(request)) {
    return true;
  }

  if (workspace.status !== "ACTIVE") {
    return false;
  }

  const userId = request.adminUser?.id;
  if (!userId) {
    return false;
  }

  const currentRole = resolveBeeUpWorkspaceRole(workspace, userId);
  if (workspace.kind === "AGENCY_BONUS") {
    return currentRole === "CENTRAL" || currentRole === "AGENCY";
  }

  if (currentRole === "CLIENT") {
    return true;
  }

  const hasClientMember = workspace.members.some((member) => member.role === "CLIENT");
  return currentRole === "CENTRAL" && !hasClientMember;
}

async function resolveWhatsappEligibleWorkspaces(
  request: BeeUpAuthRequest,
  dependencies: BeeUpRegisterDependencies,
) {
  const userId = request.adminUser?.id;
  if (!dependencies.isRootUser(request) && !userId) {
    return [];
  }

  const where: Prisma.CompanyWhereInput = {
    status: "ACTIVE",
  };

  if (!dependencies.isRootUser(request)) {
    where.OR = [
      { createdByUserId: userId },
      { members: { some: { userId } } },
    ];
  }

  const workspaces = await prisma.company.findMany({
    where,
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
      name: true,
      createdByUserId: true,
      kind: true,
      status: true,
      members: {
        select: {
          userId: true,
          role: true,
        },
      },
      connections: {
        where: {
          platform: "whatsapp",
        },
        select: {
          id: true,
        },
        take: 1,
      },
    },
  });

  return workspaces.filter(
    (workspace) =>
      workspace.connections.length === 0 &&
      canBeeUpConnectWorkspaceAccounts(request, dependencies, workspace),
  );
}

async function createWhatsappConnectionForWorkspace(workspaceId: string, userId?: string | null) {
  return prisma.socialConnection.create({
    data: {
      companyId: workspaceId,
      createdByUserId: userId,
      platform: "whatsapp",
      provider: "NATIVE",
      displayName: "Conta WhatsApp",
      loginIdentifier: null,
      secretCipher: null,
      authStatus: "AUTH_REQUIRED",
      automationMode: "VISUAL",
      authLaunchUrl: "https://web.whatsapp.com/",
      tokenExpiresAt: null,
    },
  });
}

async function executePlanLimitsTool(
  request: BeeUpAuthRequest,
  dependencies: BeeUpRegisterDependencies,
): Promise<BeeUpToolExecutionResult> {
  const userId = request.adminUser?.id;
  if (!userId) {
    return {
      name: "get_plan_limits",
      summary: "Não consegui validar o plano porque a sessão do usuário não está disponível.",
      logStatus: "FAILED",
      errorMessage: "Sessão do usuário ausente.",
    };
  }

  if (dependencies.isRootUser(request)) {
    return {
      name: "get_plan_limits",
      summary: "Você está usando a conta administrativa interna. O Bee Up vai considerar o maior plano ativo para exibição administrativa.",
      details: ["A conta administrativa interna não fica bloqueada por billing no painel administrativo."],
      actions: [
        {
          type: "OPEN_VIEW",
          label: "Abrir Meu plano",
          view: "plan",
        },
      ],
      payload: {
        billingStatus: "ACTIVE",
        billingModel: "MANUAL",
        billingCycle: null,
        blocked: false,
        planName: "Root",
      },
      logStatus: "SUCCESS",
    };
  }

  const billing = await dependencies.resolveUserBillingAccess(userId);
  const planName = billing.plan?.name ?? "Sem plano ativo";

  return {
    name: "get_plan_limits",
    summary:
      billing.plan
        ? `Seu plano atual é ${planName}. Você usou ${billing.usage.postsUsedThisMonth} de ${billing.plan.maxMonthlyPublications} publicações neste ciclo.`
        : "Sua conta está sem plano ativo no momento.",
    details: [
      `Perfis: ${billing.usage.profilesUsed}/${billing.plan?.maxProfiles ?? 0}`,
      `Contas: ${billing.usage.connectionsUsed}/${billing.plan?.maxConnections ?? 0}`,
      `Publicações no ciclo: ${billing.usage.postsUsedThisMonth}/${billing.plan?.maxMonthlyPublications ?? 0}`,
      `Status do billing: ${billing.status}`,
    ],
    actions: [
      {
        type: "OPEN_VIEW",
        label: "Abrir Meu Plano",
        view: "plan",
      },
    ],
    payload: {
      billingStatus: billing.status,
      billingModel: billing.billingModel,
      billingCycle: billing.cycle,
      blocked: billing.isBlocked,
      planName,
    },
    logStatus: "SUCCESS",
  };
}

async function executeRecentFailuresTool(
  request: BeeUpAuthRequest,
  dependencies: BeeUpRegisterDependencies,
): Promise<BeeUpToolExecutionResult> {
  const failures = await prisma.job.findMany({
    where: {
      createdByUserId: ownedByUserId(request, dependencies),
      status: "FAILED",
    },
    orderBy: {
      criadoEm: "desc",
    },
    take: 5,
    select: {
      id: true,
      title: true,
      publicationType: true,
      lastError: true,
      dataPostagem: true,
    },
  });

  if (failures.length === 0) {
    return {
      name: "get_recent_failures",
      summary: "Não encontrei falhas recentes nas suas postagens.",
      actions: [
        {
          type: "OPEN_VIEW",
          label: "Abrir Histórico",
          view: "history",
        },
      ],
      logStatus: "SUCCESS",
    };
  }

  return {
    name: "get_recent_failures",
    summary: `Encontrei ${failures.length} falha(s) recente(s) no histórico.`,
    details: failures.map(
      (job) =>
        `${job.title || "Postagem sem título"} · ${job.publicationType} · ${formatToolDate(job.dataPostagem)} · ${truncateText(job.lastError || "Falha sem detalhe salvo.", 120)}`,
    ),
    actions: [
      {
        type: "OPEN_VIEW",
        label: "Ver Histórico",
        view: "history",
      },
    ],
    payload: {
      jobs: failures.map((job) => ({
        id: job.id,
        title: job.title,
        status: "FAILED",
      })),
    },
    logStatus: "SUCCESS",
  };
}

async function executeConnectionStatusTool(
  request: BeeUpAuthRequest,
  dependencies: BeeUpRegisterDependencies,
): Promise<BeeUpToolExecutionResult> {
  const connections = await prisma.socialConnection.findMany({
    where: {
      createdByUserId: ownedByUserId(request, dependencies),
    },
    orderBy: [{ platform: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      platform: true,
      displayName: true,
      authStatus: true,
      updatedAt: true,
    },
    take: 20,
  });

  const labelForPlatform = (platform: string): string => {
    switch ((platform || "").trim().toLowerCase()) {
      case "instagram":
        return "Instagram";
      case "facebook":
        return "Facebook";
      case "threads":
        return "Threads";
      case "tiktok":
        return "TikTok";
      case "x":
        return "X";
      case "whatsapp":
        return "WhatsApp";
      default:
        return platform || "Conta";
    }
  };

  const labelForAuthStatus = (status: string): string => {
    switch ((status || "").trim().toUpperCase()) {
      case "CONNECTED":
        return "Conectada";
      case "AUTH_REQUIRED":
        return "Não conectada";
      case "AUTH_IN_PROGRESS":
        // Estado transitório; Bee Up nao deve expor como status final.
        return "Autenticando";
      default:
        return "Não conectada";
    }
  };

  // Bee Up nao lista AUTH_IN_PROGRESS (ruido/transitorio).
  const stableConnections = connections.filter((connection) => connection.authStatus !== "AUTH_IN_PROGRESS");
  // Para este atalho, listamos somente contas realmente conectadas (o painel ja mostra o resto).
  const connectedConnections = stableConnections.filter((connection) => connection.authStatus === "CONNECTED");

  if (connections.length === 0) {
    return {
      name: "get_connection_status",
      summary: "Você ainda não tem contas sociais conectadas no painel.",
      actions: [
        {
          type: "OPEN_VIEW",
          label: "Abrir Conectar contas",
          view: "agents",
        },
      ],
      logStatus: "SUCCESS",
    };
  }

  const connectedCount = connectedConnections.length;

  if (connectedCount === 0) {
    return {
      name: "get_connection_status",
      summary: "Você ainda não tem contas conectadas.",
      actions: [
        {
          type: "OPEN_VIEW",
          label: "Abrir Conectar contas",
          view: "agents",
        },
      ],
      payload: {
        total: 0,
        connectedCount: 0,
        waitingCount: 0,
      },
      logStatus: "SUCCESS",
    };
  }

  return {
    name: "get_connection_status",
    summary: `Você tem ${connectedCount} conta(s) conectada(s).`,
    details: connectedConnections.slice(0, 6).map(
      (connection) =>
        `${labelForPlatform(connection.platform)} · ${connection.displayName} · ${labelForAuthStatus(connection.authStatus)} · ${formatToolDate(connection.updatedAt)}`,
    ),
    actions: [
      {
        type: "OPEN_VIEW",
        label: "Abrir Conectar contas",
        view: "agents",
      },
    ],
    payload: {
      total: connectedConnections.length,
      connectedCount,
      waitingCount: 0,
    },
    logStatus: "SUCCESS",
  };
}

function pickBestConnectionMatch(message: string, connections: Awaited<ReturnType<typeof resolveVisibleWhatsappConnections>>) {
  const normalizedMessage = normalizeText(message);
  const scored = connections
    .map((connection) => {
      const score = lexicalSimilarity(normalizedMessage, `${connection.displayName} ${connection.loginIdentifier || ""}`);
      return { connection, score };
    })
    .sort((left, right) => right.score - left.score);

  if (scored[0] && scored[0].score > 0.22) {
    return scored[0].connection;
  }

  return connections[0] ?? null;
}

function buildWhatsappWorkspaceChoices(input: {
  connections: Awaited<ReturnType<typeof resolveVisibleWhatsappConnections>>;
  eligibleWorkspaces: Awaited<ReturnType<typeof resolveWhatsappEligibleWorkspaces>>;
}) {
  const choices = [
    ...input.connections
      .filter((connection) => connection.authStatus !== "CONNECTED")
      .map((connection) => ({
        id: connection.companyId,
        name: connection.company?.name || connection.displayName || "Workspace",
        connectionId: connection.id,
      })),
    ...input.eligibleWorkspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      connectionId: null,
    })),
  ];

  const seenWorkspaceIds = new Set<string>();
  return choices.filter((choice) => {
    if (seenWorkspaceIds.has(choice.id)) {
      return false;
    }
    seenWorkspaceIds.add(choice.id);
    return true;
  });
}

function readWhatsappMetadata(value: Prisma.JsonValue | null | undefined): {
  whatsappOwnerJid: string | null;
  whatsappProfileName: string | null;
} {
  const metadata = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return {
    whatsappOwnerJid: typeof metadata.whatsappOwnerJid === "string" ? metadata.whatsappOwnerJid : null,
    whatsappProfileName: typeof metadata.whatsappProfileName === "string" ? metadata.whatsappProfileName : null,
  };
}

async function ensureBeeUpWhatsappMetadata(connection: {
  id: string;
  companyId: string;
  displayName: string;
  authStatus: string;
  loginIdentifier: string | null;
  secretCipher?: string | null;
  providerMetadata?: Prisma.JsonValue | null;
}) {
  const storedMetadata = readWhatsappMetadata(connection.providerMetadata);
  if (connection.authStatus !== "CONNECTED" || storedMetadata.whatsappOwnerJid || storedMetadata.whatsappProfileName) {
    return storedMetadata;
  }

  try {
    const metadata = await resolveWhatsappConnectionRuntimeMetadata({
      id: connection.id,
      companyId: connection.companyId,
      displayName: connection.displayName,
      platform: "whatsapp",
      loginIdentifier: connection.loginIdentifier,
      secretCipher: connection.secretCipher ?? null,
    });
    const nextMetadata = {
      whatsappOwnerJid: metadata.ownerJid,
      whatsappProfileName: metadata.profileName,
    };
    if (nextMetadata.whatsappOwnerJid || nextMetadata.whatsappProfileName) {
      await prisma.socialConnection.update({
        where: { id: connection.id },
        data: {
          providerMetadata: nextMetadata,
        },
      });
    }
    return nextMetadata;
  } catch {
    return storedMetadata;
  }
}

function normalizeOverlayDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

function resolveReusableWhatsappQrOverlay(overlay: Partial<Record<string, unknown>>, nowMs = Date.now()) {
  const qrStatus = typeof overlay.qrStatus === "string" ? overlay.qrStatus : null;
  if (qrStatus !== "WAITING_QR_SCAN" && qrStatus !== "PREPARING") {
    return null;
  }

  const qrImageDataUrl = typeof overlay.qrImageDataUrl === "string" ? overlay.qrImageDataUrl : null;
  const qrMessage = typeof overlay.qrMessage === "string" ? overlay.qrMessage : null;
  const qrGeneratedAtDate = normalizeOverlayDate(overlay.qrGeneratedAt);
  const workerLastSeenAtDate = normalizeOverlayDate(overlay.workerLastSeenAt);
  const referenceDate = qrGeneratedAtDate ?? workerLastSeenAtDate;
  if (!referenceDate) {
    return null;
  }

  if (nowMs - referenceDate.getTime() > BEE_UP_QR_REUSE_WINDOW_MS) {
    return null;
  }

  return {
    qrImageDataUrl,
    qrStatus,
    qrMessage,
    qrGeneratedAt: qrGeneratedAtDate?.toISOString() ?? null,
  };
}

async function resolveVisibleWhatsappConnectionById(
  connectionId: string,
  request: BeeUpAuthRequest,
  dependencies: BeeUpRegisterDependencies,
) {
  const userId = request.adminUser?.id;
  if (!dependencies.isRootUser(request) && !userId) {
    return null;
  }

  const where: Prisma.SocialConnectionWhereInput = {
    id: connectionId,
    platform: "whatsapp",
  };

  if (!dependencies.isRootUser(request)) {
    where.OR = [
      { createdByUserId: userId },
      { company: { createdByUserId: userId } },
      { company: { members: { some: { userId } } } },
    ];
  }

  const connection = await prisma.socialConnection.findFirst({
    where,
    select: {
      id: true,
      companyId: true,
      displayName: true,
      authStatus: true,
      loginIdentifier: true,
      secretCipher: true,
      providerMetadata: true,
      lastAuthAt: true,
      lastSeenAt: true,
      company: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!connection) {
    return null;
  }

  const overlay = dependencies.getWhatsappConnectionOverlay?.(connection.id) ?? {};
  const overlayStatus = typeof overlay.qrStatus === "string" ? overlay.qrStatus : null;
  const overlayOwnerJid = typeof overlay.whatsappOwnerJid === "string" ? overlay.whatsappOwnerJid : null;
  const overlayProfileName = typeof overlay.whatsappProfileName === "string" ? overlay.whatsappProfileName : null;
  const storedMetadata = readWhatsappMetadata(connection.providerMetadata);

  if (overlayStatus === "CONNECTED" && connection.authStatus !== "CONNECTED") {
    return prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        authStatus: "CONNECTED",
        authLaunchUrl: null,
        lastAuthAt: connection.lastAuthAt ?? new Date(),
        lastSeenAt: new Date(),
        providerMetadata: {
          whatsappOwnerJid: overlayOwnerJid ?? storedMetadata.whatsappOwnerJid,
          whatsappProfileName: overlayProfileName ?? storedMetadata.whatsappProfileName,
        },
      },
      select: {
        id: true,
        companyId: true,
        displayName: true,
        authStatus: true,
        loginIdentifier: true,
        secretCipher: true,
        providerMetadata: true,
        lastAuthAt: true,
        lastSeenAt: true,
        company: {
          select: {
            name: true,
          },
        },
      },
    });
  }

  return connection;
}

async function executeGenerateWhatsappQrTool(
  request: BeeUpAuthRequest,
  message: string,
  dependencies: BeeUpRegisterDependencies,
  params?: { workspaceId?: string },
): Promise<BeeUpToolExecutionResult> {
  let connections = await resolveVisibleWhatsappConnections(request, dependencies);
  const eligibleWorkspaces = await resolveWhatsappEligibleWorkspaces(request, dependencies);
  const workspaceChoices = buildWhatsappWorkspaceChoices({ connections, eligibleWorkspaces });

  if (!params?.workspaceId && workspaceChoices.length > 1) {
    return {
      name: "generate_whatsapp_qr",
      summary: "Encontrei mais de um workspace disponível. Escolha em qual workspace você quer gerar o QR do WhatsApp.",
      payload: {
        workspaceChoices: workspaceChoices.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
        })),
      },
      logStatus: "SKIPPED",
    };
  }

  const selectedWorkspaceId = params?.workspaceId || workspaceChoices[0]?.id || null;
  if (selectedWorkspaceId) {
    const selectedExistingConnection = connections.find(
      (connection) => connection.companyId === selectedWorkspaceId && connection.authStatus !== "CONNECTED",
    );
    const selectedNewWorkspace = eligibleWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId);

    if (!selectedExistingConnection && selectedNewWorkspace) {
      const createdConnection = await createWhatsappConnectionForWorkspace(selectedNewWorkspace.id, request.adminUser?.id);
      connections = [
        {
          id: createdConnection.id,
          companyId: createdConnection.companyId,
          displayName: createdConnection.displayName,
          authStatus: createdConnection.authStatus,
          loginIdentifier: createdConnection.loginIdentifier,
          createdByUserId: createdConnection.createdByUserId,
          company: {
            name: selectedNewWorkspace.name,
          },
        },
      ];
    } else if (selectedExistingConnection) {
      connections = [selectedExistingConnection];
    } else if (params?.workspaceId) {
      return {
        name: "generate_whatsapp_qr",
        summary: "Não consegui usar esse workspace para gerar o QR do WhatsApp.",
        details: ["Talvez ele já tenha uma conta WhatsApp conectada, esteja inativo ou você não tenha permissão para conectar contas nele."],
        actions: [
          {
            type: "OPEN_VIEW",
            label: "Abrir Conectar contas",
            view: "agents",
          },
        ],
        logStatus: "FAILED",
        errorMessage: "Workspace inválido para WhatsApp.",
      };
    }
  }

  if (connections.length === 0) {
    const selectedWorkspace = eligibleWorkspaces.length === 1 ? eligibleWorkspaces[0] : null;
    const createdConnection = selectedWorkspace
      ? await createWhatsappConnectionForWorkspace(selectedWorkspace.id, request.adminUser?.id)
      : null;
    if (!createdConnection) {
      return {
        name: "generate_whatsapp_qr",
        summary: "Não encontrei um workspace disponível para criar a conta de WhatsApp e gerar o QR.",
        details: ["Crie um workspace primeiro ou verifique se você tem permissão para conectar contas nele."],
        actions: [
          {
            type: "OPEN_VIEW",
            label: "Abrir Workspaces",
            view: "companies",
          },
        ],
        logStatus: "FAILED",
        errorMessage: "Nenhum workspace elegível para criar WhatsApp.",
      };
    }

    connections = [
      {
        id: createdConnection.id,
        companyId: createdConnection.companyId,
        displayName: createdConnection.displayName,
        authStatus: createdConnection.authStatus,
        loginIdentifier: createdConnection.loginIdentifier,
        createdByUserId: createdConnection.createdByUserId,
        company: {
          name: selectedWorkspace?.name ?? "Workspace",
        },
      },
    ];
  }

  const qrEligibleConnections = connections.filter((connection) => connection.authStatus !== "CONNECTED");
  if (qrEligibleConnections.length === 0) {
    return {
      name: "generate_whatsapp_qr",
      summary: "Suas contas de WhatsApp já aparecem como conectadas. Para trocar de aparelho, desconecte a conta primeiro e depois gere outro QR.",
      actions: [
        {
          type: "OPEN_VIEW",
          label: "Abrir Conectar contas",
          view: "agents",
        },
      ],
      payload: {
        total: connections.length,
      },
      logStatus: "SKIPPED",
    };
  }

  const connection = pickBestConnectionMatch(message, qrEligibleConnections);
  if (!connection) {
    return {
      name: "generate_whatsapp_qr",
      summary: "Não consegui identificar qual conta de WhatsApp deve receber o novo QR.",
      actions: [
        {
          type: "OPEN_VIEW",
          label: "Abrir Conectar contas",
          view: "agents",
        },
      ],
      logStatus: "FAILED",
      errorMessage: "Conta de WhatsApp ambígua.",
    };
  }

  const reusableOverlay = resolveReusableWhatsappQrOverlay(dependencies.getWhatsappConnectionOverlay?.(connection.id) ?? {});
  if (reusableOverlay) {
    return {
      name: "generate_whatsapp_qr",
      summary: "Já gerei um QR Code para esse workspace há pouco tempo. Use o QR que está logo acima no chat.",
      details: ["Para evitar limite da Evolution, o Bee Up não gera outro QR enquanto o anterior ainda está dentro da janela de uso."],
      actions: [
        {
          type: "OPEN_VIEW",
          label: "Abrir Conectar contas",
          view: "agents",
        },
      ],
      payload: {
        connectionId: connection.id,
        connectionName: connection.displayName,
        workspaceName: connection.company?.name ?? null,
        qrImageDataUrl: reusableOverlay.qrImageDataUrl,
        qrStatus: reusableOverlay.qrStatus,
        qrMessage: reusableOverlay.qrMessage,
        qrGeneratedAt: reusableOverlay.qrGeneratedAt,
      },
      logStatus: "SKIPPED",
    };
  }

  const updatedConnection = await prisma.socialConnection.update({
    where: { id: connection.id },
    data: {
      authStatus: "AUTH_IN_PROGRESS",
      lastSeenAt: new Date(),
    },
  });

  try {
    await dependencies.requestWhatsappQr(updatedConnection.id, false);
  } catch (error) {
    const rawMessage = error instanceof Error && error.message ? error.message : "Falha ao gerar um novo QR do WhatsApp.";
    const humanMessage = humanizeBeeUpWhatsappQrErrorMessage(rawMessage);

    await dependencies.appendLog({
      companyId: updatedConnection.companyId,
      level: "ERROR",
      errorCode: "BEE_UP_QR_REQUEST_FAILED",
      message: humanMessage,
    });

    await prisma.socialConnection.update({
      where: { id: updatedConnection.id },
      data: {
        authStatus: "AUTH_REQUIRED",
        lastSeenAt: null,
        authLaunchUrl: null,
      },
    });

    return {
      name: "generate_whatsapp_qr",
      summary: "Nao consegui gerar o QR do WhatsApp agora.",
      details: [humanMessage],
      actions: [
        {
          type: "OPEN_VIEW",
          label: "Abrir Conectar contas",
          view: "agents",
        },
      ],
      payload: {
        connectionId: updatedConnection.id,
        connectionName: updatedConnection.displayName,
        workspaceName: connection.company?.name ?? null,
        qrStatus: "ERROR",
        qrMessage: humanMessage,
      },
      logStatus: "FAILED",
      errorMessage: humanMessage,
    };
  }

  const overlay = dependencies.getWhatsappConnectionOverlay?.(updatedConnection.id) ?? {};
  const qrImageDataUrl = typeof overlay.qrImageDataUrl === "string" ? overlay.qrImageDataUrl : null;
  const qrStatus = typeof overlay.qrStatus === "string" ? overlay.qrStatus : null;
  const qrMessage = typeof overlay.qrMessage === "string" ? overlay.qrMessage : null;
  const qrGeneratedAt =
    overlay.qrGeneratedAt instanceof Date
      ? overlay.qrGeneratedAt.toISOString()
      : typeof overlay.qrGeneratedAt === "string"
        ? overlay.qrGeneratedAt
        : null;

  await dependencies.appendLog({
    companyId: updatedConnection.companyId,
    level: "INFO",
    message: `Assistente Bee Up solicitou um novo QR para a conta ${updatedConnection.displayName}.`,
  });

  return {
    name: "generate_whatsapp_qr",
    summary: qrImageDataUrl
      ? `Gerei o QR do WhatsApp para a conta ${updatedConnection.displayName}. Escaneie pelo celular.`
      : `Solicitei um novo QR para a conta ${updatedConnection.displayName}.`,
    details: [
      qrImageDataUrl
        ? "O QR está disponível aqui no chat e também na tela Conectar contas."
        : "Abra a tela Conectar contas para acompanhar a imagem do QR em tempo real.",
      "Se o QR expirar, você pode pedir outro pelo próprio Bee Up.",
    ],
    actions: [
      {
        type: "OPEN_VIEW",
        label: "Abrir Conectar contas",
        view: "agents",
      },
      {
        type: "REFRESH_BEE_UP",
        label: "Atualizar Bee Up",
      },
    ],
    payload: {
      connectionId: updatedConnection.id,
      connectionName: updatedConnection.displayName,
      workspaceName: connection.company?.name ?? null,
      qrImageDataUrl,
      qrStatus,
      qrMessage,
      qrGeneratedAt,
    },
    logStatus: "SUCCESS",
  };
}

function humanizeBeeUpWhatsappQrErrorMessage(message: string): string {
  const normalized = message.trim();
  if (!normalized) {
    return "Falha ao iniciar a geracao do QR do WhatsApp.";
  }

  if (normalized.includes("WHATSAPP_EVOLUTION_API_KEY_MISSING")) {
    return "A integracao do WhatsApp nao esta configurada no backend. Revise a chave da Evolution API.";
  }

  if (normalized.includes("WHATSAPP_EVOLUTION_API_HTTP_401:")) {
    return "A Evolution API recusou a autenticacao. Revise a chave configurada no backend e na Evolution.";
  }

  if (normalized.includes("WHATSAPP_EVOLUTION_API_HTTP_403:")) {
    return "A Evolution API bloqueou esta operacao. Revise as permissoes e a configuracao da instancia.";
  }

  if (normalized.includes("WHATSAPP_EVOLUTION_API_HTTP_404:")) {
    return "A instancia do WhatsApp nao foi encontrada na Evolution. Tente gerar o QR novamente.";
  }

  if (normalized.includes("WHATSAPP_EVOLUTION_API_HTTP_409:")) {
    return "A instancia do WhatsApp esta em conflito de sessao. Tente gerar um novo QR.";
  }

  if (normalized.includes("LOGIN_REQUIRED_WHATSAPP")) {
    return "A conta do WhatsApp precisa ser autenticada para continuar.";
  }

  if (normalized.includes("WHATSAPP_INSTANCE_STARTING")) {
    return "A instancia do WhatsApp esta iniciando. Aguarde alguns segundos e tente novamente.";
  }

  if (normalized.includes("WHATSAPP_INSTANCE_LOGOUT_PENDING")) {
    return "A sessao anterior do WhatsApp ainda nao foi encerrada na Evolution. Aguarde alguns segundos e tente gerar um novo QR.";
  }

  if (normalized.includes("WHATSAPP_INSTANCE_DELETE_PENDING")) {
    return "A Evolution ainda esta removendo a sessao anterior do WhatsApp. Aguarde alguns segundos e tente novamente.";
  }

  if (normalized.includes("WHATSAPP_INSTANCE_REUSE_BLOCKED")) {
    return "A Evolution ainda esta reaproveitando a sessao anterior do WhatsApp. O novo QR so sera liberado quando essa sessao for encerrada.";
  }

  return normalized;
}

async function executeRescheduleJobTool(
  request: BeeUpAuthRequest,
  message: string,
  dependencies: BeeUpRegisterDependencies,
): Promise<BeeUpToolExecutionResult> {
  const minutes = parseDelayMinutesFromMessage(message);
  const job = await prisma.job.findFirst({
    where: {
      createdByUserId: ownedByUserId(request, dependencies),
      publicationState: "PUBLISHED",
      status: {
        in: ["FAILED", "WAITING_LOGIN", "CANCELED"],
      },
    },
    orderBy: {
      criadoEm: "desc",
    },
    select: {
      id: true,
      title: true,
      companyId: true,
      status: true,
      publicationType: true,
      dataPostagem: true,
    },
  });

  if (!job) {
    return {
      name: "reschedule_job",
      summary: "Não encontrei uma postagem com falha ou aguardando login para reagendar agora.",
      actions: [
        {
          type: "OPEN_VIEW",
          label: "Abrir Histórico",
          view: "history",
        },
      ],
      logStatus: "FAILED",
      errorMessage: "Nenhum job elegível para reagendamento.",
    };
  }

  const retryAt = new Date(Date.now() + minutes * 60_000);
  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: "PENDING",
      tentativas: 0,
      startedAt: null,
      completedAt: null,
      lastError: null,
      dataPostagem: retryAt,
    },
  });

  await dependencies.appendLog({
    companyId: job.companyId,
    level: "INFO",
    message: `Assistente Bee Up reagendou o job ${job.id} para ${retryAt.toISOString()}.`,
  });

  return {
    name: "reschedule_job",
    summary: `Reagendei ${job.title || "a postagem"} para ${formatToolDate(retryAt)}.`,
    details: [
      `Status anterior: ${job.status}`,
      `Tipo: ${job.publicationType}`,
    ],
    actions: [
      {
        type: "OPEN_VIEW",
        label: "Abrir Histórico",
        view: "history",
      },
    ],
    payload: {
      jobId: job.id,
      retryAt: retryAt.toISOString(),
      minutes,
    },
    logStatus: "SUCCESS",
  };
}

async function executeOpenSupportIncidentTool(
  request: BeeUpAuthRequest,
  message: string,
  dependencies: BeeUpRegisterDependencies,
): Promise<BeeUpToolExecutionResult> {
  const reporter = request.adminUser;
  const reporterLabel = reporter
    ? `${reporter.name || reporter.username} (@${reporter.username})`
    : "Usuário autenticado";
  const incident = await prisma.aiIncident.create({
    data: {
      userId: reporter?.id ?? null,
      createdByUserId: reporter?.id ?? null,
      severity: "MEDIUM",
      status: "OPEN",
      source: "BEE_UP",
      title: "Solicitação de suporte pelo Bee Up",
      summary: truncateText(message, 500),
      fingerprint: createContentHash(normalizeText(message)),
      events: {
        create: {
          type: "USER_REQUEST",
          message: truncateText(message, 1_000),
          payload: {
            username: reporter?.username ?? null,
          } satisfies Prisma.InputJsonValue,
        },
      },
    },
  });

  const rootUser = await prisma.user.findUnique({
    where: { username: "root" },
    select: { id: true },
  });

  if (rootUser) {
    const alertTitle = `Bee Up: ${reporterLabel} relatou um problema`;
    const alertMessage = truncateText(`Relato: ${message}`, 900);

    await prisma.aiUserAlert.create({
      data: {
        userId: rootUser.id,
        kind: "BEE_UP_INCIDENT",
        title: alertTitle,
        message: alertMessage,
        payload: {
          incidentId: incident.id,
          reporterUserId: reporter?.id ?? null,
          reporterUsername: reporter?.username ?? null,
        } satisfies Prisma.InputJsonValue,
      },
    });

    if (dependencies.appendAviso) {
      await dependencies.appendAviso({
        userId: rootUser.id,
        kind: "BEE_UP_INCIDENT",
        title: alertTitle,
        message: alertMessage,
        createdByUserId: reporter?.id ?? null,
      });
    } else {
      await prisma.aviso.create({
        data: {
          userId: rootUser.id,
          kind: "BEE_UP_INCIDENT",
          title: alertTitle,
          message: alertMessage,
          createdByUserId: reporter?.id ?? null,
        },
      });
    }
  }

  return {
    name: "open_support_incident",
    summary: "A equipe técnica já foi acionada para acompanhar isso.",
    details: [`ID do incidente: ${incident.id}`],
    logStatus: "SUCCESS",
    payload: {
      incidentId: incident.id,
      notifiedRoot: Boolean(rootUser),
    },
  };
}

async function executeOpenViewTool(message: string): Promise<BeeUpToolExecutionResult> {
  const view = inferViewFromMessage(message);
  if (!view) {
    return {
      name: "open_view",
      summary: "Posso te levar direto para a tela certa assim que você indicar o assunto principal.",
      details: ["Exemplos: conectar contas, histórico, agendar, meu plano."],
      logStatus: "SKIPPED",
    };
  }

  return {
    name: "open_view",
    summary: "Separei um atalho para a tela mais provável do seu pedido.",
    actions: [
      {
        type: "OPEN_VIEW",
        label: actionLabelForView(view),
        view,
      },
    ],
    payload: {
      view,
    },
    logStatus: "SUCCESS",
  };
}

async function executeOpenViewByNameTool(view: BeeUpOpenView): Promise<BeeUpToolExecutionResult> {
  return {
    name: "open_view",
    summary: "Separei um atalho para a tela solicitada.",
    actions: [
      {
        type: "OPEN_VIEW",
        label: actionLabelForView(view),
        view,
      },
    ],
    payload: {
      view,
    },
    logStatus: "SUCCESS",
  };
}

async function executeToolByIntent(input: {
  intent: BeeUpToolExecutionResult["name"];
  request: BeeUpAuthRequest;
  message: string;
  dependencies: BeeUpRegisterDependencies;
  params?: { workspaceId?: string };
}): Promise<BeeUpToolExecutionResult> {
  switch (input.intent) {
    case "get_plan_limits":
      return executePlanLimitsTool(input.request, input.dependencies);
    case "get_recent_failures":
      return executeRecentFailuresTool(input.request, input.dependencies);
    case "get_connection_status":
      return executeConnectionStatusTool(input.request, input.dependencies);
    case "generate_whatsapp_qr":
      return executeGenerateWhatsappQrTool(input.request, input.message, input.dependencies, input.params);
    case "reschedule_job":
      return executeRescheduleJobTool(input.request, input.message, input.dependencies);
    case "open_support_incident":
      return executeOpenSupportIncidentTool(input.request, input.message, input.dependencies);
    case "open_view":
      return executeOpenViewTool(input.message);
    default:
      return {
        name: input.intent,
        summary: "Ainda não sei executar essa ação no Bee Up.",
        logStatus: "SKIPPED",
      };
  }
}

function buildFallbackHelpReply(message: string, currentView?: string | null): string {
  const viewHint = currentView ? `Você está na tela ${currentView}. ` : "";
  return `${viewHint}Eu consigo te ajudar com limites do plano, falhas recentes, status das contas, geração de QR do WhatsApp, reagendamento e navegação do painel. Se quiser, pode me pedir algo como "veja minhas falhas recentes" ou "gere um novo QR do WhatsApp".`;
}

function buildBeeUpToolFallbackReply(toolResult: BeeUpToolExecutionResult, _sources: BeeUpSource[]): string {
  const paragraphs = [toolResult.summary];
  if (toolResult.details?.length) {
    paragraphs.push(toolResult.details.map((detail) => `- ${detail}`).join("\n"));
  }
  return paragraphs.join("\n\n");
}

async function executeToolByGeminiFunctionCall(input: {
  functionCall: BeeUpGeminiFunctionCall;
  request: BeeUpAuthRequest;
  originalMessage: string;
  dependencies: BeeUpRegisterDependencies;
}): Promise<BeeUpToolExecutionResult> {
  const { functionCall, request, originalMessage, dependencies } = input;

  switch (functionCall.name) {
    case "get_plan_limits":
      return executePlanLimitsTool(request, dependencies);
    case "get_recent_failures":
      return executeRecentFailuresTool(request, dependencies);
    case "get_connection_status":
      return executeConnectionStatusTool(request, dependencies);
    case "generate_whatsapp_qr": {
      const connectionName = parseOptionalString(functionCall.args.connectionName);
      return executeGenerateWhatsappQrTool(
        request,
        connectionName ? `whatsapp ${connectionName}` : originalMessage,
        dependencies,
      );
    }
    case "reschedule_job": {
      const delayMinutes = parseOptionalNumber(functionCall.args.delayMinutes);
      const normalizedDelay =
        delayMinutes && delayMinutes > 0
          ? Math.min(delayMinutes, BEE_UP_MAX_RESCHEDULE_MINUTES)
          : BEE_UP_DEFAULT_RESCHEDULE_MINUTES;
      return executeRescheduleJobTool(request, `${normalizedDelay} minutos`, dependencies);
    }
    case "open_support_incident": {
      const summary = parseOptionalString(functionCall.args.summary) || originalMessage;
      return executeOpenSupportIncidentTool(request, summary, dependencies);
    }
    case "open_view": {
      const requestedView = parseOptionalString(functionCall.args.view);
      const allowedViews: BeeUpOpenView[] = ["dashboard", "companies", "agents", "scheduler", "history", "profile", "plan"];
      if (requestedView && allowedViews.includes(requestedView as BeeUpOpenView)) {
        return executeOpenViewByNameTool(normalizeOpenViewByMessage(requestedView as BeeUpOpenView, originalMessage));
      }
      return executeOpenViewTool(originalMessage);
    }
    default:
      return {
        name: functionCall.name,
        summary: "Ainda não sei executar essa ação pelo Bee Up.",
        logStatus: "SKIPPED",
      };
  }
}

async function generateBeeUpReplyWithGemini(input: {
  request: BeeUpAuthRequest;
  message: string;
  currentView?: string | null;
  recentConversation: BeeUpConversationMessage[];
  sources: BeeUpSource[];
  dependencies: BeeUpRegisterDependencies;
}): Promise<BeeUpGeminiReply | null> {
  if (!hasBeeUpGeminiEnabled()) {
    return null;
  }

  const isFirstTurn = input.recentConversation.length === 0;

  const baseContents: BeeUpGeminiContent[] = [
    ...mapConversationToGeminiContents(input.recentConversation),
    {
      role: "user",
      parts: [
        {
          text: buildBeeUpGeminiPrompt({
            message: input.message,
            currentView: input.currentView,
            sources: input.sources,
            isFirstTurn,
          }),
        },
      ],
    },
  ];

  const systemInstruction = {
    parts: [{ text: buildBeeUpGeminiSystemInstruction(input.request, isFirstTurn) }],
  };

  const firstResponse = await callBeeUpGeminiApi({
    systemInstruction,
    contents: baseContents,
    tools: [
      {
        functionDeclarations: buildBeeUpGeminiToolDeclarations(),
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        mode: "AUTO",
      },
    },
    generationConfig: {
      temperature: 0.25,
      topP: 0.9,
      maxOutputTokens: 900,
    },
  });

  const functionCall = extractBeeUpGeminiFunctionCall(firstResponse);
  if (!functionCall) {
    const directReply = extractBeeUpGeminiText(firstResponse);
    if (!directReply) {
      return null;
    }
    return {
      content: directReply,
      toolResult: null,
      toolName: null,
      mode: "GEMINI_RAG",
    };
  }

  const toolResult = await executeToolByGeminiFunctionCall({
    functionCall,
    request: input.request,
    originalMessage: input.message,
    dependencies: input.dependencies,
  });

  const firstCandidateContent = firstResponse.candidates?.[0]?.content;
  const followUpContents: BeeUpGeminiContent[] = [...baseContents];
  if (firstCandidateContent) {
    followUpContents.push({
      role: firstCandidateContent.role || "model",
      parts: (firstCandidateContent.parts || []) as BeeUpGeminiContentPart[],
    });
  }
  followUpContents.push({
    role: "user",
    parts: [
      {
        functionResponse: {
          name: functionCall.name,
          response: {
            summary: toolResult.summary,
            details: toolResult.details ?? [],
            payload: toolResult.payload ?? null,
            logStatus: toolResult.logStatus,
            errorMessage: toolResult.errorMessage ?? null,
          },
        },
      },
    ],
  });

  const secondResponse = await callBeeUpGeminiApi({
    systemInstruction,
    contents: followUpContents,
    generationConfig: {
      temperature: 0.25,
      topP: 0.9,
      maxOutputTokens: 900,
    },
  }).catch(() => null);

  const finalReply = secondResponse ? extractBeeUpGeminiText(secondResponse) : "";
  if (!finalReply) {
    return {
      content: buildBeeUpToolFallbackReply(toolResult, input.sources),
      toolResult,
      toolName: functionCall.name,
      mode: "GEMINI_RAG",
    };
  }

  return {
    content: finalReply,
    toolResult,
    toolName: functionCall.name,
    mode: "GEMINI_RAG",
  };
}

function buildChatReply(input: {
  message: string;
  currentView?: string | null;
  sources: BeeUpSource[];
  toolResult: BeeUpToolExecutionResult | null;
  userFirstName?: string | null;
  isFirstTurn?: boolean;
}): BeeUpChatReply {
  const actions = buildBeeUpActions(input.message, input.toolResult);
  const paragraphs: string[] = [];

  if (input.isFirstTurn) {
    paragraphs.push(input.userFirstName ? `Oi, ${input.userFirstName}! 😊` : "Oi! 😊");
  }

  if (input.toolResult) {
    paragraphs.push(input.toolResult.summary);
    if (input.toolResult.details && input.toolResult.details.length > 0) {
      paragraphs.push(input.toolResult.details.map((detail) => `- ${detail}`).join("\n"));
    }
  }

  if (!input.toolResult && input.sources.length > 0) {
    const sourceLead = "Encontrei isto na base Bee Up:";
    const sourceBody = input.sources
      .slice(0, 2)
      .map((source) => `- ${source.title}: ${source.content}`)
      .join("\n");
    paragraphs.push(`${sourceLead}\n${sourceBody}`);
  }

  if (paragraphs.length === 0) {
    paragraphs.push(buildFallbackHelpReply(input.message, input.currentView));
  }

  return {
    content: paragraphs.join("\n\n"),
    actions,
    sources: input.sources,
    mode: "LOCAL_RAG",
    toolName: input.toolResult?.name ?? null,
  };
}

async function buildBeeUpSummary(request: BeeUpAuthRequest, dependencies: BeeUpRegisterDependencies) {
  const userId = request.adminUser?.id;
  if (!userId) {
    return {
      alerts: [] as BeeUpSummaryAlert[],
      quickPrompts: [] as string[],
    };
  }

  const [billing, failedJobsCount, waitingJobsCount, authRequiredConnections, storedAlerts] = await Promise.all([
    dependencies.isRootUser(request)
      ? Promise.resolve({
          status: "ACTIVE",
          billingModel: "MANUAL",
          cycle: null,
          isBlocked: false,
          blockMessage: null,
          plan: {
            id: "root",
            code: "ROOT",
            name: "Root",
            isTrial: false,
            maxProfiles: 9999,
            maxConnections: 9999,
            maxMonthlyPublications: 999999,
          },
          usage: {
            profilesUsed: 0,
            connectionsUsed: 0,
            postsUsedThisMonth: 0,
          },
        } satisfies BeeUpBillingSnapshot)
      : dependencies.resolveUserBillingAccess(userId),
    prisma.job.count({
      where: {
        createdByUserId: ownedByUserId(request, dependencies),
        status: "FAILED",
      },
    }),
    prisma.job.count({
      where: {
        createdByUserId: ownedByUserId(request, dependencies),
        status: "WAITING_LOGIN",
      },
    }),
    prisma.socialConnection.count({
      where: {
        createdByUserId: ownedByUserId(request, dependencies),
        authStatus: {
          not: "CONNECTED",
        },
      },
    }),
    prisma.aiUserAlert.findMany({
      where: {
        userId,
        readAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 3,
    }),
  ]);

  const alerts: BeeUpSummaryAlert[] = storedAlerts.map((alert) => ({
    id: alert.id,
    kind: "info",
    title: alert.title,
    message: alert.message,
    actions: [{ type: "REFRESH_BEE_UP", label: "Atualizar Bee Up" }],
  }));

  if (billing.isBlocked) {
    alerts.unshift({
      id: "billing-blocked",
      kind: "warning",
      title: "Conta com acesso bloqueado",
      message: billing.blockMessage || "Seu plano precisa ser regularizado para liberar novas operações.",
      actions: [{ type: "OPEN_VIEW", label: "Abrir Meu plano", view: "plan" }],
    });
  }

  if (waitingJobsCount > 0) {
    alerts.push({
      id: "jobs-waiting-login",
      kind: "warning",
      title: "Postagens aguardando autenticação",
      message: `${waitingJobsCount} postagem(ns) estão aguardando login de uma conta conectada.`,
      actions: [{ type: "OPEN_VIEW", label: "Abrir Histórico", view: "history" }],
    });
  }

  if (failedJobsCount > 0) {
    alerts.push({
      id: "jobs-failed",
      kind: "warning",
      title: "Falhas recentes encontradas",
      message: `${failedJobsCount} postagem(ns) tiveram falha recentemente. Posso te ajudar a entender ou reagendar.`,
      actions: [{ type: "OPEN_VIEW", label: "Abrir Histórico", view: "history" }],
    });
  }

  if (authRequiredConnections > 0) {
    alerts.push({
      id: "connections-attention",
      kind: "info",
      title: "Contas sociais precisam de atenção",
      message: `${authRequiredConnections} conta(s) ainda não estão conectadas ou estão pedindo autenticação.`,
      actions: [{ type: "OPEN_VIEW", label: "Abrir Conectar contas", view: "agents" }],
    });
  }

  return {
    alerts: alerts.slice(0, 5),
    quickPrompts: [
      "Qual é o limite do meu plano?",
      "Veja minhas falhas recentes",
      "Cheque minhas contas conectadas",
      "Gerar novo QR do WhatsApp",
    ],
  };
}

function mapThreadSummary(thread: {
  id: string;
  title: string | null;
  lastMessageAt: Date | null;
  updatedAt: Date;
  _count?: { messages: number };
  messages?: Array<{ role: string; content: string; createdAt: Date }>;
}) {
  const latestMessage = thread.messages?.[0] ?? null;
  return {
    id: thread.id,
    title: thread.title || "Nova conversa",
    lastMessageAt: thread.lastMessageAt ?? latestMessage?.createdAt ?? thread.updatedAt,
    preview: latestMessage ? truncateText(latestMessage.content, 100) : "",
    messageCount: thread._count?.messages ?? 0,
  };
}

function mapMessage(message: {
  id: string;
  role: string;
  content: string;
  toolName: string | null;
  toolPayload: Prisma.JsonValue | null;
  createdAt: Date;
}) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    toolName: message.toolName,
    toolPayload: message.toolPayload,
    createdAt: message.createdAt,
  };
}

async function persistBeeUpChatAuditLog(input: {
  request: BeeUpAuthRequest;
  threadId: string;
  userMessageId: string;
  assistantMessageId: string;
  userMessageContent: string;
  currentView?: string | null;
  reply: BeeUpChatReply;
  toolResult: BeeUpToolExecutionResult | null;
  sources: BeeUpSource[];
  geminiAttempted: boolean;
  geminiErrorMessage: string | null;
}): Promise<void> {
  const userId = input.request.adminUser?.id;
  if (!userId) {
    return;
  }

  const status =
    input.reply.mode === "GEMINI_RAG"
      ? "SUCCESS"
      : input.geminiAttempted
        ? "FALLBACK"
        : "LOCAL_ONLY";

  await prisma.aiActionLog.create({
    data: {
      userId,
      threadId: input.threadId,
      actionName: "bee_up_chat_reply",
      status,
      inputPayload: toJsonInputValue({
        currentView: input.currentView ?? null,
        userMessageId: input.userMessageId,
        assistantMessageId: input.assistantMessageId,
        geminiAttempted: input.geminiAttempted,
      }),
      outputPayload: toJsonInputValue({
        mode: input.reply.mode,
        toolName: input.reply.toolName ?? null,
        toolLogStatus: input.toolResult?.logStatus ?? null,
        actions: input.reply.actions,
        sourceCount: input.sources.length,
        sourceTitles: input.sources.map((source) => source.title),
        sourceCategories: input.sources.map((source) => source.category),
        userMessage: truncateText(input.userMessageContent, 2_000),
        assistantReply: truncateText(input.reply.content, 6_000),
      }),
      errorMessage: input.geminiErrorMessage,
    },
  });
}

export function registerBeeUpRoutes(app: Express, dependencies: BeeUpRegisterDependencies): void {
  const router = express.Router();

  router.get("/summary", async (request, response) => {
    const authRequest = request as BeeUpAuthRequest;
    response.json(await buildBeeUpSummary(authRequest, dependencies));
  });

  router.get("/threads", async (request, response) => {
    const authRequest = request as BeeUpAuthRequest;
    const threads = await prisma.aiAgentThread.findMany({
      where: {
        userId: authRequest.adminUser?.id,
      },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      include: {
        _count: {
          select: {
            messages: true,
          },
        },
        messages: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
          select: {
            role: true,
            content: true,
            createdAt: true,
          },
        },
      },
      take: 20,
    });

    response.json({
      items: threads.map(mapThreadSummary),
    });
  });

  router.get("/threads/:id/messages", async (request, response) => {
    const authRequest = request as BeeUpAuthRequest;
    const thread = await prisma.aiAgentThread.findFirst({
      where: {
        id: request.params.id,
        userId: authRequest.adminUser?.id,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!thread) {
      response.status(404).json({ error: "Conversa do Bee Up não encontrada." });
      return;
    }

    response.json({
      thread: mapThreadSummary(thread),
      items: thread.messages.map(mapMessage),
    });
  });

  router.get("/whatsapp-qr-status/:connectionId", async (request, response) => {
    const authRequest = request as BeeUpAuthRequest;
    const connection = await resolveVisibleWhatsappConnectionById(request.params.connectionId, authRequest, dependencies);

    if (!connection) {
      response.status(404).json({ error: "Conta de WhatsApp não encontrada." });
      return;
    }

    const overlay = dependencies.getWhatsappConnectionOverlay?.(connection.id) ?? {};
    const runtimeMetadata = await ensureBeeUpWhatsappMetadata(connection);
    const metadata = readWhatsappMetadata(connection.providerMetadata);
    const qrStatus = typeof overlay.qrStatus === "string" ? overlay.qrStatus : null;
    const qrMessage = typeof overlay.qrMessage === "string" ? overlay.qrMessage : null;
    const whatsappOwnerJid =
      typeof overlay.whatsappOwnerJid === "string" ? overlay.whatsappOwnerJid : runtimeMetadata.whatsappOwnerJid ?? metadata.whatsappOwnerJid;
    const whatsappProfileName =
      typeof overlay.whatsappProfileName === "string" ? overlay.whatsappProfileName : runtimeMetadata.whatsappProfileName ?? metadata.whatsappProfileName;

    response.json({
      connectionId: connection.id,
      connectionName: connection.displayName,
      workspaceName: connection.company?.name ?? null,
      authStatus: connection.authStatus,
      qrStatus,
      qrMessage,
      whatsappOwnerJid,
      whatsappProfileName,
      lastAuthAt: connection.lastAuthAt,
      lastSeenAt: connection.lastSeenAt,
    });
  });

  router.post("/chat", async (request, response) => {
    const authRequest = request as BeeUpAuthRequest;
    const payload = beeUpChatSchema.parse(request.body || {});

    let thread = payload.threadId
      ? await prisma.aiAgentThread.findFirst({
          where: {
            id: payload.threadId,
            userId: authRequest.adminUser?.id,
          },
        })
      : null;

    if (!thread) {
      thread = await prisma.aiAgentThread.create({
        data: {
          userId: authRequest.adminUser?.id ?? "",
          title: buildThreadTitle(payload.message),
          lastMessageAt: new Date(),
        },
      });
    }

    const userMessage = await prisma.aiAgentMessage.create({
      data: {
        threadId: thread.id,
        role: "user",
        content: payload.message,
      },
    });

    const sources = await searchKnowledgeSources(payload.message);
    const recentConversation = await prisma.aiAgentMessage.findMany({
      where: {
        threadId: thread.id,
        role: {
          in: ["user", "assistant"],
        },
        id: {
          not: userMessage.id,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 8,
      select: {
        role: true,
        content: true,
      },
    });

    let toolResult: BeeUpToolExecutionResult | null = null;
    let reply: BeeUpChatReply | null = null;
    let geminiAttempted = false;
    let geminiErrorMessage: string | null = null;

    if (payload.toolIntent) {
      toolResult = await executeToolByIntent({
        intent: payload.toolIntent,
        request: authRequest,
        message: payload.message,
        dependencies,
        params: payload.toolParams,
      });

      reply = buildChatReply({
        message: payload.message,
        currentView: payload.currentView ?? null,
        sources,
        toolResult,
        userFirstName: getFirstName(authRequest.adminUser?.name || authRequest.adminUser?.username),
        isFirstTurn: recentConversation.length === 0,
      });
    }

    if (!reply && hasBeeUpGeminiEnabled()) {
      geminiAttempted = true;
      try {
        const geminiReply = await generateBeeUpReplyWithGemini({
          request: authRequest,
          message: payload.message,
          currentView: payload.currentView ?? null,
          recentConversation: recentConversation.reverse().map((message) => ({
            role: message.role as "user" | "assistant",
            content: message.content,
          })),
          sources,
          dependencies,
        });

        if (geminiReply) {
          toolResult = geminiReply.toolResult;
          reply = {
            content: geminiReply.content,
            actions: buildBeeUpActionsFromReplyText(payload.message, geminiReply.content, geminiReply.toolResult),
            sources,
            mode: geminiReply.mode,
            toolName: geminiReply.toolName,
          };
        }
      } catch (error) {
        geminiErrorMessage = formatBeeUpError(error);
        console.error("[bee-up] Gemini fallback acionado:", error);
      }
    }

    if (!reply) {
      const detectedIntent = detectToolIntent(payload.message);
      toolResult = detectedIntent
        ? await executeToolByIntent({
            intent: detectedIntent,
            request: authRequest,
            message: payload.message,
            dependencies,
            params: payload.toolParams,
          })
        : null;

      reply = buildChatReply({
        message: payload.message,
        currentView: payload.currentView ?? null,
        sources,
        toolResult,
        userFirstName: getFirstName(authRequest.adminUser?.name || authRequest.adminUser?.username),
        isFirstTurn: recentConversation.length === 0,
      });
    }

    if (toolResult) {
      await prisma.aiActionLog.create({
        data: {
          userId: authRequest.adminUser?.id ?? "",
          threadId: thread.id,
          actionName: toolResult.name,
          status: toolResult.logStatus,
          inputPayload: toJsonInputValue({
            message: payload.message,
            currentView: payload.currentView ?? null,
            toolIntent: payload.toolIntent ?? null,
            toolParams: payload.toolParams ?? null,
          }),
          outputPayload: toolResult.payload
            ? toJsonInputValue(toolResult.payload)
            : Prisma.JsonNull,
          errorMessage: toolResult.errorMessage ?? null,
        },
      });

      await prisma.aiAgentMessage.create({
        data: {
          threadId: thread.id,
          role: "tool",
          content: toolResult.summary,
          toolName: toolResult.name,
          toolPayload: toolResult.payload
            ? toJsonInputValue(toolResult.payload)
            : Prisma.JsonNull,
        },
      });
    }

    const assistantMessage = await prisma.aiAgentMessage.create({
      data: {
        threadId: thread.id,
        role: "assistant",
        content: reply.content,
        toolPayload: toJsonInputValue({
          actions: reply.actions,
          sources: reply.sources,
          mode: reply.mode,
          toolName: reply.toolName,
          toolPayload: toolResult?.payload ?? null,
        }),
      },
    });

    await persistBeeUpChatAuditLog({
      request: authRequest,
      threadId: thread.id,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      userMessageContent: payload.message,
      currentView: payload.currentView ?? null,
      reply,
      toolResult,
      sources,
      geminiAttempted,
      geminiErrorMessage,
    });

    const updatedThread = await prisma.aiAgentThread.update({
      where: { id: thread.id },
      data: {
        title: shouldRefreshThreadTitle(thread.title, payload.message) ? buildThreadTitle(payload.message) : thread.title,
        lastMessageAt: assistantMessage.createdAt,
      },
      include: {
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });

    response.json({
      thread: mapThreadSummary(updatedThread),
      userMessage: mapMessage(userMessage),
      assistantMessage: {
        ...mapMessage(assistantMessage),
        actions: reply.actions,
        sources: reply.sources,
        mode: reply.mode,
      },
    });
  });

  router.get("/knowledge", async (request, response) => {
    const authRequest = request as BeeUpAuthRequest;
    if (!dependencies.isRootUser(authRequest)) {
      response.status(403).json({ error: "Apenas root pode gerenciar a base do Bee Up." });
      return;
    }

    const items = await prisma.aiKnowledgeDocument.findMany({
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      include: {
        _count: {
          select: {
            chunks: true,
          },
        },
      },
    });

    response.json({
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        status: item.status,
        content: item.content,
        tags: Array.isArray(item.tags) ? item.tags : [],
        createdByUserId: item.createdByUserId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        chunkCount: item._count.chunks,
      })),
    });
  });

  router.post("/knowledge", async (request, response) => {
    const authRequest = request as BeeUpAuthRequest;
    if (!dependencies.isRootUser(authRequest)) {
      response.status(403).json({ error: "Apenas root pode criar documentos do Bee Up." });
      return;
    }

    const payload = beeUpKnowledgeSchema.parse(request.body || {});
    const document = await prisma.aiKnowledgeDocument.create({
      data: {
        title: payload.title,
        category: payload.category?.trim().toUpperCase() || "GENERAL",
        status: payload.status || "ACTIVE",
        content: payload.content,
        tags: (payload.tags || []).map((tag) => tag.trim()) satisfies Prisma.InputJsonValue,
        createdByUserId: authRequest.adminUser?.id ?? null,
      },
    });

    await upsertKnowledgeDocumentChunks(document.id, document.content);

    response.status(201).json({
      id: document.id,
    });
  });

  router.put("/knowledge/:id", async (request, response) => {
    const authRequest = request as BeeUpAuthRequest;
    if (!dependencies.isRootUser(authRequest)) {
      response.status(403).json({ error: "Apenas root pode editar documentos do Bee Up." });
      return;
    }

    const payload = beeUpKnowledgeSchema.parse(request.body || {});
    const existing = await prisma.aiKnowledgeDocument.findUnique({
      where: { id: request.params.id },
      select: { id: true },
    });

    if (!existing) {
      response.status(404).json({ error: "Documento do Bee Up não encontrado." });
      return;
    }

    const document = await prisma.aiKnowledgeDocument.update({
      where: { id: request.params.id },
      data: {
        title: payload.title,
        category: payload.category?.trim().toUpperCase() || "GENERAL",
        status: payload.status || "ACTIVE",
        content: payload.content,
        tags: (payload.tags || []).map((tag) => tag.trim()) satisfies Prisma.InputJsonValue,
      },
    });

    await upsertKnowledgeDocumentChunks(document.id, document.content);

    response.json({
      id: document.id,
    });
  });

  router.delete("/knowledge/:id", async (request, response) => {
    const authRequest = request as BeeUpAuthRequest;
    if (!dependencies.isRootUser(authRequest)) {
      response.status(403).json({ error: "Apenas root pode remover documentos do Bee Up." });
      return;
    }

    const existing = await prisma.aiKnowledgeDocument.findUnique({
      where: { id: request.params.id },
      select: { id: true },
    });

    if (!existing) {
      response.status(404).json({ error: "Documento do Bee Up não encontrado." });
      return;
    }

    await prisma.aiKnowledgeDocument.delete({
      where: { id: request.params.id },
    });

    response.status(204).end();
  });

  router.post("/alerts/:id/read", async (request, response) => {
    const authRequest = request as BeeUpAuthRequest;
    const alert = await prisma.aiUserAlert.findFirst({
      where: {
        id: request.params.id,
        userId: authRequest.adminUser?.id,
      },
      select: { id: true },
    });

    if (!alert) {
      response.status(404).json({ error: "Alerta do Bee Up não encontrado." });
      return;
    }

    await prisma.aiUserAlert.update({
      where: { id: alert.id },
      data: {
        readAt: new Date(),
      },
    });

    response.status(204).end();
  });

  app.use("/bee-up", router);
}
