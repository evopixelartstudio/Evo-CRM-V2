import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

import { gerarParcelasDoContrato } from "@/lib/financeiro/contratos";

export const dynamic = "force-dynamic";

const atualizarContratoSchema = z.object({
  status: z.enum(["draft", "active", "completed", "cancelled", "paused"]).optional(),
  service_name: z.string().min(2).max(255).optional(),
  title: z.string().min(2).max(255).optional(),
  description: z.string().max(1000).nullish(),
  amount_cents: z.number().int().min(0).optional(),
  total_cents: z.number().int().min(0).optional(),
  modality: z.enum(["one_off", "installments", "recurring"]).optional(),
  recurrence_period: z.enum(["monthly", "bimonthly", "quarterly", "semi_annual", "annual"]).nullish(),
  installments_count: z.number().int().min(1).max(120).optional(),
  contract_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  due_day: z.number().int().min(1).max(31).optional(),
  notes: z.string().max(2000).nullish(),
  responsible_user_id: z.string().uuid().nullish(),
  gerar_cobrancas_se_ausente: z.boolean().optional(),
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
  delete updateData.gerar_cobrancas_se_ausente;

  if (parsed.data.service_name) {
    updateData.title = parsed.data.service_name;
  } else if (parsed.data.title) {
    updateData.service_name = parsed.data.title;
  }

  if (parsed.data.amount_cents !== undefined) {
    updateData.total_cents = parsed.data.amount_cents;
  } else if (parsed.data.total_cents !== undefined) {
    updateData.amount_cents = parsed.data.total_cents;
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

  if (parsed.data.gerar_cobrancas_se_ausente) {
    const { data: invs } = await supabase
      .from("financial_invoices" as any)
      .select("id")
      .eq("contract_id", params.id)
      .eq("organization_id", authz.org.orgId)
      .limit(1);

    if (!invs || invs.length === 0) {
      const u = updated as any;
      const parcelas = gerarParcelasDoContrato({
        contract_id: u.id,
        contact_id: u.contact_id,
        service_name: u.service_name || u.title,
        amount_cents: u.amount_cents || u.total_cents,
        modality: u.modality,
        installments_count: u.installments_count,
        contract_date: u.contract_date,
        start_date: u.start_date,
        due_day: u.due_day,
      });

      if (parcelas.length > 0) {
        await supabase.from("financial_invoices" as any).insert(
          parcelas.map((p) => ({
            organization_id: authz.org.orgId,
            contract_id: u.id,
            contact_id: u.contact_id,
            direction: "in",
            type: "income",
            title: p.title,
            amount_cents: p.amount_cents,
            contracted_cents: p.contracted_cents,
            billed_cents: p.billed_cents,
            paid_cents: 0,
            due_date: p.due_date,
            installment_number: p.installment_number,
            total_installments: p.installment_total,
            installment_total: p.installment_total,
            status: "pending",
          })),
        );
      }
    }
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
