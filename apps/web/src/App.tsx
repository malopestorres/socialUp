import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import type { IconType } from "react-icons";
import {
  FiAlertCircle,
  FiBell,
  FiCalendar,
  FiCheckCircle,
  FiClock,
  FiFileText,
  FiHome,
  FiImage,
  FiLink2,
  FiUsers,
  FiWifi,
  FiX,
  FiEye,
  FiEyeOff,
  FiMoon,
  FiSun,
} from "react-icons/fi";
import { FaInstagram, FaWhatsapp } from "react-icons/fa6";
import { api } from "./api";
import appLogo from "./assets/logo.svg";
import appLogoAlternative from "./assets/logo-alternativo.svg";

type ViewKey =
  | "dashboard"
  | "profile"
  | "plan"
  | "companies"
  | "agents"
  | "scheduler"
  | "media"
  | "history"
  | "logs"
  | "notices"
  | "noticeAdmin";

type ThemeMode = "light" | "dark";

type HistoryFilterKey = "all" | "upcoming" | "canceled" | "sent" | "failed" | "waiting_login" | "draft" | "published";
type PublicationState = "PUBLISHED" | "DRAFT";
type SchedulerPublicationState = PublicationState | "";

type Company = {
  id: string;
  name: string;
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
  publicationState: PublicationState;
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

type ConnectionPlatformOption = {
  platform: SocialConnection["platform"];
  label: string;
  icon: IconType;
  description: string;
};

type ConnectionPlatformFilter = "all" | SocialConnection["platform"];

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

const navItems: Array<{ key: ViewKey; label: string; eyebrow?: string; icon: IconType }> = [
  { key: "dashboard", label: "Dashboard", icon: FiHome },
  { key: "companies", label: "Perfis", icon: FiUsers },
  { key: "agents", label: "Conectar contas", icon: FiLink2 },
  { key: "scheduler", label: "Agendar", icon: FiCalendar },
  { key: "media", label: "Midias", icon: FiImage },
  { key: "history", label: "Histórico", icon: FiClock },
  { key: "noticeAdmin", label: "Cadastrar avisos", icon: FiBell },
  { key: "logs", label: "Logs", icon: FiFileText },
];

const viewHeadingIconByView: Partial<Record<ViewKey, IconType>> = {
  dashboard: FiHome,
  agents: FiLink2,
  scheduler: FiCalendar,
  media: FiImage,
  history: FiClock,
  companies: FiUsers,
  logs: FiFileText,
  notices: FiBell,
  noticeAdmin: FiBell,
};

const connectionPlatformOptions: ConnectionPlatformOption[] = [
  {
    platform: "instagram",
    label: "Instagram",
    icon: FaInstagram,
    description: "Conectar via OAuth oficial",
  },
  {
    platform: "whatsapp",
    label: "WhatsApp",
    icon: FaWhatsapp,
    description: "Conectar via Evolution API",
  },
];

const LEGACY_HISTORY_VIEW_QUERY_PARAM = "view";
const HISTORY_FILTER_QUERY_PARAM = "historyFilter";
const INSTAGRAM_OAUTH_RESULT_MARKER_QUERY_PARAM = "instagram_oauth";
const INSTAGRAM_OAUTH_SUCCESS_QUERY_PARAM = "instagram_oauth_success";
const INSTAGRAM_OAUTH_MESSAGE_QUERY_PARAM = "instagram_oauth_message";
const INSTAGRAM_OAUTH_CONNECTION_ID_QUERY_PARAM = "instagram_oauth_connection_id";
const HISTORY_PAGE_SIZE = 10;
const MEDIA_PAGE_SIZE = 12;
const NOTICE_PAGE_SIZE = 10;
const CONTENT_SKELETON_MIN_MS = 1500;
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
  plan: "/meu-plano",
  companies: "/perfis",
  agents: "/conectar-contas",
  scheduler: "/agendar",
  media: "/midias",
  history: "/historico",
  logs: "/logs",
  notices: "/avisos",
  noticeAdmin: "/avisos/cadastrar",
};

function parseHistoryFilterKey(value: string | null | undefined): HistoryFilterKey {
  if (
    value === "upcoming" ||
    value === "canceled" ||
    value === "sent" ||
    value === "failed" ||
    value === "waiting_login" ||
    value === "draft" ||
    value === "published"
  ) {
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
  if (normalizedPath === "/unidades" || normalizedPath === "/empresa") {
    return "companies";
  }
  if (normalizedPath === "/plano") {
    return "plan";
  }
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
  if (normalizedKind === "JOB_WAITING_LOGIN" || normalizedKind === "JOB_RATE_LIMIT") {
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
      return "Stories";
    case "instagram_reel":
      return "Reels";
    case "instagram_post":
      return "Posts";
    case "whatsapp_status_midia":
      return "Status";
    case "whatsapp_status_texto":
      return "Status";
  }
}

function publicationTypeNetwork(publicationType: Job["publicationType"]): "instagram" | "whatsapp" {
  if (
    publicationType === "instagram_post" ||
    publicationType === "instagram_reel" ||
    publicationType === "instagram_story"
  ) {
    return "instagram";
  }

  return "whatsapp";
}

function renderPublicationTypePill(publicationType: Job["publicationType"]) {
  const network = publicationTypeNetwork(publicationType);
  const Icon = network === "instagram" ? FaInstagram : FaWhatsapp;

  return (
    <span className={`publication-pill publication-pill-with-icon publication-pill-${network}`}>
      <Icon className={`publication-pill-icon publication-pill-icon-${network}`} aria-hidden="true" />
      <span>{publicationTypeLabel(publicationType)}</span>
    </span>
  );
}

function jobStatusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "Aguardando publicação";
    case "RUNNING":
      return "Executando";
    case "SENT_UNCONFIRMED":
      return "Enviado sem confirmação";
    case "COMPLETED":
      return "Publicado";
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
  if (job.publicationState === "DRAFT") {
    return false;
  }

  if (job.status === "CANCELED") {
    return true;
  }

  if (job.status === "FAILED" && isPastScheduledAt(job.dataPostagem)) {
    return false;
  }

  return job.status === "PENDING" || job.status === "WAITING_LOGIN" || job.status === "FAILED";
}

