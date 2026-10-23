/**
 * Funcoes puras de calculo financeiro.
 *
 * Todas as operacoes monetarias trabalham exclusivamente em centavos (inteiros).
 * Segue a regra do usuario:
 * - Projetos avulsos e parcelas de vendas unicas NAO entram em MRR.
 * - Somente contratos recorrentes ativos compoem o MRR/ARR.
 * - Distingue faturamento contratado, receita prevista e dinheiro efetivamente recebido.
 */

import type {
  CobrancaFinanceira,
  ContratoFinanceiro,
  MetricasDashboardFinanceiro,
  StatusCobranca,
} from "./types";

/**
 * Calcula o MRR (Monthly Recurring Revenue) da carteira de contratos em centavos.
 *
 * Somente contratos ativos e com modalidade 'recurring' entram no cálculo.
 * Projetos avulsos (one_off) e parcelados (installments) são expressamente excluídos.
 */
export function calcularMRR(contratos: ContratoFinanceiro[]): number {
  let mrrCents = 0;

  for (const c of contratos) {
    if (c.status !== "active" || c.modality !== "recurring") {
      continue;
    }

    const valor = c.total_cents;
    const periodicidade = c.recurrence_period ?? "monthly";

    switch (periodicidade) {
      case "monthly":
        mrrCents += valor;
        break;
      case "bimonthly":
        mrrCents += Math.round(valor / 2);
        break;
      case "quarterly":
        mrrCents += Math.round(valor / 3);
        break;
      case "semi_annual":
        mrrCents += Math.round(valor / 6);
        break;
      case "annual":
        mrrCents += Math.round(valor / 12);
        break;
      default:
        mrrCents += valor;
    }
  }

  return mrrCents;
}

/**
 * Calcula o ARR (Annual Recurring Revenue) a partir do MRR em centavos.
 */
export function calcularARR(mrrCents: number): number {
  return mrrCents * 12;
}

/**
 * Determina o status real de uma cobranca considerando pagamentos parciais e vencimento.
 */
export function calcularStatusEfetivoCobranca(
  cobranca: {
    status: StatusCobranca;
    due_date: string;
    amount_cents: number;
    paid_cents: number;
    paid_at: string | null;
  },
  dataReferenciaHoje: string,
): StatusCobranca {
  if (cobranca.status === "cancelled" || cobranca.status === "reversed") {
    return cobranca.status;
  }

  if (cobranca.paid_cents >= cobranca.amount_cents && cobranca.amount_cents > 0) {
    return "paid";
  }

  if (cobranca.paid_cents > 0 && cobranca.paid_cents < cobranca.amount_cents) {
    return "partial";
  }

  if (cobranca.due_date < dataReferenciaHoje) {
    return "overdue";
  }

  return "pending";
}

/**
 * Agrega todas as métricas para o Dashboard Financeiro.
 */
