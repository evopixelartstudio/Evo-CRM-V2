import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const atualizarContratoSchema = z.object({
  status: z.enum(["draft", "active", "completed", "cancelled", "paused"]).optional(),
  service_name: z.string().min(2).max(255).optional(),
  description: z.string().max(1000).nullish(),
  amount_cents: z.number().int().min(1).optional(),
  due_day: z.number().int().min(1).max(31).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  notes: z.string().max(2000).nullish(),
  responsible_user_id: z.string().uuid().nullish(),
});

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<Response> {
  const params = await props.params;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data: contract, error } = await supabase
    .from("financial_contracts" as any)
    .select(
      `
      *,
      contact:contacts(id, display_name, email, phone_number, custom_fields)
    `,
    )
    .eq("id", params.id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();

  if (error || !contract) {
    return fail("not_found", "Contrato não encontrado.", 404, { requestId });
  }

  // Buscar cobranças associadas
  const { data: invoices } = await supabase
    .from("financial_invoices" as any)
    .select("*")
    .eq("contract_id", params.id)
    .eq("organization_id", authz.org.orgId)
    .order("due_date", { ascending: true });

  return ok({ ...(contract as any), invoices: invoices ?? [] }, { requestId });
}

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<Response> {
  const params = await props.params;
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const parsed = atualizarContratoSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados inválidos.", 422, { requestId });
  }

  const supabase = await createClient();

  const updateData: Record<string, unknown> = {
    ...parsed.data,
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.service_name) {
    updateData.title = parsed.data.service_name;
  }
  if (parsed.data.amount_cents !== undefined) {
    updateData.total_cents = parsed.data.amount_cents;
  }

  const { data: updated, error } = await supabase
    .from("financial_contracts" as any)
    .update(updateData)
    .eq("id", params.id)
    .eq("organization_id", authz.org.orgId)
    .select()
    .single();

  if (error || !updated) {
    return fail("not_found", error?.message ?? "Falha ao atualizar contrato.", 404, { requestId });
  }

  await audit({
    action: "financeiro.contrato_atualizado",
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    resourceType: "financial_contract",
    resourceId: params.id,
    requestId,
    metadata: {
      alteracoes: parsed.data,
    },
  });

  return ok(updated, { requestId });
}
