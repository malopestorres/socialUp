ALTER TABLE "Plan"
ADD COLUMN IF NOT EXISTS "maxWhatsappConnections" INTEGER DEFAULT 2,
ADD COLUMN IF NOT EXISTS "supportsWorkspaceInvites" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "supportsClientApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "subtitle" TEXT,
ADD COLUMN IF NOT EXISTS "highlights" JSONB;

UPDATE "Plan"
SET
  "workspaceLimit" = 2,
  "maxProfiles" = 2,
      "maxWhatsappConnections" = 1,
      "supportsWorkspaceInvites" = false,
      "supportsClientApproval" = false,
      "description" = 'Plano individual para operar até 2 workspaces próprios sem recursos colaborativos.',
      "subtitle" = 'Operação solo com até 2 workspaces próprios e rotina sem colaboração externa.',
      "highlights" = '["2 workspaces próprios","12 contas sociais","300 publicações por mês","Sem convites e sem aprovação de cliente"]'::jsonb
WHERE "code" = 'SINGLE';

UPDATE "Plan"
SET
      "maxWhatsappConnections" = 2,
      "supportsWorkspaceInvites" = false,
      "supportsClientApproval" = false,
      "subtitle" = 'Configuração inicial para conhecer o SocialUp com uma operação enxuta.',
      "highlights" = '["1 workspace próprio","2 contas sociais","30 publicações no mês","Sem convites e sem aprovação de cliente"]'::jsonb
WHERE "code" = 'TRIAL';

UPDATE "Plan"
SET
      "maxWhatsappConnections" = NULL,
      "supportsWorkspaceInvites" = true,
      "supportsClientApproval" = true,
      "subtitle" = 'Estrutura para operação com múltiplos workspaces e colaboração com cliente.',
      "highlights" = '["5 workspaces de cliente","5 workspaces bônus","60 contas sociais","Convites e aprovação com cliente"]'::jsonb
WHERE "code" = 'AGENCY';
