/**
 * Serviço de Gerência Técnica e Identidade Operacional do Hermes para o EvoCRM.
 *
 * O Hermes atua como Gerente Técnico da EvoPixel com autonomia operacional
 * ampla sobre contatos, funis, leads, tarefas, observações internas, agentes,
 * automações, relatórios e governança por meio do protocolo MCP.
 */

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/types";

export const HERMES_SERVICE_ACCOUNT_NAME = "Hermes Gerente Técnico EvoPixel";
export const HERMES_ACTOR_TAG = "service_account:hermes";

/**
 * Catálogo canônico de permissões do Hermes separadas por domínio.
 */
export const HERMES_DOMAIN_PERMISSIONS = {
  contacts: [
    "contacts.read",
    "contacts.create",
    "contacts.update",
    "contacts.archive",
    "companies.read",
    "companies.create",
    "companies.update",
    "customers.read",
    "customers.update",
  ],
  leads: [
    "leads.read",
    "leads.create",
    "leads.update",
    "leads.archive",
    "leads.assign",
    "leads.reassign",
    "leads.move_stage",
    "leads.merge",
    "opportunities.read",
    "opportunities.create",
    "opportunities.update",
  ],
  pipelines: [
    "pipelines.read",
    "pipelines.create",
    "pipelines.update",
    "pipelines.archive",
    "stages.read",
    "stages.create",
    "stages.update",
    "stages.reorder",
    "stages.archive",
  ],
  products: [
    "products.read",
    "products.create",
    "products.update",
    "products.archive",
    "prices.read",
    "catalog.read",
  ],
  tasks: [
    "tasks.read",
    "tasks.create",
    "tasks.update",
    "tasks.complete",
    "tasks.cancel",
    "appointments.read",
    "appointments.create",
    "appointments.update",
    "appointments.cancel",
  ],
  notes: [
    "notes.read",
    "notes.create",
    "notes.update",
    "notes.archive",
    "notes.pin",
    "notes.delete",
  ],
  conversations: [
    "conversations.read",
    "conversations.read_history",
    "conversations.assign",
    "conversations.transfer",
    "conversations.tag",
    "conversations.close",
    "conversations.reopen",
  ],
  messages: [
    "messages.read",
    "messages.prepare",
    "messages.send",
  ],
  agents: [
    "agents.read",
    "agents.create",
    "agents.update",
    "agents.archive",
    "agents.assign",
    "agents.configure",
    "agents.test",
    "agents.activate",
    "agents.deactivate",
  ],
  automations: [
    "automations.read",
    "automations.create",
    "automations.update",
    "automations.test",
    "automations.activate",
    "automations.deactivate",
    "automations.archive",
  ],
  reports: [
    "reports.read",
    "dashboards.read",
    "execution_logs.read",
    "audit_logs.read",
    "audit_logs.export",
  ],
  admin: [
    "users.read",
    "roles.read",
    "permissions.read",
    "integrations.read",
    "settings.read",
    "webhooks.read",
    "webhooks.create",
    "webhooks.update",
    "api_keys.read_metadata",
  ],
} as const;

export const ALL_HERMES_PERMISSIONS: readonly string[] = [
  ...HERMES_DOMAIN_PERMISSIONS.contacts,
  ...HERMES_DOMAIN_PERMISSIONS.leads,
  ...HERMES_DOMAIN_PERMISSIONS.pipelines,
  ...HERMES_DOMAIN_PERMISSIONS.products,
  ...HERMES_DOMAIN_PERMISSIONS.tasks,
  ...HERMES_DOMAIN_PERMISSIONS.notes,
  ...HERMES_DOMAIN_PERMISSIONS.conversations,
  ...HERMES_DOMAIN_PERMISSIONS.messages,
  ...HERMES_DOMAIN_PERMISSIONS.agents,
  ...HERMES_DOMAIN_PERMISSIONS.automations,
  ...HERMES_DOMAIN_PERMISSIONS.reports,
  ...HERMES_DOMAIN_PERMISSIONS.admin,
];

