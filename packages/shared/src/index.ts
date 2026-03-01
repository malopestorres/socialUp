export type JobStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "WAITING_LOGIN";

export type WhatsappMode = "link" | "midia" | "texto";

export type PublicationType =
  | "instagram_story"
  | "instagram_reel"
  | "instagram_post"
  | "whatsapp_status_midia"
  | "whatsapp_status_texto";

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

export interface AgentDto {
  id: string;
  name: string;
  companyId: string;
  createdAt: string;
  hasToken: boolean;
  lastSeenAt: string | null;
  activationCode: string | null;
  activationStatus: "PENDING" | "ACTIVE" | "REVOKED";
  deviceName: string | null;
}

export interface JobDto {
  id: string;
  companyId: string;
  filePath: string;
  caption: string | null;
  locationName: string | null;
  publicationType: PublicationType;
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
  agentId: string | null;
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

export interface PairingResponse {
  agentId: string;
  companyId: string;
  agentToken: string;
  agentName: string;
}
