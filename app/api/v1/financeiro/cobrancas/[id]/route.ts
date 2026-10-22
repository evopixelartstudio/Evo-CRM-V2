import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const atualizarCobrancaSchema = z.object({
  title: z.string().min(2).max(255).optional(),
  billed_cents: z.number().int().min(1).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["pending", "partially_paid", "paid", "overdue", "cancelled", "reversed"]).optional(),
  payment_method: z.enum(["pix", "credit_card", "debit_card", "bank_slip", "bank_transfer", "cash", "other"]).nullish(),
  notes: z.string().max(2000).nullish(),
});

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<Response> {
  const params = await props.params;
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data: invoice, error } = await supabase
    .from("financial_invoices" as any)
    .select(
      `
      *,
      contact:contacts(id, display_name, email, phone_number),
      contract:financial_contracts(id, service_name, modality)
    `,
    )
    .eq("id", params.id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();

  if (error || !invoice) {
    return fail("not_found", "Cobrança/Conta não encontrada.", 404, { requestId });
  }

  return ok(invoice, { requestId });
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

  const parsed = atualizarCobrancaSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados inválidos.", 422, { requestId });
  }

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("financial_invoices" as any)
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .eq("organization_id", authz.org.orgId)
    .select()
    .single();

  if (error || !updated) {
    return fail("not_found", error?.message ?? "Falha ao atualizar cobrança.", 404, { requestId });
  }

  await audit({
    action: "financeiro.cobranca_atualizada",
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    resourceType: "financial_invoice",
    resourceId: params.id,
    requestId,
    metadata: {
      alteracoes: parsed.data,
    },
  });

  return ok(updated, { requestId });
}