export function calcularMetricasDashboard(params: {
  contratos: ContratoFinanceiro[] | any[];
  cobrancas?: CobrancaFinanceira[] | any[];
  faturas?: CobrancaFinanceira[] | any[];
  cobrancasPeriodoAnterior?: CobrancaFinanceira[] | any[];
  dataHoje?: string; // YYYY-MM-DD
  periodoInicio?: string;
  periodoFim?: string;
}): MetricasDashboardFinanceiro {
  const dataHoje = params.dataHoje ?? new Date().toISOString().slice(0, 10);
  const contratos = (params.contratos ?? []).map((ct: any) => ({
    ...ct,
    total_cents: ct.total_cents ?? ct.amount_cents ?? 0,
    amount_cents: ct.amount_cents ?? ct.total_cents ?? 0,
    currency: ct.currency ?? "BRL",
    modality: ct.modality ?? "recurring",
    status: ct.status ?? "active",
  }));
  const rawCobrancas = params.cobrancas ?? params.faturas ?? [];
  const cobrancas: CobrancaFinanceira[] = rawCobrancas.map((c: any) => ({
    ...c,
    contracted_cents: c.contracted_cents ?? c.amount_cents ?? c.billed_cents ?? 0,
    amount_cents: c.amount_cents ?? c.billed_cents ?? 0,
    billed_cents: c.billed_cents ?? c.amount_cents ?? 0,
    paid_cents: c.paid_cents ?? 0,
    direction: c.direction ?? (c.type === "expense" ? "out" : "in"),
    currency: c.currency ?? "BRL",
    status: c.status ?? "pending",
  }));
  const cobrancasPeriodoAnterior = (params.cobrancasPeriodoAnterior ?? []).map((c: any) => ({
    ...c,
    contracted_cents: c.contracted_cents ?? c.amount_cents ?? c.billed_cents ?? 0,
    amount_cents: c.amount_cents ?? c.billed_cents ?? 0,
    paid_cents: c.paid_cents ?? 0,
    direction: c.direction ?? (c.type === "expense" ? "out" : "in"),
    currency: c.currency ?? "BRL",
    status: c.status ?? "pending",
  }));

  const mrr_cents = calcularMRR(contratos);
  const arr_cents = calcularARR(mrr_cents);

  const periodoInicio = params.periodoInicio;
  const periodoFim = params.periodoFim;
  const filtrarPorPeriodo = Boolean(periodoInicio && periodoInicio !== "all" && periodoFim);

  let faturamento_periodo_cents = 0;
  let total_recebido_cents = 0;
  let total_a_receber_cents = 0;
  let despesas_cents = 0;

  const clientesAtivosSet = new Set<string>();
  const clientesInadimplentesMap = new Map<
    string,
    {
      contact_id: string;
      contact_name: string;
      phone_number: string | null;
      email: string | null;
      valor_vencido_cents: number;
      faturas_atrasadas: number;
      maior_atraso_dias: number;
    }
  >();

  const proximosVencimentos: CobrancaFinanceira[] = [];

  // Mapear contratos que possuem cobranças vinculadas
  const contratosComCobrancasSet = new Set<string>();

  for (const c of cobrancas) {
    if (c.contract_id) {
      contratosComCobrancasSet.add(c.contract_id);
    }

    const statusEfetivo = calcularStatusEfetivoCobranca(c, dataHoje);
    const dataVencimento = c.due_date ? String(c.due_date).slice(0, 10) : "";
    const dataPagamento = c.paid_at ? String(c.paid_at).slice(0, 10) : dataVencimento;

    if (c.direction === "in") {
      // 1. Faturamento do período: receitas reconhecidas por competência (due_date)
      const entraNoFaturamento = !filtrarPorPeriodo || (dataVencimento >= periodoInicio! && dataVencimento <= periodoFim!);
      if (entraNoFaturamento && statusEfetivo !== "cancelled" && statusEfetivo !== "reversed") {
        faturamento_periodo_cents += c.amount_cents;
      }

      // 2. Total recebido: pagamentos efetivamente confirmados no período (usando a data real de recebimento)
      const entraNoRecebido = !filtrarPorPeriodo || (dataPagamento >= periodoInicio! && dataPagamento <= periodoFim!);
      if (entraNoRecebido && c.paid_cents > 0) {
        total_recebido_cents += c.paid_cents;
      }

      // 3. A receber: saldo pendente de cobranças abertas
      const pendente = Math.max(0, c.amount_cents - c.paid_cents);
      if (statusEfetivo !== "paid" && statusEfetivo !== "cancelled" && statusEfetivo !== "reversed") {
        total_a_receber_cents += pendente;
      }

      // Inadimplência
      if (statusEfetivo === "overdue" && c.contact_id) {
        const diffDias = Math.max(
          1,
          Math.floor((Date.parse(dataHoje) - Date.parse(c.due_date)) / 86_400_000),
        );
        const contactName = c.contact?.display_name || c.contact?.name || "Cliente sem nome";
        const entry = clientesInadimplentesMap.get(c.contact_id) ?? {
          contact_id: c.contact_id,
          contact_name: contactName,
          phone_number: c.contact?.phone_number ?? null,
          email: c.contact?.email ?? null,
          valor_vencido_cents: 0,
          faturas_atrasadas: 0,
          maior_atraso_dias: 0,
        };

        entry.valor_vencido_cents += pendente;
        entry.faturas_atrasadas += 1;
        entry.maior_atraso_dias = Math.max(entry.maior_atraso_dias, diffDias);
        clientesInadimplentesMap.set(c.contact_id, entry);
      }

      // Próximos vencimentos (pendentes ou parciais que vencem hoje ou no futuro)
      if (
        (statusEfetivo === "pending" || statusEfetivo === "partial") &&
        c.due_date >= dataHoje
      ) {
        proximosVencimentos.push(c);
      }
    } else if (c.direction === "out") {
      // Despesas: efetivamente pagas no período selecionado
      const entraNaDespesa = !filtrarPorPeriodo || (dataPagamento >= periodoInicio! && dataPagamento <= periodoFim!);
      if (entraNaDespesa && (statusEfetivo === "paid" || c.paid_cents > 0)) {
        despesas_cents += c.paid_cents > 0 ? c.paid_cents : c.amount_cents;
      }
    }
  }

  // Contratos: apuração de clientes ativos, contratos ativos e faturamento sem cobranças
  let contratos_ativos_total = 0;
  let contratos_recorrentes_ativos = 0;
  let cancelamentos_churn_qtd = 0;
  let total_contratos_recorrentes = 0;

  for (const c of contratos) {
    // Todo cliente com contrato ativo (recorrente, avulso em andamento ou parcelado) É CLIENTE ATIVO
    if (c.status === "active") {
      contratos_ativos_total += 1;
      if (c.contact_id) {
        clientesAtivosSet.add(c.contact_id);
      }

      // Se o contrato não tiver cobranças geradas em financial_invoices, reconhece sua receita e saldos
      if (c.id && !contratosComCobrancasSet.has(c.id)) {
        const valContrato = Number(c.amount_cents || c.total_cents || 0);
        const dataContrato = (c.contract_date || c.start_date || "").slice(0, 10);
        const entraNoFaturamentoContrato =
          !filtrarPorPeriodo || (dataContrato >= periodoInicio! && dataContrato <= periodoFim!);
        if (entraNoFaturamentoContrato) {
          faturamento_periodo_cents += valContrato;
        }

        const meta = (c.metadata as Record<string, unknown>) || {};
        const pagoMeta = Number(meta.paid_amount_cents || meta.paid_cents || 0);
        if (pagoMeta > 0) {
          const dataPagoMeta = String(meta.payment_date || dataContrato).slice(0, 10);
          const entraNoPago = !filtrarPorPeriodo || (dataPagoMeta >= periodoInicio! && dataPagoMeta <= periodoFim!);
          if (entraNoPago) {
            total_recebido_cents += pagoMeta;
          }
        }
        const pendenteContrato = Math.max(0, valContrato - pagoMeta);
        if (pendenteContrato > 0) {
          total_a_receber_cents += pendenteContrato;
        }
      }
    }

    if (c.modality === "recurring") {
      total_contratos_recorrentes += 1;
      if (c.status === "active") {
        contratos_recorrentes_ativos += 1;
      } else if (c.status === "cancelled") {
        cancelamentos_churn_qtd += 1;
      }
    }
  }

  // Clientes com cobranças pagas ou ativas também são clientes ativos
  for (const cob of cobrancas) {
    if (cob.contact_id && cob.direction === "in" && (cob.status === "paid" || cob.paid_cents > 0)) {
      clientesAtivosSet.add(cob.contact_id);
    }
  }

  // Churn rate
  const churn_rate_pct =
    total_contratos_recorrentes > 0
      ? Number(((cancelamentos_churn_qtd / total_contratos_recorrentes) * 100).toFixed(1))
      : 0;

  // Crescimento de receita
  let recebidoAnterior = 0;
  for (const ant of cobrancasPeriodoAnterior) {
    if (ant.direction === "in") {
      recebidoAnterior += ant.paid_cents;
    }
  }

  let crescimento_receita_pct = 0;
  if (recebidoAnterior > 0) {
    crescimento_receita_pct = Number(
      (((total_recebido_cents - recebidoAnterior) / recebidoAnterior) * 100).toFixed(1),
    );
  } else if (total_recebido_cents > 0) {
    crescimento_receita_pct = 100;
  }

  // Resultado
  const resultado_cents = total_recebido_cents - despesas_cents;

  // Ordena próximos vencimentos por data mais próxima
  proximosVencimentos.sort((a, b) => a.due_date.localeCompare(b.due_date));

  // Lista de inadimplentes formatada
  const inadimplentes_lista = Array.from(clientesInadimplentesMap.values()).map((item) => ({
    contact_id: item.contact_id,
    contact_name: item.contact_name,
    phone_number: item.phone_number,
    email: item.email,
    valor_vencido_cents: item.valor_vencido_cents,
    dias_atraso: item.maior_atraso_dias,
    faturas_atrasadas: item.faturas_atrasadas,
  }));
  inadimplentes_lista.sort((a, b) => b.valor_vencido_cents - a.valor_vencido_cents);

  // Evolução mensal (agrupa por mês YYYY-MM)
  const mesesMap = new Map<string, { receitas: number; despesas: number }>();
  for (const c of cobrancas) {
    const mes = c.due_date.slice(0, 7);
    const atual = mesesMap.get(mes) ?? { receitas: 0, despesas: 0 };
    if (c.direction === "in" && (c.status === "paid" || c.paid_cents > 0)) {
      atual.receitas += c.paid_cents;
    } else if (c.direction === "out" && c.status === "paid") {
      atual.despesas += c.paid_cents > 0 ? c.paid_cents : c.amount_cents;
    }
    mesesMap.set(mes, atual);
  }

  const evolucao_mensal = Array.from(mesesMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([mes, valores]) => ({
      mes,
      receitas_cents: valores.receitas,
      despesas_cents: valores.despesas,
      resultado_cents: valores.receitas - valores.despesas,
    }));

  return {
    mrr_cents,
    arr_cents,
    faturamento_periodo_cents,
    total_recebido_cents,
    total_a_receber_cents,
    despesas_cents,
    resultado_cents,
    clientes_ativos: clientesAtivosSet.size,
    clientes_inadimplentes: clientesInadimplentesMap.size,
    contratos_ativos: contratos_ativos_total,
    contratos_recorrentes_ativos,
    crescimento_receita_pct,
    cancelamentos_churn_qtd,
    churn_rate_pct,
    proximos_vencimentos: proximosVencimentos.slice(0, 10),
    inadimplentes_lista,
    evolucao_mensal,
  };
}
