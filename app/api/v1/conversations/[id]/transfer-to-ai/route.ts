import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/conversations/[id]/transfer-to-ai
 *
 * Endpoint dedicado para a transferência inteligente de atendimento do operador humano
 * para um agente de IA específico, acompanhado de contexto, objetivo e resumo da conversa.
 *
 * Auth: cookie session, role >= agent.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { devolverAtendimentoAoAgente } from "@/lib/escalacao/retomada";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

const TransferToAiSchema = z.object({
  agent_id: z.string().uuid({ message: "ID do agente inválido." }),
  context_note: z.string().max(4000).optional().nullable(),
  objective: z.string().max(500).optional().nullable(),
  summary: z.string().max(4000).optional().nullable(),
});

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user: authUser, org: activeOrg } = authz;

  let body: z.infer<typeof TransferToAiSchema>;
  try {
    const raw = await req.json();
    const parsed = TransferToAiSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(
        "bad_request",
        parsed.error.issues[0]?.message ?? t("Parâmetros de transferência inválidos."),
        400,
        { requestId },
      );
    }
    body = parsed.data;
  } catch {
    return fail("bad_request", t("Corpo JSON inválido."), 400, { requestId });
  }

  const supabase = await createClient();

  const resultado = await devolverAtendimentoAoAgente(
    {
      supabase,
      organizationId: activeOrg.orgId,
      actor: { type: "user", id: authUser.id, role: activeOrg.role },
      requestId,
    },
    {
      conversationId: id,
      targetAgentId: body.agent_id,
      contextNote: body.context_note ?? null,
      objective: body.objective ?? null,
      summary: body.summary ?? null,
    },
  );

  if (!resultado.ok) {
    if (resultado.erro === "conversation_not_found") {
      return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
    }
    if (resultado.erro === "agent_not_found") {
      return fail(
        "bad_request",
        resultado.detalhe ?? t("Agente selecionado não existe ou não está ativo nesta organização."),
        400,
        { requestId },
      );
    }
    if (resultado.erro === "assignment_conflict") {
      return fail(
        "state_conflict",
        t("Alguém assumiu esta conversa agora — recarregue e tente de novo."),
        409,
        { requestId },
      );
    }
    if (resultado.erro === "contato_sempre_humano") {
      return fail(
        "state_conflict",
        t("Este contato está marcado como sempre atendimento humano. Para a IA voltar a atendê-lo, remova a marca na ficha do contato."),
        409,
        { requestId },
      );
    }
    if (resultado.erro === "contact_state_unreadable") {
      return fail(
        "internal_error",
        t("Não foi possível conferir o contato desta conversa — nada foi alterado. Tente de novo."),
        500,
        { requestId },
      );
    }
    return fail(
      "internal_error",
      t("Atendimento devolvido, mas o sinal de retomada do acompanhamento falhou — tente de novo."),
      500,
      { requestId },
    );
  }

  return ok(
    {
      transferred: true,
      agent_id: body.agent_id,
      continuidade: {
        houve_atendimento_humano: resultado.continuidade.houveAtendimentoHumano,
        resumo: resultado.continuidade.resumo,
        decisoes: resultado.continuidade.decisoes.length,
        notas: resultado.continuidade.notas.length,
      },
    },
    { requestId },
  );
}

