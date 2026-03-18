--
-- PostgreSQL database dump
--

\restrict Xyq1SB7sR80XiKR5IEptZjj054vtb95nDzcZyrQTb3cOLqcEk3aqbgUHIePn0QA

-- Dumped from database version 18.3 (Postgres.app)
-- Dumped by pg_dump version 18.3 (Postgres.app)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Agent; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."Agent" (
    id text NOT NULL,
    name text NOT NULL,
    "companyId" text NOT NULL,
    token text NOT NULL,
    "activationCode" text,
    "activationStatus" text DEFAULT 'PENDING'::text NOT NULL,
    "activationIssuedAt" timestamp(3) without time zone,
    "activationUsedAt" timestamp(3) without time zone,
    "deviceId" text,
    "deviceName" text,
    "revokedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastSeenAt" timestamp(3) without time zone
);


ALTER TABLE public."Agent" OWNER TO marcustorres;

--
-- Name: AgentLog; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."AgentLog" (
    id text NOT NULL,
    "companyId" text NOT NULL,
    "agentId" text,
    level text NOT NULL,
    "errorCode" text,
    message text NOT NULL,
    "screenshotPath" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."AgentLog" OWNER TO marcustorres;

--
-- Name: AiActionLog; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."AiActionLog" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "threadId" text,
    "actionName" text NOT NULL,
    status text NOT NULL,
    "inputPayload" jsonb,
    "outputPayload" jsonb,
    "errorMessage" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."AiActionLog" OWNER TO marcustorres;

--
-- Name: AiAgentMessage; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."AiAgentMessage" (
    id text NOT NULL,
    "threadId" text NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    "toolName" text,
    "toolPayload" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."AiAgentMessage" OWNER TO marcustorres;

--
-- Name: AiAgentThread; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."AiAgentThread" (
    id text NOT NULL,
    "userId" text NOT NULL,
    title text,
    "lastMessageAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."AiAgentThread" OWNER TO marcustorres;

--
-- Name: AiIncident; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."AiIncident" (
    id text NOT NULL,
    "userId" text,
    "createdByUserId" text,
    severity text DEFAULT 'MEDIUM'::text NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    source text DEFAULT 'BEE_UP'::text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    fingerprint text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."AiIncident" OWNER TO marcustorres;

--
-- Name: AiIncidentEvent; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."AiIncidentEvent" (
    id text NOT NULL,
    "incidentId" text NOT NULL,
    type text NOT NULL,
    message text NOT NULL,
    payload jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."AiIncidentEvent" OWNER TO marcustorres;

--
-- Name: AiKnowledgeChunk; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."AiKnowledgeChunk" (
    id text NOT NULL,
    "documentId" text NOT NULL,
    "chunkIndex" integer NOT NULL,
    content text NOT NULL,
    "contentHash" text NOT NULL,
    embedding jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."AiKnowledgeChunk" OWNER TO marcustorres;

--
-- Name: AiKnowledgeDocument; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."AiKnowledgeDocument" (
    id text NOT NULL,
    title text NOT NULL,
    category text DEFAULT 'GENERAL'::text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    content text NOT NULL,
    tags jsonb,
    "createdByUserId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."AiKnowledgeDocument" OWNER TO marcustorres;

--
-- Name: AiUserAlert; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."AiUserAlert" (
    id text NOT NULL,
    "userId" text NOT NULL,
    kind text DEFAULT 'BEE_UP'::text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    payload jsonb,
    "readAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."AiUserAlert" OWNER TO marcustorres;

--
-- Name: AppSetting; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."AppSetting" (
    key text NOT NULL,
    value text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."AppSetting" OWNER TO marcustorres;

--
-- Name: Company; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."Company" (
    id text NOT NULL,
    name text NOT NULL,
    "createdByUserId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Company" OWNER TO marcustorres;

--
-- Name: Job; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."Job" (
    id text NOT NULL,
    "companyId" text NOT NULL,
    "createdByUserId" text,
    "socialConnectionId" text,
    "filePath" text NOT NULL,
    title text,
    caption text,
    "firstComment" text,
    "locationName" text,
    "whatsappBackgroundColor" text,
    "whatsappRelinkEnabled" boolean DEFAULT false NOT NULL,
    "whatsappRelinkConnectionIds" jsonb,
    "whatsappRelinkDispatchedAt" timestamp(3) without time zone,
    "instagramPermalink" text,
    "publicationType" text DEFAULT 'instagram_reel'::text NOT NULL,
    "postStory" boolean DEFAULT false NOT NULL,
    "postReel" boolean DEFAULT false NOT NULL,
    "postWhatsapp" boolean DEFAULT false NOT NULL,
    "modoWhatsapp" text NOT NULL,
    "dataPostagem" timestamp(3) without time zone NOT NULL,
    "publicationState" text DEFAULT 'PUBLISHED'::text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    tentativas integer DEFAULT 0 NOT NULL,
    "criadoEm" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "startedAt" timestamp(3) without time zone,
    "completedAt" timestamp(3) without time zone,
    "lastError" text
);


ALTER TABLE public."Job" OWNER TO marcustorres;

--
-- Name: Plan; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."Plan" (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    "isActive" boolean DEFAULT true NOT NULL,
    "isTrial" boolean DEFAULT false NOT NULL,
    "maxProfiles" integer NOT NULL,
    "maxConnections" integer NOT NULL,
    "maxMonthlyPublications" integer NOT NULL,
    "monthlyPriceCents" integer,
    "yearlyPriceCents" integer,
    "stripeProductId" text,
    "stripeMonthlyPriceId" text,
    "stripeYearlyPriceId" text,
    "stripePixMonthlyPriceId" text,
    "stripePixYearlyPriceId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Plan" OWNER TO marcustorres;

--
-- Name: SetupInvite; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."SetupInvite" (
    id text NOT NULL,
    "inviteKey" text NOT NULL,
    "usedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."SetupInvite" OWNER TO marcustorres;

--
-- Name: SocialConnection; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."SocialConnection" (
    id text NOT NULL,
    "companyId" text NOT NULL,
    "createdByUserId" text,
    platform text NOT NULL,
    "displayName" text NOT NULL,
    "loginIdentifier" text,
    "secretCipher" text,
    "authStatus" text DEFAULT 'AUTH_REQUIRED'::text NOT NULL,
    "automationMode" text DEFAULT 'VISUAL'::text NOT NULL,
    "authLaunchUrl" text,
    "lastAuthAt" timestamp(3) without time zone,
    "lastSeenAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."SocialConnection" OWNER TO marcustorres;

--
-- Name: User; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."User" (
    id text NOT NULL,
    name text NOT NULL,
    username text NOT NULL,
    "passwordHash" text NOT NULL,
    "timeZone" text DEFAULT 'America/Sao_Paulo'::text NOT NULL,
    role text DEFAULT 'ADMIN'::text NOT NULL,
    "billingDiscountEnabled" boolean DEFAULT false NOT NULL,
    "billingDiscountPercent" integer DEFAULT 0 NOT NULL,
    "sessionToken" text,
    "sessionIssuedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."User" OWNER TO marcustorres;

--
-- Name: UserPlanSubscription; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public."UserPlanSubscription" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "planId" text,
    status text DEFAULT 'PAYMENT_REQUIRED'::text NOT NULL,
    "billingModel" text DEFAULT 'NONE'::text NOT NULL,
    cycle text,
    "startsAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "endsAt" timestamp(3) without time zone,
    "trialEndsAt" timestamp(3) without time zone,
    "blockedReason" text,
    "stripeCustomerId" text,
    "stripeSubscriptionId" text,
    "stripePriceId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."UserPlanSubscription" OWNER TO marcustorres;

--
-- Name: avisos; Type: TABLE; Schema: public; Owner: marcustorres
--

CREATE TABLE public.avisos (
    id text NOT NULL,
    "userId" text NOT NULL,
    "createdByUserId" text,
    kind text DEFAULT 'SYSTEM'::text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    "readAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.avisos OWNER TO marcustorres;

--
-- Data for Name: Agent; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."Agent" (id, name, "companyId", token, "activationCode", "activationStatus", "activationIssuedAt", "activationUsedAt", "deviceId", "deviceName", "revokedAt", "createdAt", "lastSeenAt") FROM stdin;
\.


--
-- Data for Name: AgentLog; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."AgentLog" (id, "companyId", "agentId", level, "errorCode", message, "screenshotPath", "createdAt") FROM stdin;
\.


--
-- Data for Name: AiActionLog; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."AiActionLog" (id, "userId", "threadId", "actionName", status, "inputPayload", "outputPayload", "errorMessage", "createdAt") FROM stdin;
\.


--
-- Data for Name: AiAgentMessage; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."AiAgentMessage" (id, "threadId", role, content, "toolName", "toolPayload", "createdAt") FROM stdin;
\.


--
-- Data for Name: AiAgentThread; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."AiAgentThread" (id, "userId", title, "lastMessageAt", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: AiIncident; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."AiIncident" (id, "userId", "createdByUserId", severity, status, source, title, summary, fingerprint, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: AiIncidentEvent; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."AiIncidentEvent" (id, "incidentId", type, message, payload, "createdAt") FROM stdin;
\.


--
-- Data for Name: AiKnowledgeChunk; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."AiKnowledgeChunk" (id, "documentId", "chunkIndex", content, "contentHash", embedding, "createdAt") FROM stdin;
\.


--
-- Data for Name: AiKnowledgeDocument; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."AiKnowledgeDocument" (id, title, category, status, content, tags, "createdByUserId", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: AiUserAlert; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."AiUserAlert" (id, "userId", kind, title, message, payload, "readAt", "createdAt") FROM stdin;
\.


--
-- Data for Name: AppSetting; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."AppSetting" (key, value, "updatedAt") FROM stdin;
billing.rootDisplayPlanId		2026-03-16 17:48:51.088
billing.autoTrialDays	10	2026-03-16 17:48:51.088
billing.autoTrialEnabled	true	2026-03-16 17:48:51.088
\.


--
-- Data for Name: Company; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."Company" (id, name, "createdByUserId", "createdAt") FROM stdin;
\.


--
-- Data for Name: Job; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."Job" (id, "companyId", "createdByUserId", "socialConnectionId", "filePath", title, caption, "firstComment", "locationName", "whatsappBackgroundColor", "whatsappRelinkEnabled", "whatsappRelinkConnectionIds", "whatsappRelinkDispatchedAt", "instagramPermalink", "publicationType", "postStory", "postReel", "postWhatsapp", "modoWhatsapp", "dataPostagem", "publicationState", status, tentativas, "criadoEm", "startedAt", "completedAt", "lastError") FROM stdin;
\.


--
-- Data for Name: Plan; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."Plan" (id, code, name, description, "isActive", "isTrial", "maxProfiles", "maxConnections", "maxMonthlyPublications", "monthlyPriceCents", "yearlyPriceCents", "stripeProductId", "stripeMonthlyPriceId", "stripeYearlyPriceId", "stripePixMonthlyPriceId", "stripePixYearlyPriceId", "createdAt", "updatedAt") FROM stdin;
cmmth9d4j0000rijgke75w266	FREE_TRIAL	Free Trial	Teste por 10 dias com limites reduzidos.	t	t	1	2	30	\N	\N	\N	\N	\N	\N	\N	2026-03-16 17:48:50.995	2026-03-16 17:48:50.995
cmmthcc5l0003riy62kevj2ar	START	Start	Plano inicial para operação pequena.	t	f	5	15	120	7900	79000	\N	\N	\N	\N	\N	2026-03-16 17:51:09.705	2026-03-16 17:51:09.705
cmmthcc5v0004riy6uw66jss6	BUSINESS	Business	Plano para operação com maior volume.	t	f	10	30	240	24900	249000	\N	\N	\N	\N	\N	2026-03-16 17:51:09.716	2026-03-16 17:51:09.716
\.


--
-- Data for Name: SetupInvite; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."SetupInvite" (id, "inviteKey", "usedAt", "createdAt") FROM stdin;
cmmthcc520001riy6ihx0uzv4	bf3c4fd72f2d4a2533b47e4a76c1d9bf	\N	2026-03-16 17:51:09.687
\.


--
-- Data for Name: SocialConnection; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."SocialConnection" (id, "companyId", "createdByUserId", platform, "displayName", "loginIdentifier", "secretCipher", "authStatus", "automationMode", "authLaunchUrl", "lastAuthAt", "lastSeenAt", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."User" (id, name, username, "passwordHash", "timeZone", role, "billingDiscountEnabled", "billingDiscountPercent", "sessionToken", "sessionIssuedAt", "createdAt") FROM stdin;
cmmthcc350000riy6f3pp5o3c	Root	root	970f041ef8a90120c208b5998dc7dea4:3cb7b0d3b5c2b3196e1d228f46153073567faf78a6a08f9edab682272166df5b9faa7ca45559c558964a51b84fc85b93b18b6e6a46be9d1cee65dd43a60269e7	America/Sao_Paulo	ROOT	f	0	28872b28b02b4330cf6895547275a37d81e457d95851b54a	2026-03-16 17:51:38.244	2026-03-16 17:51:09.617
\.


--
-- Data for Name: UserPlanSubscription; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public."UserPlanSubscription" (id, "userId", "planId", status, "billingModel", cycle, "startsAt", "endsAt", "trialEndsAt", "blockedReason", "stripeCustomerId", "stripeSubscriptionId", "stripePriceId", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: avisos; Type: TABLE DATA; Schema: public; Owner: marcustorres
--

COPY public.avisos (id, "userId", "createdByUserId", kind, title, message, "readAt", "createdAt") FROM stdin;
\.


--
-- Name: AgentLog AgentLog_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AgentLog"
    ADD CONSTRAINT "AgentLog_pkey" PRIMARY KEY (id);


--
-- Name: Agent Agent_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."Agent"
    ADD CONSTRAINT "Agent_pkey" PRIMARY KEY (id);


--
-- Name: AiActionLog AiActionLog_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiActionLog"
    ADD CONSTRAINT "AiActionLog_pkey" PRIMARY KEY (id);


--
-- Name: AiAgentMessage AiAgentMessage_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiAgentMessage"
    ADD CONSTRAINT "AiAgentMessage_pkey" PRIMARY KEY (id);


--
-- Name: AiAgentThread AiAgentThread_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiAgentThread"
    ADD CONSTRAINT "AiAgentThread_pkey" PRIMARY KEY (id);


--
-- Name: AiIncidentEvent AiIncidentEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiIncidentEvent"
    ADD CONSTRAINT "AiIncidentEvent_pkey" PRIMARY KEY (id);


--
-- Name: AiIncident AiIncident_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiIncident"
    ADD CONSTRAINT "AiIncident_pkey" PRIMARY KEY (id);


--
-- Name: AiKnowledgeChunk AiKnowledgeChunk_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiKnowledgeChunk"
    ADD CONSTRAINT "AiKnowledgeChunk_pkey" PRIMARY KEY (id);


--
-- Name: AiKnowledgeDocument AiKnowledgeDocument_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiKnowledgeDocument"
    ADD CONSTRAINT "AiKnowledgeDocument_pkey" PRIMARY KEY (id);


--
-- Name: AiUserAlert AiUserAlert_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiUserAlert"
    ADD CONSTRAINT "AiUserAlert_pkey" PRIMARY KEY (id);


--
-- Name: AppSetting AppSetting_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AppSetting"
    ADD CONSTRAINT "AppSetting_pkey" PRIMARY KEY (key);


--
-- Name: Company Company_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."Company"
    ADD CONSTRAINT "Company_pkey" PRIMARY KEY (id);


--
-- Name: Job Job_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."Job"
    ADD CONSTRAINT "Job_pkey" PRIMARY KEY (id);


--
-- Name: Plan Plan_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."Plan"
    ADD CONSTRAINT "Plan_pkey" PRIMARY KEY (id);


--
-- Name: SetupInvite SetupInvite_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."SetupInvite"
    ADD CONSTRAINT "SetupInvite_pkey" PRIMARY KEY (id);


--
-- Name: SocialConnection SocialConnection_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."SocialConnection"
    ADD CONSTRAINT "SocialConnection_pkey" PRIMARY KEY (id);


--
-- Name: UserPlanSubscription UserPlanSubscription_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."UserPlanSubscription"
    ADD CONSTRAINT "UserPlanSubscription_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: avisos avisos_pkey; Type: CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public.avisos
    ADD CONSTRAINT avisos_pkey PRIMARY KEY (id);


--
-- Name: Agent_activationCode_key; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE UNIQUE INDEX "Agent_activationCode_key" ON public."Agent" USING btree ("activationCode");


--
-- Name: Agent_token_key; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE UNIQUE INDEX "Agent_token_key" ON public."Agent" USING btree (token);


--
-- Name: AiActionLog_threadId_createdAt_idx; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE INDEX "AiActionLog_threadId_createdAt_idx" ON public."AiActionLog" USING btree ("threadId", "createdAt");


--
-- Name: AiActionLog_userId_createdAt_idx; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE INDEX "AiActionLog_userId_createdAt_idx" ON public."AiActionLog" USING btree ("userId", "createdAt");


--
-- Name: AiAgentMessage_threadId_createdAt_idx; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE INDEX "AiAgentMessage_threadId_createdAt_idx" ON public."AiAgentMessage" USING btree ("threadId", "createdAt");


--
-- Name: AiAgentThread_userId_updatedAt_idx; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE INDEX "AiAgentThread_userId_updatedAt_idx" ON public."AiAgentThread" USING btree ("userId", "updatedAt");


--
-- Name: AiIncidentEvent_incidentId_createdAt_idx; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE INDEX "AiIncidentEvent_incidentId_createdAt_idx" ON public."AiIncidentEvent" USING btree ("incidentId", "createdAt");


--
-- Name: AiIncident_status_severity_createdAt_idx; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE INDEX "AiIncident_status_severity_createdAt_idx" ON public."AiIncident" USING btree (status, severity, "createdAt");


--
-- Name: AiIncident_userId_createdAt_idx; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE INDEX "AiIncident_userId_createdAt_idx" ON public."AiIncident" USING btree ("userId", "createdAt");


--
-- Name: AiKnowledgeChunk_documentId_chunkIndex_key; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE UNIQUE INDEX "AiKnowledgeChunk_documentId_chunkIndex_key" ON public."AiKnowledgeChunk" USING btree ("documentId", "chunkIndex");


--
-- Name: AiKnowledgeChunk_documentId_idx; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE INDEX "AiKnowledgeChunk_documentId_idx" ON public."AiKnowledgeChunk" USING btree ("documentId");


--
-- Name: AiKnowledgeDocument_status_category_idx; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE INDEX "AiKnowledgeDocument_status_category_idx" ON public."AiKnowledgeDocument" USING btree (status, category);


--
-- Name: AiUserAlert_userId_createdAt_idx; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE INDEX "AiUserAlert_userId_createdAt_idx" ON public."AiUserAlert" USING btree ("userId", "createdAt");


--
-- Name: AiUserAlert_userId_readAt_idx; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE INDEX "AiUserAlert_userId_readAt_idx" ON public."AiUserAlert" USING btree ("userId", "readAt");


--
-- Name: Plan_code_key; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE UNIQUE INDEX "Plan_code_key" ON public."Plan" USING btree (code);


--
-- Name: SetupInvite_inviteKey_key; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE UNIQUE INDEX "SetupInvite_inviteKey_key" ON public."SetupInvite" USING btree ("inviteKey");


--
-- Name: UserPlanSubscription_status_endsAt_idx; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE INDEX "UserPlanSubscription_status_endsAt_idx" ON public."UserPlanSubscription" USING btree (status, "endsAt");


--
-- Name: UserPlanSubscription_userId_key; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE UNIQUE INDEX "UserPlanSubscription_userId_key" ON public."UserPlanSubscription" USING btree ("userId");


--
-- Name: User_sessionToken_key; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE UNIQUE INDEX "User_sessionToken_key" ON public."User" USING btree ("sessionToken");


--
-- Name: User_username_key; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE UNIQUE INDEX "User_username_key" ON public."User" USING btree (username);


--
-- Name: avisos_userId_createdAt_idx; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE INDEX "avisos_userId_createdAt_idx" ON public.avisos USING btree ("userId", "createdAt");


--
-- Name: avisos_userId_readAt_idx; Type: INDEX; Schema: public; Owner: marcustorres
--

CREATE INDEX "avisos_userId_readAt_idx" ON public.avisos USING btree ("userId", "readAt");


--
-- Name: AgentLog AgentLog_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AgentLog"
    ADD CONSTRAINT "AgentLog_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AgentLog AgentLog_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AgentLog"
    ADD CONSTRAINT "AgentLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public."Company"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Agent Agent_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."Agent"
    ADD CONSTRAINT "Agent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public."Company"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AiActionLog AiActionLog_threadId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiActionLog"
    ADD CONSTRAINT "AiActionLog_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES public."AiAgentThread"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AiActionLog AiActionLog_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiActionLog"
    ADD CONSTRAINT "AiActionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AiAgentMessage AiAgentMessage_threadId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiAgentMessage"
    ADD CONSTRAINT "AiAgentMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES public."AiAgentThread"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AiAgentThread AiAgentThread_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiAgentThread"
    ADD CONSTRAINT "AiAgentThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AiIncidentEvent AiIncidentEvent_incidentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiIncidentEvent"
    ADD CONSTRAINT "AiIncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES public."AiIncident"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AiIncident AiIncident_createdByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiIncident"
    ADD CONSTRAINT "AiIncident_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AiIncident AiIncident_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiIncident"
    ADD CONSTRAINT "AiIncident_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AiKnowledgeChunk AiKnowledgeChunk_documentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiKnowledgeChunk"
    ADD CONSTRAINT "AiKnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES public."AiKnowledgeDocument"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AiKnowledgeDocument AiKnowledgeDocument_createdByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiKnowledgeDocument"
    ADD CONSTRAINT "AiKnowledgeDocument_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AiUserAlert AiUserAlert_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."AiUserAlert"
    ADD CONSTRAINT "AiUserAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Company Company_createdByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."Company"
    ADD CONSTRAINT "Company_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Job Job_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."Job"
    ADD CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public."Company"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Job Job_createdByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."Job"
    ADD CONSTRAINT "Job_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Job Job_socialConnectionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."Job"
    ADD CONSTRAINT "Job_socialConnectionId_fkey" FOREIGN KEY ("socialConnectionId") REFERENCES public."SocialConnection"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SocialConnection SocialConnection_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."SocialConnection"
    ADD CONSTRAINT "SocialConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public."Company"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SocialConnection SocialConnection_createdByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."SocialConnection"
    ADD CONSTRAINT "SocialConnection_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: UserPlanSubscription UserPlanSubscription_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."UserPlanSubscription"
    ADD CONSTRAINT "UserPlanSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES public."Plan"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: UserPlanSubscription UserPlanSubscription_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public."UserPlanSubscription"
    ADD CONSTRAINT "UserPlanSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: avisos avisos_createdByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public.avisos
    ADD CONSTRAINT "avisos_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: avisos avisos_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: marcustorres
--

ALTER TABLE ONLY public.avisos
    ADD CONSTRAINT "avisos_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict Xyq1SB7sR80XiKR5IEptZjj054vtb95nDzcZyrQTb3cOLqcEk3aqbgUHIePn0QA

