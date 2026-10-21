import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/channels/partner — estado da conexão parceira + o que colar no provedor.
 * POST /api/v1/channels/partner — VALIDA a credencial e só então grava.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import {
  findPartnerSession,
  PARTNER_CHANNEL_LABEL,
  savePartnerSession,
  validatePartnerCredentials,
} from "@/lib/channels/connect";
import { traduzirLimiteDoPlano } from "@/lib/cobranca/limites";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import { basePublicaDaInstalacao } from "@/lib/webhooks/url-publica";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

const conectarSchema = z.object({
  account_id: z.string().trim().min(1),
  api_key: z.string().trim().min(10),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "channels" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const session = await findPartnerSession(admin, authz.org.orgId);

  const base = basePublicaDaInstalacao(req);
  const webhookUrl = session?.webhookPathToken
    ? `${base}/api/v1/webhooks/channel/${session.webhookPathToken}`
    : null;

  return ok(
    {
      label: PARTNER_CHANNEL_LABEL,
      connected: Boolean(session?.hasApiKey && session?.status === "WORKING"),
      account_id: session?.accountId ?? null,
      phone_number: session?.phoneNumber ?? null,
      display_name: session?.displayName ?? null,
      status: session?.status ?? null,
      has_api_key: session?.hasApiKey ?? false,
      webhook_url: webhookUrl,
    },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", t("JSON inválido."), 400, { requestId });
  }

  const parsed = conectarSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("invalid_request", t("Dados inválidos."), 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const { account_id, api_key } = parsed.data;

  // Validação externa contra a API do provedor ANTES de persistir
  const validacao = await validatePartnerCredentials({ accountId: account_id, apiKey: api_key });
  if (!validacao.ok) {
    return fail("bad_request", t(validacao.reason), 400, { requestId });
  }

  const admin = createAdminClient();
  const existente = await findPartnerSession(admin, orgId);

  const apiKeyEncrypted = await encryptWebhookSecret(admin, api_key);
  if (!apiKeyEncrypted) {
    return fail("internal_error", t("Falha ao cifrar credencial."), 500, { requestId });
  }

  const webhookSecret = `whsec_${randomBytes(24).toString("hex")}`;
  const webhookSecretEncrypted = await encryptWebhookSecret(admin, webhookSecret);
  if (!webhookSecretEncrypted) {
    return fail("internal_error", t("Falha ao cifrar segredo do webhook."), 500, { requestId });
  }

  const webhookPathToken = existente?.webhookPathToken || randomBytes(16).toString("hex");

  // Nome dado pelo operador tem precedência sobre o do provedor na reconexão
  const displayName =
    existente?.displayName || validacao.displayName || validacao.phoneNumber || PARTNER_CHANNEL_LABEL;

  const { error } = await savePartnerSession(admin, {
    organizationId: orgId,
    existingId: existente?.id ?? null,
    accountId: account_id,
    apiKeyEncrypted,
    webhookPathToken,
    webhookSecretEncrypted,
    phoneNumber: validacao.phoneNumber,
    displayName,
  });

  if (error) {
    const limite = traduzirLimiteDoPlano(error, authz.user.idioma);
    if (limite) return fail(limite.code, limite.message, 409, { requestId, details: limite.details });
    return fail("internal_error", error, 500, { requestId });
  }

  void audit({
    action: "channel.connected",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "channel_session",
    resourceId: existente?.id ?? orgId,
    requestId,
  });

  const base = basePublicaDaInstalacao(req);
  const webhookUrl = `${base}/api/v1/webhooks/channel/${webhookPathToken}`;

  return ok(
    {
      webhook_url: webhookUrl,
      webhook_secret: webhookSecret,
      phone_number: validacao.phoneNumber,
      quality_rating: validacao.qualityRating,
    },
    { requestId },
  );
}
