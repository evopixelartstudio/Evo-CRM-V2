/**
 * Handlers das MCP Tools de Gerência Técnica do Hermes.
 *
 * Fornece ao Hermes controle operacional seguro, escopado por tenant e auditado.
 */

import { z } from "zod";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit/actions";
import { ROLE_RANK } from "@/lib/auth/types";
import { HERMES_DOMAIN_PERMISSIONS, assertNotSelfModification } from "@/lib/hermes/service-account";
import type { McpContext, McpToolDefinition } from "../types";

/** Sanitiza recursivamente objetos removendo segredos, hashes e credenciais */
export function sanitizeSecrets<T>(data: T): T {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map(sanitizeSecrets) as unknown as T;
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("secret") ||
      lower.includes("password") ||
      lower.includes("token_hash") ||
      lower.includes("api_key") ||
      lower.includes("credentials") ||
      lower.includes("auth_token") ||
      lower.includes("private_key")
    ) {
      clone[key] = "[PROTEGIDO]";
    } else if (typeof value === "object" && value !== null) {
      clone[key] = sanitizeSecrets(value);
    } else {
      clone[key] = value;
    }
  }
  return clone as T;
}

// ── 1. Contatos e Clientes ────────────────────────────────────────────────────

const listContactsShape = {
  search: z.string().optional().describe("Termo de busca (nome, e-mail ou telefone)."),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  is_archived: z.boolean().default(false),
};

export const crmListContacts: McpToolDefinition<typeof listContactsShape> = {
  name: "crm_list_contacts",
  description:
    "Lista contatos cadastrados na organização com filtros de busca, paginação e status de arquivamento.",
  inputSchema: listContactsShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    let query = ctx.supabase
      .from("contacts")
      .select("id, name, phone, email, tags, custom_fields, is_archived, created_at, updated_at")
      .eq("organization_id", ctx.organizationId);

    if (!input.is_archived) {
      query = query.or("is_archived.is.null,is_archived.eq.false");
    } else {
      query = query.eq("is_archived", true);
    }

    if (input.search && input.search.trim().length > 0) {
      const term = `%${input.search.trim()}%`;
      query = query.or(`name.ilike.${term},email.ilike.${term},phone.ilike.${term}`);
    }

    query = query.order("created_at", { ascending: false }).limit(input.limit);
    const { data, error } = await query;
    if (error) {
      throw new ApiError(500, "database_error", { details: error.message }, ctx.requestId, "Falha ao listar contatos.");
    }
    return { contacts: sanitizeSecrets(data ?? []) };
  },
};

const createContactShape = {
  name: z.string().min(1).max(200).describe("Nome do contato ou cliente."),
  phone: z.string().optional().describe("Telefone formatado com DDI e DDD."),
  email: z.string().email().optional().describe("E-mail principal do contato."),
  tags: z.array(z.string()).optional().describe("Marcadores de classificação."),
  custom_fields: z.record(z.string(), z.unknown()).optional().describe("Campos personalizados adicionais."),
};

export const crmCreateContact: McpToolDefinition<typeof createContactShape> = {
  name: "crm_create_contact",
  description:
    "Cadastra um novo contato ou cliente na organização prevenindo cadastros duplicados por telefone ou e-mail.",
  inputSchema: createContactShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    // Checagem de duplicidade por telefone ou email dentro da org
    if (input.phone) {
      const { data: existingPhone } = await ctx.supabase
        .from("contacts")
        .select("id, name")
        .eq("organization_id", ctx.organizationId)
        .eq("phone", input.phone)
        .maybeSingle();

      if (existingPhone) {
        throw new ApiError(
          409,
          "duplicate_contact",
          { contact_id: existingPhone.id },
          ctx.requestId,
          `Contato com o telefone ${input.phone} já existe (${existingPhone.name}).`,
        );
      }
    }

    const { data, error } = await ctx.supabase
      .from("contacts")
      .insert({
        organization_id: ctx.organizationId,
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        tags: input.tags ?? [],
        custom_fields: input.custom_fields ?? {},
      })
      .select("id, name, phone, email, tags, custom_fields, created_at")
      .single();

    if (error) {
      throw new ApiError(500, "create_contact_failed", { details: error.message }, ctx.requestId, "Falha ao criar contato.");
    }

    await audit({
      action: "contact.create" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "contacts",
      resourceId: data.id,
      metadata: { name: data.name, phone: data.phone, email: data.email },
      requestId: ctx.requestId,
    });

    return sanitizeSecrets(data);
  },
};

const updateContactShape = {
  contact_id: z.string().uuid().describe("Identificador único do contato."),
  name: z.string().min(1).max(200).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  tags: z.array(z.string()).optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
};

export const crmUpdateContact: McpToolDefinition<typeof updateContactShape> = {
  name: "crm_update_contact",
  description:
    "Atualiza os dados cadastrais, telefone, e-mail, marcadores ou campos personalizados de um contato.",
  inputSchema: updateContactShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.phone !== undefined) updates.phone = input.phone;
    if (input.email !== undefined) updates.email = input.email;
    if (input.tags !== undefined) updates.tags = input.tags;
    if (input.custom_fields !== undefined) updates.custom_fields = input.custom_fields;

    const { data, error } = await ctx.supabase
      .from("contacts")
      .update(updates)
      .eq("id", input.contact_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, name, phone, email, tags, custom_fields, updated_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(
        error ? 500 : 404,
        error ? "update_failed" : "not_found",
        { details: error?.message },
        ctx.requestId,
        "Contato não encontrado para atualização.",
      );
    }

    await audit({
      action: "contact.update" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "contacts",
      resourceId: data.id,
      metadata: { fields_updated: Object.keys(updates) },
      requestId: ctx.requestId,
    });

    return sanitizeSecrets(data);
  },
};

const archiveContactShape = {
  contact_id: z.string().uuid().describe("Identificador do contato a ser arquivado."),
  reason: z.string().optional().describe("Motivo formal do arquivamento."),
};

export const crmArchiveContact: McpToolDefinition<typeof archiveContactShape> = {
  name: "crm_archive_contact",
  description:
    "Arquiva o cadastro de um contato na organização de forma segura sem exclusão física dos dados.",
  inputSchema: archiveContactShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("contacts")
      .update({
        is_archived: true,
        archived_at: new Date().toISOString(),
        archive_reason: input.reason ?? "Arquivado via Hermes MCP",
      })
      .eq("id", input.contact_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, name, is_archived, archived_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(
        error ? 500 : 404,
        error ? "archive_failed" : "not_found",
        { details: error?.message },
        ctx.requestId,
        "Contato não encontrado para arquivamento.",
      );
    }

    await audit({
      action: "contact.archive" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "contacts",
      resourceId: data.id,
      metadata: { reason: input.reason },
      requestId: ctx.requestId,
    });

    return { archived: true, contact: data };
  },
};

// ── 2. Oportunidades e Leads ──────────────────────────────────────────────────

const assignLeadShape = {
  lead_id: z.string().uuid().describe("Identificador da oportunidade no funil."),
  assigned_to_user_id: z.string().uuid().nullable().describe("ID do usuário da equipe ou null para liberar."),
};

