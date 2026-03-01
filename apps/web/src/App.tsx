import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { FiAlertCircle, FiCheckCircle, FiClock, FiWifi } from "react-icons/fi";
import { api } from "./api";

type ViewKey =
  | "dashboard"
  | "profile"
  | "organizations"
  | "companies"
  | "agents"
  | "scheduler"
  | "media"
  | "history"
  | "logs";

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

type Agent = {
  id: string;
  name: string;
  companyId: string;
  createdAt: string;
  hasToken: boolean;
  lastSeenAt: string | null;
  activationCode: string | null;
  activationStatus: "PENDING" | "ACTIVE" | "REVOKED";
  deviceName: string | null;
};

type Job = {
  id: string;
  companyId: string;
  filePath: string;
  caption: string | null;
  locationName: string | null;
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

type Log = {
  id: string;
  companyId: string;
  agentId: string | null;
  level: string;
  message: string;
  createdAt: string;
};

type Dashboard = {
  companyId: string | null;
  totals: Record<string, number>;
  agentsOnline: number;
  pendingJobs: number;
  failedJobs: number;
  completedJobs: number;
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

type AuthUser = {
  id: string;
  name: string;
  username: string;
  role: string;
};

const initialDashboard: Dashboard = {
  companyId: null,
  totals: {},
  agentsOnline: 0,
  pendingJobs: 0,
  failedJobs: 0,
  completedJobs: 0,
};

const navItems: Array<{ key: ViewKey; label: string; eyebrow?: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "scheduler", label: "Agendar" },
  { key: "media", label: "Midias" },
  { key: "history", label: "Histórico" },
  { key: "logs", label: "Logs" },
  { key: "agents", label: "Agentes" },
  { key: "organizations", label: "Empresa" },
  { key: "companies", label: "Unidades" },
];

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

function toDateTimeLocal(value: string): string {
  const date = new Date(value);
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function isVideoPath(filePath: string): boolean {
  return /\.(mp4|mov|webm|m4v)$/i.test(filePath);
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
    case "COMPLETED":
      return "Concluído";
    case "FAILED":
      return "Falhou";
    case "WAITING_LOGIN":
      return "Aguardando login";
    default:
      return status;
  }
}

function isInstagramPublication(publicationType: Job["publicationType"]): boolean {
  return (
    publicationType === "instagram_post" ||
    publicationType === "instagram_reel" ||
    publicationType === "instagram_story"
  );
}

function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [setupKey, setSetupKey] = useState(() => new URLSearchParams(window.location.search).get("setupKey") ?? "");
  const [setupInviteValid, setSetupInviteValid] = useState(false);
  const [setupName, setSetupName] = useState("");
  const [setupUsername, setSetupUsername] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard>(initialDashboard);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [organizationName, setOrganizationName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyOrganizationId, setCompanyOrganizationId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentCompanyId, setAgentCompanyId] = useState("");
  const [pairingTokens, setPairingTokens] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadedFilePath, setUploadedFilePath] = useState("");
  const [jobCompanyId, setJobCompanyId] = useState("");
  const [caption, setCaption] = useState("");
  const [locationName, setLocationName] = useState("");
  const [publicationType, setPublicationType] = useState<Job["publicationType"]>("instagram_reel");
  const [dataPostagem, setDataPostagem] = useState("");
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [schedulerInfo, setSchedulerInfo] = useState("");
  const [submittingJob, setSubmittingJob] = useState(false);
  const requiresMediaUpload = publicationType !== "whatsapp_status_texto";
  const requiresInstagramMetadata = isInstagramPublication(publicationType);
  const captionLabel = publicationType === "whatsapp_status_texto" ? "Texto do status (aceita emojis)" : "Legenda da postagem";
  const captionPlaceholder =
    publicationType === "whatsapp_status_texto"
      ? "Digite o texto do status do WhatsApp. Emojis sao aceitos normalmente."
      : "Legenda da postagem";
  const captionTitle =
    publicationType === "whatsapp_status_texto"
      ? "Digite o texto do status do WhatsApp. Este campo aceita emojis e e obrigatório nesse tipo de publicação."
      : "Preencha a legenda da postagem. Para Instagram e WhatsApp Status em texto, este campo é obrigatório.";

  const companyNameMap = useMemo(
    () => Object.fromEntries(companies.map((company) => [company.id, company.name])),
    [companies],
  );

  const filteredJobs = useMemo(
    () => jobs.filter((job) => (selectedCompanyId ? job.companyId === selectedCompanyId : true)),
    [jobs, selectedCompanyId],
  );

  const filteredLogs = useMemo(
    () => logs.filter((log) => (selectedCompanyId ? log.companyId === selectedCompanyId : true)),
    [logs, selectedCompanyId],
  );

  const filteredAgents = useMemo(
    () => agents.filter((agent) => (selectedCompanyId ? agent.companyId === selectedCompanyId : true)),
    [agents, selectedCompanyId],
  );

  const mediaLibrary = useMemo(() => {
    const map = new Map<string, MediaEntry>();

    for (const job of filteredJobs) {
      if (!job.filePath) {
        continue;
      }

      const existing = map.get(job.filePath);
      if (!existing) {
        map.set(job.filePath, {
          filePath: job.filePath,
          companyId: job.companyId,
          previewUrl: `${api.baseUrl}${job.filePath}`,
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

    return Array.from(map.values()).sort(
      (left, right) => new Date(right.lastUsedAt).getTime() - new Date(left.lastUsedAt).getTime(),
    );
  }, [filteredJobs]);

  const recentJobs = useMemo(() => filteredJobs.slice().sort((a, b) => new Date(b.dataPostagem).getTime() - new Date(a.dataPostagem).getTime()).slice(0, 5), [filteredJobs]);
  const upcomingJobs = useMemo(() => filteredJobs.slice().sort((a, b) => new Date(a.dataPostagem).getTime() - new Date(b.dataPostagem).getTime()).slice(0, 5), [filteredJobs]);

  async function loadAll(): Promise<void> {
    try {
      const companyFilter = selectedCompanyId ? `?companyId=${selectedCompanyId}` : "";
      const [organizationsData, companiesData, agentsData, jobsData, logsData, dashboardData] =
        await Promise.all([
          api.get<Organization[]>("/organizations"),
          api.get<Company[]>("/companies"),
          api.get<Agent[]>(`/agents${companyFilter}`),
          api.get<Job[]>(`/jobs${companyFilter}`),
          api.get<Log[]>(`/logs${companyFilter}`),
          api.get<Dashboard>(`/dashboard${companyFilter}`),
        ]);

      setOrganizations(organizationsData);
      setCompanies(companiesData);
      setAgents(agentsData);
      setJobs(jobsData);
      setLogs(logsData);
      setDashboard(dashboardData);

      const firstCompany = companiesData[0];
      if (firstCompany) {
        setCompanyOrganizationId((current) => current || firstCompany.organizationId);
        setAgentCompanyId((current) => current || firstCompany.id);
        setJobCompanyId((current) => current || firstCompany.id);
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
      return;
    }

    void loadAll();
  }, [selectedCompanyId, authUser]);

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

  async function createAgent(event: FormEvent) {
    event.preventDefault();
    const result = await api.postJson<{ activationCode: string; id: string }>("/agents", {
      name: agentName,
      companyId: agentCompanyId,
    });
    setPairingTokens((current) => ({ ...current, [result.id]: result.activationCode }));
    setAgentName("");
    await loadAll();
  }

  async function copyBackendUrl() {
    await navigator.clipboard.writeText(api.baseUrl);
  }

  async function revokeAgentAccess(agentId: string) {
    const result = await api.postJson<{ revoked: true; activationCode: string }>(`/agents/${agentId}/revoke-access`, {});
    setPairingTokens((current) => ({ ...current, [agentId]: result.activationCode }));
    await loadAll();
  }

  async function deleteAgent(agentId: string) {
    await api.delete(`/agents/${agentId}`);
    setPairingTokens((current) => {
      const next = { ...current };
      delete next[agentId];
      return next;
    });
    await loadAll();
  }

  async function uploadMedia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setUploading(true);
    try {
      const result = await api.postFile("/upload", file);
      setUploadedFilePath(result.filePath);
      setError("");
      setSchedulerInfo("Midia enviada com sucesso.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Falha no upload.");
    } finally {
      setUploading(false);
    }
  }

  async function createJob(event: FormEvent) {
    event.preventDefault();
    setSubmittingJob(true);
    setError("");
    setSchedulerInfo(editingJobId ? "Salvando alterações..." : "Agendando postagem...");

    const payload = {
      companyId: jobCompanyId,
      filePath: uploadedFilePath,
      caption,
      locationName: requiresInstagramMetadata ? locationName : "",
      publicationType,
      dataPostagem: new Date(dataPostagem).toISOString(),
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
    } catch (jobError) {
      setError(jobError instanceof Error ? jobError.message : "Falha ao agendar postagem.");
      setSchedulerInfo("");
    } finally {
      setSubmittingJob(false);
    }
  }

  function resetSchedulerForm() {
    setCaption("");
    setLocationName("");
    setUploadedFilePath("");
    setDataPostagem("");
    setPublicationType("instagram_reel");
    setEditingJobId(null);
  }

  function startEditJob(job: Job) {
    setSchedulerInfo("");
    setEditingJobId(job.id);
    setJobCompanyId(job.companyId);
    setUploadedFilePath(job.filePath);
    setCaption(job.caption ?? "");
    setLocationName(job.locationName ?? "");
    setPublicationType(job.publicationType);
    setDataPostagem(toDateTimeLocal(job.dataPostagem));
    setActiveView("scheduler");
  }

  async function deleteJob(jobId: string) {
    await api.delete(`/jobs/${jobId}`);
    if (editingJobId === jobId) {
      resetSchedulerForm();
    }
    await loadAll();
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setAuthError("");

    try {
      const result = await api.postJson<{ sessionToken: string; user: AuthUser }>("/auth/login", {
        username: loginUsername,
        password: loginPassword,
      });

      api.setSessionToken(result.sessionToken);
      setAuthUser(result.user);
      setLoginPassword("");
      setAuthInfo("");
    } catch (loginError) {
      setAuthError(loginError instanceof Error ? loginError.message : "Falha ao fazer login.");
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
    setUploadedFilePath(media.filePath);
    setJobCompanyId(media.companyId);
    if (media.caption) {
      setCaption(media.caption);
    }
    if (media.companyId !== jobCompanyId) {
      setLocationName("");
    }
    setActiveView("scheduler");
  }

  function appendEmojiToCaption(emoji: string) {
    setCaption((current) => `${current}${emoji}`);
  }

  function renderAuthScreen() {
    const showSetup = Boolean(setupKey) && setupInviteValid;

    return (
      <div className="auth-shell">
        <div className="auth-logo">
          <div className="brand-mark">S</div>
          <span className="section-kicker auth-kicker">acesso seguro</span>
          <strong className="auth-wordmark">SocialUp</strong>
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
              {authInfo ? <div className="info-banner">{authInfo}</div> : null}

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
            {authInfo ? <div className="info-banner">{authInfo}</div> : null}

            <form onSubmit={login} className="form-stack">
              <input
                value={loginUsername}
                onChange={(event) => setLoginUsername(event.target.value)}
                placeholder="Usuário"
                required
                minLength={3}
                maxLength={32}
                title="Informe seu usuário."
              />
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="Senha"
                required
                minLength={8}
                maxLength={128}
                title="Informe sua senha."
              />
              <button type="submit">Entrar</button>
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
                <FiWifi />
              </span>
              Agentes online
            </span>
            <strong>{dashboard.agentsOnline}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">
              <span className="metric-icon" aria-hidden="true">
                <FiClock />
              </span>
              Pendentes
            </span>
            <strong>{dashboard.pendingJobs}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">
              <span className="metric-icon" aria-hidden="true">
                <FiCheckCircle />
              </span>
              Concluidos
            </span>
            <strong>{dashboard.completedJobs}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">
              <span className="metric-icon" aria-hidden="true">
                <FiAlertCircle />
              </span>
              Falhados
            </span>
            <strong>{dashboard.failedJobs}</strong>
          </article>
        </section>

        <section className="content-grid">
          <article className="panel-card full-width-panel">
            <div className="section-head">
              <div>
                <span className="section-kicker">overview</span>
                <h2>Próximos Agendamentos</h2>
              </div>
              <button type="button" className="ghost-button" onClick={() => setActiveView("scheduler")}>
                Ir para agenda
              </button>
            </div>
            <div className="table-list">
              {upcomingJobs.length === 0 ? (
                <div className="empty-state">Nenhuma postagem agendada nesse filtro.</div>
              ) : (
                upcomingJobs.map((job) => (
                  <div key={job.id} className="row-card">
                    <div>
                      <strong>{job.caption || "Midia sem titulo"}</strong>
                      <span className="publication-pill">{publicationTypeLabel(job.publicationType)}</span>
                      <span className="unit-pill">
                        {`Unidade: ${companyNameMap[job.companyId] || "Unidade removida"}`}
                      </span>
                    </div>
                    <div>
                      <span>{formatDate(job.dataPostagem)}</span>
                      <span className={`status-pill status-${job.status.toLowerCase()}`}>{jobStatusLabel(job.status)}</span>
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
          <option value="">Todas as unidades</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
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
            <h2>Agentes</h2>
          </div>
          {renderCompanyFilter("Filtrar unidade")}
        </div>
        <form onSubmit={createAgent} className="form-grid form-grid-two">
          <input
            value={agentName}
            onChange={(event) => setAgentName(event.target.value)}
            placeholder="Nome do Agente"
            required
            minLength={2}
            maxLength={80}
            title="Informe o nome do agente com 2 a 80 caracteres."
          />
          <select value={agentCompanyId} onChange={(event) => setAgentCompanyId(event.target.value)} required>
            <option value="">Selecione a unidade</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
          <button type="submit">Criar Agente</button>
        </form>
        <div className="row-card">
          <div>
            <strong>URL de conexão do desktop</strong>
            <span>Use esta URL no app desktop para consumir o backend.</span>
            <code className="agent-key">{api.baseUrl}</code>
          </div>
          <div className="inline-actions">
            <button type="button" className="ghost-button" onClick={() => void copyBackendUrl()}>
              Copiar URL
            </button>
          </div>
        </div>
        <div className="table-list">
          {filteredAgents.map((agent) => (
            <div key={agent.id} className="row-card">
              <div className="agent-meta">
                <strong>{agent.name}</strong>
                <span>
                  {agent.activationStatus === "ACTIVE"
                    ? "Dispositivo ativo"
                    : agent.activationStatus === "REVOKED"
                      ? "Acesso revogado"
                      : "Aguardando ativacao"}
                </span>
                <span>{agent.deviceName ? `Dispositivo: ${agent.deviceName}` : "Nenhum dispositivo vinculado"}</span>
                <span>{agent.lastSeenAt ? `Online em ${formatDate(agent.lastSeenAt)}` : "Nunca visto"}</span>
                <code className="agent-key">{pairingTokens[agent.id] ?? agent.activationCode ?? "Chave nao exibida nesta sessao"}</code>
              </div>
              <div className="inline-actions">
                {agent.activationStatus === "ACTIVE" ? (
                  <button type="button" className="ghost-button" onClick={() => revokeAgentAccess(agent.id)}>
                    Revogar acesso
                  </button>
                ) : null}
                <button type="button" className="danger-button" onClick={() => deleteAgent(agent.id)}>
                  Excluir Agente
                </button>
              </div>
            </div>
          ))}
          {filteredAgents.length === 0 ? <div className="empty-state">Nenhum agente para este filtro.</div> : null}
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
            {renderCompanyFilter("Filtrar unidade")}
            {editingJobId ? (
              <button type="button" className="ghost-button" onClick={resetSchedulerForm}>
                Cancelar edicao
              </button>
            ) : null}
          </div>
        </div>
        {schedulerInfo ? <div className="info-banner">{schedulerInfo}</div> : null}
        <form onSubmit={createJob} className="form-stack">
          <div className="form-grid form-grid-two">
            <select value={jobCompanyId} onChange={(event) => setJobCompanyId(event.target.value)} required>
            <option value="">Selecione a unidade</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            <input
              type="datetime-local"
              value={dataPostagem}
              onChange={(event) => setDataPostagem(event.target.value)}
              required
              title="Selecione a data e a hora em que a postagem deve ser executada."
            />
          </div>

          <label className="upload-shell">
            <span>Upload de midia</span>
            <input
              type="file"
              onChange={uploadMedia}
              accept="image/*,video/*"
              disabled={submittingJob}
              required={requiresMediaUpload && !uploadedFilePath}
              title="Selecione um arquivo de imagem ou vídeo para a postagem."
            />
            <small>
              {requiresMediaUpload
                ? uploading
                  ? "Enviando..."
                  : uploadedFilePath || "Nenhuma midia selecionada"
                : "Nao obrigatorio para status de texto"}
            </small>
          </label>

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

          {caption.trim().length > 0 || publicationType === "whatsapp_status_midia" || publicationType === "whatsapp_status_texto" || requiresInstagramMetadata ? (
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

          <input
            value={locationName}
            onChange={(event) => setLocationName(event.target.value)}
            disabled={!requiresInstagramMetadata || submittingJob}
            placeholder="Localização"
            maxLength={120}
            required={requiresInstagramMetadata}
            title="Preencha a localização da postagem. Para Instagram, este campo é obrigatório."
          />

          <select
            value={publicationType}
            onChange={(event) => setPublicationType(event.target.value as Job["publicationType"])}
            disabled={submittingJob}
          >
            <option value="instagram_reel">Instagram Reel</option>
            <option value="instagram_post">Instagram Post</option>
            <option value="instagram_story">Instagram Story</option>
            <option value="whatsapp_status_midia">WhatsApp Status (midia)</option>
            <option value="whatsapp_status_texto">WhatsApp Status (texto)</option>
          </select>

          <button type="submit" disabled={submittingJob || (requiresMediaUpload && !uploadedFilePath)}>
            {submittingJob
              ? editingJobId
                ? "Salvando..."
                : "Agendando..."
              : editingJobId
                ? "Salvar alteracoes"
                : "Agendar Postagem"}
          </button>
        </form>
      </section>
    );
  }

  function renderMedia() {
    return (
      <section className="panel-card view-stack">
        <div className="section-head">
              <div>
                <span className="section-kicker">Biblioteca</span>
                <h2>Mídias por unidade</h2>
              </div>
          <div className="inline-actions">
            {renderCompanyFilter("Filtrar unidade")}
            <span className="count-pill">{mediaLibrary.length} itens</span>
          </div>
        </div>
        <div className="media-grid">
          {mediaLibrary.map((media) => (
            <article key={media.filePath} className="media-card">
              <div className="media-preview">
                {isVideoPath(media.filePath) ? (
                  <video src={media.previewUrl} muted playsInline />
                ) : (
                  <img src={media.previewUrl} alt={media.caption || "Midia"} />
                )}
              </div>
              <div className="media-meta">
                <strong>{media.caption || "Midia sem titulo"}</strong>
                <span className="publication-pill">{publicationTypeLabel(media.publicationType)}</span>
                <span className="unit-pill">{`Unidade: ${companyNameMap[media.companyId] || "Unidade removida"}`}</span>
                <span>Ultimo uso: {formatDate(media.lastUsedAt)}</span>
                <span>Usada {media.usageCount}x</span>
                <span className={`status-pill status-${media.lastStatus.toLowerCase()}`}>
                  {jobStatusLabel(media.lastStatus)}
                </span>
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
          ))}
          {mediaLibrary.length === 0 ? <div className="empty-state">Nenhuma midia encontrada neste filtro.</div> : null}
        </div>
      </section>
    );
  }

  function renderHistory() {
    return (
      <section className="panel-card view-stack">
        <div className="section-head">
          <div>
            <span className="section-kicker">timeline</span>
            <h2>Histórico de postagens</h2>
          </div>
          <div className="inline-actions">
            {renderCompanyFilter("Filtrar unidade")}
            <span className="count-pill">{filteredJobs.length} registros</span>
          </div>
        </div>
        <div className="table-list">
          {filteredJobs.map((job) => (
            <div key={job.id} className="row-card">
              <div>
                <strong>{job.caption || "Midia sem titulo"}</strong>
                <span className="publication-pill">{publicationTypeLabel(job.publicationType)}</span>
                <span className="unit-pill">{`Unidade: ${companyNameMap[job.companyId] || "Unidade removida"}`}</span>
                {job.locationName ? <span>Localização: {job.locationName}</span> : null}
                <span>{formatDate(job.dataPostagem)}</span>
                <span>{job.lastError ?? "Sem erro"}</span>
              </div>
              <div className="inline-actions">
                <span className={`status-pill status-${job.status.toLowerCase()}`}>{jobStatusLabel(job.status)}</span>
                {job.filePath ? (
                  <a href={`${api.baseUrl}${job.filePath}`} target="_blank" rel="noreferrer" className="link-chip">
                    Midia
                  </a>
                ) : (
                  <span className="text-chip">Sem midia</span>
                )}
                <button type="button" className="ghost-button" onClick={() => startEditJob(job)}>
                  Editar
                </button>
                <button type="button" className="danger-button" onClick={() => deleteJob(job.id)}>
                  Excluir
                </button>
              </div>
            </div>
          ))}
          {filteredJobs.length === 0 ? <div className="empty-state">Nenhum job encontrado neste filtro.</div> : null}
        </div>
      </section>
    );
  }

  function renderLogs() {
    return (
      <section className="panel-card view-stack">
        <div className="section-head">
          <div>
            <span className="section-kicker">debug</span>
            <h2>Logs por unidade</h2>
          </div>
          <div className="inline-actions">
            {renderCompanyFilter("Filtrar unidade")}
            <span className="count-pill">{filteredLogs.length} eventos</span>
          </div>
        </div>
        <div className="table-list">
          {filteredLogs.map((log) => (
            <div key={log.id} className="row-card">
              <div>
                <strong>{log.level}</strong>
                <span>{log.message}</span>
              </div>
              <span>{formatDate(log.createdAt)}</span>
            </div>
          ))}
          {filteredLogs.length === 0 ? <div className="empty-state">Nenhum log para esta unidade.</div> : null}
        </div>
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
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">S</div>
          <div>
            <span className="section-kicker">local suite</span>
            <strong>SocialUp</strong>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map((item, index) => (
            <button
              key={item.key}
              type="button"
              className={`nav-item ${activeView === item.key ? "nav-item-active" : ""}`}
              onClick={() => setActiveView(item.key)}
            >
              {item.eyebrow ? <span className="nav-eyebrow">{item.eyebrow}</span> : null}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div>
            <span className="section-kicker">dashboard</span>
            <h2>{activeView === "profile" ? "Perfil" : navItems.find((item) => item.key === activeView)?.label}</h2>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className={`profile-trigger ${activeView === "profile" ? "profile-trigger-active" : ""}`}
              onClick={() => setActiveView("profile")}
            >
              <span className="profile-icon" aria-hidden="true" />
              <span className="profile-trigger-label">Perfil</span>
            </button>
            <div className="status-box">
              <span>Unidades</span>
              <strong>{companies.length}</strong>
            </div>
            <div className="status-box">
              <span>Midias</span>
              <strong>{mediaLibrary.length}</strong>
            </div>
            <button type="button" className="danger-button" onClick={() => void logout()}>
              Sair
            </button>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        {renderContent()}

        {activeView !== "scheduler" ? (
          <section className="panel-card quick-scheduler">
            <div className="section-head">
              <div>
                <span className="section-kicker">Ação rápida</span>
                <h2>Atalho rápido para agendar</h2>
              </div>
              <button type="button" className="danger-button" onClick={() => setActiveView("scheduler")}>
                Abrir agenda completa
              </button>
            </div>
            <div className="quick-summary">
              <span>{uploadedFilePath ? "Midia pronta para reutilizacao" : "Selecione uma midia na biblioteca para reutilizar."}</span>
              {recentJobs.length > 0 ? <span>{`Ultimo item: ${recentJobs[0].caption || recentJobs[0].id}`}</span> : null}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

export default App;
