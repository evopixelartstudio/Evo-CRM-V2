import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { extrairCamposFinanceirosDoContato } from "@/lib/financeiro/clientes";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const statusFinanceiro = url.searchParams.get("status_financeiro");
  const apenasClientes = url.searchParams.get("apenas_clientes") !== "false";

  const supabase = await createClient();

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

  if (q) {
    query = query.or(`display_name.ilike.%${q}%,phone_number.ilike.%${q}%,email.ilike.%${q}%`);
  }

  const { data: contacts, error } = await query;
  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  // Buscar resumos de contratos e faturas para enriquecer a lista
  const contactIds = (contacts ?? []).map((c) => c.id);

  let contractsMap: Record<string, { count: number; active: number; mrr_cents: number }> = {};
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
        contractsMap[cid] = { count: 0, active: 0, mrr_cents: 0 };
      }
      contractsMap[cid].count++;
      if (ct.status === "active") {
        contractsMap[cid].active++;
        if (ct.modality === "recurring") {
          contractsMap[cid].mrr_cents += Number(ct.amount_cents || 0);
        }
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
    const cStats = contractsMap[c.id] ?? { count: 0, active: 0, mrr_cents: 0 };
    const iStats = invoicesMap[c.id] ?? { total_paid_cents: 0, total_open_cents: 0, has_overdue: false };

    // Situação financeira real calculada
    let situacaoFinanceira = custom.financial_status;
    if (iStats.has_overdue) {
      situacaoFinanceira = "inadimplente";
    } else if (cStats.active > 0) {
      situacaoFinanceira = "em_dia";
    }

    const ehCliente = Boolean(c.client_recognized_at || cStats.count > 0 || custom.commercial_status === "cliente_ativo");

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
      metricas: {
        total_contratos: cStats.count,
        contratos_ativos: cStats.active,
        mrr_cents: cStats.mrr_cents,
        total_pago_cents: iStats.total_paid_cents,
        total_aberto_cents: iStats.total_open_cents,
        em_atraso: iStats.has_overdue,
      },
      eh_cliente: ehCliente,
    };
  });

  const filtrado = result.filter((item) => {
    if (apenasClientes && !q && !item.eh_cliente) return false;
    if (statusFinanceiro && item.campos_financeiros.financial_status !== statusFinanceiro) return false;
    return true;
  });

  return ok(filtrado, { requestId });
}
