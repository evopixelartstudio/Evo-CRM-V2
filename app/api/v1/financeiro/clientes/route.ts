import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { extrairCamposFinanceirosDoContato } from "@/lib/financeiro/clientes";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const statusFinanceiro = url.searchParams.get("status_financeiro");
  const categoriaCliente = url.searchParams.get("categoria"); // ativos | historicos | inadimplentes | concluidos | cancelados
  const apenasClientes = url.searchParams.get("apenas_clientes") !== "false";

  const supabase = await createClient();

  let contactIdsValidos: string[] = [];

  // Se apenasClientes for true (padrão da aba Clientes), buscar EXCLUSIVAMENTE
  // contatos que possuem contratação efetiva (financial_contracts ou financial_invoices de receita)
  if (apenasClientes) {
    const [contractsRes, invoicesRes] = await Promise.all([
      supabase
        .from("financial_contracts" as any)
        .select("contact_id")
        .eq("organization_id", authz.org.orgId)
        .not("contact_id", "is", null),
      supabase
        .from("financial_invoices" as any)
        .select("contact_id")
        .eq("organization_id", authz.org.orgId)
        .eq("type", "income")
        .not("contact_id", "is", null),
    ]);

    const idSet = new Set<string>();
    (contractsRes.data ?? []).forEach((c: any) => {
      if (c.contact_id) idSet.add(c.contact_id);
    });
    (invoicesRes.data ?? []).forEach((inv: any) => {
      if (inv.contact_id) idSet.add(inv.contact_id);
    });

    contactIdsValidos = Array.from(idSet);

    // Se não há nenhum cliente efetivo, retorna vazio imediatamente
    if (contactIdsValidos.length === 0) {
      return ok([], { requestId });
    }
  }

  let query = supabase
    .from("contacts")
    .select(
      `
      id,
      display_name,
      phone_number,
      email,
      created_at,
      client_recognized_at,
      custom_fields
    `,
    )
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: false })
    .limit(300);

  if (apenasClientes) {
    query = query.in("id", contactIdsValidos);
  }

  if (q) {
    query = query.or(`display_name.ilike.%${q}%,phone_number.ilike.%${q}%,email.ilike.%${q}%`);
  }

  const { data: contacts, error } = await query;
  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  // Buscar resumos de contratos e faturas para enriquecer a lista
  const contactIds = (contacts ?? []).map((c) => c.id);

  let contractsMap: Record<
    string,
    { count: number; active: number; completed: number; cancelled: number; mrr_cents: number }
  > = {};
  let invoicesMap: Record<string, { total_paid_cents: number; total_open_cents: number; has_overdue: boolean }> = {};

  if (contactIds.length > 0) {
    const { data: contracts } = await supabase
      .from("financial_contracts" as any)
      .select("id, contact_id, status, modality, amount_cents")
      .eq("organization_id", authz.org.orgId)
      .in("contact_id", contactIds);

    (contracts ?? []).forEach((ct: any) => {
      const cid = ct.contact_id;
      if (!contractsMap[cid]) {
        contractsMap[cid] = { count: 0, active: 0, completed: 0, cancelled: 0, mrr_cents: 0 };
      }
      contractsMap[cid].count++;
      if (ct.status === "active") {
        contractsMap[cid].active++;
        if (ct.modality === "recurring") {
          contractsMap[cid].mrr_cents += Number(ct.amount_cents || 0);
        }
      } else if (ct.status === "completed") {
        contractsMap[cid].completed++;
      } else if (ct.status === "cancelled") {
        contractsMap[cid].cancelled++;
      }
    });

    const hojeStr = new Date().toISOString().split("T")[0] as string;
    const { data: invoices } = await supabase
      .from("financial_invoices" as any)
      .select("contact_id, billed_cents, paid_cents, status, due_date, type")
      .eq("organization_id", authz.org.orgId)
      .eq("type", "income")
      .in("contact_id", contactIds);

    (invoices ?? []).forEach((inv: any) => {
      const cid = inv.contact_id;
      if (!invoicesMap[cid]) {
        invoicesMap[cid] = { total_paid_cents: 0, total_open_cents: 0, has_overdue: false };
      }
      const billed = Number(inv.billed_cents || 0);
      const paid = Number(inv.paid_cents || 0);
      invoicesMap[cid].total_paid_cents += paid;

      const open = Math.max(0, billed - paid);
      if (open > 0 && inv.status !== "cancelled" && inv.status !== "reversed") {
        invoicesMap[cid].total_open_cents += open;
        if (inv.due_date < hojeStr) {
          invoicesMap[cid].has_overdue = true;
        }
      }
    });
  }

  const result = (contacts ?? []).map((c) => {
    const custom = extrairCamposFinanceirosDoContato(c.custom_fields);
    const cStats = contractsMap[c.id] ?? { count: 0, active: 0, completed: 0, cancelled: 0, mrr_cents: 0 };
    const iStats = invoicesMap[c.id] ?? { total_paid_cents: 0, total_open_cents: 0, has_overdue: false };

    // Situação financeira real calculada
    let situacaoFinanceira = custom.financial_status;
    if (iStats.has_overdue) {
      situacaoFinanceira = "inadimplente";
    } else if (cStats.active > 0) {
      situacaoFinanceira = "em_dia";
    }

    // Classificação contratual do cliente
    let tipoCliente: "ativo" | "inadimplente" | "historico" | "concluido" | "cancelado" = "historico";
    if (iStats.has_overdue) {
      tipoCliente = "inadimplente";
    } else if (cStats.active > 0) {
      tipoCliente = "ativo";
    } else if (cStats.completed > 0 && cStats.active === 0) {
      tipoCliente = "concluido";
    } else if (cStats.cancelled > 0 && cStats.active === 0) {
      tipoCliente = "cancelado";
    }

    // É cliente se possui contratação ou cobrança efetiva registrada
    const ehCliente = Boolean(cStats.count > 0 || iStats.total_paid_cents > 0 || iStats.total_open_cents > 0);

    return {
      id: c.id,
      display_name: c.display_name,
      phone_number: c.phone_number,
      email: c.email,
      created_at: c.created_at,
      client_recognized_at: c.client_recognized_at,
      custom_fields: c.custom_fields,
      campos_financeiros: {
        ...custom,
        financial_status: situacaoFinanceira,
      },
      classificacao_cliente: tipoCliente,
      metricas: {
        total_contratos: cStats.count,
        contratos_ativos: cStats.active,
        contratos_concluidos: cStats.completed,
        contratos_cancelados: cStats.cancelled,
        mrr_cents: cStats.mrr_cents,
        total_pago_cents: iStats.total_paid_cents,
        total_aberto_cents: iStats.total_open_cents,
        em_atraso: iStats.has_overdue,
      },
      eh_cliente: ehCliente,
    };
  });

  const filtrado = result.filter((item) => {
    if (apenasClientes && !item.eh_cliente) return false;
    if (statusFinanceiro && item.campos_financeiros.financial_status !== statusFinanceiro) return false;
    if (categoriaCliente) {
      if (categoriaCliente === "ativos" && item.classificacao_cliente !== "ativo") return false;
      if (categoriaCliente === "inadimplentes" && item.classificacao_cliente !== "inadimplente") return false;
      if (categoriaCliente === "concluidos" && item.classificacao_cliente !== "concluido") return false;
      if (categoriaCliente === "cancelados" && item.classificacao_cliente !== "cancelado") return false;
      if (categoriaCliente === "historicos" && item.classificacao_cliente === "ativo") return false;
    }
    return true;
  });

  return ok(filtrado, { requestId });
}
