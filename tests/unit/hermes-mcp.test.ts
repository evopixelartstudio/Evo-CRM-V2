import { describe, expect, it, vi } from "vitest";
import {
  HERMES_SERVICE_ACCOUNT_NAME,
  HERMES_ACTOR_TAG,
  ALL_HERMES_PERMISSIONS,
  HERMES_DOMAIN_PERMISSIONS,
  HERMES_FULL_SCOPES,
  assertNotSelfModification,
} from "@/lib/hermes/service-account";
import { sanitizeSecrets } from "@/lib/mcp/tools/hermes";
import { TOOLS_HERMES } from "@/lib/mcp/tools/catalogo/hermes";
import { allTools, getToolByName } from "@/lib/mcp/tools";
import { ApiError } from "@/lib/api/types";
import type { McpContext } from "@/lib/mcp/types";

describe("Hermes Service Account & Governança Técnica", () => {
  it("possui identidade técnica padronizada e tag de ator", () => {
    expect(HERMES_SERVICE_ACCOUNT_NAME).toBe("Hermes Gerente Técnico EvoPixel");
    expect(HERMES_ACTOR_TAG).toBe("service_account:hermes");
  });

  it("cobre os 12 domínios operacionais da EvoPixel", () => {
    const domainNames = Object.keys(HERMES_DOMAIN_PERMISSIONS);
    expect(domainNames.length).toBe(12);
    expect(domainNames).toContain("contacts");
    expect(domainNames).toContain("leads");
    expect(domainNames).toContain("pipelines");
    expect(domainNames).toContain("products");
    expect(domainNames).toContain("tasks");
    expect(domainNames).toContain("notes");
    expect(domainNames).toContain("conversations");
    expect(domainNames).toContain("messages");
    expect(domainNames).toContain("agents");
    expect(domainNames).toContain("automations");
    expect(domainNames).toContain("reports");
    expect(domainNames).toContain("admin");
  });

  it("declara todos os escopos necessários com papel de admin e ator ai_agent", () => {
    expect(HERMES_FULL_SCOPES).toContain("role:admin");
    expect(HERMES_FULL_SCOPES).toContain("actor:ai_agent");
    expect(HERMES_FULL_SCOPES).toContain("mcp:read");
    expect(HERMES_FULL_SCOPES).toContain("mcp:write");
    for (const perm of ALL_HERMES_PERMISSIONS) {
      expect(HERMES_FULL_SCOPES).toContain(perm);
    }
  });

  it("impede auto-modificação de credenciais pelo próprio Hermes", () => {
    const hermesId = "11111111-1111-4111-8111-111111111111";
    const otherId = "22222222-2222-4222-8222-222222222222";

    // Modificação de outro token é permitida
    expect(() => assertNotSelfModification(hermesId, otherId)).not.toThrow();

    // Auto-modificação lança erro 403 forbidden
    expect(() => assertNotSelfModification(hermesId, hermesId)).toThrowError(ApiError);
    try {
      assertNotSelfModification(hermesId, hermesId);
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(403);
      expect(apiErr.code).toBe("forbidden");
    }
  });

  it("sanitiza recursivamente senhas, hashes e segredos em respostas MCP", () => {
    const raw = {
      user_id: "u-123",
      nome: "Contato Teste",
      token_hash: "hash_secreto_super_sensivel",
      password_encrypted: "cifrado_123",
      api_key: "ak_live_9999",
      secret: "super_secret",
      sub_obj: {
        normal_field: "visivel",
        auth_token: "bearer_xyz",
      },
      array_list: [{ private_key: "pk_123", status: "ok" }],
    };

    const sanitized = sanitizeSecrets(raw);
    expect(sanitized.user_id).toBe("u-123");
    expect(sanitized.nome).toBe("Contato Teste");
    expect(sanitized.token_hash).toBe("[PROTEGIDO]");
    expect(sanitized.password_encrypted).toBe("[PROTEGIDO]");
    expect(sanitized.api_key).toBe("[PROTEGIDO]");
    expect(sanitized.secret).toBe("[PROTEGIDO]");
    expect(sanitized.sub_obj.normal_field).toBe("visivel");
    expect(sanitized.sub_obj.auth_token).toBe("[PROTEGIDO]");
    expect(sanitized.array_list[0]!.status).toBe("ok");
    expect(sanitized.array_list[0]!.private_key).toBe("[PROTEGIDO]");
  });
});

