import { describe, expect, it, vi } from "vitest";

import type { McpContext } from "../types";
import { crmCloseConversation } from "./hermes";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";

function context(options: {
  lookup: Record<string, unknown> | null;
  lookupError?: { message: string; code?: string } | null;
  rpcData?: Record<string, unknown> | null;
  rpcError?: { message: string; code?: string } | null;
}) {
  const filters: Array<[string, unknown]> = [];
  const fromChain = {
    select: vi.fn(() => fromChain),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return fromChain;
    }),
    maybeSingle: vi.fn(async () => ({
      data: options.lookup,
      error: options.lookupError ?? null,
    })),
  };

  const supabase = {
    from: vi.fn(() => fromChain),
    rpc: vi.fn(async () => ({
      data: options.rpcData ?? null,
      error: options.rpcError ?? null,
    })),
  };

  return {
    supabase,
    filters,
    organizationId: ORGANIZATION_ID,
    role: "agent",
    actor: { type: "api_token", id: "token-test", role: "agent" },
    apiTokenId: "token-test",
    requestId: "request-test",
  } as unknown as McpContext & { filters: Array<[string, unknown]> };
}

const input = {
  conversation_id: CONVERSATION_ID,
  resolution_summary: "Teste de regressão",
};

describe("crm_close_conversation", () => {
  it("fecha pela fn_service_status usando service_revision", async () => {
    const ctx = context({
      lookup: {
        id: CONVERSATION_ID,
        organization_id: ORGANIZATION_ID,
        status: "open",
        service_revision: 7,
      },
      rpcData: {
        id: CONVERSATION_ID,
        status: "closed",
        service_closed_at: "2026-10-24T15:00:00.000Z",
        service_revision: 8,
      },
    });

    const result = await crmCloseConversation.handler(input, ctx);

    expect(ctx.supabase.rpc).toHaveBeenCalledWith("fn_service_status", {
      p_org: ORGANIZATION_ID,
      p_conversation: CONVERSATION_ID,
      p_status: "closed",
      p_expected: 7,
    });
    expect(ctx.filters).toEqual([
      ["id", CONVERSATION_ID],
      ["organization_id", ORGANIZATION_ID],
    ]);
    expect(result).toEqual({
      closed: true,
      conversation: {
        id: CONVERSATION_ID,
        status: "closed",
        service_closed_at: "2026-10-24T15:00:00.000Z",
        service_revision: 8,
      },
    });
  });

  it("mantém fechamento idempotente quando a conversa já está encerrada", async () => {
    const ctx = context({
      lookup: {
        id: CONVERSATION_ID,
        organization_id: ORGANIZATION_ID,
        status: "closed",
        service_revision: 8,
      },
      rpcData: {
        id: CONVERSATION_ID,
        status: "closed",
        service_closed_at: "2026-10-24T15:00:00.000Z",
        service_revision: 8,
      },
    });

    const result = await crmCloseConversation.handler(input, ctx);

    expect(result).toMatchObject({ closed: true });
    expect(ctx.supabase.rpc).toHaveBeenCalledWith(
      "fn_service_status",
      expect.objectContaining({ p_expected: 8, p_status: "closed" }),
    );
  });

  it("retorna not_found para ID inexistente", async () => {
    const ctx = context({ lookup: null });

    await expect(crmCloseConversation.handler(input, ctx)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
    expect(ctx.supabase.rpc).not.toHaveBeenCalled();
    expect(ctx.filters).toEqual([
      ["id", CONVERSATION_ID],
      ["organization_id", ORGANIZATION_ID],
    ]);
  });

  it("trata conversa de outra organização como inexistente", async () => {
    const ctx = context({
      lookup: null,
    });

    await expect(crmCloseConversation.handler(input, ctx)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
    expect(ctx.supabase.rpc).not.toHaveBeenCalled();
    expect(ctx.filters).toEqual([
      ["id", CONVERSATION_ID],
      ["organization_id", ORGANIZATION_ID],
    ]);
  });

  it("mapeia revisão concorrente para 409", async () => {
    const ctx = context({
      lookup: {
        id: CONVERSATION_ID,
        organization_id: ORGANIZATION_ID,
        status: "open",
        service_revision: 7,
      },
      rpcError: {
        code: "PT409",
        message: "service_stale",
      },
    });

    await expect(crmCloseConversation.handler(input, ctx)).rejects.toMatchObject({
      status: 409,
      code: "conflict",
    });
  });
});