export const crmAssignLead: McpToolDefinition<typeof assignLeadShape> = {
  name: "crm_assign_lead",
  description:
    "Atribui ou reatribui uma oportunidade do funil para um colaborador da equipe.",
  inputSchema: assignLeadShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("crm_leads")
      .update({
        assigned_to: input.assigned_to_user_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.lead_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, title, assigned_to, updated_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(
        error ? 500 : 404,
        error ? "assign_failed" : "not_found",
        { details: error?.message },
        ctx.requestId,
        "Oportunidade não encontrada para atribuição.",
      );
    }

    await audit({
      action: "lead.assign" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "crm_leads",
      resourceId: data.id,
      metadata: { assigned_to: input.assigned_to_user_id },
      requestId: ctx.requestId,
    });

    return { assigned: true, lead: data };
  },
};

const archiveLeadShape = {
  lead_id: z.string().uuid().describe("Identificador da oportunidade."),
  reason: z.string().min(1).describe("Motivo de encerramento da oportunidade."),
  notes: z.string().optional().describe("Observações complementares de encerramento."),
};

export const crmArchiveLead: McpToolDefinition<typeof archiveLeadShape> = {
  name: "crm_archive_lead",
  description:
    "Encerra e envia uma oportunidade para a área de arquivados registrando o motivo formal.",
  inputSchema: archiveLeadShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("crm_leads")
      .update({
        status: "archived",
        archived_at: new Date().toISOString(),
        lost_reason: input.reason,
        close_reason_details: input.notes ?? null,
      })
      .eq("id", input.lead_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, title, status, archived_at, lost_reason")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(
        error ? 500 : 404,
        error ? "archive_failed" : "not_found",
        { details: error?.message },
        ctx.requestId,
        "Oportunidade não encontrada para arquivamento.",
      );
    }

    await audit({
      action: "lead.archive" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "crm_leads",
      resourceId: data.id,
      metadata: { reason: input.reason, notes: input.notes },
      requestId: ctx.requestId,
    });

    return { archived: true, lead: data };
  },
};

// ── 3. Funis e Etapas ──────────────────────────────────────────────────────────

const createPipelineShape = {
  name: z.string().min(1).max(100).describe("Nome do novo funil comercial."),
  description: z.string().optional().describe("Descrição do objetivo do funil."),
  is_default: z.boolean().default(false),
};

export const crmCreatePipeline: McpToolDefinition<typeof createPipelineShape> = {
  name: "crm_create_pipeline",
  description:
    "Cria um novo funil de vendas na organização com etapas padronizadas de atendimento e fechamento.",
  inputSchema: createPipelineShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data: pipeline, error } = await ctx.supabase
      .from("crm_pipelines")
      .insert({
        organization_id: ctx.organizationId,
        name: input.name,
        description: input.description ?? null,
        is_default: input.is_default,
      })
      .select("id, name, description, is_default, created_at")
      .single();

    if (error || !pipeline) {
      throw new ApiError(500, "create_pipeline_failed", { details: error?.message }, ctx.requestId, "Falha ao criar funil.");
    }

    // Criação de etapas padrão
    const defaultStages = [
      { name: "Novo Contato", slug: "novo-contato", position: 10, is_won: false, is_lost: false },
      { name: "Qualificação", slug: "qualificacao", position: 20, is_won: false, is_lost: false },
      { name: "Proposta Enviada", slug: "proposta-enviada", position: 30, is_won: false, is_lost: false },
      { name: "Ganho", slug: "ganho", position: 40, is_won: true, is_lost: false },
      { name: "Perdido", slug: "perdido", position: 50, is_won: false, is_lost: true },
    ];

    await ctx.supabase.from("crm_stages").insert(
      defaultStages.map((st) => ({
        organization_id: ctx.organizationId,
        pipeline_id: pipeline.id,
        ...st,
      })),
    );

    await audit({
      action: "pipeline.create" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "crm_pipelines",
      resourceId: pipeline.id,
      metadata: { name: pipeline.name },
      requestId: ctx.requestId,
    });

    return { pipeline };
  },
};

const updatePipelineShape = {
  pipeline_id: z.string().uuid().describe("Identificador do funil."),
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  is_default: z.boolean().optional(),
};

export const crmUpdatePipeline: McpToolDefinition<typeof updatePipelineShape> = {
  name: "crm_update_pipeline",
  description:
    "Atualiza as configurações, título ou descrição de um funil de oportunidades existente.",
  inputSchema: updatePipelineShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.is_default !== undefined) updates.is_default = input.is_default;

    const { data, error } = await ctx.supabase
      .from("crm_pipelines")
      .update(updates)
      .eq("id", input.pipeline_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, name, description, is_default, updated_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(
        error ? 500 : 404,
        error ? "update_failed" : "not_found",
        { details: error?.message },
        ctx.requestId,
        "Funil não encontrado para atualização.",
      );
    }

    await audit({
      action: "pipeline.update" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "crm_pipelines",
      resourceId: data.id,
      metadata: { fields_updated: Object.keys(updates) },
      requestId: ctx.requestId,
    });

    return { pipeline: data };
  },
};

const reorderStageShape = {
  pipeline_id: z.string().uuid().describe("ID do funil comercial."),
  stage_orders: z.array(
    z.object({
      stage_id: z.string().uuid(),
      position: z.number().int().min(0),
    }),
  ).min(1).describe("Lista de etapas e suas novas posições ordinais."),
};

export const crmReorderStage: McpToolDefinition<typeof reorderStageShape> = {
  name: "crm_reorder_stage",
  description:
    "Reordena a sequência das etapas dentro de um funil de vendas.",
  inputSchema: reorderStageShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    for (const item of input.stage_orders) {
      await ctx.supabase
        .from("crm_stages")
        .update({ position: item.position, updated_at: new Date().toISOString() })
        .eq("id", item.stage_id)
        .eq("pipeline_id", input.pipeline_id)
        .eq("organization_id", ctx.organizationId);
    }

    await audit({
      action: "stage.reorder" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "crm_stages",
      resourceId: input.pipeline_id,
      metadata: { stage_orders: input.stage_orders },
      requestId: ctx.requestId,
    });

    return { reordered: true, count: input.stage_orders.length };
  },
};

// ── 4. Produtos e Catálogo ────────────────────────────────────────────────────

const getProductShape = {
  product_id: z.string().uuid().describe("Identificador único do produto."),
};

export const crmGetProduct: McpToolDefinition<typeof getProductShape> = {
  name: "crm_get_product",
  description:
    "Consulta informações detalhadas, preço, código e estoque de um produto no catálogo.",
  inputSchema: getProductShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("catalog_products")
      .select("id, codigo, nome, descricao, preco_cents, moeda, custo_cents, controla_estoque, quantidade, ativo, marca, categoria, created_at, updated_at")
      .eq("id", input.product_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "database_error" : "not_found", { details: error?.message }, ctx.requestId, "Produto não encontrado.");
    }

    return { product: sanitizeSecrets(data) };
  },
};

const createProductShape = {
  codigo: z.string().min(1).max(60).describe("Código SKU ou identificador comercial."),
  nome: z.string().min(1).max(200).describe("Nome do produto ou serviço."),
  descricao: z.string().optional(),
  preco_cents: z.number().int().min(0).describe("Preço de venda em centavos."),
  moeda: z.string().length(3).default("BRL"),
  custo_cents: z.number().int().min(0).optional(),
  controla_estoque: z.boolean().default(false),
  quantidade: z.number().int().min(0).default(0),
  ativo: z.boolean().default(true),
};

