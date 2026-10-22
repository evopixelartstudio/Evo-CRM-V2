-- manifest: 0704_financeiro_integrado — Cria o modulo de Financeiro Integrado (financial_contracts e financial_invoices) com seguranca multi-tenant estrita, RLS por papel e validacao de integridade organizacional.
--
-- ESTRUTURA DO FINANCEIRO INTEGRADO:
--
-- 1. `financial_contracts`: servicos e contratos de clientes (recorrentes, parcelados e avulsos).
--    Cada contrato pertence a uma organizacao e um contato (cliente do CRM), podendo se ligar
--    ao negocio/lead de origem (crm_leads) e usuario responsavel.
--
-- 2. `financial_invoices`: lancamentos de cobranca, contas a receber (in) e despesas (out),
--    com rastreamento de valor contratado, valor cobrado, valor recebido, data de vencimento,
--    data de pagamento, forma de pagamento (pix, cartao, boleto, transferencia, dinheiro),
--    parcela e status (pending, paid, partial, partially_paid, overdue, cancelled, reversed).
--
-- 3. SEGURANÇA E MULTI-TENANCY:
--    - RLS estrita: leitura e escrita restritas a membros da organização com papel ao menos 'agent'.
--    - Usuários comuns ('viewer') não visualizam nem alteram dados financeiros.
--    - Administradores globais da plataforma não possuem acesso irrestrito — devem pertencer à organização.
--    - Triggers de validação de integridade multi-tenant impedem vinculação cruzada entre organizações
--      (contatos, empresas, leads, contratos, contas financeiras e estornos).

-- ─── 1. financial_contracts ──────────────────────────────────────────────────
create table if not exists public.financial_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  lead_id uuid references public.crm_leads(id) on delete set null,
  responsible_user_id uuid references auth.users(id) on delete set null,

  title text not null,
  service_name text,
  description text,
  modality text not null default 'recurring'
    check (modality in ('one_off', 'installments', 'recurring')),
  recurrence_period text
    check (recurrence_period is null or recurrence_period in ('monthly', 'bimonthly', 'quarterly', 'semi_annual', 'annual')),

  total_cents bigint not null default 0 check (total_cents >= 0),
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  currency text not null default 'BRL' check (char_length(currency) = 3),

  contract_date date not null default current_date,
  start_date date not null default current_date,
  end_date date,
  due_day integer check (due_day is null or (due_day >= 1 and due_day <= 31)),
  installments_count integer default 1 check (installments_count >= 1),

  status text not null default 'active'
    check (status in ('draft', 'active', 'paused', 'completed', 'cancelled')),

  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,

  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Garantir colunas complementares caso a tabela já exista em ambiente de teste/staging
alter table public.financial_contracts
  add column if not exists service_name text,
  add column if not exists amount_cents bigint not null default 0,
  add column if not exists installments_count integer default 1,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists financial_contracts_org_status_idx
  on public.financial_contracts (organization_id, status);
create index if not exists financial_contracts_org_contact_idx
  on public.financial_contracts (organization_id, contact_id);
create index if not exists financial_contracts_org_lead_idx
  on public.financial_contracts (organization_id, lead_id)
  where lead_id is not null;

