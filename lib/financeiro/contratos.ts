import { z } from "zod";

export const MODALIDADES_CONTRATO = ["one_off", "installments", "recurring"] as const;
export const PERIODICIDADES_RECORRENCIA = [
  "monthly",
  "bimonthly",
  "quarterly",
  "semi_annual",
  "annual",
] as const;
export const STATUS_CONTRATO = ["draft", "active", "paused", "completed", "cancelled"] as const;
export const STATUS_PAGAMENTO_CONTRATO = ["pending", "full", "partial"] as const;

export const criarContratoSchema = z
  .object({
    contact_id: z.string().uuid("Cliente inválido."),
    company_id: z.string().uuid().nullish(),
    lead_id: z.string().uuid().nullish(),
    responsible_user_id: z.string().uuid().nullish(),
    title: z.string().trim().min(2, "Título deve ter no mínimo 2 caracteres.").max(150).optional(),
    service_name: z.string().trim().min(2, "Nome do serviço deve ter no mínimo 2 caracteres.").max(150).optional(),
    description: z.string().trim().max(1000).nullish(),
    modality: z.enum(MODALIDADES_CONTRATO).default("recurring"),
    recurrence_period: z.enum(PERIODICIDADES_RECORRENCIA).nullish(),
    total_cents: z.coerce.number().int().min(0, "Valor não pode ser negativo.").optional(),
    amount_cents: z.coerce.number().int().min(0).optional(),
    currency: z.string().length(3).default("BRL"),
    contract_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data do contrato inválida.")
      .default(() => new Date().toISOString().slice(0, 10)),
    start_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de início inválida.")
      .default(() => new Date().toISOString().slice(0, 10)),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de término inválida.").nullish(),
    due_day: z.coerce.number().int().min(1).max(31).nullish(),
    status: z.enum(STATUS_CONTRATO).default("active"),
    notes: z.string().max(2000).nullish(),
    installments_count: z.coerce.number().int().min(1).max(120).default(1),
    gerar_cobrancas: z.boolean().default(true),
    gerar_cobrancas_automaticas: z.boolean().optional(),

    // Pagamento inicial (integral, parcial ou pendente)
    payment_status: z.enum(["pending", "full", "partial"]).optional(),
    status_pagamento: z.enum(["pending", "full", "partial", "pendente", "integral", "parcial"]).optional(),
    paid_amount_cents: z.coerce.number().int().min(0).optional(),
    valor_pago_cents: z.coerce.number().int().min(0).optional(),
    payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de pagamento inválida.").nullish(),
    data_pagamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de pagamento inválida.").nullish(),
    data_pagamento_realizada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de pagamento inválida.").nullish(),
    payment_method: z.string().nullish(),
    forma_pagamento: z.string().nullish(),
    account_id: z.string().uuid().nullish(),

    // Legado / compatibilidade
    pagamento_ja_realizado: z.boolean().optional(),
  })
  .transform((data) => {
    const nome = data.service_name ?? data.title ?? "Serviço sem título";
    const valor = data.total_cents ?? data.amount_cents ?? 0;
    const auto = data.gerar_cobrancas_automaticas ?? data.gerar_cobrancas ?? true;

    // Normalizar status do pagamento
    let paymentStatus: "pending" | "full" | "partial" = "pending";
    if (
      data.status_pagamento === "integral" ||
      data.status_pagamento === "full" ||
      data.payment_status === "full" ||
      data.pagamento_ja_realizado === true
    ) {
      paymentStatus = "full";
    } else if (
      data.status_pagamento === "parcial" ||
      data.status_pagamento === "partial" ||
      data.payment_status === "partial"
    ) {
      paymentStatus = "partial";
    }

    let paidAmountCents = 0;
    if (paymentStatus === "full") {
      paidAmountCents = data.paid_amount_cents ?? data.valor_pago_cents ?? valor;
    } else if (paymentStatus === "partial") {
      paidAmountCents = data.paid_amount_cents ?? data.valor_pago_cents ?? 0;
    }

    const effectivePaymentDate =
      data.payment_date ||
      data.data_pagamento ||
      data.data_pagamento_realizada ||
      data.contract_date ||
      data.start_date;

    const effectivePaymentMethod = data.payment_method || data.forma_pagamento || "pix";

    return {
      ...data,
      title: nome,
      service_name: nome,
      total_cents: valor,
      amount_cents: valor,
      gerar_cobrancas: auto,
      gerar_cobrancas_automaticas: auto,
      payment_status: paymentStatus,
      paid_amount_cents: paidAmountCents,
      payment_date: effectivePaymentDate,
      payment_method: effectivePaymentMethod,
      pagamento_ja_realizado: paymentStatus !== "pending" && paidAmountCents > 0,
      data_pagamento_realizada: effectivePaymentDate,
      forma_pagamento: effectivePaymentMethod,
    };
  });

