import { z } from "zod";

import type { ClienteFinanceiroPerfil, CobrancaFinanceira, ContratoFinanceiro } from "./types";

export const atualizarClienteFinanceiroSchema = z.object({
  name: z.string().trim().min(2, "Nome deve ter no mínimo 2 caracteres.").optional(),
  display_name: z.string().trim().min(2).optional(),
  trade_name: z.string().trim().max(100).nullish(),
  phone_number: z.string().trim().max(30).nullish(),
  email: z.string().email("E-mail inválido.").nullish().or(z.literal("")),
  instagram: z.string().trim().max(80).nullish(),
  document: z.string().trim().max(30).nullish(),
  client_since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.").nullish(),
  commercial_status: z
    .enum(["lead", "cliente_ativo", "cliente_inativo", "ex_cliente"])
    .default("cliente_ativo"),
  financial_status: z
    .enum(["em_dia", "inadimplente", "isento", "cancelado"])
    .default("em_dia"),
  financial_notes: z.string().max(2000).nullish(),
});

export type AtualizarClienteFinanceiroInput = z.infer<typeof atualizarClienteFinanceiroSchema>;

export function extrairCamposFinanceirosDoContato(customFields: unknown): {
  trade_name: string | null;
  instagram: string | null;
  document: string | null;
  client_since: string | null;
  commercial_status: "lead" | "cliente_ativo" | "cliente_inativo" | "ex_cliente";
  financial_status: "em_dia" | "inadimplente" | "isento" | "cancelado";
  financial_notes: string | null;
} {
  const cf = (customFields && typeof customFields === "object" ? customFields : {}) as Record<string, unknown>;
  return {
    trade_name: (cf.trade_name as string) ?? null,
    instagram: (cf.instagram as string) ?? null,
    document: (cf.document as string) ?? (cf.cpf_cnpj as string) ?? null,
    client_since: (cf.client_since as string) ?? null,
    commercial_status: (cf.commercial_status as any) ?? "cliente_ativo",
    financial_status: (cf.financial_status as any) ?? "em_dia",
    financial_notes: (cf.financial_notes as string) ?? null,
  };
}

export function mesclarCamposFinanceirosNoContato(
  customFields: unknown,
  novosCampos: Record<string, unknown>,
): Record<string, unknown> {
  const cf = (customFields && typeof customFields === "object" ? customFields : {}) as Record<string, unknown>;
  return {
    ...cf,
    ...novosCampos,
  };
}

/**
 * Constrói o perfil financeiro de um cliente agregando contratos e cobranças.
 * Suporta chamada com objeto único de opções ou argumentos posicionais.
 */
export function construirPerfilFinanceiroCliente(
  arg1: any,
  arg2?: any,
  arg3?: any,
  arg4?: any,
): ClienteFinanceiroPerfil {
  let contact: any;
  let contracts: any[];
  let invoices: any[];
  let dataHoje: string;

  if (arg1 && typeof arg1 === "object" && ("contact" in arg1 || "contracts" in arg1)) {
    contact = arg1.contact;
    contracts = arg1.contracts ?? [];
    invoices = arg1.invoices ?? [];
    dataHoje = arg1.dataHoje ?? new Date().toISOString().slice(0, 10);
  } else {
    contact = arg1;
    contracts = arg2 ?? [];
    invoices = arg3 ?? [];
    dataHoje = arg4 ?? new Date().toISOString().slice(0, 10);
  }

  const cf = (contact.custom_fields ?? {}) as Record<string, unknown>;

  let total_paid_cents = 0;
  let total_overdue_cents = 0;
  let hasOverdue = false;

  for (const inv of invoices) {
    const isIncome = inv.direction === "in" || inv.type === "income";
    const amount = Number(inv.amount_cents ?? inv.billed_cents ?? 0);
    const paid = Number(inv.paid_cents ?? 0);
    const dueDate = inv.due_date;
    const status = inv.status;

    if (isIncome) {
      total_paid_cents += paid;
      const pendente = Math.max(0, amount - paid);
      if (
        status === "overdue" ||
        (status !== "paid" && status !== "cancelled" && status !== "reversed" && dueDate < dataHoje)
      ) {
        total_overdue_cents += pendente;
        hasOverdue = true;
      }
    }
  }

  let active_contracts = 0;
  for (const c of contracts) {
    if (c.status === "active") active_contracts++;
  }

  const calculatedFinancialStatus: "em_dia" | "inadimplente" | "isento" | "cancelado" = hasOverdue
    ? "inadimplente"
    : ((cf.financial_status as "em_dia" | "inadimplente" | "isento" | "cancelado") ?? "em_dia");

  return {
    id: contact.id,
    name: contact.name || contact.display_name || "Cliente sem nome",
    display_name: contact.display_name,
    trade_name: (cf.trade_name as string) ?? null,
    phone_number: contact.phone_number,
    email: contact.email,
    instagram: (cf.instagram as string) ?? null,
    document: (cf.document as string) ?? (cf.cpf_cnpj as string) ?? null,
    client_since:
      (cf.client_since as string) ??
      (contact.client_recognized_at ? contact.client_recognized_at.slice(0, 10) : contact.created_at.slice(0, 10)),
    commercial_status: (cf.commercial_status as "lead" | "cliente_ativo" | "cliente_inativo" | "ex_cliente") ?? "cliente_ativo",
    financial_status: calculatedFinancialStatus,
    notes: (cf.financial_notes as string) ?? null,
    total_contracts: contracts.length,
    active_contracts,
    total_paid_cents,
    total_overdue_cents,
    contracts,
    invoices,
  };
}
