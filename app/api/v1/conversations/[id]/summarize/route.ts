import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/conversations/[id]/summarize
 *
 * Gera um resumo estruturado e conciso do histórico recente da conversa para
 * auxiliar o operador humano na transferência inteligente para a IA.
 *
 * Inclui:
 * - Assunto principal
 * - Solicitações do cliente
 * - Decisões já tomadas
 * - Pendências
 * - Próxima ação esperada
 *
 * Auth: cookie session, role >= agent.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { rotuloParaAEquipe } from "@/lib/contacts/rotulo-do-contato";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org: activeOrg } = authz;

  const supabase = await createClient();

  // 1. Busca conversa e contato associado
  const { data: convData, error: convErr } = await supabase
    .from("conversations")
    .select("id, contact_id, status, contacts(id, name, display_name, phone_number)")
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (convErr || !convData) {
    return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  }

  // 2. Busca últimas 20 mensagens da conversa
  const { data: messagesData, error: msgErr } = await supabase
    .from("messages")
    .select("id, direction, body, media_derived_text, sent_at")
    .eq("conversation_id", id)
    .eq("organization_id", activeOrg.orgId)
    .order("sent_at", { ascending: false })
    .limit(20);

  if (msgErr) {
    return fail("internal_error", msgErr.message, 500, { requestId });
  }

  // 3. Busca últimas 5 notas internas
  const { data: notesData } = await supabase
    .from("conversation_notes")
    .select("id, body, created_at")
    .eq("conversation_id", id)
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false })
    .limit(5);

  const messages = (messagesData ?? []).reverse();
  const notes = notesData ?? [];

  const contactName = rotuloParaAEquipe(
    convData.contacts as unknown as { display_name?: string | null; name?: string | null; phone_number?: string | null } | null,
    t,
  );

  // Sintetiza resumo estruturado
  const inbounds = messages.filter((m) => m.direction === "inbound" && (m.body || m.media_derived_text));
  const outbounds = messages.filter((m) => m.direction === "outbound" && (m.body || m.media_derived_text));

  const ultimaInbound = inbounds[inbounds.length - 1];
  const penultimaInbound = inbounds[inbounds.length - 2];
  const ultimaOutbound = outbounds[outbounds.length - 1];

  const ultimasFalasCliente = [penultimaInbound?.body, ultimaInbound?.body]
    .filter(Boolean)
    .map((txt) => `"${(txt ?? "").trim().slice(0, 100)}"`)
    .join("; ");

  const resumoLinhas: string[] = [
    `• Assunto principal: Atendimento em andamento com ${contactName}.`,
    ultimaInbound
      ? `• Solicitações do cliente: ${ultimasFalasCliente || "Cliente enviou mensagem recente solicitando informações."}`
      : `• Solicitações do cliente: Sem novas solicitações explícitas pendentes no momento.`,
    ultimaOutbound
      ? `• Decisões já tomadas: Equipe respondeu: "${(ultimaOutbound.body ?? "").trim().slice(0, 100)}".`
      : `• Decisões já tomadas: Nenhuma decisão final registrada recentemente.`,
    notes.length > 0
      ? `• Notas internas da equipe: ${(notes[0]?.body ?? "").trim().slice(0, 120)}`
      : `• Pendências: Esclarecer dúvidas em aberto e validar necessidades do cliente.`,
    `• Próxima ação esperada: Continuar o atendimento de forma contextualizada, cordial e sem saudações repetidas.`,
  ];

  const summary = resumoLinhas.join("\n");

  return ok(
    {
      conversation_id: id,
      summary,
      message_count: messages.length,
      note_count: notes.length,
    },
    { requestId },
  );
}

