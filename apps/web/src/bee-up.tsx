import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  FiAlertCircle,
  FiBookOpen,
  FiChevronUp,
  FiMessageSquare,
  FiPlus,
  FiSend,
  FiX,
  FiZap,
} from "react-icons/fi";
import { api } from "./api";
import beeUpLogo from "./assets/beeup-logo.svg";

export type BeeUpOpenViewKey =
  | "dashboard"
  | "companies"
  | "agents"
  | "scheduler"
  | "history"
  | "profile"
  | "plan";

type BeeUpAction =
  | {
      type: "OPEN_VIEW";
      label: string;
      view: BeeUpOpenViewKey;
    }
  | {
      type: "REFRESH_BEE_UP";
      label: string;
    };

type BeeUpToolIntent = "get_plan_limits" | "get_recent_failures" | "get_connection_status" | "generate_whatsapp_qr";

type BeeUpToolParams = {
  workspaceId?: string;
};

type BeeUpWorkspaceChoice = { id: string; name: string };

type BeeUpSource = {
  title: string;
  category: string;
  content: string;
  score: number;
  origin: "SYSTEM" | "ROOT";
};

type BeeUpThreadSummary = {
  id: string;
  title: string;
  lastMessageAt: string | null;
  preview: string;
  messageCount: number;
};

type BeeUpMessagePayload = {
  actions?: BeeUpAction[];
  sources?: BeeUpSource[];
  mode?: string;
  toolName?: string | null;
  toolPayload?: unknown;
};

type BeeUpMessage = {
  id: string;
  role: string;
  content: string;
  toolName: string | null;
  toolPayload: unknown;
  createdAt: string;
  actions: BeeUpAction[];
  sources: BeeUpSource[];
  mode: string | null;
  payload: unknown;
  isPending?: boolean;
};

type BeeUpSummaryAlert = {
  id: string;
  kind: "warning" | "info" | "success";
  title: string;
  message: string;
  actions?: BeeUpAction[];
};

type BeeUpSummaryResponse = {
  alerts: BeeUpSummaryAlert[];
  quickPrompts: string[];
};

type BeeUpThreadsResponse = {
  items: BeeUpThreadSummary[];
};

type BeeUpMessagesResponse = {
  thread: BeeUpThreadSummary;
  items: Array<{
    id: string;
    role: string;
    content: string;
    toolName: string | null;
    toolPayload: unknown;
    createdAt: string;
  }>;
};

type BeeUpChatResponse = {
  thread: BeeUpThreadSummary;
  userMessage: {
    id: string;
    role: string;
    content: string;
    toolName: string | null;
    toolPayload: unknown;
    createdAt: string;
  };
  assistantMessage: {
    id: string;
    role: string;
    content: string;
    toolName: string | null;
    toolPayload: unknown;
    createdAt: string;
    actions?: BeeUpAction[];
    sources?: BeeUpSource[];
    mode?: string;
  };
};

type BeeUpKnowledgeDocument = {
  id: string;
  title: string;
  category: string;
  status: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  chunkCount: number;
};

type BeeUpKnowledgeResponse = {
  items: BeeUpKnowledgeDocument[];
};

type BeeUpDrawerProps = {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  currentView: string;
  onOpenView: (view: BeeUpOpenViewKey) => void;
};

type BeeUpKnowledgeAdminProps = {
  isRootUser: boolean;
};

const beeUpQuickPromptFallbacks = [
  "Qual é o limite do meu plano?",
  "Veja minhas falhas recentes",
  "Cheque minhas contas conectadas",
  "Gerar novo QR do WhatsApp",
];

function isBeeUpPayload(value: unknown): value is BeeUpMessagePayload {
  return Boolean(value) && typeof value === "object";
}

function dedupeBeeUpSources(sources: BeeUpSource[]): BeeUpSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.origin}:${source.category}:${source.title}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeBeeUpMessage(message: {
  id: string;
  role: string;
  content: string;
  toolName: string | null;
  toolPayload: unknown;
  createdAt: string;
}): BeeUpMessage {
  const payload = isBeeUpPayload(message.toolPayload) ? message.toolPayload : {};
  return {
    ...message,
    actions: Array.isArray(payload.actions) ? (payload.actions as BeeUpAction[]) : [],
    sources: Array.isArray(payload.sources) ? dedupeBeeUpSources(payload.sources as BeeUpSource[]) : [],
    mode: typeof payload.mode === "string" ? payload.mode : null,
    payload: payload.toolPayload ?? message.toolPayload ?? null,
  };
}

