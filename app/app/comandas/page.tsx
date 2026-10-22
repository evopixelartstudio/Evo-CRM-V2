import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Redirecionamento legado: o módulo de Comandas foi substituído integralmente
 * pelo módulo de Financeiro Integrado (/app/financeiro).
 */
export default async function Page() {
  redirect("/app/financeiro");
}