export const registrarPagamentoContratoSchema = z.object({
  valor_pago_cents: z.coerce.number().int().min(1, "Valor do pagamento deve ser maior que zero."),
  tipo_pagamento: z.enum(["full", "partial"]).default("full").optional(),
  data_pagamento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de pagamento inválida.")
    .default(() => new Date().toISOString().slice(0, 10)),
  forma_pagamento: z.string().default("pix"),
  account_id: z.string().uuid("Conta bancária inválida.").nullish(),
  observacoes: z.string().max(2000).nullish(),
});

export const atualizarContratoSchema = z.object({
  contact_id: z.string().uuid().optional(),
  lead_id: z.string().uuid().nullish(),
  responsible_user_id: z.string().uuid().nullish(),
  title: z.string().trim().min(2).max(150).optional(),
  service_name: z.string().trim().min(2).max(150).optional(),
  description: z.string().trim().max(1000).nullish(),
  modality: z.enum(MODALIDADES_CONTRATO).optional(),
  recurrence_period: z.enum(PERIODICIDADES_RECORRENCIA).nullish(),
  total_cents: z.coerce.number().int().min(0).optional(),
  amount_cents: z.coerce.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  contract_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  due_day: z.coerce.number().int().min(1).max(31).nullish(),
  installments_count: z.coerce.number().int().min(1).max(120).optional(),
  status: z.enum(STATUS_CONTRATO).optional(),
  notes: z.string().max(2000).nullish(),
  gerar_cobrancas_se_ausente: z.boolean().optional(),
});

export type CriarContratoInput = z.infer<typeof criarContratoSchema>;
export type AtualizarContratoInput = z.infer<typeof atualizarContratoSchema>;
export type RegistrarPagamentoContratoInput = z.infer<typeof registrarPagamentoContratoSchema>;

/**
 * Gera as parcelas ou cobrança inicial para um contrato criado.
 */