-- ─── 2. financial_invoices ───────────────────────────────────────────────────
create table if not exists public.financial_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid references public.financial_contracts(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  lead_id uuid references public.crm_leads(id) on delete set null,

  account_id uuid references public.financial_accounts(id) on delete set null,
  account_plan_id uuid references public.account_plans(id) on delete set null,

  direction text not null default 'in' check (direction in ('in', 'out')),
  type text not null default 'income' check (type in ('income', 'expense')),
  category text default 'outros',
  title text not null,

  contracted_cents bigint not null default 0 check (contracted_cents >= 0),
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  billed_cents bigint not null default 0 check (billed_cents >= 0),
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  currency text not null default 'BRL' check (char_length(currency) = 3),

  due_date date not null default current_date,
  paid_at timestamptz,

  payment_method text check (
    payment_method is null or
    payment_method in ('pix', 'credit_card', 'debit_card', 'boleto', 'transfer', 'bank_transfer', 'bank_slip', 'cash', 'other')
  ),

  installment_number integer default 1 check (installment_number >= 1),
  total_installments integer default 1 check (total_installments >= 1),
  installment_total integer default 1 check (installment_total >= 1),

  status text not null default 'pending' check (
    status in ('pending', 'paid', 'partial', 'partially_paid', 'overdue', 'cancelled', 'reversed')
  ),

  notes text,
  metadata jsonb not null default '{}'::jsonb,
  custom_fields jsonb not null default '{}'::jsonb,
  reverses_invoice_id uuid references public.financial_invoices(id) on delete set null,

  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Garantir colunas complementares caso a tabela já exista
alter table public.financial_invoices
  add column if not exists type text not null default 'income',
  add column if not exists billed_cents bigint not null default 0,
  add column if not exists installment_total integer default 1,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists financial_invoices_org_status_due_idx
  on public.financial_invoices (organization_id, status, due_date desc);
create index if not exists financial_invoices_org_contact_idx
  on public.financial_invoices (organization_id, contact_id);
create index if not exists financial_invoices_contract_idx
  on public.financial_invoices (contract_id)
  where contract_id is not null;

-- ─── 3. Ligacao com financial_entries ─────────────────────────────────────────
alter table public.financial_entries
  add column if not exists contract_id uuid references public.financial_contracts(id) on delete set null;
alter table public.financial_entries
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;

-- ─── 4. Triggers de integridade multi-tenant (prevenção de cross-tenant) ──────
create or replace function public.fn_validate_financial_contracts_org_integrity()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.contact_id is not null then
    if not exists (
      select 1 from public.contacts
      where id = new.contact_id and organization_id = new.organization_id
    ) then
      raise exception 'Cross-tenant violation: contact % does not belong to organization %', new.contact_id, new.organization_id
        using errcode = '23503';
    end if;
  end if;

  if new.company_id is not null then
    if not exists (
      select 1 from public.companies
      where id = new.company_id and organization_id = new.organization_id
    ) then
      raise exception 'Cross-tenant violation: company % does not belong to organization %', new.company_id, new.organization_id
        using errcode = '23503';
    end if;
  end if;

  if new.lead_id is not null then
    if not exists (
      select 1 from public.crm_leads
      where id = new.lead_id and organization_id = new.organization_id
    ) then
      raise exception 'Cross-tenant violation: lead % does not belong to organization %', new.lead_id, new.organization_id
        using errcode = '23503';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.fn_validate_financial_contracts_org_integrity() from public, anon;
grant execute on function public.fn_validate_financial_contracts_org_integrity() to authenticated, service_role;

drop trigger if exists trg_validate_financial_contracts_org_integrity on public.financial_contracts;
create trigger trg_validate_financial_contracts_org_integrity
  before insert or update of organization_id, contact_id, company_id, lead_id
  on public.financial_contracts
  for each row execute function public.fn_validate_financial_contracts_org_integrity();

create or replace function public.fn_validate_financial_invoices_org_integrity()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.contract_id is not null then
    if not exists (
      select 1 from public.financial_contracts
      where id = new.contract_id and organization_id = new.organization_id
    ) then
      raise exception 'Cross-tenant violation: contract % does not belong to organization %', new.contract_id, new.organization_id
        using errcode = '23503';
    end if;
  end if;

  if new.contact_id is not null then
    if not exists (
      select 1 from public.contacts
      where id = new.contact_id and organization_id = new.organization_id
    ) then
      raise exception 'Cross-tenant violation: contact % does not belong to organization %', new.contact_id, new.organization_id
        using errcode = '23503';
    end if;
  end if;

  if new.lead_id is not null then
    if not exists (
      select 1 from public.crm_leads
      where id = new.lead_id and organization_id = new.organization_id
    ) then
      raise exception 'Cross-tenant violation: lead % does not belong to organization %', new.lead_id, new.organization_id
        using errcode = '23503';
    end if;
  end if;

  if new.account_id is not null then
    if not exists (
      select 1 from public.financial_accounts
      where id = new.account_id and organization_id = new.organization_id
    ) then
      raise exception 'Cross-tenant violation: account % does not belong to organization %', new.account_id, new.organization_id
        using errcode = '23503';
    end if;
  end if;

  if new.account_plan_id is not null then
    if not exists (
      select 1 from public.account_plans
      where id = new.account_plan_id and organization_id = new.organization_id
    ) then
      raise exception 'Cross-tenant violation: account_plan % does not belong to organization %', new.account_plan_id, new.organization_id
        using errcode = '23503';
    end if;
  end if;

  if new.reverses_invoice_id is not null then
    if not exists (
      select 1 from public.financial_invoices
      where id = new.reverses_invoice_id and organization_id = new.organization_id
    ) then
      raise exception 'Cross-tenant violation: reverses_invoice % does not belong to organization %', new.reverses_invoice_id, new.organization_id
        using errcode = '23503';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.fn_validate_financial_invoices_org_integrity() from public, anon;
grant execute on function public.fn_validate_financial_invoices_org_integrity() to authenticated, service_role;

drop trigger if exists trg_validate_financial_invoices_org_integrity on public.financial_invoices;
create trigger trg_validate_financial_invoices_org_integrity
  before insert or update of organization_id, contract_id, contact_id, lead_id, account_id, account_plan_id, reverses_invoice_id
  on public.financial_invoices
  for each row execute function public.fn_validate_financial_invoices_org_integrity();

-- ─── 5. RLS: isolamento multi-tenant estrito com checagem de papel ────────────
do $$
declare t text;
begin
  foreach t in array array['financial_contracts', 'financial_invoices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation_%I_all on public.%I', t, t);
    execute format('drop policy if exists tenant_isolation_%I_read on public.%I', t, t);
    execute format('drop policy if exists tenant_isolation_%I_write on public.%I', t, t);

    -- Leitura restrita: somente membros com papel ao menos 'agent'.
    -- Bloqueia 'viewer' (usuário comum) e platform admin sem membership na organização.
    execute format($f$
      create policy tenant_isolation_%I_read on public.%I
        for select
        using (
          organization_id in (select public.fn_user_org_ids())
          and public.fn_role_at_least(organization_id, 'agent')
        );
    $f$, t, t);

    -- Escrita restrita: somente membros com papel ao menos 'agent'.
    execute format($f$
      create policy tenant_isolation_%I_write on public.%I
        for all
        using (
          organization_id in (select public.fn_user_org_ids())
          and public.fn_role_at_least(organization_id, 'agent')
        )
        with check (
          organization_id in (select public.fn_user_org_ids())
          and public.fn_role_at_least(organization_id, 'agent')
        );
    $f$, t, t);

    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
  end loop;
end $$;

-- ─── 6. Trigger updated_at ───────────────────────────────────────────────────
do $$
declare t text;
begin
  if exists (select 1 from pg_proc where proname = 'fn_touch_updated_at') then
    foreach t in array array['financial_contracts', 'financial_invoices'] loop
      execute format('drop trigger if exists trg_%I_touch on public.%I', t, t);
      execute format(
        'create trigger trg_%I_touch before update on public.%I for each row execute function public.fn_touch_updated_at()',
        t, t);
    end loop;
  end if;
end $$;

comment on table public.financial_contracts is
  'Contratos de prestacao de servicos e recorrencia de clientes com termos financeiros unificados.';
comment on table public.financial_invoices is
  'Cobrancas, contas a receber, despesas e historico de parcelas e pagamentos integrados ao CRM.';
