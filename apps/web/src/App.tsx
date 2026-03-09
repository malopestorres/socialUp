import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { FiAlertCircle, FiBell, FiCheckCircle, FiClock, FiEye, FiEyeOff, FiWifi, FiX } from "react-icons/fi";
import { api } from "./api";
import appLogo from "./assets/logo.svg";

type ViewKey =
  | "dashboard"
  | "profile"
  | "organizations"
  | "companies"
  | "agents"
  | "scheduler"
  | "media"
  | "history"
  | "logs"
  | "notices"
  | "noticeAdmin";

type HistoryFilterKey = "all" | "upcoming" | "canceled" | "sent" | "failed";

type Organization = {
  id: string;
  name: string;
  createdAt: string;
};

type Company = {
  id: string;
  name: string;
  organizationId: string;
  createdAt: string;
};

type SocialConnection = {
  id: string;
  companyId: string;
  platform: "instagram" | "whatsapp";
  displayName: string;
  loginIdentifier: string | null;
  hasSecret: boolean;
  authStatus: "AUTH_REQUIRED" | "AUTH_IN_PROGRESS" | "CONNECTED";
  automationMode: "VISUAL" | "HEADLESS";
  authLaunchUrl: string | null;
  lastAuthAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  qrStatus?: "IDLE" | "PREPARING" | "WAITING_QR_SCAN" | "QR_EXPIRED" | "CONNECTED" | "ERROR";
  qrImageDataUrl?: string | null;
  qrGeneratedAt?: string | null;
  workerLastSeenAt?: string | null;
  qrMessage?: string | null;
};

type Job = {
  id: string;
  companyId: string;
  socialConnectionId: string | null;
  filePath: string;
  filePaths?: string[];
  sequential?: boolean;
  title?: string | null;
  caption: string | null;
  locationName: string | null;
  locationId?: string | null;
  publicationType:
    | "instagram_story"
    | "instagram_reel"
    | "instagram_post"
    | "whatsapp_status_midia"
    | "whatsapp_status_texto";
  postStory: boolean;
  postReel: boolean;
  postWhatsapp: boolean;
  modoWhatsapp: "link" | "midia" | "texto";
  dataPostagem: string;
  status: string;
  tentativas: number;
  createdAt: string;
  lastError: string | null;
};

type SchedulerPublicationType = Job["publicationType"] | "";

type SchedulerUploadedMedia = {
  filePath: string;
  fileName: string;
  fileSizeBytes: number | null;
};

type Log = {
  id: string;
  companyId: string;
  level: string;
  errorCode: string | null;
  message: string;
  screenshotPath: string | null;
  createdAt: string;
};

type Dashboard = {
  companyId: string | null;
  totals: Record<string, number>;
  agentsOnline: number;
  pendingJobs: number;
  failedJobs: number;
  completedJobs: number;
  canceledJobs: number;
  instagramForcedLocationId?: string | null;
  instagramForcedLocationName?: string | null;
};

type MediaEntry = {
  filePath: string;
  companyId: string;
  previewUrl: string;
  caption: string | null;
  publicationType: Job["publicationType"];
  lastUsedAt: string;
  usageCount: number;
  lastStatus: string;
};

type Aviso = {
  id: string;
  kind: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
};

type AuthUser = {
  id: string;
  name: string;
  username: string;
  role: string;
};

type InstagramOauthWindowMessage = {
  type: "socialup-instagram-oauth";
  success: boolean;
  message?: string;
  connectionId?: string | null;
};

const initialDashboard: Dashboard = {
  companyId: null,
  totals: {},
  agentsOnline: 0,
  pendingJobs: 0,
  failedJobs: 0,
  completedJobs: 0,
  canceledJobs: 0,
  instagramForcedLocationId: null,
  instagramForcedLocationName: null,
};

const navItems: Array<{ key: ViewKey; label: string; eyebrow?: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "agents", label: "Conectar contas" },
  { key: "scheduler", label: "Agendar" },
  { key: "media", label: "Midias" },
  { key: "history", label: "Histórico" },
  { key: "noticeAdmin", label: "Cadastrar avisos" },
  { key: "organizations", label: "Empresa" },
  { key: "companies", label: "Unidades" },
  { key: "logs", label: "Logs" },
];

const LEGACY_HISTORY_VIEW_QUERY_PARAM = "view";
const HISTORY_FILTER_QUERY_PARAM = "historyFilter";
const HISTORY_PAGE_SIZE = 10;
const MEDIA_PAGE_SIZE = 12;
const NOTICE_PAGE_SIZE = 10;
const INSTAGRAM_IMAGE_MAX_SIZE_BYTES = 8 * 1024 * 1024;
const INSTAGRAM_MULTI_MEDIA_MAX_FILES = 10;
const INSTAGRAM_POST_ASPECT_RATIO_MIN = 4 / 5;
const INSTAGRAM_POST_ASPECT_RATIO_MAX = 1.91;
const HISTORY_MONTH_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Março" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
];

const VIEW_ROUTE_MAP: Record<ViewKey, string> = {
  dashboard: "/dashboard",
  profile: "/perfil",
  organizations: "/empresa",
  companies: "/unidades",
  agents: "/conectar-contas",
  scheduler: "/agendar",
  media: "/midias",
  history: "/historico",
  logs: "/logs",
  notices: "/avisos",
  noticeAdmin: "/avisos/cadastrar",
};

function parseHistoryFilterKey(value: string | null | undefined): HistoryFilterKey {
  if (value === "upcoming" || value === "canceled" || value === "sent" || value === "failed") {
    return value;
  }
  return "all";
}

function readSearchParam(name: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return new URLSearchParams(window.location.search).get(name);
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/";
  }

  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}

function viewFromPathname(pathname: string): ViewKey | null {
  const normalizedPath = normalizePath(pathname);
  const entry = (Object.entries(VIEW_ROUTE_MAP) as Array<[ViewKey, string]>).find(([, route]) => route === normalizedPath);
  return entry?.[0] ?? null;
}

function buildViewHref(view: ViewKey, options?: { historyFilter?: HistoryFilterKey }): string {
  const route = VIEW_ROUTE_MAP[view] ?? VIEW_ROUTE_MAP.dashboard;
  const params = new URLSearchParams();
  if (view === "history" && options?.historyFilter && options.historyFilter !== "all") {
    params.set(HISTORY_FILTER_QUERY_PARAM, options.historyFilter);
  }
  const search = params.toString();
  return search ? `${route}?${search}` : route;
}

function initialViewFromLocation(): ViewKey {
  if (typeof window === "undefined") {
    return "dashboard";
  }

  const fromPath = viewFromPathname(window.location.pathname);
  if (fromPath) {
    return fromPath;
  }

  if (normalizePath(window.location.pathname) === "/") {
    const legacyView = readSearchParam(LEGACY_HISTORY_VIEW_QUERY_PARAM);
    return legacyView === "history" ? "history" : "dashboard";
  }

  return "dashboard";
}

const whatsappTextEmojiGroups: Array<{ label: string; emojis: string[] }> = [
  { label: "Atendimento", emojis: ["💬", "📞", "🫶", "🙏", "😊", "🤝"] },
  { label: "Promoção", emojis: ["🔥", "🎯", "💥", "💖", "🛍️", "📣"] },
  { label: "Localização", emojis: ["📍", "🗺️", "🚗", "🏥", "🏬", "📌"] },
  { label: "Comemoração", emojis: ["🎉", "🥳", "✨", "🎊", "🍾", "🎈"] },
];

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "Nao definido";
  }
  return new Date(value).toLocaleString();
}

type AvisoTone = "auth" | "error" | "info" | "success" | "neutral";

function avisoTone(kind: string): AvisoTone {
  const normalizedKind = kind.trim().toUpperCase();
  if (normalizedKind === "JOB_WAITING_LOGIN") {
    return "auth";
  }
  if (normalizedKind === "JOB_FAILED") {
    return "error";
  }
  if (normalizedKind === "SYSTEM_BROADCAST") {
    return "success";
  }
  if (normalizedKind === "JOB_SENT" || normalizedKind === "JOB_SENT_UNCONFIRMED") {
    return "info";
  }
  return "neutral";
}

function avisoToneClass(kind: string): string {
  return `notice-tone-${avisoTone(kind)}`;
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value);
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function resolveJobDisplayTitle(job: Pick<Job, "id" | "title" | "caption">): string {
  const normalizedTitle = job.title?.trim();
  if (normalizedTitle) {
    return normalizedTitle;
  }

  const normalizedCaption = job.caption?.trim();
  if (normalizedCaption) {
    return normalizedCaption;
  }

  return `Job ${job.id}`;
}

function toDateLocal(value: string): string {
  return toDateTimeLocal(value).slice(0, 10);
}

function toTimeLocal(value: string): string {
  return toDateTimeLocal(value).slice(11, 16);
}

function parseInstagramOauthWindowMessage(data: unknown): InstagramOauthWindowMessage | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as Record<string, unknown>;
  if (payload.type !== "socialup-instagram-oauth" || typeof payload.success !== "boolean") {
    return null;
  }

  return {
    type: "socialup-instagram-oauth",
    success: payload.success,
    message: typeof payload.message === "string" ? payload.message : undefined,
    connectionId: typeof payload.connectionId === "string" ? payload.connectionId : null,
  };
}

function getCurrentTimeValue(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function isVideoPath(filePath: string): boolean {
  return /\.(mp4|mov|webm|m4v)$/i.test(filePath);
}

function isImagePath(filePath: string): boolean {
  return /\.(jpe?g|png|webp|gif)$/i.test(filePath);
}

function isSupportedMediaPath(filePath: string): boolean {
  return isVideoPath(filePath) || isImagePath(filePath);
}

function buildLowQualityPreviewDataUrl(imageUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Window indisponível para gerar preview."));
      return;
    }

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";

    image.onload = () => {
      try {
        const naturalWidth = image.naturalWidth || 1;
        const naturalHeight = image.naturalHeight || 1;
        const targetWidth = 28;
        const targetHeight = Math.max(1, Math.round((naturalHeight / naturalWidth) * targetWidth));
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext("2d");

        if (!context) {
          reject(new Error("Canvas indisponível para gerar preview."));
          return;
        }

        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, targetWidth, targetHeight);
        resolve(canvas.toDataURL("image/jpeg", 0.4));
      } catch (error) {
        reject(error);
      }
    };

    image.onerror = () => {
      reject(new Error("Falha ao gerar preview da mídia."));
    };

    image.src = imageUrl;
  });
}

function isInstagramPostImagePath(filePath: string): boolean {
  return /\.(jpe?g|png)$/i.test(filePath);
}

function isInstagramReelVideoPath(filePath: string): boolean {
  return /\.mp4$/i.test(filePath);
}

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");
}

function formatAspectRatio(value: number): string {
  return value.toFixed(2).replace(/\.00$/, "");
}

function requiresInstagramImageSizeLimit(
  publicationType: SchedulerPublicationType,
  fileName: string,
): boolean {
  const isImage = isInstagramPostImagePath(fileName);
  return publicationType === "instagram_post" || (publicationType === "instagram_story" && isImage);
}

function schedulerMediaValidationMessage(
  publicationType: SchedulerPublicationType,
  fileName: string,
  fileSizeBytes?: number | null,
): string | null {
  if (publicationType === "instagram_post" && !isInstagramPostImagePath(fileName)) {
    return "Instagram Post aceita apenas imagens JPG ou PNG.";
  }

  if (publicationType === "instagram_reel" && !isInstagramReelVideoPath(fileName)) {
    return "Instagram Reel aceita apenas vídeo MP4.";
  }

  if (
    typeof fileSizeBytes === "number" &&
    fileSizeBytes > INSTAGRAM_IMAGE_MAX_SIZE_BYTES &&
    requiresInstagramImageSizeLimit(publicationType, fileName)
  ) {
    return `Imagem acima do limite para Instagram (${formatMegabytes(INSTAGRAM_IMAGE_MAX_SIZE_BYTES)} MB). ` +
      `Arquivo atual: ${formatMegabytes(fileSizeBytes)} MB.`;
  }

  return null;
}

function readImageAspectRatioFromFile(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      try {
        const width = image.naturalWidth || 0;
        const height = image.naturalHeight || 0;
        if (width <= 0 || height <= 0) {
          reject(new Error("Dimensões da imagem inválidas."));
          return;
        }
        resolve(width / height);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Falha ao ler imagem."));
    };

    image.src = objectUrl;
  });
}

async function schedulerMediaAdvancedValidationMessage(
  publicationType: SchedulerPublicationType,
  file: File,
): Promise<string | null> {
  if (publicationType !== "instagram_post" || !isInstagramPostImagePath(file.name)) {
    return null;
  }

  try {
    const aspectRatio = await readImageAspectRatioFromFile(file);
    if (aspectRatio < INSTAGRAM_POST_ASPECT_RATIO_MIN || aspectRatio > INSTAGRAM_POST_ASPECT_RATIO_MAX) {
      return (
        `Proporção da imagem não suportada para Instagram Post. ` +
        `Use entre 4:5 (${formatAspectRatio(INSTAGRAM_POST_ASPECT_RATIO_MIN)}:1) e 1.91:1. ` +
        `Atual: ${formatAspectRatio(aspectRatio)}:1.`
      );
    }
  } catch {
    return "Não foi possível validar a proporção da imagem. Use JPG/PNG sem corrupção.";
  }

  return null;
}

function publicationTypeLabel(publicationType: Job["publicationType"]): string {
  switch (publicationType) {
    case "instagram_story":
      return "Instagram Story";
    case "instagram_reel":
      return "Instagram Reel";
    case "instagram_post":
      return "Instagram Post";
    case "whatsapp_status_midia":
      return "WhatsApp Status (midia)";
    case "whatsapp_status_texto":
      return "WhatsApp Status (texto)";
  }
}

function jobStatusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "Pendente";
    case "RUNNING":
      return "Executando";
    case "SENT_UNCONFIRMED":
      return "Enviado sem confirmação";
    case "COMPLETED":
      return "Concluído";
    case "FAILED":
      return "Falhou";
    case "WAITING_LOGIN":
      return "Aguardando login";
    case "CANCELED":
      return "Cancelado";
    default:
      return status;
  }
}

const BRAZIL_TIME_ZONE = "America/Sao_Paulo";

function toTimeZoneComparableTimestamp(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const mapped: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      mapped[part.type] = part.value;
    }
  }

  return Date.UTC(
    Number.parseInt(mapped.year ?? "0", 10),
    Number.parseInt(mapped.month ?? "1", 10) - 1,
    Number.parseInt(mapped.day ?? "1", 10),
    Number.parseInt(mapped.hour ?? "0", 10),
    Number.parseInt(mapped.minute ?? "0", 10),
    Number.parseInt(mapped.second ?? "0", 10),
  );
}