export function gerarParcelasDoContrato(params: {
  contract_id: string;
  organization_id?: string;
  contact_id: string;
  lead_id?: string | null;
  title?: string;
  service_name?: string;
  total_cents?: number;
  amount_cents?: number;
  modality: "one_off" | "installments" | "recurring";
  recurrence_period?: "monthly" | "bimonthly" | "quarterly" | "semi_annual" | "annual" | null;
  installments_count?: number;
  contract_date?: string;
  start_date: string; // YYYY-MM-DD
  due_day?: number | null;
  currency?: string;
  payment_status?: "pending" | "full" | "partial";
  paid_amount_cents?: number;
  payment_date?: string;
  payment_method?: string;
}): Array<{
  organization_id?: string;
  contract_id: string;
  contact_id: string;
  lead_id: string | null;
  direction: "in";
  type: "income";
  category: string;
  title: string;
  contracted_cents: number;
  amount_cents: number;
  billed_cents: number;
  paid_cents: number;
  paid_at: string | null;
  payment_method: string | null;
  currency: string;
  due_date: string;
  installment_number: number;
  total_installments: number;
  installment_total: number;
  status: "pending" | "paid" | "partially_paid";
}> {
  const {
    contract_id,
    organization_id,
    contact_id,
    lead_id = null,
    title: pTitle,
    service_name: pServiceName,
    total_cents: pTotal,
    amount_cents: pAmount,
    modality,
    installments_count = 1,
    contract_date,
    start_date,
    due_day,
    currency = "BRL",
    payment_status = "pending",
    paid_amount_cents = 0,
    payment_date,
    payment_method = "pix",
  } = params;

  const title = pTitle ?? pServiceName ?? "Serviço";
  const total_cents = pTotal ?? pAmount ?? 0;

  const effectivePaidDateStr = payment_date || contract_date || start_date;
  const effectivePaidAt = effectivePaidDateStr ? new Date(`${effectivePaidDateStr}T12:00:00Z`).toISOString() : null;

  const parcelas = [];
  const diaBase = due_day ?? parseInt(start_date.slice(8, 10), 10);
  const dataInicio = new Date(`${start_date}T12:00:00Z`);

  if (modality === "one_off") {
    // Parcela única
    let status: "pending" | "paid" | "partially_paid" = "pending";
    let paid_cents = 0;
    if (payment_status === "full") {
      status = "paid";
      paid_cents = total_cents;
    } else if (payment_status === "partial" && paid_amount_cents > 0) {
      paid_cents = Math.min(total_cents, paid_amount_cents);
      status = paid_cents >= total_cents ? "paid" : "partially_paid";
    }

    parcelas.push({
      organization_id,
      contract_id,
      contact_id,
      lead_id,
      direction: "in" as const,
      type: "income" as const,
      category: "servico_avulso",
      title: `${title}`,
      contracted_cents: total_cents,
      amount_cents: total_cents,
      billed_cents: total_cents,
      paid_cents,
      paid_at: paid_cents > 0 ? effectivePaidAt : null,
      payment_method: paid_cents > 0 ? payment_method : null,
      currency,
      due_date: contract_date || start_date,
      installment_number: 1,
      total_installments: 1,
      installment_total: 1,
      status,
    });
  } else if (modality === "installments") {
    const totalParc = Math.max(1, installments_count);
    const valorParcelaBase = Math.floor(total_cents / totalParc);
    const resto = total_cents % totalParc;

    let saldoPagoRestante = payment_status === "full" ? total_cents : (paid_amount_cents || 0);

    for (let i = 1; i <= totalParc; i++) {
      const dt = new Date(dataInicio);
      dt.setUTCMonth(dt.getUTCMonth() + (i - 1));
      const maxDiasNoMes = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
      dt.setUTCDate(Math.min(diaBase, maxDiasNoMes));

      const dueDateStr = dt.toISOString().slice(0, 10);
      const valorDestaParcela = i === 1 ? valorParcelaBase + resto : valorParcelaBase;

      let pagoNestaParcela = 0;
      let statusParcela: "pending" | "paid" | "partially_paid" = "pending";

      if (saldoPagoRestante > 0) {
        pagoNestaParcela = Math.min(valorDestaParcela, saldoPagoRestante);
        saldoPagoRestante -= pagoNestaParcela;
        statusParcela = pagoNestaParcela >= valorDestaParcela ? "paid" : "partially_paid";
      }

      parcelas.push({
        organization_id,
        contract_id,
        contact_id,
        lead_id,
        direction: "in" as const,
        type: "income" as const,
        category: "parcelamento",
        title: `${title} (Parcela ${i}/${totalParc})`,
        contracted_cents: total_cents,
        amount_cents: valorDestaParcela,
        billed_cents: valorDestaParcela,
        paid_cents: pagoNestaParcela,
        paid_at: pagoNestaParcela > 0 ? effectivePaidAt : null,
        payment_method: pagoNestaParcela > 0 ? payment_method : null,
        currency,
        due_date: dueDateStr,
        installment_number: i,
        total_installments: totalParc,
        installment_total: totalParc,
        status: statusParcela,
      });
    }
  } else if (modality === "recurring") {
    // Na modalidade recorrente, gera a 1ª fatura para o início do ciclo
    let statusRec: "pending" | "paid" | "partially_paid" = "pending";
    let paidRec = 0;
    if (payment_status === "full") {
      statusRec = "paid";
      paidRec = total_cents;
    } else if (payment_status === "partial" && paid_amount_cents > 0) {
      paidRec = Math.min(total_cents, paid_amount_cents);
      statusRec = paidRec >= total_cents ? "paid" : "partially_paid";
    }

    parcelas.push({
      organization_id,
      contract_id,
      contact_id,
      lead_id,
      direction: "in" as const,
      type: "income" as const,
      category: "recorrencia",
      title: `${title} (Mensalidade 1)`,
      contracted_cents: total_cents,
      amount_cents: total_cents,
      billed_cents: total_cents,
      paid_cents: paidRec,
      paid_at: paidRec > 0 ? effectivePaidAt : null,
      payment_method: paidRec > 0 ? payment_method : null,
      currency,
      due_date: start_date,
      installment_number: 1,
      total_installments: 1,
      installment_total: 1,
      status: statusRec,
    });
  }

  return parcelas;
}