export const crmCreateProduct: McpToolDefinition<typeof createProductShape> = {
  name: "crm_create_product",
  description:
    "Adiciona um novo produto ou serviço ao catálogo com preço, código SKU e descrição.",
  inputSchema: createProductShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("catalog_products")
      .insert({
        organization_id: ctx.organizationId,
        codigo: input.codigo,
        nome: input.nome,
        descricao: input.descricao ?? null,
        preco_cents: input.preco_cents,
        moeda: input.moeda,
        custo_cents: input.custo_cents ?? null,
        controla_estoque: input.controla_estoque,
        quantidade: input.quantidade,
        ativo: input.ativo,
      })
      .select("id, codigo, nome, preco_cents, moeda, ativo, created_at")
      .single();

    if (error) {
      throw new ApiError(500, "create_product_failed", { details: error.message }, ctx.requestId, "Falha ao criar produto no catálogo.");
    }

    await audit({
      action: "product.create" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "catalog_products",
      resourceId: data.id,
      metadata: { codigo: data.codigo, nome: data.nome, preco_cents: data.preco_cents },
      requestId: ctx.requestId,
    });

    return sanitizeSecrets(data);
  },
};

const updateProductShape = {
  product_id: z.string().uuid().describe("ID do produto no catálogo."),
  nome: z.string().min(1).max(200).optional(),
  descricao: z.string().optional(),
  preco_cents: z.number().int().min(0).optional(),
  custo_cents: z.number().int().min(0).optional(),
  controla_estoque: z.boolean().optional(),
  quantidade: z.number().int().min(0).optional(),
  ativo: z.boolean().optional(),
};

export const crmUpdateProduct: McpToolDefinition<typeof updateProductShape> = {
  name: "crm_update_product",
  description:
    "Atualiza preço, descrição, estoque ou visibilidade de um produto no catálogo.",
  inputSchema: updateProductShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.nome !== undefined) updates.nome = input.nome;
    if (input.descricao !== undefined) updates.descricao = input.descricao;
    if (input.preco_cents !== undefined) updates.preco_cents = input.preco_cents;
    if (input.custo_cents !== undefined) updates.custo_cents = input.custo_cents;
    if (input.controla_estoque !== undefined) updates.controla_estoque = input.controla_estoque;
    if (input.quantidade !== undefined) updates.quantidade = input.quantidade;
    if (input.ativo !== undefined) updates.ativo = input.ativo;

    const { data, error } = await ctx.supabase
      .from("catalog_products")
      .update(updates)
      .eq("id", input.product_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, codigo, nome, preco_cents, moeda, ativo, updated_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "update_failed" : "not_found", { details: error?.message }, ctx.requestId, "Produto não encontrado.");
    }

    await audit({
      action: "product.update" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "catalog_products",
      resourceId: data.id,
      metadata: { fields_updated: Object.keys(updates) },
      requestId: ctx.requestId,
    });

    return sanitizeSecrets(data);
  },
};

// ── 5. Tarefas Operacionais ───────────────────────────────────────────────────

const listTasksShape = {
  status: z.enum(["pending", "in_progress", "done", "cancelled"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  assigned_to: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(30),
};

export const crmListTasks: McpToolDefinition<typeof listTasksShape> = {
  name: "crm_list_tasks",
  description:
    "Lista tarefas operacionais da equipe filtradas por status, prioridade, responsável ou prazos.",
  inputSchema: listTasksShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    let query = ctx.supabase
      .from("crm_tasks")
      .select("id, title, description, due_date, priority, status, lead_id, contact_id, assigned_to, created_at, updated_at")
      .eq("organization_id", ctx.organizationId);

    if (input.status) query = query.eq("status", input.status);
    if (input.priority) query = query.eq("priority", input.priority);
    if (input.assigned_to) query = query.eq("assigned_to", input.assigned_to);
    if (input.lead_id) query = query.eq("lead_id", input.lead_id);
    if (input.contact_id) query = query.eq("contact_id", input.contact_id);

    query = query.order("due_date", { ascending: true, nullsFirst: false }).limit(input.limit);
    const { data, error } = await query;
    if (error) {
      throw new ApiError(500, "database_error", { details: error.message }, ctx.requestId, "Falha ao listar tarefas.");
    }
    return { tasks: sanitizeSecrets(data ?? []) };
  },
};

const getTaskShape = {
  task_id: z.string().uuid().describe("Identificador da tarefa."),
};

export const crmGetTask: McpToolDefinition<typeof getTaskShape> = {
  name: "crm_get_task",
  description:
    "Consulta detalhes completos de uma tarefa incluindo prazo, prioridade e vínculos.",
  inputSchema: getTaskShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("crm_tasks")
      .select("id, title, description, due_date, priority, status, lead_id, contact_id, assigned_to, created_at, updated_at")
      .eq("id", input.task_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "database_error" : "not_found", { details: error?.message }, ctx.requestId, "Tarefa não encontrada.");
    }
    return { task: sanitizeSecrets(data) };
  },
};

const createTaskShape = {
  title: z.string().min(1).max(255).describe("Título da tarefa."),
  description: z.string().optional(),
  due_date: z.string().datetime().optional().describe("Data e hora limite de conclusão (ISO-8601)."),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  assigned_to: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
};

export const crmCreateTask: McpToolDefinition<typeof createTaskShape> = {
  name: "crm_create_task",
  description:
    "Cria uma nova tarefa operacional com prazo, prioridade e atribuição a um membro da equipe.",
  inputSchema: createTaskShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("crm_tasks")
      .insert({
        organization_id: ctx.organizationId,
        title: input.title,
        description: input.description ?? null,
        due_date: input.due_date ?? null,
        priority: input.priority,
        status: "pending",
        assigned_to: input.assigned_to ?? null,
        lead_id: input.lead_id ?? null,
        contact_id: input.contact_id ?? null,
      })
      .select("id, title, due_date, priority, status, assigned_to, created_at")
      .single();

    if (error) {
      throw new ApiError(500, "create_task_failed", { details: error.message }, ctx.requestId, "Falha ao criar tarefa.");
    }

    await audit({
      action: "task.create" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "crm_tasks",
      resourceId: data.id,
      metadata: { title: data.title, priority: data.priority, due_date: data.due_date },
      requestId: ctx.requestId,
    });

    return sanitizeSecrets(data);
  },
};

const updateTaskShape = {
  task_id: z.string().uuid().describe("ID da tarefa."),
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  due_date: z.string().datetime().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  status: z.enum(["pending", "in_progress", "done", "cancelled"]).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
};

