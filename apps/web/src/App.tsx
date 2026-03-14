import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { IconType } from "react-icons";
import {
  FiAlertCircle,
  FiBarChart2,
  FiBell,
  FiCalendar,
  FiCheckCircle,
  FiChevronLeft,
  FiChevronRight,
  FiClock,
  FiDownload,
  FiEdit3,
  FiFileText,
  FiHome,
  FiImage,
  FiLink2,
  FiMapPin,
  FiRotateCcw,
  FiSmile,
  FiTrash2,
  FiType,
  FiUsers,
  FiUser,
  FiCreditCard,
  FiWifi,
  FiX,
  FiEye,
  FiEyeOff,
  FiMoon,
  FiSun,
  FiTrendingUp,
} from "react-icons/fi";
import { FaInstagram, FaWhatsapp } from "react-icons/fa6";
import { api } from "./api";
import appLogo from "./assets/logo.svg";
import appLogoAlternative from "./assets/logo-alternativo.svg";

type ViewKey =
  | "dashboard"
  | "profile"
  | "plan"
  | "planConfig"
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
type HistoryBulkAction = "" | "SET_PUBLISHED" | "SET_DRAFT" | "SET_SCHEDULE" | "SET_COMPANY";
type PublicationState = "PUBLISHED" | "DRAFT";
type SchedulerPublicationState = PublicationState | "";
type StoryEditorToolMode = "MOVE" | "DRAW";
type DashboardTrendRange = "7" | "30" | "90";
type DashboardTrendNetwork = "all" | "instagram" | "whatsapp";
type DashboardTrendFocus = "all" | "published" | "failed" | "scheduled";

type StoryEditorStrokePoint = {
  x: number;
  y: number;
};

type StoryEditorStroke = {
  id: string;
  color: string;
  size: number;
  points: StoryEditorStrokePoint[];
};

type StoryEditorDecorSticker = {
  id: string;
  emoji: string;
  x: number;
  y: number;
};

type StoryEditorTextSticker = {
  id: string;
  text: string;
  x: number;
  y: number;
  textColor: string;
  backgroundColor: string;
  fontFamily: string;
  scale: number;
};

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
  instagramUsername?: string | null;
  instagramUserId?: string | null;
  whatsappProfileName?: string | null;
  whatsappOwnerJid?: string | null;
};

type Job = {
  id: string;
  companyId: string;
  socialConnectionId: string | null;
  filePath: string;
  filePaths?: string[];
  fileCaptions?: Array<string | null>;
  sequential?: boolean;
  title?: string | null;
  caption: string | null;
  firstComment?: string | null;
  whatsappBackgroundColor?: string | null;
  whatsappRelinkEnabled?: boolean;
  whatsappRelinkConnectionIds?: string[];
  instagramPermalink?: string | null;
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
  caption?: string | null;
};

const DEFAULT_WHATSAPP_BACKGROUND_COLOR = "#202C33";

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
  timeZone: string;
  role: string;
  billingStatus?: string;
  billingPlanName?: string | null;
  billingPlanCode?: string | null;
  billingIsBlocked?: boolean;
  billingBlockMessage?: string | null;
  billingEndsAt?: string | null;
  billingTrialEndsAt?: string | null;
};

type BillingPlan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isTrial: boolean;
  maxProfiles: number;
  maxConnections: number;
  maxMonthlyPublications: number;
  monthlyPriceCents: number | null;
  yearlyPriceCents: number | null;
  stripeProductId: string | null;
  stripeMonthlyPriceId: string | null;
  stripeYearlyPriceId: string | null;
  stripePixMonthlyPriceId: string | null;
  stripePixYearlyPriceId: string | null;
  createdAt: string;
  updatedAt: string;
};

type StripeCatalogProduct = {
  id: string;
  name: string;
  active: boolean;
  defaultPriceId: string | null;
};

type StripeCatalogResponse = {
  products: StripeCatalogProduct[];
  resolvedByProduct: Record<
    string,
    {
      stripeMonthlyPriceId: string | null;
      stripeYearlyPriceId: string | null;
      stripePixMonthlyPriceId: string | null;
      stripePixYearlyPriceId: string | null;
      stripeMonthlyPriceCents: number | null;
      stripeYearlyPriceCents: number | null;
      stripePixMonthlyPriceCents: number | null;
      stripePixYearlyPriceCents: number | null;
    }
  >;
};

type BillingSettings = {
  autoTrialEnabled: boolean;
  autoTrialDays: number;
  rootDisplayPlanId: string | null;
};

type BillingMe = {
  status: string;
  billingModel: string;
  cycle: string | null;
  isBlocked: boolean;
  blockMessage: string | null;
  startsAt: string | null;
  endsAt: string | null;
  trialEndsAt: string | null;
  plan: {
    id: string;
    code: string;
    name: string;
    isTrial: boolean;
    maxProfiles: number;
    maxConnections: number;
    maxMonthlyPublications: number;
  } | null;
  usage: {
    profilesUsed: number;
    connectionsUsed: number;
    postsUsedThisMonth: number;
  };
  canCancelStripeSubscription?: boolean;
  stripeCancelAtPeriodEnd?: boolean;
};

type BillingUserDiscountItem = {
  id: string;
  name: string;
  username: string;
  role: string;
  createdAt: string;
  billingDiscountEnabled: boolean;
  billingDiscountPercent: number;
  billingStatus: string;
  billingModel: string;
  billingCycle: string | null;
  billingPlanName: string | null;
  billingPlanCode: string | null;
};

type BillingUserDiscountListResponse = {
  items: BillingUserDiscountItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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
  { key: "planConfig", label: "Configurar planos", icon: FiCreditCard },
  { key: "agents", label: "Conectar contas", icon: FiLink2 },
  { key: "scheduler", label: "Agendar", icon: FiCalendar },
  { key: "history", label: "Histórico", icon: FiClock },
  { key: "media", label: "Midias", icon: FiImage },
  { key: "noticeAdmin", label: "Cadastrar avisos", icon: FiBell },
  { key: "logs", label: "Logs", icon: FiFileText },
];

const viewHeadingIconByView: Partial<Record<ViewKey, IconType>> = {
  dashboard: FiHome,
  profile: FiUser,
  plan: FiCreditCard,
  planConfig: FiCreditCard,
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
const STRIPE_CHECKOUT_RESULT_QUERY_PARAM = "stripeCheckout";
const STRIPE_CHECKOUT_SESSION_ID_QUERY_PARAM = "session_id";
const BILLING_PLAN_CHECKOUT_ANCHOR_ID = "billing-plan-checkout";
const HISTORY_PAGE_SIZE = 10;
const MEDIA_PAGE_SIZE = 12;
const NOTICE_PAGE_SIZE = 10;
const BILLING_USER_DISCOUNT_PAGE_SIZE = 8;
const INSTAGRAM_IMAGE_MAX_SIZE_BYTES = 8 * 1024 * 1024;
const INSTAGRAM_MULTI_MEDIA_MAX_FILES = 10;
const INSTAGRAM_POST_ASPECT_RATIO_MIN = 4 / 5;
const INSTAGRAM_POST_ASPECT_RATIO_MAX = 1.91;
const STORY_EDITOR_CANVAS_WIDTH = 1080;
const STORY_EDITOR_CANVAS_HEIGHT = 1920;
const STORY_EDITOR_STICKER_MIN = 0.08;
const STORY_EDITOR_STICKER_MAX = 0.92;
const STORY_EDITOR_DEFAULT_FONT = "K2D";
const STORY_EDITOR_BRUSH_COLORS = ["#ffffff", "#111827", "#ef4444", "#22c55e", "#3b82f6", "#8b5cf6", "#eab308", "#f97316"];
const STORY_EDITOR_DECOR_STICKERS = ["😍", "🔥", "✨", "✅", "🎉", "💬", "❤️", "⚡"];
const STORY_EDITOR_TEXT_COLORS = ["#ffffff", "#111827", "#ef4444", "#22c55e", "#3b82f6", "#8b5cf6", "#eab308", "#ec4899"];
const STORY_EDITOR_TEXT_BACKGROUNDS = [
  "transparent",
  "#111827",
  "#ffffff",
  "#ec4899",
  "#1d4ed8",
  "#8b5cf6",
  "#22c55e",
  "#eab308",
];
const STORY_EDITOR_DEFAULT_TEXT_COLOR = STORY_EDITOR_TEXT_COLORS[1] ?? "#111827";
const STORY_EDITOR_DEFAULT_TEXT_BACKGROUND_COLOR = STORY_EDITOR_TEXT_BACKGROUNDS[2] ?? "#ffffff";
const STORY_EDITOR_DEFAULT_LOCATION_TEXT_COLOR = STORY_EDITOR_TEXT_COLORS[1] ?? "#111827";
const STORY_EDITOR_DEFAULT_LOCATION_BACKGROUND_COLOR = STORY_EDITOR_TEXT_BACKGROUNDS[2] ?? "#ffffff";
const STORY_EDITOR_FONT_OPTIONS = [
  { value: "K2D", label: "K2D" },
  { value: "Arial", label: "Arial" },
  { value: "Comic Sans MS", label: "Comic Sans" },
  { value: "Trebuchet MS", label: "Trebuchet" },
  { value: "Georgia", label: "Georgia" },
  { value: "Courier New", label: "Courier" },
  { value: "Times New Roman", label: "Times" },
];
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
const DEFAULT_USER_TIME_ZONE = "America/Sao_Paulo";
const EDIT_PUBLISHED_RESCHEDULE_CONFIRM_STATUSES = new Set([
  "COMPLETED",
  "SENT_UNCONFIRMED",
  "FAILED",
  "WAITING_LOGIN",
  "CANCELED",
]);

const VIEW_ROUTE_MAP: Record<ViewKey, string> = {
  dashboard: "/dashboard",
  profile: "/perfil",
  plan: "/meu-plano",
  planConfig: "/configurar-planos",
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

const fullEmojiList = [
  "😀", "😁", "😂", "😊", "😉", "😍", "😘", "😎", "🤩", "🥳",
  "🙏", "🤝", "💬", "📞", "🫶", "💖", "🔥", "🎯", "💥", "📣",
  "🛍️", "📍", "🗺️", "🚗", "🏥", "🏬", "📌", "🎉", "🎊", "✨",
  "🍾", "🎈", "📸", "🎬", "🚀", "✅", "⚠️", "❤️", "👏", "💡",
];

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normalizeTimeZone(value: string | null | undefined): string {
  const normalized = (value || "").trim();
  if (!normalized) {
    return DEFAULT_USER_TIME_ZONE;
  }
  return isValidTimeZone(normalized) ? normalized : DEFAULT_USER_TIME_ZONE;
}

function listSupportedTimeZones(): string[] {
  const intlWithSupportedValues = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };

  const raw = intlWithSupportedValues.supportedValuesOf?.("timeZone") ?? [];
  if (Array.isArray(raw) && raw.length > 0) {
    const deduped = Array.from(new Set(raw.map((item) => item.trim()).filter((item) => item.length > 0)));
    if (!deduped.includes(DEFAULT_USER_TIME_ZONE)) {
      deduped.unshift(DEFAULT_USER_TIME_ZONE);
    }
    return deduped.sort((left, right) => left.localeCompare(right));
  }

  return [DEFAULT_USER_TIME_ZONE, "UTC"];
}

function formatDate(
  value: string | null | undefined,
  timeZone: string = DEFAULT_USER_TIME_ZONE,
): string {
  if (!value) {
    return "Não definido";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Não definido";
  }

  return parsed.toLocaleString("pt-BR", {
    timeZone: normalizeTimeZone(timeZone),
  });
}

type AvisoTone = "auth" | "error" | "info" | "success" | "neutral" | "whatsapp";

function isWhatsappAviso(aviso: Pick<Aviso, "kind" | "title" | "message">): boolean {
  const normalizedKind = aviso.kind.trim().toUpperCase();
  const normalizedTitle = aviso.title.trim().toUpperCase();
  const normalizedMessage = aviso.message.trim().toUpperCase();

  if (normalizedKind === "JOB_WHATSAPP_RELINK_CREATED") {
    return true;
  }

  if (normalizedTitle === "RELINK NO WHATSAPP") {
    return true;
  }

  return normalizedMessage.startsWith("WHATSAPP STATUS");
}

function avisoTone(aviso: Pick<Aviso, "kind" | "title" | "message">): AvisoTone {
  if (isWhatsappAviso(aviso)) {
    return "whatsapp";
  }

  const normalizedKind = aviso.kind.trim().toUpperCase();
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

function avisoToneClass(aviso: Pick<Aviso, "kind" | "title" | "message">): string {
  return `notice-tone-${avisoTone(aviso)}`;
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function loadImageForCanvas(sourceUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível carregar a imagem para edição do story."));
    image.src = sourceUrl;
  });
}

function formatJobScheduledAt(job: Pick<Job, "publicationState" | "dataPostagem">, timeZone: string): string {
  if (job.publicationState === "DRAFT") {
    return "Data e hora indefinida";
  }
  return formatDate(job.dataPostagem, timeZone);
}

function toDateLocal(value: string, timeZone: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: normalizeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);

  const mapped: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      mapped[part.type] = part.value;
    }
  }

  return `${mapped.year ?? "0000"}-${mapped.month ?? "01"}-${mapped.day ?? "01"}`;
}

function toTimeLocal(value: string, timeZone: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: normalizeTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(parsed);

  const mapped: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      mapped[part.type] = part.value;
    }
  }

  return `${mapped.hour ?? "00"}:${mapped.minute ?? "00"}`;
}

function toIsoFromTimeZoneDateTime(
  dateValue: string,
  timeValue: string,
  timeZone: string,
): string | null {
  const [yearRaw, monthRaw, dayRaw] = dateValue.split("-").map((part) => Number.parseInt(part, 10));
  const [hourRaw, minuteRaw] = timeValue.split(":").map((part) => Number.parseInt(part, 10));

  if (
    !Number.isFinite(yearRaw) ||
    !Number.isFinite(monthRaw) ||
    !Number.isFinite(dayRaw) ||
    !Number.isFinite(hourRaw) ||
    !Number.isFinite(minuteRaw)
  ) {
    return null;
  }

  const year = yearRaw;
  const month = monthRaw;
  const day = dayRaw;
  const hour = hourRaw;
  const minute = minuteRaw;
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const targetComparableMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utcMs = targetComparableMs;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: normalizedTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(utcMs));

    const mapped: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        mapped[part.type] = part.value;
      }
    }

    const observedComparableMs = Date.UTC(
      Number.parseInt(mapped.year ?? "0", 10),
      Number.parseInt(mapped.month ?? "1", 10) - 1,
      Number.parseInt(mapped.day ?? "1", 10),
      Number.parseInt(mapped.hour ?? "0", 10),
      Number.parseInt(mapped.minute ?? "0", 10),
      0,
    );

    const deltaMs = observedComparableMs - targetComparableMs;
    if (deltaMs === 0) {
      break;
    }

    utcMs -= deltaMs;
  }

  const result = new Date(utcMs);
  if (Number.isNaN(result.getTime())) {
    return null;
  }

  return result.toISOString();
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

function getCurrentTimeValue(
  timeZone: string = DEFAULT_USER_TIME_ZONE,
  referenceDate: Date = new Date(),
): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: normalizeTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(referenceDate);

  const mapped: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      mapped[part.type] = part.value;
    }
  }

  return `${mapped.hour ?? "00"}:${mapped.minute ?? "00"}`;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fileNameWithoutExtension(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, "");
}