/**
 * Escopos completos do token da service account do Hermes, incluindo papéis de sistema.
 */
export const HERMES_FULL_SCOPES: readonly string[] = [
  "role:admin",
  "actor:ai_agent",
  HERMES_ACTOR_TAG,
  "mcp:read",
  "mcp:write",
  ...ALL_HERMES_PERMISSIONS,
];

export function isHermesServiceAccount(scopes: readonly string[] | undefined | null): boolean {
  if (!scopes || !Array.isArray(scopes)) return false;
  return scopes.includes(HERMES_ACTOR_TAG);
}

/**
 * Bloqueio de auto-modificação: o Hermes não pode alterar suas próprias permissões,
 * revogar seu próprio token de operação ou excluir sua service account.
 */
export function assertNotSelfModification(
  targetTokenId: string,
  callerTokenId?: string | null,
  requestId: string = "req-hermes-guard",
): void {
  if (callerTokenId && targetTokenId === callerTokenId) {
    throw new ApiError(
      403,
      "forbidden",
      { targetTokenId, callerTokenId },
      requestId,
      "Operação negada: a conta técnica não tem permissão para alterar, revogar ou excluir suas próprias credenciais.",
    );
  }
}

export interface HermesProvisionResult {
  id: string;
  name: string;
  prefix: string;
  plaintext_token: string;
  scopes: string[];
  expires_at: string | null;
  created_at: string;
}

/**
 * Provisiona ou rotaciona com segurança a credencial da service account do Hermes.
 * O plaintext é retornado apenas no momento da emissão.
 */
export async function provisionHermesServiceAccount(
  supabase: SupabaseClient,
  params: {
    organizationId: string;
    createdByUserId: string;
    expiresInDays?: number;
    replaceExisting?: boolean;
  },
): Promise<HermesProvisionResult> {
  const { organizationId, createdByUserId, expiresInDays = 180, replaceExisting = true } = params;

  if (replaceExisting) {
    // Revogar tokens anteriores do Hermes nesta organização
    const { data: existing } = await supabase
      .from("api_tokens")
      .select("id, scopes")
      .eq("organization_id", organizationId)
      .is("revoked_at", null);

    const hermesTokens = (existing ?? []).filter((t: any) =>
      Array.isArray(t.scopes) && t.scopes.includes(HERMES_ACTOR_TAG),
    );

    if (hermesTokens.length > 0) {
      const now = new Date().toISOString();
      for (const tok of hermesTokens) {
        await supabase
          .from("api_tokens")
          .update({ revoked_at: now, revoked_by: createdByUserId })
          .eq("id", tok.id)
          .eq("organization_id", organizationId);
      }
    }
  }

  const prefix = `dsk_${randomBytes(4).toString("hex")}`;
  const secret = randomBytes(32).toString("base64url");
  const plaintext = `${prefix}_${secret}`;
  const tokenHash = createHash("sha256").update(plaintext).digest();

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const { data: created, error } = await supabase
    .from("api_tokens")
    .insert({
      organization_id: organizationId,
      created_by: createdByUserId,
      name: HERMES_SERVICE_ACCOUNT_NAME,
      prefix,
      token_hash: `\\x${tokenHash.toString("hex")}`,
      scopes: HERMES_FULL_SCOPES as string[],
      expires_at: expiresAt,
    })
    .select("id, name, prefix, scopes, expires_at, created_at")
    .single();

  if (error || !created) {
    throw new Error(`Falha ao provisionar Service Account Hermes: ${error?.message || "Erro desconhecido"}`);
  }

  return {
    id: created.id,
    name: created.name,
    prefix: created.prefix,
    plaintext_token: plaintext,
    scopes: created.scopes,
    expires_at: created.expires_at,
    created_at: created.created_at,
  };
}