describe("Catálogo e Handlers das MCP Tools do Hermes", () => {
  it("todas as 50 tools do catálogo possuem handlers registrados em allTools", () => {
    expect(TOOLS_HERMES.length).toBe(50);
    for (const tool of TOOLS_HERMES) {
      const handlerDef = getToolByName(tool.name);
      expect(handlerDef, `Tool ${tool.name} não possui handler registrado`).toBeDefined();
      expect(handlerDef?.category).toBe(tool.category);
      if (tool.category === "read") {
        expect(handlerDef?.requiresScope).toBe("mcp:read");
      } else {
        expect(handlerDef?.requiresScope).toBe("mcp:write");
      }
    }
  });

  it("handler crm_list_contacts filtra rigorosamente por organization_id e sanitiza dados", async () => {
    const listContacts = getToolByName("crm_list_contacts");
    expect(listContacts).toBeDefined();

    let capturedOrgId = "";
    const fakeSupabase = {
      from: vi.fn((table: string) => {
        expect(table).toBe("contacts");
        const builder: Record<string, unknown> = {
          select: vi.fn(() => builder),
          eq: vi.fn((col: string, val: string) => {
            if (col === "organization_id") capturedOrgId = val;
            return builder;
          }),
          or: vi.fn(() => builder),
          order: vi.fn(() => builder),
          limit: vi.fn(() =>
            Promise.resolve({
              data: [
                {
                  id: "c-1",
                  name: "Cliente Evo",
                  phone: "+5511999999999",
                  token_hash: "vazamento_indesejado",
                },
              ],
              error: null,
            }),
          ),
        };
        return builder;
      }),
    };

    const ctx: McpContext = {
      organizationId: "org-evopixel-123",
      role: "admin",
      actor: { type: "api_token", id: "tok-hermes" },
      apiTokenId: "tok-hermes",
      requestId: "req-test-1",
      supabase: fakeSupabase as unknown as McpContext["supabase"],
    };

    const result = (await listContacts!.handler(
      { limit: 10, is_archived: false },
      ctx,
    )) as { contacts: Array<Record<string, unknown>> };

    expect(capturedOrgId).toBe("org-evopixel-123");
    expect(result.contacts.length).toBe(1);
    expect(result.contacts[0]?.name).toBe("Cliente Evo");
    expect(result.contacts[0]?.token_hash).toBe("[PROTEGIDO]");
  });

  it("handler crm_create_customer_note grava autoria como ai_agent Hermes Gerente Técnico", async () => {
    const createNote = getToolByName("crm_create_customer_note");
    expect(createNote).toBeDefined();

    let insertedPayload: Record<string, unknown> | null = null;
    const fakeSupabase = {
      from: vi.fn((table: string) => {
        expect(table).toBe("customer_notes");
        return {
          insert: vi.fn((payload: Record<string, unknown>) => {
            insertedPayload = payload;
            return {
              select: vi.fn(() => ({
                single: vi.fn(() =>
                  Promise.resolve({
                    data: {
                      id: "note-123",
                      title: payload.title,
                      body: payload.body,
                      actor_name: payload.actor_name,
                      actor_kind: payload.actor_kind,
                      created_at: new Date().toISOString(),
                    },
                    error: null,
                  }),
                ),
              })),
            };
          }),
        };
      }),
    };

    const ctx: McpContext = {
      organizationId: "org-evopixel-123",
      role: "admin",
      actor: { type: "api_token", id: "tok-hermes" },
      apiTokenId: "tok-hermes",
      requestId: "req-test-2",
      supabase: fakeSupabase as unknown as McpContext["supabase"],
    };

    const res = (await createNote!.handler(
      {
        title: "Observação Estratégica",
        body: "Cliente prefere contato após as 14h.",
        contact_id: "c7fa5233-0c46-4a41-b016-56ffad7ff826",
      },
      ctx,
    )) as Record<string, unknown>;

    expect(insertedPayload).toBeDefined();
    expect(insertedPayload!.actor_kind).toBe("ai_agent");
    expect(insertedPayload!.actor_name).toBe("Hermes Gerente Técnico");
    expect(insertedPayload!.organization_id).toBe("org-evopixel-123");
    expect(res.title).toBe("Observação Estratégica");
  });
});
