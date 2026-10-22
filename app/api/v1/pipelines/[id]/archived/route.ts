/**
 * GET /api/v1/pipelines/[id]/archived
 *
 * Lista paginada de leads arquivados/encerrados (lost, won, archived) do funil.
 * Multi-tenant, RLS + authz.org.orgId, compatível com busca, filtros de motivo e data.
 */

import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: pipelineId } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const searchParams = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get("per_page") ?? "20", 10) || 20));
  const offset = (page - 1) * perPage;

  const q = searchParams.get("q")?.trim();
  const reason = searchParams.get("reason")?.trim();
  const statusParam = searchParams.get("status")?.trim();
  const dateFrom = searchParams.get("date_from")?.trim();
  const dateTo = searchParams.get("date_to")?.trim();

  const supabase = await createClient();

  // Validar se o pipeline pertence à organização
  const { data: pipeline, error: pipeErr } = await supabase
    .from("crm_pipelines")
    .select("id")
    .eq("id", pipelineId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (pipeErr) return fail("internal_error", pipeErr.message, 500, { requestId });
  if (!pipeline) return fail("not_found", "Funil não encontrado.", 404, { requestId });

  let query = supabase
    .from("crm_leads")
    .select(
      "id, title, status, lost_reason, won_reason, closed_at, created_at, updated_at, stage_id, lost_from_stage_id, contact_id, owner_user_id, owner_agent_id, owner_kind, value_cents, currency, custom_fields",
      { count: "exact" },
    )
    .eq("organization_id", orgId)
    .eq("pipeline_id", pipelineId);

  // Status
  if (statusParam && statusParam !== "all") {
    query = query.eq("status", statusParam);
  } else {
    query = query.in("status", ["lost", "won", "archived"]);
  }

  // Motivo
  if (reason) {
    query = query.eq("lost_reason", reason);
  }

  // Data
  if (dateFrom) {
    query = query.gte("closed_at", dateFrom);
  }
  if (dateTo) {
    query = query.lte("closed_at", dateTo);
  }

  // Busca textual no título
  if (q) {
    query = query.ilike("title", `%${q}%`);
  }

  query = query
    .order("closed_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + perPage - 1);

  const { data: leads, error: leadsErr, count } = await query;
  if (leadsErr) return fail("internal_error", leadsErr.message, 500, { requestId });

  const total = count ?? 0;
  const leadRows = leads ?? [];

  // Buscar dados complementares em lote: contatos, estágios e responsáveis
  const contactIds = [...new Set(leadRows.map((l) => l.contact_id).filter(Boolean))] as string[];
  const stageIds = [
    ...new Set(
      leadRows.flatMap((l) => [l.lost_from_stage_id, l.stage_id]).filter(Boolean),
    ),
  ] as string[];
  const userIds = [...new Set(leadRows.map((l) => l.owner_user_id).filter(Boolean))] as string[];

  const [contactsRes, stagesRes, usersRes] = await Promise.all([
    contactIds.length > 0
      ? supabase
          .from("contacts")
          .select("id, name, display_name, email, phone_number")
          .eq("organization_id", orgId)
          .in("id", contactIds)
      : Promise.resolve({ data: [] }),
    stageIds.length > 0
      ? supabase
          .from("crm_stages")
          .select("id, name, is_won, is_lost")
          .eq("organization_id", orgId)
          .in("id", stageIds)
      : Promise.resolve({ data: [] }),
    userIds.length > 0
      ? supabase
          .from("users")
          .select("id, name, email")
          .in("id", userIds)
      : Promise.resolve({ data: [] }),
  ]);

  const contactMap = new Map((contactsRes.data ?? []).map((c) => [c.id, c]));
  const stageMap = new Map((stagesRes.data ?? []).map((s) => [s.id, s]));
  const userMap = new Map((usersRes.data ?? []).map((u) => [u.id, u]));

  const items = leadRows.map((lead) => {
    const contact = lead.contact_id ? contactMap.get(lead.contact_id) : null;
    const stage =
      (lead.lost_from_stage_id ? stageMap.get(lead.lost_from_stage_id) : null) ??
      (lead.stage_id ? stageMap.get(lead.stage_id) : null);
    const owner = lead.owner_user_id ? userMap.get(lead.owner_user_id) : null;
    const cf = (lead.custom_fields as Record<string, unknown> | null) ?? {};

    return {
      id: lead.id,
      title: lead.title,
      status: lead.status,
      value_cents: lead.value_cents,
      currency: lead.currency ?? "BRL",
      closed_at: lead.closed_at ?? lead.updated_at,
      created_at: lead.created_at,
      lost_reason: lead.lost_reason,
      won_reason: lead.won_reason,
      closure_notes: (cf.closure_notes ?? cf.lost_notes ?? null) as string | null,
      closure_reason: (cf.closure_reason ?? lead.lost_reason ?? null) as string | null,
      contact: contact
        ? {
            id: contact.id,
            name: contact.name,
            company: contact.display_name,
            email: contact.email,
            phone: contact.phone_number,
          }
        : null,
      stage_name: stage?.name ?? "Etapa final",
      owner_name: owner?.name ?? owner?.email ?? (lead.owner_kind === "ai" ? "Agente IA" : "Sem responsável"),
    };
  });

  return ok(
    {
      items,
      total,
      page,
      per_page: perPage,
      total_pages: Math.ceil(total / perPage) || 1,
    },
    { requestId },
  );
}

