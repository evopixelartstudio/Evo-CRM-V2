-- manifest: cria o modulo de Financeiro Integrado (financial_contracts e financial_invoices) substituindo o modelo de Comandas por contratos e cobrancas multi-tenant.
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
--    parcela e status (pending, paid, partial, overdue, cancelled, reversed).
--
-- 3. Integracao com `financial_entries` (extrato de caixa e relatorio legado), mantendo
--    todas as tabelas historicas (sales, sale_items) intactas sem perda de dados.

-- ─── 1. financial_contracts ──────────────────────────────────────────────────
create table if not exists public.financial_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  lead_id uuid references public.crm_leads(id) on delete set null,
  responsible_user_id uuid references auth.users(id) on delete set null,

  title text not null,
  description text,
  modality text not null default 'recurring'
    check (modality in ('one_off', 'installments', 'recurring')),
  recurrence_period text
    check (recurrence_period is null or recurrence_period in ('monthly', 'bimonthly', 'quarterly', 'semi_annual', 'annual')),

  total_cents bigint not null default 0 check (total_cents >= 0),
  currency text not null default 'BRL' check (char_length(currency) = 3),

  contract_date date not null default current_date,
  start_date date not null default current_date,
  end_date date,
  due_day integer check (due_day is null or (due_day >= 1 and due_day <= 31)),

  status text not null default 'active'
    check (status in ('draft', 'active', 'paused', 'completed', 'cancelled')),

  notes text,
  custom_fields jsonb not null default '{}'::jsonb,

  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  category text default 'outros',
  title text not null,

  contracted_cents bigint not null default 0 check (contracted_cents >= 0),
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  currency text not null default 'BRL' check (char_length(currency) = 3),

  due_date date not null default current_date,
  paid_at timestamptz,

  payment_method text check (
    payment_method is null or
    payment_method in ('pix', 'credit_card', 'debit_card', 'boleto', 'transfer', 'cash', 'other')
  ),

  installment_number integer default 1 check (installment_number >= 1),
  total_installments integer default 1 check (total_installments >= 1),

  status text not null default 'pending' check (
    status in ('pending', 'paid', 'partial', 'overdue', 'cancelled', 'reversed')
  ),

  notes text,
  reverses_invoice_id uuid references public.financial_invoices(id) on delete set null,

  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

-- ─── 4. RLS: isolamento multi-tenant canônico ────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['financial_contracts', 'financial_invoices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation_%I_all on public.%I', t, t);
    execute format($f$
      create policy tenant_isolation_%I_all on public.%I
        for all
        using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin())
        with check (
          public.fn_is_platform_admin()
          or (organization_id in (select public.fn_user_org_ids())
              and public.fn_role_at_least(organization_id, 'agent'))
        )
    $f$, t, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ─── 5. Trigger updated_at ───────────────────────────────────────────────────
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