export const crmUpdateTask: McpToolDefinition<typeof updateTaskShape> = {
  name: "crm_update_task",
  description:
    "Atualiza título, descrição, prioridade, prazo ou responsável de uma tarefa existente.",
  inputSchema: updateTaskShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined) updates.description = input.description;
    if (input.due_date !== undefined) updates.due_date = input.due_date;
    if (input.priority !== undefined) updates.priority = input.priority;
    if (input.status !== undefined) updates.status = input.status;
    if (input.assigned_to !== undefined) updates.assigned_to = input.assigned_to;

    const { data, error } = await ctx.supabase
      .from("crm_tasks")
      .update(updates)
      .eq("id", input.task_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, title, due_date, priority, status, assigned_to, updated_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "update_failed" : "not_found", { details: error?.message }, ctx.requestId, "Tarefa não encontrada.");
    }

    await audit({
      action: "task.update" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "crm_tasks",
      resourceId: data.id,
      metadata: { fields_updated: Object.keys(updates) },
      requestId: ctx.requestId,
    });

    return sanitizeSecrets(data);
  },
};

const completeTaskShape = {
  task_id: z.string().uuid().describe("ID da tarefa a ser concluída."),
};

export const crmCompleteTask: McpToolDefinition<typeof completeTaskShape> = {
  name: "crm_complete_task",
  description:
    "Marca uma tarefa operacional como concluída com registro formal na linha do tempo.",
  inputSchema: completeTaskShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("crm_tasks")
      .update({
        status: "done",
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.task_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, title, status, updated_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "update_failed" : "not_found", { details: error?.message }, ctx.requestId, "Tarefa não encontrada.");
    }

    await audit({
      action: "task.complete" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "crm_tasks",
      resourceId: data.id,
      metadata: { status: "done" },
      requestId: ctx.requestId,
    });

    return { completed: true, task: data };
  },
};

const cancelTaskShape = {
  task_id: z.string().uuid().describe("ID da tarefa."),
  reason: z.string().optional().describe("Justificativa do cancelamento."),
};

export const crmCancelTask: McpToolDefinition<typeof cancelTaskShape> = {
  name: "crm_cancel_task",
  description:
    "Cancela uma tarefa de trabalho registrando a justificativa da interrupção.",
  inputSchema: cancelTaskShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("crm_tasks")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.task_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, title, status, updated_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "update_failed" : "not_found", { details: error?.message }, ctx.requestId, "Tarefa não encontrada.");
    }

    await audit({
      action: "task.cancel" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "crm_tasks",
      resourceId: data.id,
      metadata: { reason: input.reason },
      requestId: ctx.requestId,
    });

    return { cancelled: true, task: data };
  },
};

// ── 6. Agenda e Compromissos ──────────────────────────────────────────────────

const getAppointmentShape = {
  appointment_id: z.string().uuid().describe("Identificador do compromisso agendado."),
};

export const crmGetAppointment: McpToolDefinition<typeof getAppointmentShape> = {
  name: "crm_get_appointment",
  description:
    "Consulta os detalhes completos de um compromisso na agenda do profissional ou clínica.",
  inputSchema: getAppointmentShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("calendar_appointments")
      .select("id, event_type_id, start_at, end_at, status, customer_name, customer_phone, customer_email, contact_id, lead_id, notes, created_at")
      .eq("id", input.appointment_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "database_error" : "not_found", { details: error?.message }, ctx.requestId, "Agendamento não encontrado.");
    }
    return { appointment: sanitizeSecrets(data) };
  },
};

const createAppointmentShape = {
  event_type_id: z.string().uuid().describe("Tipo de evento na agenda."),
  start_at: z.string().datetime().describe("Início do atendimento (ISO-8601)."),
  end_at: z.string().datetime().describe("Fim do atendimento (ISO-8601)."),
  customer_name: z.string().min(1).max(200),
  customer_phone: z.string().optional(),
  customer_email: z.string().email().optional(),
  contact_id: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional(),
  notes: z.string().optional(),
};

export const crmCreateAppointment: McpToolDefinition<typeof createAppointmentShape> = {
  name: "crm_create_appointment",
  description:
    "Marca um novo agendamento com data, horário, tipo de evento e contato atendido.",
  inputSchema: createAppointmentShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("calendar_appointments")
      .insert({
        organization_id: ctx.organizationId,
        event_type_id: input.event_type_id,
        start_at: input.start_at,
        end_at: input.end_at,
        status: "scheduled",
        customer_name: input.customer_name,
        customer_phone: input.customer_phone ?? null,
        customer_email: input.customer_email ?? null,
        contact_id: input.contact_id ?? null,
        lead_id: input.lead_id ?? null,
        notes: input.notes ?? null,
      })
      .select("id, event_type_id, start_at, end_at, status, customer_name, created_at")
      .single();

    if (error) {
      throw new ApiError(500, "create_appointment_failed", { details: error.message }, ctx.requestId, "Falha ao criar agendamento.");
    }

    await audit({
      action: "appointment.create" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "calendar_appointments",
      resourceId: data.id,
      metadata: { customer_name: data.customer_name, start_at: data.start_at },
      requestId: ctx.requestId,
    });

    return sanitizeSecrets(data);
  },
};

const updateAppointmentShape = {
  appointment_id: z.string().uuid().describe("ID do compromisso."),
  start_at: z.string().datetime().optional(),
  end_at: z.string().datetime().optional(),
  status: z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"]).optional(),
  notes: z.string().optional(),
};

export const crmUpdateAppointment: McpToolDefinition<typeof updateAppointmentShape> = {
  name: "crm_update_appointment",
  description:
    "Remarca ou altera data, horário ou status de um atendimento registrado na agenda.",
  inputSchema: updateAppointmentShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.start_at !== undefined) updates.start_at = input.start_at;
    if (input.end_at !== undefined) updates.end_at = input.end_at;
    if (input.status !== undefined) updates.status = input.status;
    if (input.notes !== undefined) updates.notes = input.notes;

    const { data, error } = await ctx.supabase
      .from("calendar_appointments")
      .update(updates)
      .eq("id", input.appointment_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, start_at, end_at, status, customer_name, updated_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "update_failed" : "not_found", { details: error?.message }, ctx.requestId, "Agendamento não encontrado.");
    }

    await audit({
      action: "appointment.update" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "calendar_appointments",
      resourceId: data.id,
      metadata: { fields_updated: Object.keys(updates) },
      requestId: ctx.requestId,
    });

    return sanitizeSecrets(data);
  },
};

// ── 7. Observações Internas (Customer Notes) ─────────────────────────────────

const listCustomerNotesShape = {
  contact_id: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional(),
  conversation_id: z.string().uuid().optional(),
  include_archived: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(20),
};

export const crmListCustomerNotes: McpToolDefinition<typeof listCustomerNotesShape> = {
  name: "crm_list_customer_notes",
  description:
    "Lista anotações confidenciais internas da equipe sobre o cliente que nunca saem no atendimento.",
  inputSchema: listCustomerNotesShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    let query = ctx.supabase
      .from("customer_notes")
      .select("id, contact_id, lead_id, conversation_id, title, body, is_pinned, is_archived, actor_name, created_at, updated_at")
      .eq("organization_id", ctx.organizationId);

    if (input.contact_id) query = query.eq("contact_id", input.contact_id);
    if (input.lead_id) query = query.eq("lead_id", input.lead_id);
    if (input.conversation_id) query = query.eq("conversation_id", input.conversation_id);

    if (!input.include_archived) {
      query = query.eq("is_archived", false);
    }

    query = query.order("is_pinned", { ascending: false }).order("created_at", { ascending: false }).limit(input.limit);
    const { data, error } = await query;
    if (error) {
      throw new ApiError(500, "database_error", { details: error.message }, ctx.requestId, "Falha ao listar anotações internas.");
    }

    return { notes: sanitizeSecrets(data ?? []) };
  },
};

