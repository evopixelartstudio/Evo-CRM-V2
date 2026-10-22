import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { estornarCobrancaSchema } from "@/lib/financeiro/cobrancas";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<Response> {
  const params = await props.params;
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("manager", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const parsed = estornarCobrancaSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Motivo obrigatório para estorno.", 422, {
      requestId,
    });
  }

  const { motivo } = parsed.data;
  const supabase = await createClient();

  const { data: invoice, error: fetchErr } = await supabase
    .from("financial_invoices" as any)
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();

  if (fetchErr || !invoice) {
    return fail("not_found", "Cobrança não encontrada.", 404, { requestId });
  }

  const inv = invoice as any;
  const existingMeta = (inv.metadata as Record<string, unknown>) || {};
  const historicoEstornos = Array.isArray(existingMeta.estornos) ? existingMeta.estornos : [];
  const novoEstorno = {
    id: randomUUID(),
    data: new Date().toISOString(),
    motivo,
    estornado_por_user_id: authz.user.id,
    valor_estornado_cents: inv.paid_cents,
  };

  const updatedMetadata = {
    ...existingMeta,
    estornos: [...historicoEstornos, novoEstorno],
  };

  const { data: updated, error: updateErr } = await supabase
    .from("financial_invoices" as any)
    .update({
      paid_cents: 0,
      paid_at: null,
      status: "reversed",
      metadata: updatedMetadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .eq("organization_id", authz.org.orgId)
    .select()
    .single();

  if (updateErr || !updated) {
    return fail("internal_error", updateErr?.message ?? "Falha ao estornar cobrança.", 500, { requestId });
  }

  await audit({
    action: "financeiro.cobranca_estornada",
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    resourceType: "financial_invoice",
    resourceId: params.id,
    requestId,
    metadata: {
      motivo,
      valor_estornado_cents: inv.paid_cents,
    },
  });

  return ok(updated, { requestId });
}