function canToggleJobSchedule(job: Job): boolean {
  if (job.status === "CANCELED") {
    return true;
  }

  if (job.status === "FAILED" && isPastScheduledAt(job.dataPostagem)) {
    return false;
  }

  return job.status === "PENDING" || job.status === "WAITING_LOGIN" || job.status === "FAILED";
}

function isPastScheduledAt(dateIso: string): boolean {
  const scheduledAt = new Date(dateIso);
  const now = new Date();
  return (
    toTimeZoneComparableTimestamp(scheduledAt, BRAZIL_TIME_ZONE) <=
    toTimeZoneComparableTimestamp(now, BRAZIL_TIME_ZONE)
  );
}

function connectionPlatformLabel(platform: SocialConnection["platform"]): string {
  return platform === "instagram" ? "Instagram" : "WhatsApp";
}

function connectionStatusLabel(status: SocialConnection["authStatus"]): string {
  switch (status) {
    case "CONNECTED":
      return "Conectada";
    case "AUTH_IN_PROGRESS":
      return "Autenticação em andamento";
    case "AUTH_REQUIRED":
    default:
      return "Aguardando autenticação";
  }
}

function isInstagramPublication(publicationType: SchedulerPublicationType): boolean {
  return (
    publicationType === "instagram_post" ||
    publicationType === "instagram_reel" ||
    publicationType === "instagram_story"
  );
}

const REMEMBER_ME_STORAGE_KEY = "socialup-remember-me";
const REMEMBERED_USERNAME_STORAGE_KEY = "socialup-remembered-username";

