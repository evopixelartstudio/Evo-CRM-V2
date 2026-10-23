import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { registrarPagamentoContratoSchema } from "@/lib/financeiro/contratos";

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

  const parsed = registrarPagamentoContratoSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados de pagamento inválidos.", 422, {
      requestId,
    });
  }

  const { valor_pago_cents, data_pagamento, forma_pagamento, account_id, observacoes } = parsed.data;
  const supabase = await createClient();

  // 1. Obter contrato
  const { data: contract, error: contractErr } = await supabase
    .from("financial_contracts" as any)
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();

  if (contractErr || !contract) {
    return fail("not_found", "Contrato não encontrado nesta organização.", 404, { requestId });
  }

  const ct = contract as any;
  const contractTotal = Number(ct.total_cents || ct.amount_cents || 0);

  // 2. Resolver conta bancária/caixa para lançamentos financeiros
  let targetAccountId = account_id || null;
  if (!targetAccountId) {
    const { data: defaultAcc } = await supabase
      .from("financial_accounts")
      .select("id")
      .eq("organization_id", authz.org.orgId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    targetAccountId = defaultAcc?.id || null;

    if (!targetAccountId) {
      const { data: newAcc } = await supabase
        .from("financial_accounts")
        .insert({
          organization_id: authz.org.orgId,
          name: "Conta Principal",
          kind: "cash",
          opening_balance_cents: 0,
          currency: "BRL",
          is_active: true,
        })
        .select("id")
        .single();
      targetAccountId = newAcc?.id || null;
    }
  }

  const effectivePaidDateStr = data_pagamento || ct.contract_date || ct.start_date || new Date().toISOString().slice(0, 10);
  const effectivePaidAt = new Date(`${effectivePaidDateStr}T12:00:00Z`).toISOString();

  // 3. Buscar faturas existentes deste contrato
  const { data: invoicesData } = await supabase
    .from("financial_invoices" as any)
    .select("*")
    .eq("contract_id", params.id)
    .eq("organization_id", authz.org.orgId)
    .order("due_date", { ascending: true });

  const invoices = (invoicesData ?? []) as any[];
  let targetInvoice: any = null;

  if (invoices.length === 0) {
    // Caso o contrato não possuísse nenhuma fatura associada (ex: contrato cadastrado antes da geração automática)
    const isFull = valor_pago_cents >= contractTotal;
    const invoiceInsert = {
      organization_id: authz.org.orgId,
      contract_id: ct.id,
      contact_id: ct.contact_id,
      account_id: targetAccountId,
      direction: "in",
      type: "income",
      category: ct.modality === "one_off" ? "servico_avulso" : "recorrencia",
      title: ct.service_name || ct.title || "Serviço",
      amount_cents: contractTotal > 0 ? contractTotal : valor_pago_cents,
      contracted_cents: contractTotal > 0 ? contractTotal : valor_pago_cents,
      billed_cents: contractTotal > 0 ? contractTotal : valor_pago_cents,
      paid_cents: valor_pago_cents,
      paid_at: effectivePaidAt,
      payment_method: forma_pagamento,
      due_date: ct.contract_date || ct.start_date || effectivePaidDateStr,
      installment_number: 1,
      total_installments: 1,
      installment_total: 1,
      status: isFull ? "paid" : "partially_paid",
      metadata: {
        pagamentos: [
          {
            id: randomUUID(),
            valor_cents: valor_pago_cents,
            data_pagamento: effectivePaidAt,
            forma_pagamento,
            registrado_por_user_id: authz.user.id,
            observacoes: observacoes ?? null,
          },
        ],
      },
    };

    const { data: createdInv, error: invCreateErr } = await supabase
      .from("financial_invoices" as any)
      .insert(invoiceInsert)
      .select()
      .single();

    if (invCreateErr || !createdInv) {
      return fail("internal_error", invCreateErr?.message ?? "Falha ao criar cobrança para o contrato.", 500, {
        requestId,
      });
    }
    targetInvoice = createdInv;
  } else {
    // Localizar fatura aberta ou parcial
    targetInvoice =
      invoices.find((inv) => inv.status === "pending" || inv.status === "partially_paid" || inv.status === "overdue") ??
      invoices[invoices.length - 1];

    const currentPaid = Number(targetInvoice.paid_cents || 0);
    const billedCents = Number(targetInvoice.billed_cents || targetInvoice.amount_cents || 0);
    const newPaid = currentPaid + valor_pago_cents;
    const isFull = newPaid >= billedCents;
    const newStatus = isFull ? "paid" : "partially_paid";

    const existingMeta = (targetInvoice.metadata as Record<string, unknown>) || {};
    const existingPagamentos = Array.isArray(existingMeta.pagamentos) ? existingMeta.pagamentos : [];
    const novoPagamento = {
      id: randomUUID(),
      valor_cents: valor_pago_cents,
      data_pagamento: effectivePaidAt,
      forma_pagamento,
      registrado_por_user_id: authz.user.id,
      observacoes: observacoes ?? null,
    };

    const { data: updatedInv, error: updateInvErr } = await supabase
      .from("financial_invoices" as any)
      .update({
        paid_cents: newPaid,
        paid_at: effectivePaidAt,
        payment_method: forma_pagamento,
        account_id: targetAccountId,
        status: newStatus,
        metadata: {
          ...existingMeta,
          pagamentos: [...existingPagamentos, novoPagamento],
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", targetInvoice.id)
      .eq("organization_id", authz.org.orgId)
      .select()
      .single();

    if (updateInvErr || !updatedInv) {
      return fail("internal_error", updateInvErr?.message ?? "Falha ao atualizar cobrança do contrato.", 500, {
        requestId,
      });
    }
    targetInvoice = updatedInv;
  }

  // 4. Inserir lançamento financeiro no extrato (financial_entries) sem duplicar
  let createdEntry = null;
  if (targetAccountId) {
    const { data: existingEntry } = await supabase
      .from("financial_entries")
      .select("id")
      .eq("organization_id", authz.org.orgId)
      .eq("contract_id", ct.id)
      .eq("amount_cents", valor_pago_cents)
      .eq("entry_date", effectivePaidDateStr)
      .maybeSingle();

    if (!existingEntry) {
      const { data: entry, error: entryErr } = await supabase
        .from("financial_entries")
        .insert({
          organization_id: authz.org.orgId,
          account_id: targetAccountId,
          direction: "in",
          amount_cents: valor_pago_cents,
          description: `Recebimento Contrato: ${ct.service_name || ct.title}`,
          entry_date: effectivePaidDateStr,
          status: "paid",
          paid_at: effectivePaidAt,
          origin: "manual",
          created_by_user_id: authz.user.id,
          contract_id: ct.id,
          contact_id: ct.contact_id,
        } as any)
        .select()
        .single();

      if (!entryErr) {
        createdEntry = entry;
      }
    }
  }

  // 5. Atualizar contato para cliente ativo e em dia
  if (ct.contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("custom_fields, client_recognized_at")
      .eq("id", ct.contact_id)
      .eq("organization_id", authz.org.orgId)
      .maybeSingle();

    if (contact) {
      const cMeta = (contact.custom_fields as Record<string, unknown>) || {};
      await supabase
        .from("contacts")
        .update({
          custom_fields: {
            ...cMeta,
            financial_status: "em_dia",
            commercial_status: "cliente_ativo",
          },
          client_recognized_at: contact.client_recognized_at || effectivePaidAt,
        })
        .eq("id", ct.contact_id)
        .eq("organization_id", authz.org.orgId);
    }
  }

  await audit({
    action: "financeiro.cobranca_paga",
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    resourceType: "financial_contract",
    resourceId: ct.id,
    requestId,
    metadata: {
      valor_pago_cents,
      data_pagamento: effectivePaidDateStr,
      forma_pagamento,
      invoice_id: targetInvoice?.id,
    },
  });

  return ok(
    {
      contract_id: ct.id,
      invoice: targetInvoice,
      entry: createdEntry,
      valor_pago_cents,
      data_pagamento: effectivePaidDateStr,
    },
    { requestId },
  );
}

