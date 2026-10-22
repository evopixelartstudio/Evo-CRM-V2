-- manifest: 0706_customer_notes_and_hermes_service_account — Cria a tabela customer_notes para observacoes internas de clientes e suporte a identidade tecnica do Hermes Gerente Tecnico.
--
-- 1. `customer_notes`: notas e observacoes internas vinculadas ao contato/cliente, lead ou conversa.
--    São estritamente internas (nunca enviadas a canais externos).
-- 2. RLS multi-tenant com piso de papel 'agent' e trigger de integridade organizacional.

create table if not exists public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  title text not null default 'Observação interna',
  body text not null,
  is_pinned boolean not null default false,
  is_archived boolean not null default false,
  pinned_at timestamptz,
  archived_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_by_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_notes_org_contact_idx
  on public.customer_notes (organization_id, contact_id, created_at desc);

create index if not exists customer_notes_org_pinned_idx
  on public.customer_notes (organization_id, is_pinned desc, created_at desc);

-- Trigger de integridade multi-tenant
create or replace function public.fn_validate_customer_notes_org_integrity()
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

  if new.lead_id is not null then
    if not exists (
      select 1 from public.crm_leads
      where id = new.lead_id and organization_id = new.organization_id
    ) then
      raise exception 'Cross-tenant violation: lead % does not belong to organization %', new.lead_id, new.organization_id
        using errcode = '23503';
    end if;
  end if;

  if new.conversation_id is not null then
    if not exists (
      select 1 from public.conversations
      where id = new.conversation_id and organization_id = new.organization_id
    ) then
      raise exception 'Cross-tenant violation: conversation % does not belong to organization %', new.conversation_id, new.organization_id
        using errcode = '23503';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.fn_validate_customer_notes_org_integrity() from public, anon;
grant execute on function public.fn_validate_customer_notes_org_integrity() to authenticated, service_role;

drop trigger if exists trg_validate_customer_notes_org_integrity on public.customer_notes;
create trigger trg_validate_customer_notes_org_integrity
  before insert or update of organization_id, contact_id, lead_id, conversation_id
  on public.customer_notes
  for each row execute function public.fn_validate_customer_notes_org_integrity();

-- RLS
alter table public.customer_notes enable row level security;
drop policy if exists customer_notes_read on public.customer_notes;
create policy customer_notes_read on public.customer_notes
  for select
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  );

drop policy if exists customer_notes_write on public.customer_notes;
create policy customer_notes_write on public.customer_notes
  for all
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  );

revoke all on public.customer_notes from anon, public;
grant select, insert, update, delete on public.customer_notes to authenticated, service_role;

-- Trigger updated_at
do $$
begin
  if exists (select 1 from pg_proc where proname = 'fn_touch_updated_at') then
    drop trigger if exists trg_customer_notes_touch on public.customer_notes;
    create trigger trg_customer_notes_touch
      before update on public.customer_notes
      for each row execute function public.fn_touch_updated_at();
  end if;
end $$;

comment on table public.customer_notes is
  'Observações e notas internas de contatos/clientes com isolamento contra envio para canais externos.';

