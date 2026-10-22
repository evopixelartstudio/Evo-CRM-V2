import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import {
  HERMES_SERVICE_ACCOUNT_NAME,
  HERMES_DOMAIN_PERMISSIONS,
} from "@/lib/hermes/service-account";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "hermes_status" });
  if (!authz.ok) return authz.response;

  const { org: activeOrg } = authz;
  const supabase = await createClient();

  // Busca token ativo do Hermes
  const { data: hermesToken, error: tokenErr } = await supabase
    .from("api_tokens")
    .select("id, name, prefix, scopes, last_used_at, expires_at, revoked_at, created_at")
    .eq("organization_id", activeOrg.orgId)
    .eq("name", HERMES_SERVICE_ACCOUNT_NAME)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (tokenErr) {
    return fail("internal_error", tokenErr.message, 500, { requestId });
  }

  // Busca logs recentes de operações do Hermes
  let recentLogs: unknown[] = [];
  if (hermesToken) {
    const { data: logs } = await supabase
      .from("api_audit_log")
      .select("id, action, resource_type, resource_id, metadata, request_id, created_at")
      .eq("organization_id", activeOrg.orgId)
      .eq("actor_api_token_id", hermesToken.id)
      .order("created_at", { ascending: false })
      .limit(10);
    recentLogs = logs ?? [];
  }

  return ok(
    {
      configured: !!hermesToken,
      service_account_name: HERMES_SERVICE_ACCOUNT_NAME,
      mcp_endpoint: "/api/mcp",
      token: hermesToken ?? null,
      domains: HERMES_DOMAIN_PERMISSIONS,
      recent_operations: recentLogs,
    },
    { requestId },
  );
}