function readImageElementFromUrl(sourceUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Falha ao carregar imagem para o editor."));
    image.src = sourceUrl;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: "image/png" | "image/jpeg",
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Falha ao gerar imagem editada."));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

function InstagramGradientMapPinIcon({
  className,
  gradientId,
}: {
  className?: string;
  gradientId: string;
}) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="56%" stopColor="#ec4899" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <path
        d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"
        stroke={`url(#${gradientId})`}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="3" stroke={`url(#${gradientId})`} strokeWidth="2" />
    </svg>
  );
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = clamp(radius, 0, Math.min(width, height) / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function storyStrokeSvgPath(points: StoryEditorStrokePoint[]): string {
  if (points.length === 0) {
    return "";
  }

  const [firstPoint, ...rest] = points;
  if (!firstPoint) {
    return "";
  }

  if (rest.length === 0) {
    return `M ${Math.round(firstPoint.x * 1000)} ${Math.round(firstPoint.y * 1000)}`;
  }

  let path = `M ${Math.round(firstPoint.x * 1000)} ${Math.round(firstPoint.y * 1000)}`;
  const allPoints = [firstPoint, ...rest];
  for (let index = 1; index < allPoints.length - 1; index += 1) {
    const currentPoint = allPoints[index];
    const nextPoint = allPoints[index + 1];
    if (!currentPoint || !nextPoint) {
      continue;
    }
    const midX = (currentPoint.x + nextPoint.x) / 2;
    const midY = (currentPoint.y + nextPoint.y) / 2;
    path += ` Q ${Math.round(currentPoint.x * 1000)} ${Math.round(currentPoint.y * 1000)} ${Math.round(midX * 1000)} ${Math.round(midY * 1000)}`;
  }
  const lastPoint = allPoints[allPoints.length - 1];
  if (lastPoint) {
    path += ` L ${Math.round(lastPoint.x * 1000)} ${Math.round(lastPoint.y * 1000)}`;
  }
  return path;
}

function drawStrokeOnCanvas(
  context: CanvasRenderingContext2D,
  points: StoryEditorStrokePoint[],
  canvasWidth: number,
  canvasHeight: number,
) {
  if (points.length <= 1) {
    return;
  }

  const firstPoint = points[0];
  if (!firstPoint) {
    return;
  }

  context.beginPath();
  context.moveTo(firstPoint.x * canvasWidth, firstPoint.y * canvasHeight);

  for (let index = 1; index < points.length - 1; index += 1) {
    const currentPoint = points[index];
    const nextPoint = points[index + 1];
    if (!currentPoint || !nextPoint) {
      continue;
    }
    const midX = (currentPoint.x + nextPoint.x) / 2;
    const midY = (currentPoint.y + nextPoint.y) / 2;
    context.quadraticCurveTo(
      currentPoint.x * canvasWidth,
      currentPoint.y * canvasHeight,
      midX * canvasWidth,
      midY * canvasHeight,
    );
  }

  const lastPoint = points[points.length - 1];
  if (lastPoint) {
    context.lineTo(lastPoint.x * canvasWidth, lastPoint.y * canvasHeight);
  }

  context.stroke();
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

function dashboardTrendDayKey(date: Date, timeZone: string): string {
  const parts = getTimeZoneDateParts(date, timeZone);
  return `${parts.year ?? "0000"}-${parts.month ?? "01"}-${parts.day ?? "01"}`;
}

function dashboardTrendDayLabel(dayKey: string): string {
  const [, month = "01", day = "01"] = dayKey.split("-");
  return `${day}/${month}`;
}

function dashboardTrendFocusLabel(focus: DashboardTrendFocus): string {
  switch (focus) {
    case "published":
      return "Publicados";
    case "failed":
      return "Falhados";
    case "scheduled":
      return "Agendados";
    case "all":
    default:
      return "Visão geral";
  }
}

function buildDashboardChartPath(values: number[], width: number, height: number): string {
  if (values.length === 0) {
    return "";
  }

  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);
  const maxValue = Math.max(...values, 1);

  return values
    .map((value, index) => {
      const x = values.length === 1 ? safeWidth / 2 : (index / (values.length - 1)) * safeWidth;
      const y = safeHeight - (value / maxValue) * safeHeight;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
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

function getTimeZoneDateParts(date: Date, timeZone: string): Record<string, string> {
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

  return mapped;
}

function toTimeZoneComparableTimestamp(date: Date, timeZone: string): number {
  const mapped = getTimeZoneDateParts(date, timeZone);

  return Date.UTC(
    Number.parseInt(mapped.year ?? "0", 10),
    Number.parseInt(mapped.month ?? "1", 10) - 1,
    Number.parseInt(mapped.day ?? "1", 10),
    Number.parseInt(mapped.hour ?? "0", 10),
    Number.parseInt(mapped.minute ?? "0", 10),
    Number.parseInt(mapped.second ?? "0", 10),
  );
}

function getYearMonthInTimeZone(date: Date, timeZone: string): { year: number; month: number } {
  const mapped = getTimeZoneDateParts(date, normalizeTimeZone(timeZone));
  return {
    year: Number.parseInt(mapped.year ?? "0", 10),
    month: Number.parseInt(mapped.month ?? "0", 10),
  };
}

function canToggleJobSchedule(job: Job, isPastScheduledAtInUserTimeZone: (dateIso: string) => boolean): boolean {
  if (job.publicationState === "DRAFT") {
    return false;
  }

  if (job.status === "CANCELED") {
    return true;
  }

  if (job.status === "FAILED" && isPastScheduledAtInUserTimeZone(job.dataPostagem)) {
    return false;
  }

  return job.status === "PENDING" || job.status === "WAITING_LOGIN" || job.status === "FAILED";
}

function shouldRenderUpcomingAsRunning(job: Job, isPastScheduledAtInUserTimeZone: (dateIso: string) => boolean): boolean {
  return (
    job.status === "RUNNING" ||
    (job.status === "PENDING" && (isPastScheduledAtInUserTimeZone(job.dataPostagem) || job.tentativas > 0))
  );
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

function billingStatusTone(status: string): string {
  switch ((status || "").toUpperCase()) {
    case "ACTIVE":
    case "TRIALING":
      return "billing-active";
    case "PAYMENT_REQUIRED":
      return "billing-paused";
    case "BLOCKED":
    case "EXPIRED":
      return "billing-canceled";
    default:
      return "billing-paused";
  }
}

function billingStatusDisplayLabel(status: string): string {
  switch ((status || "").toUpperCase()) {
    case "ACTIVE":
    case "TRIALING":
      return "Ativo";
    case "PAYMENT_REQUIRED":
      return "Pausado";
    case "BLOCKED":
    case "EXPIRED":
      return "Cancelado";
    case "NONE":
      return "Sem plano";
    default:
      return "Pausado";
  }
}

function billingModelDisplayLabel(model: string): string {
  switch ((model || "").toUpperCase()) {
    case "NONE":
      return "Sem cobrança";
    case "TRIAL":
      return "Trial";
    case "STRIPE_SUBSCRIPTION":
      return "Assinatura Stripe";
    case "PIX_MANUAL":
      return "Pix avulso Stripe";
    case "MANUAL":
      return "Manual";
    case "ROOT":
      return "Manual";
    default:
      return "Manual";
  }
}

function billingSubscriptionTypeDisplayLabel(model: string, cycle: string | null): string {
  const normalizedModel = (model || "").toUpperCase();
  const normalizedCycle = (cycle || "").toUpperCase();
  if (normalizedModel === "STRIPE_SUBSCRIPTION") {
    return normalizedCycle === "YEARLY" ? "Recorrente anual" : "Recorrente mensal";
  }
  if (normalizedModel === "PIX_MANUAL") {
    return normalizedCycle === "YEARLY" ? "Avulso anual" : "Avulso mensal";
  }
  if (normalizedModel === "TRIAL") {
    return "Trial";
  }
  if (normalizedModel === "NONE") {
    return "Sem cobrança";
  }
  return "Manual";
}

function resolveBillingPlanAmountCents(plan: BillingPlan | null, cycle: string | null): number | null {
  if (!plan) {
    return null;
  }
  return (cycle || "").toUpperCase() === "YEARLY" ? plan.yearlyPriceCents : plan.monthlyPriceCents;
}

function isPastScheduledAt(
  dateIso: string,
  timeZone: string,
  currentDateTime: Date,
): boolean {
  const scheduledAt = new Date(dateIso);
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  return (
    toTimeZoneComparableTimestamp(scheduledAt, normalizedTimeZone) <=
    toTimeZoneComparableTimestamp(currentDateTime, normalizedTimeZone)
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

function resolveWhatsappOwnerNumber(ownerJid: string | null | undefined): string | null {
  const raw = ownerJid?.trim() || "";
  if (!raw) {
    return null;
  }

  const base = raw.split("@")[0]?.trim() || "";
  if (!base) {
    return null;
  }

  const digits = base.replace(/\D+/g, "");
  return digits || base;
}

function isInstagramPublication(publicationType: SchedulerPublicationType): boolean {
  return (
    publicationType === "instagram_post" ||
    publicationType === "instagram_reel" ||
    publicationType === "instagram_story"
  );
}

function parseStorySequenceFailureMeta(lastError: string | null | undefined): {
  publishedCount: number;
  total: number;
} | null {
  const raw = (lastError || "").trim();
  if (!raw) {
    return null;
  }

  const match = raw.match(/STORY_SEQUENCE_PUBLISHED_COUNT=(\d+);STEP=(\d+);TOTAL=(\d+)/i);
  if (!match || !match[1] || !match[3]) {
    return null;
  }

  const publishedCount = Number.parseInt(match[1], 10);
  const total = Number.parseInt(match[3], 10);
  if (!Number.isFinite(publishedCount) || !Number.isFinite(total)) {
    return null;
  }

  return {
    publishedCount: Math.max(0, publishedCount),
    total: Math.max(1, total),
  };
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
  const [profileTimeZone, setProfileTimeZone] = useState(DEFAULT_USER_TIME_ZONE);
  const [nowTickMs, setNowTickMs] = useState(() => Date.now());
  const [activeView, setActiveView] = useState<ViewKey>(initialViewFromLocation);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard>(initialDashboard);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [dashboardUpcomingPage, setDashboardUpcomingPage] = useState(0);
  const [dashboardTrendRange, setDashboardTrendRange] = useState<DashboardTrendRange>("30");
  const [dashboardTrendNetwork, setDashboardTrendNetwork] = useState<DashboardTrendNetwork>("all");
  const [dashboardTrendFocus, setDashboardTrendFocus] = useState<DashboardTrendFocus>("all");
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
  const [dragOverSchedulerMediaIndex, setDragOverSchedulerMediaIndex] = useState<number | null>(null);
  const [mediaCaptionModalIndex, setMediaCaptionModalIndex] = useState<number | null>(null);
  const [mediaCaptionDraft, setMediaCaptionDraft] = useState("");
  const [storyEditorMediaIndex, setStoryEditorMediaIndex] = useState<number | null>(null);
  const [storyEditorLocationEnabled, setStoryEditorLocationEnabled] = useState(false);
  const [storyEditorLocationText, setStoryEditorLocationText] = useState("");
  const [storyEditorLocationTextColor, setStoryEditorLocationTextColor] = useState(STORY_EDITOR_DEFAULT_LOCATION_TEXT_COLOR);
  const [storyEditorLocationBackgroundColor, setStoryEditorLocationBackgroundColor] = useState(
    STORY_EDITOR_DEFAULT_LOCATION_BACKGROUND_COLOR,
  );
  const [storyEditorLocationFontFamily, setStoryEditorLocationFontFamily] = useState(STORY_EDITOR_DEFAULT_FONT);
  const [storyEditorLocationScale, setStoryEditorLocationScale] = useState(1);
  const [storyEditorLocationEditing, setStoryEditorLocationEditing] = useState(false);
  const [storyEditorStickerX, setStoryEditorStickerX] = useState(0.5);
  const [storyEditorStickerY, setStoryEditorStickerY] = useState(0.18);
  const [storyEditorToolMode, setStoryEditorToolMode] = useState<StoryEditorToolMode>("MOVE");
  const [storyEditorBrushColor, setStoryEditorBrushColor] = useState(STORY_EDITOR_BRUSH_COLORS[0] ?? "#ffffff");
  const [storyEditorBrushSize, setStoryEditorBrushSize] = useState(10);
  const [storyEditorBrushCursor, setStoryEditorBrushCursor] = useState<{
    visible: boolean;
    x: number;
    y: number;
  }>({ visible: false, x: 0.5, y: 0.5 });
  const [storyEditorStrokes, setStoryEditorStrokes] = useState<StoryEditorStroke[]>([]);
  const [storyEditorDecorStickers, setStoryEditorDecorStickers] = useState<StoryEditorDecorSticker[]>([]);
  const [storyEditorActiveDecorStickerId, setStoryEditorActiveDecorStickerId] = useState<string | null>(null);
  const [storyEditorDraggingDecorStickerId, setStoryEditorDraggingDecorStickerId] = useState<string | null>(null);
  const [storyEditorDecorPickerOpen, setStoryEditorDecorPickerOpen] = useState(false);
  const [storyEditorTextColor, setStoryEditorTextColor] = useState(STORY_EDITOR_DEFAULT_TEXT_COLOR);
  const [storyEditorTextBackgroundColor, setStoryEditorTextBackgroundColor] = useState(
    STORY_EDITOR_DEFAULT_TEXT_BACKGROUND_COLOR,
  );
  const [storyEditorTextFontFamily, setStoryEditorTextFontFamily] = useState(STORY_EDITOR_DEFAULT_FONT);
  const [storyEditorTextScale, setStoryEditorTextScale] = useState(1);
  const [storyEditorTextStickers, setStoryEditorTextStickers] = useState<StoryEditorTextSticker[]>([]);
  const [storyEditorActiveTextStickerId, setStoryEditorActiveTextStickerId] = useState<string | null>(null);
  const [storyEditorDraggingTextStickerId, setStoryEditorDraggingTextStickerId] = useState<string | null>(null);
  const [storyEditorDraggingSticker, setStoryEditorDraggingSticker] = useState(false);
  const [storyEditorSaving, setStoryEditorSaving] = useState(false);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const [jobCompanyId, setJobCompanyId] = useState("");
  const [jobSocialConnectionId, setJobSocialConnectionId] = useState("");
  const [postTitle, setPostTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [firstCommentEnabled, setFirstCommentEnabled] = useState(false);
  const [firstComment, setFirstComment] = useState("");
  const [whatsappBackgroundColor, setWhatsappBackgroundColor] = useState(DEFAULT_WHATSAPP_BACKGROUND_COLOR);
  const [whatsappRelinkEnabled, setWhatsappRelinkEnabled] = useState(false);
  const [whatsappRelinkConnectionIds, setWhatsappRelinkConnectionIds] = useState<string[]>([]);
  const [publicationType, setPublicationType] = useState<SchedulerPublicationType>("");
  const [publicationState, setPublicationState] = useState<SchedulerPublicationState>("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [schedulerInfo, setSchedulerInfo] = useState("");
  const [historyInfo, setHistoryInfo] = useState("");
  const [mediaInfo, setMediaInfo] = useState("");
  const [avisosInfo, setAvisosInfo] = useState("");
  const [noticeAdminInfo, setNoticeAdminInfo] = useState("");
  const [planInfo, setPlanInfo] = useState("");
  const [billingMe, setBillingMe] = useState<BillingMe | null>(null);
  const [billingPlans, setBillingPlans] = useState<BillingPlan[]>([]);
  const [billingSettings, setBillingSettings] = useState<BillingSettings>({
    autoTrialEnabled: true,
    autoTrialDays: 10,
    rootDisplayPlanId: null,
  });
  const [billingLoading, setBillingLoading] = useState(false);
  const [savingBillingSettings, setSavingBillingSettings] = useState(false);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [planCodeInput, setPlanCodeInput] = useState("");
  const [planNameInput, setPlanNameInput] = useState("");
  const [planDescriptionInput, setPlanDescriptionInput] = useState("");
  const [planIsTrialInput, setPlanIsTrialInput] = useState(false);
  const [planIsActiveInput, setPlanIsActiveInput] = useState(true);
  const [planMaxProfilesInput, setPlanMaxProfilesInput] = useState("1");
  const [planMaxConnectionsInput, setPlanMaxConnectionsInput] = useState("2");
  const [planMaxMonthlyPublicationsInput, setPlanMaxMonthlyPublicationsInput] = useState("60");
  const [planStripeProductIdInput, setPlanStripeProductIdInput] = useState("");
  const [stripeCatalogProducts, setStripeCatalogProducts] = useState<StripeCatalogProduct[]>([]);
  const [stripeCatalogResolvedByProduct, setStripeCatalogResolvedByProduct] = useState<
    StripeCatalogResponse["resolvedByProduct"]
  >({});
  const [stripeCatalogError, setStripeCatalogError] = useState("");
  const [checkoutPlanId, setCheckoutPlanId] = useState("");
  const [checkoutBillingModel, setCheckoutBillingModel] = useState<"" | "STRIPE_SUBSCRIPTION" | "PIX_MANUAL">("");
  const [checkoutCycle, setCheckoutCycle] = useState<"" | "MONTHLY" | "YEARLY">("");
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [rootAssignPlanId, setRootAssignPlanId] = useState("");
  const [assigningRootPlan, setAssigningRootPlan] = useState(false);
  const [cancelingStripeSubscription, setCancelingStripeSubscription] = useState(false);
  const [isBillingDiscountModalOpen, setIsBillingDiscountModalOpen] = useState(false);
  const [billingDiscountUsers, setBillingDiscountUsers] = useState<BillingUserDiscountItem[]>([]);
  const [billingDiscountUsersLoading, setBillingDiscountUsersLoading] = useState(false);
  const [billingDiscountSearch, setBillingDiscountSearch] = useState("");
  const [billingDiscountPage, setBillingDiscountPage] = useState(1);
  const [billingDiscountTotalPages, setBillingDiscountTotalPages] = useState(1);
  const [billingDiscountTotal, setBillingDiscountTotal] = useState(0);
  const [selectedBillingDiscountUserId, setSelectedBillingDiscountUserId] = useState("");
  const [billingDiscountEnabledInput, setBillingDiscountEnabledInput] = useState(false);
  const [billingDiscountPercentInput, setBillingDiscountPercentInput] = useState("0");
  const [savingBillingDiscountUserId, setSavingBillingDiscountUserId] = useState<string | null>(null);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilterKey>(() =>
    parseHistoryFilterKey(readSearchParam(HISTORY_FILTER_QUERY_PARAM)),
  );
  const [historyMonthFilter, setHistoryMonthFilter] = useState<string>("all");
  const [historyYearFilter, setHistoryYearFilter] = useState<string>("all");
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [historyBulkAction, setHistoryBulkAction] = useState<HistoryBulkAction>("");
  const [historyBulkSelectedJobIds, setHistoryBulkSelectedJobIds] = useState<string[]>([]);
  const [historyBulkDate, setHistoryBulkDate] = useState("");
  const [historyBulkTime, setHistoryBulkTime] = useState(() => getCurrentTimeValue(DEFAULT_USER_TIME_ZONE));
  const [historyBulkCompanyId, setHistoryBulkCompanyId] = useState("");
  const [historyBulkApplying, setHistoryBulkApplying] = useState(false);
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
  const [openEmojiPickerKey, setOpenEmojiPickerKey] = useState<string | null>(null);
  const [noticesPopoverLoading, setNoticesPopoverLoading] = useState(false);
  const [markingAllAvisosRead, setMarkingAllAvisosRead] = useState(false);
  const [broadcastAvisoTitle, setBroadcastAvisoTitle] = useState("");
  const [broadcastAvisoMessage, setBroadcastAvisoMessage] = useState("");
  const [broadcastAvisoSubmitting, setBroadcastAvisoSubmitting] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [reschedulingFailedMediaJobId, setReschedulingFailedMediaJobId] = useState<string | null>(null);
  const [togglingScheduleJobId, setTogglingScheduleJobId] = useState<string | null>(null);
  const [submittingJob, setSubmittingJob] = useState(false);
  const contentLoadingCounterRef = useRef(0);
  const schedulerMediaInputRef = useRef<HTMLInputElement | null>(null);
  const storyEditorStageRef = useRef<HTMLDivElement | null>(null);
  const storyEditorStickerDragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const storyEditorDecorStickerDragRef = useRef<{
    pointerId: number;
    stickerId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const storyEditorTextStickerDragRef = useRef<{
    pointerId: number;
    stickerId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const storyEditorDrawRef = useRef<{ pointerId: number; strokeId: string } | null>(null);
  const storyEditorMeasureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaSectionRef = useRef<HTMLElement | null>(null);
  const historySectionRef = useRef<HTMLElement | null>(null);
  const avisosSectionRef = useRef<HTMLElement | null>(null);
  const lastUnreadAvisosCountRef = useRef(0);
  const noticesBellDesktopRef = useRef<HTMLDivElement | null>(null);
  const noticesBellMobileRef = useRef<HTMLDivElement | null>(null);
  const profileMenuDesktopRef = useRef<HTMLDivElement | null>(null);
  const profileMenuMobileRef = useRef<HTMLDivElement | null>(null);
  const planEditorSectionRef = useRef<HTMLElement | null>(null);
  const isRootUser = authUser?.username === "root";
  const supportedTimeZones = useMemo(() => listSupportedTimeZones(), []);
  const effectiveUserTimeZone = normalizeTimeZone(authUser?.timeZone || DEFAULT_USER_TIME_ZONE);
  const nowReferenceDate = useMemo(() => new Date(nowTickMs), [nowTickMs]);
  const isPastScheduledAtForUser = (dateIso: string) =>
    isPastScheduledAt(dateIso, effectiveUserTimeZone, nowReferenceDate);
  const instagramForcedLocationId = (dashboard.instagramForcedLocationId || "").trim();
  const instagramForcedLocationName =
    (dashboard.instagramForcedLocationName || "").trim() || "Localização fixa do sistema";
  const isInstagramForcedLocationEnabled = instagramForcedLocationId.length > 0;
  const storyEditorResolvedLocationName = storyEditorLocationEnabled ? storyEditorLocationText.trim() : "";
  const activeStoryEditorTextSticker = storyEditorActiveTextStickerId
    ? (storyEditorTextStickers.find((item) => item.id === storyEditorActiveTextStickerId) ?? null)
    : null;
  const storyEditorLocationStickerSize = estimateStoryEditorLocationStickerSize(
    storyEditorResolvedLocationName || "Sua localização",
    storyEditorLocationFontFamily,
    storyEditorLocationScale,
  );
  const storyEditorLocationControlsStyle = (() => {
    const stageRect = storyEditorStageRef.current?.getBoundingClientRect();
    const stageWidth = stageRect && stageRect.width > 0 ? stageRect.width : 360;
    const stageHeight = stageRect && stageRect.height > 0 ? stageRect.height : 640;
    const panelWidth = Math.min(Math.max(stageWidth - 24, 220), 332);
    const estimatedPanelHeight = 186;
    const stickerCenterX = storyEditorStickerX * stageWidth;
    const stickerCenterY = storyEditorStickerY * stageHeight;
    const desiredTop = stickerCenterY + storyEditorLocationStickerSize.height / 2 + 12;
    const maxTop = Math.max(stageHeight - estimatedPanelHeight - 12, 12);
    const top = clamp(desiredTop, 12, maxTop);
    const left = clamp(stickerCenterX - panelWidth / 2, 12, Math.max(stageWidth - panelWidth - 12, 12));

    return { top, left, width: panelWidth };
  })();
  const resolvedStripePriceIdsForSelectedProduct = planStripeProductIdInput
    ? (stripeCatalogResolvedByProduct[planStripeProductIdInput] ?? null)
    : null;
  const availablePaidPlans = useMemo(
    () => billingPlans.filter((plan) => plan.isActive && !plan.isTrial),
    [billingPlans],
  );
  const rootAssignablePlans = useMemo(() => billingPlans.filter((plan) => plan.isActive), [billingPlans]);
  const selectedCheckoutPlan = checkoutPlanId
    ? availablePaidPlans.find((plan) => plan.id === checkoutPlanId) ?? null
    : null;
  const isCheckoutSelectionReady =
    Boolean(selectedCheckoutPlan) &&
    (checkoutBillingModel === "STRIPE_SUBSCRIPTION" || checkoutBillingModel === "PIX_MANUAL") &&
    (checkoutCycle === "MONTHLY" || checkoutCycle === "YEARLY");
  const checkoutSelectedPriceCents =
    selectedCheckoutPlan && (checkoutCycle === "MONTHLY" || checkoutCycle === "YEARLY")
      ? checkoutCycle === "YEARLY"
        ? selectedCheckoutPlan.yearlyPriceCents
        : selectedCheckoutPlan.monthlyPriceCents
      : null;
  const checkoutSelectedPriceLabel = formatPriceFromCents(checkoutSelectedPriceCents);
  const selectedBillingDiscountUser = selectedBillingDiscountUserId
    ? billingDiscountUsers.find((user) => user.id === selectedBillingDiscountUserId) ?? null
    : null;
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
    historyInfo === "Rascunho publicado com sucesso." ||
    historyInfo.startsWith("Edição em massa aplicada");
  const isTransientHistoryInfo =
    historyInfo === "Atualizando agendamento..." ||
    historyInfo === "Publicando rascunho..." ||
    historyInfo === "Reenfileirando postagem..." ||
    isPositiveHistoryInfo;
  const isPositiveMediaInfo = mediaInfo === "Mídia excluída com sucesso.";
  const isTransientMediaInfo = isPositiveMediaInfo;
  const isPositiveAvisosInfo = avisosInfo === "Avisos atualizados.";
  const isPositiveNoticeAdminInfo = noticeAdminInfo === "Aviso enviado com sucesso.";
  const isPositivePlanInfo =
    planInfo === "Plano criado com sucesso." ||
    planInfo === "Plano atualizado com sucesso." ||
    planInfo === "Plano excluído com sucesso." ||
    planInfo === "Configurações básicas salvas com sucesso." ||
    planInfo === "Plano ativado com sucesso pelo Stripe." ||
    planInfo === "Plano ativado com sucesso.";
  const isTransientAvisosInfo = isPositiveAvisosInfo;
  const isTransientNoticeAdminInfo = isPositiveNoticeAdminInfo;
  const billingWarningMessage = authUser?.billingIsBlocked
    ? (authUser.billingBlockMessage || "Conta bloqueada por pagamento pendente. Renove para continuar.")
    : "";
  const requiresMediaUpload = publicationType !== "" && publicationType !== "whatsapp_status_texto";
  const supportsMultiMediaUpload = publicationType === "instagram_post" || publicationType === "instagram_story";
  const supportsFirstComment = publicationType === "instagram_post" || publicationType === "instagram_reel";
  const supportsWhatsappRelink =
    publicationType === "instagram_post" ||
    publicationType === "instagram_reel" ||
    publicationType === "instagram_story";
  const activeAppLogo = themeMode === "dark" ? appLogoAlternative : appLogo;
  const uploadedFilePath = uploadedSchedulerMedia[0]?.filePath ?? "";
  const uploadedFileName = uploadedSchedulerMedia[0]?.fileName ?? "";
  const uploadedFileSizeBytes = uploadedSchedulerMedia[0]?.fileSizeBytes ?? null;
  const uploadedMediaCount = uploadedSchedulerMedia.length;
  const effectiveSequentialPublishing =
    (publicationType === "instagram_post" || publicationType === "instagram_story") &&
    uploadedMediaCount > 1;
  const canEnableWhatsappRelink =
    supportsWhatsappRelink && !(publicationType === "instagram_story" && uploadedMediaCount > 1);
  const supportsWhatsappBackgroundColor =
    publicationType === "whatsapp_status_texto" ||
    publicationType === "whatsapp_status_midia";
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
      : "Legenda opcional para a postagem.";

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
      setPlanInfo("");

      const shouldPrimeContentSkeleton =
        Boolean(authUser) && view !== "profile" && view !== "plan" && view !== "planConfig" && view !== "notices";
      if (shouldPrimeContentSkeleton) {
        setContentLoading(true);
      }
    }

    setNoticesPopoverOpen(false);
    setProfileMenuOpen(false);
    setSidebarOpen(false);
    setActiveView(view);

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function scrollToBillingCheckoutAnchor() {
    if (typeof window === "undefined") {
      return;
    }

    const target = window.document.getElementById(BILLING_PLAN_CHECKOUT_ANCHOR_ID);
    if (!target) {
      return;
    }

    target.scrollIntoView({ behavior: "smooth", block: "start" });

    const nextUrl = `${buildViewHref("plan")}#${BILLING_PLAN_CHECKOUT_ANCHOR_ID}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentUrl !== nextUrl) {
      window.history.replaceState({}, "", nextUrl);
    }
  }

  function navigateToPlanCheckout(event: ReactMouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    navigateToView("plan");
    window.setTimeout(() => {
      scrollToBillingCheckoutAnchor();
    }, 120);
  }

  async function refreshAuthUserSnapshot(): Promise<void> {
    try {
      const response = await api.get<{ user: AuthUser }>("/auth/me");
      setAuthUser(response.user);
    } catch {
      // Mantém o estado atual quando o refresh falha por rede.
    }
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
    if (!isPositivePlanInfo) {
      return;
    }

    const timer = window.setTimeout(() => {
      setPlanInfo("");
    }, 3200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isPositivePlanInfo]);

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
    if (activeView !== "plan" && activeView !== "planConfig" && planInfo) {
      setPlanInfo("");
    }
  }, [activeView, planInfo]);

  useEffect(() => {
    if (activeView === "planConfig" || !isBillingDiscountModalOpen) {
      return;
    }

    closeBillingDiscountModal();
  }, [activeView, isBillingDiscountModalOpen]);

  useEffect(() => {
    if (!mediaInfo || typeof window === "undefined" || !mediaSectionRef.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      mediaSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [mediaInfo]);

  useEffect(() => {
    if (!error || typeof window === "undefined") {
      return;
    }

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, [error]);

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
    if (!openEmojiPickerKey) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        setOpenEmojiPickerKey(null);
        return;
      }

      if (target.closest(".emoji-picker-shell")) {
        return;
      }

      setOpenEmojiPickerKey(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenEmojiPickerKey(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openEmojiPickerKey]);

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
    if (isRootUser) {
      return;
    }

    if (availablePaidPlans.length === 0) {
      setCheckoutPlanId("");
      return;
    }

    setCheckoutPlanId((current) =>
      current && availablePaidPlans.some((plan) => plan.id === current) ? current : "",
    );
  }, [isRootUser, availablePaidPlans]);

  useEffect(() => {
    if (!authUser || isRootUser) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const checkoutResult = (params.get(STRIPE_CHECKOUT_RESULT_QUERY_PARAM) || "").trim().toLowerCase();
    if (!checkoutResult) {
      return;
    }

    const cleanupStripeCheckoutParams = () => {
      params.delete(STRIPE_CHECKOUT_RESULT_QUERY_PARAM);
      params.delete(STRIPE_CHECKOUT_SESSION_ID_QUERY_PARAM);
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", nextUrl);
    };

    if (checkoutResult === "cancel") {
      setPlanInfo("Checkout cancelado.");
      cleanupStripeCheckoutParams();
      return;
    }

    const sessionId = (params.get(STRIPE_CHECKOUT_SESSION_ID_QUERY_PARAM) || "").trim();
    if (!sessionId) {
      setError("Retorno do Stripe sem session_id para confirmar pagamento.");
      cleanupStripeCheckoutParams();
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const result = await api.postJson<{ applied: boolean; message?: string }>("/billing/checkout/confirm", {
          sessionId,
        });
        if (cancelled) {
          return;
        }
        setError("");
        setPlanInfo(result.message || (result.applied ? "Plano ativado com sucesso." : "Aguardando confirmação de pagamento."));
        await refreshAuthUserSnapshot();
        await loadBillingData({ withSkeleton: false });
      } catch (confirmError) {
        if (cancelled) {
          return;
        }
        setError(confirmError instanceof Error ? confirmError.message : "Falha ao confirmar checkout Stripe.");
      } finally {
        cleanupStripeCheckoutParams();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authUser, isRootUser]);

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

  const schedulerWhatsappConnections = useMemo(
    () =>
      connections
        .filter((connection) => connection.platform === "whatsapp" && connection.authStatus === "CONNECTED")
        .sort((a, b) => {
          const companyA = companyNameMap[a.companyId] || "";
          const companyB = companyNameMap[b.companyId] || "";
          if (companyA !== companyB) {
            return companyA.localeCompare(companyB);
          }
          return a.displayName.localeCompare(b.displayName);
        }),
    [companyNameMap, connections],
  );

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
        if (item.key === "logs" || item.key === "noticeAdmin" || item.key === "planConfig") {
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
        (job.status === "RUNNING" || job.status === "PENDING" || job.status === "WAITING_LOGIN"),
    );

    return eligibleUpcomingJobs
      .slice()
      .sort((left, right) => {
        const leftRunningLike = shouldRenderUpcomingAsRunning(left, isPastScheduledAtForUser);
        const rightRunningLike = shouldRenderUpcomingAsRunning(right, isPastScheduledAtForUser);

        if (leftRunningLike !== rightRunningLike) {
          return leftRunningLike ? -1 : 1;
        }

        const leftScheduledAt = new Date(left.dataPostagem).getTime();
        const rightScheduledAt = new Date(right.dataPostagem).getTime();
        return leftScheduledAt - rightScheduledAt;
      });
  }, [effectiveUserTimeZone, jobsOrderedByCreatedAtDesc, nowTickMs]);

  const dashboardUpcomingPages = useMemo(() => {
    const chunkSize = 2;
    const pages: Job[][] = [];
    for (let index = 0; index < upcomingJobs.length; index += chunkSize) {
      pages.push(upcomingJobs.slice(index, index + chunkSize));
    }
    return pages;
  }, [upcomingJobs]);

  const dashboardChartData = useMemo(() => {
    const visibleDayKeys: string[] = [];
    const totalDays = Number.parseInt(dashboardTrendRange, 10);
    for (let index = 0; index < totalDays; index += 1) {
      const dayKey = dashboardTrendDayKey(
        new Date(nowTickMs - (totalDays - 1 - index) * 24 * 60 * 60 * 1000),
        effectiveUserTimeZone,
      );
      if (visibleDayKeys[visibleDayKeys.length - 1] !== dayKey) {
        visibleDayKeys.push(dayKey);
      }
    }

    const buckets = new Map(
      visibleDayKeys.map((dayKey) => [
        dayKey,
        {
          key: dayKey,
          label: dashboardTrendDayLabel(dayKey),
          published: 0,
          failed: 0,
          scheduled: 0,
          total: 0,
        },
      ]),
    );

    const distributionSeed = [
      { key: "instagram_post", label: "Instagram Posts", network: "instagram" as const, count: 0 },
      { key: "instagram_reel", label: "Instagram Reels", network: "instagram" as const, count: 0 },
      { key: "instagram_story", label: "Instagram Stories", network: "instagram" as const, count: 0 },
      { key: "whatsapp_status_midia", label: "WhatsApp Status Mídia", network: "whatsapp" as const, count: 0 },
      { key: "whatsapp_status_texto", label: "WhatsApp Status Texto", network: "whatsapp" as const, count: 0 },
    ];
    const distributionMap = new Map(distributionSeed.map((entry) => [entry.key, { ...entry }]));
    const activeCompanies = new Set<string>();

    let publishedTotal = 0;
    let failedTotal = 0;
    let scheduledTotal = 0;

    for (const job of filteredJobs) {
      if (job.publicationState !== "PUBLISHED") {
        continue;
      }

      const jobNetwork = publicationTypeNetwork(job.publicationType);
      if (dashboardTrendNetwork !== "all" && jobNetwork !== dashboardTrendNetwork) {
        continue;
      }

      const bucketKey = dashboardTrendDayKey(new Date(job.dataPostagem), effectiveUserTimeZone);
      const bucket = buckets.get(bucketKey);
      if (!bucket) {
        continue;
      }

      const isPublished = job.status === "COMPLETED" || job.status === "SENT_UNCONFIRMED";
      const isFailed = job.status === "FAILED";
      const isScheduled = job.status === "PENDING" || job.status === "WAITING_LOGIN" || job.status === "RUNNING";

      if (isPublished) {
        bucket.published += 1;
        publishedTotal += 1;
      }
      if (isFailed) {
        bucket.failed += 1;
        failedTotal += 1;
      }
      if (isScheduled) {
        bucket.scheduled += 1;
        scheduledTotal += 1;
      }

      const matchesFocus =
        dashboardTrendFocus === "all" ||
        (dashboardTrendFocus === "published" && isPublished) ||
        (dashboardTrendFocus === "failed" && isFailed) ||
        (dashboardTrendFocus === "scheduled" && isScheduled);

      if (matchesFocus) {
        bucket.total += 1;
        activeCompanies.add(job.companyId);
        const distribution = distributionMap.get(job.publicationType);
        if (distribution) {
          distribution.count += 1;
        }
      }
    }

    const points = visibleDayKeys.map((dayKey) => buckets.get(dayKey)!);
    const maxValue = Math.max(
      1,
      ...points.map((point) =>
        dashboardTrendFocus === "all"
          ? Math.max(point.published, point.failed, point.scheduled)
          : point.total,
      ),
    );
    const peakPoint = points.reduce<(typeof points)[number] | null>((current, point) => {
      if (!current || point.total > current.total) {
        return point;
      }
      return current;
    }, null);
    const distributionItems = Array.from(distributionMap.values()).sort((left, right) => right.count - left.count);
    const distributionMax = Math.max(1, ...distributionItems.map((item) => item.count));
    const deliveryBase = publishedTotal + failedTotal;
    const deliveryRate = deliveryBase > 0 ? Math.round((publishedTotal / deliveryBase) * 100) : null;

    return {
      points,
      maxValue,
      publishedTotal,
      failedTotal,
      scheduledTotal,
      activeProfiles: activeCompanies.size,
      peakPoint,
      distributionItems,
      distributionMax,
      deliveryRate,
    };
  }, [dashboardTrendRange, dashboardTrendNetwork, dashboardTrendFocus, filteredJobs, effectiveUserTimeZone, nowTickMs]);

  const historyAvailableYears = useMemo(
    () =>
      Array.from(
        new Set(
          jobsOrderedByCreatedAtDesc.map((job) =>
            String(getYearMonthInTimeZone(new Date(job.dataPostagem), effectiveUserTimeZone).year),
          ),
        ),
      ).sort(
        (left, right) => Number(right) - Number(left),
      ),
    [effectiveUserTimeZone, jobsOrderedByCreatedAtDesc],
  );

  const mediaAvailableYears = useMemo(
    () =>
      Array.from(
        new Set(
          mediaLibrary.map((media) =>
            String(getYearMonthInTimeZone(new Date(media.lastUsedAt), effectiveUserTimeZone).year),
          ),
        ),
      ).sort(
        (left, right) => Number(right) - Number(left),
      ),
    [effectiveUserTimeZone, mediaLibrary],
  );

  const historyFilteredJobs = useMemo(() => {
    const statusFilteredJobs = (() => {
      switch (historyFilter) {
        case "upcoming":
          return jobsOrderedByCreatedAtDesc.filter(
            (job) =>
              job.publicationState === "PUBLISHED" &&
              !isPastScheduledAtForUser(job.dataPostagem) &&
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

    const normalizedSearchQuery = historySearchQuery.trim().toLocaleLowerCase("pt-BR");

    return statusFilteredJobs.filter((job) => {
      const yearMonth = getYearMonthInTimeZone(new Date(job.dataPostagem), effectiveUserTimeZone);
      const monthMatches = historyMonthFilter === "all" || yearMonth.month === Number(historyMonthFilter);
      const yearMatches = historyYearFilter === "all" || yearMonth.year === Number(historyYearFilter);
      if (!monthMatches || !yearMatches) {
        return false;
      }

      if (!normalizedSearchQuery) {
        return true;
      }

      const jobTitle = resolveJobDisplayTitle(job);
      const searchableText = [jobTitle, job.caption ?? ""].join(" ").toLocaleLowerCase("pt-BR");

      return searchableText.includes(normalizedSearchQuery);
    });
  }, [
    companyNameMap,
    effectiveUserTimeZone,
    historyFilter,
    historyMonthFilter,
    historySearchQuery,
    historyYearFilter,
    jobsOrderedByCreatedAtDesc,
    nowTickMs,
  ]);

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
      const yearMonth = getYearMonthInTimeZone(new Date(media.lastUsedAt), effectiveUserTimeZone);
      const monthMatches = mediaMonthFilter === "all" || yearMonth.month === Number(mediaMonthFilter);
      const yearMatches = mediaYearFilter === "all" || yearMonth.year === Number(mediaYearFilter);
      return monthMatches && yearMatches;
    });
  }, [effectiveUserTimeZone, mediaStatusFilter, mediaMonthFilter, mediaYearFilter, mediaLibrary]);

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

  const historyBulkSelectedJobIdsSet = useMemo(() => new Set(historyBulkSelectedJobIds), [historyBulkSelectedJobIds]);
  const historyBulkSelectedJobs = useMemo(
    () => jobs.filter((job) => historyBulkSelectedJobIdsSet.has(job.id)),
    [jobs, historyBulkSelectedJobIdsSet],
  );

  const paginatedMediaItems = useMemo(
    () => mediaFilteredItems.slice((mediaPage - 1) * MEDIA_PAGE_SIZE, mediaPage * MEDIA_PAGE_SIZE),
    [mediaFilteredItems, mediaPage],
  );

  const mergeConnectionsWithCachedRuntimeData = (
    previousConnections: SocialConnection[],
    nextConnections: SocialConnection[],
  ): SocialConnection[] => {
    if (previousConnections.length === 0 || nextConnections.length === 0) {
      return nextConnections;
    }

    const previousById = new Map(previousConnections.map((connection) => [connection.id, connection]));
    return nextConnections.map((connection) => {
      const previous = previousById.get(connection.id);
      if (!previous) {
        return connection;
      }

      if (connection.platform === "instagram" && connection.authStatus === "CONNECTED") {
        return {
          ...connection,
          instagramUsername: connection.instagramUsername || previous.instagramUsername || null,
          instagramUserId: connection.instagramUserId || previous.instagramUserId || null,
        };
      }

      if (connection.platform === "whatsapp" && connection.authStatus === "CONNECTED") {
        return {
          ...connection,
          whatsappProfileName: connection.whatsappProfileName || previous.whatsappProfileName || null,
          whatsappOwnerJid: connection.whatsappOwnerJid || previous.whatsappOwnerJid || null,
        };
      }

      return connection;
    });
  };

  async function loadAll(options?: { withSkeleton?: boolean }): Promise<void> {
    const withSkeleton = options?.withSkeleton ?? true;
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
      setConnections((current) => mergeConnectionsWithCachedRuntimeData(current, connectionsData));
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
        finishContentLoading();
      }
    }
  }

  async function loadAvisosPage(page: number, options?: { withSkeleton?: boolean }): Promise<void> {
    const withSkeleton = options?.withSkeleton ?? true;
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
        finishContentLoading();
      }
    }
  }

  function formatPriceFromCents(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return "—";
    }
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
    }).format(value / 100);
  }

  function formatCompactPriceFromCents(value: number | null): string {
    const formatted = formatPriceFromCents(value);
    return formatted.replace(/^R\$\s?/, "");
  }

  function formatPlanLimitDisplay(limit: number | null | undefined, planCode?: string | null): string {
    if (planCode === "ROOT") {
      return "Ilimitado";
    }
    if (limit === null || limit === undefined) {
      return "0";
    }
    return String(limit);
  }

  async function loadBillingData(options?: { withSkeleton?: boolean }): Promise<void> {
    const withSkeleton = options?.withSkeleton ?? true;
    if (withSkeleton) {
      setBillingLoading(true);
    }

    try {
      const [billingMeData, billingPlansData] = await Promise.all([
        api.get<BillingMe>("/billing/me"),
        api.get<BillingPlan[]>("/billing/plans"),
      ]);
      setBillingMe(billingMeData);
      setBillingPlans(billingPlansData);

      if (isRootUser) {
        const [billingSettingsData, stripeCatalogData] = await Promise.all([
          api.get<BillingSettings>("/billing/settings"),
          api.get<StripeCatalogResponse>("/billing/stripe/catalog").catch(() => null),
        ]);
        setBillingSettings(billingSettingsData);
        if (stripeCatalogData) {
          setStripeCatalogProducts(stripeCatalogData.products ?? []);
          setStripeCatalogResolvedByProduct(stripeCatalogData.resolvedByProduct ?? {});
          setStripeCatalogError("");
        } else {
          setStripeCatalogProducts([]);
          setStripeCatalogResolvedByProduct({});
          setStripeCatalogError("Catálogo Stripe indisponível. Configure STRIPE_SECRET_KEY no backend.");
        }
      } else {
        setStripeCatalogProducts([]);
        setStripeCatalogResolvedByProduct({});
        setStripeCatalogError("");
      }
      setError("");
    } catch (loadBillingError) {
      setError(loadBillingError instanceof Error ? loadBillingError.message : "Falha ao carregar plano.");
      if (isRootUser) {
        setStripeCatalogProducts([]);
        setStripeCatalogResolvedByProduct({});
        setStripeCatalogError("Não foi possível carregar catálogo Stripe.");
      }
    } finally {
      if (withSkeleton) {
        setBillingLoading(false);
      }
    }
  }

  async function loadBillingDiscountUsers(page: number): Promise<void> {
    if (!isRootUser) {
      return;
    }

    setBillingDiscountUsersLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(BILLING_USER_DISCOUNT_PAGE_SIZE));
      if (billingDiscountSearch.trim()) {
        params.set("query", billingDiscountSearch.trim());
      }

      const result = await api.get<BillingUserDiscountListResponse>(`/billing/user-discounts?${params.toString()}`);
      const nextItems = result.items ?? [];
      setBillingDiscountUsers(nextItems);
      setBillingDiscountPage(result.page ?? page);
      setBillingDiscountTotalPages(Math.max(1, result.totalPages ?? 1));
      setBillingDiscountTotal(result.total ?? 0);
      setSelectedBillingDiscountUserId((current) => (nextItems.some((user) => user.id === current) ? current : ""));
      setError("");
    } catch (loadDiscountError) {
      setError(loadDiscountError instanceof Error ? loadDiscountError.message : "Falha ao carregar descontos por usuário.");
      setBillingDiscountUsers([]);
      setBillingDiscountTotalPages(1);
      setBillingDiscountTotal(0);
      setSelectedBillingDiscountUserId("");
    } finally {
      setBillingDiscountUsersLoading(false);
    }
  }

  function openBillingDiscountModal() {
    setPlanInfo("");
    setError("");
    setIsBillingDiscountModalOpen(true);
    setBillingDiscountSearch("");
    setBillingDiscountPage(1);
    setBillingDiscountTotalPages(1);
    setBillingDiscountTotal(0);
    setBillingDiscountUsers([]);
    setSelectedBillingDiscountUserId("");
    setBillingDiscountEnabledInput(false);
    setBillingDiscountPercentInput("0");
  }

  function closeBillingDiscountModal() {
    setIsBillingDiscountModalOpen(false);
    setSelectedBillingDiscountUserId("");
    setBillingDiscountEnabledInput(false);
    setBillingDiscountPercentInput("0");
    setSavingBillingDiscountUserId(null);
  }

  function selectBillingDiscountUser(user: BillingUserDiscountItem) {
    setSelectedBillingDiscountUserId(user.id);
    setBillingDiscountEnabledInput(user.billingDiscountEnabled);
    setBillingDiscountPercentInput(String(Math.max(0, user.billingDiscountPercent)));
  }

  async function saveBillingDiscountForSelectedUser(event: FormEvent) {
    event.preventDefault();
    if (!selectedBillingDiscountUser) {
      setError("Selecione um usuário para aplicar desconto.");
      return;
    }

    const parsedPercent = Number.parseInt(billingDiscountPercentInput, 10);
    if (!Number.isFinite(parsedPercent) || parsedPercent < 0 || parsedPercent > 100) {
      setError("Percentual inválido. Informe um valor entre 0 e 100.");
      return;
    }
    if (billingDiscountEnabledInput && parsedPercent <= 0) {
      setError("Para ativar desconto, informe percentual maior que zero.");
      return;
    }

    setSavingBillingDiscountUserId(selectedBillingDiscountUser.id);
    setError("");
    setPlanInfo("");

    try {
      const result = await api.putJson<{
        billingDiscountEnabled: boolean;
        billingDiscountPercent: number;
        stripeSyncWarning?: string | null;
      }>(`/billing/user-discounts/${selectedBillingDiscountUser.id}`, {
        enabled: billingDiscountEnabledInput,
        percent: parsedPercent,
      });

      if (result.stripeSyncWarning) {
        setError(result.stripeSyncWarning);
      } else {
        setError("");
      }
      setPlanInfo("Desconto individual atualizado com sucesso.");
      await loadBillingDiscountUsers(billingDiscountPage);
    } catch (saveDiscountError) {
      setError(saveDiscountError instanceof Error ? saveDiscountError.message : "Falha ao salvar desconto individual.");
    } finally {
      setSavingBillingDiscountUserId(null);
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

      setConnections((current) => mergeConnectionsWithCachedRuntimeData(current, connectionsData));
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
    const tick = () => {
      setNowTickMs(Date.now());
    };

    tick();
    const intervalId = window.setInterval(tick, 30_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", tick);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", tick);
    };
  }, []);

  useEffect(() => {
    if (!authUser) {
      setUnreadAvisosCount(0);
      setRecentAvisos([]);
      return;
    }

    if (activeView === "notices" || activeView === "profile" || activeView === "plan" || activeView === "planConfig") {
      return;
    }

    void loadAll({ withSkeleton: true });
  }, [selectedCompanyId, authUser, activeView]);

  useEffect(() => {
    if (!authUser || (activeView !== "plan" && activeView !== "planConfig")) {
      return;
    }

    void loadBillingData({ withSkeleton: true });
  }, [authUser, activeView, isRootUser]);

  useEffect(() => {
    if (!isRootUser) {
      return;
    }

    if (rootAssignPlanId && rootAssignablePlans.some((plan) => plan.id === rootAssignPlanId)) {
      return;
    }

    const activeRootPlanId = billingMe?.plan?.id ?? "";
    if (activeRootPlanId && rootAssignablePlans.some((plan) => plan.id === activeRootPlanId)) {
      setRootAssignPlanId(activeRootPlanId);
      return;
    }

    setRootAssignPlanId("");
  }, [isRootUser, rootAssignPlanId, rootAssignablePlans, billingMe?.plan?.id]);

  useEffect(() => {
    if (!isRootUser || !isBillingDiscountModalOpen) {
      return;
    }

    void loadBillingDiscountUsers(billingDiscountPage);
  }, [isRootUser, isBillingDiscountModalOpen, billingDiscountPage, billingDiscountSearch]);

  useEffect(() => {
    if (!isBillingDiscountModalOpen || !selectedBillingDiscountUser) {
      return;
    }

    setBillingDiscountEnabledInput(selectedBillingDiscountUser.billingDiscountEnabled);
    setBillingDiscountPercentInput(String(Math.max(0, selectedBillingDiscountUser.billingDiscountPercent)));
  }, [isBillingDiscountModalOpen, selectedBillingDiscountUser]);

  useEffect(() => {
    if (activeView !== "planConfig" || isRootUser) {
      return;
    }

    navigateToView("dashboard");
  }, [activeView, isRootUser]);

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
    setDashboardUpcomingPage((current) => {
      const maxPage = Math.max(0, dashboardUpcomingPages.length - 1);
      return Math.min(current, maxPage);
    });
  }, [dashboardUpcomingPages.length]);

  useEffect(() => {
    if (publicationState !== "DRAFT") {
      return;
    }

    setScheduledDate("");
    setScheduledTime("");
  }, [publicationState]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    let cancelled = false;

    const refreshUnreadCount = async () => {
      try {
        const result = await api.get<{ count: number }>("/avisos/unread-count");
        if (!cancelled) {
          const nextCount = Math.max(0, result.count);
          const previousCount = lastUnreadAvisosCountRef.current;
          lastUnreadAvisosCountRef.current = nextCount;
          setUnreadAvisosCount(nextCount);
          if (nextCount > previousCount) {
            void refreshLiveData();
          }
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
    setProfileTimeZone(normalizeTimeZone(authUser.timeZone));
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
      setDragOverSchedulerMediaIndex(null);
    }
  }, [publicationType, uploadedSchedulerMedia.length]);

  useEffect(() => {
    if (supportsFirstComment) {
      return;
    }

    if (firstCommentEnabled) {
      setFirstCommentEnabled(false);
    }
    if (firstComment) {
      setFirstComment("");
    }
  }, [firstComment, firstCommentEnabled, supportsFirstComment]);

  useEffect(() => {
    if (!canEnableWhatsappRelink) {
      if (whatsappRelinkEnabled) {
        setWhatsappRelinkEnabled(false);
      }
      if (whatsappRelinkConnectionIds.length > 0) {
        setWhatsappRelinkConnectionIds([]);
      }
      return;
    }

    setWhatsappRelinkConnectionIds((current) => {
      const filtered = current.filter((id) => schedulerWhatsappConnections.some((connection) => connection.id === id));
      return filtered.length === current.length && filtered.every((id, index) => id === current[index]) ? current : filtered;
    });
  }, [canEnableWhatsappRelink, schedulerWhatsappConnections, whatsappRelinkConnectionIds.length, whatsappRelinkEnabled]);

  useEffect(() => {
    if (mediaCaptionModalIndex === null) {
      return;
    }
    if (mediaCaptionModalIndex < uploadedSchedulerMedia.length) {
      return;
    }

    setMediaCaptionModalIndex(null);
    setMediaCaptionDraft("");
  }, [mediaCaptionModalIndex, uploadedSchedulerMedia.length]);

  useEffect(() => {
    if (storyEditorMediaIndex === null) {
      return;
    }

    const target = uploadedSchedulerMedia[storyEditorMediaIndex];
    if (target && isImagePath(target.filePath)) {
      return;
    }

    closeStoryEditorModal();
  }, [storyEditorMediaIndex, uploadedSchedulerMedia]);

  useEffect(() => {
    if (publicationType === "instagram_story") {
      return;
    }

    if (storyEditorMediaIndex !== null) {
      closeStoryEditorModal();
    }
  }, [publicationType, storyEditorMediaIndex]);

  useEffect(() => {
    if (storyEditorToolMode === "DRAW") {
      storyEditorStickerDragRef.current = null;
      storyEditorDecorStickerDragRef.current = null;
      storyEditorTextStickerDragRef.current = null;
      setStoryEditorDraggingSticker(false);
      setStoryEditorDraggingDecorStickerId(null);
      setStoryEditorDraggingTextStickerId(null);
      setStoryEditorActiveDecorStickerId(null);
      setStoryEditorDecorPickerOpen(false);
      setStoryEditorLocationEditing(false);
      return;
    }

    storyEditorDrawRef.current = null;
    setStoryEditorBrushCursor((current) => (current.visible ? { ...current, visible: false } : current));
  }, [storyEditorToolMode]);

  useEffect(() => {
    if (!storyEditorActiveTextStickerId) {
      return;
    }

    const activeSticker = storyEditorTextStickers.find((item) => item.id === storyEditorActiveTextStickerId);
    if (!activeSticker) {
      setStoryEditorActiveTextStickerId(null);
      return;
    }

    setStoryEditorTextColor(activeSticker.textColor);
    setStoryEditorTextBackgroundColor(activeSticker.backgroundColor);
    setStoryEditorTextFontFamily(activeSticker.fontFamily);
    setStoryEditorTextScale(activeSticker.scale);
  }, [storyEditorActiveTextStickerId, storyEditorTextStickers]);

  useEffect(() => {
    if (!storyEditorActiveDecorStickerId) {
      return;
    }

    if (storyEditorDecorStickers.some((item) => item.id === storyEditorActiveDecorStickerId)) {
      return;
    }

    setStoryEditorActiveDecorStickerId(null);
  }, [storyEditorActiveDecorStickerId, storyEditorDecorStickers]);

  useEffect(() => {
    const maxLocationScale = getStoryEditorMaxLocationScale(storyEditorLocationText, storyEditorLocationFontFamily);
    setStoryEditorLocationScale((current) => clamp(current, 0.7, maxLocationScale));
  }, [storyEditorLocationFontFamily, storyEditorLocationText]);

  useEffect(() => {
    if (!activeStoryEditorTextSticker) {
      return;
    }

    const maxTextScale = getStoryEditorMaxTextScale(activeStoryEditorTextSticker.text, activeStoryEditorTextSticker.fontFamily);
    setStoryEditorTextScale((current) => clamp(current, 0.7, maxTextScale));
    setStoryEditorTextStickers((current) => {
      let hasChanges = false;
      const next = current.map((item) => {
        if (item.id !== activeStoryEditorTextSticker.id) {
          return item;
        }

        const nextScale = clamp(item.scale, 0.7, maxTextScale);
        if (nextScale === item.scale) {
          return item;
        }

        hasChanges = true;
        return { ...item, scale: nextScale };
      });

      return hasChanges ? next : current;
    });
  }, [activeStoryEditorTextSticker]);

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

      const shouldPrimeContentSkeleton =
        Boolean(authUser) && nextView !== "profile" && nextView !== "plan" && nextView !== "planConfig" && nextView !== "notices";
      if (shouldPrimeContentSkeleton) {
        setContentLoading(true);
      }

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
  }, [authUser]);

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
  }, [historyFilter, historyMonthFilter, historySearchQuery, historyYearFilter, selectedCompanyId]);

  useEffect(() => {
    setMediaPage(1);
  }, [mediaStatusFilter, mediaMonthFilter, mediaYearFilter, selectedCompanyId]);

  useEffect(() => {
    if (historyBulkAction) {
      return;
    }

    setHistoryBulkSelectedJobIds([]);
  }, [historyBulkAction]);

  useEffect(() => {
    if (historyBulkSelectedJobIds.length === 0) {
      return;
    }

    const availableIds = new Set(jobs.map((job) => job.id));
    setHistoryBulkSelectedJobIds((current) => current.filter((jobId) => availableIds.has(jobId)));
  }, [jobs, historyBulkSelectedJobIds.length]);

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
          caption: null,
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
    closeMediaCaptionModal();
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

  function handleSchedulerMediaThumbDragEnd() {
    setDraggingSchedulerMediaIndex(null);
    setDragOverSchedulerMediaIndex(null);
  }

  function handleSchedulerMediaThumbDragStart(index: number, event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    setDraggingSchedulerMediaIndex(index);
    setDragOverSchedulerMediaIndex(index);
  }

  function handleSchedulerMediaThumbDragOver(index: number, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (draggingSchedulerMediaIndex === null) {
      return;
    }

    const targetRect = event.currentTarget.getBoundingClientRect();
    const shouldInsertAfter = event.clientX >= targetRect.left + targetRect.width / 2;
    const insertionIndex = shouldInsertAfter ? index + 1 : index;
    const clampedInsertionIndex = Math.max(0, Math.min(insertionIndex, uploadedSchedulerMedia.length));
    const nextIndex =
      draggingSchedulerMediaIndex < clampedInsertionIndex
        ? clampedInsertionIndex - 1
        : clampedInsertionIndex;

    setDragOverSchedulerMediaIndex(index);
    if (nextIndex !== draggingSchedulerMediaIndex) {
      reorderSchedulerUploadedMedia(draggingSchedulerMediaIndex, nextIndex);
      setDraggingSchedulerMediaIndex(nextIndex);
    }
  }

  function handleSchedulerMediaThumbDrop(index: number, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOverSchedulerMediaIndex(index);
    if (draggingSchedulerMediaIndex === null) {
      return;
    }
    setDraggingSchedulerMediaIndex(null);
    setDragOverSchedulerMediaIndex(null);
  }

  function openMediaCaptionModal(index: number) {
    const target = uploadedSchedulerMedia[index];
    if (!target) {
      return;
    }

    setMediaCaptionModalIndex(index);
    setMediaCaptionDraft(target.caption?.trim() || "");
  }

  function closeMediaCaptionModal() {
    setMediaCaptionModalIndex(null);
    setMediaCaptionDraft("");
  }

  function saveMediaCaptionModal() {
    if (mediaCaptionModalIndex === null) {
      return;
    }

    const normalizedCaption = mediaCaptionDraft.trim();
    setUploadedSchedulerMedia((current) =>
      current.map((item, index) =>
        index === mediaCaptionModalIndex
          ? {
              ...item,
              caption: normalizedCaption.length > 0 ? normalizedCaption : null,
            }
          : item,
      ),
    );
    closeMediaCaptionModal();
  }

  function openStoryEditorModal(index: number) {
    const target = uploadedSchedulerMedia[index];
    if (!target || !isImagePath(target.filePath)) {
      return;
    }

    storyEditorStickerDragRef.current = null;
    storyEditorDecorStickerDragRef.current = null;
    storyEditorTextStickerDragRef.current = null;
    storyEditorDrawRef.current = null;
    closeMediaCaptionModal();
    setStoryEditorMediaIndex(index);
    setStoryEditorLocationEnabled(isInstagramForcedLocationEnabled);
    setStoryEditorLocationText(isInstagramForcedLocationEnabled ? instagramForcedLocationName : "");
    setStoryEditorLocationTextColor(STORY_EDITOR_DEFAULT_LOCATION_TEXT_COLOR);
    setStoryEditorLocationBackgroundColor(STORY_EDITOR_DEFAULT_LOCATION_BACKGROUND_COLOR);
    setStoryEditorLocationFontFamily(STORY_EDITOR_DEFAULT_FONT);
    setStoryEditorLocationScale(1);
    setStoryEditorLocationEditing(false);
    setStoryEditorStickerX(0.5);
    setStoryEditorStickerY(0.18);
    setStoryEditorToolMode("MOVE");
    setStoryEditorBrushColor(STORY_EDITOR_BRUSH_COLORS[0] ?? "#ffffff");
    setStoryEditorBrushSize(10);
    setStoryEditorBrushCursor({ visible: false, x: 0.5, y: 0.5 });
    setStoryEditorStrokes([]);
    setStoryEditorDecorStickers([]);
    setStoryEditorActiveDecorStickerId(null);
    setStoryEditorDecorPickerOpen(false);
    setStoryEditorTextColor(STORY_EDITOR_DEFAULT_TEXT_COLOR);
    setStoryEditorTextBackgroundColor(STORY_EDITOR_DEFAULT_TEXT_BACKGROUND_COLOR);
    setStoryEditorTextFontFamily(STORY_EDITOR_DEFAULT_FONT);
    setStoryEditorTextScale(1);
    setStoryEditorTextStickers([]);
    setStoryEditorActiveTextStickerId(null);
    setStoryEditorDraggingDecorStickerId(null);
    setStoryEditorDraggingTextStickerId(null);
    setStoryEditorDraggingSticker(false);
  }

  function closeStoryEditorModal() {
    storyEditorStickerDragRef.current = null;
    storyEditorDecorStickerDragRef.current = null;
    storyEditorTextStickerDragRef.current = null;
    storyEditorDrawRef.current = null;
    setStoryEditorDraggingSticker(false);
    setStoryEditorDraggingDecorStickerId(null);
    setStoryEditorDraggingTextStickerId(null);
    setStoryEditorMediaIndex(null);
    setStoryEditorLocationEnabled(false);
    setStoryEditorLocationText("");
    setStoryEditorLocationTextColor(STORY_EDITOR_DEFAULT_LOCATION_TEXT_COLOR);
    setStoryEditorLocationBackgroundColor(STORY_EDITOR_DEFAULT_LOCATION_BACKGROUND_COLOR);
    setStoryEditorLocationFontFamily(STORY_EDITOR_DEFAULT_FONT);
    setStoryEditorLocationScale(1);
    setStoryEditorLocationEditing(false);
    setStoryEditorStickerX(0.5);
    setStoryEditorStickerY(0.18);
    setStoryEditorToolMode("MOVE");
    setStoryEditorBrushColor(STORY_EDITOR_BRUSH_COLORS[0] ?? "#ffffff");
    setStoryEditorBrushSize(10);
    setStoryEditorBrushCursor({ visible: false, x: 0.5, y: 0.5 });
    setStoryEditorStrokes([]);
    setStoryEditorDecorStickers([]);
    setStoryEditorActiveDecorStickerId(null);
    setStoryEditorDecorPickerOpen(false);
    setStoryEditorTextColor(STORY_EDITOR_DEFAULT_TEXT_COLOR);
    setStoryEditorTextBackgroundColor(STORY_EDITOR_DEFAULT_TEXT_BACKGROUND_COLOR);
    setStoryEditorTextFontFamily(STORY_EDITOR_DEFAULT_FONT);
    setStoryEditorTextScale(1);
    setStoryEditorTextStickers([]);
    setStoryEditorActiveTextStickerId(null);
    setStoryEditorSaving(false);
  }

  function discardSchedulerSelectedMedia() {
    closeMediaCaptionModal();
    closeStoryEditorModal();
    setUploadedSchedulerMedia([]);
    setDraggingSchedulerMediaIndex(null);
    setDragOverSchedulerMediaIndex(null);
    setUploadDragActive(false);
    if (schedulerMediaInputRef.current) {
      schedulerMediaInputRef.current.value = "";
    }
  }

  function handlePublicationTypeChange(nextPublicationType: SchedulerPublicationType) {
    if (nextPublicationType === publicationType) {
      return;
    }

    if (uploadedSchedulerMedia.length > 0 || mediaCaptionModalIndex !== null || storyEditorMediaIndex !== null) {
      discardSchedulerSelectedMedia();
    } else if (schedulerMediaInputRef.current) {
      schedulerMediaInputRef.current.value = "";
    }

    if (nextPublicationType === "instagram_story" && caption) {
      setCaption("");
    }

    setError("");
    setSchedulerInfo("");
    setPublicationType(nextPublicationType);
  }

  function handleStoryEditorStickerPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (storyEditorSaving || storyEditorToolMode === "DRAW") {
      return;
    }

    const stageRect = storyEditorStageRef.current?.getBoundingClientRect();
    if (!stageRect || stageRect.width <= 0 || stageRect.height <= 0) {
      return;
    }

    const stickerCenterX = storyEditorStickerX * stageRect.width;
    const stickerCenterY = storyEditorStickerY * stageRect.height;

    storyEditorStickerDragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - (stageRect.left + stickerCenterX),
      offsetY: event.clientY - (stageRect.top + stickerCenterY),
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    setStoryEditorActiveTextStickerId(null);
    setStoryEditorActiveDecorStickerId(null);
    setStoryEditorDraggingSticker(true);
  }

  function handleStoryEditorStickerPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragState = storyEditorStickerDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const stageRect = storyEditorStageRef.current?.getBoundingClientRect();
    if (!stageRect || stageRect.width <= 0 || stageRect.height <= 0) {
      return;
    }

    const stickerCenterX = event.clientX - stageRect.left - dragState.offsetX;
    const stickerCenterY = event.clientY - stageRect.top - dragState.offsetY;
    const stickerSize = estimateStoryEditorLocationStickerSize(
      storyEditorResolvedLocationName || "Sua localização",
      storyEditorLocationFontFamily,
      storyEditorLocationScale,
    );
    const minX = Math.max(STORY_EDITOR_STICKER_MIN * stageRect.width, stickerSize.width / 2 + 8);
    const maxX = Math.min(STORY_EDITOR_STICKER_MAX * stageRect.width, stageRect.width - stickerSize.width / 2 - 8);
    const minY = Math.max(STORY_EDITOR_STICKER_MIN * stageRect.height, stickerSize.height / 2 + 8);
    const maxY = Math.min(STORY_EDITOR_STICKER_MAX * stageRect.height, stageRect.height - stickerSize.height / 2 - 8);
    const normalizedX = clamp(clamp(stickerCenterX, minX, maxX) / stageRect.width, STORY_EDITOR_STICKER_MIN, STORY_EDITOR_STICKER_MAX);
    const normalizedY = clamp(clamp(stickerCenterY, minY, maxY) / stageRect.height, STORY_EDITOR_STICKER_MIN, STORY_EDITOR_STICKER_MAX);

    setStoryEditorStickerX(normalizedX);
    setStoryEditorStickerY(normalizedY);
  }

  function handleStoryEditorStickerPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragState = storyEditorStickerDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    storyEditorStickerDragRef.current = null;
    setStoryEditorDraggingSticker(false);
  }

  function storyEditorNormalizedPointFromClient(clientX: number, clientY: number): StoryEditorStrokePoint | null {
    const stageRect = storyEditorStageRef.current?.getBoundingClientRect();
    if (!stageRect || stageRect.width <= 0 || stageRect.height <= 0) {
      return null;
    }

    return {
      x: clamp((clientX - stageRect.left) / stageRect.width, 0, 1),
      y: clamp((clientY - stageRect.top) / stageRect.height, 0, 1),
    };
  }

  function updateStoryEditorBrushCursor(clientX: number, clientY: number) {
    const point = storyEditorNormalizedPointFromClient(clientX, clientY);
    if (!point) {
      return;
    }

    setStoryEditorBrushCursor({
      visible: true,
      x: point.x,
      y: point.y,
    });
  }

  function getStoryEditorMeasureContext(): CanvasRenderingContext2D | null {
    if (typeof document === "undefined") {
      return null;
    }

    let canvas = storyEditorMeasureCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      storyEditorMeasureCanvasRef.current = canvas;
    }

    return canvas.getContext("2d");
  }

  function measureStoryEditorTextWidth(text: string, fontSize: number, fontFamily: string): number {
    const context = getStoryEditorMeasureContext();
    if (!context) {
      return Math.max(text.length * fontSize * 0.6, fontSize);
    }

    context.font = `500 ${fontSize}px ${fontFamily}, K2D, Arial, sans-serif`;
    return context.measureText(text || " ").width;
  }

  function estimateStoryEditorTextStickerSize(text: string, fontFamily: string, scale: number) {
    const normalizedScale = clamp(scale, 0.7, 3);
    const baseFontSize = 14;
    const horizontalPadding = 20;
    const verticalPadding = 12;
    const textWidth = measureStoryEditorTextWidth(text.trim() || "Texto", baseFontSize, fontFamily);
    const width = Math.max(textWidth + horizontalPadding, 42) * normalizedScale;
    const height = Math.max(baseFontSize + verticalPadding, 34) * normalizedScale;
    return { width, height };
  }

  function estimateStoryEditorLocationStickerSize(text: string, fontFamily: string, scale: number) {
    const normalizedScale = clamp(scale, 0.7, 2.2);
    const baseFontSize = 14;
    const iconWidth = 14;
    const horizontalPadding = 12;
    const textWidth = measureStoryEditorTextWidth(text.trim() || "Sua localização", baseFontSize, fontFamily);
    const width = Math.max(textWidth + iconWidth + horizontalPadding, 64) * normalizedScale;
    const height = Math.max(baseFontSize + 14, 36) * normalizedScale;
    return { width, height };
  }

  function getStoryEditorMaxStickerScale(baseWidthAtScaleOne: number): number {
    const stageWidth = storyEditorStageRef.current?.getBoundingClientRect().width ?? 360;
    const availableWidth = Math.max(stageWidth * (STORY_EDITOR_STICKER_MAX - STORY_EDITOR_STICKER_MIN), 40);
    return clamp(availableWidth / Math.max(baseWidthAtScaleOne, 1), 0.7, 3);
  }

  function getStoryEditorMaxLocationScale(locationText: string, fontFamily: string): number {
    const estimate = estimateStoryEditorLocationStickerSize(locationText, fontFamily, 1);
    return clamp(getStoryEditorMaxStickerScale(estimate.width), 0.7, 2.2);
  }

  function getStoryEditorMaxTextScale(text: string, fontFamily: string): number {
    const estimate = estimateStoryEditorTextStickerSize(text, fontFamily, 1);
    return getStoryEditorMaxStickerScale(estimate.width);
  }

  function toggleStoryEditorDrawMode() {
    setStoryEditorToolMode((current) => (current === "DRAW" ? "MOVE" : "DRAW"));
    setStoryEditorDecorPickerOpen(false);
  }

  function toggleStoryEditorDecorPicker() {
    setStoryEditorToolMode("MOVE");
    setStoryEditorDecorPickerOpen((current) => !current);
    setStoryEditorLocationEditing(false);
    setStoryEditorActiveTextStickerId(null);
    setStoryEditorActiveDecorStickerId(null);
  }

  function toggleStoryEditorLocationSticker() {
    setStoryEditorToolMode("MOVE");
    setStoryEditorDecorPickerOpen(false);
    setStoryEditorActiveTextStickerId(null);
    setStoryEditorActiveDecorStickerId(null);

    if (!storyEditorLocationEnabled) {
      setStoryEditorLocationEnabled(true);
      setStoryEditorLocationText(
        storyEditorResolvedLocationName || (isInstagramForcedLocationEnabled ? instagramForcedLocationName : "Sua localização"),
      );
      setStoryEditorLocationEditing(true);
      return;
    }

    setStoryEditorLocationEditing((current) => !current);
  }

  function removeStoryEditorLocationSticker() {
    setStoryEditorLocationEnabled(false);
    setStoryEditorLocationText("");
    setStoryEditorLocationTextColor(STORY_EDITOR_DEFAULT_LOCATION_TEXT_COLOR);
    setStoryEditorLocationBackgroundColor(STORY_EDITOR_DEFAULT_LOCATION_BACKGROUND_COLOR);
    setStoryEditorLocationFontFamily(STORY_EDITOR_DEFAULT_FONT);
    setStoryEditorLocationScale(1);
    setStoryEditorLocationEditing(false);
    setStoryEditorActiveDecorStickerId(null);
  }

  function addStoryEditorDecorSticker(emoji: string) {
    const nextIndex = storyEditorDecorStickers.length;
    const offset = Math.min(nextIndex, 4) * 0.04;
    const stickerId = `decor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setStoryEditorDecorStickers((current) => [
      ...current,
      {
        id: stickerId,
        emoji,
        x: clamp(0.5 + offset, STORY_EDITOR_STICKER_MIN, STORY_EDITOR_STICKER_MAX),
        y: clamp(0.72 + offset * 0.6, STORY_EDITOR_STICKER_MIN, STORY_EDITOR_STICKER_MAX),
      },
    ]);
    setStoryEditorActiveDecorStickerId(stickerId);
    setStoryEditorActiveTextStickerId(null);
    setStoryEditorLocationEditing(false);
    setStoryEditorDecorPickerOpen(false);
  }

  function handleStoryEditorDecorStickerPointerDown(
    stickerId: string,
    stickerX: number,
    stickerY: number,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (storyEditorSaving || storyEditorToolMode === "DRAW") {
      return;
    }

    const stageRect = storyEditorStageRef.current?.getBoundingClientRect();
    if (!stageRect || stageRect.width <= 0 || stageRect.height <= 0) {
      return;
    }

    const stickerCenterX = stickerX * stageRect.width;
    const stickerCenterY = stickerY * stageRect.height;

    storyEditorDecorStickerDragRef.current = {
      pointerId: event.pointerId,
      stickerId,
      offsetX: event.clientX - (stageRect.left + stickerCenterX),
      offsetY: event.clientY - (stageRect.top + stickerCenterY),
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    setStoryEditorActiveTextStickerId(null);
    setStoryEditorActiveDecorStickerId(stickerId);
    setStoryEditorDraggingDecorStickerId(stickerId);
  }

  function handleStoryEditorDecorStickerPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragState = storyEditorDecorStickerDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const stageRect = storyEditorStageRef.current?.getBoundingClientRect();
    if (!stageRect || stageRect.width <= 0 || stageRect.height <= 0) {
      return;
    }

    const stickerCenterX = event.clientX - stageRect.left - dragState.offsetX;
    const stickerCenterY = event.clientY - stageRect.top - dragState.offsetY;
    const nextX = clamp(stickerCenterX / stageRect.width, STORY_EDITOR_STICKER_MIN, STORY_EDITOR_STICKER_MAX);
    const nextY = clamp(stickerCenterY / stageRect.height, STORY_EDITOR_STICKER_MIN, STORY_EDITOR_STICKER_MAX);

    setStoryEditorDecorStickers((current) =>
      current.map((item) => (item.id === dragState.stickerId ? { ...item, x: nextX, y: nextY } : item)),
    );
  }

  function handleStoryEditorDecorStickerPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragState = storyEditorDecorStickerDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    storyEditorDecorStickerDragRef.current = null;
    setStoryEditorDraggingDecorStickerId(null);
  }

  function handleStoryEditorTextStickerPointerDown(
    stickerId: string,
    stickerX: number,
    stickerY: number,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (storyEditorSaving || storyEditorToolMode === "DRAW") {
      return;
    }

    const stageRect = storyEditorStageRef.current?.getBoundingClientRect();
    if (!stageRect || stageRect.width <= 0 || stageRect.height <= 0) {
      return;
    }

    const stickerCenterX = stickerX * stageRect.width;
    const stickerCenterY = stickerY * stageRect.height;

    storyEditorTextStickerDragRef.current = {
      pointerId: event.pointerId,
      stickerId,
      offsetX: event.clientX - (stageRect.left + stickerCenterX),
      offsetY: event.clientY - (stageRect.top + stickerCenterY),
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    setStoryEditorLocationEditing(false);
    setStoryEditorDecorPickerOpen(false);
    setStoryEditorActiveDecorStickerId(null);
    const activeSticker = storyEditorTextStickers.find((item) => item.id === stickerId);
    if (activeSticker) {
      setStoryEditorTextColor(activeSticker.textColor);
      setStoryEditorTextBackgroundColor(activeSticker.backgroundColor);
      setStoryEditorTextFontFamily(activeSticker.fontFamily);
      setStoryEditorTextScale(activeSticker.scale);
    }
    setStoryEditorActiveTextStickerId(stickerId);
    setStoryEditorDraggingTextStickerId(stickerId);
  }

  function handleStoryEditorTextStickerPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragState = storyEditorTextStickerDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const stageRect = storyEditorStageRef.current?.getBoundingClientRect();
    if (!stageRect || stageRect.width <= 0 || stageRect.height <= 0) {
      return;
    }

    const stickerCenterX = event.clientX - stageRect.left - dragState.offsetX;
    const stickerCenterY = event.clientY - stageRect.top - dragState.offsetY;
    setStoryEditorTextStickers((current) =>
      current.map((item) => {
        if (item.id !== dragState.stickerId) {
          return item;
        }

        const stickerSize = estimateStoryEditorTextStickerSize(item.text, item.fontFamily, item.scale);
        const minX = Math.max(STORY_EDITOR_STICKER_MIN * stageRect.width, stickerSize.width / 2 + 8);
        const maxX = Math.min(STORY_EDITOR_STICKER_MAX * stageRect.width, stageRect.width - stickerSize.width / 2 - 8);
        const minY = Math.max(STORY_EDITOR_STICKER_MIN * stageRect.height, stickerSize.height / 2 + 8);
        const maxY = Math.min(STORY_EDITOR_STICKER_MAX * stageRect.height, stageRect.height - stickerSize.height / 2 - 8);
        const nextX = clamp(
          clamp(stickerCenterX, minX, maxX) / stageRect.width,
          STORY_EDITOR_STICKER_MIN,
          STORY_EDITOR_STICKER_MAX,
        );
        const nextY = clamp(
          clamp(stickerCenterY, minY, maxY) / stageRect.height,
          STORY_EDITOR_STICKER_MIN,
          STORY_EDITOR_STICKER_MAX,
        );

        return { ...item, x: nextX, y: nextY };
      }),
    );
  }

  function handleStoryEditorTextStickerPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragState = storyEditorTextStickerDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    storyEditorTextStickerDragRef.current = null;
    setStoryEditorDraggingTextStickerId(null);
  }

  function addStoryEditorTextSticker() {
    setStoryEditorToolMode("MOVE");
    setStoryEditorLocationEditing(false);
    setStoryEditorDecorPickerOpen(false);
    setStoryEditorActiveDecorStickerId(null);
    const initialText = "Digite aqui";
    const maxScale = getStoryEditorMaxTextScale(initialText, storyEditorTextFontFamily);
    const initialScale = clamp(storyEditorTextScale, 0.7, maxScale);
    const nextIndex = storyEditorTextStickers.length;
    const offset = Math.min(nextIndex, 4) * 0.04;
    const stickerId = `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setStoryEditorTextStickers((current) => [
      ...current,
      {
        id: stickerId,
        text: initialText,
        x: clamp(0.5 + offset * 0.4, STORY_EDITOR_STICKER_MIN, STORY_EDITOR_STICKER_MAX),
        y: clamp(0.5 + offset * 0.6, STORY_EDITOR_STICKER_MIN, STORY_EDITOR_STICKER_MAX),
        textColor: storyEditorTextColor,
        backgroundColor: storyEditorTextBackgroundColor,
        fontFamily: storyEditorTextFontFamily,
        scale: initialScale,
      },
    ]);
    setStoryEditorTextScale(initialScale);
    setStoryEditorActiveTextStickerId(stickerId);
  }

  function updateStoryEditorActiveTextStickerText(nextText: string) {
    if (!storyEditorActiveTextStickerId) {
      return;
    }

    setStoryEditorTextStickers((current) =>
      current.map((item) => (item.id === storyEditorActiveTextStickerId ? { ...item, text: nextText.slice(0, 120) } : item)),
    );
  }

  function updateStoryEditorActiveTextStickerTextColor(nextColor: string) {
    setStoryEditorTextColor(nextColor);
    if (!storyEditorActiveTextStickerId) {
      return;
    }

    setStoryEditorTextStickers((current) =>
      current.map((item) => (item.id === storyEditorActiveTextStickerId ? { ...item, textColor: nextColor } : item)),
    );
  }

  function updateStoryEditorActiveTextStickerBackground(nextColor: string) {
    setStoryEditorTextBackgroundColor(nextColor);
    if (!storyEditorActiveTextStickerId) {
      return;
    }

    setStoryEditorTextStickers((current) =>
      current.map((item) => (item.id === storyEditorActiveTextStickerId ? { ...item, backgroundColor: nextColor } : item)),
    );
  }

  function updateStoryEditorActiveTextStickerFontFamily(nextFontFamily: string) {
    setStoryEditorTextFontFamily(nextFontFamily);
    if (!storyEditorActiveTextStickerId) {
      return;
    }

    setStoryEditorTextStickers((current) =>
      current.map((item) => (item.id === storyEditorActiveTextStickerId ? { ...item, fontFamily: nextFontFamily } : item)),
    );
  }

  function updateStoryEditorActiveTextStickerScale(nextScale: number) {
    const normalizedScale = clamp(nextScale, 0.7, 3);
    const maxScale = getStoryEditorMaxTextScale(activeStoryEditorTextSticker?.text || "Texto", storyEditorTextFontFamily);
    const clampedScale = clamp(normalizedScale, 0.7, maxScale);
    setStoryEditorTextScale(clampedScale);
    if (!storyEditorActiveTextStickerId) {
      return;
    }

    setStoryEditorTextStickers((current) =>
      current.map((item) => (item.id === storyEditorActiveTextStickerId ? { ...item, scale: clampedScale } : item)),
    );
  }

  function updateStoryEditorLocationFont(nextFontFamily: string) {
    setStoryEditorLocationFontFamily(nextFontFamily);
    const maxScale = getStoryEditorMaxLocationScale(storyEditorLocationText, nextFontFamily);
    setStoryEditorLocationScale((current) => clamp(current, 0.7, maxScale));
  }

  function updateStoryEditorLocationScale(nextScale: number) {
    const maxScale = getStoryEditorMaxLocationScale(storyEditorLocationText, storyEditorLocationFontFamily);
    setStoryEditorLocationScale(clamp(nextScale, 0.7, maxScale));
  }

  function removeStoryEditorActiveTextSticker() {
    if (!storyEditorActiveTextStickerId) {
      return;
    }

    setStoryEditorTextStickers((current) => current.filter((item) => item.id !== storyEditorActiveTextStickerId));
    setStoryEditorActiveTextStickerId(null);
  }

  function removeStoryEditorActiveDecorSticker() {
    if (!storyEditorActiveDecorStickerId) {
      return;
    }

    setStoryEditorDecorStickers((current) => current.filter((item) => item.id !== storyEditorActiveDecorStickerId));
    setStoryEditorActiveDecorStickerId(null);
  }

  function clearStoryEditorStrokes() {
    setStoryEditorStrokes([]);
    storyEditorDrawRef.current = null;
    setStoryEditorBrushCursor((current) => (current.visible ? { ...current, visible: false } : current));
  }

  function handleStoryEditorStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (storyEditorSaving || storyEditorToolMode !== "DRAW") {
      return;
    }

    const target = event.target as HTMLElement;
    if (
      target.closest(".scheduler-story-editor-sticker") ||
      target.closest(".scheduler-story-editor-sticker-delete") ||
      target.closest(".scheduler-story-editor-overlay-controls")
    ) {
      return;
    }

    const point = storyEditorNormalizedPointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    event.preventDefault();
    const strokeId = `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    storyEditorDrawRef.current = { pointerId: event.pointerId, strokeId };
    event.currentTarget.setPointerCapture(event.pointerId);
    updateStoryEditorBrushCursor(event.clientX, event.clientY);

    setStoryEditorStrokes((current) => [
      ...current,
      {
        id: strokeId,
        color: storyEditorBrushColor,
        size: storyEditorBrushSize,
        points: [point],
      },
    ]);
  }

  function handleStoryEditorStagePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (storyEditorToolMode === "DRAW") {
      updateStoryEditorBrushCursor(event.clientX, event.clientY);
    }

    const drawState = storyEditorDrawRef.current;
    if (!drawState || drawState.pointerId !== event.pointerId) {
      return;
    }

    const coalescedEvents =
      typeof event.nativeEvent.getCoalescedEvents === "function" ? event.nativeEvent.getCoalescedEvents() : [];
    const normalizedPoints = coalescedEvents
      .map((coalescedEvent) => storyEditorNormalizedPointFromClient(coalescedEvent.clientX, coalescedEvent.clientY))
      .filter((point): point is StoryEditorStrokePoint => point !== null);

    if (normalizedPoints.length === 0) {
      const fallbackPoint = storyEditorNormalizedPointFromClient(event.clientX, event.clientY);
      if (fallbackPoint) {
        normalizedPoints.push(fallbackPoint);
      }
    }

    if (normalizedPoints.length === 0) {
      return;
    }

    event.preventDefault();
    setStoryEditorStrokes((current) =>
      current.map((stroke) =>
        stroke.id === drawState.strokeId
          ? {
              ...stroke,
              points: [...stroke.points, ...normalizedPoints],
            }
          : stroke,
      ),
    );
  }

  function handleStoryEditorStagePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drawState = storyEditorDrawRef.current;
    if (!drawState || drawState.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    storyEditorDrawRef.current = null;
  }

  function handleStoryEditorStagePointerEnter(event: ReactPointerEvent<HTMLDivElement>) {
    if (storyEditorToolMode !== "DRAW") {
      return;
    }
    updateStoryEditorBrushCursor(event.clientX, event.clientY);
  }

  function handleStoryEditorStagePointerLeave() {
    setStoryEditorBrushCursor((current) => (current.visible ? { ...current, visible: false } : current));
  }

  async function saveStoryEditorMedia() {
    if (storyEditorMediaIndex === null) {
      return;
    }

    const target = uploadedSchedulerMedia[storyEditorMediaIndex];
    if (!target || !isImagePath(target.filePath)) {
      setSchedulerInfo("Selecione uma imagem válida para editar o story.");
      return;
    }

    setStoryEditorSaving(true);
    setError("");
    setSchedulerInfo("Aplicando edição experimental do story...");

    try {
      const imageUrl = `${api.baseUrl}${target.filePath}`;
      const image = await readImageElementFromUrl(imageUrl);
      const canvas = document.createElement("canvas");
      canvas.width = STORY_EDITOR_CANVAS_WIDTH;
      canvas.height = STORY_EDITOR_CANVAS_HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Não foi possível iniciar o canvas do editor.");
      }

      const scale = Math.max(
        STORY_EDITOR_CANVAS_WIDTH / image.naturalWidth,
        STORY_EDITOR_CANVAS_HEIGHT / image.naturalHeight,
      );
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      const drawX = (STORY_EDITOR_CANVAS_WIDTH - drawWidth) / 2;
      const drawY = (STORY_EDITOR_CANVAS_HEIGHT - drawHeight) / 2;

      context.clearRect(0, 0, STORY_EDITOR_CANVAS_WIDTH, STORY_EDITOR_CANVAS_HEIGHT);
      context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

      if (storyEditorResolvedLocationName) {
        const stickerBodyText = storyEditorResolvedLocationName;
        const stickerScale = clamp(storyEditorLocationScale, 0.7, 3);
        const stickerFontSize = 52 * stickerScale;
        const stickerPaddingX = 42 * stickerScale;
        const stickerHeight = 110 * stickerScale;
        const stickerRadius = 38 * stickerScale;
        const stickerIconGap = 14 * stickerScale;
        const stickerMargin = 30;
        const stickerIconSize = stickerFontSize;

        context.font = `500 ${stickerFontSize}px ${storyEditorLocationFontFamily}, K2D, Arial, sans-serif`;
        const textWidth = context.measureText(stickerBodyText).width;
        const stickerWidth = stickerIconSize + stickerIconGap + textWidth + stickerPaddingX * 2;
        const stickerCenterX = clamp(
          storyEditorStickerX * STORY_EDITOR_CANVAS_WIDTH,
          stickerWidth / 2 + stickerMargin,
          STORY_EDITOR_CANVAS_WIDTH - stickerWidth / 2 - stickerMargin,
        );
        const stickerCenterY = clamp(
          storyEditorStickerY * STORY_EDITOR_CANVAS_HEIGHT,
          stickerHeight / 2 + stickerMargin,
          STORY_EDITOR_CANVAS_HEIGHT - stickerHeight / 2 - stickerMargin,
        );
        const stickerX = stickerCenterX - stickerWidth / 2;
        const stickerY = stickerCenterY - stickerHeight / 2;
        const stickerGradient = context.createLinearGradient(
          stickerX,
          stickerY,
          stickerX + stickerWidth,
          stickerY + stickerHeight,
        );
        stickerGradient.addColorStop(0, "#8b5cf6");
        stickerGradient.addColorStop(0.56, "#ec4899");
        stickerGradient.addColorStop(1, "#f59e0b");
        const hasBackground = storyEditorLocationBackgroundColor !== "transparent";

        if (hasBackground) {
          drawRoundedRect(context, stickerX, stickerY, stickerWidth, stickerHeight, stickerRadius);
          context.fillStyle = storyEditorLocationBackgroundColor;
          context.fill();
        }

        context.textBaseline = "middle";
        const textY = stickerY + stickerHeight / 2 + 1;
        const pinIconLeft = stickerX + stickerPaddingX;
        const pinIconTop = stickerY + (stickerHeight - stickerIconSize) / 2;
        const pinPath = new Path2D("M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z");
        const pinCenter = new Path2D("M15 10a3 3 0 1 1 -6 0a3 3 0 0 1 6 0z");
        context.save();
        context.translate(pinIconLeft, pinIconTop);
        context.scale(stickerIconSize / 24, stickerIconSize / 24);
        context.strokeStyle = stickerGradient;
        context.lineWidth = 2;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.stroke(pinPath);
        context.stroke(pinCenter);
        context.restore();

        context.fillStyle = storyEditorLocationTextColor;
        context.fillText(stickerBodyText, stickerX + stickerPaddingX + stickerIconSize + stickerIconGap, textY);
      }

      if (storyEditorStrokes.length > 0) {
        const strokeScaleFactor = STORY_EDITOR_CANVAS_WIDTH / 360;
        for (const stroke of storyEditorStrokes) {
          if (stroke.points.length === 0) {
            continue;
          }

          const lineWidth = clamp(stroke.size * strokeScaleFactor, 4, 80);
          context.strokeStyle = stroke.color;
          context.fillStyle = stroke.color;
          context.lineCap = "round";
          context.lineJoin = "round";
          context.lineWidth = lineWidth;

          if (stroke.points.length === 1) {
            const [singlePoint] = stroke.points;
            if (!singlePoint) {
              continue;
            }
            context.beginPath();
            context.arc(
              singlePoint.x * STORY_EDITOR_CANVAS_WIDTH,
              singlePoint.y * STORY_EDITOR_CANVAS_HEIGHT,
              lineWidth / 2,
              0,
              Math.PI * 2,
            );
            context.fill();
            continue;
          }

          drawStrokeOnCanvas(context, stroke.points, STORY_EDITOR_CANVAS_WIDTH, STORY_EDITOR_CANVAS_HEIGHT);
        }
      }

      if (storyEditorDecorStickers.length > 0) {
        context.textAlign = "center";
        context.textBaseline = "middle";
        const stickerFontSize = 96;
        context.font = `500 ${stickerFontSize}px K2D, Apple Color Emoji, Segoe UI Emoji, sans-serif`;
        for (const sticker of storyEditorDecorStickers) {
          const centerX = clamp(
            sticker.x * STORY_EDITOR_CANVAS_WIDTH,
            STORY_EDITOR_CANVAS_WIDTH * STORY_EDITOR_STICKER_MIN,
            STORY_EDITOR_CANVAS_WIDTH * STORY_EDITOR_STICKER_MAX,
          );
          const centerY = clamp(
            sticker.y * STORY_EDITOR_CANVAS_HEIGHT,
            STORY_EDITOR_CANVAS_HEIGHT * STORY_EDITOR_STICKER_MIN,
            STORY_EDITOR_CANVAS_HEIGHT * STORY_EDITOR_STICKER_MAX,
          );
          context.shadowColor = "rgba(15, 23, 42, 0.28)";
          context.shadowBlur = 8;
          context.fillText(sticker.emoji, centerX, centerY);
          context.shadowBlur = 0;
        }
      }

      if (storyEditorTextStickers.length > 0) {
        const textMargin = 24;

        context.textAlign = "center";
        context.textBaseline = "middle";

        for (const textSticker of storyEditorTextStickers) {
          const textScale = clamp(textSticker.scale, 0.7, 3);
          const textFontSize = 52 * textScale;
          const textLineHeight = textFontSize * 1.18;
          const textPaddingX = 26 * textScale;
          const textPaddingY = 18 * textScale;

          const lines = textSticker.text
            .split(/\n+/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .slice(0, 4);
          if (lines.length === 0) {
            continue;
          }

          context.font = `500 ${textFontSize}px ${textSticker.fontFamily}, K2D, Arial, sans-serif`;
          const maxLineWidth = Math.max(...lines.map((line) => context.measureText(line).width));
          const boxWidth = maxLineWidth + textPaddingX * 2;
          const boxHeight = lines.length * textLineHeight + textPaddingY * 2;
          const centerX = clamp(
            textSticker.x * STORY_EDITOR_CANVAS_WIDTH,
            boxWidth / 2 + textMargin,
            STORY_EDITOR_CANVAS_WIDTH - boxWidth / 2 - textMargin,
          );
          const centerY = clamp(
            textSticker.y * STORY_EDITOR_CANVAS_HEIGHT,
            boxHeight / 2 + textMargin,
            STORY_EDITOR_CANVAS_HEIGHT - boxHeight / 2 - textMargin,
          );
          const boxX = centerX - boxWidth / 2;
          const boxY = centerY - boxHeight / 2;
          const hasBackground = textSticker.backgroundColor !== "transparent";

          if (hasBackground) {
            drawRoundedRect(context, boxX, boxY, boxWidth, boxHeight, 30 * textScale);
            context.fillStyle = textSticker.backgroundColor;
            context.fill();
          }

          context.fillStyle = textSticker.textColor;
          lines.forEach((line, lineIndex) => {
            const lineY = boxY + textPaddingY + textLineHeight * lineIndex + textLineHeight / 2;
            context.fillText(line, centerX, lineY);
          });
        }
      }

      const outputType = "image/jpeg";
      const blob = await canvasToBlob(canvas, outputType, 0.92);
      const extension = "jpg";
      const baseName = fileNameWithoutExtension(target.fileName || `story-${Date.now()}`);
      const editedFile = new File([blob], `${baseName}-edit.${extension}`, {
        type: outputType,
      });
      const uploaded = await api.postFile("/upload", editedFile);
      const previousFilePath = target.filePath;

      setUploadedSchedulerMedia((current) =>
        current.map((item, index) =>
          index === storyEditorMediaIndex
            ? {
                ...item,
                filePath: uploaded.filePath,
                fileName: editedFile.name,
                fileSizeBytes: blob.size,
              }
            : item,
        ),
      );

      if (previousFilePath) {
        try {
          await api.delete(`/upload?filePath=${encodeURIComponent(previousFilePath)}`);
        } catch {
          // Ignora limpeza de arquivo antigo para não bloquear o fluxo principal do editor.
        }
      }

      closeStoryEditorModal();
      setSchedulerInfo("Story editado com sucesso.");
    } catch (storyEditorError) {
      setError("");
      setSchedulerInfo(storyEditorError instanceof Error ? storyEditorError.message : "Falha ao salvar edição do story.");
    } finally {
      setStoryEditorSaving(false);
    }
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

  function toggleWhatsappRelinkConnectionSelection(connectionId: string) {
    setWhatsappRelinkConnectionIds((current) => {
      if (current.includes(connectionId)) {
        return current.filter((id) => id !== connectionId);
      }
      return [...current, connectionId];
    });
  }

  function selectAllWhatsappRelinkConnections() {
    setWhatsappRelinkConnectionIds(schedulerWhatsappConnections.map((connection) => connection.id));
  }

  function clearWhatsappRelinkConnections() {
    setWhatsappRelinkConnectionIds([]);
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

    const editingCurrentJob = editingJobId ? jobs.find((job) => job.id === editingJobId) ?? null : null;
    const shouldConfirmPublishedReschedule =
      editingCurrentJob !== null &&
      publicationState === "PUBLISHED" &&
      EDIT_PUBLISHED_RESCHEDULE_CONFIRM_STATUSES.has(editingCurrentJob.status);

    if (
      shouldConfirmPublishedReschedule &&
      !window.confirm(
        "Esta postagem já foi processada. Salvar como Publicado criará um novo agendamento de publicação. Deseja continuar?",
      )
    ) {
      return;
    }

    if (publicationState === "PUBLISHED" && (!scheduledDate || !scheduledTime)) {
      setError("");
      setSchedulerInfo("Preencha data e horário para publicar.");
      return;
    }

    setSubmittingJob(true);
    setError("");
    setSchedulerInfo(editingJobId ? "Salvando alterações..." : "Agendando postagem...");

    const scheduledAtIso =
      publicationState === "PUBLISHED"
        ? toIsoFromTimeZoneDateTime(scheduledDate, scheduledTime, effectiveUserTimeZone)
        : null;
    if (publicationState === "PUBLISHED" && !scheduledAtIso) {
      setSubmittingJob(false);
      setError("");
      setSchedulerInfo("Data/hora inválida para o fuso selecionado.");
      return;
    }
    const effectiveLocationId =
      requiresInstagramMetadata
        ? (isInstagramForcedLocationEnabled ? instagramForcedLocationId : null)
        : null;
    const effectiveLocationName =
      requiresInstagramMetadata
        ? (isInstagramForcedLocationEnabled ? instagramForcedLocationName : null)
        : null;
    const effectiveCaption = publicationType === "instagram_story" ? null : caption;
    const normalizedFirstComment =
      supportsFirstComment && firstCommentEnabled ? firstComment.trim() : "";
    if (supportsFirstComment && firstCommentEnabled && !normalizedFirstComment) {
      setSubmittingJob(false);
      setError("");
      setSchedulerInfo("Preencha o primeiro comentário ou desative esta opção.");
      return;
    }
    const normalizedWhatsappRelinkConnectionIds = canEnableWhatsappRelink
      ? whatsappRelinkConnectionIds.filter((id) =>
        schedulerWhatsappConnections.some((connection) => connection.id === id)
      )
      : [];
    if (canEnableWhatsappRelink && whatsappRelinkEnabled && normalizedWhatsappRelinkConnectionIds.length === 0) {
      setSubmittingJob(false);
      setError("");
      setSchedulerInfo("Selecione ao menos uma conta de WhatsApp para relink.");
      return;
    }
    const fileCaptions = uploadedSchedulerMedia.map((item) => item.caption?.trim() || "");
    const effectiveWhatsappBackgroundColor =
      publicationType === "whatsapp_status_texto" || publicationType === "whatsapp_status_midia"
        ? whatsappBackgroundColor
        : null;

    const payload = {
      companyId: jobCompanyId,
      socialConnectionId: jobSocialConnectionId,
      filePath: uploadedFilePath,
      filePaths: uploadedSchedulerMedia.map((item) => item.filePath),
      fileCaptions: fileCaptions.some((entry) => entry.length > 0) ? fileCaptions : undefined,
      sequential: effectiveSequentialPublishing,
      title: normalizedTitle,
      caption: effectiveCaption,
      firstComment: normalizedFirstComment || null,
      whatsappBackgroundColor: effectiveWhatsappBackgroundColor,
      whatsappRelinkEnabled: canEnableWhatsappRelink ? whatsappRelinkEnabled : false,
      whatsappRelinkConnectionIds:
        canEnableWhatsappRelink && whatsappRelinkEnabled
          ? normalizedWhatsappRelinkConnectionIds
          : undefined,
      locationName: effectiveLocationName,
      locationId: effectiveLocationId,
      publicationType,
      publicationState,
      dataPostagem: publicationState === "PUBLISHED" ? scheduledAtIso : null,
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
    setFirstComment("");
    setFirstCommentEnabled(false);
    setWhatsappBackgroundColor(DEFAULT_WHATSAPP_BACKGROUND_COLOR);
    setWhatsappRelinkEnabled(false);
    setWhatsappRelinkConnectionIds([]);
    setUploadedSchedulerMedia([]);
    setDraggingSchedulerMediaIndex(null);
    setDragOverSchedulerMediaIndex(null);
    setMediaCaptionModalIndex(null);
    setMediaCaptionDraft("");
    storyEditorStickerDragRef.current = null;
    storyEditorDecorStickerDragRef.current = null;
    storyEditorTextStickerDragRef.current = null;
    storyEditorDrawRef.current = null;
    setStoryEditorMediaIndex(null);
    setStoryEditorLocationEnabled(false);
    setStoryEditorLocationText("");
    setStoryEditorLocationTextColor(STORY_EDITOR_DEFAULT_LOCATION_TEXT_COLOR);
    setStoryEditorLocationBackgroundColor(STORY_EDITOR_DEFAULT_LOCATION_BACKGROUND_COLOR);
    setStoryEditorLocationFontFamily(STORY_EDITOR_DEFAULT_FONT);
    setStoryEditorLocationScale(1);
    setStoryEditorLocationEditing(false);
    setStoryEditorStickerX(0.5);
    setStoryEditorStickerY(0.18);
    setStoryEditorToolMode("MOVE");
    setStoryEditorBrushColor(STORY_EDITOR_BRUSH_COLORS[0] ?? "#ffffff");
    setStoryEditorBrushSize(10);
    setStoryEditorBrushCursor({ visible: false, x: 0.5, y: 0.5 });
    setStoryEditorStrokes([]);
    setStoryEditorDecorStickers([]);
    setStoryEditorActiveDecorStickerId(null);
    setStoryEditorDecorPickerOpen(false);
    setStoryEditorTextColor(STORY_EDITOR_DEFAULT_TEXT_COLOR);
    setStoryEditorTextBackgroundColor(STORY_EDITOR_DEFAULT_TEXT_BACKGROUND_COLOR);
    setStoryEditorTextFontFamily(STORY_EDITOR_DEFAULT_FONT);
    setStoryEditorTextScale(1);
    setStoryEditorTextStickers([]);
    setStoryEditorActiveTextStickerId(null);
    setStoryEditorDraggingDecorStickerId(null);
    setStoryEditorDraggingTextStickerId(null);
    setStoryEditorDraggingSticker(false);
    setStoryEditorSaving(false);
    setUploadDragActive(false);
    setJobCompanyId("");
    setJobSocialConnectionId("");
    setScheduledDate("");
    setScheduledTime("");
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
      selectedFiles.map((filePath, index) => ({
        filePath,
        fileName: filePath.split("/").pop() ?? "",
        fileSizeBytes: null,
        caption: job.fileCaptions?.[index] ?? null,
      })),
    );
    setDraggingSchedulerMediaIndex(null);
    setDragOverSchedulerMediaIndex(null);
    setMediaCaptionModalIndex(null);
    setMediaCaptionDraft("");
    storyEditorStickerDragRef.current = null;
    storyEditorDecorStickerDragRef.current = null;
    storyEditorTextStickerDragRef.current = null;
    storyEditorDrawRef.current = null;
    setStoryEditorMediaIndex(null);
    setStoryEditorLocationEnabled(false);
    setStoryEditorLocationText("");
    setStoryEditorLocationTextColor(STORY_EDITOR_DEFAULT_LOCATION_TEXT_COLOR);
    setStoryEditorLocationBackgroundColor(STORY_EDITOR_DEFAULT_LOCATION_BACKGROUND_COLOR);
    setStoryEditorLocationFontFamily(STORY_EDITOR_DEFAULT_FONT);
    setStoryEditorLocationScale(1);
    setStoryEditorLocationEditing(false);
    setStoryEditorStickerX(0.5);
    setStoryEditorStickerY(0.18);
    setStoryEditorToolMode("MOVE");
    setStoryEditorBrushColor(STORY_EDITOR_BRUSH_COLORS[0] ?? "#ffffff");
    setStoryEditorBrushSize(10);
    setStoryEditorBrushCursor({ visible: false, x: 0.5, y: 0.5 });
    setStoryEditorStrokes([]);
    setStoryEditorDecorStickers([]);
    setStoryEditorActiveDecorStickerId(null);
    setStoryEditorDecorPickerOpen(false);
    setStoryEditorTextColor(STORY_EDITOR_DEFAULT_TEXT_COLOR);
    setStoryEditorTextBackgroundColor(STORY_EDITOR_DEFAULT_TEXT_BACKGROUND_COLOR);
    setStoryEditorTextFontFamily(STORY_EDITOR_DEFAULT_FONT);
    setStoryEditorTextScale(1);
    setStoryEditorTextStickers([]);
    setStoryEditorActiveTextStickerId(null);
    setStoryEditorDraggingDecorStickerId(null);
    setStoryEditorDraggingTextStickerId(null);
    setStoryEditorDraggingSticker(false);
    setStoryEditorSaving(false);
    setPostTitle(job.title?.trim() || job.caption?.trim() || "");
    setCaption(job.caption ?? "");
    setFirstComment(job.firstComment?.trim() || "");
    setFirstCommentEnabled(Boolean(job.firstComment?.trim()));
    setWhatsappBackgroundColor(job.whatsappBackgroundColor?.trim() || DEFAULT_WHATSAPP_BACKGROUND_COLOR);
    const jobMediaCount = Array.isArray(job.filePaths) && job.filePaths.length > 0 ? job.filePaths.length : (job.filePath ? 1 : 0);
    const supportsJobWhatsappRelink =
      job.publicationType === "instagram_post" ||
      job.publicationType === "instagram_reel" ||
      (job.publicationType === "instagram_story" && jobMediaCount <= 1);
    const normalizedJobRelinkConnectionIds = (Array.isArray(job.whatsappRelinkConnectionIds) ? job.whatsappRelinkConnectionIds : [])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    setWhatsappRelinkEnabled(supportsJobWhatsappRelink ? Boolean(job.whatsappRelinkEnabled) : false);
    setWhatsappRelinkConnectionIds(supportsJobWhatsappRelink ? normalizedJobRelinkConnectionIds : []);
    setPublicationType(job.publicationType);
    const nextPublicationState = job.publicationState === "DRAFT" ? "DRAFT" : "PUBLISHED";
    setPublicationState(nextPublicationState);
    setScheduledDate(nextPublicationState === "DRAFT" ? "" : toDateLocal(job.dataPostagem, effectiveUserTimeZone));
    setScheduledTime(nextPublicationState === "DRAFT" ? "" : toTimeLocal(job.dataPostagem, effectiveUserTimeZone));
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
      isPastScheduledAtForUser(job.dataPostagem) &&
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

  function toggleHistoryBulkJobSelection(jobId: string) {
    setHistoryBulkSelectedJobIds((current) => {
      if (current.includes(jobId)) {
        return current.filter((id) => id !== jobId);
      }
      return [...current, jobId];
    });
  }

  function cancelHistoryBulkAction() {
    setHistoryBulkSelectedJobIds([]);
    setHistoryBulkAction("");
    setHistoryBulkDate("");
    setHistoryBulkTime(getCurrentTimeValue(effectiveUserTimeZone, nowReferenceDate));
    setHistoryBulkCompanyId("");
  }

  function buildHistoryBulkUpdatePayload(
    job: Job,
    options: {
      publicationState?: PublicationState;
      dataPostagem?: string;
      companyId?: string;
    },
  ) {
    const selectedFilePaths = (job.filePaths && job.filePaths.length > 0 ? job.filePaths : [job.filePath])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const targetCompanyId = options.companyId ?? job.companyId;
    let targetSocialConnectionId = job.socialConnectionId ?? "";

    if (options.companyId && targetCompanyId !== job.companyId) {
      const currentConnection = connections.find((connection) => connection.id === job.socialConnectionId);
      if (!currentConnection || currentConnection.companyId !== targetCompanyId) {
        const platform = publicationTypeNetwork(job.publicationType);
        const fallbackConnection = connections.find(
          (connection) => connection.companyId === targetCompanyId && connection.platform === platform,
        );
        targetSocialConnectionId = fallbackConnection?.id ?? "";
      }
    }

    return {
      companyId: targetCompanyId,
      socialConnectionId: targetSocialConnectionId,
      filePath: job.filePath,
      filePaths: selectedFilePaths.length > 1 ? selectedFilePaths : undefined,
      fileCaptions: selectedFilePaths.length > 0 ? (job.fileCaptions ?? []) : undefined,
      sequential: selectedFilePaths.length > 1 ? true : undefined,
      title: job.title ?? "",
      caption: job.caption ?? "",
      firstComment: job.firstComment ?? "",
      whatsappBackgroundColor: job.whatsappBackgroundColor ?? DEFAULT_WHATSAPP_BACKGROUND_COLOR,
      whatsappRelinkEnabled: job.whatsappRelinkEnabled ?? false,
      whatsappRelinkConnectionIds: job.whatsappRelinkConnectionIds ?? [],
      locationName: job.locationName ?? "",
      locationId: job.locationId ?? "",
      publicationType: job.publicationType,
      publicationState: options.publicationState ?? job.publicationState,
      dataPostagem: options.dataPostagem ?? job.dataPostagem,
    };
  }

  async function applyHistoryBulkEdit(event: FormEvent) {
    event.preventDefault();
    if (!historyBulkAction) {
      setError("Selecione uma ação em massa.");
      return;
    }

    if (historyBulkSelectedJobs.length === 0) {
      setError("Selecione ao menos uma postagem para aplicar a ação em massa.");
      return;
    }

    const options: {
      publicationState?: PublicationState;
      dataPostagem?: string;
      companyId?: string;
    } = {};

    if (historyBulkAction === "SET_PUBLISHED") {
      if (historyBulkSelectedJobs.some((job) => job.publicationState !== "DRAFT")) {
        setError("Para marcar como Publicado em massa, selecione apenas postagens em rascunho.");
        return;
      }
      if (!historyBulkDate || !historyBulkTime) {
        setError("Preencha data e horário para publicar os rascunhos em massa.");
        return;
      }
      const scheduledAtIso = toIsoFromTimeZoneDateTime(historyBulkDate, historyBulkTime, effectiveUserTimeZone);
      if (!scheduledAtIso) {
        setError("Data ou horário inválido para publicação em massa.");
        return;
      }
      options.publicationState = "PUBLISHED";
      options.dataPostagem = scheduledAtIso;
    }
    if (historyBulkAction === "SET_DRAFT") {
      if (historyBulkSelectedJobs.some((job) => job.publicationState !== "PUBLISHED")) {
        setError("Para marcar como Rascunho em massa, selecione apenas postagens publicadas.");
        return;
      }
      options.publicationState = "DRAFT";
    }
    if (historyBulkAction === "SET_SCHEDULE") {
      if (!historyBulkDate || !historyBulkTime) {
        setError("Preencha data e horário para alteração em massa.");
        return;
      }
      const scheduledAtIso = toIsoFromTimeZoneDateTime(historyBulkDate, historyBulkTime, effectiveUserTimeZone);
      if (!scheduledAtIso) {
        setError("Data ou horário inválido para edição em massa.");
        return;
      }
      options.dataPostagem = scheduledAtIso;
    }
    if (historyBulkAction === "SET_COMPANY") {
      if (!historyBulkCompanyId) {
        setError("Selecione o perfil de destino para alteração em massa.");
        return;
      }
      options.companyId = historyBulkCompanyId;
    }

    setHistoryBulkApplying(true);
    setError("");
    setHistoryInfo("Aplicando edição em massa...");

    try {
      const results = await Promise.allSettled(
        historyBulkSelectedJobs.map(async (job) => {
          const payload = buildHistoryBulkUpdatePayload(job, options);
          if (!payload.socialConnectionId) {
            throw new Error(`Job ${job.id} sem conta vinculada compatível no perfil selecionado.`);
          }
          await api.putJson(`/jobs/${job.id}`, payload);
        }),
      );

      const successCount = results.filter((result) => result.status === "fulfilled").length;
      const failedResults = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      const failedCount = failedResults.length;

      if (failedCount > 0) {
        const firstReason = failedResults[0]?.reason;
        const firstMessage =
          firstReason instanceof Error ? firstReason.message : "Falha ao atualizar parte dos jobs selecionados.";
        setError(firstMessage);
      } else {
        setError("");
      }

      setHistoryInfo(
        failedCount === 0
          ? `Edição em massa aplicada em ${successCount} postagem(s).`
          : `Edição em massa parcial: ${successCount} sucesso(s), ${failedCount} falha(s).`,
      );
      setHistoryBulkSelectedJobIds([]);
      await loadAll();
    } catch (bulkError) {
      setHistoryInfo("");
      setError(bulkError instanceof Error ? bulkError.message : "Falha ao aplicar edição em massa.");
    } finally {
      setHistoryBulkApplying(false);
    }
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

  async function saveBillingSettings(event: FormEvent) {
    event.preventDefault();
    setSavingBillingSettings(true);
    setError("");
    setPlanInfo("");

    try {
      const payload = {
        autoTrialEnabled: billingSettings.autoTrialEnabled,
        autoTrialDays: billingSettings.autoTrialDays,
        rootDisplayPlanId: billingSettings.rootDisplayPlanId,
      };
      const updated = await api.putJson<BillingSettings>("/billing/settings", payload);
      setBillingSettings(updated);
      setPlanInfo("Configurações básicas salvas com sucesso.");
      await loadBillingData({ withSkeleton: false });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (billingError) {
      setError(billingError instanceof Error ? billingError.message : "Falha ao salvar configuração de trial.");
    } finally {
      setSavingBillingSettings(false);
    }
  }

  function resetBillingPlanForm() {
    setEditingPlanId(null);
    setPlanCodeInput("");
    setPlanNameInput("");
    setPlanDescriptionInput("");
    setPlanIsTrialInput(false);
    setPlanIsActiveInput(true);
    setPlanMaxProfilesInput("1");
    setPlanMaxConnectionsInput("2");
    setPlanMaxMonthlyPublicationsInput("60");
    setPlanStripeProductIdInput("");
  }

  function startBillingPlanEdit(plan: BillingPlan) {
    setEditingPlanId(plan.id);
    setPlanCodeInput(plan.code);
    setPlanNameInput(plan.name);
    setPlanDescriptionInput(plan.description ?? "");
    setPlanIsTrialInput(plan.isTrial);
    setPlanIsActiveInput(plan.isActive);
    setPlanMaxProfilesInput(String(plan.maxProfiles));
    setPlanMaxConnectionsInput(String(plan.maxConnections));
    setPlanMaxMonthlyPublicationsInput(String(plan.maxMonthlyPublications));
    setPlanStripeProductIdInput(plan.stripeProductId ?? "");
    window.requestAnimationFrame(() => {
      const section = planEditorSectionRef.current;
      if (!section) {
        return;
      }
      const targetTop = section.getBoundingClientRect().top + window.scrollY - 110;
      window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    });
  }

  async function createBillingPlan(event: FormEvent) {
    event.preventDefault();
    setCreatingPlan(true);
    setError("");
    setPlanInfo("");

    try {
      const maxProfiles = Number.parseInt(planMaxProfilesInput, 10);
      const maxConnections = Number.parseInt(planMaxConnectionsInput, 10);
      const maxMonthlyPublications = Number.parseInt(planMaxMonthlyPublicationsInput, 10);

      if (!Number.isFinite(maxProfiles) || maxProfiles <= 0) {
        throw new Error("Informe um número válido para total de perfis.");
      }
      if (!Number.isFinite(maxConnections) || maxConnections <= 0) {
        throw new Error("Informe um número válido para total de contas.");
      }
      if (!Number.isFinite(maxMonthlyPublications) || maxMonthlyPublications <= 0) {
        throw new Error("Informe um número válido para publicações mensais.");
      }

      if (!planIsTrialInput && !planStripeProductIdInput.trim()) {
        throw new Error("Plano pago exige produto Stripe vinculado.");
      }
      if (!planIsTrialInput) {
        const selectedProductId = planStripeProductIdInput.trim();
        const resolvedStripePrices = selectedProductId
          ? (stripeCatalogResolvedByProduct[selectedProductId] ?? null)
          : null;

        if (!resolvedStripePrices) {
          throw new Error("Não foi possível resolver os preços do produto Stripe selecionado.");
        }

        const missingPriceKinds: string[] = [];
        if (!resolvedStripePrices.stripeMonthlyPriceId) {
          missingPriceKinds.push("assinatura mensal");
        }
        if (!resolvedStripePrices.stripeYearlyPriceId) {
          missingPriceKinds.push("assinatura anual");
        }
        if (!resolvedStripePrices.stripePixMonthlyPriceId) {
          missingPriceKinds.push("PIX mensal");
        }
        if (!resolvedStripePrices.stripePixYearlyPriceId) {
          missingPriceKinds.push("PIX anual");
        }
        if (missingPriceKinds.length > 0) {
          throw new Error(`Produto Stripe sem preços obrigatórios: ${missingPriceKinds.join(", ")}.`);
        }

        const hasCycleMismatch =
          resolvedStripePrices.stripeMonthlyPriceCents !== null &&
          resolvedStripePrices.stripeYearlyPriceCents !== null &&
          resolvedStripePrices.stripePixMonthlyPriceCents !== null &&
          resolvedStripePrices.stripePixYearlyPriceCents !== null &&
          (resolvedStripePrices.stripeMonthlyPriceCents !== resolvedStripePrices.stripePixMonthlyPriceCents ||
            resolvedStripePrices.stripeYearlyPriceCents !== resolvedStripePrices.stripePixYearlyPriceCents);

        if (hasCycleMismatch) {
          throw new Error(
            "Os preços da assinatura e do PIX devem ser iguais por ciclo (mensal com mensal, anual com anual).",
          );
        }
      }

      const trialConflict =
        planIsTrialInput &&
        billingPlans.some((plan) => plan.isTrial && (editingPlanId ? plan.id !== editingPlanId : true));
      if (trialConflict) {
        throw new Error("Só é permitido 1 plano trial no sistema.");
      }

      const payload = {
        code: planCodeInput.trim().toUpperCase(),
        name: planNameInput.trim(),
        description: planDescriptionInput.trim(),
        isActive: planIsActiveInput,
        isTrial: planIsTrialInput,
        maxProfiles,
        maxConnections,
        maxMonthlyPublications,
        stripeProductId: planStripeProductIdInput.trim() || null,
      };

      if (editingPlanId) {
        await api.putJson(`/billing/plans/${editingPlanId}`, payload);
      } else {
        await api.postJson("/billing/plans", payload);
      }

      resetBillingPlanForm();
      setPlanInfo(editingPlanId ? "Plano atualizado com sucesso." : "Plano criado com sucesso.");
      await loadBillingData({ withSkeleton: false });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (planError) {
      setError(
        planError instanceof Error
          ? planError.message
          : editingPlanId
            ? "Falha ao atualizar plano."
            : "Falha ao criar plano.",
      );
    } finally {
      setCreatingPlan(false);
    }
  }

  async function deleteBillingPlan(plan: BillingPlan) {
    if (!window.confirm(`Deseja excluir o plano "${plan.name}"?`)) {
      return;
    }

    setError("");
    setPlanInfo("");

    try {
      await api.delete(`/billing/plans/${plan.id}`);
      if (editingPlanId === plan.id) {
        resetBillingPlanForm();
      }
      setPlanInfo("Plano excluído com sucesso.");
      await loadBillingData({ withSkeleton: false });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "Falha ao excluir plano.");
    }
  }

  async function assignRootPlan(event: FormEvent) {
    event.preventDefault();
    if (!isRootUser || !authUser) {
      return;
    }
    if (!rootAssignPlanId) {
      setError("Selecione um plano para aplicar no root.");
      return;
    }

    const selectedPlan = billingPlans.find((plan) => plan.id === rootAssignPlanId);
    if (!selectedPlan) {
      setError("Plano selecionado não encontrado.");
      return;
    }

    setAssigningRootPlan(true);
    setError("");
    setPlanInfo("");
    try {
      await api.postJson("/billing/assign-user-plan", {
        userId: authUser.id,
        planId: selectedPlan.id,
        status: "ACTIVE",
        billingModel: selectedPlan.isTrial ? "TRIAL" : "MANUAL",
        cycle: null,
        endsAt: null,
      });
      setPlanInfo(`Plano ${selectedPlan.name} aplicado no root com sucesso.`);
      await refreshAuthUserSnapshot();
      await loadBillingData({ withSkeleton: false });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Falha ao aplicar plano no root.");
    } finally {
      setAssigningRootPlan(false);
    }
  }

  async function startStripeCheckout(event: FormEvent) {
    event.preventDefault();
    if (!checkoutPlanId) {
      setError("Selecione um plano para iniciar o checkout.");
      return;
    }
    if (checkoutBillingModel !== "STRIPE_SUBSCRIPTION" && checkoutBillingModel !== "PIX_MANUAL") {
      setError("Selecione um modo de cobrança para iniciar o checkout.");
      return;
    }
    if (checkoutCycle !== "MONTHLY" && checkoutCycle !== "YEARLY") {
      setError("Selecione um ciclo para iniciar o checkout.");
      return;
    }

    setStartingCheckout(true);
    setError("");
    setPlanInfo("");

    try {
      const result = await api.postJson<{ sessionId: string; url: string | null }>("/billing/checkout/start", {
        planId: checkoutPlanId,
        billingModel: checkoutBillingModel,
        cycle: checkoutCycle,
      });

      if (!result.url) {
        throw new Error("Stripe não retornou URL de checkout para esta sessão.");
      }

      window.location.href = result.url;
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Falha ao iniciar checkout Stripe.");
      setStartingCheckout(false);
    }
  }

  async function cancelStripeSubscription() {
    if (!window.confirm("Deseja cancelar a assinatura recorrente no fim do ciclo atual?")) {
      return;
    }

    setCancelingStripeSubscription(true);
    setError("");
    setPlanInfo("");

    try {
      const result = await api.postJson<{ message?: string }>("/billing/subscription/cancel", {});
      setPlanInfo(result.message || "Assinatura marcada para cancelamento no fim do ciclo atual.");
      await refreshAuthUserSnapshot();
      await loadBillingData({ withSkeleton: false });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Falha ao cancelar assinatura.");
    } finally {
      setCancelingStripeSubscription(false);
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

  async function rescheduleFailedMedia(job: Job) {
    const partialMeta = parseStorySequenceFailureMeta(job.lastError);
    const isPartialStoryFailure =
      job.publicationType === "instagram_story" &&
      partialMeta !== null &&
      partialMeta.publishedCount > 0 &&
      partialMeta.publishedCount < partialMeta.total;

    setError("");
    setReschedulingFailedMediaJobId(job.id);
    setHistoryInfo(
      isPartialStoryFailure
        ? "Reagendando apenas as mídias restantes para daqui a 20 minutos..."
        : "Reagendando a mídia para daqui a 20 minutos...",
    );

    try {
      const result = await api.postJson<{
        scheduledAt: string;
        mediaCount: number;
        totalCount: number;
        remainingOnly: boolean;
      }>(`/jobs/${job.id}/reschedule-failed-media`, {});

      setHistoryInfo(
        result.remainingOnly
          ? `${result.mediaCount} mídia(s) restante(s) reagendadas para daqui a 20 minutos.`
          : `${result.mediaCount} mídia(s) reagendadas para daqui a 20 minutos.`,
      );
      await loadAll();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (rescheduleError) {
      setHistoryInfo("");
      setError(rescheduleError instanceof Error ? rescheduleError.message : "Falha ao reagendar a mídia.");
    } finally {
      setReschedulingFailedMediaJobId(null);
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
      setProfileTimeZone(DEFAULT_USER_TIME_ZONE);
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
        timeZone: profileTimeZone,
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
        caption: null,
      },
    ]);
    setDraggingSchedulerMediaIndex(null);
    setDragOverSchedulerMediaIndex(null);
    setMediaCaptionModalIndex(null);
    setMediaCaptionDraft("");
    setPublicationType(media.publicationType);
    setPublicationState("");
    setJobCompanyId("");
    setJobSocialConnectionId("");
    setPostTitle("");
    setCaption("");
    setFirstComment("");
    setFirstCommentEnabled(false);
    setScheduledDate("");
    setScheduledTime("");
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

  function appendEmojiToFirstComment(emoji: string) {
    setFirstComment((current) => `${current}${emoji}`);
  }

  function appendEmojiToMediaCaption(emoji: string) {
    setMediaCaptionDraft((current) => `${current}${emoji}`);
  }

  function appendEmojiToBroadcastAvisoMessage(emoji: string) {
    setBroadcastAvisoMessage((current) => `${current}${emoji}`);
  }

  function renderQuickEmojiPicker(options: {
    pickerKey: string;
    disabled: boolean;
    onPick: (emoji: string) => void;
    label?: string;
    className?: string;
  }) {
    const { pickerKey, disabled, onPick, label = "Abrir emojis", className = "" } = options;
    const isOpen = openEmojiPickerKey === pickerKey;

    return (
      <div className={`emoji-picker-shell${className ? ` ${className}` : ""}`}>
        <button
          type="button"
          className={`emoji-popover-trigger${disabled ? " emoji-popover-trigger-disabled" : ""}`}
          onClick={() => {
            if (disabled) {
              return;
            }
            setOpenEmojiPickerKey((current) => (current === pickerKey ? null : pickerKey));
          }}
          aria-label={label}
          aria-expanded={isOpen}
          disabled={disabled}
        >
          <span>😊</span>
          <span>+</span>
        </button>
        {isOpen ? (
          <div className="emoji-popover-panel">
            <div className="emoji-popover-header">
              <strong>Emojis</strong>
              <button
                type="button"
                className="emoji-popover-close"
                onClick={() => setOpenEmojiPickerKey(null)}
                aria-label="Fechar emojis"
                title="Fechar"
              >
                <FiX aria-hidden="true" />
              </button>
            </div>
            <div className="emoji-popover-scroll">
              <div className="emoji-picker-grid emoji-picker-grid-full">
                {fullEmojiList.map((emoji) => (
                  <button
                    key={`${pickerKey}-${emoji}`}
                    type="button"
                    className="emoji-chip"
                    disabled={disabled}
                    onClick={() => {
                      onPick(emoji);
                      setOpenEmojiPickerKey(null);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
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
                  <article key={aviso.id} className={`notice-popover-item ${avisoToneClass(aviso)}`}>
                    <strong>{aviso.title}</strong>
                    <span>{aviso.message}</span>
                    <small>{formatDate(aviso.createdAt, effectiveUserTimeZone)}</small>
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
    const hasDashboardTrendData =
      dashboardTrendFocus === "all"
        ? dashboardChartData.points.some((point) => point.published > 0 || point.failed > 0 || point.scheduled > 0)
        : dashboardChartData.points.some((point) => point.total > 0);
    const dashboardXAxisStep = Math.max(1, Math.ceil(dashboardChartData.points.length / 6));
    const publishedPath = buildDashboardChartPath(
      dashboardChartData.points.map((point) => point.published),
      100,
      100,
    );
    const failedPath = buildDashboardChartPath(
      dashboardChartData.points.map((point) => point.failed),
      100,
      100,
    );
    const scheduledPath = buildDashboardChartPath(
      dashboardChartData.points.map((point) => point.scheduled),
      100,
      100,
    );
    const focusPath = buildDashboardChartPath(
      dashboardChartData.points.map((point) => point.total),
      100,
      100,
    );

    return (
      <div className="view-stack">
        <section className="dashboard-top-grid">
          <div className="stats-grid dashboard-compact-metrics-grid">
            <article className="metric-card dashboard-compact-metric-card">
              <span className="metric-label">
                <span className="metric-icon" aria-hidden="true">
                  <FiCheckCircle />
                </span>
                <span className="metric-label-text">Enviados</span>
              </span>
              <strong>{dashboard.completedJobs}</strong>
            </article>
            <article className="metric-card dashboard-compact-metric-card">
              <span className="metric-label">
                <span className="metric-icon" aria-hidden="true">
                  <FiClock />
                </span>
                <span className="metric-label-text">Pendentes</span>
              </span>
              <strong>{dashboard.pendingJobs}</strong>
            </article>
            <article className="metric-card dashboard-compact-metric-card">
              <span className="metric-label">
                <span className="metric-icon" aria-hidden="true">
                  <FiWifi />
                </span>
                <span className="metric-label-text">Cancelados</span>
              </span>
              <strong>{dashboard.canceledJobs}</strong>
            </article>
            <article className="metric-card metric-card-failed dashboard-compact-metric-card">
              <span className="metric-label">
                <span className="metric-icon" aria-hidden="true">
                  <FiAlertCircle />
                </span>
                <span className="metric-label-text">Falhados</span>
              </span>
              <strong className="metric-value-failed">{dashboard.failedJobs}</strong>
            </article>
          </div>

          <section className="panel-card dashboard-upcoming-carousel-panel">
            <div className="section-head">
              <div>
                <div className="view-title-with-icon">
                  <span className="view-title-icon" aria-hidden="true">
                    <FiCalendar />
                  </span>
                  <h2>Próximos Agendamentos</h2>
                </div>
              </div>
              {dashboardUpcomingPages.length > 1 ? (
                <div className="dashboard-carousel-controls">
                  <button
                    type="button"
                    className="ghost-button dashboard-carousel-arrow"
                    onClick={() => setDashboardUpcomingPage((current) => Math.max(0, current - 1))}
                    disabled={dashboardUpcomingPage === 0}
                    aria-label="Página anterior"
                  >
                    <FiChevronLeft />
                  </button>
                  <button
                    type="button"
                    className="ghost-button dashboard-carousel-arrow"
                    onClick={() =>
                      setDashboardUpcomingPage((current) => Math.min(dashboardUpcomingPages.length - 1, current + 1))
                    }
                    disabled={dashboardUpcomingPage >= dashboardUpcomingPages.length - 1}
                    aria-label="Próxima página"
                  >
                    <FiChevronRight />
                  </button>
                </div>
              ) : null}
            </div>

            {upcomingJobs.length === 0 ? (
              <div className="empty-state dashboard-upcoming-empty-state">Não há próximos agendamentos nesse filtro.</div>
            ) : (
              <>
                <div className="dashboard-carousel-shell">
                  <div
                    className="dashboard-carousel-track"
                    style={{ transform: `translateX(-${dashboardUpcomingPage * 100}%)` }}
                  >
                    {dashboardUpcomingPages.map((page, pageIndex) => (
                      <div key={`dashboard-upcoming-page-${pageIndex}`} className="dashboard-carousel-page">
                        {page.map((job) => {
                          const isRunningLike = shouldRenderUpcomingAsRunning(job, isPastScheduledAtForUser);

                          return (
                            <article key={job.id} className="dashboard-upcoming-card">
                              <strong>{resolveJobDisplayTitle(job)}</strong>
                              <div className="meta-pill-row">
                                {renderPublicationTypePill(job.publicationType)}
                                <span className="unit-pill">
                                  {`Perfil: ${companyNameMap[job.companyId] || "Perfil removido"}`}
                                </span>
                              </div>
                              <span className="dashboard-upcoming-card-date">
                                {formatJobScheduledAt(job, effectiveUserTimeZone)}
                              </span>
                              <div className="dashboard-upcoming-card-footer">
                                {isRunningLike ? (
                                  <span className="status-pill status-running-live">
                                    <span className="status-pill-spinner" aria-hidden="true" />
                                    Executando
                                  </span>
                                ) : (
                                  <span className={`status-pill status-${jobStatusTone(job)}`}>{jobStatusDisplayLabel(job)}</span>
                                )}
                                {!isRunningLike && canToggleJobSchedule(job, isPastScheduledAtForUser) ? (
                                  <button
                                    type="button"
                                    className={job.status === "CANCELED" ? "activate-button" : "ghost-button"}
                                    onClick={() => void toggleJobSchedule(job)}
                                    disabled={togglingScheduleJobId === job.id}
                                  >
                                    {togglingScheduleJobId === job.id
                                      ? "Salvando..."
                                      : job.status === "CANCELED"
                                        ? "Ativar"
                                        : "Cancelar"}
                                  </button>
                                ) : null}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>

                {dashboardUpcomingPages.length > 1 ? (
                  <div className="dashboard-carousel-dots" aria-label="Paginação dos próximos agendamentos">
                    {dashboardUpcomingPages.map((_, pageIndex) => (
                      <button
                        key={`dashboard-upcoming-dot-${pageIndex}`}
                        type="button"
                        className={`dashboard-carousel-dot${pageIndex === dashboardUpcomingPage ? " dashboard-carousel-dot-active" : ""}`}
                        onClick={() => setDashboardUpcomingPage(pageIndex)}
                        aria-label={`Ir para página ${pageIndex + 1}`}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </section>
        </section>

        <section className="dashboard-analytics-grid">
          <article className="panel-card dashboard-chart-panel">
            <div className="section-head dashboard-chart-head">
              <div>
                <div className="view-title-with-icon">
                  <span className="view-title-icon" aria-hidden="true">
                    <FiTrendingUp />
                  </span>
                  <h2>Crescimento</h2>
                </div>
                <small className="field-hint">
                  {dashboardTrendFocus === "all"
                    ? "Linha diária com publicações, falhas e agendamentos no período."
                    : `Linha diária focada em ${dashboardTrendFocusLabel(dashboardTrendFocus).toLocaleLowerCase("pt-BR")}.`}
                </small>
              </div>
              <div className="dashboard-chart-filters">
                <label className="dashboard-chart-filter">
                  <span>Período</span>
                  <select value={dashboardTrendRange} onChange={(event) => setDashboardTrendRange(event.target.value as DashboardTrendRange)}>
                    <option value="7">7 dias</option>
                    <option value="30">30 dias</option>
                    <option value="90">90 dias</option>
                  </select>
                </label>
                <label className="dashboard-chart-filter">
                  <span>Rede</span>
                  <select
                    value={dashboardTrendNetwork}
                    onChange={(event) => setDashboardTrendNetwork(event.target.value as DashboardTrendNetwork)}
                  >
                    <option value="all">Todas</option>
                    <option value="instagram">Instagram</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                </label>
                <label className="dashboard-chart-filter">
                  <span>Visão</span>
                  <select value={dashboardTrendFocus} onChange={(event) => setDashboardTrendFocus(event.target.value as DashboardTrendFocus)}>
                    <option value="all">Tudo</option>
                    <option value="published">Publicados</option>
                    <option value="failed">Falhados</option>
                    <option value="scheduled">Agendados</option>
                  </select>
                </label>
              </div>
            </div>

            {!hasDashboardTrendData ? (
              <div className="empty-state dashboard-upcoming-empty-state dashboard-line-chart-empty-state">
                Ainda não há dados suficientes para gerar o gráfico neste filtro.
              </div>
            ) : (
              <>
                <div className="dashboard-line-chart-shell">
                  <div className="dashboard-line-chart-grid" aria-hidden="true">
                    {Array.from({ length: 4 }, (_, index) => (
                      <span key={`dashboard-grid-line-${index}`} />
                    ))}
                  </div>
                  <svg className="dashboard-line-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    {dashboardTrendFocus === "all" ? (
                      <>
                        <path d={publishedPath} className="dashboard-line dashboard-line-published" />
                        <path d={failedPath} className="dashboard-line dashboard-line-failed" />
                        <path d={scheduledPath} className="dashboard-line dashboard-line-scheduled" />
                      </>
                    ) : (
                      <path d={focusPath} className={`dashboard-line dashboard-line-${dashboardTrendFocus}`} />
                    )}
                  </svg>
                  <div className="dashboard-line-chart-xaxis" aria-hidden="true">
                    {dashboardChartData.points.map((point, index) => (
                      <span
                        key={point.key}
                        className={
                          index === 0 ||
                          index === dashboardChartData.points.length - 1 ||
                          index % dashboardXAxisStep === 0
                            ? "dashboard-line-chart-xaxis-label"
                            : "dashboard-line-chart-xaxis-label dashboard-line-chart-xaxis-label-muted"
                        }
                      >
                        {point.label}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="dashboard-chart-legend">
                  <span className="dashboard-chart-legend-item">
                    <span className="dashboard-chart-dot dashboard-chart-dot-published" aria-hidden="true" />
                    {`Publicados: ${dashboardChartData.publishedTotal}`}
                  </span>
                  <span className="dashboard-chart-legend-item">
                    <span className="dashboard-chart-dot dashboard-chart-dot-failed" aria-hidden="true" />
                    {`Falhados: ${dashboardChartData.failedTotal}`}
                  </span>
                  <span className="dashboard-chart-legend-item">
                    <span className="dashboard-chart-dot dashboard-chart-dot-scheduled" aria-hidden="true" />
                    {`Agendados: ${dashboardChartData.scheduledTotal}`}
                  </span>
                </div>
              </>
            )}
          </article>

          <article className="panel-card dashboard-breakdown-panel">
            <div className="section-head">
              <div>
                <div className="view-title-with-icon">
                  <span className="view-title-icon" aria-hidden="true">
                    <FiBarChart2 />
                  </span>
                  <h2>Distribuição</h2>
                </div>
                <small className="field-hint">Volume por formato dentro do filtro atual.</small>
              </div>
            </div>

            <div className="dashboard-breakdown-list">
              {dashboardChartData.distributionItems.filter((item) => item.count > 0).length === 0 ? (
                <div className="empty-state dashboard-upcoming-empty-state">Sem movimentação neste recorte.</div>
              ) : (
                dashboardChartData.distributionItems
                  .filter((item) => item.count > 0)
                  .map((item) => (
                    <div key={item.key} className="dashboard-breakdown-row">
                      <div className="dashboard-breakdown-row-head">
                        <span className="dashboard-breakdown-label">
                          <span className={`dashboard-breakdown-label-icon dashboard-breakdown-label-icon-${item.network}`} aria-hidden="true">
                            {item.network === "instagram" ? <FaInstagram /> : <FaWhatsapp />}
                          </span>
                          <span>{item.label}</span>
                        </span>
                        <strong>{item.count}</strong>
                      </div>
                      <div className="dashboard-breakdown-track" aria-hidden="true">
                        <span
                          className={`dashboard-breakdown-fill dashboard-breakdown-fill-${item.network}`}
                          style={{ width: `${Math.max(10, (item.count / dashboardChartData.distributionMax) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))
              )}
            </div>

            <div className="dashboard-mini-stats">
              <div className="dashboard-mini-stat">
                <span>Taxa de sucesso</span>
                <strong>{dashboardChartData.deliveryRate === null ? "—" : `${dashboardChartData.deliveryRate}%`}</strong>
              </div>
              <div className="dashboard-mini-stat">
                <span>Perfis ativos</span>
                <strong>{dashboardChartData.activeProfiles}</strong>
              </div>
              <div className="dashboard-mini-stat">
                <span>Pico diário</span>
                <strong>
                  {dashboardChartData.peakPoint && dashboardChartData.peakPoint.total > 0
                    ? `${dashboardChartData.peakPoint.total} em ${dashboardChartData.peakPoint.label}`
                    : "—"}
                </strong>
              </div>
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
          <div className="section-head">
            {renderSectionTitleWithIcon("profile", "Meu perfil", "conta")}
          </div>
          <form onSubmit={saveProfile} className="form-stack">
            <label className="field-label">
              <span>Fuso horário</span>
              <select
                value={profileTimeZone}
                onChange={(event) => setProfileTimeZone(event.target.value)}
                required
                title="Define o fuso horário usado para hora atual e exibição de datas."
              >
                {supportedTimeZones.map((timeZone) => (
                  <option key={timeZone} value={timeZone}>
                    {timeZone}
                  </option>
                ))}
              </select>
            </label>
            <small className="field-hint">Fuso horário do painel (usado para hora atual e datas).</small>
            <label className="field-label">
              <span>Nome</span>
              <input
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                placeholder="Nome"
                required
                minLength={2}
                maxLength={80}
                title="Informe o seu nome."
              />
            </label>
            <label className="field-label">
              <span>Usuário</span>
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
            </label>
            <label className="field-label">
              <span>Senha</span>
              <input
                type="password"
                value={profilePassword}
                onChange={(event) => setProfilePassword(event.target.value)}
                placeholder="Senha"
                minLength={8}
                maxLength={128}
                title="Preencha apenas se quiser alterar a sua senha."
              />
            </label>
            <small className="field-hint">Deixe a senha em branco para não alterar.</small>
            <button type="submit">Salvar</button>
          </form>
        </section>
      </div>
    );
  }

  function renderPlan() {
    const activeBillingPlan =
      billingMe?.plan?.id && billingPlans.length > 0
        ? billingPlans.find((plan) => plan.id === billingMe.plan?.id) ?? null
        : null;
    const activeBillingAmountCents = resolveBillingPlanAmountCents(activeBillingPlan, billingMe?.cycle ?? null);
    const activeBillingAmountLabel =
      billingMe?.plan?.isTrial || billingMe?.billingModel === "TRIAL"
        ? "Grátis"
        : formatPriceFromCents(activeBillingAmountCents);
    if (billingLoading) {
      return renderPlanSkeleton();
    }

    return (
      <div className="view-stack">
        <section className="panel-card view-stack" aria-label="Meu plano">
          <div className="section-head">
            {renderSectionTitleWithIcon("plan", "Meu plano", "assinatura")}
          </div>

          {planInfo ? <div className={`info-banner${isPositivePlanInfo ? " info-banner-success" : ""}`}>{planInfo}</div> : null}

          {billingMe ? (
            <div className="table-list">
              <div className="row-card billing-row-card">
                <div className="view-stack billing-summary-stack">
                  <div className="billing-summary-inline">
                    <strong>{billingMe.plan?.name || "Sem plano ativo"}</strong>
                    <span className={`status-pill status-${billingStatusTone(billingMe.status)}`}>{`Status: ${billingStatusDisplayLabel(billingMe.status)}`}</span>
                    <span className="status-pill status-billing-active">{`Valor: ${activeBillingAmountLabel}`}</span>
                    <span className="unit-pill billing-model-pill">{`Cobrança: ${billingModelDisplayLabel(billingMe.billingModel)}`}</span>
                    <span className="unit-pill billing-model-pill">{`Tipo: ${billingSubscriptionTypeDisplayLabel(billingMe.billingModel, billingMe.cycle)}`}</span>
                    {billingMe.canCancelStripeSubscription ? (
                      <button
                        type="button"
                        className="billing-cancel-button"
                        onClick={() => void cancelStripeSubscription()}
                        disabled={cancelingStripeSubscription}
                      >
                        {cancelingStripeSubscription ? "Cancelando assinatura..." : "Cancelar assinatura"}
                      </button>
                    ) : null}
                  </div>
                  {billingMe.blockMessage ? <span>{billingMe.blockMessage}</span> : null}
                  {billingMe.trialEndsAt ? (
                    <span>{`Trial até ${formatDate(billingMe.trialEndsAt, effectiveUserTimeZone)}`}</span>
                  ) : null}
                  {billingMe.endsAt ? (
                    <span>{`Vigência até ${formatDate(billingMe.endsAt, effectiveUserTimeZone)}`}</span>
                  ) : null}
                  {billingMe.stripeCancelAtPeriodEnd ? (
                    <span className="billing-plan-note">Assinatura já marcada para cancelamento no fim do ciclo.</span>
                  ) : null}
                </div>
              </div>
              <div className="row-card billing-row-card">
                <div className="billing-usage-inline">
                  <strong>Uso do ciclo atual</strong>
                  <div className="meta-pill-row">
                    <span className="unit-pill unit-pill-plan">{`Perfis: ${billingMe.usage.profilesUsed}/${formatPlanLimitDisplay(billingMe.plan?.maxProfiles, billingMe.plan?.code)}`}</span>
                    <span className="unit-pill unit-pill-plan">{`Contas: ${billingMe.usage.connectionsUsed}/${formatPlanLimitDisplay(billingMe.plan?.maxConnections, billingMe.plan?.code)}`}</span>
                    <span className="unit-pill unit-pill-plan">{`Publicações/mês: ${billingMe.usage.postsUsedThisMonth}/${formatPlanLimitDisplay(
                      billingMe.plan?.maxMonthlyPublications,
                      billingMe.plan?.code,
                    )}`}</span>
                  </div>
                </div>
              </div>
              {isRootUser ? (
                <div id={BILLING_PLAN_CHECKOUT_ANCHOR_ID} className="row-card billing-row-card">
                  <form onSubmit={assignRootPlan} className="form-stack">
                    <strong>Selecionar plano (teste root)</strong>
                    <label className="field-label">
                      <span>Plano</span>
                      <select
                        value={rootAssignPlanId}
                        onChange={(event) => setRootAssignPlanId(event.target.value)}
                        required
                        disabled={rootAssignablePlans.length === 0}
                      >
                        <option value="">Selecione um plano</option>
                        {rootAssignablePlans.map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {`${plan.name} (${plan.code})`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" disabled={assigningRootPlan || rootAssignablePlans.length === 0}>
                      {assigningRootPlan ? "Aplicando..." : "Aplicar plano"}
                    </button>
                    <small className="field-hint">
                      Ação de teste para root: troca o plano ativo sem iniciar cobrança Stripe.
                    </small>
                  </form>
                </div>
              ) : (
                <div id={BILLING_PLAN_CHECKOUT_ANCHOR_ID} className="row-card billing-row-card">
                  <form onSubmit={startStripeCheckout} className="form-stack">
                    <strong>Pagamento Stripe (teste)</strong>
                    <label className="field-label">
                      <span>Plano</span>
                      <select
                        value={checkoutPlanId}
                        onChange={(event) => setCheckoutPlanId(event.target.value)}
                        required
                        disabled={availablePaidPlans.length === 0}
                      >
                        <option value="">Selecione um plano</option>
                        {availablePaidPlans.map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {`${plan.name} (${plan.code})`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field-label">
                      <span>Modo de cobrança</span>
                      <select
                        value={checkoutBillingModel}
                        onChange={(event) =>
                          setCheckoutBillingModel(
                            event.target.value === "PIX_MANUAL"
                              ? "PIX_MANUAL"
                              : event.target.value === "STRIPE_SUBSCRIPTION"
                                ? "STRIPE_SUBSCRIPTION"
                                : "",
                          )
                        }
                        required
                      >
                        <option value="">Selecione um modo de cobrança</option>
                        <option value="STRIPE_SUBSCRIPTION">Assinatura recorrente</option>
                        <option value="PIX_MANUAL">PIX avulso</option>
                      </select>
                    </label>
                    <label className="field-label">
                      <span>Ciclo</span>
                      <select
                        value={checkoutCycle}
                        onChange={(event) =>
                          setCheckoutCycle(event.target.value === "YEARLY" ? "YEARLY" : event.target.value === "MONTHLY" ? "MONTHLY" : "")
                        }
                        required
                      >
                        <option value="">Selecione um ciclo</option>
                        <option value="MONTHLY">Mensal</option>
                        <option value="YEARLY">Anual</option>
                      </select>
                    </label>
                    {isCheckoutSelectionReady ? (
                      <>
                        <strong className="checkout-price-preview">{`Valor: ${checkoutSelectedPriceLabel}`}</strong>
                        <button
                          type="submit"
                          className="stripe-pay-button"
                          disabled={startingCheckout || availablePaidPlans.length === 0}
                        >
                          {startingCheckout ? "Abrindo checkout..." : "Pagar com Stripe"}
                        </button>
                      </>
                    ) : null}
                    <small className="field-hint">
                      O link abre no Checkout oficial do Stripe e volta automaticamente para esta tela.
                    </small>
                  </form>
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state">Não foi possível carregar os dados do plano.</div>
          )}
        </section>
      </div>
    );
  }

  function renderPlanConfig() {
    if (!isRootUser) {
      return (
        <section className="panel-card view-stack">
          <div className="empty-state">Apenas root pode acessar esta tela.</div>
        </section>
      );
    }

    if (billingLoading) {
      return renderPlanSkeleton();
    }

    return (
      <div className="view-stack">
        {planInfo ? <div className={`info-banner${isPositivePlanInfo ? " info-banner-success" : ""}`}>{planInfo}</div> : null}

        <section className="panel-card view-stack" aria-label="Configurações básicas">
          <div className="section-head">
            {renderSectionTitleWithIcon("planConfig", "Configurações básicas", "root")}
            <div className="inline-actions">
              <button type="button" className="ghost-button" onClick={openBillingDiscountModal}>
                Desconto por usuário
              </button>
            </div>
          </div>
          <form onSubmit={saveBillingSettings} className="form-stack">
            <label className="field-label">
              <span>Trial automático para novas contas</span>
              <select
                value={billingSettings.autoTrialEnabled ? "enabled" : "disabled"}
                onChange={(event) =>
                  setBillingSettings((current) => ({
                    ...current,
                    autoTrialEnabled: event.target.value === "enabled",
                  }))
                }
              >
                <option value="enabled">Ativado</option>
                <option value="disabled">Desativado</option>
              </select>
            </label>
            <label className="field-label">
              <span>Dias de trial automático</span>
              <input
                type="number"
                min={0}
                max={60}
                value={billingSettings.autoTrialDays}
                onChange={(event) =>
                  setBillingSettings((current) => ({
                    ...current,
                    autoTrialDays: Math.max(0, Math.min(60, Number.parseInt(event.target.value || "0", 10) || 0)),
                  }))
                }
              />
            </label>
            <small className="field-hint">
              Limites do plano trial são gerados automaticamente com base nos dias informados e no plano Start.
            </small>
            <label className="field-label">
              <span>Plano padrão do root</span>
              <select
                value={billingSettings.rootDisplayPlanId ?? ""}
                onChange={(event) =>
                  setBillingSettings((current) => ({
                    ...current,
                    rootDisplayPlanId: event.target.value || null,
                  }))
                }
              >
                <option value="">Automático (maior plano ativo)</option>
                {billingPlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {`${plan.name} (${plan.code})`}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={savingBillingSettings}>
              {savingBillingSettings ? "Salvando..." : "Salvar configuração"}
            </button>
          </form>
        </section>

        <section ref={planEditorSectionRef} className="panel-card view-stack" aria-label="Cadastrar plano">
          <div className="section-head">
            {renderSectionTitleWithIcon("planConfig", editingPlanId ? "Editar plano" : "Cadastrar plano", "root")}
          </div>
          <form onSubmit={createBillingPlan} className="form-stack">
            <label className="field-label">
              <span>Código</span>
              <input
                value={planCodeInput}
                onChange={(event) => setPlanCodeInput(event.target.value.toUpperCase())}
                placeholder="START"
                required
              />
            </label>
            <label className="field-label">
              <span>Nome</span>
              <input
                value={planNameInput}
                onChange={(event) => setPlanNameInput(event.target.value)}
                placeholder="Plano Start"
                required
              />
            </label>
            <label className="field-label">
              <span>Descrição</span>
              <input
                value={planDescriptionInput}
                onChange={(event) => setPlanDescriptionInput(event.target.value)}
                placeholder="Descrição opcional"
              />
            </label>
            <label className="field-label">
              <span>Tipo</span>
              <select
                value={planIsTrialInput ? "trial" : "paid"}
                onChange={(event) => setPlanIsTrialInput(event.target.value === "trial")}
              >
                <option value="paid">Pago</option>
                <option value="trial">Trial</option>
              </select>
            </label>
            <label className="field-label">
              <span>Status do plano</span>
              <select
                value={planIsActiveInput ? "active" : "inactive"}
                onChange={(event) => setPlanIsActiveInput(event.target.value === "active")}
              >
                <option value="active">Ativo</option>
                <option value="inactive">Inativo</option>
              </select>
            </label>
            <label className="field-label">
              <span>Total de perfis</span>
              <input
                type="number"
                min={1}
                value={planMaxProfilesInput}
                onChange={(event) => setPlanMaxProfilesInput(event.target.value)}
                required
              />
            </label>
            <label className="field-label">
              <span>Total de contas</span>
              <input
                type="number"
                min={1}
                value={planMaxConnectionsInput}
                onChange={(event) => setPlanMaxConnectionsInput(event.target.value)}
                required
              />
            </label>
            <label className="field-label">
              <span>Publicações por mês</span>
              <input
                type="number"
                min={1}
                value={planMaxMonthlyPublicationsInput}
                onChange={(event) => setPlanMaxMonthlyPublicationsInput(event.target.value)}
                required
              />
            </label>
            {!planIsTrialInput ? (
              <>
                <label className="field-label">
                  <span>Produto Stripe (obrigatório em plano pago)</span>
                  <select
                    value={planStripeProductIdInput}
                    onChange={(event) => setPlanStripeProductIdInput(event.target.value)}
                  >
                    <option value="">Sem vínculo de produto</option>
                    {stripeCatalogProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {`${product.name} (${product.id})`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  <span>Preço mensal (auto)</span>
                  <input
                    value={formatPriceFromCents(resolvedStripePriceIdsForSelectedProduct?.stripeMonthlyPriceCents ?? null)}
                    placeholder="Definido automaticamente pelo produto"
                    disabled
                    readOnly
                  />
                </label>
                <label className="field-label">
                  <span>Preço anual (auto)</span>
                  <input
                    value={formatPriceFromCents(resolvedStripePriceIdsForSelectedProduct?.stripeYearlyPriceCents ?? null)}
                    placeholder="Definido automaticamente pelo produto"
                    disabled
                    readOnly
                  />
                </label>
                <label className="field-label">
                  <span>Price assinatura mensal (auto)</span>
                  <input
                    value={resolvedStripePriceIdsForSelectedProduct?.stripeMonthlyPriceId ?? ""}
                    placeholder="Definido automaticamente pelo produto"
                    disabled
                    readOnly
                  />
                </label>
                <label className="field-label">
                  <span>Price assinatura anual (auto)</span>
                  <input
                    value={resolvedStripePriceIdsForSelectedProduct?.stripeYearlyPriceId ?? ""}
                    placeholder="Definido automaticamente pelo produto"
                    disabled
                    readOnly
                  />
                </label>
                <label className="field-label">
                  <span>Price PIX mensal (auto)</span>
                  <input
                    value={resolvedStripePriceIdsForSelectedProduct?.stripePixMonthlyPriceId ?? ""}
                    placeholder="Definido automaticamente pelo produto"
                    disabled
                    readOnly
                  />
                </label>
                <label className="field-label">
                  <span>Price PIX anual (auto)</span>
                  <input
                    value={resolvedStripePriceIdsForSelectedProduct?.stripePixYearlyPriceId ?? ""}
                    placeholder="Definido automaticamente pelo produto"
                    disabled
                    readOnly
                  />
                </label>
                <small className="field-hint">
                  Ao selecionar o produto Stripe, os preços são vinculados automaticamente e não podem ser editados.
                </small>
              </>
            ) : null}
            {stripeCatalogError ? <small className="field-hint">{stripeCatalogError}</small> : null}
            <div className="inline-actions">
              <button type="submit" disabled={creatingPlan}>
                {creatingPlan ? "Salvando..." : editingPlanId ? "Salvar alterações" : "Cadastrar plano"}
              </button>
              {editingPlanId ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={resetBillingPlanForm}
                  disabled={creatingPlan}
                >
                  Cancelar edição
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="panel-card view-stack" aria-label="Planos cadastrados">
          <div className="section-head">
            {renderSectionTitleWithIcon("planConfig", "Planos", "root")}
          </div>
          <div className="table-list">
            {billingPlans.map((plan) => (
              <div key={plan.id} className="row-card billing-row-card billing-plan-catalog-row">
                <div className="billing-plan-row-inline">
                  <strong>{`${plan.name} (${plan.code})`}</strong>
                  <span className={`status-pill ${plan.isActive ? "status-billing-active" : "status-billing-paused"}`}>
                    {plan.isActive ? "Ativo" : "Pausado"}
                  </span>
                  <span className={`unit-pill unit-pill-plan${plan.isTrial ? " unit-pill-plan-trial" : ""}`}>{plan.isTrial ? "Trial" : "Pago"}</span>
                  <span className={`unit-pill unit-pill-plan${plan.isTrial ? " unit-pill-plan-trial" : ""}`}>{`Perfis: ${plan.maxProfiles}`}</span>
                  <span className={`unit-pill unit-pill-plan${plan.isTrial ? " unit-pill-plan-trial" : ""}`}>{`Contas: ${plan.maxConnections}`}</span>
                  <span className={`unit-pill unit-pill-plan${plan.isTrial ? " unit-pill-plan-trial" : ""}`}>{`Posts/mês: ${plan.maxMonthlyPublications}`}</span>
                  {plan.isTrial ? (
                    <span className="billing-plan-note">Plano de trial sem cobrança.</span>
                  ) : null}
                  {!plan.isTrial ? (
                    <span className="billing-plan-note">
                      {`Assinatura: ${formatCompactPriceFromCents(plan.monthlyPriceCents)}/${formatCompactPriceFromCents(plan.yearlyPriceCents)}`}
                    </span>
                  ) : null}
                  {!plan.isTrial ? (
                    <span className="billing-plan-note">
                      {`PIX: ${formatCompactPriceFromCents(plan.monthlyPriceCents)}/${formatCompactPriceFromCents(plan.yearlyPriceCents)}`}
                    </span>
                  ) : null}
                  <button type="button" className="ghost-button" onClick={() => startBillingPlanEdit(plan)}>
                    Editar
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => void deleteBillingPlan(plan)}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}
            {billingPlans.length === 0 ? <div className="empty-state">Nenhum plano cadastrado.</div> : null}
          </div>
        </section>
      </div>
    );
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
              <span>{formatDate(company.createdAt, effectiveUserTimeZone)}</span>
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
                  {connection.platform === "instagram" && connection.authStatus === "CONNECTED" && connection.instagramUsername ? (
                    <span className="unit-pill connection-detail-pill">{`Conta: @${connection.instagramUsername}`}</span>
                  ) : null}
                  {connection.platform === "instagram" &&
                  connection.authStatus === "CONNECTED" &&
                  !connection.instagramUsername &&
                  connection.instagramUserId ? (
                    <span className="unit-pill connection-detail-pill">{`Conta ID: ${connection.instagramUserId}`}</span>
                  ) : null}
                  {connection.platform === "whatsapp" && connection.authStatus === "CONNECTED" ? (
                    (() => {
                      const ownerNumber = resolveWhatsappOwnerNumber(connection.whatsappOwnerJid);
                      return ownerNumber ? (
                        <span className="unit-pill connection-detail-pill">{ownerNumber}</span>
                      ) : null;
                    })()
                  ) : null}
                  {connection.authStatus === "CONNECTED" ? (
                    <span className={`connection-connected-text connection-connected-text-${connection.platform}`}>
                      Conectado
                    </span>
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
    const activeMediaCaptionTarget =
      mediaCaptionModalIndex !== null ? uploadedSchedulerMedia[mediaCaptionModalIndex] ?? null : null;
    const activeStoryEditorTarget =
      storyEditorMediaIndex !== null ? uploadedSchedulerMedia[storyEditorMediaIndex] ?? null : null;
    const canOpenStoryEditor = publicationType === "instagram_story";

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
              onChange={(event) => handlePublicationTypeChange(event.target.value as SchedulerPublicationType)}
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

          <div
            className={`form-grid form-grid-two scheduler-top-grid${publicationState === "DRAFT" ? " scheduler-top-grid-disabled" : ""}`}
          >
            <input
              type="date"
              value={scheduledDate}
              onChange={(event) => setScheduledDate(event.target.value)}
              required={publicationState === "PUBLISHED"}
              disabled={submittingJob || publicationState === "DRAFT"}
              title="Selecione a data em que a postagem deve ser executada."
            />
            <input
              type="time"
              value={scheduledTime}
              onChange={(event) => setScheduledTime(event.target.value)}
              required={publicationState === "PUBLISHED"}
              disabled={submittingJob || publicationState === "DRAFT"}
              title="Selecione o horário em que a postagem deve ser executada."
            />
          </div>

          <div className="text-chip">
            {publicationState === "DRAFT"
              ? "Rascunho não entra em execução automática, data e hora são ignorados."
              : "Publicado exige data e horário preenchidos."}
          </div>

          {publicationType === "instagram_story" ? (
            <div className="info-banner scheduler-story-editor-warning">
              Editor de Stories para imagens (experimental)
            </div>
          ) : null}

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

          {requiresMediaUpload && uploadedMediaCount > 0 ? (
            <div className="scheduler-media-preview-list">
              {uploadedSchedulerMedia.map((media, index) => (
                <div
                  key={media.filePath}
                  className={`scheduler-media-preview-item${supportsMultiMediaUpload && uploadedMediaCount > 1 ? "" : " scheduler-media-preview-item-static"}${draggingSchedulerMediaIndex === index ? " scheduler-media-preview-item-dragging" : ""}${dragOverSchedulerMediaIndex === index ? " scheduler-media-preview-item-drop-target" : ""}`}
                  draggable={supportsMultiMediaUpload && uploadedMediaCount > 1}
                  onDragStart={(event) => handleSchedulerMediaThumbDragStart(index, event)}
                  onDragEnd={handleSchedulerMediaThumbDragEnd}
                  onDragOver={(event) => handleSchedulerMediaThumbDragOver(index, event)}
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
                  <button
                    type="button"
                    className={`scheduler-media-preview-caption${media.caption?.trim() ? " scheduler-media-preview-caption-filled" : ""}`}
                    onClick={() => openMediaCaptionModal(index)}
                    disabled={submittingJob || uploading}
                  >
                    {media.caption?.trim() ? "Editar" : "Add. legenda"}
                  </button>
                  {canOpenStoryEditor && isImagePath(media.filePath) ? (
                    <button
                      type="button"
                      className="scheduler-media-preview-story-editor"
                      onClick={() => openStoryEditorModal(index)}
                      disabled={submittingJob || uploading}
                      title="Abrir mini editor do story"
                      aria-label={`Editar story da mídia ${index + 1}`}
                    >
                      <span>Edit. story</span>
                    </button>
                  ) : null}
                  {isVideoPath(media.filePath) ? (
                    <video src={`${api.baseUrl}${media.filePath}`} muted playsInline preload="metadata" />
                  ) : (
                    <img src={`${api.baseUrl}${media.filePath}`} alt={`Prévia ${index + 1}`} />
                  )}
                  <small>{`#${index + 1}`}</small>
                </div>
              ))}
            </div>
          ) : null}

          {supportsCaption ? (
            <div className="field-shell">
              <div className="field-head-with-action">
                <span>{captionLabel}</span>
                {renderQuickEmojiPicker({
                  pickerKey: "scheduler-caption",
                  disabled: submittingJob,
                  onPick: appendEmojiToCaption,
                  label: "Emojis da legenda",
                  className: "emoji-picker-shell-right",
                })}
              </div>
              <textarea
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                disabled={submittingJob}
                placeholder={captionPlaceholder}
                rows={publicationType === "whatsapp_status_texto" ? 5 : 4}
                maxLength={2000}
                required={publicationType === "whatsapp_status_texto"}
                title={captionTitle}
              />
            </div>
          ) : null}

          {supportsFirstComment ? (
            <label className="field-shell scheduler-first-comment-shell">
              <span>Primeiro comentário</span>
              <div className="scheduler-sequence-row">
                <input
                  type="checkbox"
                  checked={firstCommentEnabled}
                  onChange={(event) => setFirstCommentEnabled(event.target.checked)}
                  disabled={submittingJob}
                />
                <small>Publique automaticamente um comentário após o post/reel (opcional).</small>
              </div>
              {firstCommentEnabled ? (
                <>
                  <div className="field-head-with-action">
                    <span className="field-head-helper">Texto do primeiro comentário</span>
                    {renderQuickEmojiPicker({
                      pickerKey: "scheduler-first-comment",
                      disabled: submittingJob,
                      onPick: appendEmojiToFirstComment,
                      label: "Emojis do primeiro comentário",
                      className: "emoji-picker-shell-right",
                    })}
                  </div>
                  <textarea
                    value={firstComment}
                    onChange={(event) => setFirstComment(event.target.value)}
                    disabled={submittingJob}
                    placeholder="Digite o primeiro comentário (aceita emojis)"
                    rows={4}
                    maxLength={2000}
                    required
                  />
                </>
              ) : null}
            </label>
          ) : null}

          {supportsWhatsappRelink ? (
            <label className="field-shell scheduler-first-comment-shell">
              <span>Linkar no WhatsApp Status</span>
              <div className="scheduler-sequence-row">
                <input
                  type="checkbox"
                  checked={whatsappRelinkEnabled}
                  onChange={(event) => setWhatsappRelinkEnabled(event.target.checked)}
                  disabled={submittingJob || !canEnableWhatsappRelink}
                />
                <small>
                  {publicationType === "instagram_story" && !canEnableWhatsappRelink
                    ? "Relink no momento está disponível apenas para story único"
                    : "Após publicar no Instagram, cria um status com a primeira mídia e o link do conteúdo para as contas selecionadas."}
                </small>
              </div>
              {whatsappRelinkEnabled && canEnableWhatsappRelink ? (
                <div className="scheduler-whatsapp-relink-shell">
                  <div className="scheduler-whatsapp-relink-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={selectAllWhatsappRelinkConnections}
                      disabled={submittingJob || schedulerWhatsappConnections.length === 0}
                    >
                      Selecionar todas
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={clearWhatsappRelinkConnections}
                      disabled={submittingJob || whatsappRelinkConnectionIds.length === 0}
                    >
                      Limpar
                    </button>
                  </div>
                  {schedulerWhatsappConnections.length === 0 ? (
                    <small>Nenhuma conta de WhatsApp conectada para seu usuário.</small>
                  ) : (
                    <div className="scheduler-whatsapp-relink-list">
                      {schedulerWhatsappConnections.map((connection) => (
                        <label key={connection.id} className="scheduler-whatsapp-relink-option">
                          <input
                            type="checkbox"
                            checked={whatsappRelinkConnectionIds.includes(connection.id)}
                            onChange={() => toggleWhatsappRelinkConnectionSelection(connection.id)}
                            disabled={submittingJob}
                          />
                          <span>{`${connection.displayName} (${companyNameMap[connection.companyId] || "Perfil removido"})`}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </label>
          ) : null}

          {supportsWhatsappBackgroundColor ? (
            <label className="field-shell">
              <span>
                {publicationType === "whatsapp_status_texto" || publicationType === "whatsapp_status_midia"
                  ? "Cor de fundo do status"
                  : "Cor de fundo do relink"}
              </span>
              <div className="scheduler-color-picker-row">
                <input
                  type="color"
                  value={whatsappBackgroundColor}
                  onChange={(event) => setWhatsappBackgroundColor(event.target.value.toUpperCase())}
                  disabled={submittingJob}
                  className="scheduler-color-picker-input"
                  aria-label="Selecionar cor de fundo do WhatsApp"
                />
                <span className="scheduler-color-picker-value">{whatsappBackgroundColor}</span>
              </div>
              <small className="field-hint">
                {publicationType === "whatsapp_status_texto" || publicationType === "whatsapp_status_midia"
                  ? "Escolha a cor usada no fundo do status do WhatsApp."
                  : "Escolha a cor usada no fundo do WhatsApp Status criado pelo relink."}
              </small>
            </label>
          ) : null}

          {requiresInstagramMetadata &&
          (isInstagramForcedLocationEnabled || publicationType !== "instagram_story") ? (
            <div className="text-chip">
              {isInstagramForcedLocationEnabled
                ? `Localização fixa ativa: ${instagramForcedLocationName} (#${instagramForcedLocationId}).`
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

        {activeMediaCaptionTarget ? (
          <div
            className="scheduler-media-caption-modal-backdrop"
            onClick={() => {
              if (!submittingJob) {
                closeMediaCaptionModal();
              }
            }}
          >
            <section
              className="scheduler-media-caption-modal"
              aria-label="Editar legenda da mídia"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="scheduler-media-caption-modal-header">
                <div>
                  <strong>{`Legenda da mídia #${(mediaCaptionModalIndex ?? 0) + 1}`}</strong>
                  <span>{activeMediaCaptionTarget.fileName}</span>
                </div>
                <button
                  type="button"
                  className="qr-modal-close"
                  onClick={() => {
                    if (!submittingJob) {
                      closeMediaCaptionModal();
                    }
                  }}
                  aria-label="Fechar"
                  disabled={submittingJob}
                >
                  <span className="modal-close-icon" aria-hidden="true">
                    X
                  </span>
                </button>
              </div>
              <div className="scheduler-media-caption-modal-preview">
                {isVideoPath(activeMediaCaptionTarget.filePath) ? (
                  <video
                    src={`${api.baseUrl}${activeMediaCaptionTarget.filePath}`}
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <img
                    src={`${api.baseUrl}${activeMediaCaptionTarget.filePath}`}
                    alt={`Prévia da mídia ${activeMediaCaptionTarget.fileName}`}
                  />
                )}
              </div>
              <div className="field-shell">
                <div className="field-head-with-action">
                  <span>Legenda da mídia</span>
                  {renderQuickEmojiPicker({
                    pickerKey: "scheduler-media-caption",
                    disabled: submittingJob,
                    onPick: appendEmojiToMediaCaption,
                    label: "Emojis da legenda da mídia",
                    className: "emoji-picker-shell-right",
                  })}
                </div>
                <textarea
                  value={mediaCaptionDraft}
                  onChange={(event) => setMediaCaptionDraft(event.target.value)}
                  disabled={submittingJob}
                  placeholder="Digite a legenda desta mídia (opcional)"
                  rows={4}
                  maxLength={2000}
                />
              </div>
              <div className="scheduler-media-caption-modal-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setMediaCaptionDraft("")}
                  disabled={submittingJob}
                >
                  Limpar
                </button>
                <button type="button" onClick={saveMediaCaptionModal} disabled={submittingJob}>
                  Salvar legenda
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {activeStoryEditorTarget && canOpenStoryEditor ? (
          <div
            className="scheduler-story-editor-backdrop"
            onClick={() => {
              if (!storyEditorSaving && !submittingJob) {
                closeStoryEditorModal();
              }
            }}
          >
            <section
              className="scheduler-story-editor-modal"
              aria-label="Mini editor de story"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="scheduler-story-editor-header">
                <div>
                  <strong>Mini editor de story (Experimental)</strong>
                </div>
                <button
                  type="button"
                  className="qr-modal-close"
                  onClick={() => {
                    if (!storyEditorSaving && !submittingJob) {
                      closeStoryEditorModal();
                    }
                  }}
                  aria-label="Fechar"
                  disabled={storyEditorSaving || submittingJob}
                >
                  <span className="modal-close-icon" aria-hidden="true">
                    X
                  </span>
                </button>
              </div>

              <div className="scheduler-story-editor-toolbar-inline">
                <button
                  type="button"
                  className="scheduler-story-editor-tool-icon"
                  onClick={addStoryEditorTextSticker}
                  disabled={storyEditorSaving}
                  title="Adicionar texto"
                  aria-label="Adicionar texto"
                >
                  <FiType aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`scheduler-story-editor-tool-icon${storyEditorDecorPickerOpen ? " scheduler-story-editor-tool-icon-active" : ""}`}
                  onClick={toggleStoryEditorDecorPicker}
                  disabled={storyEditorSaving}
                  title="Figurinhas"
                  aria-label="Figurinhas"
                >
                  <FiSmile aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`scheduler-story-editor-tool-icon${storyEditorLocationEnabled ? " scheduler-story-editor-tool-icon-active" : ""}`}
                  onClick={toggleStoryEditorLocationSticker}
                  disabled={storyEditorSaving}
                  title="Localização"
                  aria-label="Localização"
                >
                  <FiMapPin aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`scheduler-story-editor-tool-icon${storyEditorToolMode === "DRAW" ? " scheduler-story-editor-tool-icon-active" : ""}`}
                  onClick={toggleStoryEditorDrawMode}
                  disabled={storyEditorSaving}
                  title={storyEditorToolMode === "DRAW" ? "Finalizar rabisco" : "Rabisco"}
                  aria-label={storyEditorToolMode === "DRAW" ? "Finalizar rabisco" : "Rabisco"}
                >
                  <FiEdit3 aria-hidden="true" />
                </button>
                {storyEditorStrokes.length > 0 ? (
                  <button
                    type="button"
                    className="scheduler-story-editor-tool-icon"
                    onClick={() => setStoryEditorStrokes((current) => current.slice(0, -1))}
                    disabled={storyEditorSaving}
                    title="Desfazer rabisco"
                    aria-label="Desfazer rabisco"
                  >
                    <FiRotateCcw aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              <div className="scheduler-story-editor-stage-wrap">
                <div
                  ref={storyEditorStageRef}
                  className={`scheduler-story-editor-stage${storyEditorToolMode === "DRAW" ? " scheduler-story-editor-stage-drawing" : ""}`}
                  onPointerDown={handleStoryEditorStagePointerDown}
                  onPointerMove={handleStoryEditorStagePointerMove}
                  onPointerUp={handleStoryEditorStagePointerUp}
                  onPointerCancel={handleStoryEditorStagePointerUp}
                  onPointerEnter={handleStoryEditorStagePointerEnter}
                  onPointerLeave={handleStoryEditorStagePointerLeave}
                >
                  {storyEditorDecorPickerOpen ? (
                    <div className="scheduler-story-editor-overlay-controls scheduler-story-editor-stage-controls-top">
                      <div className="scheduler-story-editor-inline-panel scheduler-story-editor-inline-panel-decor">
                        <div className="scheduler-story-editor-inline-emoji-list">
                          {STORY_EDITOR_DECOR_STICKERS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              className="scheduler-story-editor-decor-chip"
                              onClick={() => addStoryEditorDecorSticker(emoji)}
                              disabled={storyEditorSaving}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                        <div className="scheduler-story-editor-inline-actions">
                          {storyEditorDecorStickers.length > 0 ? (
                            <button
                              type="button"
                              className="scheduler-story-editor-inline-clear"
                              onClick={() => setStoryEditorDecorStickers([])}
                              disabled={storyEditorSaving}
                            >
                              Limpar
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="scheduler-story-editor-inline-icon-button"
                            onClick={() => setStoryEditorDecorPickerOpen(false)}
                            disabled={storyEditorSaving}
                            aria-label="Fechar figurinhas"
                            title="Fechar figurinhas"
                          >
                            <FiX aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {storyEditorLocationEditing && storyEditorLocationEnabled ? (
                    <div
                      className="scheduler-story-editor-overlay-controls scheduler-story-editor-stage-controls-floating"
                      style={{
                        top: `${storyEditorLocationControlsStyle.top}px`,
                        left: `${storyEditorLocationControlsStyle.left}px`,
                        width: `${storyEditorLocationControlsStyle.width}px`,
                      }}
                    >
                      <div className="scheduler-story-editor-inline-panel scheduler-story-editor-inline-panel-location">
                        <label className="scheduler-story-editor-inline-input">
                          <InstagramGradientMapPinIcon
                            className="scheduler-story-editor-location-pin"
                            gradientId="story-location-pin-inline-gradient"
                          />
                          <input
                            type="text"
                            value={storyEditorLocationText}
                            onChange={(event) => setStoryEditorLocationText(event.target.value.slice(0, 80))}
                            placeholder="Digite a localização"
                            disabled={storyEditorSaving}
                            maxLength={80}
                            autoFocus
                          />
                        </label>
                        <div className="scheduler-story-editor-text-colors">
                          <div className="scheduler-story-editor-color-list">
                            {STORY_EDITOR_TEXT_COLORS.map((color) => (
                              <button
                                key={`location-text-${color}`}
                                type="button"
                                className={`scheduler-story-editor-color-dot${storyEditorLocationTextColor === color ? " scheduler-story-editor-color-dot-active" : ""}`}
                                style={{ backgroundColor: color }}
                                onClick={() => setStoryEditorLocationTextColor(color)}
                                disabled={storyEditorSaving}
                                aria-label={`Cor do texto ${color}`}
                                title={`Cor do texto ${color}`}
                              />
                            ))}
                          </div>
                          <div className="scheduler-story-editor-color-list">
                            {STORY_EDITOR_TEXT_BACKGROUNDS.map((color) => (
                              <button
                                key={`location-bg-${color}`}
                                type="button"
                                className={`scheduler-story-editor-color-dot${storyEditorLocationBackgroundColor === color ? " scheduler-story-editor-color-dot-active" : ""}`}
                                style={{ backgroundColor: color === "transparent" ? "#ffffff" : color }}
                                onClick={() => setStoryEditorLocationBackgroundColor(color)}
                                disabled={storyEditorSaving}
                                aria-label={`Fundo ${color}`}
                                title={color === "transparent" ? "Sem fundo" : `Fundo ${color}`}
                              >
                                {color === "transparent" ? <span className="scheduler-story-editor-transparent-mark">/</span> : null}
                              </button>
                            ))}
                          </div>
                        </div>
                        <label className="scheduler-story-editor-size-control">
                          <input
                            type="range"
                            min={0.7}
                            max={getStoryEditorMaxLocationScale(storyEditorLocationText, storyEditorLocationFontFamily)}
                            step={0.05}
                            value={storyEditorLocationScale}
                            onChange={(event) => updateStoryEditorLocationScale(Number.parseFloat(event.target.value) || 1)}
                            disabled={storyEditorSaving}
                          />
                          <strong>{Math.round(storyEditorLocationScale * 100)}%</strong>
                        </label>
                        <div className="scheduler-story-editor-inline-actions">
                          <label className="scheduler-story-editor-inline-font">
                            <FiType aria-hidden="true" />
                            <select
                              value={storyEditorLocationFontFamily}
                              onChange={(event) => updateStoryEditorLocationFont(event.target.value)}
                              disabled={storyEditorSaving}
                            >
                              {STORY_EDITOR_FONT_OPTIONS.map((fontOption) => (
                                <option key={`location-font-${fontOption.value}`} value={fontOption.value}>
                                  {fontOption.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            className="scheduler-story-editor-inline-icon-button"
                            onClick={removeStoryEditorLocationSticker}
                            disabled={storyEditorSaving}
                            aria-label="Remover localização"
                            title="Remover localização"
                          >
                            <FiTrash2 aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="scheduler-story-editor-inline-icon-button"
                            onClick={() => setStoryEditorLocationEditing(false)}
                            disabled={storyEditorSaving}
                            aria-label="Fechar edição da localização"
                            title="Fechar edição da localização"
                          >
                            <FiX aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <img src={`${api.baseUrl}${activeStoryEditorTarget.filePath}`} alt="Prévia do story editável" />
                  {storyEditorLocationEnabled ? (
                    <>
                      <button
                        type="button"
                        className={`scheduler-story-editor-sticker scheduler-story-editor-location-sticker${storyEditorDraggingSticker ? " scheduler-story-editor-sticker-dragging" : ""}`}
                        style={{
                          left: `${storyEditorStickerX * 100}%`,
                          top: `${storyEditorStickerY * 100}%`,
                          color: storyEditorLocationTextColor,
                          background:
                            storyEditorLocationBackgroundColor === "transparent"
                              ? "transparent"
                              : storyEditorLocationBackgroundColor,
                          borderColor:
                            storyEditorLocationBackgroundColor === "transparent"
                              ? "rgba(255, 255, 255, 0.72)"
                              : "transparent",
                          fontFamily: `${storyEditorLocationFontFamily}, K2D, Arial, sans-serif`,
                          transform: `translate(-50%, -50%) scale(${storyEditorLocationScale})`,
                        }}
                        onPointerDown={handleStoryEditorStickerPointerDown}
                        onPointerMove={handleStoryEditorStickerPointerMove}
                        onPointerUp={handleStoryEditorStickerPointerUp}
                        onPointerCancel={handleStoryEditorStickerPointerUp}
                        onClick={() => {
                          setStoryEditorLocationEditing(true);
                          setStoryEditorDecorPickerOpen(false);
                          setStoryEditorActiveTextStickerId(null);
                          setStoryEditorActiveDecorStickerId(null);
                        }}
                        disabled={storyEditorSaving || storyEditorToolMode === "DRAW"}
                      >
                        <InstagramGradientMapPinIcon
                          className="scheduler-story-editor-location-pin"
                          gradientId="story-location-pin-sticker-gradient"
                        />
                        <span>{storyEditorResolvedLocationName || "Sua localização"}</span>
                      </button>
                      {storyEditorLocationEditing ? (
                        <button
                          type="button"
                          className="scheduler-story-editor-sticker-delete"
                          style={{
                            left: `calc(${storyEditorStickerX * 100}% + ${Math.max(
                              storyEditorLocationStickerSize.width / 2 - 12,
                              20,
                            )}px)`,
                            top: `calc(${storyEditorStickerY * 100}% - ${Math.max(
                              storyEditorLocationStickerSize.height / 2 - 2,
                              18,
                            )}px)`,
                          }}
                          onClick={removeStoryEditorLocationSticker}
                          disabled={storyEditorSaving}
                          aria-label="Remover localização"
                          title="Remover localização"
                        >
                          <FiTrash2 aria-hidden="true" />
                        </button>
                      ) : null}
                    </>
                  ) : null}
                  {storyEditorDecorStickers.map((sticker) => (
                    <div key={sticker.id}>
                      <button
                        type="button"
                        className={`scheduler-story-editor-sticker scheduler-story-editor-decor-sticker${storyEditorDraggingDecorStickerId === sticker.id ? " scheduler-story-editor-sticker-dragging" : ""}`}
                        style={{
                          left: `${sticker.x * 100}%`,
                          top: `${sticker.y * 100}%`,
                        }}
                        onPointerDown={(event) => handleStoryEditorDecorStickerPointerDown(sticker.id, sticker.x, sticker.y, event)}
                        onPointerMove={handleStoryEditorDecorStickerPointerMove}
                        onPointerUp={handleStoryEditorDecorStickerPointerUp}
                        onPointerCancel={handleStoryEditorDecorStickerPointerUp}
                        onClick={() => {
                          setStoryEditorActiveTextStickerId(null);
                          setStoryEditorLocationEditing(false);
                          setStoryEditorDecorPickerOpen(false);
                          setStoryEditorActiveDecorStickerId(sticker.id);
                        }}
                        disabled={storyEditorSaving || storyEditorToolMode === "DRAW"}
                        aria-label={`Figura ${sticker.emoji}`}
                        title={`Figura ${sticker.emoji}`}
                      >
                        <span>{sticker.emoji}</span>
                      </button>
                      {storyEditorActiveDecorStickerId === sticker.id ? (
                        <button
                          type="button"
                          className="scheduler-story-editor-sticker-delete"
                          style={{
                            left: `calc(${sticker.x * 100}% + 34px)`,
                            top: `calc(${sticker.y * 100}% - 28px)`,
                          }}
                          onClick={removeStoryEditorActiveDecorSticker}
                          disabled={storyEditorSaving}
                          aria-label={`Remover figura ${sticker.emoji}`}
                          title={`Remover figura ${sticker.emoji}`}
                        >
                          <FiTrash2 aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {storyEditorTextStickers.map((textSticker) => (
                    <div key={textSticker.id}>
                      <button
                        type="button"
                        className={`scheduler-story-editor-sticker scheduler-story-editor-text-sticker${storyEditorDraggingTextStickerId === textSticker.id ? " scheduler-story-editor-sticker-dragging" : ""}${storyEditorActiveTextStickerId === textSticker.id ? " scheduler-story-editor-text-sticker-active" : ""}`}
                        style={{
                          left: `${textSticker.x * 100}%`,
                          top: `${textSticker.y * 100}%`,
                        color: textSticker.textColor,
                        background: textSticker.backgroundColor === "transparent" ? "transparent" : textSticker.backgroundColor,
                        borderColor: textSticker.backgroundColor === "transparent" ? "rgba(255, 255, 255, 0.72)" : "transparent",
                        fontFamily: `${textSticker.fontFamily}, K2D, Arial, sans-serif`,
                        transform: `translate(-50%, -50%) scale(${textSticker.scale})`,
                      }}
                        onPointerDown={(event) =>
                          handleStoryEditorTextStickerPointerDown(textSticker.id, textSticker.x, textSticker.y, event)}
                        onPointerMove={handleStoryEditorTextStickerPointerMove}
                        onPointerUp={handleStoryEditorTextStickerPointerUp}
                        onPointerCancel={handleStoryEditorTextStickerPointerUp}
                      onClick={() => {
                        setStoryEditorActiveTextStickerId(textSticker.id);
                        setStoryEditorTextColor(textSticker.textColor);
                        setStoryEditorTextBackgroundColor(textSticker.backgroundColor);
                        setStoryEditorTextFontFamily(textSticker.fontFamily);
                        setStoryEditorTextScale(textSticker.scale);
                        setStoryEditorDecorPickerOpen(false);
                        setStoryEditorLocationEditing(false);
                        setStoryEditorActiveDecorStickerId(null);
                      }}
                        disabled={storyEditorSaving || storyEditorToolMode === "DRAW"}
                        aria-label={`Texto ${textSticker.text}`}
                        title={textSticker.text}
                      >
                        <span>{textSticker.text}</span>
                      </button>
                      {storyEditorActiveTextStickerId === textSticker.id ? (
                        <button
                          type="button"
                          className="scheduler-story-editor-sticker-delete"
                          style={{
                            left: `calc(${textSticker.x * 100}% + ${Math.max(
                              estimateStoryEditorTextStickerSize(textSticker.text, textSticker.fontFamily, textSticker.scale).width /
                                2 -
                                12,
                              20,
                            )}px)`,
                            top: `calc(${textSticker.y * 100}% - ${Math.max(
                              estimateStoryEditorTextStickerSize(textSticker.text, textSticker.fontFamily, textSticker.scale).height /
                                2 -
                                2,
                              18,
                            )}px)`,
                          }}
                          onClick={removeStoryEditorActiveTextSticker}
                          disabled={storyEditorSaving}
                          aria-label="Remover texto"
                          title="Remover texto"
                        >
                          <FiTrash2 aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {storyEditorStrokes.length > 0 ? (
                    <svg className="scheduler-story-editor-draw-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                      {storyEditorStrokes.map((stroke) =>
                        stroke.points.length === 1 ? (
                          <circle
                            key={stroke.id}
                            cx={(stroke.points[0]?.x ?? 0.5) * 1000}
                            cy={(stroke.points[0]?.y ?? 0.5) * 1000}
                            r={Math.max(stroke.size * 1.4, 1)}
                            fill={stroke.color}
                          />
                        ) : (
                          <path
                            key={stroke.id}
                            d={storyStrokeSvgPath(stroke.points)}
                            fill="none"
                            stroke={stroke.color}
                            strokeWidth={Math.max(stroke.size * 3, 1)}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        ),
                      )}
                    </svg>
                  ) : null}
                  {storyEditorToolMode === "DRAW" && storyEditorBrushCursor.visible ? (
                    <span
                      className="scheduler-story-editor-brush-cursor"
                      style={{
                        left: `${storyEditorBrushCursor.x * 100}%`,
                        top: `${storyEditorBrushCursor.y * 100}%`,
                        width: `${Math.max(storyEditorBrushSize * 3, 10)}px`,
                        height: `${Math.max(storyEditorBrushSize * 3, 10)}px`,
                        borderColor: storyEditorBrushColor,
                      }}
                    />
                  ) : null}
                  {storyEditorToolMode === "DRAW" ? (
                    <div className="scheduler-story-editor-overlay-controls scheduler-story-editor-stage-controls-bottom">
                      <div className="scheduler-story-editor-inline-panel scheduler-story-editor-inline-panel-draw">
                        <div className="scheduler-story-editor-color-list">
                          {STORY_EDITOR_BRUSH_COLORS.map((color) => (
                            <button
                              key={color}
                              type="button"
                              className={`scheduler-story-editor-color-dot${storyEditorBrushColor === color ? " scheduler-story-editor-color-dot-active" : ""}`}
                              style={{ backgroundColor: color }}
                              onClick={() => setStoryEditorBrushColor(color)}
                              disabled={storyEditorSaving}
                              aria-label={`Selecionar cor ${color}`}
                              title={`Cor ${color}`}
                            />
                          ))}
                        </div>
                        <label className="scheduler-story-editor-size-control">
                          <input
                            type="range"
                            min={4}
                            max={26}
                            step={1}
                            value={storyEditorBrushSize}
                            onChange={(event) => setStoryEditorBrushSize(Number.parseInt(event.target.value, 10) || 10)}
                            disabled={storyEditorSaving}
                          />
                          <strong>{storyEditorBrushSize}px</strong>
                        </label>
                        {storyEditorStrokes.length > 0 ? (
                          <button
                            type="button"
                            className="scheduler-story-editor-inline-clear"
                            onClick={clearStoryEditorStrokes}
                            disabled={storyEditorSaving}
                          >
                            Limpar
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="scheduler-story-editor-inline-icon-button"
                          onClick={() => {
                            setStoryEditorToolMode("MOVE");
                            setStoryEditorBrushCursor((current) => ({ ...current, visible: false }));
                          }}
                          disabled={storyEditorSaving}
                          aria-label="Fechar painel do pincel"
                          title="Fechar painel do pincel"
                        >
                          <FiX aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {activeStoryEditorTextSticker && storyEditorToolMode !== "DRAW" ? (
                    <div className="scheduler-story-editor-overlay-controls scheduler-story-editor-stage-controls-bottom">
                      <div className="scheduler-story-editor-inline-panel scheduler-story-editor-inline-panel-text">
                        <input
                          type="text"
                          value={activeStoryEditorTextSticker.text}
                          onChange={(event) => updateStoryEditorActiveTextStickerText(event.target.value)}
                          disabled={storyEditorSaving}
                          placeholder="Digite o texto"
                          maxLength={120}
                        />
                        <div className="scheduler-story-editor-text-colors">
                          <div className="scheduler-story-editor-color-list">
                            {STORY_EDITOR_TEXT_COLORS.map((color) => (
                              <button
                                key={`text-color-${color}`}
                                type="button"
                                className={`scheduler-story-editor-color-dot${storyEditorTextColor === color ? " scheduler-story-editor-color-dot-active" : ""}`}
                                style={{ backgroundColor: color }}
                                onClick={() => updateStoryEditorActiveTextStickerTextColor(color)}
                                disabled={storyEditorSaving}
                                aria-label={`Cor do texto ${color}`}
                                title={`Cor do texto ${color}`}
                              />
                            ))}
                          </div>
                          <div className="scheduler-story-editor-color-list">
                            {STORY_EDITOR_TEXT_BACKGROUNDS.map((color) => (
                              <button
                                key={`text-bg-${color}`}
                                type="button"
                                className={`scheduler-story-editor-color-dot${storyEditorTextBackgroundColor === color ? " scheduler-story-editor-color-dot-active" : ""}`}
                                style={{ backgroundColor: color === "transparent" ? "#ffffff" : color }}
                                onClick={() => updateStoryEditorActiveTextStickerBackground(color)}
                                disabled={storyEditorSaving}
                                aria-label={`Fundo do texto ${color}`}
                                title={color === "transparent" ? "Sem fundo" : `Fundo ${color}`}
                              >
                                {color === "transparent" ? <span className="scheduler-story-editor-transparent-mark">/</span> : null}
                              </button>
                            ))}
                          </div>
                        </div>
                        <label className="scheduler-story-editor-size-control">
                          <input
                            type="range"
                            min={0.7}
                            max={getStoryEditorMaxTextScale(activeStoryEditorTextSticker.text, storyEditorTextFontFamily)}
                            step={0.05}
                            value={storyEditorTextScale}
                            onChange={(event) =>
                              updateStoryEditorActiveTextStickerScale(Number.parseFloat(event.target.value) || 1)}
                            disabled={storyEditorSaving}
                          />
                          <strong>{Math.round(storyEditorTextScale * 100)}%</strong>
                        </label>
                        <div className="scheduler-story-editor-inline-actions">
                          <label className="scheduler-story-editor-inline-font">
                            <FiType aria-hidden="true" />
                            <select
                              value={storyEditorTextFontFamily}
                              onChange={(event) => updateStoryEditorActiveTextStickerFontFamily(event.target.value)}
                              disabled={storyEditorSaving}
                            >
                              {STORY_EDITOR_FONT_OPTIONS.map((fontOption) => (
                                <option key={`text-font-${fontOption.value}`} value={fontOption.value}>
                                  {fontOption.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            className="scheduler-story-editor-inline-icon-button"
                            onClick={removeStoryEditorActiveTextSticker}
                            disabled={storyEditorSaving}
                            aria-label="Remover texto"
                            title="Remover texto"
                          >
                            <FiTrash2 aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="scheduler-story-editor-inline-icon-button"
                            onClick={() => setStoryEditorActiveTextStickerId(null)}
                            disabled={storyEditorSaving}
                            aria-label="Fechar edição de texto"
                            title="Fechar edição de texto"
                          >
                            <FiX aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="scheduler-story-editor-actions">
                <button type="button" onClick={() => void saveStoryEditorMedia()} disabled={storyEditorSaving || submittingJob}>
                  {storyEditorSaving ? <span className="button-spinner" aria-hidden="true" /> : null}
                  <span>{storyEditorSaving ? "Salvando..." : "Salvar edição"}</span>
                </button>
              </div>
            </section>
          </div>
        ) : null}
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
        <form onSubmit={applyHistoryBulkEdit} className="history-bulk-shell">
          <div className="history-bulk-top">
            <label className="field-label history-bulk-search-field">
              <span>Buscar postagem</span>
              <div className="history-search-input-row">
                <input
                  type="search"
                  value={historySearchQuery}
                  onChange={(event) => setHistorySearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      setHistoryPage(1);
                    }
                  }}
                  placeholder="Título ou legenda"
                  maxLength={120}
                  disabled={historyBulkApplying}
                />
                <button
                  type="button"
                  className="ghost-button history-search-submit-button"
                  onClick={() => setHistoryPage(1)}
                  disabled={historyBulkApplying}
                >
                  Buscar
                </button>
              </div>
            </label>
            <label className="field-label history-bulk-action-field">
              <span>Ação em massa</span>
              <select
                value={historyBulkAction}
                onChange={(event) => setHistoryBulkAction(event.target.value as HistoryBulkAction)}
                disabled={historyBulkApplying}
              >
                <option value="">Selecione uma ação</option>
                <option value="SET_PUBLISHED">Marcar como Publicado</option>
                <option value="SET_DRAFT">Marcar como Rascunho</option>
                <option value="SET_SCHEDULE">Alterar data e horário</option>
                <option value="SET_COMPANY">Alterar perfil</option>
              </select>
            </label>
          </div>
          {historyBulkAction ? (
            <div className="history-bulk-fields">
              {historyBulkAction === "SET_SCHEDULE" || historyBulkAction === "SET_PUBLISHED" ? (
                <>
                  <label className="field-label">
                    <span>Nova data</span>
                    <input
                      type="date"
                      value={historyBulkDate}
                      onChange={(event) => setHistoryBulkDate(event.target.value)}
                      disabled={historyBulkApplying}
                      required
                    />
                  </label>
                  <label className="field-label">
                    <span>Novo horário</span>
                    <input
                      type="time"
                      value={historyBulkTime}
                      onChange={(event) => setHistoryBulkTime(event.target.value)}
                      disabled={historyBulkApplying}
                      required
                    />
                  </label>
                </>
              ) : null}
              {historyBulkAction === "SET_COMPANY" ? (
                <label className="field-label">
                  <span>Perfil de destino</span>
                  <select
                    value={historyBulkCompanyId}
                    onChange={(event) => setHistoryBulkCompanyId(event.target.value)}
                    disabled={historyBulkApplying}
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
              ) : null}
            </div>
          ) : null}
          <div className="history-bulk-actions">
            {historyBulkAction ? (
              <>
                <div className="history-bulk-actions-spacer" aria-hidden="true" />
                <div className="history-bulk-actions-right">
                  <button
                    type="submit"
                    className="history-bulk-apply-button"
                    disabled={historyBulkApplying || historyBulkSelectedJobIds.length === 0}
                  >
                    {historyBulkApplying ? "Aplicando..." : "Aplicar em selecionados"}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={cancelHistoryBulkAction}
                    disabled={historyBulkApplying}
                  >
                    Cancelar ação
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </form>
        <div className="history-filters-meta">
          <span className="count-pill">{historyFilteredJobs.length} registros</span>
          <span className="count-pill">{`${historyBulkSelectedJobIds.length} selecionado(s)`}</span>
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
            <div key={job.id} className="row-card history-row-card">
              {(() => {
                const storySequenceFailureMeta = parseStorySequenceFailureMeta(job.lastError);
                const canRescheduleFailedInstagramMedia =
                  job.publicationState !== "DRAFT" &&
                  job.status === "FAILED" &&
                  isInstagramPublication(job.publicationType);
                const hasPartialStoryFailure =
                  job.publicationType === "instagram_story" &&
                  storySequenceFailureMeta !== null &&
                  storySequenceFailureMeta.publishedCount > 0 &&
                  storySequenceFailureMeta.publishedCount < storySequenceFailureMeta.total;

                return (
            <>
              <div>
                {historyBulkAction ? (
                  <label className="history-bulk-item-check">
                    <input
                      type="checkbox"
                      checked={historyBulkSelectedJobIdsSet.has(job.id)}
                      onChange={() => toggleHistoryBulkJobSelection(job.id)}
                      disabled={historyBulkApplying}
                    />
                    <span>Selecionar</span>
                  </label>
                ) : null}
                <strong>{resolveJobDisplayTitle(job)}</strong>
                <div className="meta-pill-row">
                  {renderPublicationTypePill(job.publicationType)}
                  <span className="unit-pill">{`Perfil: ${companyNameMap[job.companyId] || "Perfil removido"}`}</span>
                </div>
                {job.locationName ? <span>Localização: {job.locationName}</span> : null}
                <span>{formatJobScheduledAt(job, effectiveUserTimeZone)}</span>
              </div>
              <div className="inline-actions">
                <span className={`status-pill status-${jobStatusTone(job)}`}>{jobStatusDisplayLabel(job)}</span>
                {canToggleJobSchedule(job, isPastScheduledAtForUser) ? (
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
                {canRescheduleFailedInstagramMedia ? (
                  <button
                    type="button"
                    className="activate-button"
                    onClick={() => void rescheduleFailedMedia(job)}
                    disabled={reschedulingFailedMediaJobId === job.id}
                  >
                    {reschedulingFailedMediaJobId === job.id
                      ? "Reagendando..."
                      : hasPartialStoryFailure
                        ? "Reagendar restantes +20 min"
                        : "Reagendar mídia +20 min"}
                  </button>
                ) : null}
                {job.publicationState !== "DRAFT" &&
                !canRescheduleFailedInstagramMedia &&
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
            </>
                );
              })()}
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
              <span>{formatDate(log.createdAt, effectiveUserTimeZone)}</span>
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
            <div key={aviso.id} className={`row-card notice-row ${avisoToneClass(aviso)}`}>
              <div>
                <strong>{aviso.title}</strong>
                <span>{aviso.message}</span>
                <span>{formatDate(aviso.createdAt, effectiveUserTimeZone)}</span>
              </div>
              <div className="inline-actions">
                <span className={`status-pill ${aviso.readAt ? "status-completed" : "status-pending"}`}>
                  {aviso.readAt ? "Lido" : "Não lido"}
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
          <div className="field-shell">
            <div className="field-head-with-action">
              <span>Mensagem do aviso</span>
              {renderQuickEmojiPicker({
                pickerKey: "notice-admin-message",
                disabled: broadcastAvisoSubmitting,
                onPick: appendEmojiToBroadcastAvisoMessage,
                label: "Emojis da mensagem",
                className: "emoji-picker-shell-right",
              })}
            </div>
            <textarea
              value={broadcastAvisoMessage}
              onChange={(event) => setBroadcastAvisoMessage(event.target.value)}
              placeholder="Mensagem para todos os clientes"
              rows={6}
              maxLength={2000}
              required
            />
          </div>
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
        <section className="dashboard-top-grid" aria-hidden="true">
          <div className="stats-grid dashboard-compact-metrics-grid">
            {Array.from({ length: 4 }, (_, index) => (
              <article key={`dashboard-metric-skeleton-${index}`} className="metric-card skeleton-metric-card dashboard-compact-metric-card">
                <span className="skeleton-line skeleton-line-chip" />
                <span className="skeleton-line skeleton-line-metric-value" />
              </article>
            ))}
          </div>

          <section className="panel-card">
            {renderSkeletonSectionHead()}
            <div className="dashboard-upcoming-skeleton-grid">
              {Array.from({ length: 2 }, (_, index) => (
                <article key={`dashboard-upcoming-skeleton-${index}`} className="dashboard-upcoming-card dashboard-upcoming-card-skeleton">
                  <span className="skeleton-line skeleton-line-title" />
                  <div className="meta-pill-row">
                    <span className="skeleton-line skeleton-line-pill" />
                    <span className="skeleton-line skeleton-line-pill skeleton-line-pill-wide" />
                  </div>
                  <span className="skeleton-line skeleton-line-text" />
                  <div className="dashboard-upcoming-card-footer">
                    <span className="skeleton-line skeleton-line-chip" />
                    <span className="skeleton-line skeleton-line-button" />
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>

        <section className="dashboard-analytics-grid" aria-hidden="true">
          <article className="panel-card">
            {renderSkeletonSectionHead(3)}
            <div className="dashboard-chart-skeleton" />
          </article>
          <article className="panel-card">
            {renderSkeletonSectionHead()}
            <div className="dashboard-breakdown-skeleton">
              {Array.from({ length: 4 }, (_, index) => (
                <span key={`dashboard-breakdown-skeleton-${index}`} className="skeleton-line skeleton-line-text-wide" />
              ))}
            </div>
          </article>
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
    return (
      <div className="view-stack skeleton-shell" aria-busy="true">
        <section className="panel-card view-stack">
          {renderSkeletonSectionHead()}
          <div className="table-list" aria-hidden="true">
            <div className="row-card">
              <div className="skeleton-row-main">
                <span className="skeleton-line skeleton-line-title" />
                <div className="meta-pill-row">
                  <span className="skeleton-line skeleton-line-pill" />
                  <span className="skeleton-line skeleton-line-pill" />
                  <span className="skeleton-line skeleton-line-pill skeleton-line-pill-wide" />
                </div>
              </div>
            </div>
            <div className="row-card">
              <div className="skeleton-row-main">
                <span className="skeleton-line skeleton-line-title" />
                <div className="meta-pill-row">
                  <span className="skeleton-line skeleton-line-pill skeleton-line-pill-wide" />
                  <span className="skeleton-line skeleton-line-pill skeleton-line-pill-wide" />
                  <span className="skeleton-line skeleton-line-pill skeleton-line-pill-wide" />
                </div>
              </div>
            </div>
            <div className="row-card">
              <div className="form-stack">
                <span className="skeleton-line skeleton-line-input" />
                <span className="skeleton-line skeleton-line-input" />
                <span className="skeleton-line skeleton-line-input" />
                <span className="skeleton-line skeleton-line-button skeleton-line-button-wide" />
              </div>
            </div>
          </div>
        </section>
      </div>
    );
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
      case "planConfig":
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
      case "planConfig":
        return renderPlanConfig();
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
    return (
      <div className="auth-boot-loading" role="status" aria-live="polite" aria-label="Carregando aplicativo">
        <span className="auth-boot-spinner" aria-hidden="true" />
      </div>
    );
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
        {billingWarningMessage ? (
          <div className="info-banner info-banner-warning">
            <span>{billingWarningMessage}</span>
            {!isRootUser ? (
              <a
                href={`${buildViewHref("plan")}#${BILLING_PLAN_CHECKOUT_ANCHOR_ID}`}
                className="billing-warning-link"
                onClick={navigateToPlanCheckout}
              >
                Ir para pagamento
              </a>
            ) : null}
          </div>
        ) : null}

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

        {isBillingDiscountModalOpen ? (
          <button
            type="button"
            className="connection-create-modal-backdrop"
            aria-label="Fechar descontos por usuário"
            onClick={closeBillingDiscountModal}
          >
            <section
              className="connection-create-modal billing-discount-modal"
              aria-label="Descontos por usuário"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="connection-create-modal-header billing-discount-modal-header">
                <div>
                  <strong>Descontos por usuário</strong>
                </div>
                <button
                  type="button"
                  className="qr-modal-close"
                  aria-label="Fechar"
                  title="Fechar"
                  onClick={closeBillingDiscountModal}
                >
                  <span className="modal-close-icon" aria-hidden="true">
                    ×
                  </span>
                </button>
              </div>

              <div className="billing-discount-modal-grid">
                <section className="billing-discount-list-shell">
                  <label className="field-label">
                    <span>Buscar usuário</span>
                    <input
                      value={billingDiscountSearch}
                      onChange={(event) => {
                        setBillingDiscountSearch(event.target.value);
                        setBillingDiscountPage(1);
                      }}
                      placeholder="Nome ou usuário"
                      maxLength={120}
                    />
                  </label>
                  <small className="field-hint">{`${billingDiscountTotal} usuário(s) encontrado(s)`}</small>
                  <div className="billing-discount-list">
                    {billingDiscountUsersLoading ? (
                      <div className="empty-state">Carregando usuários...</div>
                    ) : billingDiscountUsers.length === 0 ? (
                      <div className="empty-state">Nenhum usuário encontrado.</div>
                    ) : (
                      billingDiscountUsers.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          className={`billing-discount-user-button${selectedBillingDiscountUserId === user.id ? " billing-discount-user-button-active" : ""}`}
                          onClick={() => selectBillingDiscountUser(user)}
                        >
                          <span className="billing-discount-user-name">{user.name}</span>
                          <span className="billing-discount-user-username">{`@${user.username}`}</span>
                        </button>
                      ))
                    )}
                  </div>
                  {renderNumericPagination(
                    "billing-discount-modal",
                    billingDiscountPage,
                    billingDiscountTotalPages,
                    setBillingDiscountPage,
                  )}
                </section>

                <section className="billing-discount-editor-shell">
                  {selectedBillingDiscountUser ? (
                    <form onSubmit={saveBillingDiscountForSelectedUser} className="form-stack">
                      <strong>{`Usuário selecionado: ${selectedBillingDiscountUser.name} (@${selectedBillingDiscountUser.username})`}</strong>
                      <div className="meta-pill-row">
                        <span className="unit-pill">{`Plano: ${selectedBillingDiscountUser.billingPlanName ?? "Sem plano"}`}</span>
                        <span className={`status-pill status-${billingStatusTone(selectedBillingDiscountUser.billingStatus)}`}>
                          {`Status: ${billingStatusDisplayLabel(selectedBillingDiscountUser.billingStatus)}`}
                        </span>
                        {selectedBillingDiscountUser.billingDiscountEnabled &&
                        selectedBillingDiscountUser.billingDiscountPercent > 0 ? (
                          <span className="unit-pill unit-pill-plan">{`Desconto atual: ${selectedBillingDiscountUser.billingDiscountPercent}%`}</span>
                        ) : (
                          <span className="unit-pill">Sem desconto ativo</span>
                        )}
                      </div>
                      <label className="field-label">
                        <span>Desconto ativo</span>
                        <select
                          value={billingDiscountEnabledInput ? "enabled" : "disabled"}
                          onChange={(event) => setBillingDiscountEnabledInput(event.target.value === "enabled")}
                        >
                          <option value="enabled">Ativado</option>
                          <option value="disabled">Desativado</option>
                        </select>
                      </label>
                      <label className="field-label">
                        <span>Percentual de desconto (%)</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={billingDiscountPercentInput}
                          onChange={(event) => setBillingDiscountPercentInput(event.target.value)}
                          disabled={!billingDiscountEnabledInput}
                        />
                      </label>
                      <small className="field-hint">
                        Aplica nas próximas cobranças (assinatura ou PIX avulso) e permanece ativo até você desativar.
                      </small>
                      <button type="submit" disabled={savingBillingDiscountUserId === selectedBillingDiscountUser.id}>
                        {savingBillingDiscountUserId === selectedBillingDiscountUser.id ? "Salvando..." : "Salvar desconto"}
                      </button>
                    </form>
                  ) : (
                    <div className="empty-state">Selecione um usuário na lista para configurar desconto.</div>
                  )}
                </section>
              </div>
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
                    <span>Gerado em {formatDate(activeQrConnection.qrGeneratedAt, effectiveUserTimeZone)}</span>
                  ) : null}
                  {activeQrConnection?.workerLastSeenAt ? (
                    <span>Última atualização em {formatDate(activeQrConnection.workerLastSeenAt, effectiveUserTimeZone)}</span>
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
