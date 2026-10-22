import { z } from "zod";

export const FORMAS_PAGAMENTO = [
  "pix",
  "credit_card",
  "debit_card",
  "boleto",
  "transfer",
  "bank_transfer",
  "bank_slip",
  "cash",
  "other",
] as const;

export const STATUS_COBRANCA = [
  "pending",
  "paid",
  "partial",
  "partially_paid",
  "overdue",
  "cancelled",
  "reversed",
] as const;

export const criarCobrancaSchema = z
  .object({
    contract_id: z.string().uuid().nullish(),
    contact_id: z.string().uuid().nullish(),
    lead_id: z.string().uuid().nullish(),
    account_id: z.string().uuid().nullish(),
    account_plan_id: z.string().uuid().nullish(),
    type: z.enum(["income", "expense"]).optional(),
    direction: z.enum(["in", "out"]).optional(),
    category: z.string().max(80).default("outros"),
    title: z
      .string()
      .trim()
      .min(2, "Título deve ter no mínimo 2 caracteres.")
      .max(150, "Título muito longo."),
    amount_cents: z.coerce.number().int().min(1, "Valor deve ser maior que zero.").optional(),
    billed_cents: z.coerce.number().int().min(1).optional(),
    currency: z.string().length(3).default("BRL"),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de vencimento inválida."),
    payment_method: z.enum(FORMAS_PAGAMENTO).nullish(),
    installment_number: z.coerce.number().int().min(1).default(1),
    total_installments: z.coerce.number().int().min(1).optional(),
    installment_total: z.coerce.number().int().min(1).optional(),
    status: z.enum(STATUS_COBRANCA).default("pending"),
    notes: z.string().max(1000).nullish(),
    pago_agora: z.boolean().default(false),
  })
  .transform((data) => {
    const isIncome = data.type ? data.type === "income" : data.direction !== "out";
    const amount = data.billed_cents ?? data.amount_cents ?? 0;
    const installments = data.installment_total ?? data.total_installments ?? 1;
    const statusFinal = data.status === "partial" ? "partially_paid" : data.status;

    return {
      ...data,
      type: (isIncome ? "income" : "expense") as "income" | "expense",
      direction: (isIncome ? "in" : "out") as "in" | "out",
      amount_cents: amount,
      billed_cents: amount,
      installment_number: data.installment_number,
      total_installments: installments,
      installment_total: installments,
      status: statusFinal as "pending" | "paid" | "partially_paid" | "overdue" | "cancelled" | "reversed",
    };
  });

export const atualizarCobrancaSchema = z.object({
  title: z.string().min(2).max(150).optional(),
  billed_cents: z.coerce.number().int().min(1).optional(),
  amount_cents: z.coerce.number().int().min(1).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(STATUS_COBRANCA).optional(),
  payment_method: z.enum(FORMAS_PAGAMENTO).nullish(),
  notes: z.string().max(2000).nullish(),
});

export const registrarPagamentoSchema = z
  .object({
    paid_cents: z.coerce.number().int().min(1).optional(),
    valor_pago_cents: z.coerce.number().int().min(1).optional(),
    paid_at: z.string().optional(),
    data_pagamento: z.string().optional(),
    payment_method: z.enum(FORMAS_PAGAMENTO).optional(),
    forma_pagamento: z.enum(FORMAS_PAGAMENTO).optional(),
    account_id: z.string().uuid().nullish(),
    notes: z.string().max(500).nullish(),
    observacoes: z.string().max(500).nullish(),
  })
  .transform((data) => {
    const paid = data.valor_pago_cents ?? data.paid_cents ?? 0;
    const dataPag = data.data_pagamento ?? data.paid_at ?? new Date().toISOString();
    const forma = data.forma_pagamento ?? data.payment_method ?? "pix";
    const obs = data.observacoes ?? data.notes ?? null;
    return {
      ...data,
      paid_cents: paid,
      valor_pago_cents: paid,
      paid_at: dataPag,
      data_pagamento: dataPag,
      payment_method: forma,
      forma_pagamento: forma,
      notes: obs,
      observacoes: obs,
    };
  });

export const estornarCobrancaSchema = z
  .object({
    reason: z.string().trim().min(3).optional(),
    motivo: z.string().trim().min(3).optional(),
  })
  .transform((data) => {
    const motivoFinal = data.motivo ?? data.reason ?? "Estorno solicitado";
    return {
      reason: motivoFinal,
      motivo: motivoFinal,
    };
  });

export type CriarCobrancaInput = z.infer<typeof criarCobrancaSchema>;
export type AtualizarCobrancaInput = z.infer<typeof atualizarCobrancaSchema>;
export type RegistrarPagamentoInput = z.infer<typeof registrarPagamentoSchema>;
export type EstornarCobrancaInput = z.infer<typeof estornarCobrancaSchema>;