function resolveQuickPromptToolIntent(prompt: string): BeeUpToolIntent | null {
  const normalized = prompt.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (normalized.includes("limite") || normalized.includes("plano")) {
    return "get_plan_limits";
  }
  if (normalized.includes("falha")) {
    return "get_recent_failures";
  }
  if (normalized.includes("contas conectadas") || normalized.includes("conectadas")) {
    return "get_connection_status";
  }
  if (normalized.includes("qr") && normalized.includes("whatsapp")) {
    return "generate_whatsapp_qr";
  }
  return null;
}

function asBeeUpQrPayload(payload: unknown): {
  connectionId?: string | null;
  qrImageDataUrl?: string | null;
  connectionName?: string | null;
  workspaceName?: string | null;
  authStatus?: string | null;
  qrStatus?: string | null;
  qrMessage?: string | null;
  qrGeneratedAt?: string | null;
  whatsappOwnerJid?: string | null;
  whatsappProfileName?: string | null;
} | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const connectionId = typeof record.connectionId === "string" ? record.connectionId : null;
  const qrImageDataUrl = typeof record.qrImageDataUrl === "string" ? record.qrImageDataUrl : null;
  if (!connectionId && !qrImageDataUrl?.trim()) {
    return null;
  }

  return {
    connectionId,
    qrImageDataUrl,
    connectionName: typeof record.connectionName === "string" ? record.connectionName : null,
    workspaceName: typeof record.workspaceName === "string" ? record.workspaceName : null,
    authStatus: typeof record.authStatus === "string" ? record.authStatus : null,
    qrStatus: typeof record.qrStatus === "string" ? record.qrStatus : null,
    qrMessage: typeof record.qrMessage === "string" ? record.qrMessage : null,
    qrGeneratedAt: typeof record.qrGeneratedAt === "string" ? record.qrGeneratedAt : null,
    whatsappOwnerJid: typeof record.whatsappOwnerJid === "string" ? record.whatsappOwnerJid : null,
    whatsappProfileName: typeof record.whatsappProfileName === "string" ? record.whatsappProfileName : null,
  };
}

type BeeUpWhatsappQrStatusResponse = {
  connectionId: string;
  connectionName: string;
  workspaceName: string | null;
  authStatus: string;
  qrStatus: string | null;
  qrMessage: string | null;
  whatsappOwnerJid: string | null;
  whatsappProfileName: string | null;
  lastAuthAt: string | null;
  lastSeenAt: string | null;
};

function resolveWhatsappOwnerNumber(ownerJid?: string | null): string | null {
  const digits = ownerJid?.match(/\d+/)?.[0] ?? "";
  return digits || null;
}

function resolveBeeUpWhatsappConnectedLabel(input: {
  connectionName?: string | null;
  whatsappOwnerJid?: string | null;
  whatsappProfileName?: string | null;
}): string {
  const connectionName = input.connectionName?.trim() || "";
  const isGenericConnectionName = /^conta\s+whatsapp$/i.test(connectionName);
  return (
    resolveWhatsappOwnerNumber(input.whatsappOwnerJid) ||
    input.whatsappProfileName?.trim() ||
    (isGenericConnectionName ? "" : connectionName) ||
    "número ainda não retornado"
  );
}

function asBeeUpWorkspaceChoicesPayload(payload: unknown): Array<{ id: string; name: string }> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const choices = (payload as Record<string, unknown>).workspaceChoices;
  if (!Array.isArray(choices)) {
    return [];
  }

  return choices
    .map((choice) => {
      if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
        return null;
      }
      const record = choice as Record<string, unknown>;
      if (typeof record.id !== "string" || typeof record.name !== "string") {
        return null;
      }
      return {
        id: record.id,
        name: record.name,
      };
    })
    .filter((choice): choice is { id: string; name: string } => Boolean(choice));
}

function formatBeeUpDate(value: string | null): string {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleString("pt-BR");
}

function renderBeeUpFormattedText(content: string) {
  const normalized = content.replace(/\*\*/g, "**");
  const lines = normalized.split("\n");

  return lines.map((line, lineIndex) => {
    const parts = line.split(/(\*\*.+?\*\*)/g).filter(Boolean);
    return (
      <span key={`bee-up-line-${lineIndex}`}>
        {parts.map((part, partIndex) => {
          const isBold = part.startsWith("**") && part.endsWith("**") && part.length >= 4;
          const text = (isBold ? part.slice(2, -2) : part).replace(/\*\*/g, "");
          if (isBold) {
            return <strong key={`bee-up-part-${lineIndex}-${partIndex}`}>{text}</strong>;
          }
          return <span key={`bee-up-part-${lineIndex}-${partIndex}`}>{text}</span>;
        })}
        {lineIndex < lines.length - 1 ? <br /> : null}
      </span>
    );
  });
}

