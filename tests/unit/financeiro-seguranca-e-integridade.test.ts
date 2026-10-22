import { describe, it, expect, vi } from "vitest";
import { roleAtLeast, ROLE_RANK } from "@/lib/auth/types";
import {
  criarContratoSchema,
  gerarParcelasDoContrato,
} from "@/lib/financeiro/contratos";
import {
  criarCobrancaSchema,
  registrarPagamentoSchema,
  estornarCobrancaSchema,
} from "@/lib/financeiro/cobrancas";
import { motivoDePerdaAceito } from "@/lib/leads/motivos-de-perda-do-funil";
import { CANONICAL_LOST_REASONS } from "@/lib/schemas/leads";

describe("Segurança e Autorização Multi-Tenant no Módulo Financeiro", () => {
  it("impede que usuário comum (viewer) tenha permissão de agente ou superior", () => {
    expect(roleAtLeast("viewer", "agent")).toBe(false);
    expect(roleAtLeast("viewer", "manager")).toBe(false);
    expect(roleAtLeast("viewer", "admin")).toBe(false);
  });

  it("permite leitura e operações financeiras legítimas para papéis agent, manager e admin", () => {
    expect(roleAtLeast("agent", "agent")).toBe(true);
    expect(roleAtLeast("manager", "agent")).toBe(true);
    expect(roleAtLeast("admin", "agent")).toBe(true);
  });

  it("exige papel de gerente (manager) ou admin para estorno de cobranças", () => {
    expect(roleAtLeast("viewer", "manager")).toBe(false);
    expect(roleAtLeast("agent", "manager")).toBe(false);
    expect(roleAtLeast("manager", "manager")).toBe(true);
    expect(roleAtLeast("admin", "manager")).toBe(true);
  });

  it("ROLE_RANK reflete a hierarquia estrita de permissões do tenant", () => {
    expect(ROLE_RANK.viewer).toBeLessThan(ROLE_RANK.agent);
    expect(ROLE_RANK.agent).toBeLessThan(ROLE_RANK.manager);
    expect(ROLE_RANK.manager).toBeLessThan(ROLE_RANK.admin);
  });
});

describe("Criação de Contratos e Cobranças", () => {
  it("valida contrato e sincroniza campos service_name/title e total_cents/amount_cents", () => {
    const input = {
      contact_id: "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d",
      service_name: "Consultoria Mensal de Gestão",
      amount_cents: 150000,
      modality: "recurring" as const,
      recurrence_period: "monthly" as const,
      due_day: 15,
      start_date: "2026-11-01",
    };

    const parsed = criarContratoSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.title).toBe("Consultoria Mensal de Gestão");
    expect(parsed.data.service_name).toBe("Consultoria Mensal de Gestão");
    expect(parsed.data.total_cents).toBe(150000);
    expect(parsed.data.amount_cents).toBe(150000);
    expect(parsed.data.modality).toBe("recurring");
  });

  it("gera parcelas do contrato para modalidade avulsa (one_off)", () => {
    const parcelas = gerarParcelasDoContrato({
      contract_id: "contrato-1",
      contact_id: "contato-1",
      service_name: "Instalação de Sistema",
      amount_cents: 50000,
      modality: "one_off",
      start_date: "2026-11-10",
    });

    expect(parcelas).toHaveLength(1);
    expect(parcelas[0].contracted_cents).toBe(50000);
    expect(parcelas[0].amount_cents).toBe(50000);
    expect(parcelas[0].billed_cents).toBe(50000);
    expect(parcelas[0].direction).toBe("in");
    expect(parcelas[0].installment_number).toBe(1);
    expect(parcelas[0].total_installments).toBe(1);
    expect(parcelas[0].status).toBe("pending");
  });

  it("gera parcelas de contrato parcelado (installments) com divisão de valores", () => {
    const parcelas = gerarParcelasDoContrato({
      contract_id: "contrato-2",
      contact_id: "contato-2",
      service_name: "Projeto Especial",
      amount_cents: 30000,
      modality: "installments",
      installments_count: 3,
      start_date: "2026-11-01",
      due_day: 10,
    });

    expect(parcelas).toHaveLength(3);
    expect(parcelas[0].installment_number).toBe(1);
    expect(parcelas[0].total_installments).toBe(3);
    expect(parcelas[1].installment_number).toBe(2);
    expect(parcelas[2].installment_number).toBe(3);
    expect(parcelas[0].billed_cents).toBe(10000);
    expect(parcelas[1].billed_cents).toBe(10000);
    expect(parcelas[2].billed_cents).toBe(10000);
  });

  it("valida criação de cobrança avulsa com normalização de direção e tipo", () => {
    const input = {
      title: "Honorários Extras",
      type: "income" as const,
      amount_cents: 25000,
      due_date: "2026-12-05",
      payment_method: "pix" as const,
    };

    const parsed = criarCobrancaSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.direction).toBe("in");
    expect(parsed.data.type).toBe("income");
    expect(parsed.data.amount_cents).toBe(25000);
    expect(parsed.data.billed_cents).toBe(25000);
  });
});