const getCustomerNoteShape = {
  note_id: z.string().uuid().describe("ID da anotação interna."),
};

export const crmGetCustomerNote: McpToolDefinition<typeof getCustomerNoteShape> = {
  name: "crm_get_customer_note",
  description:
    "Abre o conteúdo completo e o histórico de uma anotação confidencial de cliente.",
  inputSchema: getCustomerNoteShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("customer_notes")
      .select("id, contact_id, lead_id, conversation_id, title, body, is_pinned, is_archived, actor_name, metadata, created_at, updated_at")
      .eq("id", input.note_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "database_error" : "not_found", { details: error?.message }, ctx.requestId, "Anotação não encontrada.");
    }
    return { note: sanitizeSecrets(data) };
  },
};

const createCustomerNoteShape = {
  title: z.string().min(1).max(200).describe("Título da anotação interna."),
  body: z.string().min(1).describe("Texto confidencial da anotação."),
  contact_id: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional(),
  conversation_id: z.string().uuid().optional(),
  is_pinned: z.boolean().default(false),
};

export const crmCreateCustomerNote: McpToolDefinition<typeof createCustomerNoteShape> = {
  name: "crm_create_customer_note",
  description:
    "Salva uma anotação privada da equipe vinculada ao cliente ou à oportunidade.",
  inputSchema: createCustomerNoteShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("customer_notes")
      .insert({
        organization_id: ctx.organizationId,
        title: input.title,
        body: input.body,
        contact_id: input.contact_id ?? null,
        lead_id: input.lead_id ?? null,
        conversation_id: input.conversation_id ?? null,
        is_pinned: input.is_pinned,
        actor_kind: "ai_agent",
        actor_name: "Hermes Gerente Técnico",
      })
      .select("id, contact_id, lead_id, title, is_pinned, created_at")
      .single();

    if (error) {
      throw new ApiError(500, "create_note_failed", { details: error.message }, ctx.requestId, "Falha ao registrar anotação interna.");
    }

    await audit({
      action: "customer_note.create" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "customer_notes",
      resourceId: data.id,
      metadata: { title: data.title, contact_id: data.contact_id },
      requestId: ctx.requestId,
    });

    return sanitizeSecrets(data);
  },
};

const updateCustomerNoteShape = {
  note_id: z.string().uuid().describe("ID da anotação interna."),
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).optional(),
  is_pinned: z.boolean().optional(),
};

export const crmUpdateCustomerNote: McpToolDefinition<typeof updateCustomerNoteShape> = {
  name: "crm_update_customer_note",
  description:
    "Atualiza o texto ou o título de uma anotação interna mantendo sigilo da equipe.",
  inputSchema: updateCustomerNoteShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.title !== undefined) updates.title = input.title;
    if (input.body !== undefined) updates.body = input.body;
    if (input.is_pinned !== undefined) updates.is_pinned = input.is_pinned;

    const { data, error } = await ctx.supabase
      .from("customer_notes")
      .update(updates)
      .eq("id", input.note_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, title, is_pinned, updated_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "update_failed" : "not_found", { details: error?.message }, ctx.requestId, "Anotação não encontrada.");
    }

    await audit({
      action: "customer_note.update" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "customer_notes",
      resourceId: data.id,
      metadata: { fields_updated: Object.keys(updates) },
      requestId: ctx.requestId,
    });

    return sanitizeSecrets(data);
  },
};

const archiveCustomerNoteShape = {
  note_id: z.string().uuid().describe("ID da anotação interna a arquivar."),
};

export const crmArchiveCustomerNote: McpToolDefinition<typeof archiveCustomerNoteShape> = {
  name: "crm_archive_customer_note",
  description:
    "Arquiva uma anotação interna sem apagar seu histórico da base de auditoria.",
  inputSchema: archiveCustomerNoteShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("customer_notes")
      .update({
        is_archived: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.note_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, is_archived, updated_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "archive_failed" : "not_found", { details: error?.message }, ctx.requestId, "Anotação não encontrada.");
    }

    await audit({
      action: "customer_note.archive" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "customer_notes",
      resourceId: data.id,
      requestId: ctx.requestId,
    });

    return { archived: true, note: data };
  },
};

const pinCustomerNoteShape = {
  note_id: z.string().uuid().describe("ID da anotação interna."),
  is_pinned: z.boolean().describe("Se deve fixar (true) ou desafixar (false)."),
};

export const crmPinCustomerNote: McpToolDefinition<typeof pinCustomerNoteShape> = {
  name: "crm_pin_customer_note",
  description:
    "Fixa ou desafixa um lembrete importante no topo da visualização da equipe.",
  inputSchema: pinCustomerNoteShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("customer_notes")
      .update({
        is_pinned: input.is_pinned,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.note_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, is_pinned, updated_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "pin_failed" : "not_found", { details: error?.message }, ctx.requestId, "Anotação não encontrada.");
    }

    await audit({
      action: "customer_note.pin" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "customer_notes",
      resourceId: data.id,
      metadata: { is_pinned: input.is_pinned },
      requestId: ctx.requestId,
    });

    return { pinned: data.is_pinned, note: data };
  },
};

const searchCustomerNotesShape = {
  query: z.string().min(1).max(200).describe("Palavras-chave para busca de anotações internas."),
  limit: z.number().int().min(1).max(50).default(10),
};

export const crmSearchCustomerNotes: McpToolDefinition<typeof searchCustomerNotesShape> = {
  name: "crm_search_customer_notes",
  description:
    "Localiza anotações privadas por termos de pesquisa garantindo sigilo das informações.",
  inputSchema: searchCustomerNotesShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const term = `%${input.query.trim()}%`;
    const { data, error } = await ctx.supabase
      .from("customer_notes")
      .select("id, contact_id, lead_id, title, body, is_pinned, is_archived, created_at")
      .eq("organization_id", ctx.organizationId)
      .eq("is_archived", false)
      .or(`title.ilike.${term},body.ilike.${term}`)
      .order("created_at", { ascending: false })
      .limit(input.limit);

    if (error) {
      throw new ApiError(500, "database_error", { details: error.message }, ctx.requestId, "Falha na busca de anotações.");
    }

    return { notes: sanitizeSecrets(data ?? []) };
  },
};

// ── 8. Atendimento e Conversas ───────────────────────────────────────────────

const transferConversationShape = {
  conversation_id: z.string().uuid().describe("ID da conversa ativa."),
  assigned_user_id: z.string().uuid().optional().describe("ID do atendente humano de destino."),
  queue_id: z.string().uuid().optional().describe("Fila ou setor de atendimento."),
  transfer_note: z.string().optional().describe("Justificativa da transferência."),
};

