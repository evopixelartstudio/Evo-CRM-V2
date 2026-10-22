-- manifest: 0705_motivos_encerramento_lead — Amplia os motivos canônicos de encerramento do funil com os padrões do CRM (sem_interesse, sem_resposta, numero_invalido, servico_incompativel, contato_duplicado).
--
-- O trigger fn_validate_lost_reason_required valida se o motivo gravado em crm_leads.lost_reason
-- pertence aos motivos canônicos ou aos motivos estendidos configurados no funil.
-- Esta migration adiciona os cinco novos motivos padronizados ao array de canônicos,
-- evitando recusa com 22023 quando o operador encerra oportunidades com estas opções.
-- Privilégios de execução seguem o princípio de menor privilégio (revogado de anon e public).

create or replace function public.fn_validate_lost_reason_required() returns trigger
    language plpgsql
    set search_path to 'public', 'pg_temp'
    as $$
declare
  v_canonical text[] := array[
    'requested_by_customer',
    'price',
    'no_response',
    'product_unavailable',
    'cancelled_by_store',
    'cancelled_by_customer',
    'payment_failed',
    'other',
    'moved_to_another_pipeline',
    'opted_out_of_messages',
    'sem_interesse',
    'sem_resposta',
    'numero_invalido',
    'servico_incompativel',
    'contato_duplicado'
  ];
  v_pipeline_extra text[];
begin
  if new.status = 'lost' then
    if new.lost_reason is null or length(new.lost_reason) = 0 then
      raise exception 'lost_reason_required' using errcode = '22023';
    end if;

    select coalesce(
      array(
        select case when jsonb_typeof(e) = 'object'
                    then nullif(e ->> 'label', '')
                    else nullif(e #>> '{}', '') end
          from jsonb_array_elements(settings->'lost_reasons') as t(e)
      ), '{}'::text[]
    ) into v_pipeline_extra
    from public.crm_pipelines where id = new.pipeline_id;

    if not (new.lost_reason = any (v_canonical) or new.lost_reason = any (v_pipeline_extra)) then
      raise exception 'lost_reason_invalid: %', new.lost_reason using errcode = '22023';
    end if;
  end if;
  return new;
end$$;

revoke execute on function public.fn_validate_lost_reason_required() from public, anon;
grant execute on function public.fn_validate_lost_reason_required() to authenticated, service_role;
