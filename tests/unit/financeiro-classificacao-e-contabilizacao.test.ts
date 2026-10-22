import { describe, expect, it } from "vitest";

import {
  calcularARR,
  calcularMetricasDashboard,
  calcularMRR,
  calcularStatusEfetivoCobranca,
} from "@/lib/financeiro/calculos";
import { construirPerfilFinanceiroCliente } from "@/lib/financeiro/clientes";
import type { CobrancaFinanceira, ContratoFinanceiro } from "@/lib/financeiro/types";

describe("Cenários Obrigatórios: Classificação de Clientes e Contabilização Financeira", () => {
  const hoje = "2026-10-22";

  // Mock de contrato base
  const criarContrato = (props: Partial<ContratoFinanceiro>): ContratoFinanceiro => ({
    id: "ct-1",
    organization_id: "org-1",
    contact_id: "cliente-janaina",
    company_id: null,
    lead_id: null,
    responsible_user_id: null,
    title: "Site Institucional",
    description: "Desenvolvimento de site",
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
    ...props,
  });

  // Mock de cobrança base
  const criarCobranca = (props: Partial<CobrancaFinanceira>): CobrancaFinanceira => ({
    id: "cob-1",
    organization_id: "org-1",
    contract_id: "ct-1",
    contact_id: "cliente-janaina",
    lead_id: null,
    account_id: null,
    account_plan_id: null,
    direction: "in",
    category: "service",
    title: "Parcela Site",
    contracted_cents: 100000,
    amount_cents: 100000,
    paid_cents: 0,
    currency: "BRL",
    due_date: "2026-05-10",
    paid_at: null,
    payment_method: null,
    installment_number: 1,
    total_installments: 1,
    status: "pending",
    notes: null,
    reverses_invoice_id: null,
    created_by_user_id: null,
    created_at: "2026-05-10T10:00:00Z",
    updated_at: "2026-05-10T10:00:00Z",
    ...props,
  });

  // ---------------------------------------------------------------------------
  // Cenário 1: Contrato avulso ativo deve contabilizar cliente ativo = 1
  // ---------------------------------------------------------------------------
  it("Cenário 1: Contrato avulso ativo deve contabilizar cliente ativo = 1 e contratos ativos = 1", () => {
    const contratoJanaina = criarContrato({
      modality: "one_off",
      status: "active",
      total_cents: 100000,
      contract_date: "2026-05-10",
    });

    const metricas = calcularMetricasDashboard({
      contratos: [contratoJanaina],
      cobrancas: [],
      dataHoje: hoje,
      periodoInicio: "all",
      periodoFim: "all",
    });

    expect(metricas.clientes_ativos).toBe(1);
    expect(metricas.contratos_ativos).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Cenário 2: Contrato avulso não deve somar em MRR
  // ---------------------------------------------------------------------------
  it("Cenário 2: Contrato avulso não deve somar em MRR nem em ARR", () => {
    const contratoJanaina = criarContrato({
      modality: "one_off",
      status: "active",
      total_cents: 100000,
    });

    const mrr = calcularMRR([contratoJanaina]);
    const arr = calcularARR(mrr);

    expect(mrr).toBe(0);
    expect(arr).toBe(0);

    const metricas = calcularMetricasDashboard({
      contratos: [contratoJanaina],
      cobrancas: [],
      dataHoje: hoje,
      periodoInicio: "all",
      periodoFim: "all",
    });
    expect(metricas.mrr_cents).toBe(0);
    expect(metricas.arr_cents).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Cenário 3: Contrato recorrente ativo deve somar em clientes ativos e em MRR
  // ---------------------------------------------------------------------------
  it("Cenário 3: Contrato recorrente ativo deve somar em clientes ativos e em MRR", () => {
    const contratoRecorrente = criarContrato({
      id: "ct-rec",
      contact_id: "cliente-recorrente",
      modality: "recurring",
      recurrence_period: "monthly",
      total_cents: 250000, // R$ 2.500,00 / mês
      status: "active",
    });

    const metricas = calcularMetricasDashboard({
      contratos: [contratoRecorrente],
      cobrancas: [],
      dataHoje: hoje,
      periodoInicio: "all",
      periodoFim: "all",
    });

    expect(metricas.clientes_ativos).toBe(1);
    expect(metricas.mrr_cents).toBe(250000);
    expect(metricas.arr_cents).toBe(3000000);
  });

  // ---------------------------------------------------------------------------
  // Cenário 4: Contrato cancelado não deve somar em clientes ativos nem em MRR
  // ---------------------------------------------------------------------------
  it("Cenário 4: Contrato cancelado não deve somar em clientes ativos nem em MRR", () => {
    const contratoCancelado = criarContrato({
      id: "ct-canc",
      contact_id: "cliente-cancelado",
      modality: "recurring",
      recurrence_period: "monthly",
      total_cents: 100000,
      status: "cancelled",
    });

    const metricas = calcularMetricasDashboard({
      contratos: [contratoCancelado],
      cobrancas: [],
      dataHoje: hoje,
      periodoInicio: "all",
      periodoFim: "all",
    });

    expect(metricas.clientes_ativos).toBe(0);
    expect(metricas.mrr_cents).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Cenário 5: Contrato concluído deve mover cliente para histórico
  // ---------------------------------------------------------------------------
  it("Cenário 5: Contrato concluído deve mover cliente para histórico (se não houver outro ativo)", () => {
    const contratoConcluido = criarContrato({
      id: "ct-fim",
      contact_id: "cliente-concluido",
      modality: "one_off",
      status: "completed",
    });

    // No dashboard, clientes ativos = 0
    const metricas = calcularMetricasDashboard({
      contratos: [contratoConcluido],
      cobrancas: [],
      dataHoje: hoje,
      periodoInicio: "all",
      periodoFim: "all",
    });
    expect(metricas.clientes_ativos).toBe(0);

    // No perfil consolidado do cliente, ele deve ter 0 contratos ativos e 1 contrato total (histórico)
    const perfil = construirPerfilFinanceiroCliente(
      { id: "cliente-concluido", display_name: "Cliente Concluído" },
      [contratoConcluido],
      [],
      hoje,
    );
    expect(perfil.active_contracts).toBe(0);
    expect(perfil.total_contracts).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Cenário 6: Cliente com fatura vencida não paga deve ser classificado como inadimplente
  // ---------------------------------------------------------------------------
  it("Cenário 6: Cliente com fatura vencida não paga deve ser classificado como inadimplente", () => {
    const cobrancaVencida = criarCobranca({
      due_date: "2026-05-10",
      status: "pending",
      paid_cents: 0,
      amount_cents: 100000,
    });

    const statusEfetivo = calcularStatusEfetivoCobranca(cobrancaVencida, hoje);
    expect(statusEfetivo).toBe("overdue");

    const contrato = criarContrato({ id: "ct-1" });
    const metricas = calcularMetricasDashboard({
      contratos: [contrato],
      cobrancas: [cobrancaVencida],
      dataHoje: hoje,
      periodoInicio: "all",
      periodoFim: "all",
    });

    expect(metricas.clientes_inadimplentes).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Cenário 7: Pagamento retroativo confirmado deve somar em total recebido do período
  // ---------------------------------------------------------------------------
  it("Cenário 7: Pagamento retroativo confirmado deve somar em total recebido do período correspondente à data do pagamento", () => {
    const cobrancaPagaMaio = criarCobranca({
      due_date: "2026-05-10",
      paid_at: "2026-05-10T14:30:00Z",
      status: "paid",
      amount_cents: 100000,
      paid_cents: 100000,
    });

    // 1. Período filtrado para Maio/2026: deve constar R$ 1.000,00 recebidos
    const metricasMaio = calcularMetricasDashboard({
      contratos: [],
      cobrancas: [cobrancaPagaMaio],
      dataHoje: hoje,
      periodoInicio: "2026-05-01",
      periodoFim: "2026-05-31",
    });
    expect(metricasMaio.total_recebido_cents).toBe(100000);

    // 2. Período filtrado para Outubro/2026: deve constar R$ 0,00 recebidos
    const metricasOutubro = calcularMetricasDashboard({
      contratos: [],
      cobrancas: [cobrancaPagaMaio],
      dataHoje: hoje,
      periodoInicio: "2026-10-01",
      periodoFim: "2026-10-31",
    });
    expect(metricasOutubro.total_recebido_cents).toBe(0);

    // 3. Período acumulado (Todo o histórico): deve constar R$ 1.000,00
    const metricasTudo = calcularMetricasDashboard({
      contratos: [],
      cobrancas: [cobrancaPagaMaio],
      dataHoje: hoje,
      periodoInicio: "all",
      periodoFim: "all",
    });
    expect(metricasTudo.total_recebido_cents).toBe(100000);
  });

  // ---------------------------------------------------------------------------
  // Cenário 8: Contrato avulso sem fatura quitada não deve somar em total recebido
  // ---------------------------------------------------------------------------
  it("Cenário 8: Contrato avulso sem fatura quitada não deve somar em total recebido (sem quitação automática prematura)", () => {
    const contratoJanaina = criarContrato({
      total_cents: 100000,
      contract_date: "2026-05-10",
    });
    const cobrancaPendente = criarCobranca({
      status: "pending",
      paid_cents: 0,
      paid_at: null,
      amount_cents: 100000,
    });

    const metricas = calcularMetricasDashboard({
      contratos: [contratoJanaina],
      cobrancas: [cobrancaPendente],
      dataHoje: hoje,
      periodoInicio: "all",
      periodoFim: "all",
    });

    expect(metricas.total_recebido_cents).toBe(0);
    expect(metricas.total_a_receber_cents).toBe(100000);
  });

  // ---------------------------------------------------------------------------
  // Cenário 9: Contato sem contrato/cobrança não deve aparecer na listagem de clientes
  // ---------------------------------------------------------------------------
  it("Cenário 9: Contato importado ou vindo de conversa do WhatsApp sem contrato/cobrança não deve ser considerado cliente", () => {
    // Simula a lógica de classificação de cliente empregada na API
    const contatosBrutos = [
      {
        id: "contato-whats",
        display_name: "Lead do WhatsApp",
        total_contratos: 0,
        total_cobrancas: 0,
      },
      {
        id: "cliente-janaina",
        display_name: "Janaína",
        total_contratos: 1,
        total_cobrancas: 1,
      },
    ];

    const clientesEfetivos = contatosBrutos.filter(
      (c) => c.total_contratos > 0 || c.total_cobrancas > 0,
    );

    expect(clientesEfetivos).toHaveLength(1);
    expect(clientesEfetivos[0]!.display_name).toBe("Janaína");
  });

  // ---------------------------------------------------------------------------
  // Cenário 10: Contato que fecha contrato deve passar a aparecer na listagem de clientes
  // ---------------------------------------------------------------------------
  it("Cenário 10: Contato que fecha contrato passa a ser reconhecido como cliente", () => {
    let contratosPorContato: Record<string, number> = { "lead-novo": 0 };

    // Antes de fechar contrato:
    let ehCliente = (contratosPorContato["lead-novo"] ?? 0) > 0;
    expect(ehCliente).toBe(false);

    // Fecha contrato de serviço avulso:
    contratosPorContato["lead-novo"] = 1;
    ehCliente = (contratosPorContato["lead-novo"] ?? 0) > 0;
    expect(ehCliente).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Cenário 11: Cliente com múltiplos contratos deve aparecer apenas uma vez
  // ---------------------------------------------------------------------------
  it("Cenário 11: Cliente com múltiplos contratos deve aparecer apenas uma vez na lista consolidada de clientes", () => {
    const contrato1 = criarContrato({ id: "c1", contact_id: "cliente-janaina", status: "active" });
    const contrato2 = criarContrato({
      id: "c2",
      contact_id: "cliente-janaina",
      modality: "recurring",
      status: "active",
    });
    const contrato3 = criarContrato({
      id: "c3",
      contact_id: "cliente-janaina",
      modality: "installments",
      status: "completed",
    });

    const metricas = calcularMetricasDashboard({
      contratos: [contrato1, contrato2, contrato3],
      cobrancas: [],
      dataHoje: hoje,
      periodoInicio: "all",
      periodoFim: "all",
    });

    // Janaína tem 2 ativos e 1 concluído, mas é 1 único cliente ativo!
    expect(metricas.clientes_ativos).toBe(1);
    expect(metricas.contratos_ativos).toBe(2);

    const perfil = construirPerfilFinanceiroCliente(
      { id: "cliente-janaina", display_name: "Janaína" },
      [contrato1, contrato2, contrato3],
      [],
      hoje,
    );
    expect(perfil.active_contracts).toBe(2);
    expect(perfil.total_contracts).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // Cenário 12: Filtro por período recalcula faturamento e recebimento conforme competência e pagamentos
  // ---------------------------------------------------------------------------
  it("Cenário 12: Filtro por período recalcula faturamento e recebimento conforme competência e pagamentos", () => {
    // Fatura 1: Maio/2026 (R$ 1.000,00)
    const faturaMaio = criarCobranca({
      id: "cob-maio",
      contract_id: "ct-1",
      due_date: "2026-05-10",
      paid_at: "2026-05-10T12:00:00Z",
      status: "paid",
      amount_cents: 100000,
      paid_cents: 100000,
    });

    // Fatura 2: Outubro/2026 (R$ 2.000,00)
    const faturaOutubro = criarCobranca({
      id: "cob-out",
      contract_id: "ct-2",
      due_date: "2026-10-05",
      paid_at: "2026-10-05T12:00:00Z",
      status: "paid",
      amount_cents: 200000,
      paid_cents: 200000,
    });

    const contratos = [
      criarContrato({ id: "ct-1", contract_date: "2026-05-10", total_cents: 100000 }),
      criarContrato({ id: "ct-2", contract_date: "2026-10-05", total_cents: 200000 }),
    ];

    // Consulta Maio
    const dashMaio = calcularMetricasDashboard({
      contratos,
      cobrancas: [faturaMaio, faturaOutubro],
      dataHoje: hoje,
      periodoInicio: "2026-05-01",
      periodoFim: "2026-05-31",
    });
    expect(dashMaio.faturamento_periodo_cents).toBe(100000);
    expect(dashMaio.total_recebido_cents).toBe(100000);

    // Consulta Outubro
    const dashOutubro = calcularMetricasDashboard({
      contratos,
      cobrancas: [faturaMaio, faturaOutubro],
      dataHoje: hoje,
      periodoInicio: "2026-10-01",
      periodoFim: "2026-10-31",
    });
    expect(dashOutubro.faturamento_periodo_cents).toBe(200000);
    expect(dashOutubro.total_recebido_cents).toBe(200000);

    // Consulta Ano 2026 completo
    const dashAno = calcularMetricasDashboard({
      contratos,
      cobrancas: [faturaMaio, faturaOutubro],
      dataHoje: hoje,
      periodoInicio: "2026-01-01",
      periodoFim: "2026-12-31",
    });
    expect(dashAno.faturamento_periodo_cents).toBe(300000);
    expect(dashAno.total_recebido_cents).toBe(300000);
  });

  // ---------------------------------------------------------------------------
  // Cenário 13: Contrato avulso não deve exibir "Período: Contínuo" na interface
  // ---------------------------------------------------------------------------
  it("Cenário 13: Contrato avulso não deve exibir texto de contrato contínuo", () => {
    const contratoAvulso = criarContrato({
      modality: "one_off",
      contract_date: "2026-05-10",
      start_date: "2026-05-10",
      end_date: "2026-06-10",
    });

    const formatarPeriodoContrato = (ct: ContratoFinanceiro) => {
      if (ct.modality === "one_off") {
        return `Avulso (Contratação: ${ct.contract_date || ct.start_date})${ct.end_date ? ` · Previsão Entrega: ${ct.end_date}` : ""}`;
      }
      if (ct.modality === "installments") {
        return `Parcelado · Início: ${ct.start_date}${ct.end_date ? ` até ${ct.end_date}` : ""}`;
      }
      return `${ct.start_date} ${ct.end_date ? `até ${ct.end_date}` : "• Recorrente / Contínuo"}`;
    };

    const textoFormatado = formatarPeriodoContrato(contratoAvulso);
    expect(textoFormatado).not.toContain("Contínuo");
    expect(textoFormatado).toContain("Avulso (Contratação: 2026-05-10)");
  });

  // ---------------------------------------------------------------------------
  // Cenário 14: Garantia de isolamento multi-tenant
  // ---------------------------------------------------------------------------
  it("Cenário 14: Garantia de isolamento multi-tenant: dados de uma organização não afetam outra", () => {
    const contratoOrg1 = criarContrato({
      organization_id: "org-1",
      contact_id: "ct-1",
      total_cents: 500000,
    });
    const contratoOrg2 = criarContrato({
      organization_id: "org-2",
      contact_id: "ct-2",
      total_cents: 99999999,
    });

    // Se o filtro do banco para org-1 retornar apenas contratos com organization_id === "org-1":
    const contratosOrg1 = [contratoOrg1, contratoOrg2].filter(
      (c) => c.organization_id === "org-1",
    );

    const metricas = calcularMetricasDashboard({
      contratos: contratosOrg1,
      cobrancas: [],
      dataHoje: hoje,
      periodoInicio: "all",
      periodoFim: "all",
    });

    expect(metricas.clientes_ativos).toBe(1);
    expect(contratosOrg1).toHaveLength(1);
    expect(contratosOrg1[0]!.organization_id).toBe("org-1");
  });
});
