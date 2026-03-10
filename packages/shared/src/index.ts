export type JobStatus =
  | "PENDING"
  | "RUNNING"
  | "SENT_UNCONFIRMED"
  | "COMPLETED"
  | "FAILED"
  | "WAITING_LOGIN"
  | "CANCELED";

export type WhatsappMode = "link" | "midia" | "texto";

export type PublicationType =
  | "instagram_story"
  | "instagram_reel"
  | "instagram_post"
  | "whatsapp_status_midia"
  | "whatsapp_status_texto";

export type PublicationState = "PUBLISHED" | "DRAFT";

export interface OrganizationDto {
  id: string;
  name: string;
  createdAt: string;
}

export interface CompanyDto {
  id: string;
  name: string;
  organizationId: string;
  createdAt: string;
}

export interface JobDto {
  id: string;
  companyId: string;
  socialConnectionId: string | null;
  filePath: string;
  filePaths?: string[];
  sequential?: boolean;
  title?: string | null;
  caption: string | null;
  locationName: string | null;
  publicationType: PublicationType;
  publicationState: PublicationState;
  postStory: boolean;
  postReel: boolean;
  postWhatsapp: boolean;
  modoWhatsapp: WhatsappMode;
  dataPostagem: string;
  status: JobStatus;
  tentativas: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
}

export interface AgentLogDto {
  id: string;
  companyId: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  createdAt: string;
}

export interface DashboardDto {
  companyId: string | null;
  totals: Record<JobStatus, number>;
  agentsOnline: number;
  pendingJobs: number;
  failedJobs: number;
  completedJobs: number;
}
