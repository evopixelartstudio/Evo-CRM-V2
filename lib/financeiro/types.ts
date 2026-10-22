/**
 * Tipos e contratos do modulo de Financeiro Integrado.
 *
 * Abrange: Contratos (avulsos, parcelados, recorrentes), Cobrancas (invoices/faturas),
 * Receitas e Despesas, Pagamentos (pix, cartao, boleto, transferencia, dinheiro) e
 * Dashboard com MRR/ARR e saude financeira de clientes.
 */

export type ModalidadeContrato = "one_off" | "installments" | "recurring";
export type PeriodicidadeRecorrencia = "monthly" | "bimonthly" | "quarterly" | "semi_annual" | "annual";
export type StatusContrato = "draft" | "active" | "paused" | "completed" | "cancelled";
export type StatusCobranca = "pending" | "paid" | "partial" | "overdue" | "cancelled" | "reversed";
export type DirecaoFinanceira = "in" | "out";
export type FormaPagamento = "pix" | "credit_card" | "debit_card" | "boleto" | "transfer" | "cash" | "other";

export interface ContratoFinanceiro {
  id: string;
  organization_id: string;
  contact_id: string;
  company_id: string | null;
  lead_id: string | null;
  responsible_user_id: string | null;
  title: string;
  description: string | null;
  modality: ModalidadeContrato;
  recurrence_period: PeriodicidadeRecorrencia | null;
  total_cents: number;
  currency: string;
  contract_date: string; // YYYY-MM-DD
  start_date: string;
  end_date: string | null;
  due_day: number | null;
  status: StatusContrato;
  notes: string | null;
  custom_fields?: Record<string, unknown>;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;

  // Relacionamentos expandidos
  contact?: {
    id: string;
    name: string | null;
    display_name: string | null;
    phone_number: string | null;
    email: string | null;
    custom_fields?: Record<string, unknown>;
  };
  responsible?: {
    id: string;
    name: string | null;
    email: string | null;
  };
}

export interface CobrancaFinanceira {
  id: string;
  organization_id: string;
  contract_id: string | null;
  contact_id: string | null;
  lead_id: string | null;
  account_id: string | null;
  account_plan_id: string | null;
  direction: DirecaoFinanceira;
  category: string | null;
  title: string;
  contracted_cents: number;
  amount_cents: number;
  paid_cents: number;
  currency: string;
  due_date: string; // YYYY-MM-DD
  paid_at: string | null;
  payment_method: FormaPagamento | null;
  installment_number: number;
  total_installments: number;
  status: StatusCobranca;
  notes: string | null;
  reverses_invoice_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;

  // Relacionamentos expandidos
  contact?: {
    id: string;
    name: string | null;
    display_name: string | null;
    phone_number: string | null;
    email: string | null;
  };
  contract?: {
    id: string;
    title: string;
    modality: ModalidadeContrato;
  };
  account?: {
    id: string;
    name: string;
  };
  account_plan?: {
    id: string;
    name: string;
    direction: "in" | "out";
  };
}

export interface ClienteFinanceiroPerfil {
  id: string;
  name: string;
  display_name: string | null;
  trade_name: string | null;
  phone_number: string | null;
  email: string | null;
  instagram: string | null;
  document: string | null; // CPF ou CNPJ
  client_since: string | null; // YYYY-MM-DD
  commercial_status: "lead" | "cliente_ativo" | "cliente_inativo" | "ex_cliente";
  financial_status: "em_dia" | "inadimplente" | "isento" | "cancelado";
  notes: string | null;
  total_contracts: number;
  active_contracts: number;
  total_paid_cents: number;
  total_overdue_cents: number;
  contracts?: ContratoFinanceiro[];
  invoices?: CobrancaFinanceira[];
}

export interface MetricasDashboardFinanceiro {
  mrr_cents: number;
  arr_cents: number;
  faturamento_periodo_cents: number;
  total_recebido_cents: number;
  total_a_receber_cents: number;
  despesas_cents: number;
  resultado_cents: number;
  clientes_ativos: number;
  clientes_inadimplentes: number;
  contratos_recorrentes_ativos: number;
  crescimento_receita_pct: number;
  cancelamentos_churn_qtd: number;
  churn_rate_pct: number;
  proximos_vencimentos: CobrancaFinanceira[];
  inadimplentes_lista: Array<{
    contact_id: string;
    contact_name: string;
    phone_number: string | null;
    email: string | null;
    valor_vencido_cents: number;
    dias_atraso: number;
    faturas_atrasadas: number;
  }>;
  evolucao_mensal: Array<{
    mes: string; // "2026-08", etc.
    receitas_cents: number;
    despesas_cents: number;
    resultado_cents: number;
  }>;
}
