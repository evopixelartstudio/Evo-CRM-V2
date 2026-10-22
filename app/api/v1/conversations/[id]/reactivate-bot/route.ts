import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/conversations/[id]/reactivate-bot
 *
 * Devolve o atendimento ao agente. A REGRA vive em
 * `lib/escalacao/retomada.ts` — esta rota só resolve autenticação, org e a
 * tradução do resultado para HTTP.
 *
 * Ela foi extraída (Decisão 4 do briefing IA 360: a tool é fachada fina sobre a
 * regra que já existe) porque a mesma devolução precisa acontecer por dois
 * caminhos — a pessoa clicando aqui e a capacidade exposta ao agente. Regra
 * duplicada nos dois lados faria o sistema mentir para um deles.
 *
 * Ao extrair, apareceu o defeito: esta rota limpava só `bot_silenced_until` e
 * respondia `{ reactivated: true }` com o agente ainda travado por
 * `contacts.force_human` e por `assignee_kind='user'`. O conserto está na função;
 * o histórico do defeito, no cabeçalho dela.
 *
 * Auth: cookie session, role >= agent. Audit: `ai.reactivated_by_agent`.
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

const TransferBodySchema = z.object({
  agent_id: z.string().uuid().optional().nullable(),
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

  let body: z.infer<typeof TransferBodySchema> = {};
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = TransferBodySchema.safeParse(raw);
    if (parsed.success) {
      body = parsed.data;
    }
  } catch {
    body = {};
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
      targetAgentId: body.agent_id ?? null,
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
    // #2379: a marca permanente recusou ANTES de qualquer escrita — nada foi
    // devolvido, então a mensagem genérica abaixo ("Atendimento devolvido…")
    // mentiria e convidaria a repetir um gesto que vai recusar de novo.
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
    // A devolução em si já aconteceu; o que falhou foi o sinal que retoma um
    // acompanhamento pausado. Repetir a chamada é seguro (tudo é idempotente).
    return fail(
      "internal_error",
      t("Atendimento devolvido, mas o sinal de retomada do acompanhamento falhou — tente de novo."),
      500,
      { requestId },
    );
  }

  return ok(
    {
      reactivated: true,
      // O que a pessoa fez vai junto: quem chamou consegue mostrar na tela que o
      // agente não voltou cego.
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
