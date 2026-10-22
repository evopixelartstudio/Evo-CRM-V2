import { describe, expect, it } from "vitest";

import {
  calcularARR,
  calcularMetricasDashboard,
  calcularMRR,
  calcularStatusEfetivoCobranca,
} from "@/lib/financeiro/calculos";
import { construirPerfilFinanceiroCliente } from "@/lib/financeiro/clientes";
import { gerarParcelasDoContrato } from "@/lib/financeiro/contratos";
import type { CobrancaFinanceira, ContratoFinanceiro } from "@/lib/financeiro/types";

describe("Cálculos do Módulo Financeiro", () => {
  describe("calcularMRR e calcularARR", () => {
    it("calcula MRR exclusivamente a partir de contratos recorrentes ativos", () => {
      const contratos: ContratoFinanceiro[] = [
        // Recorrente mensal ativo: R$ 500,00
        {
          id: "c1",
          organization_id: "org1",
          contact_id: "ct1",
          company_id: null,
          lead_id: null,
          responsible_user_id: null,
          title: "Plano Mensal",
          description: null,
          modality: "recurring",
          recurrence_period: "monthly",
          total_cents: 50000,
          currency: "BRL",
          contract_date: "2026-01-01",
          start_date: "2026-01-01",
          end_date: null,
          due_day: 10,
          status: "active",
          notes: null,
          created_by_user_id: null,
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        },
        // Recorrente trimestral ativo: R$ 1.500,00 (equivale a R$ 500/mês)
        {
          id: "c2",
          organization_id: "org1",
          contact_id: "ct2",
          company_id: null,
          lead_id: null,
          responsible_user_id: null,
          title: "Plano Trimestral",
          description: null,
          modality: "recurring",
          recurrence_period: "quarterly",
          total_cents: 150000,
          currency: "BRL",
          contract_date: "2026-01-01",
          start_date: "2026-01-01",
          end_date: null,
          due_day: 15,
          status: "active",
          notes: null,
          created_by_user_id: null,
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        },
        // Recorrente anual ativo: R$ 12.000,00 (equivale a R$ 1.000/mês)
        {
          id: "c3",
          organization_id: "org1",
          contact_id: "ct3",
          company_id: null,
          lead_id: null,
          responsible_user_id: null,
          title: "Plano Anual",
          description: null,
          modality: "recurring",
          recurrence_period: "annual",
          total_cents: 1200000,
          currency: "BRL",
          contract_date: "2026-01-01",
          start_date: "2026-01-01",
          end_date: null,
          due_day: 5,
          status: "active",
          notes: null,
          created_by_user_id: null,
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        },
        // Recorrente cancelado ou pausado: NÃO deve entrar
        {
          id: "c4",
          organization_id: "org1",
          contact_id: "ct4",
          company_id: null,
          lead_id: null,
          responsible_user_id: null,
          title: "Plano Cancelado",
          description: null,
          modality: "recurring",
          recurrence_period: "monthly",
          total_cents: 999999,
          currency: "BRL",
          contract_date: "2026-01-01",
          start_date: "2026-01-01",
          end_date: null,
          due_day: 5,
          status: "cancelled",
          notes: null,
          created_by_user_id: null,
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        },
        // Projeto avulso de R$ 50.000: NUNCA deve entrar no MRR
        {
          id: "c5",
          organization_id: "org1",
          contact_id: "ct5",
          company_id: null,
          lead_id: null,
          responsible_user_id: null,
          title: "Desenvolvimento de Site",
          description: null,
          modality: "one_off",
          recurrence_period: null,
          total_cents: 5000000,
          currency: "BRL",
          contract_date: "2026-01-01",
          start_date: "2026-01-01",
          end_date: "2026-02-01",
          due_day: null,
          status: "active",
          notes: null,
          created_by_user_id: null,
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        },
        // Projeto parcelado de R$ 30.000: NUNCA deve entrar no MRR
        {
          id: "c6",
          organization_id: "org1",
          contact_id: "ct6",
          company_id: null,
          lead_id: null,
          responsible_user_id: null,
          title: "Consultoria em 6x",
          description: null,
          modality: "installments",
          recurrence_period: null,
          total_cents: 3000000,
          currency: "BRL",
          contract_date: "2026-01-01",
          start_date: "2026-01-01",
          end_date: "2026-07-01",
          due_day: 10,
          status: "active",
          notes: null,
          created_by_user_id: null,
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        },
      ];

      // Esperado: 50.000 (mensal) + 50.000 (trimestral / 3) + 100.000 (anual / 12) = 200.000 cents (R$ 2.000,00)
      const mrr = calcularMRR(contratos);
      expect(mrr).toBe(200000);

      // ARR = MRR * 12 = 2.400.000 cents (R$ 24.000,00)
      const arr = calcularARR(mrr);
      expect(arr).toBe(2400000);
    });
  });

  describe("calcularStatusEfetivoCobranca", () => {
    const hoje = "2026-10-21";

    it("identifica cobrança paga", () => {
      const status = calcularStatusEfetivoCobranca(
        {
          status: "pending",
          due_date: "2026-10-20",
          amount_cents: 10000,
          paid_cents: 10000,
          paid_at: "2026-10-20",
        },
        hoje,
      );
      expect(status).toBe("paid");
    });

    it("identifica pagamento parcial", () => {
      const status = calcularStatusEfetivoCobranca(
        {
          status: "pending",
          due_date: "2026-10-25",
          amount_cents: 10000,
          paid_cents: 4000,
          paid_at: null,
        },
        hoje,
      );
      expect(status).toBe("partial");
    });

    it("identifica cobrança vencida/atrasada", () => {
      const status = calcularStatusEfetivoCobranca(
        {
          status: "pending",
          due_date: "2026-10-15",
          amount_cents: 10000,
          paid_cents: 0,
          paid_at: null,
        },
        hoje,
      );
      expect(status).toBe("overdue");
    });

    it("identifica cobrança pendente a vencer", () => {
      const status = calcularStatusEfetivoCobranca(
        {
          status: "pending",
          due_date: "2026-10-30",
          amount_cents: 10000,
          paid_cents: 0,
          paid_at: null,
        },
        hoje,
      );
      expect(status).toBe("pending");
    });
  });

  describe("gerarParcelasDoContrato", () => {
    it("gera cobrança única para serviço avulso", () => {
      const parcelas = gerarParcelasDoContrato({
        contract_id: "c1",
        organization_id: "org1",
        contact_id: "ct1",
        title: "Campanha Black Friday",
        total_cents: 500000,
        modality: "one_off",
        start_date: "2026-11-01",
      });

      expect(parcelas).toHaveLength(1);
      expect(parcelas[0]?.amount_cents).toBe(500000);
      expect(parcelas[0]?.installment_number).toBe(1);
      expect(parcelas[0]?.total_installments).toBe(1);
      expect(parcelas[0]?.due_date).toBe("2026-11-01");
    });

    it("gera múltiplas parcelas dividindo centavos sem dízima", () => {
      const parcelas = gerarParcelasDoContrato({
        contract_id: "c2",
        organization_id: "org1",
        contact_id: "ct1",
        title: "Mentoria",
        total_cents: 100000, // R$ 1.000,00 em 3x = 333,34 + 333,33 + 333,33
        modality: "installments",
        installments_count: 3,
        start_date: "2026-10-10",
        due_day: 10,
      });

      expect(parcelas).toHaveLength(3);
      expect(parcelas[0]?.amount_cents).toBe(33334);
      expect(parcelas[1]?.amount_cents).toBe(33333);
      expect(parcelas[2]?.amount_cents).toBe(33333);
      expect(parcelas.reduce((acc, p) => acc + p.amount_cents, 0)).toBe(100000);
    });
  });

  describe("construirPerfilFinanceiroCliente", () => {
    it("agrega dados do cliente e identifica inadimplência", () => {
      const perfil = construirPerfilFinanceiroCliente({
        contact: {
          id: "ct1",
          name: "Empresa XYZ Ltda",
          display_name: "XYZ Corp",
          phone_number: "+5511999999999",
          email: "financeiro@xyz.com",
          created_at: "2026-01-01",
          custom_fields: {
            trade_name: "XYZ Studio",
            instagram: "@xyzstudio",
            document: "12.345.678/0001-90",
          },
        },
        contracts: [
          {
            id: "c1",
            organization_id: "org1",
            contact_id: "ct1",
            company_id: null,
            lead_id: null,
            responsible_user_id: null,
            title: "Assessoria Contábil",
            description: null,
            modality: "recurring",
            recurrence_period: "monthly",
            total_cents: 150000,
            currency: "BRL",
            contract_date: "2026-01-01",
            start_date: "2026-01-01",
            end_date: null,
            due_day: 10,
            status: "active",
            notes: null,
            created_by_user_id: null,
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          },
        ],
        invoices: [
          {
            id: "inv1",
            organization_id: "org1",
            contract_id: "c1",
            contact_id: "ct1",
            lead_id: null,
            account_id: null,
            account_plan_id: null,
            direction: "in",
            category: "mensalidade",
            title: "Mensalidade Setembro",
            contracted_cents: 150000,
            amount_cents: 150000,
            paid_cents: 150000,
            currency: "BRL",
            due_date: "2026-09-10",
            paid_at: "2026-09-10",
            payment_method: "pix",
            installment_number: 1,
            total_installments: 1,
            status: "paid",
            notes: null,
            reverses_invoice_id: null,
            created_by_user_id: null,
            created_at: "2026-09-01",
            updated_at: "2026-09-10",
          },
          {
            id: "inv2",
            organization_id: "org1",
            contract_id: "c1",
            contact_id: "ct1",
            lead_id: null,
            account_id: null,
            account_plan_id: null,
            direction: "in",
            category: "mensalidade",
            title: "Mensalidade Outubro",
            contracted_cents: 150000,
            amount_cents: 150000,
            paid_cents: 0,
            currency: "BRL",
            due_date: "2026-10-10",
            paid_at: null,
            payment_method: "boleto",
            installment_number: 1,
            total_installments: 1,
            status: "pending",
            notes: null,
            reverses_invoice_id: null,
            created_by_user_id: null,
            created_at: "2026-10-01",
            updated_at: "2026-10-01",
          },
        ],
        dataHoje: "2026-10-21",
      });

      expect(perfil.trade_name).toBe("XYZ Studio");
      expect(perfil.instagram).toBe("@xyzstudio");
      expect(perfil.document).toBe("12.345.678/0001-90");
      expect(perfil.total_paid_cents).toBe(150000);
      expect(perfil.total_overdue_cents).toBe(150000);
      expect(perfil.financial_status).toBe("inadimplente");
      expect(perfil.active_contracts).toBe(1);
    });
  });
});
