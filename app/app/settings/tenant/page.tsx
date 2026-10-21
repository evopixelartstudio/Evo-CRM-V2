import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { alineasDoArt15Visiveis } from "@/lib/legal/art15";
import type { TenantInput } from "@/lib/schemas/settings";

import { TenantForm } from "./_form";
import { InterfaceDaEmpresaForm } from "./_interface";
import { Art15Form } from "./_art15";
import { ZonaDePerigoDaOrganizacao } from "./_danger-zone";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Configurações da Empresa" };

export default async function TenantSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const admin = createAdminClient();
  const { data: org, error } = await admin
    .from("organizations")
    .select("*")
    .eq("id", activeOrg.orgId)
    .single();

  if (error || !org) {
    redirect("/app");
  }

  const initial: TenantInput = {
    display_name: org.display_name,
    legal_name: org.legal_name,
    cnpj: org.cnpj ?? null,
    country: org.country ?? null,
    timezone: org.timezone ?? "America/Sao_Paulo",
    locale: org.locale ?? "pt-BR",
    currency: org.currency ?? "BRL",
    media_retention_days: org.media_retention_days ?? 30,
    media_retention_enforced: org.media_retention_enforced ?? true,
    dpo_email: org.dpo_email ?? null,
    privacy_policy_url: org.privacy_policy_url ?? null,
  };

  const podeVerArt15 = alineasDoArt15Visiveis(org.country);
  const isAdmin = ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações da Empresa</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie os dados cadastrais, fuso horário, moeda e preferências da organização.
        </p>
      </header>

      <TenantForm initial={initial} />
      <InterfaceDaEmpresaForm initial={org.interface_settings} role={activeOrg.role} />
      {podeVerArt15 && <Art15Form />}
      {isAdmin && <ZonaDePerigoDaOrganizacao displayName={org.display_name} />}
    </div>
  );
}
