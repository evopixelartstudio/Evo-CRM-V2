import { describe, expect, it } from "vitest";

import {
  calcularARR,
  calcularMetricasDashboard,
  calcularMRR,
} from "@/lib/financeiro/calculos";
import {
  atualizarContratoSchema,
  criarContratoSchema,
  gerarParcelasDoContrato,
  registrarPagamentoContratoSchema,
} from "@/lib/financeiro/contratos";
import type { CobrancaFinanceira, ContratoFinanceiro } from "@/lib/financeiro/types";

describe("Financeiro Integrado: Fluxo Completo de Cadastro, Gestão de Contratos e Pagamentos", () => {
  const dataHoje = "2026-10-22";

  // ---------------------------------------------------------------------------
  // 1. Schema: Criação de Contrato com opções de pagamento (integral, parcial, pendente)
  // ---------------------------------------------------------------------------
  describe("1. Schema de Criação de Contrato", () => {
    const validContactId = "4be9d0ec-4cc9-4853-8d39-2d83971c8e6c";

    it("Valida contrato com pagamento pendente", () => {
      const input = {
        contact_id: validContactId,
        service_name: "Consultoria SEO",
        amount_cents: 150000,
        modality: "one_off",
        contract_date: "2026-05-10",
        start_date: "2026-05-10",
        payment_status: "pending",
      };

      const parsed = criarContratoSchema.safeParse(input);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.payment_status).toBe("pending");
        expect(parsed.data.contract_date).toBe("2026-05-10");
      }
    });

    it("Valida contrato com quitação integral retroativa", () => {
      const input = {
        contact_id: validContactId,
        service_name: "Site Institucional",
        amount_cents: 100000,
        modality: "one_off",
        contract_date: "2026-05-10",
        start_date: "2026-05-10",
        payment_status: "full",
        paid_amount_cents: 100000,
        payment_date: "2026-05-10",
        payment_method: "pix",
      };

      const parsed = criarContratoSchema.safeParse(input);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.payment_status).toBe("full");
        expect(parsed.data.paid_amount_cents).toBe(100000);
        expect(parsed.data.payment_date).toBe("2026-05-10");
        expect(parsed.data.payment_method).toBe("pix");
      }
    });

    it("Valida contrato com pagamento parcial (entrada)", () => {
      const input = {
        contact_id: validContactId,
        service_name: "Desenvolvimento App Mobile",
        amount_cents: 500000,
        modality: "one_off",
        contract_date: "2026-08-01",
        start_date: "2026-08-01",
        payment_status: "partial",
        paid_amount_cents: 200000,
        payment_date: "2026-08-01",
        forma_pagamento: "bank_transfer",
      };

      const parsed = criarContratoSchema.safeParse(input);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.payment_status).toBe("partial");
        expect(parsed.data.paid_amount_cents).toBe(200000);
      }
    });

    it("Rejeita valor negativo", () => {
      const input = {
        contact_id: validContactId,
        service_name: "Serviço Inválido",
        amount_cents: -500,
        modality: "one_off",
      };

      const parsed = criarContratoSchema.safeParse(input);
      expect(parsed.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Schema: Registro de Pagamento Posterior e Edição
  // ---------------------------------------------------------------------------
  describe("2. Schema de Registro de Pagamento e Edição de Contrato", () => {
    it("Valida payload de registrar pagamento do contrato", () => {
      const input = {
        valor_pago_cents: 100000,
        tipo_pagamento: "full",
        data_pagamento: "2026-05-10",
        forma_pagamento: "pix",
        observacoes: "Pagamento realizado via chave PIX",
      };

      const parsed = registrarPagamentoContratoSchema.safeParse(input);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.valor_pago_cents).toBe(100000);
        expect(parsed.data.tipo_pagamento).toBe("full");
        expect(parsed.data.data_pagamento).toBe("2026-05-10");
      }
    });

    it("Rejeita valor pago zerado ou negativo no registro de pagamento", () => {
      const input = {
        valor_pago_cents: 0,
        data_pagamento: "2026-05-10",
      };

      const parsed = registrarPagamentoContratoSchema.safeParse(input);
      expect(parsed.success).toBe(false);
    });

    it("Valida schema de edição de contrato", () => {
      const input = {
        service_name: "Site Institucional Atualizado",
        amount_cents: 120000,
        contract_date: "2026-05-10",
        start_date: "2026-05-10",
        end_date: "2026-06-30",
        status: "active",
        notes: "Alterado escopo do projeto",
      };

      const parsed = atualizarContratoSchema.safeParse(input);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.service_name).toBe("Site Institucional Atualizado");
        expect(parsed.data.amount_cents).toBe(120000);
        expect(parsed.data.status).toBe("active");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Geração Automática de Parcelas / Faturas
  // ---------------------------------------------------------------------------
  describe("3. Geração de Parcelas Conforme Status Financeiro", () => {
    it("Gera parcela única com status 'paid' quando pagamento for integral na criação", () => {
      const parcelas = gerarParcelasDoContrato({
        contract_id: "ct-janaina",
        contact_id: "cli-janaina",
        service_name: "Site institucional",
        amount_cents: 100000,
        modality: "one_off",
        contract_date: "2026-05-10",
        start_date: "2026-05-10",
        payment_status: "full",
        paid_amount_cents: 100000,
        payment_date: "2026-05-10",
        payment_method: "pix",
      });

      expect(parcelas).toHaveLength(1);
      const p = parcelas[0]!;
      expect(p.amount_cents).toBe(100000);
      expect(p.paid_cents).toBe(100000);
      expect(p.status).toBe("paid");
      expect(p.paid_at).toBe("2026-05-10T12:00:00.000Z");
      expect(p.payment_method).toBe("pix");
      expect(p.due_date).toBe("2026-05-10");
    });

    it("Gera parcela única com status 'partially_paid' quando pagamento for parcial na criação", () => {
      const parcelas = gerarParcelasDoContrato({
        contract_id: "ct-app",
        contact_id: "cli-app",
        service_name: "App Mobile",
        amount_cents: 300000,
        modality: "one_off",
        contract_date: "2026-06-01",
        start_date: "2026-06-01",
        payment_status: "partial",
        paid_amount_cents: 100000,
        payment_date: "2026-06-01",
        payment_method: "bank_slip",
      });

      expect(parcelas).toHaveLength(1);
      const p = parcelas[0]!;
      expect(p.amount_cents).toBe(300000);
      expect(p.paid_cents).toBe(100000);
      expect(p.status).toBe("partially_paid");
      expect(p.paid_at).toBe("2026-06-01T12:00:00.000Z");
    });

    it("Gera parcelas pendentes para contrato parcelado (installments)", () => {
      const parcelas = gerarParcelasDoContrato({
        contract_id: "ct-parcelado",
        contact_id: "cli-parcelado",
        service_name: "Treinamento Corporativo",
        amount_cents: 60000, // 3x de R$ 200,00
        modality: "installments",
        installments_count: 3,
        start_date: "2026-06-15",
        due_day: 15,
        payment_status: "pending",
      });

      expect(parcelas).toHaveLength(3);
      expect(parcelas[0]?.amount_cents).toBe(20000);
      expect(parcelas[1]?.amount_cents).toBe(20000);
      expect(parcelas[2]?.amount_cents).toBe(20000);
      expect(parcelas.every((p) => p.status === "pending" && p.paid_cents === 0)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Cenário do Contrato Janaína (4be9d0ec-4cc9-4853-8d39-2d83971c8e6c)
  // ---------------------------------------------------------------------------
  describe("4. Resolução do Caso Real Janaína (Contrato sem Invoices Iniciais)", () => {
    const contratoJanaina: ContratoFinanceiro = {
      id: "4be9d0ec-4cc9-4853-8d39-2d83971c8e6c",
      organization_id: "org-1",
      contact_id: "cliente-janaina",
      company_id: null,
      lead_id: null,
      responsible_user_id: null,
      title: "Site institucional",
      description: null,
      modality: "one_off",
      recurrence_period: null,
      total_cents: 100000, // R$ 1.000,00
      currency: "BRL",
      contract_date: "2026-05-10",
      start_date: "2026-05-10",
      end_date: null,
      due_day: 10,
      status: "active",
      notes: null,
      created_by_user_id: null,
      created_at: "2026-05-10T10:00:00Z",
      updated_at: "2026-05-10T10:00:00Z",
    };

    it("Antes do pagamento: contrato sem cobranças contabiliza faturamento, saldo a receber e cliente ativo, mas MRR = 0", () => {
      const metricas = calcularMetricasDashboard({
        contratos: [contratoJanaina],
        cobrancas: [], // 0 cobranças no banco inicialmente
        dataHoje,
        periodoInicio: "all",
        periodoFim: "all",
      });

      expect(metricas.faturamento_periodo_cents).toBe(100000); // R$ 1.000,00 reconhecidos
      expect(metricas.total_a_receber_cents).toBe(100000); // R$ 1.000,00 a receber
      expect(metricas.total_recebido_cents).toBe(0); // R$ 0,00 recebido ainda
      expect(metricas.clientes_ativos).toBe(1); // Janaína é cliente ativa
      expect(metricas.contratos_ativos).toBe(1); // 1 contrato ativo
      expect(metricas.mrr_cents).toBe(0); // Contrato avulso NÃO entra em MRR
      expect(metricas.arr_cents).toBe(0);
    });

    it("Após registrar pagamento: gera cobrança paga e dashboard reflete total recebido R$ 1.000,00 e a receber R$ 0,00", () => {
      const cobrancaPaga: CobrancaFinanceira = {
        id: "cob-janaina-1",
        organization_id: "org-1",
        contract_id: "4be9d0ec-4cc9-4853-8d39-2d83971c8e6c",
        contact_id: "cliente-janaina",
        lead_id: null,
        account_id: "acc-caixa",
        account_plan_id: null,
        direction: "in",
        category: "servico_avulso",
        title: "Site institucional",
        contracted_cents: 100000,
        amount_cents: 100000,
        paid_cents: 100000,
        currency: "BRL",
        due_date: "2026-05-10",
        paid_at: "2026-05-10T12:00:00Z",
        payment_method: "pix",
        installment_number: 1,
        total_installments: 1,
        status: "paid",
        notes: null,
        reverses_invoice_id: null,
        created_by_user_id: null,
        created_at: "2026-05-10T10:00:00Z",
        updated_at: "2026-05-10T12:00:00Z",
      };

      const metricas = calcularMetricasDashboard({
        contratos: [contratoJanaina],
        cobrancas: [cobrancaPaga],
        dataHoje,
        periodoInicio: "all",
        periodoFim: "all",
      });

      expect(metricas.faturamento_periodo_cents).toBe(100000);
      expect(metricas.total_recebido_cents).toBe(100000); // R$ 1.000,00 recebidos
      expect(metricas.total_a_receber_cents).toBe(0); // R$ 0,00 a receber
      expect(metricas.clientes_ativos).toBe(1);
      expect(metricas.contratos_ativos).toBe(1);
      expect(metricas.mrr_cents).toBe(0); // Avulso NÃO conta no MRR
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Invariantes de MRR e Contratos Avulsos vs Recorrentes
  // ---------------------------------------------------------------------------
  describe("5. Invariantes de MRR / ARR", () => {
    it("Apenas contratos recorrentes (recurring) e ativos compõem MRR", () => {
      const contratoRecorrente: ContratoFinanceiro = {
        id: "ct-rec-1",
        organization_id: "org-1",
        contact_id: "cli-rec",
        company_id: null,
        lead_id: null,
        responsible_user_id: null,
        title: "Manutenção Mensal",
        description: null,
        modality: "recurring",
        recurrence_period: "monthly",
        total_cents: 50000, // R$ 500,00 / mês
        currency: "BRL",
        contract_date: "2026-01-01",
        start_date: "2026-01-01",
        end_date: null,
        due_day: 5,
        status: "active",
        notes: null,
        created_by_user_id: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      const contratoAvulso: ContratoFinanceiro = {
        id: "ct-avulso-1",
        organization_id: "org-1",
        contact_id: "cli-avulso",
        company_id: null,
        lead_id: null,
        responsible_user_id: null,
        title: "Site Express",
        description: null,
        modality: "one_off",
        recurrence_period: null,
        total_cents: 200000, // R$ 2.000,00
        currency: "BRL",
        contract_date: "2026-02-01",
        start_date: "2026-02-01",
        end_date: null,
        due_day: 10,
        status: "active",
        notes: null,
        created_by_user_id: null,
        created_at: "2026-02-01T00:00:00Z",
        updated_at: "2026-02-01T00:00:00Z",
      };

      const mrr = calcularMRR([contratoRecorrente, contratoAvulso]);
      expect(mrr).toBe(50000); // Apenas os R$ 500,00 do recorrente
      expect(calcularARR(mrr)).toBe(600000); // R$ 6.000,00 ao ano
    });

    it("Contrato recorrente cancelado não entra no MRR", () => {
      const contratoCancelado: ContratoFinanceiro = {
        id: "ct-canc",
        organization_id: "org-1",
        contact_id: "cli-canc",
        company_id: null,
        lead_id: null,
        responsible_user_id: null,
        title: "Hospedagem",
        description: null,
        modality: "recurring",
        recurrence_period: "monthly",
        total_cents: 30000,
        currency: "BRL",
        contract_date: "2026-01-01",
        start_date: "2026-01-01",
        end_date: "2026-03-01",
        due_day: 1,
        status: "cancelled",
        notes: null,
        created_by_user_id: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-03-01T00:00:00Z",
      };

      expect(calcularMRR([contratoCancelado])).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Contagem de Clientes Ativos
  // ---------------------------------------------------------------------------
  describe("6. Contagem Correta de Clientes Ativos", () => {
    it("Não duplica cliente com múltiplos contratos e cobranças", () => {
      const ct1: ContratoFinanceiro = {
        id: "ct-1",
        organization_id: "org-1",
        contact_id: "cliente-unico",
        company_id: null,
        lead_id: null,
        responsible_user_id: null,
        title: "Contrato 1",
        description: null,
        modality: "recurring",
        recurrence_period: "monthly",
        total_cents: 10000,
        currency: "BRL",
        contract_date: "2026-01-01",
        start_date: "2026-01-01",
        end_date: null,
        due_day: 5,
        status: "active",
        notes: null,
        created_by_user_id: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      const ct2: ContratoFinanceiro = {
        ...ct1,
        id: "ct-2",
        title: "Contrato 2",
        modality: "one_off",
      };

      const cob: CobrancaFinanceira = {
        id: "cob-1",
        organization_id: "org-1",
        contract_id: "ct-1",
        contact_id: "cliente-unico",
        lead_id: null,
        account_id: null,
        account_plan_id: null,
        direction: "in",
        category: "servico",
        title: "Cobrança 1",
        contracted_cents: 10000,
        amount_cents: 10000,
        paid_cents: 10000,
        currency: "BRL",
        due_date: "2026-01-05",
        paid_at: "2026-01-05T00:00:00Z",
        payment_method: "pix",
        installment_number: 1,
        total_installments: 1,
        status: "paid",
        notes: null,
        reverses_invoice_id: null,
        created_by_user_id: null,
        created_at: "2026-01-05T00:00:00Z",
        updated_at: "2026-01-05T00:00:00Z",
      };

      const metricas = calcularMetricasDashboard({
        contratos: [ct1, ct2],
        cobrancas: [cob],
        dataHoje,
        periodoInicio: "all",
        periodoFim: "all",
      });

      expect(metricas.clientes_ativos).toBe(1);
      expect(metricas.contratos_ativos).toBe(2);
    });
  });
});