export const crmTransferConversation: McpToolDefinition<typeof transferConversationShape> = {
  name: "crm_transfer_conversation",
  description:
    "Transfere o atendimento para outro atendente ou setor com mensagem explicativa.",
  inputSchema: transferConversationShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const updates: Record<string, unknown> = {
      assigned_to: input.assigned_user_id ?? null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await ctx.supabase
      .from("conversations")
      .update(updates)
      .eq("id", input.conversation_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, status, assigned_to, updated_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "transfer_failed" : "not_found", { details: error?.message }, ctx.requestId, "Conversa não encontrada.");
    }

    await audit({
      action: "conversation.transfer" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "conversations",
      resourceId: data.id,
      metadata: { assigned_to: input.assigned_user_id, note: input.transfer_note },
      requestId: ctx.requestId,
    });

    return { transferred: true, conversation: data };
  },
};

const closeConversationShape = {
  conversation_id: z.string().uuid().describe("ID da conversa a finalizar."),
  resolution_summary: z.string().optional().describe("Resumo da resolução ou desfecho."),
};

export const crmCloseConversation: McpToolDefinition<typeof closeConversationShape> = {
  name: "crm_close_conversation",
  description:
    "Conclui um atendimento em andamento registrando o horário de término da conversa.",
  inputSchema: closeConversationShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    // Read first so the RPC receives the optimistic-lock revision and so a
    // missing conversation is distinguishable from an RPC/database failure.
    const { data: current, error: lookupError } = await ctx.supabase
      .from("conversations")
      .select("id, organization_id, status, service_revision")
      .eq("id", input.conversation_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();

    if (lookupError) {
      throw new ApiError(
        500,
        "database_error",
        { details: lookupError.message },
        ctx.requestId,
        "Falha ao consultar a conversa para encerramento.",
      );
    }
    if (!current) {
      throw new ApiError(
        404,
        "not_found",
        undefined,
        ctx.requestId,
        "Conversa não encontrada nesta organização.",
      );
    }

    // fn_service_status is the single status-transition path. It applies the
    // service lock, updates service_closed_at/service_revision, and keeps the
    // demand and routing side effects consistent with the REST API.
    const { data, error } = await ctx.supabase.rpc("fn_service_status", {
      p_org: ctx.organizationId,
      p_conversation: input.conversation_id,
      p_status: "closed",
      p_expected: current.service_revision,
    });

    if (error) {
      const conflict = error.code === "PT409" || error.code === "40001";
      const notFound = error.code === "P0002";
      throw new ApiError(
        conflict ? 409 : notFound ? 404 : 500,
        conflict ? "conflict" : notFound ? "not_found" : "close_failed",
        { details: error.message, code: error.code },
        ctx.requestId,
        conflict
          ? "O atendimento mudou enquanto era encerrado. Atualize e tente novamente."
          : notFound
            ? "Conversa não encontrada nesta organização."
            : "Falha ao encerrar a conversa.",
      );
    }

    if (!data) {
      throw new ApiError(
        500,
        "close_failed",
        undefined,
        ctx.requestId,
        "A RPC de encerramento não retornou a conversa atualizada.",
      );
    }

    const conversation = {
      id: data.id,
      status: data.status,
      service_closed_at: data.service_closed_at,
      service_revision: data.service_revision,
    };

    await audit({
      action: "conversation.close" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "conversations",
      resourceId: conversation.id,
      metadata: { resolution_summary: input.resolution_summary },
      requestId: ctx.requestId,
    });

    return { closed: true, conversation };
  },
};

// ── 9. Agentes de IA ──────────────────────────────────────────────────────────

const listAgentsShape = {
  include_archived: z.boolean().default(false),
};

export const crmListAgents: McpToolDefinition<typeof listAgentsShape> = {
  name: "crm_list_agents",
  description:
    "Lista os atendentes virtuais cadastrados na empresa e sua disponibilidade atual.",
  inputSchema: listAgentsShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    let query = ctx.supabase
      .from("ai_agents")
      .select("id, name, description, model, is_active, is_default, kind, priority, published_version_id, paused_at, archived_at, created_at, updated_at")
      .eq("organization_id", ctx.organizationId);

    if (!input.include_archived) {
      query = query.is("archived_at", null);
    }

    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) {
      throw new ApiError(500, "database_error", { details: error.message }, ctx.requestId, "Falha ao listar agentes de IA.");
    }

    return { agents: sanitizeSecrets(data ?? []) };
  },
};

const getAgentShape = {
  agent_id: z.string().uuid().describe("ID do agente de IA."),
};

export const crmGetAgent: McpToolDefinition<typeof getAgentShape> = {
  name: "crm_get_agent",
  description:
    "Mostra detalhes, orientações de atendimento e habilidades de um atendente virtual.",
  inputSchema: getAgentShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("ai_agents")
      .select("id, name, description, model, system_prompt, is_active, is_default, kind, priority, published_version_id, paused_at, archived_at, config, guardrails, created_at, updated_at")
      .eq("id", input.agent_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "database_error" : "not_found", { details: error?.message }, ctx.requestId, "Agente não encontrado.");
    }

    return { agent: sanitizeSecrets(data) };
  },
};

const createAgentShape = {
  name: z.string().min(1).max(100).describe("Nome do agente."),
  description: z.string().optional(),
  system_prompt: z.string().min(1).describe("Instruções e diretrizes de atendimento do agente."),
  model: z.string().default("claude-3-5-sonnet-latest"),
  provider: z.string().default("anthropic"),
  tool_ids: z.array(z.string()).optional(),
};

export const crmCreateAgent: McpToolDefinition<typeof createAgentShape> = {
  name: "crm_create_agent",
  description:
    "Cria um novo atendente virtual com instruções personalizadas e modelo definido.",
  inputSchema: createAgentShape,
  category: "write",
  requiresRole: "admin",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("ai_agents")
      .insert({
        organization_id: ctx.organizationId,
        name: input.name,
        description: input.description ?? null,
        system_prompt: input.system_prompt,
        model: input.model,
        kind: "mcp_agent",
        is_active: false,
      })
      .select("id, name, kind, is_active, created_at")
      .single();

    if (error) {
      throw new ApiError(500, "create_agent_failed", { details: error.message }, ctx.requestId, "Falha ao criar agente de IA.");
    }

    await audit({
      action: "ai_agent.create" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "ai_agents",
      resourceId: data.id,
      metadata: { name: data.name, model: input.model },
      requestId: ctx.requestId,
    });

    return sanitizeSecrets(data);
  },
};

const updateAgentShape = {
  agent_id: z.string().uuid().describe("ID do agente."),
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  system_prompt: z.string().optional(),
  is_active: z.boolean().optional(),
};

export const crmUpdateAgent: McpToolDefinition<typeof updateAgentShape> = {
  name: "crm_update_agent",
  description:
    "Atualiza orientações, nome, descrição ou capacidades de um atendente virtual.",
  inputSchema: updateAgentShape,
  category: "write",
  requiresRole: "admin",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.system_prompt !== undefined) updates.system_prompt = input.system_prompt;
    if (input.is_active !== undefined) updates.is_active = input.is_active;

    const { data, error } = await ctx.supabase
      .from("ai_agents")
      .update(updates)
      .eq("id", input.agent_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, name, is_active, updated_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "update_failed" : "not_found", { details: error?.message }, ctx.requestId, "Agente não encontrado.");
    }

    await audit({
      action: "ai_agent.update" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "ai_agents",
      resourceId: data.id,
      metadata: { fields_updated: Object.keys(updates) },
      requestId: ctx.requestId,
    });

    return sanitizeSecrets(data);
  },
};