function BeeUpAnimatedMessageContent(props: {
  content: string;
  animate: boolean;
  isPending?: boolean;
  onProgress?: () => void;
}) {
  const { content, animate, isPending, onProgress } = props;
  const [visibleContent, setVisibleContent] = useState(() => (animate ? "" : content));
  const onProgressRef = useRef<(() => void) | undefined>(onProgress);

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    if (isPending) {
      setVisibleContent("");
      return;
    }

    if (!animate) {
      setVisibleContent(content);
      return;
    }

    setVisibleContent("");
    let index = 0;
    let timeoutId = 0;
    const step = () => {
      index = Math.min(content.length, index + Math.max(2, Math.ceil(content.length / 80)));
      setVisibleContent(content.slice(0, index));
      onProgressRef.current?.();
      if (index < content.length) {
        timeoutId = window.setTimeout(step, 18);
      }
    };

    timeoutId = window.setTimeout(step, 18);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [animate, content, isPending]);

  if (isPending) {
    return (
      <div className="bee-up-message-pending">
        <span className="button-spinner" aria-hidden="true" />
        <span>Bee Up está respondendo…</span>
      </div>
    );
  }

  return <div className="bee-up-message-content">{renderBeeUpFormattedText(visibleContent)}</div>;
}

export function BeeUpDrawer(props: BeeUpDrawerProps) {
  const { isOpen, onOpen, onClose, currentView, onOpenView } = props;
  const [summary, setSummary] = useState<BeeUpSummaryResponse>({ alerts: [], quickPrompts: beeUpQuickPromptFallbacks });
  const [threads, setThreads] = useState<BeeUpThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<"threads" | "prompts" | null>(null);
  const [messages, setMessages] = useState<BeeUpMessage[]>([]);
  const [input, setInput] = useState("");
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [animatedMessageId, setAnimatedMessageId] = useState<string | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const animationTimeoutRef = useRef<number | null>(null);
  const [workspacePicker, setWorkspacePicker] = useState<{
    sourceMessageId: string;
    choices: BeeUpWorkspaceChoice[];
  } | null>(null);
  const [workspacePickerQuery, setWorkspacePickerQuery] = useState("");

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const element = messagesViewportRef.current;
    if (!element) {
      return;
    }
    element.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  const handleAnimatedProgress = useCallback(() => {
    scrollMessagesToBottom("auto");
  }, [scrollMessagesToBottom]);

  const closeWorkspacePicker = useCallback(
    (options?: { cancel?: boolean }) => {
      setWorkspacePicker(null);
      setWorkspacePickerQuery("");
      if (options?.cancel) {
        const nowIso = new Date().toISOString();
        setMessages((current) => [
          ...current,
          {
            id: `bee-up-local-cancel-${Date.now()}`,
            role: "assistant",
            content: "Processo cancelado pelo usuário.",
            toolName: null,
            toolPayload: null,
            createdAt: nowIso,
            actions: [],
            sources: [],
            mode: null,
            payload: null,
          } satisfies BeeUpMessage,
        ]);
        window.requestAnimationFrame(() => {
          scrollMessagesToBottom("smooth");
        });
      }
    },
    [scrollMessagesToBottom],
  );

  async function loadSummary() {
    setLoadingSummary(true);
    try {
      const response = await api.get<BeeUpSummaryResponse>("/bee-up/summary");
      setSummary({
        alerts: response.alerts ?? [],
        quickPrompts: response.quickPrompts?.length ? response.quickPrompts : beeUpQuickPromptFallbacks,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar resumo do Bee Up.");
    } finally {
      setLoadingSummary(false);
    }
  }

  async function loadThreads() {
    try {
      const response = await api.get<BeeUpThreadsResponse>("/bee-up/threads");
      setThreads(response.items ?? []);
      // Do not auto-open an existing thread when opening the drawer.
      // Bee Up should always open in "new conversation" mode (like ChatGPT).
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar conversas do Bee Up.");
    }
  }

  async function loadMessages(threadId: string) {
    setLoadingMessages(true);
    setError(null);
    try {
      const response = await api.get<BeeUpMessagesResponse>(`/bee-up/threads/${threadId}/messages`);
      setMessages((response.items ?? []).map(normalizeBeeUpMessage));
      window.requestAnimationFrame(() => {
        scrollMessagesToBottom("auto");
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar mensagens do Bee Up.");
    } finally {
      setLoadingMessages(false);
    }
  }

  async function bootstrapDrawer() {
    await Promise.all([loadSummary(), loadThreads()]);
  }

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    void bootstrapDrawer();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !activeThreadId) {
      return;
    }
    void loadMessages(activeThreadId);
  }, [activeThreadId, isOpen]);

  useEffect(() => {
    if (!isOpen || loadingMessages || messages.length === 0) {
      return;
    }

    window.requestAnimationFrame(() => {
      scrollMessagesToBottom("auto");
    });
  }, [isOpen, loadingMessages, messages.length]);

  useEffect(() => {
    if (!isOpen) {
      setOpenPanel(null);
      closeWorkspacePicker();
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (openPanel) {
        setOpenPanel(null);
        return;
      }
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose, openPanel, closeWorkspacePicker]);

  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) {
        window.clearTimeout(animationTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const pendingConnectionIds = Array.from(
      new Set(
        messages
          .map((message) => asBeeUpQrPayload(message.payload))
          .filter((payload) => {
            if (!payload?.connectionId) {
              return false;
            }
            const hasResolvedWhatsappIdentity = Boolean(
              resolveWhatsappOwnerNumber(payload.whatsappOwnerJid) || payload.whatsappProfileName?.trim(),
            );
            return payload.authStatus !== "CONNECTED" || payload.qrStatus !== "CONNECTED" || !hasResolvedWhatsappIdentity;
          })
          .map((payload) => payload!.connectionId!),
      ),
    );

    if (pendingConnectionIds.length === 0) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      const results = await Promise.allSettled(
        pendingConnectionIds.map((connectionId) =>
          api.get<BeeUpWhatsappQrStatusResponse>(`/bee-up/whatsapp-qr-status/${connectionId}`),
        ),
      );

      if (cancelled) {
        return;
      }

      const statusByConnectionId = new Map<string, BeeUpWhatsappQrStatusResponse>();
      for (const result of results) {
        if (result.status === "fulfilled") {
          statusByConnectionId.set(result.value.connectionId, result.value);
        }
      }

      if (statusByConnectionId.size === 0) {
        return;
      }

      setMessages((current) =>
        current.map((message) => {
          const qrPayload = asBeeUpQrPayload(message.payload);
          if (!qrPayload?.connectionId) {
            return message;
          }

          const status = statusByConnectionId.get(qrPayload.connectionId);
          if (!status) {
            return message;
          }

          return {
            ...message,
            content:
              status.authStatus === "CONNECTED"
                ? `Conta WhatsApp conectada com sucesso: ${resolveBeeUpWhatsappConnectedLabel(status)}${status.workspaceName ? ` no workspace ${status.workspaceName}` : ""}.`
                : message.content,
            payload: {
              ...(message.payload && typeof message.payload === "object" && !Array.isArray(message.payload) ? message.payload : {}),
              connectionId: status.connectionId,
              connectionName: status.connectionName,
              workspaceName: status.workspaceName,
              authStatus: status.authStatus,
              qrStatus: status.qrStatus,
              qrMessage: status.qrMessage,
              whatsappOwnerJid: status.whatsappOwnerJid,
              whatsappProfileName: status.whatsappProfileName,
              lastAuthAt: status.lastAuthAt,
              lastSeenAt: status.lastSeenAt,
            },
          };
        }),
      );
    };

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isOpen, messages]);

  async function sendMessage(nextMessage: string, toolIntent?: BeeUpToolIntent | null, toolParams?: BeeUpToolParams | null) {
    const trimmed = nextMessage.trim();
    if (!trimmed || sending) {
      return;
    }

    setSending(true);
    setError(null);
    const nowIso = new Date().toISOString();
    const tempUserId = `bee-up-user-${Date.now()}`;
    const tempAssistantId = `bee-up-assistant-${Date.now()}`;
    const optimisticUser: BeeUpMessage = {
      id: tempUserId,
      role: "user",
      content: trimmed,
      toolName: null,
      toolPayload: null,
      createdAt: nowIso,
      actions: [],
      sources: [],
      mode: null,
      payload: null,
    };
    const optimisticAssistant: BeeUpMessage = {
      id: tempAssistantId,
      role: "assistant",
      content: "",
      toolName: null,
      toolPayload: null,
      createdAt: nowIso,
      actions: [],
      sources: [],
      mode: "PENDING",
      payload: null,
      isPending: true,
    };
    setMessages((current) => [...current, optimisticUser, optimisticAssistant]);
    setInput("");
    window.requestAnimationFrame(() => {
      scrollMessagesToBottom("smooth");
    });

    try {
      const response = await api.postJson<BeeUpChatResponse>("/bee-up/chat", {
        threadId: activeThreadId ?? undefined,
        message: trimmed,
        currentView,
        toolIntent: toolIntent ?? undefined,
        toolParams: toolParams ?? undefined,
      });

      const normalizedAssistant = normalizeBeeUpMessage(response.assistantMessage);
      const normalizedUser = normalizeBeeUpMessage(response.userMessage);

      setThreads((current) => {
        const withoutCurrent = current.filter((thread) => thread.id !== response.thread.id);
        return [response.thread, ...withoutCurrent];
      });
      setActiveThreadId(response.thread.id);
      setMessages((current) =>
        current.map((message) => {
          if (message.id === tempUserId) {
            return normalizedUser;
          }
          if (message.id === tempAssistantId) {
            return normalizedAssistant;
          }
          return message;
        }),
      );
      if (animationTimeoutRef.current) {
        window.clearTimeout(animationTimeoutRef.current);
      }
      setAnimatedMessageId(normalizedAssistant.id);
      animationTimeoutRef.current = window.setTimeout(() => {
        setAnimatedMessageId((current) => (current === normalizedAssistant.id ? null : current));
      }, Math.min(Math.max(normalizedAssistant.content.length * 18, 900), 4200));
      window.requestAnimationFrame(() => {
        scrollMessagesToBottom("smooth");
      });
      await loadSummary();
    } catch (sendError) {
      setMessages((current) =>
        current.filter((message) => message.id !== tempAssistantId && message.id !== tempUserId),
      );
      setInput(trimmed);
      setError(sendError instanceof Error ? sendError.message : "Falha ao conversar com o Bee Up.");
    } finally {
      setSending(false);
    }
  }

  function resetConversation() {
    if (animationTimeoutRef.current) {
      window.clearTimeout(animationTimeoutRef.current);
    }
    setAnimatedMessageId(null);
    setActiveThreadId(null);
    setMessages([]);
    setInput("");
    setError(null);
    setOpenPanel(null);
    closeWorkspacePicker();
  }

  function togglePanel(panel: "threads" | "prompts") {
    setOpenPanel((current) => (current === panel ? null : panel));
  }

  async function handleAction(action: BeeUpAction) {
    if (action.type === "OPEN_VIEW") {
      onOpenView(action.view);
      return;
    }

    await loadSummary();
    if (activeThreadId) {
      await loadMessages(activeThreadId);
    }
  }

  const hasThreads = threads.length > 0;
  const emptyThreadState = useMemo(
    () => !loadingMessages && !sending && messages.length === 0,
    [loadingMessages, sending, messages.length],
  );
  const quickPrompts = useMemo(
    () => (summary.quickPrompts.length ? summary.quickPrompts : beeUpQuickPromptFallbacks).slice(0, 4),
    [summary.quickPrompts],
  );
  const currentViewLabel = useMemo(() => {
    const labels: Record<string, string> = {
      dashboard: "Dashboard",
      companies: "Perfis",
      agents: "Conectar contas",
      scheduler: "Agendar",
      history: "Histórico",
      profile: "Minha conta",
      plan: "Meu plano",
    };
    return labels[currentView] || currentView;
  }, [currentView]);

  return (
    <>
	      <button
	        type="button"
	        className={`bee-up-launcher ${isOpen ? "bee-up-launcher-open" : ""}`}
	        onClick={isOpen ? onClose : onOpen}
	        aria-label={isOpen ? "Fechar Assistente Bee Up" : "Abrir Assistente Bee Up"}
	        title={isOpen ? "Fechar Bee Up" : "Abrir Bee Up"}
	      >
        <span className="bee-up-launcher-logo-wrap" aria-hidden="true">
          <img className="bee-up-launcher-logo" src={beeUpLogo} alt="" />
        </span>
        <span className="bee-up-launcher-icon" aria-hidden="true">
          <FiChevronUp />
        </span>
      </button>

      <button
        type="button"
        className={`bee-up-overlay ${isOpen ? "bee-up-overlay-open" : ""}`}
        aria-label="Fechar Assistente Bee Up"
        aria-hidden={!isOpen}
        tabIndex={isOpen ? 0 : -1}
        onClick={onClose}
      />

      <aside
        className={`bee-up-drawer ${isOpen ? "bee-up-drawer-open" : ""}`}
        aria-hidden={!isOpen}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="bee-up-drawer-header">
          <div className="bee-up-drawer-brand">
            <span className="bee-up-drawer-brand-icon" aria-hidden="true">
              <img className="bee-up-drawer-brand-logo" src={beeUpLogo} alt="" />
            </span>
          </div>

	          <div className="bee-up-drawer-toolbar">
	            <div className="bee-up-drawer-toolbar-actions">
	              <button
	                type="button"
	                className={`bee-up-icon-button bee-up-icon-button-action ${openPanel === "prompts" ? "bee-up-icon-button-active" : ""}`}
	                onClick={() => togglePanel("prompts")}
	                aria-label="Abrir atalhos do Bee Up"
	                title="Atalhos"
	                aria-expanded={openPanel === "prompts"}
	              >
	                <FiZap />
	              </button>
	              <button
	                type="button"
	                className={`bee-up-icon-button bee-up-icon-button-action ${openPanel === "threads" ? "bee-up-icon-button-active" : ""}`}
	                onClick={() => togglePanel("threads")}
	                aria-label="Abrir conversas do Bee Up"
	                title="Conversas"
	                aria-expanded={openPanel === "threads"}
	              >
	                <FiMessageSquare />
	              </button>
	              <button
	                type="button"
	                className="bee-up-icon-button bee-up-icon-button-action"
	                onClick={resetConversation}
	                aria-label="Iniciar nova conversa"
	                title="Nova conversa"
		              >
		                <FiPlus />
		              </button>
		            </div>
		            <button
		              type="button"
		              className="bee-up-icon-button bee-up-icon-button-close"
	              onClick={onClose}
	              aria-label="Fechar Bee Up"
	              title="Fechar"
	            >
	              <FiX />
	            </button>
	          </div>
	        </div>

        {openPanel === "prompts" ? (
          <div className="bee-up-dropdown-panel">
            <div className="bee-up-dropdown-panel-head">
              <strong>Atalhos</strong>
            </div>
            <div className="bee-up-compose-prompts">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="bee-up-chip"
                  onClick={() => {
                    setOpenPanel(null);
                    void sendMessage(prompt, resolveQuickPromptToolIntent(prompt));
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {openPanel === "threads" ? (
          <div className="bee-up-dropdown-panel">
            <div className="bee-up-dropdown-panel-head">
              <strong>Conversas</strong>
            </div>
            <div className="bee-up-thread-list bee-up-thread-list-compact">
              {threads.length === 0 ? (
                <div className="bee-up-empty-subtle">A primeira conversa do Bee Up será criada quando você enviar uma mensagem.</div>
              ) : (
                threads.map((thread) => (
	                  <button
	                    key={thread.id}
	                    type="button"
	                    className={`bee-up-thread-button ${activeThreadId === thread.id ? "bee-up-thread-button-active" : ""}`}
	                    title="Abrir conversa"
	                    onClick={() => {
	                      setActiveThreadId(thread.id);
	                      setOpenPanel(null);
	                    }}
	                  >
                    <strong>{thread.title}</strong>
                    <span>{thread.preview || "Sem prévia ainda."}</span>
                    <small>{formatBeeUpDate(thread.lastMessageAt)}</small>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}

	        <div className="bee-up-chat-panel">
          <div className="bee-up-chat-meta">
            <div className="bee-up-chat-meta-copy">
              <span className="bee-up-context-pill">
                <FiMessageSquare aria-hidden="true" />
                <strong>Tela:</strong> {currentViewLabel}
              </span>
            </div>
          </div>

          <div ref={messagesViewportRef} className="bee-up-messages">
            {loadingMessages ? (
              <div className="bee-up-messages-skeleton" aria-label="Carregando conversa">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={`bee-up-skeleton-${index}`}
                    className={`bee-up-message-skeleton ${index % 2 === 0 ? "bee-up-message-skeleton-user" : "bee-up-message-skeleton-assistant"}`}
                  >
                    <span className="skeleton-line skeleton-line-text-wide" />
                    <span className="skeleton-line skeleton-line-text-medium" />
                  </div>
                ))}
              </div>
            ) : emptyThreadState ? (
              <div className="bee-up-empty-state">
                <strong>Bee Up pronto para ajudar</strong>
                <span>Use o chat para entender erros, limites do plano, cobrança, QR do WhatsApp e navegação do painel.</span>
              </div>
            ) : (
              messages.map((message) => {
                const qrPayload = asBeeUpQrPayload(message.payload);
                const workspaceChoices = asBeeUpWorkspaceChoicesPayload(message.payload);
                return (
                  <article
                    key={message.id}
                    className={`bee-up-message bee-up-message-${message.role === "user" ? "user" : "assistant"}`}
                  >
                    <div className="bee-up-message-head">
                      <strong>{message.role === "user" ? "Você" : "Bee Up"}</strong>
                      <small>{formatBeeUpDate(message.createdAt)}</small>
                    </div>
                    <BeeUpAnimatedMessageContent
                      content={message.content}
                      animate={message.id === animatedMessageId}
                      isPending={message.isPending}
                      onProgress={handleAnimatedProgress}
                    />
                    {qrPayload ? (
                      <div className="bee-up-qr-preview">
                        {qrPayload.authStatus === "CONNECTED" || qrPayload.qrStatus === "CONNECTED" ? (
                          <div className="bee-up-qr-connected">
                            <strong>WhatsApp conectado</strong>
                            <span>
                              {resolveBeeUpWhatsappConnectedLabel(qrPayload)}
                            </span>
                            {qrPayload.whatsappProfileName ? <small>{qrPayload.whatsappProfileName}</small> : null}
                            {qrPayload.workspaceName ? <small>Workspace: {qrPayload.workspaceName}</small> : null}
                          </div>
                        ) : qrPayload.qrImageDataUrl ? (
                          <img src={qrPayload.qrImageDataUrl} alt="QR Code do WhatsApp" />
                        ) : null}
                        {qrPayload.authStatus !== "CONNECTED" && qrPayload.qrStatus !== "CONNECTED" ? (
                          <span>{qrPayload.qrMessage || "Escaneie o QR Code no WhatsApp do celular."}</span>
                        ) : null}
                        {qrPayload.qrGeneratedAt ? <small>Gerado em {formatBeeUpDate(qrPayload.qrGeneratedAt)}</small> : null}
                      </div>
                    ) : null}
                    {workspaceChoices.length > 0 ? (
                      <div className="bee-up-workspace-choice-list">
                        <button
                          type="button"
                          className="bee-up-workspace-choice-button"
                          onClick={() => {
                            setWorkspacePicker({
                              sourceMessageId: message.id,
                              choices: workspaceChoices,
                            });
                            setWorkspacePickerQuery("");
                          }}
                          disabled={sending}
                        >
                          Selecionar workspace
                        </button>
                      </div>
                    ) : null}
                    {message.actions.length > 0 ? (
                      <div className="bee-up-message-actions">
                        {message.actions.map((action) => (
                          <button
                            key={`${message.id}-${action.label}`}
                            type="button"
                            className="bee-up-message-action-button"
                            onClick={() => void handleAction(action)}
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>

          {workspacePicker ? (
            <div
              className="bee-up-inline-popover-backdrop"
              role="presentation"
              onClick={() => closeWorkspacePicker({ cancel: true })}
            >
              <section
                className="bee-up-inline-popover"
                role="dialog"
                aria-label="Selecionar workspace"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="bee-up-inline-popover-head">
                  <strong>Selecionar workspace</strong>
                  <button
                    type="button"
                    className="bee-up-inline-popover-close"
                    aria-label="Fechar"
                    title="Fechar"
                    onClick={() => closeWorkspacePicker({ cancel: true })}
                  >
                    <FiX aria-hidden="true" />
                  </button>
                </div>

                <form className="bee-up-inline-popover-search" onSubmit={(event) => event.preventDefault()}>
                  <input
                    value={workspacePickerQuery}
                    onChange={(event) => setWorkspacePickerQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        // Don't let enter leak into the main chat composer.
                        event.preventDefault();
                        event.stopPropagation();
                      }
                    }}
                    placeholder="Pesquisar workspace..."
                    autoFocus
                  />
                </form>

                <div className="bee-up-inline-popover-list" role="list">
                  {workspacePicker.choices
                    .filter((choice) =>
                      choice.name.toLowerCase().includes(workspacePickerQuery.trim().toLowerCase()),
                    )
                    .map((choice) => (
                      <button
                        key={choice.id}
                        type="button"
                        className="bee-up-inline-popover-item"
                        onClick={() => {
                          closeWorkspacePicker();
                          void sendMessage(
                            `Gerar QR do WhatsApp no workspace ${choice.name}`,
                            "generate_whatsapp_qr",
                            { workspaceId: choice.id },
                          );
                        }}
                        disabled={sending}
                      >
                        {choice.name}
                      </button>
                    ))}
                </div>
              </section>
            </div>
          ) : null}

          {error ? (
            <div className="info-banner info-banner-error bee-up-info-banner">
              <FiAlertCircle aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <form
            className="bee-up-compose"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              void sendMessage(input);
            }}
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Pergunte algo ao Bee Up…"
              rows={2}
            />
	            <div className="bee-up-compose-actions">
	              <span className="bee-up-compose-hint">Use os ícones do topo para atalhos e conversas.</span>
	              <button type="submit" className="bee-up-send-button" disabled={sending || !input.trim()}>
	                <FiSend aria-hidden="true" />
	                <span>{sending ? "Enviando…" : "Enviar"}</span>
	              </button>
	            </div>
          </form>
        </div>
      </aside>
    </>
  );
}

export function BeeUpKnowledgeAdmin(props: BeeUpKnowledgeAdminProps) {
  const { isRootUser } = props;
  const [items, setItems] = useState<BeeUpKnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("GENERAL");
  const [status, setStatus] = useState("ACTIVE");
  const [tags, setTags] = useState("");
  const [content, setContent] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadKnowledge() {
    if (!isRootUser) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<BeeUpKnowledgeResponse>("/bee-up/knowledge");
      setItems(response.items ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar a base do Bee Up.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadKnowledge();
  }, [isRootUser]);

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setCategory("GENERAL");
    setStatus("ACTIVE");
    setTags("");
    setContent("");
  }

  async function saveDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isRootUser || saving) {
      return;
    }

    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const payload = {
        title,
        category,
        status,
        content,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      };

      if (editingId) {
        await api.putJson(`/bee-up/knowledge/${editingId}`, payload);
        setInfo("Documento Bee Up atualizado com sucesso.");
      } else {
        await api.postJson("/bee-up/knowledge", payload);
        setInfo("Documento Bee Up criado com sucesso.");
      }

      resetForm();
      await loadKnowledge();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Falha ao salvar documento do Bee Up.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteDocument(id: string) {
    if (!window.confirm("Remover este documento da base do Bee Up?")) {
      return;
    }

    setError(null);
    setInfo(null);
    try {
      await api.delete(`/bee-up/knowledge/${id}`);
      if (editingId === id) {
        resetForm();
      }
      setInfo("Documento Bee Up removido com sucesso.");
      await loadKnowledge();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Falha ao remover documento do Bee Up.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  if (!isRootUser) {
    return (
      <div className="view-stack">
        <section className="panel-card">
          <div className="empty-state">Apenas root pode administrar a base do Assistente Bee Up.</div>
        </section>
      </div>
    );
  }

  return (
    <div className="view-stack">
      <section className="panel-card view-stack">
        <div className="section-head">
          <div>
            <span className="section-kicker">root</span>
            <div className="view-title-with-icon">
              <span className="view-title-icon" aria-hidden="true">
                <FiMessageSquare />
              </span>
              <h2>Assistente Bee Up</h2>
            </div>
          </div>
        </div>
        <p className="field-hint">
          Cadastre FAQ, regras, tutoriais e incidentes conhecidos para alimentar a base do Bee Up.
        </p>

        {info ? <div className="info-banner info-banner-success">{info}</div> : null}
        {error ? <div className="info-banner info-banner-error">{error}</div> : null}

        <form onSubmit={saveDocument} className="form-stack bee-up-knowledge-form">
          <label className="field-label">
            <span>Título</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Regras de stories" required />
          </label>
          <label className="field-label">
            <span>Categoria</span>
            <input
              value={category}
              onChange={(event) => setCategory(event.target.value.toUpperCase())}
              placeholder="GENERAL"
              required
            />
          </label>
          <label className="field-label">
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
            </select>
          </label>
          <label className="field-label">
            <span>Tags</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="instagram, stories, qr"
            />
          </label>
          <label className="field-label">
            <span>Conteúdo</span>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={10}
              placeholder="Escreva aqui o conteúdo que o Bee Up poderá usar nas respostas."
              required
            />
          </label>
          <div className="bee-up-knowledge-actions">
            <button type="submit" disabled={saving}>
              {saving ? "Salvando…" : editingId ? "Salvar alterações" : "Adicionar documento"}
            </button>
            {editingId ? (
              <button type="button" className="secondary-button" onClick={resetForm}>
                Cancelar edição
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="panel-card view-stack">
        <div className="section-head">
          <div>
            <span className="section-kicker">base</span>
            <div className="view-title-with-icon">
              <span className="view-title-icon" aria-hidden="true">
                <FiBookOpen />
              </span>
              <h2>Documentos do Bee Up</h2>
            </div>
          </div>
        </div>
        {loading ? (
          <div className="bee-up-knowledge-loading" aria-busy="true">
            <span className="skeleton-line skeleton-line-title" />
            <span className="skeleton-line skeleton-line-pill skeleton-line-pill-wide" />
            <span className="skeleton-line skeleton-line-text-wide" />
            <span className="skeleton-line skeleton-line-text-wide" />
            <span className="skeleton-line skeleton-line-button skeleton-line-button-wide" />
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">Nenhum documento cadastrado ainda.</div>
        ) : (
          <div className="bee-up-knowledge-list">
            {items.map((item) => (
              <article key={item.id} className="row-card bee-up-knowledge-card">
                <div className="bee-up-knowledge-card-main">
                  <strong>{item.title}</strong>
                  <div className="meta-pill-row">
                    <span className="unit-pill">{item.category}</span>
                    <span className="unit-pill">{item.status === "ACTIVE" ? "Ativo" : "Inativo"}</span>
                    <span className="unit-pill">Chunks: {item.chunkCount}</span>
                  </div>
                  {item.tags.length > 0 ? <span className="field-hint">Tags: {item.tags.join(", ")}</span> : null}
                  <p>{item.content}</p>
                </div>
                <div className="bee-up-knowledge-card-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(item.id);
                      setTitle(item.title);
                      setCategory(item.category);
                      setStatus(item.status);
                      setTags(item.tags.join(", "));
                      setContent(item.content);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    Editar
                  </button>
                  <button type="button" className="danger-button" onClick={() => void deleteDocument(item.id)}>
                    Excluir
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
