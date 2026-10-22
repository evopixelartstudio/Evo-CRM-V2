import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { criarCobrancaSchema } from "@/lib/financeiro/cobrancas";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const url = new URL(req.url);
  const type = url.searchParams.get("type"); // income | expense
  const status = url.searchParams.get("status");
  const contactId = url.searchParams.get("contact_id");
  const contractId = url.searchParams.get("contract_id");
  const de = url.searchParams.get("de");
  const ate = url.searchParams.get("ate");

  const supabase = await createClient();
  let q = supabase
    .from("financial_invoices" as any)
    .select(
      `
      id,
      organization_id,
      contract_id,
      contact_id,
      account_id,
      account_plan_id,
      type,
      title,
      amount_cents,
      billed_cents,
      paid_cents,
      due_date,
      paid_at,
      payment_method,
      installment_number,
      installment_total,
      status,
      notes,
      metadata,
      created_at,
      updated_at,
      contact:contacts(id, display_name, email, phone_number),
      contract:financial_contracts(id, service_name, modality)
    `,
    )
    .eq("organization_id", authz.org.orgId)
    .order("due_date", { ascending: true })
    .limit(500);

  if (type) q = q.eq("type", type);
  if (status) q = q.eq("status", status);
  if (contactId) q = q.eq("contact_id", contactId);
  if (contractId) q = q.eq("contract_id", contractId);
  if (de) q = q.gte("due_date", de);
  if (ate) q = q.lte("due_date", ate);

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

  const parsed = criarCobrancaSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados inválidos para a cobrança.", 422, {
      requestId,
    });
  }

  const payload = parsed.data;
  const isPaid = payload.status === "paid";
  const paidCents = isPaid ? payload.billed_cents : 0;
  const paidAt = isPaid ? new Date().toISOString() : null;

  const supabase = await createClient();

  // Validar isolamento multi-tenant de todas as chaves estrangeiras informadas
  if (payload.contact_id) {
    const { data: ct } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", payload.contact_id)
      .eq("organization_id", authz.org.orgId)
      .maybeSingle();
    if (!ct) {
      return fail("validation_failed", "Contato não pertence a esta organização.", 422, { requestId });
    }
  }

  if (payload.contract_id) {
    const { data: contract } = await supabase
      .from("financial_contracts" as any)
      .select("id")
      .eq("id", payload.contract_id)
      .eq("organization_id", authz.org.orgId)
      .maybeSingle();
    if (!contract) {
      return fail("validation_failed", "Contrato não pertence a esta organização.", 422, { requestId });
    }
  }

  if (payload.account_id) {
    const { data: acc } = await supabase
      .from("financial_accounts")
      .select("id")
      .eq("id", payload.account_id)
      .eq("organization_id", authz.org.orgId)
      .maybeSingle();
    if (!acc) {
      return fail("validation_failed", "Conta financeira não pertence a esta organização.", 422, { requestId });
    }
  }

  if (payload.account_plan_id) {
    const { data: plan } = await supabase
      .from("account_plans")
      .select("id")
      .eq("id", payload.account_plan_id)
      .eq("organization_id", authz.org.orgId)
      .maybeSingle();
    if (!plan) {
      return fail("validation_failed", "Plano de contas não pertence a esta organização.", 422, { requestId });
    }
  }

  const direction = payload.type === "expense" ? "out" : "in";
  const installments = payload.installment_total ?? payload.total_installments ?? 1;

  const insertData = {
    organization_id: authz.org.orgId,
    contract_id: payload.contract_id ?? null,
    contact_id: payload.contact_id ?? null,
    account_id: payload.account_id ?? null,
    account_plan_id: payload.account_plan_id ?? null,
    direction,
    type: payload.type,
    category: payload.category ?? "outros",
    title: payload.title,
    contracted_cents: payload.amount_cents,
    amount_cents: payload.amount_cents,
    billed_cents: payload.billed_cents,
    paid_cents: paidCents,
    currency: payload.currency ?? "BRL",
    due_date: payload.due_date,
    paid_at: paidAt,
    payment_method: payload.payment_method ?? null,
    installment_number: payload.installment_number ?? 1,
    total_installments: installments,
    installment_total: installments,
    status: payload.status,
    notes: payload.notes ?? null,
    metadata: { type: payload.type, category: payload.category },
    custom_fields: { type: payload.type, category: payload.category },
  };

  const { data: invoice, error } = await supabase
    .from("financial_invoices" as any)
    .insert(insertData)
    .select()
    .single();

  if (error || !invoice) {
    return fail("internal_error", error?.message ?? "Falha ao registrar cobrança.", 500, { requestId });
  }

  // Se já nasceu como pago e tem account_id, sincronizar com financial_entries para fluxo de caixa histórico
  if (isPaid && payload.account_id) {
    await supabase.from("financial_entries").insert({
      organization_id: authz.org.orgId,
      account_id: payload.account_id,
      account_plan_id: payload.account_plan_id ?? null,
      direction: payload.type === "income" ? "in" : "out",
      amount_cents: payload.billed_cents,
      description: payload.title,
      entry_date: payload.due_date,
      status: "paid",
      paid_at: paidAt,
      origin: "manual",
      created_by_user_id: authz.user.id,
      contract_id: payload.contract_id ?? null,
      contact_id: payload.contact_id ?? null,
    } as any);
  }

  await audit({
    action: "financeiro.cobranca_criada",
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    resourceType: "financial_invoice",
    resourceId: (invoice as any).id,
    requestId,
    metadata: {
      type: payload.type,
      title: payload.title,
      billed_cents: payload.billed_cents,
      due_date: payload.due_date,
    },
  });

  return ok(invoice, { requestId, status: 201 });
}
