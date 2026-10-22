/**
 * DEDUPLICAÇÃO DE CONTATOS (EVO-CRM-V2)
 *
 * Previne cadastros duplicados por tenant com base em identificadores confiáveis:
 *  1. ID externo / canal (external_id)
 *  2. Contato vinculado à conversa existente
 *  3. Telefone / WhatsApp normalizado (E.164 / BR)
 *  4. E-mail normalizado (lowercase trimmed)
 *
 * ⚠️ NUNCA casa duplicados apenas pelo nome.
 * ⚠️ Multi-tenant: SEMPRE filtra explicitamente por organization_id.
 * ⚠️ Preserva contatos fundidos: ignora is_merged_into is not null.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalPhoneBR, normalizePhoneBR } from "@/lib/channels/phone-variants";
import { encontrarContatoPorTelefone } from "@/lib/channels/contato-por-telefone";

export interface LocalizarContatoInput {
  phone?: string | null;
  email?: string | null;
  externalId?: string | null;
  conversationId?: string | null;
}

export interface ContatoLocalizado {
  id: string;
  organization_id: string;
  name: string | null;
  display_name: string | null;
  email: string | null;
  phone_number: string | null;
  custom_fields?: Record<string, unknown> | null;
}

/** Normaliza número de telefone removendo pontuações e aplicando formato canônico quando aplicável. */
export function normalizarTelefone(raw?: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  const limpo = raw.trim();
  const digits = limpo.replace(/\D/g, "");
  if (!digits || digits.length < 8) return null;
  const br = normalizePhoneBR(limpo);
  if (br) return br;
  return canonicalPhoneBR(limpo.startsWith("+") ? limpo : `+${digits}`);
}

/** Normaliza e-mail para caixa baixa sem espaços nas pontas. */
export function normalizarEmail(raw?: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  const limpo = raw.trim().toLowerCase();
  if (!limpo.includes("@") || limpo.length < 5) return null;
  return limpo;
}

/**
 * Localiza um contato existente pelos critérios canônicos, na ordem de especificidade.
 * Retorna null se não encontrar nenhum contato correspondente.
 */
export async function localizarContatoExistente(
  supabase: SupabaseClient,
  orgId: string,
  params: LocalizarContatoInput,
): Promise<ContatoLocalizado | null> {
  if (!orgId) return null;

  // 1. Identificador externo
  const extId = params.externalId?.trim();
  if (extId) {
    const { data: porExt } = await supabase
      .from("contacts")
      .select("id, organization_id, name, display_name, email, phone_number, custom_fields")
      .eq("organization_id", orgId)
      .eq("external_id", extId)
      .is("is_merged_into", null)
      .maybeSingle();

    if (porExt) return porExt as ContatoLocalizado;
  }

  // 2. Contato vinculado à conversa informada
  const convId = params.conversationId?.trim();
  if (convId) {
    const { data: conv } = await supabase
      .from("conversations")
      .select("contact_id")
      .eq("organization_id", orgId)
      .eq("id", convId)
      .maybeSingle();

    if (conv?.contact_id) {
      const { data: porConv } = await supabase
        .from("contacts")
        .select("id, organization_id, name, display_name, email, phone_number, custom_fields")
        .eq("organization_id", orgId)
        .eq("id", conv.contact_id)
        .is("is_merged_into", null)
        .maybeSingle();

      if (porConv) return porConv as ContatoLocalizado;
    }
  }

  // 3. Telefone / WhatsApp normalizado
  const telNorm = normalizarTelefone(params.phone);
  if (telNorm) {
    const achado = await encontrarContatoPorTelefone(supabase, orgId, telNorm);
    if (achado?.id) {
      const { data: porTel } = await supabase
        .from("contacts")
        .select("id, organization_id, name, display_name, email, phone_number, custom_fields")
        .eq("organization_id", orgId)
        .eq("id", achado.id)
        .is("is_merged_into", null)
        .maybeSingle();

      if (porTel) return porTel as ContatoLocalizado;
    }
  }

  // 4. E-mail normalizado
  const emailNorm = normalizarEmail(params.email);
  if (emailNorm) {
    const { data: porEmail } = await supabase
      .from("contacts")
      .select("id, organization_id, name, display_name, email, phone_number, custom_fields")
      .eq("organization_id", orgId)
      .or(`email_normalized.eq.${emailNorm},email.eq.${emailNorm}`)
      .is("is_merged_into", null)
      .limit(1)
      .maybeSingle();

    if (porEmail) return porEmail as ContatoLocalizado;
  }

  // NUNCA casa apenas por nome.
  return null;
}

/**
 * Atualiza apenas campos complementares FALTANTES no contato existente.
 * Não sobrescreve dados existentes sem autorização explícita.
 */
export async function mesclarDadosComplementares(
  supabase: SupabaseClient,
  orgId: string,
  contactId: string,
  novosDados: {
    name?: string | null;
    display_name?: string | null;
    email?: string | null;
    phone_number?: string | null;
    custom_fields?: Record<string, unknown> | null;
  },
): Promise<void> {
  const { data: atual } = await supabase
    .from("contacts")
    .select("name, display_name, email, phone_number, custom_fields")
    .eq("organization_id", orgId)
    .eq("id", contactId)
    .maybeSingle();

  if (!atual) return;

  const patch: Record<string, unknown> = {};

  if (!atual.name && novosDados.name?.trim()) {
    patch.name = novosDados.name.trim();
  }
  if (!atual.display_name && novosDados.display_name?.trim()) {
    patch.display_name = novosDados.display_name.trim();
  }
  if (!atual.email && novosDados.email?.trim()) {
    const norm = normalizarEmail(novosDados.email);
    if (norm) {
      patch.email = novosDados.email.trim();
      patch.email_normalized = norm;
    }
  }
  if (!atual.phone_number && novosDados.phone_number?.trim()) {
    const normTel = normalizarTelefone(novosDados.phone_number);
    if (normTel) patch.phone_number = normTel;
  }
  if (novosDados.custom_fields && Object.keys(novosDados.custom_fields).length > 0) {
    const cfExistentes = (atual.custom_fields as Record<string, unknown>) ?? {};
    patch.custom_fields = { ...cfExistentes, ...novosDados.custom_fields };
  }

  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString();
    await supabase
      .from("contacts")
      .update(patch)
      .eq("organization_id", orgId)
      .eq("id", contactId);
  }
}
