import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { criarContratoSchema, gerarParcelasDoContrato } from "@/lib/financeiro/contratos";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const contactId = url.searchParams.get("contact_id");
  const modality = url.searchParams.get("modality");

  const supabase = await createClient();
  let q = supabase
    .from("financial_contracts" as any)
    .select(
      `
      id,
      organization_id,
      contact_id,
      lead_id,
      service_name,
      description,
      amount_cents,
      modality,
      recurrence_period,
      installments_count,
      due_day,
      contract_date,
      start_date,
      end_date,
      responsible_user_id,
      status,
      notes,
      metadata,
      created_at,
      updated_at,
      contact:contacts(id, display_name, email, phone_number)
    `,
    )
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: false });

  if (status) q = q.eq("status", status);
  if (contactId) q = q.eq("contact_id", contactId);
  if (modality) q = q.eq("modality", modality);

  const { data, error } = await q;
  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const parsed = criarContratoSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados inválidos para o contrato.", 422, {
      requestId,
    });
  }

  const {
    contact_id,
    lead_id,
    service_name,
    description,
    amount_cents,
    modality,
    recurrence_period,
    installments_count,
    due_day,
    contract_date,
    start_date,
    end_date,
    responsible_user_id,
    notes,
    gerar_cobrancas_automaticas,
    pagamento_ja_realizado,
    data_pagamento_realizada,
    forma_pagamento,
    account_id,
  } = parsed.data;

  const supabase = await createClient();

  // 1. Validar que entidades relacionadas pertencem à mesma organização
  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .select("id, custom_fields")
    .eq("id", contact_id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();

  if (contactErr || !contact) {
    return fail("not_found", "Contato/Cliente não encontrado nesta organização.", 404, { requestId });
  }

  if (lead_id) {
    const { data: lead } = await supabase
      .from("crm_leads")
      .select("id")
      .eq("id", lead_id)
      .eq("organization_id", authz.org.orgId)
      .maybeSingle();

    if (!lead) {
      return fail("validation_failed", "Negócio/Lead não pertence a esta organização.", 422, { requestId });
    }
  }

  // 2. Inserir contrato com compatibilidade bidirecional de colunas
  const contractTitle = service_name || "Contrato de Serviço";
  const contractInsert = {
    organization_id: authz.org.orgId,
    contact_id,
    lead_id: lead_id ?? null,
    title: contractTitle,
    service_name: contractTitle,
    description: description ?? null,
    total_cents: amount_cents,
    amount_cents,
    modality,
    recurrence_period: recurrence_period ?? null,
    installments_count: installments_count ?? 1,
    due_day: due_day ?? 10,
    contract_date,
    start_date,
    end_date: end_date ?? null,
    responsible_user_id: responsible_user_id ?? authz.user.id,
    status: "active",
    notes: notes ?? null,
    metadata: { service_name: contractTitle, modality, installments_count },
    custom_fields: { service_name: contractTitle, modality, installments_count },
  };

  const { data: contract, error: contractInsertErr } = await supabase
    .from("financial_contracts" as any)
    .insert(contractInsert)
    .select()
    .single();

  if (contractInsertErr || !contract) {
    return fail("internal_error", contractInsertErr?.message ?? "Falha ao criar contrato.", 500, { requestId });
  }

  // 3. Atualizar contato para que status financeiro e comercial reflitam a nova contratação
  const existingCustom = (contact.custom_fields as Record<string, unknown>) || {};
  const updatedCustom = {
    ...existingCustom,
    financial_status: "em_dia",
    commercial_status: "cliente_ativo",
  };
  await supabase
    .from("contacts")
    .update({
      custom_fields: updatedCustom,
      client_recognized_at: new Date().toISOString(),
    })
    .eq("id", contact_id)
    .eq("organization_id", authz.org.orgId);

  // 4. Gerar cobranças automáticas se solicitado
  let cobrancasGeradas = 0;
  if (gerar_cobrancas_automaticas) {
    const parcelas = gerarParcelasDoContrato({
      contract_id: (contract as any).id,
      contact_id,
      service_name,
      amount_cents,
      modality,
      installments_count,
      start_date,
      due_day,
    });

    if (parcelas.length > 0) {
      const isPaidNow = Boolean(pagamento_ja_realizado);
      const paidDateStr = data_pagamento_realizada || contract_date || start_date;
      const effectivePaidAt = paidDateStr
        ? new Date(`${paidDateStr}T12:00:00Z`).toISOString()
        : new Date().toISOString();

      const invoicesInsert = parcelas.map((p, idx) => {
        // Se foi explicitamente marcado como já recebido: marca a parcela como paga
        const parcelaPaga = isPaidNow && (modality === "one_off" || idx === 0);
        return {
          organization_id: authz.org.orgId,
          contract_id: (contract as any).id,
          contact_id,
          account_id: account_id || null,
          direction: "in",
          type: "income",
          title: p.title,
          amount_cents: p.amount_cents,
          contracted_cents: p.amount_cents,
          billed_cents: p.billed_cents,
          paid_cents: parcelaPaga ? p.amount_cents : 0,
          paid_at: parcelaPaga ? effectivePaidAt : null,
          payment_method: parcelaPaga ? (forma_pagamento || "pix") : null,
          due_date: p.due_date,
          installment_number: p.installment_number,
          total_installments: p.installment_total,
          installment_total: p.installment_total,
          status: parcelaPaga ? "paid" : "pending",
        };
      });

      const { data: createdInvoices, error: invoiceErr } = await supabase
        .from("financial_invoices" as any)
        .insert(invoicesInsert)
        .select();

      if (!invoiceErr) {
        cobrancasGeradas = invoicesInsert.length;

        // Se pago e houver conta, registra também lançamento em financial_entries
        if (isPaidNow && account_id && createdInvoices) {
          for (const inv of createdInvoices as any[]) {
            if (inv.status === "paid") {
              await supabase.from("financial_entries").insert({
                organization_id: authz.org.orgId,
                account_id,
                direction: "in",
                amount_cents: inv.paid_cents,
                description: `Recebimento Contrato: ${inv.title}`,
                entry_date: paidDateStr,
                status: "paid",
                paid_at: effectivePaidAt,
                origin: "manual",
                created_by_user_id: authz.user.id,
                contract_id: (contract as any).id,
                contact_id,
              } as any);
            }
          }
        }
      }
    }
  }

  await audit({
    action: "financeiro.contrato_criado",
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    resourceType: "financial_contract",
    resourceId: (contract as any).id,
    requestId,
    metadata: {
      service_name,
      amount_cents,
      modality,
      cobrancasGeradas,
    },
  });

  return ok({ contract, cobrancas_geradas: cobrancasGeradas }, { requestId, status: 201 });
}