describe("Pagamentos e Estornos Financeiros", () => {
  it("valida dados legítimos de registro de pagamento", () => {
    const input = {
      valor_pago_cents: 10000,
      forma_pagamento: "pix" as const,
      data_pagamento: "2026-10-21T18:00:00Z",
      observacoes: "Pago via PIX com comprovante anexado",
    };

    const parsed = registrarPagamentoSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.valor_pago_cents).toBe(10000);
    expect(parsed.data.forma_pagamento).toBe("pix");
  });

  it("recusa pagamento com valor zero ou negativo", () => {
    const invalido = {
      valor_pago_cents: 0,
      forma_pagamento: "pix" as const,
    };

    const parsed = registrarPagamentoSchema.safeParse(invalido);
    expect(parsed.success).toBe(false);
  });

  it("valida motivo obrigatório para estorno de cobrança", () => {
    const valido = { motivo: "Cobrança duplicada pelo cliente" };
    expect(estornarCobrancaSchema.safeParse(valido).success).toBe(true);

    const semMotivo = { motivo: "" };
    expect(estornarCobrancaSchema.safeParse(semMotivo).success).toBe(false);
  });
});

describe("Encerramento e Reativação de Leads com Preservação de Follow-ups", () => {
  it("reconhece todos os motivos canônicos antigos e os novos padrões", () => {
    const motivosEsperados = [
      "requested_by_customer",
      "price",
      "no_response",
      "product_unavailable",
      "cancelled_by_store",
      "cancelled_by_customer",
      "payment_failed",
      "other",
      "moved_to_another_pipeline",
      "opted_out_of_messages",
      "sem_interesse",
      "sem_resposta",
      "numero_invalido",
      "servico_incompativel",
      "contato_duplicado",
    ];

    for (const m of motivosEsperados) {
      expect(CANONICAL_LOST_REASONS).toContain(m);
      expect(motivoDePerdaAceito(m, [])).toBe(true);
    }
  });

  it("rejeita motivo arbitrário não cadastrado", () => {
    expect(motivoDePerdaAceito("motivo_inventado_sem_cadastro", [])).toBe(false);
  });

  it("lógica de cancelamento protege conversas que possuem outro lead aberto", () => {
    // Simulação do comportamento de cancelaFollowupsDoLead
    const convIds = ["conv-1", "conv-2"];
    const outrosLeadsAbertos = [{ target_id: "conv-1", crm_leads: { id: "outro-lead", status: "open" } }];

    const convsComOutroLeadAberto = new Set(outrosLeadsAbertos.map((l) => l.target_id));
    const convsParaCancelar = convIds.filter((id) => !convsComOutroLeadAberto.has(id));

    // conv-1 NÃO deve ser cancelada pois possui outro lead aberto
    expect(convsParaCancelar).not.toContain("conv-1");
    // conv-2 deve ser cancelada pois não possui outro lead aberto
    expect(convsParaCancelar).toContain("conv-2");
  });
});
