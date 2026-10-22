import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();

  // Buscar faturas e contratos da organização
  const { data: invoices, error: invErr } = await supabase
    .from("financial_invoices" as any)
    .select(
      `
      id,
      contact_id,
      contract_id,
      type,
      title,
      billed_cents,
      paid_cents,
      due_date,
      paid_at,
      payment_method,
      status,
      contact:contacts(id, display_name),
      contract:financial_contracts(id, service_name)
    `,
    )
    .eq("organization_id", authz.org.orgId);

  if (invErr) {
    return fail("internal_error", invErr.message, 500, { requestId });
  }

  const allInvoices = (invoices as any[]) ?? [];
  const hoje = new Date();
  const hojeStr = hoje.toISOString().split("T")[0] as string;

  // 1. Receitas por serviço
  const receitasPorServicoMap: Record<string, { nome: string; total_cents: number; recebido_cents: number; contagem: number }> = {};
  allInvoices
    .filter((inv) => inv.type === "income" && inv.status !== "cancelled" && inv.status !== "reversed")
    .forEach((inv) => {
      const servicoNome = inv.contract?.service_name || "Serviços Avulsos / Diversos";
      if (!receitasPorServicoMap[servicoNome]) {
        receitasPorServicoMap[servicoNome] = { nome: servicoNome, total_cents: 0, recebido_cents: 0, contagem: 0 };
      }
      receitasPorServicoMap[servicoNome].total_cents += Number(inv.billed_cents || 0);
      receitasPorServicoMap[servicoNome].recebido_cents += Number(inv.paid_cents || 0);
      receitasPorServicoMap[servicoNome].contagem++;
    });

  const receitasPorServico = Object.values(receitasPorServicoMap).sort((a, b) => b.total_cents - a.total_cents);

  // 2. Despesas por título/categoria
  const despesasPorTipoMap: Record<string, { categoria: string; total_cents: number; pago_cents: number; contagem: number }> = {};
  allInvoices
    .filter((inv) => inv.type === "expense" && inv.status !== "cancelled" && inv.status !== "reversed")
    .forEach((inv) => {
      const cat = inv.title.split("-")[0]?.trim() || inv.title;
      if (!despesasPorTipoMap[cat]) {
        despesasPorTipoMap[cat] = { categoria: cat, total_cents: 0, pago_cents: 0, contagem: 0 };
      }
      despesasPorTipoMap[cat].total_cents += Number(inv.billed_cents || 0);
      despesasPorTipoMap[cat].pago_cents += Number(inv.paid_cents || 0);
      despesasPorTipoMap[cat].contagem++;
    });

  const despesasPorTipo = Object.values(despesasPorTipoMap).sort((a, b) => b.total_cents - a.total_cents);

  // 3. Faixas de atraso (Aging de inadimplência)
  const faixasAtraso = {
    ate_30_dias: { total_cents: 0, contagem: 0 },
    de_31_a_60_dias: { total_cents: 0, contagem: 0 },
    de_61_a_90_dias: { total_cents: 0, contagem: 0 },
    mais_de_90_dias: { total_cents: 0, contagem: 0 },
  };

  allInvoices
    .filter(
      (inv) =>
        inv.type === "income" &&
        (inv.status === "pending" || inv.status === "partially_paid" || inv.status === "overdue") &&
        inv.due_date < hojeStr,
    )
    .forEach((inv) => {
      const vencimento = new Date(inv.due_date);
      const diasAtraso = Math.floor((hoje.getTime() - vencimento.getTime()) / (1000 * 60 * 60 * 24));
      const abertoCents = Math.max(0, Number(inv.billed_cents || 0) - Number(inv.paid_cents || 0));

      if (diasAtraso <= 30) {
        faixasAtraso.ate_30_dias.total_cents += abertoCents;
        faixasAtraso.ate_30_dias.contagem++;
      } else if (diasAtraso <= 60) {
        faixasAtraso.de_31_a_60_dias.total_cents += abertoCents;
        faixasAtraso.de_31_a_60_dias.contagem++;
      } else if (diasAtraso <= 90) {
        faixasAtraso.de_61_a_90_dias.total_cents += abertoCents;
        faixasAtraso.de_61_a_90_dias.contagem++;
      } else {
        faixasAtraso.mais_de_90_dias.total_cents += abertoCents;
        faixasAtraso.mais_de_90_dias.contagem++;
      }
    });

  // 4. Formas de pagamento mais utilizadas
  const formasPagamentoMap: Record<string, { forma: string; total_cents: number; contagem: number }> = {};
  allInvoices
    .filter((inv) => inv.type === "income" && inv.payment_method && Number(inv.paid_cents || 0) > 0)
    .forEach((inv) => {
      const forma = inv.payment_method || "outro";
      if (!formasPagamentoMap[forma]) {
        formasPagamentoMap[forma] = { forma, total_cents: 0, contagem: 0 };
      }
      formasPagamentoMap[forma].total_cents += Number(inv.paid_cents || 0);
      formasPagamentoMap[forma].contagem++;
    });

  return ok(
    {
      receitas_por_servico: receitasPorServico,
      despesas_por_tipo: despesasPorTipo,
      faixas_atraso: faixasAtraso,
      formas_pagamento: Object.values(formasPagamentoMap).sort((a, b) => b.total_cents - a.total_cents),
    },
    { requestId },
  );
}
