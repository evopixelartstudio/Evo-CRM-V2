import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import {
  atualizarClienteFinanceiroSchema,
  construirPerfilFinanceiroCliente,
  mesclarCamposFinanceirosNoContato,
} from "@/lib/financeiro/clientes";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<Response> {
  const params = await props.params;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();

  // 1. Obter contato
  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();

  if (contactErr || !contact) {
    return fail("not_found", "Cliente/Contato não encontrado.", 404, { requestId });
  }

  // 2. Obter contratos
  const { data: contracts } = await supabase
    .from("financial_contracts" as any)
    .select("*")
    .eq("contact_id", params.id)
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: false });

  // 3. Obter faturas/cobranças
  const { data: invoices } = await supabase
    .from("financial_invoices" as any)
    .select("*")
    .eq("contact_id", params.id)
    .eq("organization_id", authz.org.orgId)
    .order("due_date", { ascending: false });

  const perfil = construirPerfilFinanceiroCliente(contact, contracts ?? [], invoices ?? []);

  return ok(perfil, { requestId });
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

  const parsed = atualizarClienteFinanceiroSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados inválidos.", 422, { requestId });
  }

  const supabase = await createClient();

  const { data: contact, error: fetchErr } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();

  if (fetchErr || !contact) {
    return fail("not_found", "Cliente/Contato não encontrado.", 404, { requestId });
  }

  const payload = parsed.data;

  // Atualizar campos canônicos
  const updateData: Record<string, unknown> = {};
  if (payload.display_name !== undefined) updateData.display_name = payload.display_name;
  if (payload.email !== undefined) updateData.email = payload.email;
  if (payload.phone_number !== undefined) updateData.phone_number = payload.phone_number;
  if (payload.client_since !== undefined) {
    updateData.client_recognized_at = payload.client_since ? new Date(payload.client_since).toISOString() : null;
  }

  // Mesclar campos customizados no jsonb
  updateData.custom_fields = mesclarCamposFinanceirosNoContato(contact.custom_fields, {
    trade_name: payload.trade_name,
    instagram: payload.instagram,
    document: payload.document,
    financial_status: payload.financial_status,
    commercial_status: payload.commercial_status,
    financial_notes: payload.financial_notes,
    client_since: payload.client_since,
  });

  const { data: updated, error: updateErr } = await supabase
    .from("contacts")
    .update(updateData)
    .eq("id", params.id)
    .eq("organization_id", authz.org.orgId)
    .select()
    .single();

  if (updateErr || !updated) {
    return fail("internal_error", updateErr?.message ?? "Falha ao atualizar dados financeiros do cliente.", 500, {
      requestId,
    });
  }

  await audit({
    action: "financeiro.cliente_atualizado",
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    resourceType: "contact",
    resourceId: params.id,
    requestId,
    metadata: {
      alteracoes: payload,
    },
  });

  return ok(updated, { requestId });
}