const archiveAgentShape = {
  agent_id: z.string().uuid().describe("ID do agente a arquivar."),
};

export const crmArchiveAgent: McpToolDefinition<typeof archiveAgentShape> = {
  name: "crm_archive_agent",
  description:
    "Arquiva um atendente virtual sem perder os atendimentos realizados anteriormente.",
  inputSchema: archiveAgentShape,
  category: "write",
  requiresRole: "admin",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("ai_agents")
      .update({
        archived_at: new Date().toISOString(),
        is_active: false,
        published_version_id: null,
      })
      .eq("id", input.agent_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, name, is_active, archived_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "archive_failed" : "not_found", { details: error?.message }, ctx.requestId, "Agente não encontrado.");
    }

    await audit({
      action: "ai_agent.archive" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "ai_agents",
      resourceId: data.id,
      requestId: ctx.requestId,
    });

    return { archived: true, agent: data };
  },
};

const activateAgentShape = {
  agent_id: z.string().uuid().describe("ID do agente a ativar."),
};

export const crmActivateAgent: McpToolDefinition<typeof activateAgentShape> = {
  name: "crm_activate_agent",
  description:
    "Ativa o atendimento automático do atendente virtual no canal de comunicação.",
  inputSchema: activateAgentShape,
  category: "write",
  requiresRole: "admin",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("ai_agents")
      .update({
        is_active: true,
        paused_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.agent_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, name, is_active, updated_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "activation_failed" : "not_found", { details: error?.message }, ctx.requestId, "Agente não encontrado.");
    }

    await audit({
      action: "ai_agent.activate" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "ai_agents",
      resourceId: data.id,
      requestId: ctx.requestId,
    });

    return { activated: true, agent: data };
  },
};

const deactivateAgentShape = {
  agent_id: z.string().uuid().describe("ID do agente a pausar."),
};

export const crmDeactivateAgent: McpToolDefinition<typeof deactivateAgentShape> = {
  name: "crm_deactivate_agent",
  description:
    "Pausa o atendimento automático do atendente virtual de forma imediata.",
  inputSchema: deactivateAgentShape,
  category: "write",
  requiresRole: "admin",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("ai_agents")
      .update({
        is_active: false,
        paused_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.agent_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, name, is_active, paused_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "deactivation_failed" : "not_found", { details: error?.message }, ctx.requestId, "Agente não encontrado.");
    }

    await audit({
      action: "ai_agent.deactivate" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "ai_agents",
      resourceId: data.id,
      requestId: ctx.requestId,
    });

    return { paused: true, agent: data };
  },
};

const testAgentShape = {
  agent_id: z.string().uuid().describe("ID do agente a ser testado."),
  sample_user_message: z.string().min(1).max(2000).describe("Mensagem de teste simulando um cliente."),
};

export const crmTestAgent: McpToolDefinition<typeof testAgentShape> = {
  name: "crm_test_agent",
  description:
    "Simula uma interação com o atendente virtual em ambiente seguro de testes.",
  inputSchema: testAgentShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const { data: agent, error } = await ctx.supabase
      .from("ai_agents")
      .select("id, name, system_prompt, model")
      .eq("id", input.agent_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();

    if (error || !agent) {
      throw new ApiError(error ? 500 : 404, "not_found", undefined, ctx.requestId, "Agente não encontrado para teste.");
    }

    return {
      test_status: "ready_for_dispatch",
      agent_name: agent.name,
      model_configured: agent.model,
      simulated_input: input.sample_user_message,
      instructions_preview: (agent.system_prompt ?? "").slice(0, 150) + "...",
    };
  },
};

// ── 10. Automações e Webhooks ────────────────────────────────────────────────

const listAutomationsShape = {
  is_active: z.boolean().optional(),
};

export const crmListAutomations: McpToolDefinition<typeof listAutomationsShape> = {
  name: "crm_list_automations",
  description:
    "Lista os fluxos e disparadores automáticos configurados para o atendimento.",
  inputSchema: listAutomationsShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    let query = ctx.supabase
      .from("automation_rules")
      .select("id, name, is_active, trigger_event, conditions, actions, last_run_at, run_count, created_at, updated_at")
      .eq("organization_id", ctx.organizationId);

    if (input.is_active !== undefined) {
      query = query.eq("is_active", input.is_active);
    }

    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) {
      throw new ApiError(500, "database_error", { details: error.message }, ctx.requestId, "Falha ao listar automações.");
    }

    return { automations: sanitizeSecrets(data ?? []) };
  },
};

const getAutomationShape = {
  automation_id: z.string().uuid().describe("ID da regra de automação."),
};

export const crmGetAutomation: McpToolDefinition<typeof getAutomationShape> = {
  name: "crm_get_automation",
  description:
    "Apresenta as condições e ações programadas de um fluxo automático de trabalho.",
  inputSchema: getAutomationShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("automation_rules")
      .select("id, name, is_active, trigger_event, conditions, actions, last_run_at, run_count, created_at, updated_at")
      .eq("id", input.automation_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "database_error" : "not_found", { details: error?.message }, ctx.requestId, "Automação não encontrada.");
    }
    return { automation: sanitizeSecrets(data) };
  },
};

const createAutomationShape = {
  name: z.string().min(1).max(100).describe("Nome da regra de automação."),
  trigger_event: z.string().min(1).describe("Evento gatilho (ex: lead.created, message.received)."),
  conditions: z.array(z.record(z.string(), z.unknown())).default([]),
  actions: z.array(z.record(z.string(), z.unknown())).min(1).describe("Ações a serem executadas."),
  is_active: z.boolean().default(true),
};

export const crmCreateAutomation: McpToolDefinition<typeof createAutomationShape> = {
  name: "crm_create_automation",
  description:
    "Cria uma regra de automação que executa ações quando certas condições ocorrem.",
  inputSchema: createAutomationShape,
  category: "write",
  requiresRole: "admin",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("automation_rules")
      .insert({
        organization_id: ctx.organizationId,
        name: input.name,
        trigger_event: input.trigger_event,
        conditions: input.conditions,
        actions: input.actions,
        is_active: input.is_active,
      })
      .select("id, name, trigger_event, is_active, created_at")
      .single();

    if (error) {
      throw new ApiError(500, "create_automation_failed", { details: error.message }, ctx.requestId, "Falha ao cadastrar automação.");
    }

    await audit({
      action: "automation.create" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "automation_rules",
      resourceId: data.id,
      metadata: { name: data.name, trigger_event: data.trigger_event },
      requestId: ctx.requestId,
    });

    return sanitizeSecrets(data);
  },
};

const updateAutomationShape = {
  automation_id: z.string().uuid().describe("ID da regra."),
  name: z.string().min(1).max(100).optional(),
  conditions: z.array(z.record(z.string(), z.unknown())).optional(),
  actions: z.array(z.record(z.string(), z.unknown())).optional(),
  is_active: z.boolean().optional(),
};

