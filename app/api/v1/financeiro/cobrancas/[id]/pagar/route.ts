import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { registrarPagamentoSchema } from "@/lib/financeiro/cobrancas";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<Response> {
  const params = await props.params;
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const parsed = registrarPagamentoSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados de pagamento inválidos.", 422, {
      requestId,
    });
  }

  const { valor_pago_cents, data_pagamento, forma_pagamento, account_id, observacoes } = parsed.data;
  const supabase = await createClient();

  // 1. Obter cobrança
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
  const currentPaid = Number(inv.paid_cents || 0);
  const billedCents = Number(inv.billed_cents || 0);
  const newPaidCents = currentPaid + valor_pago_cents;
  const isFullyPaid = newPaidCents >= billedCents;
  const newStatus = isFullyPaid ? "paid" : "partially_paid";
  const effectivePaidAt = data_pagamento ? new Date(data_pagamento).toISOString() : new Date().toISOString();

  // Histórico de pagamentos registrado no metadata da fatura
  const existingMeta = (inv.metadata as Record<string, unknown>) || {};
  const historicoPagamentos = Array.isArray(existingMeta.pagamentos) ? existingMeta.pagamentos : [];
  const novoPagamentoRegistro = {
    id: randomUUID(),
    valor_cents: valor_pago_cents,
    data_pagamento: effectivePaidAt,
    forma_pagamento,
    registrado_por_user_id: authz.user.id,
    observacoes: observacoes ?? null,
  };

  const updatedMetadata = {
    ...existingMeta,
    pagamentos: [...historicoPagamentos, novoPagamentoRegistro],
  };

  // 2. Atualizar fatura
  const { data: updated, error: updateErr } = await supabase
    .from("financial_invoices" as any)
    .update({
      paid_cents: newPaidCents,
      paid_at: effectivePaidAt,
      payment_method: forma_pagamento,
      status: newStatus,
      metadata: updatedMetadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .eq("organization_id", authz.org.orgId)
    .select()
    .single();

  if (updateErr || !updated) {
    return fail("internal_error", updateErr?.message ?? "Falha ao registrar pagamento.", 500, { requestId });
  }

  // 3. Opcional: registrar lançamento no extrato financeiro (financial_entries)
  const targetAccountId = account_id || inv.account_id;
  if (targetAccountId) {
    await supabase.from("financial_entries").insert({
      organization_id: authz.org.orgId,
      account_id: targetAccountId,
      account_plan_id: inv.account_plan_id ?? null,
      direction: inv.type === "income" ? "in" : "out",
      amount_cents: valor_pago_cents,
      description: `${inv.type === "income" ? "Recebimento" : "Pagamento"}: ${inv.title}`,
      entry_date: (effectivePaidAt.split("T")[0] as string) || (new Date().toISOString().split("T")[0] as string),
      status: "paid",
      paid_at: effectivePaidAt,
      origin: "manual",
      created_by_user_id: authz.user.id,
      contract_id: inv.contract_id ?? null,
      contact_id: inv.contact_id ?? null,
    } as any);
  }

  // 4. Se tiver contato, verificar se ainda há faturas vencidas em atraso
  if (inv.contact_id) {
    const hojeStr = new Date().toISOString().split("T")[0] as string;
    const { data: openOverdue } = await supabase
      .from("financial_invoices" as any)
      .select("id")
      .eq("organization_id", authz.org.orgId)
      .eq("contact_id", inv.contact_id)
      .eq("type", "income")
      .in("status", ["pending", "partially_paid", "overdue"])
      .lt("due_date", hojeStr)
      .limit(1);

    const hasOverdue = (openOverdue && openOverdue.length > 0) ?? false;
    const { data: contact } = await supabase
      .from("contacts")
      .select("custom_fields")
      .eq("id", inv.contact_id)
      .maybeSingle();

    if (contact) {
      const cMeta = (contact.custom_fields as Record<string, unknown>) || {};
      const newFinStatus = hasOverdue ? "inadimplente" : "em_dia";
      if (cMeta.financial_status !== newFinStatus) {
        await supabase
          .from("contacts")
          .update({
            custom_fields: {
              ...cMeta,
              financial_status: newFinStatus,
            },
          })
          .eq("id", inv.contact_id)
          .eq("organization_id", authz.org.orgId);
      }
    }
  }

  await audit({
    action: "financeiro.cobranca_paga",
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    resourceType: "financial_invoice",
    resourceId: params.id,
    requestId,
    metadata: {
      valor_pago_cents,
      forma_pagamento,
      status: newStatus,
      isFullyPaid,
    },
  });

  return ok(updated, { requestId });
}
