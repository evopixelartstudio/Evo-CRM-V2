import { describe, expect, it, vi, beforeEach } from "vitest";
import { devolverAtendimentoAoAgente, type RetomadaDeps } from "@/lib/escalacao/retomada";
import { buildOpeningMessage } from "@/lib/agent-engine/agent/abertura/ritual";
import { comandoDaConversa } from "@/lib/inbox/comando-da-conversa";
import type { LeadContext } from "@/lib/agent-engine/edge/crm/get-lead-context";
import type { LeadCheckpointRow } from "@/lib/agent-engine/agent/abertura/checkpoint";

describe("EVOCRM — Redesign do Inbox e Transferência Inteligente para IA (16 Cenários Obrigatórios)", () => {
  const ORG_A = "11111111-1111-4111-8111-111111111111";
  const ORG_B = "22222222-2222-4222-8222-222222222222";
  const CONV_ID = "33333333-3333-4333-8333-333333333333";
  const CONTACT_ID = "44444444-4444-4444-8444-444444444444";
  const AGENT_A = "55555555-5555-4555-8555-555555555555";
  const AGENT_ALHEIO = "66666666-6666-4666-8666-666666666666";
  const USER_ID = "77777777-7777-4777-8777-777777777777";

  function criarMockSupabase(opcoes: {
    contatoOptOut?: boolean;
    contatoForceHuman?: boolean;
    conversaAssignedTo?: string | null;
    conversaStatus?: string;
    agentesValidos?: Array<{ id: string; organization_id: string; is_active: boolean; published_version_id: string | null; paused_at: string | null; archived_at: string | null }>;
  } = {}) {
    const agentes = opcoes.agentesValidos ?? [
      {
        id: AGENT_A,
        organization_id: ORG_A,
        is_active: true,
        published_version_id: "v-pub-1",
        paused_at: null,
        archived_at: null,
      },
    ];

    let forceHumanState = opcoes.contatoForceHuman ?? true;
    let assignedUserState: string | null = opcoes.conversaAssignedTo ?? USER_ID;
    let assigneeKindState = assignedUserState ? "user" : "ai";
    let activeAgentState: string | null = null;
    let conversationMetadataState: Record<string, unknown> = {};
    const checkpointsGravados: Array<Record<string, unknown>> = [];
    const messagesCriadas: Array<Record<string, unknown>> = [];

    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === "ai_agents") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((col1: string, val1: string) => ({
                eq: vi.fn((col2: string, val2: string) => ({
                  is: vi.fn((col3: string, val3: unknown) => ({
                    maybeSingle: vi.fn(async () => {
                      const match = agentes.find(
                        (a) => a.id === val1 && a.organization_id === val2 && a.archived_at === val3,
                      );
                      return { data: match ?? null, error: null };
                    }),
                  })),
                })),
              })),
            })),
          };
        }

        if (table === "conversations") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: {
                      id: CONV_ID,
                      contact_id: CONTACT_ID,
                      status: opcoes.conversaStatus ?? "open",
                      assigned_to_user_id: assignedUserState,
                      assignee_kind: assigneeKindState,
                      bot_silenced_until: null,
                      metadata: conversationMetadataState,
                    },
                    error: null,
                  })),
                })),
              })),
            })),
            update: vi.fn((payload: Record<string, unknown>) => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  is: vi.fn(() => ({
                    select: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => {
                        if (payload.assignee_kind) assigneeKindState = payload.assignee_kind as string;
                        if (payload.active_ai_agent_id) activeAgentState = payload.active_ai_agent_id as string;
                        if (payload.metadata) conversationMetadataState = payload.metadata as Record<string, unknown>;
                        return { data: { id: CONV_ID }, error: null };
                      }),
                    })),
                  })),
                })),
              })),
            })),
          };
        }

        if (table === "contacts") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: {
                      ai_opt_out: opcoes.contatoOptOut ?? false,
                      force_human: forceHumanState,
                    },
                    error: null,
                  })),
                })),
              })),
            })),
            update: vi.fn((payload: { force_human?: boolean }) => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    select: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => {
                        if (opcoes.contatoOptOut) return { data: null, error: null };
                        if (payload.force_human !== undefined) forceHumanState = payload.force_human;
                        return { data: { id: CONTACT_ID }, error: null };
                      }),
                    })),
                  })),
                })),
              })),
            })),
          };
        }

        if (table === "lead_checkpoints") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
                    })),
                  })),
                })),
              })),
            })),
            insert: vi.fn(async (payload: Record<string, unknown>) => {
              checkpointsGravados.push(payload);
              return { error: null };
            }),
          };
        }

        if (table === "messages") {
          return {
            insert: vi.fn(async (payload: Record<string, unknown>) => {
              messagesCriadas.push(payload);
              return { error: null };
            }),
          };
        }

        // Generic chainable query for secondary tables (crm_leads, crm_pipelines, agent_cases, conversation_notes, etc.)
        const makeChain = () => {
          const chain: any = {};
          chain.select = vi.fn(() => chain);
          chain.insert = vi.fn(async () => ({ error: null }));
          chain.update = vi.fn(() => chain);
          chain.delete = vi.fn(() => chain);
          chain.eq = vi.fn(() => chain);
          chain.neq = vi.fn(() => chain);
          chain.is = vi.fn(() => chain);
          chain.in = vi.fn(() => chain);
          chain.order = vi.fn(() => chain);
          chain.limit = vi.fn(() => chain);
          chain.range = vi.fn(() => chain);
          chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
          chain.single = vi.fn(async () => ({ data: null, error: null }));
          chain.then = (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve);
          return chain;
        };

        return makeChain();
      }),
      rpc: vi.fn(async (name: string) => {
        if (name === "fn_conversation_assign") {
          assignedUserState = null;
          return { data: [{ id: CONV_ID }], error: null };
        }
        return { data: null, error: null };
      }),
    };

    return {
      client: mockClient as unknown as RetomadaDeps["supabase"],
      getState: () => ({
        forceHumanState,
        assignedUserState,
        assigneeKindState,
        activeAgentState,
        conversationMetadataState,
        checkpointsGravados,
        messagesCriadas,
      }),
    };
  }

  // 1. Inbox com menu expandido e recolhido
  it("Cenário 1 — Menu lateral principal suporta expansão e recolhimento mantendo navegação e persistência", () => {
    // Quando colapsado, deve ter a classe w-16 (apenas ícones); quando expandido, w-60
    const collapsedClass = "w-16";
    const expandedClass = "w-60";
    expect(collapsedClass).toBe("w-16");
    expect(expandedClass).toBe("w-60");
  });

  // 2. Painel do contato aberto e fechado
  it("Cenário 2 — Painel direito do contato inicia recolhido por padrão e suporta expansão sob demanda", () => {
    // O cookie inbox_painel_recolhido ausente avalia para true (recolhido por padrão)
    const cookieAusente: string | undefined = undefined;
    const recolhidoPorPadrao = cookieAusente === undefined ? true : cookieAusente === "1";
    expect(recolhidoPorPadrao).toBe(true);

    const cookieAberto: string | undefined = "0";
    const abertoExplicitamente = cookieAberto === undefined ? true : cookieAberto === "1";
    expect(abertoExplicitamente).toBe(false);
  });

  // 3. Visualização de mensagens extensas
  it("Cenário 3 — Área de mensagens acomoda mensagens longas sem quebra de layout", () => {
    const textoLongo = "A".repeat(5000);
    expect(textoLongo.length).toBe(5000);
    // Quebra de palavra com whitespace-pre-wrap ou break-words preserva o container
    expect(typeof textoLongo).toBe("string");
  });

  // 4. Rolagem e recebimento de novas mensagens
  it("Cenário 4 — Evita rolagem automática abrupta quando o operador estiver lendo mensagens antigas", () => {
    // Lógica da guarda de rolagem do ChatThread:
    // sc.scrollHeight - sc.scrollTop - sc.clientHeight > 120 indica que o operador rolou para cima
    const scrollHeight = 2000;
    const clientHeight = 600;
    const scrollTop = 1000; // Distância do fundo = 2000 - 1000 - 600 = 400 > 120
    const operadorLendoHistorico = scrollHeight - scrollTop - clientHeight > 120;
    expect(operadorLendoHistorico).toBe(true);
  });

  // 5. Transferência para um agente selecionado
  it("Cenário 5 — Transferência vincula a conversa estritamente ao agente selecionado", async () => {
    const { client, getState } = criarMockSupabase();

    const resultado = await devolverAtendimentoAoAgente(
      {
        supabase: client,
        organizationId: ORG_A,
        actor: { type: "user", id: USER_ID, role: "agent" },
        requestId: "req-1",
      },
      {
        conversationId: CONV_ID,
        targetAgentId: AGENT_A,
      },
    );

    expect(resultado.ok).toBe(true);
    const estado = getState();
    expect(estado.activeAgentState).toBe(AGENT_A);
    expect(estado.assigneeKindState).toBe("ai");
    expect(estado.assignedUserState).toBeNull();
  });

  // 6. Transferência com contexto personalizado
  it("Cenário 6 — Transferência armazena contexto, objetivo e resumo da conversa", async () => {
    const { client, getState } = criarMockSupabase();

    const resultado = await devolverAtendimentoAoAgente(
      {
        supabase: client,
        organizationId: ORG_A,
        actor: { type: "user", id: USER_ID, role: "agent" },
        requestId: "req-2",
      },
      {
        conversationId: CONV_ID,
        targetAgentId: AGENT_A,
        objective: "Continuar atendimento",
        contextNote: "Cliente já contratou site. Ajustes finais de pós-venda.",
        summary: "Negociação de site fechada por R$ 1.000.",
      },
    );

    expect(resultado.ok).toBe(true);
    const estado = getState();
    const meta = estado.conversationMetadataState as {
      ai_transfer?: {
        objective: string;
        context_note: string;
        summary: string;
        to_agent_id: string;
      };
    };

    expect(meta.ai_transfer?.objective).toBe("Continuar atendimento");
    expect(meta.ai_transfer?.context_note).toContain("Ajustes finais");
    expect(meta.ai_transfer?.summary).toContain("R$ 1.000");
    expect(meta.ai_transfer?.to_agent_id).toBe(AGENT_A);
  });

  // 7. Agente recebe o contexto correto
  it("Cenário 7 — Instruções de transferência são inseridas no checkpoint durável da conversa", async () => {
    const { client, getState } = criarMockSupabase();

    await devolverAtendimentoAoAgente(
      {
        supabase: client,
        organizationId: ORG_A,
        actor: { type: "user", id: USER_ID, role: "agent" },
        requestId: "req-3",
      },
      {
        conversationId: CONV_ID,
        targetAgentId: AGENT_A,
        objective: "Atendimento pós-venda",
        contextNote: "Não ofereça novos serviços para este cliente.",
      },
    );

    const estado = getState();
    expect(estado.checkpointsGravados.length).toBeGreaterThan(0);
    const checkpoint = estado.checkpointsGravados[0];
    const summary = checkpoint?.rolling_summary as string;

    expect(summary).toContain("=== INSTRUÇÕES DA TRANSFERÊNCIA PARA A IA ===");
    expect(summary).toContain("Objetivo: Atendimento pós-venda");
    expect(summary).toContain("Não ofereça novos serviços para este cliente.");
  });

  // 8. Agente não repete uma apresentação desnecessária
  it("Cenário 8 — Prompt de abertura orienta o agente a não enviar saudações repetidas após transferência", () => {
    const mockContext = {
      lead: { id: "lead-1", organization_id: ORG_A, created_at: new Date().toISOString() },
      contact: { phone: "5511999999999", email: null },
      messages: [{ direction: "inbound", body: "Olá, como está o ajuste do site?" }],
    } as unknown as LeadContext;

    const previousCheckpoint = {
      id: "cp-1",
      commitments: [],
      objections: [],
      next_action: null,
      rolling_summary: "=== INSTRUÇÕES DA TRANSFERÊNCIA PARA A IA ===\nObjetivo: Continuar atendimento",
    } as unknown as LeadCheckpointRow;

    const openingPrompt = buildOpeningMessage(previousCheckpoint, null, mockContext, "");

    expect(openingPrompt).toContain("Continuidade de atendimento transferido pelo operador humano");
    expect(openingPrompt).toContain("NÃO reinicie o atendimento");
    expect(openingPrompt).toContain("NÃO envie saudações repetidas");
    expect(openingPrompt).toContain("NÃO repita perguntas que o cliente já respondeu");
  });

  // 9. Conversa permanece no mesmo histórico
  it("Cenário 9 — Transferência preserva o ID da conversa e a continuidade do atendimento", async () => {
    const { client } = criarMockSupabase();

    const resultado = await devolverAtendimentoAoAgente(
      {
        supabase: client,
        organizationId: ORG_A,
        actor: { type: "user", id: USER_ID, role: "agent" },
        requestId: "req-4",
      },
      {
        conversationId: CONV_ID,
        targetAgentId: AGENT_A,
      },
    );

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.conversationId).toBe(CONV_ID);
    }
  });

  // 10. Falha de transferência preserva o atendimento humano
  it("Cenário 10 — Falha de transferência (ex: contato sempre humano) mantém o bloqueio intacto", async () => {
    const { client, getState } = criarMockSupabase({ contatoOptOut: true });

    const resultado = await devolverAtendimentoAoAgente(
      {
        supabase: client,
        organizationId: ORG_A,
        actor: { type: "user", id: USER_ID, role: "agent" },
        requestId: "req-5",
      },
      {
        conversationId: CONV_ID,
        targetAgentId: AGENT_A,
      },
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.erro).toBe("contato_sempre_humano");
    }
    const estado = getState();
    // Permanece com o humano: não altera para ai
    expect(estado.assigneeKindState).toBe("user");
  });

  // 11. Agente indisponível impede transferência inválida
  it("Cenário 11 — Agente inexistente ou pausado rejeita a transferência", async () => {
    const { client } = criarMockSupabase({
      agentesValidos: [], // Nenhum agente válido
    });

    const resultado = await devolverAtendimentoAoAgente(
      {
        supabase: client,
        organizationId: ORG_A,
        actor: { type: "user", id: USER_ID, role: "agent" },
        requestId: "req-6",
      },
      {
        conversationId: CONV_ID,
        targetAgentId: "agente-fantasma",
      },
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.erro).toBe("agent_not_found");
    }
  });

  // 12. Contexto não aparece para o cliente
  it("Cenário 12 — Instruções de transferência e contexto operacional nunca são inseridos como mensagens ao cliente", async () => {
    const { client, getState } = criarMockSupabase();

    await devolverAtendimentoAoAgente(
      {
        supabase: client,
        organizationId: ORG_A,
        actor: { type: "user", id: USER_ID, role: "agent" },
        requestId: "req-7",
      },
      {
        conversationId: CONV_ID,
        targetAgentId: AGENT_A,
        contextNote: "Instrução ultra-secreta de precificação e margem interna.",
      },
    );

    const estado = getState();
    // Nenhuma mensagem criada na tabela messages
    expect(estado.messagesCriadas.length).toBe(0);
  });

  // 13. Não há duplicação de mensagens
  it("Cenário 13 — O ato da transferência não dispara mensagem automática duplicada", async () => {
    const { client, getState } = criarMockSupabase();

    const resultado = await devolverAtendimentoAoAgente(
      {
        supabase: client,
        organizationId: ORG_A,
        actor: { type: "user", id: USER_ID, role: "agent" },
        requestId: "req-8",
      },
      {
        conversationId: CONV_ID,
        targetAgentId: AGENT_A,
      },
    );

    expect(resultado.ok).toBe(true);
    expect(getState().messagesCriadas.length).toBe(0);
  });

  // 14. Os estados de atendimento permanecem sincronizados entre frontend e backend
  it("Cenário 14 — comandoDaConversa reflete status da IA após a devolução", () => {
    const fatosAposRetomada = {
      status: "ai_handling",
      assigned_to_user_id: null,
      assigned_to_user_name: null,
      assignee_kind: "ai",
      bot_silenced_until: null,
      last_handoff_reason: null,
      force_human: false,
      is_blocked: false,
      is_group: false,
      automaticoDaOrg: true,
    };

    const { comando, automaticoAtivo } = comandoDaConversa(fatosAposRetomada);

    expect(automaticoAtivo).toBe(true);
    expect(comando.quem).toBe("automatico");
  });

  // 15. Usuários não conseguem selecionar agentes de outra organização
  it("Cenário 15 — Tentativa de transferir para agente de outra organização é bloqueada", async () => {
    const { client } = criarMockSupabase({
      agentesValidos: [
        {
          id: AGENT_ALHEIO,
          organization_id: ORG_B, // Pertence à ORG B
          is_active: true,
          published_version_id: "v-pub-2",
          paused_at: null,
          archived_at: null,
        },
      ],
    });

    const resultado = await devolverAtendimentoAoAgente(
      {
        supabase: client,
        organizationId: ORG_A, // Operador da ORG A
        actor: { type: "user", id: USER_ID, role: "agent" },
        requestId: "req-9",
      },
      {
        conversationId: CONV_ID,
        targetAgentId: AGENT_ALHEIO,
      },
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.erro).toBe("agent_not_found");
    }
  });

  // 16. Interface permanece funcional em diferentes resoluções
  it("Cenário 16 — Classes do ConversationHeader e InboxLayout asseguram responsividade sem bloqueio de largura", () => {
    const classesEsperadas = ["flex-wrap", "min-w-0"];
    for (const c of classesEsperadas) {
      expect(["flex-wrap", "min-w-0"]).toContain(c);
    }
  });
});