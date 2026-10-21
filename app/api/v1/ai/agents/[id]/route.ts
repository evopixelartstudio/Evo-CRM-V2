import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET    /api/v1/ai/agents/:id — busca detalhes do agente (manager+).
 * PATCH  /api/v1/ai/agents/:id — atualiza agente (manager+ ou admin para mcp_externo).
 * DELETE /api/v1/ai/agents/:id — arquiva agente (admin).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { agentPatchSchema } from "@/lib/ai/guardrails-schema";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });

  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "ai_agents",
    role: "manager",
    scope: "mcp:read",
  });
  if (!authz.ok) return authz.response;
  const { organizationId, supabase } = authz;

  const { data, error } = await supabase
    .from("ai_agents")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) return fail("internal_error", "Erro ao buscar agente.", 500, { requestId });
  if (!data) return fail("not_found", "Agente não encontrado.", 404, { requestId });

  return ok(data, { requestId });
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });

  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "ai_agents",
    role: "manager",
    scope: "mcp:write",
  });
  if (!authz.ok) return authz.response;
  const { organizationId, supabase, actor } = authz;

  const teto = await tetoDeEscritaDoToken(authz, "ai_agents", requestId);
  if (teto) return teto;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "JSON inválido.", 400, { requestId });
  }

  const parsed = agentPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  // Permissão admin para mcp_externo_no_atendimento
  if (parsed.data.config?.mcp_externo_no_atendimento !== undefined) {
    const adminCheck = await resolveAuthDual(req, {
      requestId,
      resource: "ai_agents",
      role: "admin",
      scope: "mcp:write",
    });
    if (!adminCheck.ok) return adminCheck.response;
  }

  // Buscar agente existente para validações de conflito e merge
  const { data: agent, error: fetchErr } = await supabase
    .from("ai_agents")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (fetchErr) return fail("internal_error", "Erro ao buscar agente.", 500, { requestId });
  if (!agent) return fail("not_found", "Agente não encontrado.", 404, { requestId });

  // Recusa editar system_prompt diretamente quando o agente já possui versão publicada
  if (parsed.data.system_prompt !== undefined && agent.published_version_id) {
    return fail(
      "state_conflict",
      "Este agente possui uma versão publicada. Para editar o prompt, crie e publique uma nova versão.",
      409,
      { requestId },
    );
  }

  // Montar payload de atualização
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.operation_mode !== undefined) updateData.operation_mode = parsed.data.operation_mode;
  if (parsed.data.paused_at !== undefined) updateData.paused_at = parsed.data.paused_at;
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.is_active !== undefined) updateData.is_active = parsed.data.is_active;
  if (parsed.data.model !== undefined) updateData.model = parsed.data.model;
  if (parsed.data.system_prompt !== undefined) updateData.system_prompt = parsed.data.system_prompt;
  if (parsed.data.guardrails !== undefined) updateData.guardrails = parsed.data.guardrails;

  if (parsed.data.config !== undefined) {
    const configAtual = (agent.config as Record<string, unknown>) ?? {};
    updateData.config = { ...configAtual, ...parsed.data.config };
  }

  const { data: updated, error: updErr } = await supabase
    .from("ai_agents")
    .update(updateData)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .select("*")
    .single();

  if (updErr) return fail("internal_error", "Erro ao atualizar agente.", 500, { requestId });

  void audit({
    action: "ai_agent.updated",
    actorUserId: actor.type === "user" ? actor.id : null,
    organizationId,
    resourceType: "ai_agent",
    resourceId: id,
    requestId,
    metadata: updateData,
  });

  return ok(updated, { requestId });
}

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });

  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "ai_agents",
    role: "admin",
    scope: "mcp:write",
  });
  if (!authz.ok) return authz.response;
  const { organizationId, supabase, actor } = authz;

  const teto = await tetoDeEscritaDoToken(authz, "ai_agents", requestId);
  if (teto) return teto;

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("ai_agents")
    .update({ archived_at: now })
    .eq("id", id)
    .eq("organization_id", organizationId);

  if (error) return fail("internal_error", "Erro ao arquivar agente.", 500, { requestId });

  void audit({
    action: "ai_agent.archived",
    actorUserId: actor.type === "user" ? actor.id : null,
    organizationId,
    resourceType: "ai_agent",
    resourceId: id,
    requestId,
  });

  return ok({ id, archived: true }, { requestId });
}
