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
    pagamento_ja_realizado: z.boolean().default(false),
    data_pagamento_realizada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de pagamento inválida.").nullish(),
    forma_pagamento: z.string().nullish(),
    account_id: z.string().uuid().nullish(),
  })
  .transform((data) => {
    const nome = data.service_name ?? data.title ?? "Serviço sem título";
    const valor = data.total_cents ?? data.amount_cents ?? 0;
    const auto = data.gerar_cobrancas_automaticas ?? data.gerar_cobrancas ?? true;
    return {
      ...data,
      title: nome,
      service_name: nome,
      total_cents: valor,
      amount_cents: valor,
      gerar_cobrancas: auto,
      gerar_cobrancas_automaticas: auto,
      pagamento_ja_realizado: data.pagamento_ja_realizado ?? false,
    };
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
  status: z.enum(STATUS_CONTRATO).optional(),
  notes: z.string().max(2000).nullish(),
});

export type CriarContratoInput = z.infer<typeof criarContratoSchema>;
export type AtualizarContratoInput = z.infer<typeof atualizarContratoSchema>;

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
  start_date: string; // YYYY-MM-DD
  due_day?: number | null;
  currency?: string;
}): Array<{
  organization_id?: string;
  contract_id: string;
  contact_id: string;
  lead_id: string | null;
  direction: "in";
  category: string;
  title: string;
  contracted_cents: number;
  amount_cents: number;
  billed_cents: number;
  paid_cents: number;
  currency: string;
  due_date: string;
  installment_number: number;
  total_installments: number;
  installment_total: number;
  status: "pending";
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
    start_date,
    due_day,
    currency = "BRL",
  } = params;

  const title = pTitle ?? pServiceName ?? "Serviço";
  const total_cents = pTotal ?? pAmount ?? 0;

  const parcelas = [];
  const diaBase = due_day ?? parseInt(start_date.slice(8, 10), 10);
  const dataInicio = new Date(`${start_date}T12:00:00Z`);

  if (modality === "one_off") {
    // Parcela única
    parcelas.push({
      organization_id,
      contract_id,
      contact_id,
      lead_id,
      direction: "in" as const,
      category: "servico_avulso",
      title: `${title}`,
      contracted_cents: total_cents,
      amount_cents: total_cents,
      billed_cents: total_cents,
      paid_cents: 0,
      currency,
      due_date: start_date,
      installment_number: 1,
      total_installments: 1,
      installment_total: 1,
      status: "pending" as const,
    });
  } else if (modality === "installments") {
    const totalParc = Math.max(1, installments_count);
    const valorParcelaBase = Math.floor(total_cents / totalParc);
    const resto = total_cents % totalParc;

    for (let i = 1; i <= totalParc; i++) {
      const dt = new Date(dataInicio);
      dt.setUTCMonth(dt.getUTCMonth() + (i - 1));
      const maxDiasNoMes = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
      dt.setUTCDate(Math.min(diaBase, maxDiasNoMes));

      const dueDateStr = dt.toISOString().slice(0, 10);
      const valorDestaParcela = i === 1 ? valorParcelaBase + resto : valorParcelaBase;

      parcelas.push({
        organization_id,
        contract_id,
        contact_id,
        lead_id,
        direction: "in" as const,
        category: "parcelamento",
        title: `${title} (Parcela ${i}/${totalParc})`,
        contracted_cents: total_cents,
        amount_cents: valorDestaParcela,
        billed_cents: valorDestaParcela,
        paid_cents: 0,
        currency,
        due_date: dueDateStr,
        installment_number: i,
        total_installments: totalParc,
        installment_total: totalParc,
        status: "pending" as const,
      });
    }
  } else if (modality === "recurring") {
    // Na modalidade recorrente, gera a 1ª fatura para o início do ciclo
    parcelas.push({
      organization_id,
      contract_id,
      contact_id,
      lead_id,
      direction: "in" as const,
      category: "recorrencia",
      title: `${title} (Mensalidade 1)`,
      contracted_cents: total_cents,
      amount_cents: total_cents,
      billed_cents: total_cents,
      paid_cents: 0,
      currency,
      due_date: start_date,
      installment_number: 1,
      total_installments: 1,
      installment_total: 1,
      status: "pending" as const,
    });
  }

  return parcelas;
}
