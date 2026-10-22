/**
 * POST /api/v1/leads/[id]/reactivate
 *
 * Reativa uma oportunidade arquivada/encerrada de volta para uma etapa ativa do funil.
 * Restaura o status para 'open', limpa motivo e data de fechamento, e registra atividade e audit.
 */

import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { validateRequest } from "@/lib/schemas";
import { audit } from "@/lib/audit";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const reactivateLeadSchema = z.object({
  stage_id: z.string().uuid("stage_id deve ser um UUID válido"),
  notes: z.string().max(2000).optional().nullable(),
});

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const input = await validateRequest(reactivateLeadSchema, req);
  const supabase = await createClient();

  // 1. Carregar lead
  const { data: lead, error: leadErr } = await supabase
    .from("crm_leads")
    .select("*")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (leadErr) return fail("internal_error", leadErr.message, 500, { requestId });
  if (!lead) return fail("not_found", "Lead não encontrado.", 404, { requestId });

  // 2. Validar etapa de destino
  const { data: stage, error: stageErr } = await supabase
    .from("crm_stages")
    .select("id, name, pipeline_id, is_won, is_lost, is_archived")
    .eq("id", input.stage_id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (stageErr) return fail("internal_error", stageErr.message, 500, { requestId });
  if (!stage) return fail("not_found", "Etapa de destino não encontrada.", 404, { requestId });

  if (stage.pipeline_id !== lead.pipeline_id) {
    return fail("validation_error", "A etapa deve pertencer ao mesmo funil da oportunidade.", 422, { requestId });
  }

  if (stage.is_won || stage.is_lost || stage.is_archived) {
    return fail("validation_error", "A etapa de reativação deve ser uma etapa ativa do funil.", 422, { requestId });
  }

  // 3. Posição no estágio
  const { data: maxRow } = await supabase
    .from("crm_leads")
    .select("position_in_stage")
    .eq("stage_id", input.stage_id)
    .eq("organization_id", orgId)
    .order("position_in_stage", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPos = (maxRow?.position_in_stage ? Number(maxRow.position_in_stage) : 0) + 1000;
  const now = new Date().toISOString();

  // 4. Atualizar lead para reativado
  const cf = (lead.custom_fields as Record<string, unknown> | null) ?? {};
  const patch: Record<string, unknown> = {
    stage_id: input.stage_id,
    status: "open",
    position_in_stage: nextPos,
    closed_at: null,
    lost_reason: null,
    won_reason: null,
    lost_from_stage_id: null,
    updated_at: now,
    stage_changed_at: now,
    custom_fields: {
      ...cf,
      last_reactivated_at: now,
      last_reactivated_by: authz.user.id,
      ...(input.notes?.trim() ? { reactivation_notes: input.notes.trim() } : {}),
    },
  };

  const { data: updated, error: updErr } = await supabase
    .from("crm_leads")
    .update(patch)
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .select("*")
    .single();

  if (updErr) return fail("internal_error", updErr.message, 500, { requestId });

  // 5. Linha na timeline de atividades
  await emitLeadActivity(supabase, {
    organizationId: orgId,
    leadId,
    contactId: lead.contact_id ?? null,
    type: "lead_reactivated",
    sourceModule: "crm",
    sourceId: leadId,
    actor: { type: "user", id: authz.user.id },
    reason: `Reativado para a etapa “${stage.name}”`,
    payload: {
      desfecho: "reactivated",
      to_stage_id: stage.id,
      to_stage_name: stage.name,
      notes: input.notes ?? null,
    },
  });

  // 6. Registro formal em crm_lead_reactivations
  try {
    await supabase.from("crm_lead_reactivations").insert({
      organization_id: orgId,
      lead_id: leadId,
      status: "decided",
      draft: input.notes ?? `Reativado para a etapa ${stage.name}`,
      decided_at: now,
      decided_by_user_id: authz.user.id,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
  } catch (err) {
    console.warn("[reactivate] crm_lead_reactivations warning:", err);
  }

  // 7. Audit log
  await audit({
    action: "lead.updated",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "crm_lead",
    resourceId: leadId,
    requestId,
    metadata: {
      reactivated: true,
      to_stage_id: stage.id,
      notes: input.notes ?? null,
    },
  });

  return ok(updated, { requestId });
}
