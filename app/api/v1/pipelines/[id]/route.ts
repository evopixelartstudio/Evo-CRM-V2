import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET    /api/v1/pipelines/[id] — lê um funil.
 * PATCH  /api/v1/pipelines/[id] — edita, reordena ou desarquiva um funil.
 * DELETE /api/v1/pipelines/[id] — arquiva ou exclui definitivamente (?definitivo=1).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import {
  nomeOcupadoPorAtivo,
  podeExcluirDeVez,
  updatesDeMarcaExclusiva,
  validarArquivamento,
  validarNomeDeFunil,
} from "@/lib/pipelines/pipeline-editing";
import { createClient } from "@/lib/supabase/server";
import { conflitoDoBanco, corpo, lerDependencias, lerFunis } from "../_funis";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const patchSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(280).nullable().optional(),
    is_default: z.boolean().optional(),
    is_client_pipeline: z.boolean().optional(),
    is_archived: z.boolean().optional(),
    position: z.number().optional(),
  })
  .strict();

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("viewer", { requestId, resource: "pipelines" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_pipelines")
    .select("*")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();

  if (error) return fail("internal_error", t("Erro ao carregar funil."), 500, { requestId });
  if (!data) return fail("not_found", t("Funil não encontrado."), 404, { requestId });

  return ok(data, { requestId });
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("manager", { requestId, resource: "pipelines" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("invalid_request", t("Dados inválidos."), 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const supabase = await createClient();
  let funis = await lerFunis(supabase, orgId);
  const funil = funis.find((f) => f.id === id);
  if (!funil) {
    return fail("not_found", t("Esse funil não está mais na sua lista. Recarregue a página e tente de novo."), 404, {
      requestId,
    });
  }

  const mudancas = parsed.data;

  // Se o funil está arquivado
  if (funil.is_archived) {
    if (mudancas.is_archived === false) {
      // Desarquivar junto com outra mudança é recusado — pedido misto vira edição
      const outrasChaves = Object.keys(mudancas).filter((k) => k !== "is_archived");
      if (outrasChaves.length > 0) {
        return fail("state_conflict", t("Desarquive primeiro antes de editar."), 409, { requestId });
      }

      // Conflito com nome ativo (#2559)
      const ocupante = nomeOcupadoPorAtivo(funis, id);
      if (ocupante) {
        return fail(
          "state_conflict",
          t("Já existe um funil ativo chamado «{nome}». Renomeie um dos dois para poder desarquivar.").replace(
            "{nome}",
            ocupante,
          ),
          409,
          { requestId },
        );
      }

      const { error: updErr } = await supabase
        .from("crm_pipelines")
        .update({ is_archived: false })
        .eq("id", id)
        .eq("organization_id", orgId);

      if (updErr) {
        const conflito = conflitoDoBanco(updErr, funil.name, requestId);
        if (conflito) return conflito;
        return fail("internal_error", updErr.message, 500, { requestId });
      }

      void audit({
        action: "pipeline.unarchived",
        actorUserId: authz.user.id,
        organizationId: orgId,
        resourceType: "pipeline",
        resourceId: id,
        requestId,
      });

      funis = await lerFunis(supabase, orgId);
      return ok(corpo(funis), { requestId });
    }

    // Editar funil arquivado sem desarquivar é recusado com 409
    return fail("state_conflict", t("Esse funil está arquivado. Desarquive antes de editar."), 409, { requestId });
  }

  // Funil ATIVO: validar nome se veio
  if (mudancas.name !== undefined) {
    const validacaoNome = validarNomeDeFunil(mudancas.name, funis, id);
    if (!validacaoNome.ok) {
      return fail("invalid_request", t(validacaoNome.erro), 409, { requestId });
    }
  }

  // Updates de marca exclusiva (is_default ou is_client_pipeline)
  if (mudancas.is_default === true) {
    const updates = updatesDeMarcaExclusiva(funis, id, "is_default");
    for (const u of updates) {
      await supabase
        .from("crm_pipelines")
        .update(u.patch)
        .eq("id", u.pipelineId)
        .eq("organization_id", orgId);
    }
  }

  if (mudancas.is_client_pipeline === true) {
    const updates = updatesDeMarcaExclusiva(funis, id, "is_client_pipeline");
    for (const u of updates) {
      await supabase
        .from("crm_pipelines")
        .update(u.patch)
        .eq("id", u.pipelineId)
        .eq("organization_id", orgId);
    }
  }

  const patchFields: Record<string, unknown> = {};
  if (mudancas.name !== undefined) patchFields.name = mudancas.name;
  if (mudancas.description !== undefined) patchFields.description = mudancas.description;
  if (mudancas.is_default !== undefined) patchFields.is_default = mudancas.is_default;
  if (mudancas.is_client_pipeline !== undefined) patchFields.is_client_pipeline = mudancas.is_client_pipeline;
  if (mudancas.is_archived !== undefined) patchFields.is_archived = mudancas.is_archived;
  if (mudancas.position !== undefined) patchFields.position = mudancas.position;

  if (Object.keys(patchFields).length > 0) {
    const { error: updErr } = await supabase
      .from("crm_pipelines")
      .update(patchFields)
      .eq("id", id)
      .eq("organization_id", orgId);

    if (updErr) {
      const conflito = conflitoDoBanco(updErr, mudancas.name ?? funil.name, requestId);
      if (conflito) return conflito;
      return fail("internal_error", updErr.message, 500, { requestId });
    }
  }

  void audit({
    action: "pipeline.updated",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "pipeline",
    resourceId: id,
    requestId,
    metadata: mudancas,
  });

  funis = await lerFunis(supabase, orgId);
  return ok(corpo(funis), { requestId });
}

export async function DELETE(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("manager", { requestId, resource: "pipelines" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const definitivo = req.nextUrl.searchParams.get("definitivo") === "1";

  const supabase = await createClient();
  const funis = await lerFunis(supabase, orgId);
  const funil = funis.find((f) => f.id === id);
  if (!funil) {
    return fail("not_found", t("Esse funil não está mais na sua lista. Recarregue a página e tente de novo."), 404, {
      requestId,
    });
  }

  const deps = await lerDependencias(supabase, orgId, id);

  if (definitivo) {
    const pode = podeExcluirDeVez(funis, id, deps);
    if (!pode.ok) {
      return fail("invalid_request", t(pode.erro), 422, { requestId });
    }

    const { error: delErr } = await supabase
      .from("crm_pipelines")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId);

    if (delErr) return fail("internal_error", delErr.message, 500, { requestId });

    void audit({
      action: "pipeline.deleted",
      actorUserId: authz.user.id,
      organizationId: orgId,
      resourceType: "pipeline",
      resourceId: id,
      requestId,
    });

    const restantes = await lerFunis(supabase, orgId);
    return ok(corpo(restantes), { requestId });
  }

  // Arquivamento
  const pode = validarArquivamento(funis, id, deps);
  if (!pode.ok) {
    const msg = pode.erro.replace("{nome}", funil.name);
    return fail("invalid_request", t(msg), 422, { requestId });
  }

  const { error: arcErr } = await supabase
    .from("crm_pipelines")
    .update({ is_archived: true })
    .eq("id", id)
    .eq("organization_id", orgId);

  if (arcErr) return fail("internal_error", arcErr.message, 500, { requestId });

  void audit({
    action: "pipeline.archived",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "pipeline",
    resourceId: id,
    requestId,
  });

  const restantes = await lerFunis(supabase, orgId);
  return ok(corpo(restantes), { requestId });
}
