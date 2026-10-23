import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { provisionHermesServiceAccount } from "@/lib/hermes/service-account";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "hermes_provision" });
  if (!authz.ok) return authz.response;

  const { user: authUser, org: activeOrg } = authz;
  const supabase = await createClient();

  try {
    const result = await provisionHermesServiceAccount(supabase, {
      organizationId: activeOrg.orgId,
      createdByUserId: authUser.id,
    });

    const mcpConfigSnippet = {
      mcpServers: {
        evocrm: {
          url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/mcp`,
          headers: {
            Authorization: `Bearer ${result.plaintext_token}`,
          },
        },
      },
    };

    return ok(
      {
        ...result,
        mcp_config_snippet: mcpConfigSnippet,
        _warning: "Guarde este token em local seguro. Ele não será exibido novamente.",
      },
      { status: 201, requestId },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Falha ao provisionar Hermes Service Account.";
    return fail("internal_error", msg, 500, { requestId });
  }
}