function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loginUsername, setLoginUsername] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return window.localStorage.getItem(REMEMBERED_USERNAME_STORAGE_KEY) ?? "";
  });
  const [loginPassword, setLoginPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }

    const stored = window.localStorage.getItem(REMEMBER_ME_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  });
  const [setupKey, setSetupKey] = useState(() => new URLSearchParams(window.location.search).get("setupKey") ?? "");
  const [setupInviteValid, setSetupInviteValid] = useState(false);
  const [setupName, setSetupName] = useState("");
  const [setupUsername, setSetupUsername] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  const [activeView, setActiveView] = useState<ViewKey>(initialViewFromLocation);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard>(initialDashboard);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [organizationName, setOrganizationName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyOrganizationId, setCompanyOrganizationId] = useState("");
  const [connectionDisplayName, setConnectionDisplayName] = useState("");
  const [connectionCompanyId, setConnectionCompanyId] = useState("");
  const [connectionPlatform, setConnectionPlatform] = useState<SocialConnection["platform"]>("instagram");
  const [connectionLoginIdentifier, setConnectionLoginIdentifier] = useState("");
  const [connectionSecret, setConnectionSecret] = useState("");
  const [activeQrConnectionId, setActiveQrConnectionId] = useState<string | null>(null);
  const [qrRequestingConnectionId, setQrRequestingConnectionId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedSchedulerMedia, setUploadedSchedulerMedia] = useState<SchedulerUploadedMedia[]>([]);
  const [draggingSchedulerMediaIndex, setDraggingSchedulerMediaIndex] = useState<number | null>(null);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const [jobCompanyId, setJobCompanyId] = useState("");
  const [jobSocialConnectionId, setJobSocialConnectionId] = useState("");
  const [postTitle, setPostTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [publicationType, setPublicationType] = useState<SchedulerPublicationType>("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState(getCurrentTimeValue);
  const [scheduledTimeTouched, setScheduledTimeTouched] = useState(false);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [schedulerInfo, setSchedulerInfo] = useState("");
  const [historyInfo, setHistoryInfo] = useState("");
  const [mediaInfo, setMediaInfo] = useState("");
  const [avisosInfo, setAvisosInfo] = useState("");
  const [noticeAdminInfo, setNoticeAdminInfo] = useState("");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilterKey>(() =>
    parseHistoryFilterKey(readSearchParam(HISTORY_FILTER_QUERY_PARAM)),
  );
  const [historyMonthFilter, setHistoryMonthFilter] = useState<string>("all");
  const [historyYearFilter, setHistoryYearFilter] = useState<string>("all");
  const [mediaStatusFilter, setMediaStatusFilter] = useState<HistoryFilterKey>("all");
  const [mediaMonthFilter, setMediaMonthFilter] = useState<string>("all");
  const [mediaYearFilter, setMediaYearFilter] = useState<string>("all");
  const [historyPage, setHistoryPage] = useState(1);
  const [mediaPage, setMediaPage] = useState(1);
  const [avisosPage, setAvisosPage] = useState(1);
  const [avisosTotalPages, setAvisosTotalPages] = useState(1);
  const [avisosTotal, setAvisosTotal] = useState(0);
  const [recentAvisos, setRecentAvisos] = useState<Aviso[]>([]);
  const [unreadAvisosCount, setUnreadAvisosCount] = useState(0);
  const [noticesPopoverOpen, setNoticesPopoverOpen] = useState(false);
  const [noticesPopoverLoading, setNoticesPopoverLoading] = useState(false);
  const [markingAllAvisosRead, setMarkingAllAvisosRead] = useState(false);
  const [broadcastAvisoTitle, setBroadcastAvisoTitle] = useState("");
  const [broadcastAvisoMessage, setBroadcastAvisoMessage] = useState("");
  const [broadcastAvisoSubmitting, setBroadcastAvisoSubmitting] = useState(false);
  const [loadedMediaPreviewByPath, setLoadedMediaPreviewByPath] = useState<Record<string, boolean>>({});
  const [mediaPreviewPlaceholderByPath, setMediaPreviewPlaceholderByPath] = useState<Record<string, string>>({});
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [togglingScheduleJobId, setTogglingScheduleJobId] = useState<string | null>(null);
  const [submittingJob, setSubmittingJob] = useState(false);
  const schedulerMediaInputRef = useRef<HTMLInputElement | null>(null);
  const mediaSectionRef = useRef<HTMLElement | null>(null);
  const historySectionRef = useRef<HTMLElement | null>(null);
  const avisosSectionRef = useRef<HTMLElement | null>(null);
  const noticesBellDesktopRef = useRef<HTMLDivElement | null>(null);
  const noticesBellMobileRef = useRef<HTMLDivElement | null>(null);
  const instagramOauthPopupPollRef = useRef<number | null>(null);
  const isRootUser = authUser?.username === "root";
  const instagramForcedLocationId = (dashboard.instagramForcedLocationId || "").trim();
  const instagramForcedLocationName =
    (dashboard.instagramForcedLocationName || "").trim() || "Localização fixa do sistema";
  const isInstagramForcedLocationEnabled = instagramForcedLocationId.length > 0;
  const isPositiveAuthInfo = authInfo.trim().length > 0;
  const isPositiveSchedulerInfo =
    schedulerInfo === "Midia enviada com sucesso." ||
    schedulerInfo === "Postagem agendada com sucesso." ||
    schedulerInfo === "Postagem atualizada com sucesso.";
  const isTransientSchedulerInfo =
    isPositiveSchedulerInfo ||
    schedulerInfo === "Envie uma mídia antes de agendar este tipo de postagem." ||
    schedulerInfo === "Instagram Post aceita apenas imagens JPG ou PNG." ||
    schedulerInfo === "Instagram Reel aceita apenas vídeo MP4.";
  const isPositiveHistoryInfo =
    historyInfo === "Postagem reenfileirada para tentativa imediata." ||
    historyInfo === "Agendamento cancelado com sucesso." ||
    historyInfo === "Agendamento ativado com sucesso.";
  const isTransientHistoryInfo =
    historyInfo === "Atualizando agendamento..." ||
    historyInfo === "Reenfileirando postagem..." ||
    isPositiveHistoryInfo;
  const isPositiveMediaInfo = mediaInfo === "Mídia excluída com sucesso.";
  const isTransientMediaInfo = isPositiveMediaInfo;
  const isPositiveAvisosInfo = avisosInfo === "Avisos atualizados.";
  const isPositiveNoticeAdminInfo = noticeAdminInfo === "Aviso enviado com sucesso.";
  const isTransientAvisosInfo = isPositiveAvisosInfo;
  const isTransientNoticeAdminInfo = isPositiveNoticeAdminInfo;
  const requiresMediaUpload = publicationType !== "" && publicationType !== "whatsapp_status_texto";
  const supportsMultiMediaUpload = publicationType === "instagram_post" || publicationType === "instagram_story";
  const uploadedFilePath = uploadedSchedulerMedia[0]?.filePath ?? "";
  const uploadedFileName = uploadedSchedulerMedia[0]?.fileName ?? "";
  const uploadedFileSizeBytes = uploadedSchedulerMedia[0]?.fileSizeBytes ?? null;
  const uploadedMediaCount = uploadedSchedulerMedia.length;
  const effectiveSequentialPublishing =
    (publicationType === "instagram_post" || publicationType === "instagram_story") &&
    uploadedMediaCount > 1;
  const requiresInstagramMetadata = isInstagramPublication(publicationType);
  const supportsCaption = publicationType !== "" && publicationType !== "instagram_story";
  const captionLabel = publicationType === "whatsapp_status_texto" ? "Texto do status (aceita emojis)" : "Legenda da postagem";
  const captionPlaceholder =
    publicationType === "whatsapp_status_texto"
      ? "Digite o texto do status do WhatsApp. Emojis sao aceitos normalmente."
      : "Legenda da postagem";
  const captionTitle =
    publicationType === "whatsapp_status_texto"
      ? "Digite o texto do status do WhatsApp. Este campo aceita emojis e e obrigatório nesse tipo de publicação."
      : "Preencha a legenda da postagem. Para Instagram e WhatsApp Status em texto, este campo é obrigatório.";

  function navigateToView(view: ViewKey, options?: { historyFilter?: HistoryFilterKey }) {
    if (typeof window === "undefined") {
      return;
    }

    const nextHistoryFilter =
      view === "history" ? options?.historyFilter ?? historyFilter : undefined;
    const nextHref = buildViewHref(view, { historyFilter: nextHistoryFilter });
    const currentUrl = new URL(window.location.href);
    const nextUrl = new URL(nextHref, window.location.origin);
    const currentComparable = `${normalizePath(currentUrl.pathname)}${currentUrl.search}`;
    const nextComparable = `${normalizePath(nextUrl.pathname)}${nextUrl.search}`;

    if (currentComparable !== nextComparable) {
      window.history.pushState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    }

    if (view === "history") {
      if (nextHistoryFilter) {
        setHistoryFilter(nextHistoryFilter);
      }
      setHistoryMonthFilter("all");
      setHistoryYearFilter("all");
      setHistoryPage(1);
    }

    if (view === "notices") {
      setAvisosPage(1);
    }

    setNoticesPopoverOpen(false);
    setSidebarOpen(false);
    setActiveView(view);

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  const companyNameMap = useMemo(
    () => Object.fromEntries(companies.map((company) => [company.id, company.name])),
    [companies],
  );

  const activeQrConnection = useMemo(
    () => connections.find((connection) => connection.id === activeQrConnectionId) ?? null,
    [connections, activeQrConnectionId],
  );

  const activeQrState = activeQrConnection?.qrStatus ?? (activeQrConnectionId ? "PREPARING" : "IDLE");

  const activeQrHeading =
    activeQrState === "CONNECTED"
      ? "WhatsApp conectado"
      : activeQrState === "QR_EXPIRED"
        ? "QR expirado"
        : activeQrState === "WAITING_QR_SCAN"
          ? "Escaneie agora"
          : activeQrState === "ERROR"
            ? "Falha ao gerar QR"
            : "Gerando QR do WhatsApp...";

  const activeQrDescription =
    activeQrConnection?.qrMessage
      ? activeQrConnection.qrMessage
      : activeQrState === "CONNECTED"
      ? "A conta foi autenticada com sucesso."
      : activeQrState === "QR_EXPIRED"
        ? "O QR expirou. Gere um novo código para continuar."
        : activeQrState === "WAITING_QR_SCAN"
          ? "Escaneie este QR Code no seu celular."
          : activeQrState === "ERROR"
            ? "Nao foi possivel gerar o QR. Tente novamente."
            : "Preparando um novo QR do WhatsApp...";

  useEffect(() => {
    if (!isTransientSchedulerInfo) {
      return;
    }

    const timer = window.setTimeout(() => {
      setSchedulerInfo("");
    }, 3200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isTransientSchedulerInfo]);

  useEffect(() => {
    if (connectionPlatform !== "instagram" || !connectionSecret) {
      return;
    }
    setConnectionSecret("");
  }, [connectionPlatform, connectionSecret]);

  useEffect(() => {
    if (!isTransientHistoryInfo) {
      return;
    }

    const timer = window.setTimeout(() => {
      setHistoryInfo("");
    }, 3200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isTransientHistoryInfo]);

  useEffect(() => {
    if (!isTransientMediaInfo) {
      return;
    }

    const timer = window.setTimeout(() => {
      setMediaInfo("");
    }, 3200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isTransientMediaInfo]);

  useEffect(() => {
    if (!isTransientAvisosInfo) {
      return;
    }

    const timer = window.setTimeout(() => {
      setAvisosInfo("");
    }, 3200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isTransientAvisosInfo]);

  useEffect(() => {
    if (!isTransientNoticeAdminInfo) {
      return;
    }

    const timer = window.setTimeout(() => {
      setNoticeAdminInfo("");
    }, 3200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isTransientNoticeAdminInfo]);

  useEffect(() => {
    if (activeView !== "media" && mediaInfo) {
      setMediaInfo("");
    }
  }, [activeView, mediaInfo]);

  useEffect(() => {
    if (activeView !== "notices" && avisosInfo) {
      setAvisosInfo("");
    }
  }, [activeView, avisosInfo]);

  useEffect(() => {
    if (activeView !== "noticeAdmin" && noticeAdminInfo) {
      setNoticeAdminInfo("");
    }
  }, [activeView, noticeAdminInfo]);

  useEffect(() => {
    if (!mediaInfo || typeof window === "undefined" || !mediaSectionRef.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      mediaSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [mediaInfo]);

  useEffect(() => {
    if (!noticesPopoverOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const clickedDesktopBell = noticesBellDesktopRef.current?.contains(target) ?? false;
      const clickedMobileBell = noticesBellMobileRef.current?.contains(target) ?? false;

      if (!clickedDesktopBell && !clickedMobileBell) {
        setNoticesPopoverOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNoticesPopoverOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [noticesPopoverOpen]);

  useEffect(() => {
    return () => {
      if (instagramOauthPopupPollRef.current !== null) {
        window.clearInterval(instagramOauthPopupPollRef.current);
        instagramOauthPopupPollRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleInstagramOauthMessage = (event: MessageEvent) => {
      const payload = parseInstagramOauthWindowMessage(event.data);
      if (!payload) {
        return;
      }

      if (instagramOauthPopupPollRef.current !== null) {
        window.clearInterval(instagramOauthPopupPollRef.current);
        instagramOauthPopupPollRef.current = null;
      }

      if (payload.success) {
        setError("");
        setAuthInfo(payload.message || "Conta conectada com sucesso.");
      } else {
        setAuthInfo("");
        setError(payload.message || "Falha ao concluir autorização do Instagram.");
      }

      void loadAll();
    };

    window.addEventListener("message", handleInstagramOauthMessage);
    return () => {
      window.removeEventListener("message", handleInstagramOauthMessage);
    };
  }, [selectedCompanyId, isRootUser]);

  useEffect(() => {
    if (!activeQrConnection) {
      return;
    }

    if (activeQrConnection.platform !== "whatsapp") {
      setActiveQrConnectionId(null);
      setQrRequestingConnectionId(null);
      return;
    }

    if (qrRequestingConnectionId === activeQrConnection.id) {
      return;
    }

    if (activeQrConnection.authStatus === "CONNECTED") {
      setActiveQrConnectionId(null);
      setQrRequestingConnectionId(null);
    }
  }, [activeQrConnection, qrRequestingConnectionId]);

  const filteredJobs = useMemo(
    () => jobs.filter((job) => (selectedCompanyId ? job.companyId === selectedCompanyId : true)),
    [jobs, selectedCompanyId],
  );

  const filteredLogs = useMemo(
    () => logs.filter((log) => (selectedCompanyId ? log.companyId === selectedCompanyId : true)),
    [logs, selectedCompanyId],
  );

  const filteredConnections = useMemo(
    () => connections.filter((connection) => (selectedCompanyId ? connection.companyId === selectedCompanyId : true)),
    [connections, selectedCompanyId],
  );

  const schedulerConnections = useMemo(() => {
    if (!publicationType) {
      return [];
    }
    const platform = isInstagramPublication(publicationType) ? "instagram" : "whatsapp";
    return connections.filter(
      (connection) =>
        connection.companyId === jobCompanyId &&
        connection.platform === platform &&
        (connection.authStatus === "CONNECTED" ||
          (connection.platform === "instagram" && connection.hasSecret && Boolean(connection.loginIdentifier))),
    );
  }, [connections, jobCompanyId, publicationType]);

  const mediaLibrary = useMemo(() => {
    const map = new Map<string, MediaEntry>();

    for (const job of filteredJobs) {
      if (job.publicationType === "whatsapp_status_texto") {
        continue;
      }

      const mediaPaths = (job.filePaths && job.filePaths.length > 0 ? job.filePaths : [job.filePath])
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0 && isSupportedMediaPath(entry));

      for (const mediaPath of mediaPaths) {
        const existing = map.get(mediaPath);
        if (!existing) {
          map.set(mediaPath, {
            filePath: mediaPath,
            companyId: job.companyId,
            previewUrl: `${api.baseUrl}${mediaPath}`,
            caption: job.caption,
            publicationType: job.publicationType,
            lastUsedAt: job.dataPostagem,
            usageCount: 1,
            lastStatus: job.status,
          });
          continue;
        }

        existing.usageCount += 1;
        if (new Date(job.dataPostagem).getTime() >= new Date(existing.lastUsedAt).getTime()) {
          existing.caption = job.caption;
          existing.publicationType = job.publicationType;
          existing.lastUsedAt = job.dataPostagem;
          existing.lastStatus = job.status;
        }
      }
    }

    return Array.from(map.values()).sort(
      (left, right) => new Date(right.lastUsedAt).getTime() - new Date(left.lastUsedAt).getTime(),
    );
  }, [filteredJobs]);

  const visibleNavItems = useMemo(
    () =>
      navItems.filter((item) => {
        if (item.key === "logs" || item.key === "noticeAdmin") {
          return isRootUser;
        }

        return true;
      }),
    [isRootUser],
  );

  const jobsOrderedByCreatedAtDesc = useMemo(
    () =>
      filteredJobs
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [filteredJobs],
  );

  const upcomingJobs = useMemo(() => {
    return jobsOrderedByCreatedAtDesc
      .filter(
        (job) =>
          !isPastScheduledAt(job.dataPostagem) &&
          (job.status === "PENDING" || job.status === "WAITING_LOGIN"),
      )
      .slice(0, 5);
  }, [jobsOrderedByCreatedAtDesc]);

  const canceledJobsPreview = useMemo(
    () => jobsOrderedByCreatedAtDesc.filter((job) => job.status === "CANCELED").slice(0, 5),
    [jobsOrderedByCreatedAtDesc],
  );

  const sentJobsPreview = useMemo(
    () =>
      jobsOrderedByCreatedAtDesc
        .filter((job) => job.status === "SENT_UNCONFIRMED" || job.status === "COMPLETED")
        .slice(0, 5),
    [jobsOrderedByCreatedAtDesc],
  );

  const failedJobsPreview = useMemo(
    () =>
      jobsOrderedByCreatedAtDesc
        .filter((job) => job.status === "FAILED" || job.status === "WAITING_LOGIN")
        .slice(0, 5),
    [jobsOrderedByCreatedAtDesc],
  );

  const historyAvailableYears = useMemo(
    () =>
      Array.from(new Set(jobsOrderedByCreatedAtDesc.map((job) => String(new Date(job.dataPostagem).getFullYear())))).sort(
        (left, right) => Number(right) - Number(left),
      ),
    [jobsOrderedByCreatedAtDesc],
  );

  const mediaAvailableYears = useMemo(
    () =>
      Array.from(new Set(mediaLibrary.map((media) => String(new Date(media.lastUsedAt).getFullYear())))).sort(
        (left, right) => Number(right) - Number(left),
      ),
    [mediaLibrary],
  );

  const historyFilteredJobs = useMemo(() => {
    const statusFilteredJobs = (() => {
      switch (historyFilter) {
        case "upcoming":
          return jobsOrderedByCreatedAtDesc.filter(
            (job) =>
              !isPastScheduledAt(job.dataPostagem) &&
              (job.status === "PENDING" || job.status === "WAITING_LOGIN"),
          );
        case "canceled":
          return jobsOrderedByCreatedAtDesc.filter((job) => job.status === "CANCELED");
        case "sent":
          return jobsOrderedByCreatedAtDesc.filter(
            (job) => job.status === "SENT_UNCONFIRMED" || job.status === "COMPLETED",
          );
        case "failed":
          return jobsOrderedByCreatedAtDesc.filter((job) => job.status === "FAILED" || job.status === "WAITING_LOGIN");
        case "all":
        default:
          return jobsOrderedByCreatedAtDesc;
      }
    })();

    return statusFilteredJobs.filter((job) => {
      const jobDate = new Date(job.dataPostagem);
      const monthMatches = historyMonthFilter === "all" || jobDate.getMonth() + 1 === Number(historyMonthFilter);
      const yearMatches = historyYearFilter === "all" || jobDate.getFullYear() === Number(historyYearFilter);
      return monthMatches && yearMatches;
    });
  }, [historyFilter, historyMonthFilter, historyYearFilter, jobsOrderedByCreatedAtDesc]);

  const mediaFilteredItems = useMemo(() => {
    const statusFilteredMedia = (() => {
      switch (mediaStatusFilter) {
        case "upcoming":
          return mediaLibrary.filter(
            (media) => media.lastStatus === "PENDING" || media.lastStatus === "WAITING_LOGIN" || media.lastStatus === "RUNNING",
          );
        case "canceled":
          return mediaLibrary.filter((media) => media.lastStatus === "CANCELED");
        case "sent":
          return mediaLibrary.filter((media) => media.lastStatus === "SENT_UNCONFIRMED" || media.lastStatus === "COMPLETED");
        case "failed":
          return mediaLibrary.filter((media) => media.lastStatus === "FAILED" || media.lastStatus === "WAITING_LOGIN");
        case "all":
        default:
          return mediaLibrary;
      }
    })();

    return statusFilteredMedia.filter((media) => {
      const mediaDate = new Date(media.lastUsedAt);
      const monthMatches = mediaMonthFilter === "all" || mediaDate.getMonth() + 1 === Number(mediaMonthFilter);
      const yearMatches = mediaYearFilter === "all" || mediaDate.getFullYear() === Number(mediaYearFilter);
      return monthMatches && yearMatches;
    });
  }, [mediaStatusFilter, mediaMonthFilter, mediaYearFilter, mediaLibrary]);

  const historyTotalPages = useMemo(
    () => Math.max(1, Math.ceil(historyFilteredJobs.length / HISTORY_PAGE_SIZE)),
    [historyFilteredJobs.length],
  );

  const mediaTotalPages = useMemo(
    () => Math.max(1, Math.ceil(mediaFilteredItems.length / MEDIA_PAGE_SIZE)),
    [mediaFilteredItems.length],
  );

  const paginatedHistoryJobs = useMemo(
    () => historyFilteredJobs.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE),
    [historyFilteredJobs, historyPage],
  );

  const paginatedMediaItems = useMemo(
    () => mediaFilteredItems.slice((mediaPage - 1) * MEDIA_PAGE_SIZE, mediaPage * MEDIA_PAGE_SIZE),
    [mediaFilteredItems, mediaPage],
  );

  async function loadAll(): Promise<void> {
    try {
      const companyFilter = selectedCompanyId ? `?companyId=${selectedCompanyId}` : "";
      const logsPromise = isRootUser ? api.get<Log[]>(`/logs${companyFilter}`) : Promise.resolve<Log[]>([]);
      const [organizationsData, companiesData, connectionsData, jobsData, logsData, dashboardData] =
        await Promise.all([
          api.get<Organization[]>("/organizations"),
          api.get<Company[]>("/companies"),
          api.get<SocialConnection[]>(`/connections${companyFilter}`),
          api.get<Job[]>(`/jobs${companyFilter}`),
          logsPromise,
          api.get<Dashboard>(`/dashboard${companyFilter}`),
        ]);

      setOrganizations(organizationsData);
      setCompanies(companiesData);
      setConnections(connectionsData);
      setJobs(jobsData);
      setLogs(logsData);
      setDashboard(dashboardData);

      const firstCompany = companiesData[0];
      if (firstCompany) {
        setCompanyOrganizationId((current) => current || firstCompany.organizationId);
        setConnectionCompanyId((current) => current || firstCompany.id);
      }

      setError("");
    } catch (loadError) {
      if (loadError instanceof Error && loadError.message.includes("Sessao invalida")) {
        api.setSessionToken("");
        setAuthUser(null);
        setAuthError("Sua sessão expirou. Faça login novamente.");
        return;
      }

      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar dados.");
    }
  }

  async function loadAvisosPage(page: number): Promise<void> {
    try {
      const result = await api.get<{
        items: Aviso[];
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
      }>(`/avisos?page=${page}&pageSize=${NOTICE_PAGE_SIZE}`);

      setAvisos(result.items);
      setAvisosTotal(result.total);
      setAvisosTotalPages(result.totalPages);
      setAvisosPage(result.page);
      setError("");
    } catch (loadAvisosError) {
      setError(loadAvisosError instanceof Error ? loadAvisosError.message : "Falha ao carregar avisos.");
    }
  }

  async function refreshLiveData(): Promise<void> {
    try {
      const companyFilter = selectedCompanyId ? `?companyId=${selectedCompanyId}` : "";
      const logsPromise =
        isRootUser && activeView === "logs"
          ? api.get<Log[]>(`/logs${companyFilter}`)
          : Promise.resolve<Log[] | null>(null);

      const [connectionsData, jobsData, dashboardData, logsData] = await Promise.all([
        api.get<SocialConnection[]>(`/connections${companyFilter}`),
        api.get<Job[]>(`/jobs${companyFilter}`),
        api.get<Dashboard>(`/dashboard${companyFilter}`),
        logsPromise,
      ]);

      setConnections(connectionsData);
      setJobs(jobsData);
      setDashboard(dashboardData);

      if (logsData) {
        setLogs(logsData);
      }
    } catch {
      // polling silencioso: não suja a UI com erros transitórios de rede/API
    }
  }

  useEffect(() => {
    const bootstrapAuth = async () => {
      try {
        if (setupKey) {
          await api.get<{ valid: true }>(`/auth/setup-access?key=${encodeURIComponent(setupKey)}`);
          setSetupInviteValid(true);
        }
      } catch {
        setSetupInviteValid(false);
        if (setupKey) {
          setAuthError("A chave de cadastro informada ja foi usada ou nao e valida.");
        }
      }

      const sessionToken = api.getSessionToken();

      if (!sessionToken) {
        setAuthChecked(true);
        return;
      }

      try {
        const response = await api.get<{ user: AuthUser }>("/auth/me");
        setAuthUser(response.user);
      } catch {
        api.setSessionToken("");
      } finally {
        setAuthChecked(true);
      }
    };

    void bootstrapAuth();
  }, [setupKey]);

  useEffect(() => {
    if (!authUser) {
      setUnreadAvisosCount(0);
      setRecentAvisos([]);
      return;
    }

    void loadAll();
  }, [selectedCompanyId, authUser]);

  useEffect(() => {
    if (!authUser || activeView === "agents" || activeView === "notices") {
      return;
    }

    let cancelled = false;

    const tick = async () => {
      if (cancelled || document.visibilityState !== "visible") {
        return;
      }
      await refreshLiveData();
    };

    void tick();

    const intervalId = window.setInterval(() => {
      void tick();
    }, 5000);

    const handleVisibilityChange = () => {
      void tick();
    };

    const handleFocus = () => {
      void tick();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [authUser, activeView, selectedCompanyId, isRootUser]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    let cancelled = false;

    const refreshUnreadCount = async () => {
      try {
        const result = await api.get<{ count: number }>("/avisos/unread-count");
        if (!cancelled) {
          setUnreadAvisosCount(result.count);
        }
      } catch {
        // Mantém o contador atual quando há erro transitório de rede/API.
      }
    };

    void refreshUnreadCount();

    const intervalId = window.setInterval(() => {
      void refreshUnreadCount();
    }, 5000);

    const handleVisibilityChange = () => {
      void refreshUnreadCount();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [authUser]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    setProfileName(authUser.name);
    setProfileUsername(authUser.username);
    setProfilePassword("");
  }, [authUser]);

  useEffect(() => {
    if (!authUser || activeView !== "agents") {
      return;
    }

    let cancelled = false;

    const tick = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        void loadAll();
      }
    };

    const intervalId = window.setInterval(tick, 3000);

    const handleVisibilityChange = () => {
      tick();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeView, selectedCompanyId, authUser]);

  useEffect(() => {
    if (!authUser || activeView !== "notices") {
      return;
    }

    let cancelled = false;

    const refreshAvisosPage = () => {
      if (cancelled) {
        return;
      }
      void loadAvisosPage(avisosPage);
    };

    refreshAvisosPage();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshAvisosPage();
      }
    }, 5000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshAvisosPage();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeView, avisosPage, authUser]);

  useEffect(() => {
    if (schedulerConnections.length === 0) {
      setJobSocialConnectionId("");
      return;
    }

    setJobSocialConnectionId((current) => {
      if (current && schedulerConnections.some((connection) => connection.id === current)) {
        return current;
      }

      return schedulerConnections[0]?.id ?? "";
    });
  }, [schedulerConnections]);

  useEffect(() => {
    if (publicationType !== "instagram_post" && publicationType !== "instagram_story" && uploadedSchedulerMedia.length > 1) {
      setUploadedSchedulerMedia((current) => current.slice(0, 1));
      setDraggingSchedulerMediaIndex(null);
    }
  }, [publicationType, uploadedSchedulerMedia.length]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(REMEMBER_ME_STORAGE_KEY, String(rememberMe));

    if (!rememberMe) {
      window.localStorage.removeItem(REMEMBERED_USERNAME_STORAGE_KEY);
    }
  }, [rememberMe]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handlePopState = () => {
      const nextView = initialViewFromLocation();
      const nextHistoryFilter = parseHistoryFilterKey(readSearchParam(HISTORY_FILTER_QUERY_PARAM));

      setActiveView(nextView);
      setHistoryFilter(nextHistoryFilter);

      if (nextView === "history") {
        setHistoryMonthFilter("all");
        setHistoryYearFilter("all");
        setHistoryPage(1);
      }

      if (nextView === "notices") {
        setAvisosPage(1);
      }

      setNoticesPopoverOpen(false);
      setSidebarOpen(false);
      window.scrollTo({ top: 0, behavior: "auto" });
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!authUser) {
      return;
    }

    const url = new URL(window.location.href);
    url.pathname = VIEW_ROUTE_MAP[activeView] ?? VIEW_ROUTE_MAP.dashboard;
    url.searchParams.delete(LEGACY_HISTORY_VIEW_QUERY_PARAM);

    if (activeView !== "history" || historyFilter === "all") {
      url.searchParams.delete(HISTORY_FILTER_QUERY_PARAM);
    } else {
      url.searchParams.set(HISTORY_FILTER_QUERY_PARAM, historyFilter);
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState({}, "", nextUrl);
    }
  }, [activeView, historyFilter, authUser]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historyFilter, historyMonthFilter, historyYearFilter, selectedCompanyId]);

  useEffect(() => {
    setMediaPage(1);
  }, [mediaStatusFilter, mediaMonthFilter, mediaYearFilter, selectedCompanyId]);

  useEffect(() => {
    setHistoryPage((current) => Math.min(Math.max(current, 1), historyTotalPages));
  }, [historyTotalPages]);

  useEffect(() => {
    setMediaPage((current) => Math.min(Math.max(current, 1), mediaTotalPages));
  }, [mediaTotalPages]);

  useEffect(() => {
    setAvisosPage((current) => Math.min(Math.max(current, 1), avisosTotalPages));
  }, [avisosTotalPages]);

  useEffect(() => {
    const pendingPreviewGeneration = paginatedMediaItems.filter(
      (media) => !isVideoPath(media.filePath) && !mediaPreviewPlaceholderByPath[media.filePath],
    );

    if (pendingPreviewGeneration.length === 0) {
      return;
    }

    let cancelled = false;

    const generatePreviews = async () => {
      for (const media of pendingPreviewGeneration) {
        try {
          const lowQualityPreview = await buildLowQualityPreviewDataUrl(media.previewUrl);
          if (cancelled) {
            return;
          }

          setMediaPreviewPlaceholderByPath((current) => {
            if (current[media.filePath]) {
              return current;
            }

            return {
              ...current,
              [media.filePath]: lowQualityPreview,
            };
          });
        } catch {
          if (cancelled) {
            return;
          }
        }
      }
    };

    void generatePreviews();

    return () => {
      cancelled = true;
    };
  }, [paginatedMediaItems, mediaPreviewPlaceholderByPath]);

  async function createOrganization(event: FormEvent) {
    event.preventDefault();
    await api.postJson("/organizations", { name: organizationName });
    setOrganizationName("");
    await loadAll();
  }

  async function createCompany(event: FormEvent) {
    event.preventDefault();
    await api.postJson("/companies", { name: companyName, organizationId: companyOrganizationId });
    setCompanyName("");
    await loadAll();
  }

  async function deleteOrganization(organizationId: string) {
    await api.delete(`/organizations/${organizationId}`);
    await loadAll();
  }

  async function createConnection(event: FormEvent) {
    event.preventDefault();
    await api.postJson("/connections", {
      companyId: connectionCompanyId,
      platform: connectionPlatform,
      displayName: connectionDisplayName,
      loginIdentifier: connectionLoginIdentifier || null,
      secret: connectionSecret || null,
    });
    setConnectionDisplayName("");
    setConnectionLoginIdentifier("");
    setConnectionSecret("");
    await loadAll();
  }

  async function openConnectionVisualAuth(connectionId: string) {
    const connection = connections.find((entry) => entry.id === connectionId);
    const isWhatsappConnection = connection?.platform === "whatsapp";
    let oauthTab: Window | null = null;

    if (!isWhatsappConnection) {
      oauthTab = window.open("about:blank", "_blank");
      if (!oauthTab) {
        setError("Não foi possível abrir a aba de autorização. Libere popups no navegador e tente novamente.");
        return;
      }
      oauthTab.focus();
    }

    if (isWhatsappConnection) {
      setActiveQrConnectionId(connectionId);
      setQrRequestingConnectionId(connectionId);
    }

    try {
      const result = await api.postJson<{ launchUrl?: string }>(
        "/connections/" + connectionId + "/open-visual-auth",
        {},
      );
      await loadAll();
      setError("");
      if (isWhatsappConnection) {
        return;
      }

      if (!result.launchUrl) {
        if (oauthTab && !oauthTab.closed) {
          oauthTab.close();
        }
        setError("A URL de autorização do Instagram não foi retornada pelo backend.");
        return;
      }

      if (oauthTab && !oauthTab.closed) {
        oauthTab.location.href = result.launchUrl;
        oauthTab.focus();
      } else {
        oauthTab = window.open(result.launchUrl, "_blank");
        if (!oauthTab) {
          setError("Não foi possível abrir a aba de autorização. Libere popups no navegador e tente novamente.");
          return;
        }
        oauthTab.focus();
      }
      setAuthInfo("Finalize a autorização na aba da Meta. O painel será atualizado quando ela for fechada.");

      if (instagramOauthPopupPollRef.current !== null) {
        window.clearInterval(instagramOauthPopupPollRef.current);
        instagramOauthPopupPollRef.current = null;
      }

      instagramOauthPopupPollRef.current = window.setInterval(() => {
        if (!oauthTab || !oauthTab.closed) {
          return;
        }
        if (instagramOauthPopupPollRef.current !== null) {
          window.clearInterval(instagramOauthPopupPollRef.current);
          instagramOauthPopupPollRef.current = null;
        }
        void loadAll();
      }, 900);
    } catch (error) {
      if (!isWhatsappConnection && oauthTab && !oauthTab.closed) {
        oauthTab.close();
      }
      setError(error instanceof Error ? error.message : "Falha ao iniciar a autorização.");
    } finally {
      if (isWhatsappConnection) {
        setQrRequestingConnectionId((current) => (current === connectionId ? null : current));
      }
    }
  }

  async function regenerateConnectionQr(connectionId: string) {
    setActiveQrConnectionId(connectionId);
    setQrRequestingConnectionId(connectionId);
    try {
      await api.postJson(`/connections/${connectionId}/regenerate-qr`, {});
      await loadAll();
      setError("");
    } finally {
      setQrRequestingConnectionId((current) => (current === connectionId ? null : current));
    }
  }

  async function dismissConnectionQr(connectionId: string) {
    setActiveQrConnectionId((current) => (current === connectionId ? null : current));
    setQrRequestingConnectionId((current) => (current === connectionId ? null : current));
  }

  async function cancelConnectionQr(connectionId: string) {
    setActiveQrConnectionId((current) => (current === connectionId ? null : current));
    setQrRequestingConnectionId((current) => (current === connectionId ? null : current));
    await api.postJson(`/connections/${connectionId}/dismiss-qr`, {});
    await loadAll();
    setError("");
  }

  async function disconnectConnection(connectionId: string) {
    await api.postJson(`/connections/${connectionId}/disconnect`, {});
    await loadAll();
  }

  async function deleteConnection(connectionId: string) {
    await api.delete(`/connections/${connectionId}`);
    await loadAll();
  }

  async function uploadSelectedMedia(files: File[]) {
    if (files.length === 0) {
      return;
    }

    const selectedFiles = supportsMultiMediaUpload ? files : [files[0]!];
    if (supportsMultiMediaUpload) {
      const totalAfterUpload = uploadedSchedulerMedia.length + selectedFiles.length;
      if (totalAfterUpload > INSTAGRAM_MULTI_MEDIA_MAX_FILES) {
        setError("");
        setSchedulerInfo(`Você pode enviar até ${INSTAGRAM_MULTI_MEDIA_MAX_FILES} mídias por publicação.`);
        schedulerMediaInputRef.current?.focus();
        return;
      }
    }

    const uploadedBatch: SchedulerUploadedMedia[] = [];

    setUploading(true);
    setError("");
    setSchedulerInfo("Enviando mídia...");
    try {
      for (const file of selectedFiles) {
        const validationMessage = schedulerMediaValidationMessage(publicationType, file.name, file.size);
        if (validationMessage) {
          throw new Error(validationMessage);
        }

        const advancedValidationMessage = await schedulerMediaAdvancedValidationMessage(publicationType, file);
        if (advancedValidationMessage) {
          throw new Error(advancedValidationMessage);
        }

        const result = await api.postFile("/upload", file);
        uploadedBatch.push({
          filePath: result.filePath,
          fileName: file.name,
          fileSizeBytes: file.size,
        });
      }

      setUploadedSchedulerMedia((current) => {
        const base = supportsMultiMediaUpload ? current : [];
        const merged = [...base, ...uploadedBatch];
        const seen = new Set<string>();
        return merged.filter((item) => {
          if (seen.has(item.filePath)) {
            return false;
          }
          seen.add(item.filePath);
          return true;
        });
      });

      setSchedulerInfo(
        uploadedBatch.length > 1
          ? `${uploadedBatch.length} mídias enviadas com sucesso.`
          : "Midia enviada com sucesso.",
      );
    } catch (uploadError) {
      setError("");
      setSchedulerInfo(uploadError instanceof Error ? uploadError.message : "Falha no upload.");
      if (schedulerMediaInputRef.current) {
        schedulerMediaInputRef.current.focus();
      }
      return;
    } finally {
      if (schedulerMediaInputRef.current) {
        schedulerMediaInputRef.current.value = "";
      }
      setUploading(false);
      setUploadDragActive(false);
    }
  }

  function removeSchedulerUploadedMedia(filePath: string) {
    setUploadedSchedulerMedia((current) => current.filter((item) => item.filePath !== filePath));
  }

  function reorderSchedulerUploadedMedia(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) {
      return;
    }

    setUploadedSchedulerMedia((current) => {
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= current.length || toIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) {
        return current;
      }
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  function handleSchedulerMediaThumbDragStart(index: number) {
    setDraggingSchedulerMediaIndex(index);
  }

  function handleSchedulerMediaThumbDragEnd() {
    setDraggingSchedulerMediaIndex(null);
  }

  function handleSchedulerMediaThumbDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  function handleSchedulerMediaThumbDrop(index: number, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (draggingSchedulerMediaIndex === null) {
      return;
    }
    reorderSchedulerUploadedMedia(draggingSchedulerMediaIndex, index);
    setDraggingSchedulerMediaIndex(null);
  }

  async function uploadMedia(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    await uploadSelectedMedia(files);
  }

  async function handleSchedulerMediaDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setUploadDragActive(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    await uploadSelectedMedia(files);
  }

  function handleSchedulerMediaDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (!submittingJob && !uploading) {
      setUploadDragActive(true);
    }
  }

  function handleSchedulerMediaDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setUploadDragActive(false);
  }

  function openSchedulerMediaPicker() {
    if (!submittingJob && !uploading) {
      schedulerMediaInputRef.current?.click();
    }
  }

  async function createJob(event: FormEvent) {
    event.preventDefault();
    if (!publicationType) {
      return;
    }

    const normalizedTitle = postTitle.trim();
    if (!normalizedTitle) {
      setError("");
      setSchedulerInfo("Preencha o título da postagem.");
      return;
    }

    if (requiresMediaUpload && uploadedSchedulerMedia.length === 0) {
      setError("");
      setSchedulerInfo("Envie uma mídia antes de agendar este tipo de postagem.");
      schedulerMediaInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      schedulerMediaInputRef.current?.focus();
      return;
    }

    if (
      (publicationType === "instagram_post" || publicationType === "instagram_story") &&
      uploadedSchedulerMedia.length > INSTAGRAM_MULTI_MEDIA_MAX_FILES
    ) {
      setError("");
      setSchedulerInfo(`Você pode enviar até ${INSTAGRAM_MULTI_MEDIA_MAX_FILES} mídias por publicação.`);
      return;
    }

    if (requiresMediaUpload && uploadedFileName) {
      const validationMessage = schedulerMediaValidationMessage(publicationType, uploadedFileName, uploadedFileSizeBytes);
      if (validationMessage) {
        setError("");
        setSchedulerInfo(validationMessage);
        schedulerMediaInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        schedulerMediaInputRef.current?.focus();
        return;
      }
    }

    setSubmittingJob(true);
    setError("");
    setSchedulerInfo(editingJobId ? "Salvando alterações..." : "Agendando postagem...");

    const fallbackTime = getCurrentTimeValue();
    const effectiveTime = !scheduledTimeTouched ? fallbackTime : scheduledTime || fallbackTime;
    const effectiveDateTime = `${scheduledDate}T${effectiveTime}`;
    const effectiveLocationId =
      requiresInstagramMetadata
        ? (isInstagramForcedLocationEnabled ? instagramForcedLocationId : null)
        : null;
    const effectiveLocationName =
      requiresInstagramMetadata
        ? (isInstagramForcedLocationEnabled ? instagramForcedLocationName : null)
        : null;
    const effectiveCaption = publicationType === "instagram_story" ? null : caption;

    const payload = {
      companyId: jobCompanyId,
      socialConnectionId: jobSocialConnectionId,
      filePath: uploadedFilePath,
      filePaths: uploadedSchedulerMedia.map((item) => item.filePath),
      sequential: effectiveSequentialPublishing,
      title: normalizedTitle,
      caption: effectiveCaption,
      locationName: effectiveLocationName,
      locationId: effectiveLocationId,
      publicationType,
      dataPostagem: new Date(effectiveDateTime).toISOString(),
    };

    try {
      if (editingJobId) {
        await api.putJson(`/jobs/${editingJobId}`, payload);
      } else {
        await api.postJson("/jobs", payload);
      }

      resetSchedulerForm();
      setSchedulerInfo(editingJobId ? "Postagem atualizada com sucesso." : "Postagem agendada com sucesso.");
      await loadAll();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (jobError) {
      setError(jobError instanceof Error ? jobError.message : "Falha ao agendar postagem.");
      setSchedulerInfo("");
    } finally {
      setSubmittingJob(false);
    }
  }

  function resetSchedulerForm() {
    setPostTitle("");
    setCaption("");
    setUploadedSchedulerMedia([]);
    setDraggingSchedulerMediaIndex(null);
    setUploadDragActive(false);
    setJobCompanyId("");
    setJobSocialConnectionId("");
    setScheduledDate("");
    setScheduledTime(getCurrentTimeValue());
    setScheduledTimeTouched(false);
    setPublicationType("");
    setEditingJobId(null);
    if (schedulerMediaInputRef.current) {
      schedulerMediaInputRef.current.value = "";
    }
  }

  function startEditJob(job: Job) {
    setSchedulerInfo("");
    setEditingJobId(job.id);
    setJobCompanyId(job.companyId);
    setJobSocialConnectionId(job.socialConnectionId ?? "");
    const selectedFiles = (job.filePaths && job.filePaths.length > 0 ? job.filePaths : [job.filePath])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    setUploadedSchedulerMedia(
      selectedFiles.map((filePath) => ({
        filePath,
        fileName: filePath.split("/").pop() ?? "",
        fileSizeBytes: null,
      })),
    );
    setDraggingSchedulerMediaIndex(null);
    setPostTitle(job.title?.trim() || job.caption?.trim() || "");
    setCaption(job.caption ?? "");
    setPublicationType(job.publicationType);
    setScheduledDate(toDateLocal(job.dataPostagem));
    setScheduledTime(toTimeLocal(job.dataPostagem));
    setScheduledTimeTouched(true);
    setActiveView("scheduler");
  }

  async function deleteJob(jobId: string) {
    await api.delete(`/jobs/${jobId}`);
    if (editingJobId === jobId) {
      resetSchedulerForm();
    }
    await loadAll();
  }

  async function deleteMediaFile(media: MediaEntry) {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Excluir esta mídia da pasta uploads? Essa ação não pode ser desfeita.");
      if (!confirmed) {
        return;
      }
    }

    try {
      setError("");
      setMediaInfo("");
      await api.delete(`/upload?filePath=${encodeURIComponent(media.filePath)}`);

      setUploadedSchedulerMedia((current) => current.filter((item) => item.filePath !== media.filePath));

      setLoadedMediaPreviewByPath((current) => {
        if (!current[media.filePath]) {
          return current;
        }

        const next = { ...current };
        delete next[media.filePath];
        return next;
      });
      setMediaPreviewPlaceholderByPath((current) => {
        if (!current[media.filePath]) {
          return current;
        }

        const next = { ...current };
        delete next[media.filePath];
        return next;
      });

      await loadAll();
      setMediaInfo("Mídia excluída com sucesso.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Falha ao excluir mídia.");
      setMediaInfo("");
    }
  }

  function markMediaPreviewLoaded(filePath: string) {
    setLoadedMediaPreviewByPath((current) => {
      if (current[filePath]) {
        return current;
      }
      return {
        ...current,
        [filePath]: true,
      };
    });
  }

  async function toggleJobSchedule(job: Job) {
    const isActivating = job.status === "CANCELED";

    if (
      isActivating &&
      isPastScheduledAt(job.dataPostagem) &&
      !window.confirm(
        "Este agendamento ja passou. Se ativar agora, a postagem sera publicada imediatamente. Para ter mais controle, edite a data e o horario. Deseja continuar?",
      )
    ) {
      return;
    }

    if (!isActivating && !window.confirm("Deseja cancelar este agendamento?")) {
      return;
    }

    setError("");
    setTogglingScheduleJobId(job.id);
    setHistoryInfo("Atualizando agendamento...");

    try {
      await api.postJson(`/jobs/${job.id}/${isActivating ? "activate" : "cancel"}`, {});
      setHistoryInfo(isActivating ? "Agendamento ativado com sucesso." : "Agendamento cancelado com sucesso.");
      await loadAll();
    } catch (toggleError) {
      setHistoryInfo("");
      setError(toggleError instanceof Error ? toggleError.message : "Falha ao atualizar o agendamento.");
    } finally {
      setTogglingScheduleJobId(null);
    }
  }

  function openHistoryWithFilter(filter: HistoryFilterKey): void {
    navigateToView("history", { historyFilter: filter });
  }

  async function toggleNoticesPopover() {
    if (noticesPopoverOpen) {
      setNoticesPopoverOpen(false);
      return;
    }

    setNoticesPopoverOpen(true);
    setNoticesPopoverLoading(true);
    setError("");

    try {
      const recent = await api.get<{ items: Aviso[]; unreadCount: number }>("/avisos/recent?limit=5");
      setRecentAvisos(recent.items);
      setUnreadAvisosCount(recent.unreadCount);
    } catch (noticesError) {
      setError(noticesError instanceof Error ? noticesError.message : "Falha ao atualizar avisos.");
    } finally {
      setNoticesPopoverLoading(false);
    }
  }

  async function markAllAvisosAsRead() {
    setMarkingAllAvisosRead(true);
    setError("");

    try {
      await api.postJson<{ updated: number }>("/avisos/mark-all-read", {});
      const recent = await api.get<{ items: Aviso[]; unreadCount: number }>("/avisos/recent?limit=5");
      setRecentAvisos(recent.items);
      setUnreadAvisosCount(recent.unreadCount);

      if (activeView === "notices") {
        await loadAvisosPage(avisosPage);
      }
    } catch (noticesError) {
      setError(noticesError instanceof Error ? noticesError.message : "Falha ao marcar avisos como lidos.");
    } finally {
      setMarkingAllAvisosRead(false);
    }
  }

  function openAvisosView() {
    setNoticesPopoverOpen(false);
    navigateToView("notices");
  }

  async function createBroadcastAviso(event: FormEvent) {
    event.preventDefault();
    setBroadcastAvisoSubmitting(true);
    setError("");
    setNoticeAdminInfo("");

    try {
      const payload = {
        title: broadcastAvisoTitle,
        message: broadcastAvisoMessage,
      };
      const result = await api.postJson<{ created: number }>("/avisos/broadcast", payload);
      setBroadcastAvisoTitle("");
      setBroadcastAvisoMessage("");
      setNoticeAdminInfo(
        result.created > 0
          ? "Aviso enviado com sucesso."
          : "Nenhum usuário encontrado para receber o aviso.",
      );
      await loadAll();
      if (activeView === "notices") {
        await loadAvisosPage(avisosPage);
      }
      try {
        const unread = await api.get<{ count: number }>("/avisos/unread-count");
        setUnreadAvisosCount(unread.count);
        if (noticesPopoverOpen) {
          const recent = await api.get<{ items: Aviso[]; unreadCount: number }>("/avisos/recent?limit=5");
          setRecentAvisos(recent.items);
          setUnreadAvisosCount(recent.unreadCount);
        }
      } catch {
        // Mantém o feedback de sucesso mesmo se a atualização do sino falhar.
      }
    } catch (createAvisoError) {
      setError(createAvisoError instanceof Error ? createAvisoError.message : "Falha ao enviar aviso.");
    } finally {
      setBroadcastAvisoSubmitting(false);
    }
  }

  async function retryJob(jobId: string) {
    setError("");
    setRetryingJobId(jobId);
    setHistoryInfo("Reenfileirando postagem...");
    try {
      await api.postJson(`/jobs/${jobId}/retry`, {});
      setHistoryInfo("Postagem reenfileirada para tentativa imediata.");
      await loadAll();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (retryError) {
      setHistoryInfo("");
      setError(retryError instanceof Error ? retryError.message : "Falha ao reenfileirar a postagem.");
    } finally {
      setRetryingJobId(null);
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setAuthError("");
    setAuthSubmitting(true);

    try {
      const result = await api.postJson<{ sessionToken: string; user: AuthUser }>("/auth/login", {
        username: loginUsername,
        password: loginPassword,
      });

      api.setSessionToken(result.sessionToken, rememberMe);
      if (rememberMe) {
        window.localStorage.setItem(REMEMBERED_USERNAME_STORAGE_KEY, loginUsername);
      } else {
        window.localStorage.removeItem(REMEMBERED_USERNAME_STORAGE_KEY);
      }
      setAuthUser(result.user);
      setLoginPassword("");
      setAuthInfo("");
      navigateToView("dashboard");
    } catch (loginError) {
      setAuthError(loginError instanceof Error ? loginError.message : "Falha ao fazer login.");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function logout() {
    try {
      await api.postJson<void>("/auth/logout", {});
    } catch {
      // ignore logout cleanup errors
    } finally {
      api.setSessionToken("");
      setAuthUser(null);
      setAuthChecked(true);
      setError("");
      setAuthInfo("");
      setAuthError("");
      setNoticesPopoverOpen(false);
      setActiveView("dashboard");
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", "/");
      }
    }
  }

  async function createUserFromSetup(event: FormEvent) {
    event.preventDefault();
    setAuthError("");

    try {
      await api.postJson("/auth/setup-access", {
        key: setupKey,
        name: setupName,
        username: setupUsername,
        password: setupPassword,
      });

      setSetupInviteValid(false);
      setSetupKey("");
      setSetupName("");
      setSetupPassword("");
      setAuthInfo("Novo usuario criado com sucesso.");
      setLoginUsername(setupUsername);
      setSetupUsername("");

      const url = new URL(window.location.href);
      url.searchParams.delete("setupKey");
      window.history.replaceState({}, "", url.toString());
    } catch (setupError) {
      setAuthError(setupError instanceof Error ? setupError.message : "Falha ao criar usuario.");
    }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setError("");

    try {
      const result = await api.putJson<{ user: AuthUser }>("/auth/profile", {
        name: profileName,
        username: profileUsername,
        password: profilePassword,
      });

      setAuthUser(result.user);
      setProfilePassword("");
      setAuthInfo("Perfil salvo com sucesso.");
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : "Falha ao salvar perfil.");
    }
  }

  function reuseMedia(media: MediaEntry) {
    setMediaInfo("");
    setSchedulerInfo("");
    setError("");
    setEditingJobId(null);
    setUploadedSchedulerMedia([
      {
        filePath: media.filePath,
        fileName: media.filePath.split("/").pop() ?? "",
        fileSizeBytes: null,
      },
    ]);
    setDraggingSchedulerMediaIndex(null);
    setPublicationType(media.publicationType);
    setJobCompanyId("");
    setJobSocialConnectionId("");
    setPostTitle("");
    setCaption("");
    setScheduledDate("");
    setScheduledTime(getCurrentTimeValue());
    setScheduledTimeTouched(false);
    setActiveView("scheduler");

    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
      });
    }
  }

  function appendEmojiToCaption(emoji: string) {
    setCaption((current) => `${current}${emoji}`);
  }

  function renderNoticesBell(shellRef: { current: HTMLDivElement | null }, extraClassName = "") {
    return (
      <div ref={shellRef} className={`notices-shell${extraClassName ? ` ${extraClassName}` : ""}`}>
        <button
          type="button"
          className={`notices-trigger${noticesPopoverOpen ? " notices-trigger-active" : ""}`}
          onClick={() => void toggleNoticesPopover()}
          aria-label="Abrir avisos"
        >
          <FiBell />
          {unreadAvisosCount > 0 ? (
            <span className="notices-badge">{unreadAvisosCount > 99 ? "99+" : unreadAvisosCount}</span>
          ) : null}
        </button>

        {noticesPopoverOpen ? (
          <section className="notices-popover">
            <div className="notices-popover-header">
              <strong>Avisos</strong>
              <div className="notices-popover-meta">
                <span>{`${unreadAvisosCount} não lido(s)`}</span>
                <button
                  type="button"
                  className="notices-mark-read-inline"
                  onClick={() => void markAllAvisosAsRead()}
                  disabled={markingAllAvisosRead || noticesPopoverLoading || unreadAvisosCount === 0}
                >
                  {markingAllAvisosRead ? "Marcando..." : "Marcar como lido"}
                </button>
              </div>
            </div>

            <div className="notices-popover-list">
              {noticesPopoverLoading ? (
                <div className="empty-state">Carregando avisos...</div>
              ) : recentAvisos.length === 0 ? (
                <div className="empty-state">Nenhum aviso recente.</div>
              ) : (
                recentAvisos.map((aviso) => (
                  <article key={aviso.id} className={`notice-popover-item ${avisoToneClass(aviso.kind)}`}>
                    <strong>{aviso.title}</strong>
                    <span>{aviso.message}</span>
                    <small>{formatDate(aviso.createdAt)}</small>
                  </article>
                ))
              )}
            </div>

            <div className="notices-popover-actions">
              <button type="button" className="ghost-button notices-view-all" onClick={openAvisosView}>
                Ver todos
              </button>
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  function renderAuthScreen() {
    const showSetup = Boolean(setupKey) && setupInviteValid;

    return (
      <div className="auth-shell">
        <div className="auth-logo">
          <img src={appLogo} alt="SocialUp" className="brand-logo auth-brand-logo" />
        </div>

        {showSetup ? (
          <>
            <div className="auth-setup-copy">
              <h1>Criar novo usuário</h1>
              <p>
                Esta chave de cadastro é de uso único. Depois que o usuário for criado, esse link não poderá ser
                reutilizado.
              </p>
            </div>

            <section className="auth-panel-clean auth-panel-wide">
              {authError ? <div className="error-banner">{authError}</div> : null}
              {authInfo ? <div className={`info-banner${isPositiveAuthInfo ? " info-banner-success" : ""}`}>{authInfo}</div> : null}

              <form onSubmit={createUserFromSetup} className="form-stack">
                <input
                  value={setupName}
                  onChange={(event) => setSetupName(event.target.value)}
                  placeholder="Nome completo"
                  required
                  minLength={2}
                  maxLength={80}
                  title="Informe o nome completo do novo usuario."
                />
                <input
                  value={setupUsername}
                  onChange={(event) => setSetupUsername(event.target.value)}
                  placeholder="Usuário"
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="^[a-zA-Z0-9._-]+$"
                  title="Use apenas letras, numeros, ponto, traco ou underscore."
                />
                <input
                  type="password"
                  value={setupPassword}
                  onChange={(event) => setSetupPassword(event.target.value)}
                  placeholder="Senha"
                  required
                  minLength={8}
                  maxLength={128}
                  title="Defina uma senha com pelo menos 8 caracteres."
                />
                <button type="submit">Criar usuário</button>
              </form>
            </section>
          </>
        ) : (
          <section className="auth-panel-clean">
            {authError ? <div className="error-banner">{authError}</div> : null}
            {authInfo ? <div className={`info-banner${isPositiveAuthInfo ? " info-banner-success" : ""}`}>{authInfo}</div> : null}

            <form onSubmit={login} className="form-stack">
                <input
                  value={loginUsername}
                  onChange={(event) => setLoginUsername(event.target.value)}
                  placeholder="Usuário"
                  disabled={authSubmitting}
                  required
                  minLength={3}
                  maxLength={32}
                  title="Informe seu usuário."
                />
              <div className="password-field">
                <input
                  type={showLoginPassword ? "text" : "password"}
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  placeholder="Senha"
                  disabled={authSubmitting}
                  required
                  minLength={8}
                  maxLength={128}
                  title="Informe sua senha."
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowLoginPassword((current) => !current)}
                  disabled={authSubmitting}
                  aria-label={showLoginPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showLoginPassword ? <FiEyeOff /> : <FiEye />}
                </button>
              </div>
              <label className="auth-checkbox-row">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  disabled={authSubmitting}
                />
                <span>Manter conectado</span>
              </label>
              <button type="submit" disabled={authSubmitting}>
                {authSubmitting ? (
                  <>
                    <span className="button-spinner" />
                    Entrando...
                  </>
                ) : (
                  "Entrar"
                )}
              </button>
            </form>
          </section>
        )}
      </div>
    );
  }

  function renderDashboard() {
    return (
      <div className="view-stack">
        <section className="hero-card">
          <div>
            <span className="eyebrow hero-greeting">
              Seja Bem vindo, <span className="hero-user-name">{authUser?.username ?? ""}</span>
            </span>
            <p>
              Controle o seu calendario de postagens das redes sociais da sua empresa e unidades separadamente em uma
              interface clara e intuitiva.
            </p>
          </div>
        </section>

        <section className="stats-grid">
          <article className="metric-card">
            <span className="metric-label">
              <span className="metric-icon" aria-hidden="true">
                <FiCheckCircle />
              </span>
              <span className="metric-label-text">Enviados</span>
            </span>
            <strong>{dashboard.completedJobs}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">
              <span className="metric-icon" aria-hidden="true">
                <FiClock />
              </span>
              <span className="metric-label-text">Pendentes</span>
            </span>
            <strong>{dashboard.pendingJobs}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">
              <span className="metric-icon" aria-hidden="true">
                <FiWifi />
              </span>
              <span className="metric-label-text">Cancelados</span>
            </span>
            <strong>{dashboard.canceledJobs}</strong>
          </article>
          <article className="metric-card metric-card-failed">
            <span className="metric-label">
              <span className="metric-icon" aria-hidden="true">
                <FiAlertCircle />
              </span>
              <span className="metric-label-text">Falhados</span>
            </span>
            <strong className="metric-value-failed">{dashboard.failedJobs}</strong>
          </article>
        </section>

        <section className="content-grid">
          <article className="panel-card full-width-panel">
            <div className="section-head">
              <div>
                <h2>Próximos Agendamentos</h2>
              </div>
              <div className="inline-actions">
                <button
                  type="button"
                  className="ghost-button view-all-button"
                  onClick={() => openHistoryWithFilter("upcoming")}
                >
                  Ver todos
                </button>
              </div>
            </div>
            <div className="table-list">
              {upcomingJobs.length === 0 ? (
                <div className="empty-state">Nao ha proximos agendamentos nesse filtro.</div>
              ) : (
                upcomingJobs.map((job) => (
                  <div key={job.id} className="row-card">
                    <div>
                      <strong>{resolveJobDisplayTitle(job)}</strong>
                      <span className="publication-pill">{publicationTypeLabel(job.publicationType)}</span>
                      <span className="unit-pill">
                        {`Unidade: ${companyNameMap[job.companyId] || "Unidade removida"}`}
                      </span>
                    </div>
                    <div className="inline-actions">
                      <span>{formatDate(job.dataPostagem)}</span>
                      <span className={`status-pill status-${job.status.toLowerCase()}`}>{jobStatusLabel(job.status)}</span>
                      {canToggleJobSchedule(job) ? (
                        <button
                          type="button"
                          className={job.status === "CANCELED" ? "activate-button" : "ghost-button"}
                          onClick={() => void toggleJobSchedule(job)}
                          disabled={togglingScheduleJobId === job.id}
                        >
                          {togglingScheduleJobId === job.id
                            ? "Salvando..."
                            : job.status === "CANCELED"
                              ? "Ativar agendamento"
                              : "Cancelar agendamento"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="panel-card full-width-panel">
            <div className="section-head">
              <div>
                <h2>Agendamentos Enviados</h2>
              </div>
              <button
                type="button"
                className="ghost-button view-all-button"
                onClick={() => openHistoryWithFilter("sent")}
              >
                Ver todos
              </button>
            </div>
            <div className="table-list">
              {sentJobsPreview.length === 0 ? (
                <div className="empty-state">Nao ha agendamentos enviados nesse filtro.</div>
              ) : (
                sentJobsPreview.map((job) => (
                  <div key={job.id} className="row-card">
                    <div>
                      <strong>{resolveJobDisplayTitle(job)}</strong>
                      <span className="publication-pill">{publicationTypeLabel(job.publicationType)}</span>
                      <span className="unit-pill">
                        {`Unidade: ${companyNameMap[job.companyId] || "Unidade removida"}`}
                      </span>
                    </div>
                    <div className="inline-actions">
                      <span>{formatDate(job.dataPostagem)}</span>
                      <span className={`status-pill status-${job.status.toLowerCase()}`}>{jobStatusLabel(job.status)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="panel-card full-width-panel">
            <div className="section-head">
              <div>
                <h2>Agendamentos Cancelados</h2>
              </div>
              <button
                type="button"
                className="ghost-button view-all-button"
                onClick={() => openHistoryWithFilter("canceled")}
              >
                Ver todos
              </button>
            </div>
            <div className="table-list">
              {canceledJobsPreview.length === 0 ? (
                <div className="empty-state">Nao ha agendamentos cancelados nesse filtro.</div>
              ) : (
                canceledJobsPreview.map((job) => (
                  <div key={job.id} className="row-card">
                    <div>
                      <strong>{resolveJobDisplayTitle(job)}</strong>
                      <span className="publication-pill">{publicationTypeLabel(job.publicationType)}</span>
                      <span className="unit-pill">
                        {`Unidade: ${companyNameMap[job.companyId] || "Unidade removida"}`}
                      </span>
                    </div>
                    <div className="inline-actions">
                      <span>{formatDate(job.dataPostagem)}</span>
                      <span className={`status-pill status-${job.status.toLowerCase()}`}>{jobStatusLabel(job.status)}</span>
                      <button
                        type="button"
                        className="activate-button"
                        onClick={() => void toggleJobSchedule(job)}
                        disabled={togglingScheduleJobId === job.id}
                      >
                        {togglingScheduleJobId === job.id ? "Salvando..." : "Ativar agendamento"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="panel-card full-width-panel">
            <div className="section-head">
              <div>
                <h2>Agendamentos Falhados</h2>
              </div>
              <button
                type="button"
                className="ghost-button view-all-button"
                onClick={() => openHistoryWithFilter("failed")}
              >
                Ver todos
              </button>
            </div>
            <div className="table-list">
              {failedJobsPreview.length === 0 ? (
                <div className="empty-state">Nao ha agendamentos falhados nesse filtro.</div>
              ) : (
                failedJobsPreview.map((job) => (
                  <div key={job.id} className="row-card">
                    <div>
                      <strong>{resolveJobDisplayTitle(job)}</strong>
                      <span className="publication-pill">{publicationTypeLabel(job.publicationType)}</span>
                      <span className="unit-pill">
                        {`Unidade: ${companyNameMap[job.companyId] || "Unidade removida"}`}
                      </span>
                    </div>
                    <div className="inline-actions">
                      <span>{formatDate(job.dataPostagem)}</span>
                      <span className={`status-pill status-${job.status.toLowerCase()}`}>{jobStatusLabel(job.status)}</span>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => retryJob(job.id)}
                        disabled={retryingJobId === job.id}
                      >
                        {retryingJobId === job.id ? "Tentando..." : "Tentar de novo"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>
      </div>
    );
  }

  function renderCompanyFilter(label: string) {
    return (
      <div className="inline-filter">
        <span>{label}</span>
        <select value={selectedCompanyId} onChange={(event) => setSelectedCompanyId(event.target.value)}>
          <option value="">Todas</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  function renderHistoryFilter() {
    return (
      <div className="inline-filter">
        <span>Filtrar status</span>
        <select
          value={historyFilter}
          onChange={(event) => {
            setHistoryFilter(parseHistoryFilterKey(event.target.value));
            setHistoryPage(1);
          }}
        >
          <option value="all">Todos</option>
          <option value="upcoming">Próximos</option>
          <option value="canceled">Cancelados</option>
          <option value="sent">Enviados</option>
          <option value="failed">Falhados</option>
        </select>
      </div>
    );
  }

  function renderHistoryMonthFilter() {
    return (
      <div className="inline-filter">
        <span>Filtrar mês</span>
        <select
          value={historyMonthFilter}
          onChange={(event) => {
            setHistoryMonthFilter(event.target.value);
            setHistoryPage(1);
          }}
        >
          <option value="all">Todos</option>
          {HISTORY_MONTH_OPTIONS.map((month) => (
            <option key={month.value} value={month.value}>
              {month.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  function renderHistoryYearFilter() {
    return (
      <div className="inline-filter">
        <span>Filtrar ano</span>
        <select
          value={historyYearFilter}
          onChange={(event) => {
            setHistoryYearFilter(event.target.value);
            setHistoryPage(1);
          }}
        >
          <option value="all">Todos</option>
          {historyAvailableYears.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>
    );
  }

  function renderMediaFilter() {
    return (
      <div className="inline-filter">
        <span>Filtrar status</span>
        <select
          value={mediaStatusFilter}
          onChange={(event) => {
            setMediaStatusFilter(parseHistoryFilterKey(event.target.value));
            setMediaPage(1);
          }}
        >
          <option value="all">Todos</option>
          <option value="upcoming">Próximos</option>
          <option value="canceled">Cancelados</option>
          <option value="sent">Enviados</option>
          <option value="failed">Falhados</option>
        </select>
      </div>
    );
  }

  function renderMediaMonthFilter() {
    return (
      <div className="inline-filter">
        <span>Filtrar mês</span>
        <select
          value={mediaMonthFilter}
          onChange={(event) => {
            setMediaMonthFilter(event.target.value);
            setMediaPage(1);
          }}
        >
          <option value="all">Todos</option>
          {HISTORY_MONTH_OPTIONS.map((month) => (
            <option key={month.value} value={month.value}>
              {month.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  function renderMediaYearFilter() {
    return (
      <div className="inline-filter">
        <span>Filtrar ano</span>
        <select
          value={mediaYearFilter}
          onChange={(event) => {
            setMediaYearFilter(event.target.value);
            setMediaPage(1);
          }}
        >
          <option value="all">Todos</option>
          {mediaAvailableYears.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>
    );
  }

  function renderNumericPagination(
    prefix: string,
    currentPage: number,
    totalPages: number,
    onPageChange: (page: number) => void,
    scrollTargetRef?: { current: HTMLElement | null },
  ) {
    if (totalPages <= 1) {
      return null;
    }

    return (
      <div className="pagination-shell">
        {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
          <button
            key={`${prefix}-page-${page}`}
            type="button"
            className={`pagination-button${page === currentPage ? " pagination-button-active" : ""}`}
            onClick={() => {
              onPageChange(page);
              if (!scrollTargetRef?.current || typeof window === "undefined") {
                return;
              }
              window.requestAnimationFrame(() => {
                scrollTargetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              });
            }}
            aria-current={page === currentPage ? "page" : undefined}
          >
            {page}
          </button>
        ))}
      </div>
    );
  }

  function renderOrganizations() {
    return (
      <section className="panel-card view-stack">
        <div className="section-head">
          <div>
            <span className="section-kicker">setup</span>
            <h2>Empresa</h2>
          </div>
        </div>
        {organizations.length === 0 ? (
          <form onSubmit={createOrganization} className="form-grid">
            <input
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              placeholder="Nome da empresa principal"
              required
              minLength={2}
              maxLength={80}
              title="Informe o nome da empresa principal com 2 a 80 caracteres."
            />
            <button type="submit">Criar empresa</button>
          </form>
        ) : (
          <div className="empty-state">A empresa principal já foi cadastrada. Use a tela de Unidades para adicionar novas unidades.</div>
        )}
        <div className="table-list">
          {organizations.map((organization) => (
            <div key={organization.id} className="row-card">
              <div>
                <strong>{organization.name}</strong>
                <span>Criada em {formatDate(organization.createdAt)}</span>
              </div>
              <div className="inline-actions">
                <button type="button" className="danger-button" onClick={() => deleteOrganization(organization.id)}>
                  Excluir empresa
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  function renderProfile() {
    return (
      <div className="view-stack">
        <section className="panel-card view-stack">
          <h2 className="profile-page-title">Perfil</h2>
          <form onSubmit={saveProfile} className="form-stack">
            <input
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder="Nome"
              required
              minLength={2}
              maxLength={80}
              title="Informe o seu nome."
            />
            <input
              value={profileUsername}
              onChange={(event) => setProfileUsername(event.target.value)}
              placeholder="Usuário"
              required
              minLength={3}
              maxLength={32}
              pattern="^[a-zA-Z0-9._-]+$"
              title="Use apenas letras, números, ponto, traço ou underscore."
            />
            <input
              type="password"
              value={profilePassword}
              onChange={(event) => setProfilePassword(event.target.value)}
              placeholder="Senha"
              minLength={8}
              maxLength={128}
              title="Preencha apenas se quiser alterar a sua senha."
            />
            <small className="field-hint">Deixe a senha em branco para não alterar.</small>
            <button type="submit">Salvar</button>
          </form>
        </section>
      </div>
    );
  }

  function renderCompanies() {
    return (
      <section className="panel-card view-stack">
        <div className="section-head">
          <div>
            <span className="section-kicker">setup</span>
            <h2>Unidades</h2>
          </div>
        </div>
        <form onSubmit={createCompany} className="form-grid form-grid-two">
          <input
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            placeholder="Nome da unidade"
            required
            minLength={2}
            maxLength={80}
            title="Informe o nome da unidade com 2 a 80 caracteres."
          />
          <select value={companyOrganizationId} onChange={(event) => setCompanyOrganizationId(event.target.value)} required>
            <option value="">Selecione a empresa</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
          <button type="submit">Criar unidade</button>
        </form>
        <div className="table-list">
          {companies.map((company) => (
            <div key={company.id} className="row-card">
              <div>
                <strong>{company.name}</strong>
                <span>Empresa: {organizations.find((item) => item.id === company.organizationId)?.name || "-"}</span>
              </div>
              <span>{formatDate(company.createdAt)}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  function renderAgents() {
    return (
      <section className="panel-card view-stack">
        <div className="section-head">
          <div>
            <span className="section-kicker">operação</span>
            <h2>Conectar contas</h2>
          </div>
          <div className="inline-actions">{renderCompanyFilter("Filtrar unidade")}</div>
        </div>

        <form onSubmit={createConnection} className="form-grid form-grid-three">
          <input
            value={connectionDisplayName}
            onChange={(event) => setConnectionDisplayName(event.target.value)}
            placeholder="Nome da conta"
            required
            minLength={2}
            maxLength={80}
            title="Informe um nome interno para identificar essa conta conectada."
          />
          <select value={connectionCompanyId} onChange={(event) => setConnectionCompanyId(event.target.value)} required>
            <option value="">Selecione a unidade</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
          <select
            value={connectionPlatform}
            onChange={(event) => setConnectionPlatform(event.target.value as SocialConnection["platform"])}
            required
          >
            <option value="instagram">Instagram</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
          <input
            value={connectionLoginIdentifier}
            onChange={(event) => setConnectionLoginIdentifier(event.target.value)}
            placeholder={
              connectionPlatform === "instagram"
                ? "ID/usuario Instagram (opcional)"
                : "Nome da Instancia Evolution (ex: unidade-centro-01)"
            }
            title={
              connectionPlatform === "instagram"
                ? "Opcional: use este campo se o mesmo Facebook tiver mais de uma conta Instagram Business, para o backend escolher a conta certa no OAuth."
                : "Informe o Nome da Instancia da Evolution API para conectar o WhatsApp. Em modo hardcoded no backend, pode ficar vazio."
            }
          />
          {connectionPlatform === "whatsapp" ? (
            <input
              type="password"
              value={connectionSecret}
              onChange={(event) => setConnectionSecret(event.target.value)}
              placeholder="API Key da instância (opcional)"
              title="Opcional: API Key da instância da Evolution API. Se vazio, o backend usa EVOLUTION_API_KEY."
            />
          ) : null}
          <button type="submit">Adicionar conta</button>
        </form>

        <div className="table-list">
          {filteredConnections.map((connection) => (
            <div key={connection.id} className="row-card connection-row">
              <div className="agent-meta">
                <strong>{connection.displayName}</strong>
                <span className="publication-pill">{connectionPlatformLabel(connection.platform)}</span>
                <span className="unit-pill">
                  {`Unidade: ${companyNameMap[connection.companyId] || "Unidade removida"}`}
                </span>
                {connection.platform === "whatsapp" && connection.authStatus === "CONNECTED" ? (
                  <div className="connection-state-shell">
                    <strong>WhatsApp conectado</strong>
                    <span>A conta esta conectada e pronta para postar.</span>
                    {connection.lastAuthAt ? <span>Conectado em {formatDate(connection.lastAuthAt)}</span> : null}
                  </div>
                ) : null}
                {connection.platform === "whatsapp" && connection.authStatus === "AUTH_IN_PROGRESS" ? (
                  <div className="connection-state-shell connection-state-shell-pending">
                    <strong>
                      {connection.qrStatus === "QR_EXPIRED"
                        ? "QR expirado"
                        : connection.qrStatus === "WAITING_QR_SCAN"
                          ? "Escaneie agora"
                          : connection.qrStatus === "ERROR"
                            ? "Falha ao gerar QR"
                            : "Gerando QR..."}
                    </strong>
                    <span>
                      {connection.qrStatus === "QR_EXPIRED"
                        ? "Clique em Gerar novo QR para emitir outro código."
                        : connection.qrStatus === "WAITING_QR_SCAN"
                          ? "Abra o modal e escaneie o QR pelo painel."
                          : connection.qrStatus === "ERROR"
                            ? "Nao foi possivel gerar o QR. Tente novamente."
                            : "O worker local está preparando o QR do WhatsApp."}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="inline-actions connection-actions">
                {connection.platform === "instagram" && connection.authStatus !== "CONNECTED" ? (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void openConnectionVisualAuth(connection.id)}
                  >
                    Abrir login
                  </button>
                ) : null}
                {connection.platform === "whatsapp" ? (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={qrRequestingConnectionId === connection.id}
                    onClick={() => void regenerateConnectionQr(connection.id)}
                  >
                    {qrRequestingConnectionId === connection.id ? "Gerando..." : "Gerar novo QR"}
                  </button>
                ) : null}
                {connection.platform !== "instagram" || connection.authStatus === "CONNECTED" ? (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void disconnectConnection(connection.id)}
                  >
                    Desconectar
                  </button>
                ) : null}
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => void deleteConnection(connection.id)}
                >
                  Excluir conta
                </button>
              </div>
            </div>
          ))}
          {filteredConnections.length === 0 ? (
            <div className="empty-state">Nenhuma conta conectada para este filtro.</div>
          ) : null}
        </div>
      </section>
    );
  }

  function renderScheduler() {
    return (
      <section className="panel-card view-stack">
        <div className="section-head">
          <div>
            <span className="section-kicker">agenda</span>
            <h2>{editingJobId ? "Editar job" : "Agendar Postagem"}</h2>
          </div>
          <div className="inline-actions">
            {editingJobId ? (
              <button type="button" className="ghost-button" onClick={resetSchedulerForm}>
                Cancelar edicao
              </button>
            ) : null}
          </div>
        </div>
        {schedulerInfo ? (
          <div
            className={`info-banner${isPositiveSchedulerInfo ? " info-banner-success" : ""}${isTransientSchedulerInfo ? " info-banner-transient" : ""}`}
          >
            {schedulerInfo}
          </div>
        ) : null}
        <form onSubmit={createJob} className="form-stack">
          <div className="form-grid form-grid-two scheduler-top-grid">
            <select
              value={publicationType}
              onChange={(event) => setPublicationType(event.target.value as SchedulerPublicationType)}
              disabled={submittingJob}
              required
            >
              <option value="">Selecione o tipo de postagem</option>
              <option value="instagram_reel">Instagram Reel</option>
              <option value="instagram_post">Instagram Post</option>
              <option value="instagram_story">Instagram Story</option>
              <option value="whatsapp_status_midia">WhatsApp Status (midia)</option>
            </select>
            <select value={jobCompanyId} onChange={(event) => setJobCompanyId(event.target.value)} required>
              <option value="">Selecione a unidade</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>

          <label className="field-shell">
            <span>Título da postagem</span>
            <input
              type="text"
              value={postTitle}
              onChange={(event) => setPostTitle(event.target.value)}
              disabled={submittingJob}
              placeholder="Ex: Oferta da semana - unidade Centro"
              maxLength={120}
              required
              title="Título interno e curto para identificar a postagem nas listas e notificações."
            />
          </label>

          <div className="form-grid form-grid-two scheduler-top-grid">
            <input
              type="date"
              value={scheduledDate}
              onChange={(event) => setScheduledDate(event.target.value)}
              required
              title="Selecione a data em que a postagem deve ser executada."
            />
            <input
              type="time"
              value={scheduledTime}
              onChange={(event) => {
                setScheduledTime(event.target.value);
                setScheduledTimeTouched(true);
              }}
              title="Horário opcional. Se ficar em branco, o sistema usa o horário atual."
            />
          </div>

          <div className="text-chip">Se o horário ficar em branco, a postagem usa o horário atual ao salvar.</div>

          <div className="form-grid form-grid-two">
            <select
              value={jobSocialConnectionId}
              onChange={(event) => setJobSocialConnectionId(event.target.value)}
              required
            >
              <option value="">Selecione a conta vinculada</option>
              {schedulerConnections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {`${connection.displayName} (${connectionPlatformLabel(connection.platform)})`}
                </option>
              ))}
            </select>
            <div className="text-chip">
              {schedulerConnections.length > 0
                ? `${schedulerConnections.length} conta(s) disponivel(is) para este tipo`
                : "Nenhuma conta conectada para esta unidade e rede"}
            </div>
          </div>

          {requiresMediaUpload ? (
            <label
              className={`upload-shell${uploadDragActive ? " upload-shell-active" : ""}${uploading ? " upload-shell-uploading" : ""}`}
              onDrop={handleSchedulerMediaDrop}
              onDragOver={handleSchedulerMediaDragOver}
              onDragLeave={handleSchedulerMediaDragLeave}
            >
              <span>Upload de midia</span>
              <input
                ref={schedulerMediaInputRef}
                type="file"
                onChange={uploadMedia}
                multiple={supportsMultiMediaUpload}
                accept={
                  publicationType === "instagram_post"
                    ? ".jpg,.jpeg,.png"
                    : publicationType === "instagram_reel"
                      ? ".mp4"
                    : "image/*,video/*"
                }
                disabled={submittingJob || uploading}
                required={uploadedMediaCount === 0}
                title={
                  publicationType === "instagram_post"
                    ? "Selecione uma imagem JPG ou PNG (máximo de 8 MB)."
                    : publicationType === "instagram_reel"
                      ? "Selecione um vídeo MP4."
                      : publicationType === "instagram_story"
                        ? "Selecione imagem JPG/PNG (máximo de 8 MB) ou vídeo."
                      : "Selecione um arquivo de imagem ou vídeo para a postagem."
                }
              />
              <div
                className="upload-dropzone"
                role="button"
                tabIndex={0}
                onClick={openSchedulerMediaPicker}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openSchedulerMediaPicker();
                  }
                }}
              >
                <div className="upload-dropzone-icon">{uploading ? <span className="button-spinner" aria-hidden="true" /> : "+"}</div>
                <div className="upload-dropzone-copy">
                  <strong>
                    {uploading
                      ? "Enviando mídia..."
                      : uploadedMediaCount > 0
                        ? uploadedMediaCount === 1
                          ? uploadedFileName
                          : `${uploadedMediaCount} mídias prontas para publicação`
                        :
                        (publicationType === "instagram_post"
                          ? "Arraste uma imagem JPG ou PNG aqui (máx. 8 MB)"
                          : publicationType === "instagram_reel"
                            ? "Arraste um vídeo MP4 aqui"
                            : publicationType === "instagram_story"
                              ? "Arraste imagem (máx. 8 MB) ou vídeo aqui"
                            : "Arraste uma imagem ou vídeo aqui")}
                  </strong>
                  <small>
                    {uploading
                      ? "Aguarde enquanto o arquivo é enviado."
                      : publicationType === "instagram_post"
                        ? "Ou clique aqui para selecionar imagens JPG/PNG de até 8 MB (máximo de 10)."
                        : publicationType === "instagram_reel"
                          ? "Ou clique aqui para selecionar um vídeo MP4."
                          : publicationType === "instagram_story"
                            ? "Ou clique aqui para selecionar imagens/vídeos (máximo de 10)."
                          : "Ou clique aqui para selecionar do computador."}
                  </small>
                </div>
              </div>
            </label>
          ) : null}

          {supportsMultiMediaUpload && uploadedMediaCount > 1 ? (
            <label className="field-shell scheduler-sequence-shell">
              <span>Publicação em sequência</span>
              <div className="scheduler-sequence-row">
                <small>
                  Arraste as miniaturas para direita para ordenar a sequencia.
                </small>
              </div>
            </label>
          ) : null}

          {supportsMultiMediaUpload && uploadedMediaCount > 0 ? (
            <div className="scheduler-media-preview-list">
              {uploadedSchedulerMedia.map((media, index) => (
                <div
                  key={media.filePath}
                  className={`scheduler-media-preview-item${draggingSchedulerMediaIndex === index ? " scheduler-media-preview-item-dragging" : ""}`}
                  draggable
                  onDragStart={() => handleSchedulerMediaThumbDragStart(index)}
                  onDragEnd={handleSchedulerMediaThumbDragEnd}
                  onDragOver={handleSchedulerMediaThumbDragOver}
                  onDrop={(event) => handleSchedulerMediaThumbDrop(index, event)}
                  title={`Ordem ${index + 1}`}
                >
                  <button
                    type="button"
                    className="scheduler-media-preview-remove"
                    onClick={() => removeSchedulerUploadedMedia(media.filePath)}
                    disabled={submittingJob || uploading}
                    aria-label={`Remover mídia ${index + 1}`}
                  >
                    <FiX />
                  </button>
                  <img src={`${api.baseUrl}${media.filePath}`} alt={`Prévia ${index + 1}`} loading="lazy" />
                  <small>{`#${index + 1}`}</small>
                </div>
              ))}
            </div>
          ) : null}

          {supportsCaption ? (
            <label className="field-shell">
              <span>{captionLabel}</span>
              <textarea
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                disabled={submittingJob}
                placeholder={captionPlaceholder}
                rows={publicationType === "whatsapp_status_texto" ? 5 : 4}
                maxLength={2000}
                required={requiresInstagramMetadata || publicationType === "whatsapp_status_texto"}
                title={captionTitle}
              />
            </label>
          ) : null}

          {supportsCaption &&
          (caption.trim().length > 0 ||
            publicationType === "whatsapp_status_midia" ||
            publicationType === "whatsapp_status_texto" ||
            requiresInstagramMetadata) ? (
            <div className="emoji-picker-shell">
              <span>Emojis rápidos</span>
              <div className="emoji-group-list">
                {whatsappTextEmojiGroups.map((group) => (
                  <div key={group.label} className="emoji-group-card">
                    <strong>{group.label}</strong>
                    <div className="emoji-picker-grid">
                      {group.emojis.map((emoji) => (
                        <button
                          key={`${group.label}-${emoji}`}
                          type="button"
                          className="emoji-chip"
                          disabled={submittingJob}
                          onClick={() => appendEmojiToCaption(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {requiresInstagramMetadata ? (
            <div className="text-chip">
              {isInstagramForcedLocationEnabled
                ? `Localização fixa ativa: ${instagramForcedLocationName} (#${instagramForcedLocationId}).`
                : publicationType === "instagram_story"
                  ? "Story será publicado sem localização pela API oficial."
                  : "Post/Reel usam automaticamente a localização da Page vinculada à conta Instagram Business. Se não houver localização válida, publica sem localização."}
            </div>
          ) : null}

          <button type="submit" disabled={submittingJob}>
            {submittingJob ? <span className="button-spinner" aria-hidden="true" /> : null}
            <span>
              {submittingJob
                ? editingJobId
                  ? "Salvando..."
                  : "Agendando..."
                : editingJobId
                  ? "Salvar alteracoes"
                  : "Agendar Postagem"}
            </span>
          </button>
        </form>
      </section>
    );
  }

  function renderMedia() {
    return (
      <section ref={mediaSectionRef} className="panel-card view-stack">
        <div className="section-head">
              <div>
                <span className="section-kicker">Biblioteca</span>
                <h2>Mídias por unidade</h2>
          </div>
        </div>
        <div className="history-filters-grid">
          {renderCompanyFilter("Filtrar unidade")}
          {renderMediaFilter()}
          {renderMediaMonthFilter()}
          {renderMediaYearFilter()}
        </div>
        <div className="history-filters-meta">
          <span className="count-pill">{mediaFilteredItems.length} itens</span>
        </div>
        {mediaInfo ? (
          <div
            className={`info-banner${isPositiveMediaInfo ? " info-banner-success" : ""}${isTransientMediaInfo ? " info-banner-transient" : ""}`}
          >
            {mediaInfo}
          </div>
        ) : null}
        {renderNumericPagination("media-top", mediaPage, mediaTotalPages, setMediaPage, mediaSectionRef)}
        <div className="media-grid">
          {paginatedMediaItems.map((media) => {
            const imageLoaded = loadedMediaPreviewByPath[media.filePath];
            const placeholderPreview = mediaPreviewPlaceholderByPath[media.filePath];

            return (
              <article key={media.filePath} className="media-card">
                <div className="media-preview">
                  <button
                    type="button"
                    className="media-delete-button"
                    title="Excluir mídia"
                    aria-label="Excluir mídia"
                    onClick={() => void deleteMediaFile(media)}
                  >
                    <FiX />
                  </button>
                  {isVideoPath(media.filePath) ? (
                    <video src={media.previewUrl} muted playsInline />
                  ) : (
                    <>
                      {!imageLoaded ? (
                        placeholderPreview ? (
                          <img
                            src={placeholderPreview}
                            alt=""
                            aria-hidden="true"
                            className="media-preview-placeholder"
                          />
                        ) : (
                          <div className="media-preview-fallback-placeholder" aria-hidden="true" />
                        )
                      ) : null}
                      <img
                        src={media.previewUrl}
                        alt={media.caption || "Midia"}
                        loading="lazy"
                        decoding="async"
                        className={`media-preview-image${imageLoaded ? " media-preview-image-loaded" : ""}`}
                        onLoad={() => markMediaPreviewLoaded(media.filePath)}
                        onError={() => markMediaPreviewLoaded(media.filePath)}
                      />
                    </>
                  )}
                </div>
                <div className="inline-actions">
                  <a href={media.previewUrl} target="_blank" rel="noreferrer" className="link-chip">
                    Abrir
                  </a>
                  <button type="button" className="ghost-button" onClick={() => reuseMedia(media)}>
                    Reutilizar
                  </button>
                </div>
              </article>
            );
          })}
          {mediaFilteredItems.length === 0 ? <div className="empty-state">Nenhuma mídia encontrada neste filtro.</div> : null}
        </div>
        {renderNumericPagination("media-bottom", mediaPage, mediaTotalPages, setMediaPage, mediaSectionRef)}
      </section>
    );
  }

  function renderHistory() {
    return (
      <section ref={historySectionRef} className="panel-card view-stack">
        <div className="section-head">
          <div>
            <span className="section-kicker">timeline</span>
            <h2>Histórico</h2>
          </div>
        </div>
        <div className="history-filters-grid">
          {renderCompanyFilter("Filtrar unidade")}
          {renderHistoryFilter()}
          {renderHistoryMonthFilter()}
          {renderHistoryYearFilter()}
        </div>
        <div className="history-filters-meta">
          <span className="count-pill">{historyFilteredJobs.length} registros</span>
        </div>
        {historyInfo ? (
          <div
            className={`info-banner${isPositiveHistoryInfo ? " info-banner-success" : ""}${isTransientHistoryInfo ? " info-banner-transient" : ""}`}
          >
            {historyInfo}
          </div>
        ) : null}
        {renderNumericPagination("history-top", historyPage, historyTotalPages, setHistoryPage, historySectionRef)}
        <div className="table-list">
          {paginatedHistoryJobs.map((job) => (
            <div key={job.id} className="row-card">
              <div>
                <strong>{resolveJobDisplayTitle(job)}</strong>
                <span className="publication-pill">{publicationTypeLabel(job.publicationType)}</span>
                <span className="unit-pill">{`Unidade: ${companyNameMap[job.companyId] || "Unidade removida"}`}</span>
                {job.locationName ? <span>Localização: {job.locationName}</span> : null}
                <span>{formatDate(job.dataPostagem)}</span>
                <span>{job.lastError ?? "Sem erro"}</span>
              </div>
              <div className="inline-actions">
                <span className={`status-pill status-${job.status.toLowerCase()}`}>{jobStatusLabel(job.status)}</span>
                {canToggleJobSchedule(job) ? (
                  <button
                    type="button"
                    className={job.status === "CANCELED" ? "activate-button" : "ghost-button"}
                    onClick={() => void toggleJobSchedule(job)}
                    disabled={togglingScheduleJobId === job.id}
                  >
                    {togglingScheduleJobId === job.id
                      ? "Salvando..."
                      : job.status === "CANCELED"
                        ? "Ativar agendamento"
                        : "Cancelar agendamento"}
                  </button>
                ) : null}
                {job.filePath ? (
                  <a href={`${api.baseUrl}${job.filePath}`} target="_blank" rel="noreferrer" className="link-chip">
                    Midia
                  </a>
                ) : (
                  <span className="text-chip">Sem midia</span>
                )}
                {job.status === "FAILED" || job.status === "WAITING_LOGIN" || job.status === "SENT_UNCONFIRMED" ? (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => retryJob(job.id)}
                    disabled={retryingJobId === job.id}
                  >
                    {retryingJobId === job.id ? "Tentando..." : "Tentar de novo"}
                  </button>
                ) : null}
                <button type="button" className="ghost-button" onClick={() => startEditJob(job)}>
                  Editar
                </button>
                <button type="button" className="danger-button" onClick={() => deleteJob(job.id)}>
                  Excluir
                </button>
              </div>
            </div>
          ))}
          {historyFilteredJobs.length === 0 ? <div className="empty-state">Nenhum job encontrado neste filtro.</div> : null}
        </div>
        {renderNumericPagination("history-bottom", historyPage, historyTotalPages, setHistoryPage, historySectionRef)}
      </section>
    );
  }

  function renderLogs() {
    if (!isRootUser) {
      return (
        <section className="panel-card view-stack">
          <div className="empty-state">A área de logs avançados está disponível apenas para o usuário root.</div>
        </section>
      );
    }

    return (
      <section className="panel-card view-stack tinted-panel">
        <div className="section-head">
          <div>
            <span className="section-kicker">debug</span>
            <h2>Alertas e logs de erro</h2>
          </div>
          <div className="inline-actions">
            {renderCompanyFilter("Filtrar unidade")}
            <span className="count-pill">{filteredLogs.length} alertas</span>
          </div>
        </div>
        <div className="table-list">
          {filteredLogs.map((log) => (
            <div key={log.id} className="row-card log-row">
              <div>
                <strong>{log.level}</strong>
                {log.errorCode ? <span className="log-code-pill">{log.errorCode}</span> : null}
                <span>{log.message}</span>
                {log.screenshotPath ? (
                  <a
                    href={`${api.baseUrl}${log.screenshotPath}`}
                    target="_blank"
                    rel="noreferrer"
                    className="link-chip"
                  >
                    Screenshot
                  </a>
                ) : null}
              </div>
              <span>{formatDate(log.createdAt)}</span>
            </div>
          ))}
          {filteredLogs.length === 0 ? <div className="empty-state">Nenhum alerta de erro para esta unidade.</div> : null}
        </div>
      </section>
    );
  }

  function renderNotices() {
    return (
      <section ref={avisosSectionRef} className="panel-card view-stack">
        <div className="section-head">
          <div>
            <span className="section-kicker">painel</span>
            <h2>Avisos</h2>
          </div>
          <span className="count-pill">{avisosTotal} registros</span>
        </div>

        {avisosInfo ? (
          <div className={`info-banner${isPositiveAvisosInfo ? " info-banner-success" : ""}`}>
            {avisosInfo}
          </div>
        ) : null}

        {renderNumericPagination("avisos-top", avisosPage, avisosTotalPages, setAvisosPage, avisosSectionRef)}

        <div className="table-list">
          {avisos.map((aviso) => (
            <div key={aviso.id} className={`row-card notice-row ${avisoToneClass(aviso.kind)}`}>
              <div>
                <strong>{aviso.title}</strong>
                <span>{aviso.message}</span>
                <span>{formatDate(aviso.createdAt)}</span>
              </div>
              <div className="inline-actions">
                <span className={`status-pill ${aviso.readAt ? "status-completed" : "status-pending"}`}>
                  {aviso.readAt ? "Lido" : "Nao lido"}
                </span>
              </div>
            </div>
          ))}
          {avisos.length === 0 ? <div className="empty-state">Nenhum aviso encontrado.</div> : null}
        </div>

        {renderNumericPagination("avisos-bottom", avisosPage, avisosTotalPages, setAvisosPage, avisosSectionRef)}
      </section>
    );
  }

  function renderNoticeAdmin() {
    if (!isRootUser) {
      return (
        <section className="panel-card view-stack">
          <div className="empty-state">Somente o root pode cadastrar avisos globais.</div>
        </section>
      );
    }

    return (
      <section className="panel-card view-stack">
        <div className="section-head">
          <div>
            <span className="section-kicker">root</span>
            <h2>Cadastrar avisos</h2>
          </div>
        </div>

        {noticeAdminInfo ? (
          <div className={`info-banner${isPositiveNoticeAdminInfo ? " info-banner-success" : ""}`}>
            {noticeAdminInfo}
          </div>
        ) : null}

        <form onSubmit={createBroadcastAviso} className="form-stack">
          <input
            value={broadcastAvisoTitle}
            onChange={(event) => setBroadcastAvisoTitle(event.target.value)}
            placeholder="Titulo do aviso"
            maxLength={120}
            required
          />
          <textarea
            value={broadcastAvisoMessage}
            onChange={(event) => setBroadcastAvisoMessage(event.target.value)}
            placeholder="Mensagem para todos os clientes"
            rows={6}
            maxLength={2000}
            required
          />
          <button type="submit" disabled={broadcastAvisoSubmitting}>
            {broadcastAvisoSubmitting ? "Enviando..." : "Enviar aviso global"}
          </button>
        </form>
      </section>
    );
  }

  function renderContent() {
    switch (activeView) {
      case "profile":
        return renderProfile();
      case "organizations":
        return renderOrganizations();
      case "companies":
        return renderCompanies();
      case "agents":
        return renderAgents();
      case "scheduler":
        return renderScheduler();
      case "media":
        return renderMedia();
      case "history":
        return renderHistory();
      case "notices":
        return renderNotices();
      case "noticeAdmin":
        return renderNoticeAdmin();
      case "logs":
        return renderLogs();
      case "dashboard":
      default:
        return renderDashboard();
    }
  }

  if (!authChecked) {
    return <div className="auth-shell"><section className="auth-card"><p>Validando acesso...</p></section></div>;
  }

  if (!authUser) {
    return renderAuthScreen();
  }

  return (
    <div className="app-shell">
      <button
        type="button"
        className={`sidebar-overlay ${sidebarOpen ? "sidebar-overlay-visible" : ""}`}
        aria-label="Fechar menu"
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <button
          type="button"
          className="sidebar-close"
          aria-label="Fechar menu"
          onClick={() => setSidebarOpen(false)}
        >
          ×
        </button>
        <nav className="nav-list">
          {visibleNavItems.map((item) => (
            <a
              key={item.key}
              href={buildViewHref(item.key)}
              className={`nav-item ${activeView === item.key ? "nav-item-active" : ""}`}
              onClick={(event) => {
                event.preventDefault();
                navigateToView(item.key);
              }}
            >
              {item.eyebrow ? <span className="nav-eyebrow">{item.eyebrow}</span> : null}
              <span>{item.label}</span>
            </a>
          ))}
        </nav>

      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="topbar-heading">
            <img src={appLogo} alt="SocialUp" className="topbar-logo" />
          </div>
          <div className="topbar-mobile-actions">
            {renderNoticesBell(noticesBellMobileRef, "notices-shell-mobile")}
            <button
              type="button"
              className={`profile-trigger mobile-profile-trigger ${activeView === "profile" ? "profile-trigger-active" : ""}`}
              onClick={() => {
                setNoticesPopoverOpen(false);
                navigateToView("profile");
              }}
            >
              <span className="profile-icon" aria-hidden="true" />
              <span className="profile-trigger-label">Perfil</span>
            </button>
            <button
              type="button"
              className="menu-toggle"
              aria-label="Abrir menu"
              onClick={() => {
                setNoticesPopoverOpen(false);
                setSidebarOpen((current) => !current);
              }}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className={`profile-trigger ${activeView === "profile" ? "profile-trigger-active" : ""}`}
              onClick={() => {
                setNoticesPopoverOpen(false);
                navigateToView("profile");
              }}
            >
              <span className="profile-icon" aria-hidden="true" />
              <span className="profile-trigger-label">Perfil</span>
            </button>
            {renderNoticesBell(noticesBellDesktopRef)}
            <button type="button" className="danger-button logout-button" onClick={() => void logout()}>
              Sair
            </button>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}
        {authInfo ? <div className={`info-banner${isPositiveAuthInfo ? " info-banner-success" : ""}`}>{authInfo}</div> : null}

        {renderContent()}

        {activeView !== "scheduler" ? (
          <section className="panel-card quick-scheduler">
            <div className="section-head">
              <div>
                <span className="section-kicker">Ação rápida</span>
                <h2>Atalho rápido para agendar</h2>
              </div>
              <button type="button" className="activate-button" onClick={() => navigateToView("scheduler")}>
                Agendar
              </button>
            </div>
            <div className="quick-summary">
              <span>
                {uploadedMediaCount > 0
                  ? uploadedMediaCount === 1
                    ? "1 mídia pronta para reutilização"
                    : `${uploadedMediaCount} mídias prontas para reutilização`
                  : "Selecione uma mídia na biblioteca para reutilizar."}
              </span>
            </div>
          </section>
        ) : null}

        {activeQrConnectionId ? (
          <button
            type="button"
            className="qr-modal-backdrop"
            aria-label="Fechar QR do WhatsApp"
            onClick={() => void dismissConnectionQr(activeQrConnectionId)}
          >
            <section className="qr-modal" aria-label="QR do WhatsApp" onClick={(event) => event.stopPropagation()}>
              <div className="qr-modal-header">
                <div>
                  <strong>QR do WhatsApp</strong>
                  <span>{activeQrDescription}</span>
                </div>
                <button
                  type="button"
                  className="qr-modal-close"
                  onClick={() => void dismissConnectionQr(activeQrConnectionId)}
                >
                  Fechar
                </button>
              </div>

              <div className="qr-shell qr-shell-modal">
                {activeQrConnection?.qrImageDataUrl ? (
                  <img className="qr-image" src={activeQrConnection.qrImageDataUrl} alt="QR Code do WhatsApp" />
                ) : (
                  <div className="qr-placeholder">
                    <span className="spinner" aria-hidden="true" />
                    <span>{activeQrHeading}</span>
                  </div>
                )}
                <div className="qr-meta">
                  {activeQrConnection?.qrGeneratedAt ? (
                    <span>Gerado em {formatDate(activeQrConnection.qrGeneratedAt)}</span>
                  ) : null}
                  {activeQrConnection?.workerLastSeenAt ? (
                    <span>Última atualização em {formatDate(activeQrConnection.workerLastSeenAt)}</span>
                  ) : null}
                </div>
                {activeQrState !== "CONNECTED" ? (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void cancelConnectionQr(activeQrConnectionId)}
                  >
                    Cancelar geração
                  </button>
                ) : null}
              </div>
            </section>
          </button>
        ) : null}
      </main>
    </div>
  );
}

export default App;