function jobStatusTone(job: Job): string {
  if (job.publicationState === "DRAFT") {
    return "draft";
  }

  return job.status.toLowerCase();
}

function jobStatusDisplayLabel(job: Job): string {
  if (job.publicationState === "DRAFT") {
    return "Rascunho";
  }

  return jobStatusLabel(job.status);
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
const THEME_STORAGE_KEY = "socialup-theme";

function initialThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "dark" || storedTheme === "light") {
    return storedTheme;
  }

  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

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
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialThemeMode);
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
  const [companies, setCompanies] = useState<Company[]>([]);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard>(initialDashboard);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [companyName, setCompanyName] = useState("");
  const [connectionDisplayName, setConnectionDisplayName] = useState("");
  const [connectionCompanyId, setConnectionCompanyId] = useState("");
  const [connectionPlatform, setConnectionPlatform] = useState<SocialConnection["platform"]>("instagram");
  const [connectionPlatformFilter, setConnectionPlatformFilter] = useState<ConnectionPlatformFilter>("all");
  const [connectionLoginIdentifier, setConnectionLoginIdentifier] = useState("");
  const [connectionSecret, setConnectionSecret] = useState("");
  const [connectionCreateAttempted, setConnectionCreateAttempted] = useState(false);
  const [isCreateConnectionModalOpen, setIsCreateConnectionModalOpen] = useState(false);
  const [activeQrConnectionId, setActiveQrConnectionId] = useState<string | null>(null);
  const [qrRequestingConnectionId, setQrRequestingConnectionId] = useState<string | null>(null);
  const [qrCancellingConnectionId, setQrCancellingConnectionId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedSchedulerMedia, setUploadedSchedulerMedia] = useState<SchedulerUploadedMedia[]>([]);
  const [draggingSchedulerMediaIndex, setDraggingSchedulerMediaIndex] = useState<number | null>(null);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const [jobCompanyId, setJobCompanyId] = useState("");
  const [jobSocialConnectionId, setJobSocialConnectionId] = useState("");
  const [postTitle, setPostTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [publicationType, setPublicationType] = useState<SchedulerPublicationType>("");
  const [publicationState, setPublicationState] = useState<SchedulerPublicationState>("");
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
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [noticesPopoverLoading, setNoticesPopoverLoading] = useState(false);
  const [markingAllAvisosRead, setMarkingAllAvisosRead] = useState(false);
  const [broadcastAvisoTitle, setBroadcastAvisoTitle] = useState("");
  const [broadcastAvisoMessage, setBroadcastAvisoMessage] = useState("");
  const [broadcastAvisoSubmitting, setBroadcastAvisoSubmitting] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [togglingScheduleJobId, setTogglingScheduleJobId] = useState<string | null>(null);
  const [publishingDraftJobId, setPublishingDraftJobId] = useState<string | null>(null);
  const [submittingJob, setSubmittingJob] = useState(false);
  const contentLoadingCounterRef = useRef(0);
  const schedulerMediaInputRef = useRef<HTMLInputElement | null>(null);
  const mediaSectionRef = useRef<HTMLElement | null>(null);
  const historySectionRef = useRef<HTMLElement | null>(null);
  const avisosSectionRef = useRef<HTMLElement | null>(null);
  const noticesBellDesktopRef = useRef<HTMLDivElement | null>(null);
  const noticesBellMobileRef = useRef<HTMLDivElement | null>(null);
  const profileMenuDesktopRef = useRef<HTMLDivElement | null>(null);
  const profileMenuMobileRef = useRef<HTMLDivElement | null>(null);
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
    historyInfo === "Agendamento ativado com sucesso." ||
    historyInfo === "Rascunho publicado com sucesso.";
  const isTransientHistoryInfo =
    historyInfo === "Atualizando agendamento..." ||
    historyInfo === "Publicando rascunho..." ||
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
  const activeAppLogo = themeMode === "dark" ? appLogoAlternative : appLogo;
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

  function startContentLoading() {
    contentLoadingCounterRef.current += 1;
    setContentLoading(true);
  }

  function finishContentLoading() {
    contentLoadingCounterRef.current = Math.max(0, contentLoadingCounterRef.current - 1);
    if (contentLoadingCounterRef.current === 0) {
      setContentLoading(false);
    }
  }

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

    if (view !== activeView) {
      setAuthInfo("");
      setSchedulerInfo("");
      setHistoryInfo("");
      setMediaInfo("");
      setAvisosInfo("");
      setNoticeAdminInfo("");
    }

    setNoticesPopoverOpen(false);
    setProfileMenuOpen(false);
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
    if (!profileMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const clickedDesktopMenu = profileMenuDesktopRef.current?.contains(target) ?? false;
      const clickedMobileMenu = profileMenuMobileRef.current?.contains(target) ?? false;

      if (!clickedDesktopMenu && !clickedMobileMenu) {
        setProfileMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    const handleInstagramOauthMessage = (event: MessageEvent) => {
      const payload = parseInstagramOauthWindowMessage(event.data);
      if (!payload) {
        return;
      }

      if (payload.success) {
        setError("");
        setAuthInfo(payload.message || "Conta conectada com sucesso.");
      } else {
        setAuthInfo("");
        setError(payload.message || "Falha ao concluir autorização do Instagram.");
      }

      try {
        window.focus();
      } catch {
        // Alguns navegadores podem bloquear foco programático.
      }

      void loadAll();
    };

    window.addEventListener("message", handleInstagramOauthMessage);
    return () => {
      window.removeEventListener("message", handleInstagramOauthMessage);
    };
  }, [selectedCompanyId, isRootUser]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get(INSTAGRAM_OAUTH_RESULT_MARKER_QUERY_PARAM) !== "1") {
      return;
    }

    const success = params.get(INSTAGRAM_OAUTH_SUCCESS_QUERY_PARAM) === "1";
    const message = (params.get(INSTAGRAM_OAUTH_MESSAGE_QUERY_PARAM) || "").trim();
    if (success) {
      setError("");
      setAuthInfo(message || "Conta conectada com sucesso.");
    } else {
      setAuthInfo("");
      setError(message || "Falha ao concluir autorização do Instagram.");
    }

    params.delete(INSTAGRAM_OAUTH_RESULT_MARKER_QUERY_PARAM);
    params.delete(INSTAGRAM_OAUTH_SUCCESS_QUERY_PARAM);
    params.delete(INSTAGRAM_OAUTH_MESSAGE_QUERY_PARAM);
    params.delete(INSTAGRAM_OAUTH_CONNECTION_ID_QUERY_PARAM);
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);

    void loadAll();
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
    () =>
      connections.filter((connection) => {
        const matchesCompany = selectedCompanyId ? connection.companyId === selectedCompanyId : true;
        const matchesPlatform =
          connectionPlatformFilter === "all" ? true : connection.platform === connectionPlatformFilter;
        return matchesCompany && matchesPlatform;
      }),
    [connections, selectedCompanyId, connectionPlatformFilter],
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
    const eligibleUpcomingJobs = jobsOrderedByCreatedAtDesc.filter(
      (job) =>
        job.publicationState === "PUBLISHED" &&
        (job.status === "RUNNING" ||
          (!isPastScheduledAt(job.dataPostagem) &&
            (job.status === "PENDING" || job.status === "WAITING_LOGIN"))),
    );

    const runningJobs = eligibleUpcomingJobs.filter((job) => job.status === "RUNNING");
    const scheduledJobs = eligibleUpcomingJobs.filter((job) => job.status !== "RUNNING");
    return [...runningJobs, ...scheduledJobs].slice(0, 5);
  }, [jobsOrderedByCreatedAtDesc]);

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
              job.publicationState === "PUBLISHED" &&
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
          return jobsOrderedByCreatedAtDesc.filter((job) => job.status === "FAILED");
        case "waiting_login":
          return jobsOrderedByCreatedAtDesc.filter((job) => job.status === "WAITING_LOGIN");
        case "draft":
          return jobsOrderedByCreatedAtDesc.filter((job) => job.publicationState === "DRAFT");
        case "published":
          return jobsOrderedByCreatedAtDesc.filter((job) => job.publicationState === "PUBLISHED");
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
          return mediaLibrary.filter((media) => media.lastStatus === "FAILED");
        case "waiting_login":
          return mediaLibrary.filter((media) => media.lastStatus === "WAITING_LOGIN");
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

  async function loadAll(options?: { withSkeleton?: boolean }): Promise<void> {
    const withSkeleton = options?.withSkeleton ?? true;
    const loadingStartedAt = withSkeleton ? Date.now() : 0;
    if (withSkeleton) {
      startContentLoading();
    }

    try {
      const companyFilter = selectedCompanyId ? `?companyId=${selectedCompanyId}` : "";
      const logsPromise = isRootUser ? api.get<Log[]>(`/logs${companyFilter}`) : Promise.resolve<Log[]>([]);
      const [companiesData, connectionsData, jobsData, logsData, dashboardData] =
        await Promise.all([
          api.get<Company[]>("/companies"),
          api.get<SocialConnection[]>(`/connections${companyFilter}`),
          api.get<Job[]>(`/jobs${companyFilter}`),
          logsPromise,
          api.get<Dashboard>(`/dashboard${companyFilter}`),
        ]);

      setCompanies(companiesData);
      setConnections(connectionsData);
      setJobs(jobsData);
      setLogs(logsData);
      setDashboard(dashboardData);

      setError("");
    } catch (loadError) {
      if (loadError instanceof Error && loadError.message.includes("Sessao invalida")) {
        api.setSessionToken("");
        setAuthUser(null);
        setAuthError("Sua sessão expirou. Faça login novamente.");
        return;
      }

      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar dados.");
    } finally {
      if (withSkeleton) {
        const elapsed = Date.now() - loadingStartedAt;
        if (elapsed < CONTENT_SKELETON_MIN_MS) {
          await delay(CONTENT_SKELETON_MIN_MS - elapsed);
        }
        finishContentLoading();
      }
    }
  }

  async function loadAvisosPage(page: number, options?: { withSkeleton?: boolean }): Promise<void> {
    const withSkeleton = options?.withSkeleton ?? true;
    const loadingStartedAt = withSkeleton ? Date.now() : 0;
    if (withSkeleton) {
      startContentLoading();
    }

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
    } finally {
      if (withSkeleton) {
        const elapsed = Date.now() - loadingStartedAt;
        if (elapsed < CONTENT_SKELETON_MIN_MS) {
          await delay(CONTENT_SKELETON_MIN_MS - elapsed);
        }
        finishContentLoading();
      }
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

    if (activeView === "notices" || activeView === "profile" || activeView === "plan") {
      return;
    }

    void loadAll({ withSkeleton: true });
  }, [selectedCompanyId, authUser, activeView]);

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
        void loadAll({ withSkeleton: false });
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
    let firstLoad = true;

    const refreshAvisosPage = () => {
      if (cancelled) {
        return;
      }
      void loadAvisosPage(avisosPage, { withSkeleton: firstLoad });
      firstLoad = false;
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

    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    window.document.body.classList.toggle("theme-dark", themeMode === "dark");
  }, [themeMode]);

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
      setProfileMenuOpen(false);
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

  async function createCompany(event: FormEvent) {
    event.preventDefault();
    await api.postJson("/companies", { name: companyName });
    setCompanyName("");
    await loadAll();
  }

  async function createConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConnectionCreateAttempted(true);
    const formElement = event.currentTarget;
    if (!formElement.reportValidity()) {
      return;
    }

    const normalizedCompanyId = connectionCompanyId.trim();
    if (!normalizedCompanyId) {
      setAuthInfo("");
      setError("Selecione o perfil para adicionar a conta.");
      return;
    }
    const loginIdentifierPayload = connectionPlatform === "whatsapp" ? connectionLoginIdentifier || null : null;
    await api.postJson("/connections", {
      companyId: normalizedCompanyId,
      platform: connectionPlatform,
      displayName: connectionDisplayName,
      loginIdentifier: loginIdentifierPayload,
      secret: connectionSecret || null,
    });
    setConnectionDisplayName("");
    setConnectionLoginIdentifier("");
    setConnectionSecret("");
    setConnectionCreateAttempted(false);
    setIsCreateConnectionModalOpen(false);
    await loadAll();
  }

  function openCreateConnectionModal(platform: SocialConnection["platform"]) {
    setConnectionPlatform(platform);
    setConnectionDisplayName("");
    setConnectionCompanyId("");
    setConnectionLoginIdentifier("");
    setConnectionSecret("");
    setConnectionCreateAttempted(false);
    setIsCreateConnectionModalOpen(true);
    setError("");
    setAuthInfo("");
  }

  async function openConnectionVisualAuth(connectionId: string) {
    const connection = connections.find((entry) => entry.id === connectionId);
    const isWhatsappConnection = connection?.platform === "whatsapp";
    const returnToUrl = new URL(buildViewHref("agents"), window.location.origin).toString();

    if (isWhatsappConnection) {
      setActiveQrConnectionId(connectionId);
      setQrRequestingConnectionId(connectionId);
    }

    try {
      const result = await api.postJson<{ launchUrl?: string }>(
        "/connections/" + connectionId + "/open-visual-auth",
        isWhatsappConnection ? {} : { returnToUrl },
      );
      await loadAll();
      setError("");
      if (isWhatsappConnection) {
        return;
      }

      if (!result.launchUrl) {
        setError("A URL de autorização do Instagram não foi retornada pelo backend.");
        return;
      }

      window.location.assign(result.launchUrl);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Falha ao iniciar a autorização.");
    } finally {
      if (isWhatsappConnection) {
        setQrRequestingConnectionId((current) => (current === connectionId ? null : current));
      }
    }
  }

  async function regenerateConnectionQr(connectionId: string) {
    if (qrCancellingConnectionId === connectionId) {
      return;
    }
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

  async function cancelConnectionQr(connectionId: string) {
    setQrCancellingConnectionId(connectionId);
    setActiveQrConnectionId((current) => (current === connectionId ? null : current));
    setQrRequestingConnectionId((current) => (current === connectionId ? null : current));
    try {
      await api.postJson(`/connections/${connectionId}/dismiss-qr`, {});
      await loadAll();
      setError("");
    } finally {
      setQrCancellingConnectionId((current) => (current === connectionId ? null : current));
    }
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

    if (!publicationState) {
      setError("");
      setSchedulerInfo("Selecione um status da publicação.");
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
      publicationState,
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
    setPublicationState("");
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
    setPublicationState(job.publicationState === "DRAFT" ? "DRAFT" : "PUBLISHED");
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

      await loadAll();
      setMediaInfo("Mídia excluída com sucesso.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Falha ao excluir mídia.");
      setMediaInfo("");
    }
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

  async function publishDraft(job: Job) {
    if (job.publicationState !== "DRAFT") {
      return;
    }

    const willRunImmediately = isPastScheduledAt(job.dataPostagem);
    if (
      willRunImmediately &&
      !window.confirm(
        "Este rascunho está com data/hora no passado. Ao publicar agora, ele pode executar imediatamente. Deseja continuar?",
      )
    ) {
      return;
    }

    setError("");
    setPublishingDraftJobId(job.id);
    setHistoryInfo("Publicando rascunho...");

    try {
      await api.postJson(`/jobs/${job.id}/publish`, {});
      setHistoryInfo("Rascunho publicado com sucesso.");
      await loadAll();
    } catch (publishError) {
      setHistoryInfo("");
      setError(publishError instanceof Error ? publishError.message : "Falha ao publicar o rascunho.");
    } finally {
      setPublishingDraftJobId(null);
    }
  }

  function openHistoryWithFilter(filter: HistoryFilterKey): void {
    navigateToView("history", { historyFilter: filter });
  }

  async function toggleNoticesPopover() {
    setProfileMenuOpen(false);

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
        await loadAvisosPage(avisosPage, { withSkeleton: false });
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
        await loadAvisosPage(avisosPage, { withSkeleton: false });
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
      setProfileMenuOpen(false);
      setActiveView("dashboard");
      contentLoadingCounterRef.current = 0;
      setContentLoading(false);
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
    setPublicationState("");
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

  function renderProfileMenu(shellRef: { current: HTMLDivElement | null }, extraClassName = "") {
    return (
      <div ref={shellRef} className={`profile-menu-shell${extraClassName ? ` ${extraClassName}` : ""}`}>
        <button
          type="button"
          className={`profile-trigger ${(activeView === "profile" || activeView === "plan") ? "profile-trigger-active" : ""}`}
          onClick={() => {
            setNoticesPopoverOpen(false);
            setProfileMenuOpen((current) => !current);
          }}
          aria-haspopup="menu"
          aria-expanded={profileMenuOpen}
        >
          <span className="profile-icon" aria-hidden="true" />
          <span className="profile-trigger-label">Minha Conta</span>
        </button>

        {profileMenuOpen ? (
          <div className="profile-menu-dropdown" role="menu">
            <button
              type="button"
              className={`profile-menu-item ${activeView === "profile" ? "profile-menu-item-active" : ""}`}
              onClick={() => navigateToView("profile")}
            >
              Meu perfil
            </button>
            <button
              type="button"
              className={`profile-menu-item ${activeView === "plan" ? "profile-menu-item-active" : ""}`}
              onClick={() => navigateToView("plan")}
            >
              Meu plano
            </button>
          </div>
        ) : null}
      </div>
    );
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
          <img src={activeAppLogo} alt="SocialUp" className="brand-logo auth-brand-logo" />
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
              Controle o seu calendario de postagens das redes sociais da sua empresa e perfis separadamente em uma
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
                  <div
                    key={job.id}
                    className={`row-card${job.status === "RUNNING" ? " row-card-running-live" : ""}`}
                  >
                    <div>
                      <strong>{resolveJobDisplayTitle(job)}</strong>
                      <div className="meta-pill-row">
                        {renderPublicationTypePill(job.publicationType)}
                        <span className="unit-pill">
                          {`Perfil: ${companyNameMap[job.companyId] || "Perfil removido"}`}
                        </span>
                      </div>
                    </div>
                    <div className="inline-actions">
                      <span>{formatDate(job.dataPostagem)}</span>
                      {job.status === "RUNNING" ? (
                        <span className="status-pill status-running-live">
                          <span className="status-pill-spinner" aria-hidden="true" />
                          Executando
                        </span>
                      ) : (
                        <span className={`status-pill status-${jobStatusTone(job)}`}>{jobStatusDisplayLabel(job)}</span>
                      )}
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

  function renderConnectionPlatformFilter() {
    return (
      <div className="inline-filter">
        <span>Filtrar rede</span>
        <select
          value={connectionPlatformFilter}
          onChange={(event) => setConnectionPlatformFilter(event.target.value as ConnectionPlatformFilter)}
        >
          <option value="all">Todas</option>
          <option value="instagram">Instagram</option>
          <option value="whatsapp">WhatsApp</option>
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
          <option value="sent">Publicados</option>
          <option value="failed">Falhados</option>
          <option value="waiting_login">Aguardando login</option>
          <option value="draft">Rascunhos</option>
          <option value="published">Publicados</option>
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
          <option value="sent">Publicados</option>
          <option value="failed">Falhados</option>
          <option value="waiting_login">Aguardando login</option>
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

  function renderSectionTitleWithIcon(view: ViewKey, title: string, kicker?: string) {
    const Icon = viewHeadingIconByView[view];
    return (
      <div>
        {kicker ? <span className="section-kicker">{kicker}</span> : null}
        <div className="view-title-with-icon">
          {Icon ? (
            <span className="view-title-icon" aria-hidden="true">
              <Icon />
            </span>
          ) : null}
          <h2>{title}</h2>
        </div>
      </div>
    );
  }

  function renderProfile() {
    return (
      <div className="view-stack">
        <section className="panel-card view-stack">
          <h2 className="profile-page-title">Minha Conta</h2>
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

  function renderPlan() {
    return <section className="plan-empty-view" aria-label="Meu plano" />;
  }

  function renderCompanies() {
    return (
      <section className="panel-card view-stack">
        <div className="section-head">
          {renderSectionTitleWithIcon("companies", "Perfis", "setup")}
        </div>
        <form onSubmit={createCompany} className="form-grid">
          <input
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            placeholder="Nome do perfil"
            required
            minLength={2}
            maxLength={80}
            title="Informe o nome do perfil com 2 a 80 caracteres."
          />
          <button type="submit">Criar perfil</button>
        </form>
        <div className="table-list">
          {companies.map((company) => (
            <div key={company.id} className="row-card">
              <div>
                <strong>{company.name}</strong>
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
          {renderSectionTitleWithIcon("agents", "Conectar contas", "operação")}
          <div className="inline-actions">
            {renderCompanyFilter("Filtrar perfil")}
            {renderConnectionPlatformFilter()}
          </div>
        </div>

        <section className="connection-platform-grid" aria-label="Selecionar plataforma para conectar conta">
          {connectionPlatformOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.platform}
                type="button"
                className="connection-platform-card"
                data-platform={option.platform}
                onClick={() => openCreateConnectionModal(option.platform)}
                title={`Adicionar conta ${option.label}`}
                aria-label={`Adicionar conta ${option.label}`}
              >
                <span className="connection-platform-card-icon" aria-hidden="true">
                  <Icon />
                </span>
              </button>
            );
          })}
        </section>

        <div className="table-list">
          {filteredConnections.map((connection) => (
            <div key={connection.id} className="row-card connection-row">
              <div className="agent-meta">
                <strong className="agent-title-with-platform-icon">
                  {connection.platform === "instagram" ? <FaInstagram aria-hidden="true" /> : <FaWhatsapp aria-hidden="true" />}
                  {connection.displayName}
                </strong>
                <div className="meta-pill-row">
                  <span className="unit-pill">
                    {`Perfil: ${companyNameMap[connection.companyId] || "Perfil removido"}`}
                  </span>
                  {connection.platform === "whatsapp" && connection.authStatus === "CONNECTED" ? (
                    <span className="connection-connected-text">Conectado</span>
                  ) : null}
                </div>
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
                    disabled={qrRequestingConnectionId === connection.id || qrCancellingConnectionId === connection.id}
                    onClick={() => void regenerateConnectionQr(connection.id)}
                  >
                    {qrCancellingConnectionId === connection.id
                      ? "Cancelando..."
                      : qrRequestingConnectionId === connection.id
                        ? "Gerando..."
                        : "Gerar novo QR"}
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
          {renderSectionTitleWithIcon("scheduler", editingJobId ? "Editar job" : "Agendar Postagem", "agenda")}
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
          <div className="form-grid form-grid-three">
            <select
              value={publicationType}
              onChange={(event) => setPublicationType(event.target.value as SchedulerPublicationType)}
              disabled={submittingJob}
              required
            >
              <option value="">Selecione o tipo de postagem</option>
              <option value="instagram_reel">Instagram - Reels</option>
              <option value="instagram_post">Instagram - Posts</option>
              <option value="instagram_story">Instagram - Stories</option>
              <option value="whatsapp_status_midia">WhatsApp - Status (midia)</option>
            </select>
            <select
              value={publicationState}
              onChange={(event) => setPublicationState(event.target.value as SchedulerPublicationState)}
              disabled={submittingJob}
              required
            >
              <option value="">Selecione um status</option>
              <option value="PUBLISHED">Publicado</option>
              <option value="DRAFT">Rascunho</option>
            </select>
            <select value={jobCompanyId} onChange={(event) => setJobCompanyId(event.target.value)} required>
              <option value="">Selecione o perfil</option>
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
              placeholder="Ex: Oferta da semana - perfil Centro"
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

          <div className="text-chip">
            {publicationState === "DRAFT"
              ? "Rascunho não entra em execução automática, independente de data e horário."
              : "Se o horário ficar em branco, a postagem usa o horário atual ao salvar."}
          </div>

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
                : "Nenhuma conta conectada para este perfil e rede"}
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
                  <img src={`${api.baseUrl}${media.filePath}`} alt={`Prévia ${index + 1}`} />
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
          {renderSectionTitleWithIcon("media", "Mídias por perfil", "Biblioteca")}
        </div>
        <div className="history-filters-grid">
          {renderCompanyFilter("Filtrar perfil")}
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
                    <img
                      src={media.previewUrl}
                      alt={media.caption || "Midia"}
                      decoding="async"
                      className="media-preview-image"
                    />
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
          {renderSectionTitleWithIcon("history", "Histórico", "timeline")}
        </div>
        <div className="history-filters-grid">
          {renderCompanyFilter("Filtrar perfil")}
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
                <div className="meta-pill-row">
                  {renderPublicationTypePill(job.publicationType)}
                  <span className="unit-pill">{`Perfil: ${companyNameMap[job.companyId] || "Perfil removido"}`}</span>
                </div>
                {job.locationName ? <span>Localização: {job.locationName}</span> : null}
                <span>{formatDate(job.dataPostagem)}</span>
              </div>
              <div className="inline-actions">
                <span className={`status-pill status-${jobStatusTone(job)}`}>{jobStatusDisplayLabel(job)}</span>
                {job.publicationState === "DRAFT" ? (
                  <button
                    type="button"
                    className="activate-button"
                    onClick={() => void publishDraft(job)}
                    disabled={publishingDraftJobId === job.id}
                  >
                    {publishingDraftJobId === job.id ? "Publicando..." : "Publicar"}
                  </button>
                ) : null}
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
                {job.publicationState !== "DRAFT" &&
                (job.status === "FAILED" || job.status === "WAITING_LOGIN" || job.status === "SENT_UNCONFIRMED") ? (
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
          {renderSectionTitleWithIcon("logs", "Alertas e logs de erro", "debug")}
          <div className="inline-actions">
            {renderCompanyFilter("Filtrar perfil")}
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
          {filteredLogs.length === 0 ? <div className="empty-state">Nenhum alerta de erro para este perfil.</div> : null}
        </div>
      </section>
    );
  }

  function renderNotices() {
    return (
      <section ref={avisosSectionRef} className="panel-card view-stack">
        <div className="section-head">
          {renderSectionTitleWithIcon("notices", "Avisos", "painel")}
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
          {renderSectionTitleWithIcon("noticeAdmin", "Cadastrar avisos", "root")}
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

  function renderSkeletonSectionHead(filterCount = 0) {
    return (
      <div className="section-head skeleton-section-head" aria-hidden="true">
        <div className="skeleton-title-stack">
          <span className="skeleton-line skeleton-line-kicker" />
          <span className="skeleton-line skeleton-line-heading" />
        </div>
        {filterCount > 0 ? (
          <div className="skeleton-filter-group">
            {Array.from({ length: filterCount }, (_, index) => (
              <span key={`skeleton-filter-${index}`} className="skeleton-line skeleton-line-filter" />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function renderSkeletonRows(count: number) {
    return (
      <div className="table-list" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <div key={`skeleton-row-${index}`} className="row-card skeleton-row-card">
            <div className="skeleton-row-main">
              <span className="skeleton-line skeleton-line-title" />
              <div className="meta-pill-row">
                <span className="skeleton-line skeleton-line-pill" />
                <span className="skeleton-line skeleton-line-pill skeleton-line-pill-wide" />
              </div>
              <span className="skeleton-line skeleton-line-text" />
            </div>
            <div className="inline-actions skeleton-inline-actions">
              <span className="skeleton-line skeleton-line-chip" />
              <span className="skeleton-line skeleton-line-button" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderDashboardSkeleton() {
    return (
      <div className="view-stack skeleton-shell" aria-busy="true">
        <section className="hero-card">
          <div className="skeleton-stack" aria-hidden="true">
            <span className="skeleton-line skeleton-line-kicker" />
            <span className="skeleton-line skeleton-line-heading skeleton-line-heading-wide" />
            <span className="skeleton-line skeleton-line-text skeleton-line-text-wide" />
            <span className="skeleton-line skeleton-line-text skeleton-line-text-medium" />
          </div>
        </section>

        <section className="stats-grid" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <article key={`dashboard-metric-skeleton-${index}`} className="metric-card skeleton-metric-card">
              <span className="skeleton-line skeleton-line-chip" />
              <span className="skeleton-line skeleton-line-metric-value" />
            </article>
          ))}
        </section>

        <section className="content-grid">
          <article className="panel-card full-width-panel">
            {renderSkeletonSectionHead(1)}
            {renderSkeletonRows(3)}
          </article>
        </section>
      </div>
    );
  }

  function renderCompaniesSkeleton() {
    return (
      <section className="panel-card view-stack skeleton-shell" aria-busy="true">
        {renderSkeletonSectionHead()}
        <div className="form-grid" aria-hidden="true">
          <span className="skeleton-line skeleton-line-input" />
          <span className="skeleton-line skeleton-line-button" />
        </div>
        {renderSkeletonRows(4)}
      </section>
    );
  }

  function renderAgentsSkeleton() {
    return (
      <section className="panel-card view-stack skeleton-shell" aria-busy="true">
        {renderSkeletonSectionHead(2)}
        <section className="connection-platform-grid" aria-hidden="true">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={`connection-platform-skeleton-${index}`} className="connection-platform-card skeleton-platform-card" />
          ))}
        </section>
        {renderSkeletonRows(3)}
      </section>
    );
  }

  function renderSchedulerSkeleton() {
    return (
      <section className="panel-card view-stack skeleton-shell" aria-busy="true">
        {renderSkeletonSectionHead(1)}
        <div className="form-stack" aria-hidden="true">
          <div className="form-grid form-grid-three">
            <span className="skeleton-line skeleton-line-input" />
            <span className="skeleton-line skeleton-line-input" />
            <span className="skeleton-line skeleton-line-input" />
          </div>
          <span className="skeleton-line skeleton-line-input" />
          <div className="form-grid form-grid-two scheduler-top-grid">
            <span className="skeleton-line skeleton-line-input" />
            <span className="skeleton-line skeleton-line-input" />
          </div>
          <span className="skeleton-line skeleton-line-text" />
          <div className="form-grid form-grid-two">
            <span className="skeleton-line skeleton-line-input" />
            <span className="skeleton-line skeleton-line-input" />
          </div>
          <div className="upload-shell">
            <span className="skeleton-line skeleton-line-input" />
            <span className="skeleton-line skeleton-line-text skeleton-line-text-wide" />
          </div>
          <span className="skeleton-line skeleton-line-input" />
          <span className="skeleton-line skeleton-line-button skeleton-line-button-wide" />
        </div>
      </section>
    );
  }

  function renderMediaSkeleton() {
    return (
      <section className="panel-card view-stack skeleton-shell" aria-busy="true">
        {renderSkeletonSectionHead()}
        <div className="history-filters-grid" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <span key={`media-filter-skeleton-${index}`} className="skeleton-line skeleton-line-filter" />
          ))}
        </div>
        <div className="media-grid" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <article key={`media-skeleton-${index}`} className="media-card skeleton-media-card">
              <div className="media-preview skeleton-media-preview" />
              <div className="inline-actions">
                <span className="skeleton-line skeleton-line-button" />
                <span className="skeleton-line skeleton-line-button" />
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  function renderHistorySkeleton() {
    return (
      <section className="panel-card view-stack skeleton-shell" aria-busy="true">
        {renderSkeletonSectionHead()}
        <div className="history-filters-grid" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <span key={`history-filter-skeleton-${index}`} className="skeleton-line skeleton-line-filter" />
          ))}
        </div>
        {renderSkeletonRows(4)}
      </section>
    );
  }

  function renderLogsSkeleton() {
    return (
      <section className="panel-card view-stack skeleton-shell" aria-busy="true">
        {renderSkeletonSectionHead(1)}
        {renderSkeletonRows(4)}
      </section>
    );
  }

  function renderNoticesSkeleton() {
    return (
      <section className="panel-card view-stack skeleton-shell" aria-busy="true">
        {renderSkeletonSectionHead(1)}
        {renderSkeletonRows(4)}
      </section>
    );
  }

  function renderNoticeAdminSkeleton() {
    return (
      <section className="panel-card view-stack skeleton-shell" aria-busy="true">
        {renderSkeletonSectionHead()}
        <div className="form-stack" aria-hidden="true">
          <span className="skeleton-line skeleton-line-input" />
          <span className="skeleton-line skeleton-line-textarea" />
          <span className="skeleton-line skeleton-line-button skeleton-line-button-wide" />
        </div>
      </section>
    );
  }

  function renderProfileSkeleton() {
    return (
      <div className="view-stack skeleton-shell" aria-busy="true">
        <section className="panel-card view-stack">
          <span className="skeleton-line skeleton-line-heading" />
          <div className="form-stack" aria-hidden="true">
            <span className="skeleton-line skeleton-line-input" />
            <span className="skeleton-line skeleton-line-input" />
            <span className="skeleton-line skeleton-line-input" />
            <span className="skeleton-line skeleton-line-button skeleton-line-button-wide" />
          </div>
        </section>
      </div>
    );
  }

  function renderPlanSkeleton() {
    return <section className="plan-empty-view" aria-label="Carregando plano" />;
  }

  function renderContentSkeleton() {
    switch (activeView) {
      case "dashboard":
        return renderDashboardSkeleton();
      case "companies":
        return renderCompaniesSkeleton();
      case "agents":
        return renderAgentsSkeleton();
      case "scheduler":
        return renderSchedulerSkeleton();
      case "media":
        return renderMediaSkeleton();
      case "history":
        return renderHistorySkeleton();
      case "logs":
        return renderLogsSkeleton();
      case "notices":
        return renderNoticesSkeleton();
      case "noticeAdmin":
        return renderNoticeAdminSkeleton();
      case "profile":
        return renderProfileSkeleton();
      case "plan":
        return renderPlanSkeleton();
      default:
        return renderDashboardSkeleton();
    }
  }

  function renderContent() {
    if (contentLoading) {
      return renderContentSkeleton();
    }

    switch (activeView) {
      case "profile":
        return renderProfile();
      case "plan":
        return renderPlan();
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
          <span className="sidebar-close-icon" aria-hidden="true">×</span>
        </button>
        <nav className="nav-list">
          {visibleNavItems.map((item) => (
            <a
              key={item.key}
              href={buildViewHref(item.key)}
              className={`nav-item ${activeView === item.key ? "nav-item-active" : ""}`}
              data-tooltip={item.label}
              onClick={(event) => {
                event.preventDefault();
                navigateToView(item.key);
              }}
            >
              <span className="nav-item-icon" aria-hidden="true">
                <item.icon />
              </span>
              <span className="nav-item-content">
                {item.eyebrow ? <span className="nav-eyebrow">{item.eyebrow}</span> : null}
                <span className="nav-item-label">{item.label}</span>
              </span>
            </a>
          ))}
        </nav>

      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="topbar-heading">
            <img src={activeAppLogo} alt="SocialUp" className="topbar-logo" />
          </div>
          <div className="topbar-mobile-actions">
            {renderNoticesBell(noticesBellMobileRef, "notices-shell-mobile")}
            <button
              type="button"
              className="theme-toggle"
              aria-label={themeMode === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
              title={themeMode === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
              onClick={() => setThemeMode((current) => (current === "dark" ? "light" : "dark"))}
            >
              {themeMode === "dark" ? <FiSun aria-hidden="true" /> : <FiMoon aria-hidden="true" />}
            </button>
            {renderProfileMenu(profileMenuMobileRef, "mobile-profile-trigger")}
            <button
              type="button"
              className="menu-toggle"
              aria-label="Abrir menu"
              onClick={() => {
                setNoticesPopoverOpen(false);
                setProfileMenuOpen(false);
                setSidebarOpen((current) => !current);
              }}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
          <div className="topbar-actions">
            {renderProfileMenu(profileMenuDesktopRef)}
            {renderNoticesBell(noticesBellDesktopRef)}
            <button
              type="button"
              className="theme-toggle"
              aria-label={themeMode === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
              title={themeMode === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
              onClick={() => setThemeMode((current) => (current === "dark" ? "light" : "dark"))}
            >
              {themeMode === "dark" ? <FiSun aria-hidden="true" /> : <FiMoon aria-hidden="true" />}
            </button>
            <button type="button" className="danger-button logout-button" onClick={() => void logout()}>
              Sair
            </button>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}
        {authInfo ? <div className={`info-banner${isPositiveAuthInfo ? " info-banner-success" : ""}`}>{authInfo}</div> : null}

        {renderContent()}

        {isCreateConnectionModalOpen ? (
          <button
            type="button"
            className="connection-create-modal-backdrop"
            aria-label="Fechar cadastro de conta"
            onClick={() => {
              setConnectionCreateAttempted(false);
              setIsCreateConnectionModalOpen(false);
            }}
          >
            <section
              className="connection-create-modal"
              aria-label="Cadastrar nova conta"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="connection-create-modal-header">
                <div>
                  <strong>{`Adicionar ${connectionPlatformLabel(connectionPlatform)}`}</strong>
                </div>
                <button
                  type="button"
                  className="qr-modal-close"
                  aria-label="Fechar"
                  title="Fechar"
                  onClick={() => {
                    setConnectionCreateAttempted(false);
                    setIsCreateConnectionModalOpen(false);
                  }}
                >
                  <span className="modal-close-icon" aria-hidden="true">
                    ×
                  </span>
                </button>
              </div>
              <form
                onSubmit={createConnection}
                className={`connection-create-form${connectionCreateAttempted ? " connection-create-form-attempted" : ""}`}
              >
                <label className="field-label">
                  Nome
                  <input
                    value={connectionDisplayName}
                    onChange={(event) => setConnectionDisplayName(event.target.value)}
                    placeholder="Ex: Matriz Instagram"
                    required
                    minLength={2}
                    maxLength={80}
                    title="Informe um nome interno para identificar essa conta conectada."
                  />
                </label>
                <label className="field-label">
                  Perfil
                  <select
                    value={connectionCompanyId}
                    onChange={(event) => setConnectionCompanyId(event.target.value)}
                    required
                  >
                    <option value="">Selecione o perfil</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="connection-create-modal-actions">
                  <button type="submit">Adicionar conta</button>
                </div>
              </form>
            </section>
          </button>
        ) : null}

        {activeQrConnectionId ? (
          <button
            type="button"
            className="qr-modal-backdrop"
            aria-label="Fechar QR do WhatsApp"
            onClick={() => void cancelConnectionQr(activeQrConnectionId)}
          >
            <section className="qr-modal" aria-label="QR do WhatsApp" onClick={(event) => event.stopPropagation()}>
              <div className="qr-modal-header">
                <div>
                  <strong>QR do WhatsApp</strong>
                </div>
                <button
                  type="button"
                  className="qr-modal-close"
                  aria-label="Fechar"
                  title="Fechar"
                  onClick={() => void cancelConnectionQr(activeQrConnectionId)}
                >
                  <span className="modal-close-icon" aria-hidden="true">
                    ×
                  </span>
                </button>
              </div>

              <div className="qr-shell qr-shell-modal">
                {activeQrConnection?.qrImageDataUrl ? (
                  <img className="qr-image" src={activeQrConnection.qrImageDataUrl} alt="QR Code do WhatsApp" />
                ) : (
                  <div className="qr-placeholder">
                    {activeQrState === "PREPARING" ? <span className="spinner" aria-hidden="true" /> : null}
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
                    disabled={qrCancellingConnectionId === activeQrConnectionId}
                    onClick={() => void cancelConnectionQr(activeQrConnectionId)}
                  >
                    {qrCancellingConnectionId === activeQrConnectionId ? "Cancelando..." : "Cancelar geração"}
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
