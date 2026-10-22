import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { calcularMetricasDashboard } from "@/lib/financeiro/calculos";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const url = new URL(req.url);
  const agora = new Date();
  const primeiroDiaMes = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString().split("T")[0] as string;
  const ultimoDiaMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).toISOString().split("T")[0] as string;

  const tipoPeriodo = url.searchParams.get("periodo");
  let de = url.searchParams.get("de");
  let ate = url.searchParams.get("ate");

  if (tipoPeriodo === "tudo" || de === "all") {
    de = "all";
    ate = "all";
  } else if (tipoPeriodo === "mes_anterior") {
    const primeiroDiaMesAnt = new Date(agora.getFullYear(), agora.getMonth() - 1, 1).toISOString().split("T")[0] as string;
    const ultimoDiaMesAnt = new Date(agora.getFullYear(), agora.getMonth(), 0).toISOString().split("T")[0] as string;
    de = primeiroDiaMesAnt;
    ate = ultimoDiaMesAnt;
  } else if (tipoPeriodo === "ano_atual") {
    de = `${agora.getFullYear()}-01-01`;
    ate = `${agora.getFullYear()}-12-31`;
  } else {
    de = de || primeiroDiaMes;
    ate = ate || ultimoDiaMes;
  }

  const supabase = await createClient();

  // 1. Obter todos os contratos da organização
  const { data: contracts, error: ctErr } = await supabase
    .from("financial_contracts" as any)
    .select("id, contact_id, service_name, total_cents, amount_cents, modality, recurrence_period, status, contract_date, start_date, end_date")
    .eq("organization_id", authz.org.orgId);

  if (ctErr) {
    return fail("internal_error", ctErr.message, 500, { requestId });
  }

  // 2. Obter faturas/cobranças da organização
  // Buscamos faturas para o período e também faturas em aberto/vencidas para inadimplência e a receber
  const { data: invoices, error: invErr } = await supabase
    .from("financial_invoices" as any)
    .select(
      `
      id,
      contact_id,
      type,
      title,
      amount_cents,
      billed_cents,
      paid_cents,
      due_date,
      paid_at,
      payment_method,
      status,
      contact:contacts(id, display_name, phone_number, email)
    `,
    )
    .eq("organization_id", authz.org.orgId)
    .order("due_date", { ascending: true });

  if (invErr) {
    return fail("internal_error", invErr.message, 500, { requestId });
  }

  const metricas = calcularMetricasDashboard({
    contratos: (contracts as any[]) ?? [],
    faturas: (invoices as any[]) ?? [],
    periodoInicio: de,
    periodoFim: ate,
  });

  // Próximos vencimentos a vencer (receitas e despesas)
  const hojeStr = agora.toISOString().split("T")[0] as string;
  const proximosVencimentos = ((invoices as any[]) ?? [])
    .filter((inv) => (inv.status === "pending" || inv.status === "partially_paid") && inv.due_date >= hojeStr)
    .slice(0, 10);

  // Faturas vencidas / em atraso
  const faturasEmAtraso = ((invoices as any[]) ?? [])
    .filter(
      (inv) =>
        inv.type === "income" &&
        (inv.status === "pending" || inv.status === "partially_paid" || inv.status === "overdue") &&
        inv.due_date < hojeStr,
    )
    .slice(0, 10);

  return ok(
    {
      ...metricas,
      periodo: { de, ate },
      proximos_vencimentos: proximosVencimentos,
      faturas_em_atraso: faturasEmAtraso,
    },
    { requestId },
  );
}
