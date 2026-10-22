import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import { createClient } from "@/lib/supabase/server";

import { FinanceiroClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");

  const supabase = await createClient();
  const moeda = await moedaDaOrganizacao(supabase, org.orgId);

  // Buscar contas financeiras ativas para seleção nos pagamentos
  const { data: contas } = await supabase
    .from("financial_accounts")
    .select("id, name, is_active")
    .eq("organization_id", org.orgId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  const podeCriar = ROLE_RANK[org.role] >= ROLE_RANK.agent;
  const podeEstornar = ROLE_RANK[org.role] >= ROLE_RANK.manager;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
      <FinanceiroClient
        moeda={moeda}
        podeCriar={podeCriar}
        podeEstornar={podeEstornar}
        contas={contas ?? []}
      />
    </div>
  );
}
