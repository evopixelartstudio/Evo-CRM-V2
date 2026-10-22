import { describe, expect, it, vi } from "vitest";
import { prospectingInputSchema } from "@/lib/prospecting/schema";
import { deleteCampaign, contactSingleCandidate } from "@/lib/prospecting/store";
import { ProspectingError } from "@/lib/prospecting/provider";

describe("prospecting - exclusão de campanha e contato individual", () => {
  it("valida ações delete_campaign e contact_single no schema Zod", () => {
    const delParsed = prospectingInputSchema.safeParse({
      action: "delete_campaign",
      id: "10000000-0000-4000-8000-000000000001",
    });
    expect(delParsed.success).toBe(true);

    const singleParsed = prospectingInputSchema.safeParse({
      action: "contact_single",
      id: "10000000-0000-4000-8000-000000000001",
      candidate_id: "20000000-0000-4000-8000-000000000002",
    });
    expect(singleParsed.success).toBe(true);
  });

  it("recusa delete_campaign e contact_single com parâmetros inválidos", () => {
    expect(
      prospectingInputSchema.safeParse({
        action: "delete_campaign",
        id: "invalido",
      }).success,
    ).toBe(false);

    expect(
      prospectingInputSchema.safeParse({
        action: "contact_single",
        id: "10000000-0000-4000-8000-000000000001",
        candidate_id: "invalido",
      }).success,
    ).toBe(false);
  });

  it("deleteCampaign exclui a campanha sob o lock da organização", async () => {
    const executedQueries: string[] = [];
    const poolMock = {
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
          executedQueries.push(sql);
          if (sql.includes("pg_try_advisory_lock")) {
            return Promise.resolve({ rows: [{ locked: true }] });
          }
          if (sql.includes("select id, name, status from prospecting_campaigns")) {
            return Promise.resolve({
              rows: [{ id: params?.[1], name: "Campanha Teste", status: "draft" }],
            });
          }
          if (sql.includes("delete from prospecting_campaigns")) {
            return Promise.resolve({ rowCount: 1 });
          }
          return Promise.resolve({ rows: [] });
        }),
        release: vi.fn(),
      }),
    };

    const res = await deleteCampaign(
      poolMock as any,
      "org-1",
      "10000000-0000-4000-8000-000000000001",
    );

    expect(res.deleted).toBe(true);
    expect(res.name).toBe("Campanha Teste");
    expect(executedQueries.some((q) => q.includes("delete from prospecting_campaigns"))).toBe(true);
  });

  it("contactSingleCandidate recusa candidato sem telefone brasileiro", async () => {
    const poolMock = {
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("pg_try_advisory_lock")) {
            return Promise.resolve({ rows: [{ locked: true }] });
          }
          if (sql.includes("from prospecting_campaigns")) {
            return Promise.resolve({
              rows: [
                {
                  id: "c-1",
                  organization_id: "org-1",
                  name: "Campanha A",
                  config: null,
                },
              ],
            });
          }
          if (sql.includes("from prospecting_candidates")) {
            return Promise.resolve({
              rows: [
                {
                  id: "cand-1",
                  organization_id: "org-1",
                  campaign_id: "c-1",
                  data: { name: "Empresa Sem Tel", phone: null },
                  phone: null,
                },
              ],
            });
          }
          return Promise.resolve({ rows: [] });
        }),
        release: vi.fn(),
      }),
    };

    await expect(
      contactSingleCandidate(poolMock as any, {} as any, "org-1", "c-1", "cand-1"),
    ).rejects.toThrow("Esta empresa não possui telefone brasileiro válido");
  });

  it("contactSingleCandidate move lead para Primeiro Contato e retorna whatsapp_url", async () => {
    const executedQueries: { sql: string; params?: unknown[] }[] = [];
    const poolMock = {
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
          executedQueries.push({ sql, params });
          if (sql.includes("pg_try_advisory_lock")) {
            return Promise.resolve({ rows: [{ locked: true }] });
          }
          if (sql.includes("from prospecting_campaigns")) {
            return Promise.resolve({
              rows: [
                {
                  id: "c-1",
                  organization_id: "org-1",
                  name: "Campanha Teste",
                  config: {
                    pipeline_id: "pipe-1",
                    stage_id: "stage-primeiro-contato",
                    channel_session_id: "chan-1",
                    agent_id: "agent-1",
                  },
                },
              ],
            });
          }
          if (sql.includes("from prospecting_candidates")) {
            return Promise.resolve({
              rows: [
                {
                  id: "cand-1",
                  organization_id: "org-1",
                  campaign_id: "c-1",
                  data: { name: "Padaria Modelo", phone: "(11) 98765-4321", key: "place-1" },
                  phone: "+5511987654321",
                  contact_id: "contact-123",
                  lead_id: "lead-existing-456",
                  conversation_id: "conv-789",
                },
              ],
            });
          }
          if (sql.includes("from crm_stages")) {
            return Promise.resolve({
              rows: [{ id: "stage-primeiro-contato", pipeline_id: "pipe-1", name: "Primeiro contato" }],
            });
          }
          if (sql.includes("update crm_leads set stage_id")) {
            return Promise.resolve({ rowCount: 1 });
          }
          if (sql.includes("update prospecting_candidates")) {
            return Promise.resolve({ rowCount: 1 });
          }
          return Promise.resolve({ rows: [] });
        }),
        release: vi.fn(),
      }),
    };

    const res = await contactSingleCandidate(poolMock as any, {} as any, "org-1", "c-1", "cand-1");

    expect(res.success).toBe(true);
    expect(res.whatsapp_url).toBe("https://wa.me/5511987654321");
    expect(res.contact_id).toBe("contact-123");
    expect(res.lead_id).toBe("lead-existing-456");
    expect(res.stage_id).toBe("stage-primeiro-contato");

    // Verifica que moveu o lead para a etapa de Primeiro Contato
    const updateLead = executedQueries.find((q) => q.sql.includes("update crm_leads set stage_id"));
    expect(updateLead).toBeDefined();
    expect(updateLead?.params).toContain("stage-primeiro-contato");

    // Verifica que atualizou o candidato como abordado/sent
    const updateCand = executedQueries.find((q) => q.sql.includes("update prospecting_candidates"));
    expect(updateCand).toBeDefined();
  });
});