export const crmUpdateAutomation: McpToolDefinition<typeof updateAutomationShape> = {
  name: "crm_update_automation",
  description:
    "Modifica os critérios de disparo ou as ações executadas por uma regra automática.",
  inputSchema: updateAutomationShape,
  category: "write",
  requiresRole: "admin",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.conditions !== undefined) updates.conditions = input.conditions;
    if (input.actions !== undefined) updates.actions = input.actions;
    if (input.is_active !== undefined) updates.is_active = input.is_active;

    const { data, error } = await ctx.supabase
      .from("automation_rules")
      .update(updates)
      .eq("id", input.automation_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, name, is_active, updated_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "update_failed" : "not_found", { details: error?.message }, ctx.requestId, "Automação não encontrada.");
    }

    await audit({
      action: "automation.update" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "automation_rules",
      resourceId: data.id,
      metadata: { fields_updated: Object.keys(updates) },
      requestId: ctx.requestId,
    });

    return sanitizeSecrets(data);
  },
};

const testAutomationShape = {
  automation_id: z.string().uuid().describe("ID da automação."),
  sample_event_data: z.record(z.string(), z.unknown()).describe("Dados de teste simulando o evento disparador."),
};

export const crmTestAutomation: McpToolDefinition<typeof testAutomationShape> = {
  name: "crm_test_automation",
  description:
    "Valida se um caso de teste preenche os critérios do fluxo sem disparar ações reais.",
  inputSchema: testAutomationShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const { data: rule, error } = await ctx.supabase
      .from("automation_rules")
      .select("id, name, trigger_event, conditions, actions")
      .eq("id", input.automation_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();

    if (error || !rule) {
      throw new ApiError(error ? 500 : 404, "not_found", undefined, ctx.requestId, "Automação não encontrada para teste.");
    }

    return {
      simulation_success: true,
      rule_id: rule.id,
      rule_name: rule.name,
      trigger_event: rule.trigger_event,
      conditions_count: Array.isArray(rule.conditions) ? rule.conditions.length : 0,
      actions_count: Array.isArray(rule.actions) ? rule.actions.length : 0,
      sample_evaluated: input.sample_event_data,
    };
  },
};

const activateAutomationShape = {
  automation_id: z.string().uuid().describe("ID da regra a ativar."),
};

export const crmActivateAutomation: McpToolDefinition<typeof activateAutomationShape> = {
  name: "crm_activate_automation",
  description:
    "Liga a execução contínua de uma regra automática para eventos futuros.",
  inputSchema: activateAutomationShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("automation_rules")
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq("id", input.automation_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, name, is_active, updated_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "activation_failed" : "not_found", { details: error?.message }, ctx.requestId, "Automação não encontrada.");
    }

    await audit({
      action: "automation.activate" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "automation_rules",
      resourceId: data.id,
      requestId: ctx.requestId,
    });

    return { activated: true, automation: data };
  },
};

const deactivateAutomationShape = {
  automation_id: z.string().uuid().describe("ID da regra a desativar."),
};

export const crmDeactivateAutomation: McpToolDefinition<typeof deactivateAutomationShape> = {
  name: "crm_deactivate_automation",
  description:
    "Pausa uma regra automática impedindo novos disparos na organização.",
  inputSchema: deactivateAutomationShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("automation_rules")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", input.automation_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, name, is_active, updated_at")
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(error ? 500 : 404, error ? "deactivation_failed" : "not_found", { details: error?.message }, ctx.requestId, "Automação não encontrada.");
    }

    await audit({
      action: "automation.deactivate" as AuditAction,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "automation_rules",
      resourceId: data.id,
      requestId: ctx.requestId,
    });

    return { deactivated: true, automation: data };
  },
};

// ── 11. Administração e Governança ───────────────────────────────────────────

const listUsersShape = {
  limit: z.number().int().min(1).max(100).default(50),
};

export const crmListUsers: McpToolDefinition<typeof listUsersShape> = {
  name: "crm_list_users",
  description:
    "Lista os colaboradores da empresa com seus respectivos cargos e permissões.",
  inputSchema: listUsersShape,
  category: "read",
  requiresRole: "admin",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("organization_memberships")
      .select("user_id, role, created_at")
      .eq("organization_id", ctx.organizationId)
      .limit(input.limit);

    if (error) {
      throw new ApiError(500, "database_error", { details: error.message }, ctx.requestId, "Falha ao listar membros da equipe.");
    }

    return { members: sanitizeSecrets(data ?? []) };
  },
};

const emptyShape = {};

export const crmListRoles: McpToolDefinition<typeof emptyShape> = {
  name: "crm_list_roles",
  description:
    "Apresenta a estrutura de níveis de acesso e cargos disponíveis no sistema.",
  inputSchema: emptyShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (_input, _ctx) => {
    return {
      roles: (Object.keys(ROLE_RANK) as Array<keyof typeof ROLE_RANK>).map((r) => ({
        role: r,
        rank: ROLE_RANK[r],
        is_privileged: r === "admin",
      })),
    };
  },
};

export const crmListPermissions: McpToolDefinition<typeof emptyShape> = {
  name: "crm_list_permissions",
  description:
    "Lista os privilégios operacionais divididos por áreas funcionais do sistema.",
  inputSchema: emptyShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (_input, _ctx) => {
    return {
      domains: HERMES_DOMAIN_PERMISSIONS,
    };
  },
};

export const crmListIntegrations: McpToolDefinition<typeof emptyShape> = {
  name: "crm_list_integrations",
  description:
    "Verifica a situação das conexões com canais de mensagem e serviços parceiros.",
  inputSchema: emptyShape,
  category: "read",
  requiresRole: "admin",
  requiresScope: "mcp:read",
  handler: async (_input, ctx) => {
    const { data: channels } = await ctx.supabase
      .from("channel_sessions")
      .select("id, channel_type, status, label, updated_at")
      .eq("organization_id", ctx.organizationId);

    const { data: webhooks } = await ctx.supabase
      .from("webhook_sources")
      .select("id, name, is_active, created_at")
      .eq("organization_id", ctx.organizationId);

    return {
      channels: sanitizeSecrets(channels ?? []),
      webhook_sources: sanitizeSecrets(webhooks ?? []),
    };
  },
};

const getAuditLogsShape = {
  limit: z.number().int().min(1).max(100).default(50),
  action: z.string().optional(),
  resource_type: z.string().optional(),
};

export const crmGetAuditLogs: McpToolDefinition<typeof getAuditLogsShape> = {
  name: "crm_get_audit_logs",
  description:
    "Exibe os registros de auditoria com ações executadas por pessoas e assistentes.",
  inputSchema: getAuditLogsShape,
  category: "read",
  requiresRole: "admin",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    let query = ctx.supabase
      .from("api_audit_log")
      .select("id, action, actor_user_id, actor_api_token_id, resource_type, resource_id, metadata, request_id, created_at")
      .eq("organization_id", ctx.organizationId);

    if (input.action) query = query.eq("action", input.action);
    if (input.resource_type) query = query.eq("resource_type", input.resource_type);

    query = query.order("created_at", { ascending: false }).limit(input.limit);
    const { data, error } = await query;

    if (error) {
      throw new ApiError(500, "database_error", { details: error.message }, ctx.requestId, "Falha ao consultar logs de auditoria.");
    }

    return { audit_logs: sanitizeSecrets(data ?? []) };
  },
};
