-- ============================================================================
-- RF-36 (interpretación por IA) + base del modo offline (Etapa 5)
--
-- Qué agrega:
--   1. submissions.client_uuid       → id generado en el celular al abrir el
--                                       formulario; clave única para que un
--                                       reintento de envío no duplique datos.
--   2. submissions.processing_status → recibido / enriqueciendo / resumiendo /
--                                       completo (lo usarán RF-37 y la Etapa 5).
--   3. submission_answers.valor_dictado → lo que el técnico dictó por voz,
--                                         tal cual lo reconoció el navegador.
--      submission_answers.valor_ia      → lo que propuso la IA.
--      submission_answers.ia_aceptada   → si el técnico usó la propuesta.
--      (`valor` sigue siendo la respuesta final que vale.)
--   4. ia_llamadas → registro de cada llamada a la IA: tokens, costo,
--                    latencia y resultado (RNF-22/23).
--   5. ia_consumo() → cuántas llamadas hizo un usuario en las últimas 24 h y
--                     cuánto se gastó en el mes, para los topes (RNF-21/22).
--
-- Se puede volver a correr sin romper nada (usa IF NOT EXISTS / OR REPLACE).
-- Cómo correrlo: Supabase Studio → SQL Editor → pegar todo → Run.
-- ============================================================================

-- 1 y 2) submissions ---------------------------------------------------------
-- La columna se crea con default 'completo' para que los envíos que ya
-- existían queden así (no tienen nada pendiente de procesar), y enseguida se
-- cambia el default a 'recibido' para los envíos nuevos.
alter table public.submissions
  add column if not exists client_uuid uuid,
  add column if not exists processing_status text not null default 'completo';

alter table public.submissions
  alter column processing_status set default 'recibido';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'submissions_processing_status_check'
  ) then
    alter table public.submissions
      add constraint submissions_processing_status_check
      check (processing_status in ('recibido', 'enriqueciendo', 'resumiendo', 'completo'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'submissions_client_uuid_key'
  ) then
    alter table public.submissions
      add constraint submissions_client_uuid_key unique (client_uuid);
  end if;
end $$;

comment on column public.submissions.client_uuid is
  'Id generado en el celular al abrir el formulario. Único: evita duplicados al reintentar un envío (Etapa 5).';
comment on column public.submissions.processing_status is
  'recibido → enriqueciendo → resumiendo → completo. Estado del procesamiento del lado servidor.';

-- 3) submission_answers ------------------------------------------------------
alter table public.submission_answers
  add column if not exists valor_dictado text,
  add column if not exists valor_ia text,
  add column if not exists ia_aceptada boolean;

comment on column public.submission_answers.valor_dictado is 'Texto reconocido por voz, tal cual lo dictó el técnico.';
comment on column public.submission_answers.valor_ia is 'Valor propuesto por la IA (RF-36).';
comment on column public.submission_answers.ia_aceptada is 'true si el técnico usó la propuesta de la IA; false si la descartó; null si no hubo propuesta.';

-- 4) ia_llamadas -------------------------------------------------------------
create table if not exists public.ia_llamadas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  question_id uuid references public.form_questions (id) on delete set null,
  funcion text not null default 'interpretar-respuesta',
  modelo text,
  resultado text not null check (
    resultado in ('ok', 'sin_interpretacion', 'timeout', 'error_api', 'error_red', 'limite_diario', 'presupuesto')
  ),
  latencia_ms integer,
  input_tokens integer,
  output_tokens integer,
  costo_usd numeric(12, 6) not null default 0
);

create index if not exists ia_llamadas_user_fecha_idx on public.ia_llamadas (user_id, created_at desc);
create index if not exists ia_llamadas_fecha_idx on public.ia_llamadas (created_at desc);

comment on table public.ia_llamadas is
  'Una fila por llamada a la IA. La escribe solo la Edge Function (service_role). Base del control de costos del panel (RNF-21/22/23).';

alter table public.ia_llamadas enable row level security;

-- Solo administradores leen. Nadie escribe desde el frontend: la Edge Function
-- usa la service_role key, que no está sujeta a RLS.
drop policy if exists "ia_llamadas_select_admin" on public.ia_llamadas;
create policy "ia_llamadas_select_admin" on public.ia_llamadas
  for select using (public.es_administrador());

-- 5) ia_consumo() ------------------------------------------------------------
create or replace function public.ia_consumo(p_user uuid)
returns table (llamadas_24h bigint, costo_mes_usd numeric)
language sql
security definer
stable
set search_path = public
as $$
  select
    (select count(*)
       from public.ia_llamadas
      where user_id = p_user
        and created_at > now() - interval '24 hours'
        and resultado not in ('limite_diario', 'presupuesto')) as llamadas_24h,
    (select coalesce(sum(costo_usd), 0)
       from public.ia_llamadas
      where created_at >= date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')
                          at time zone 'America/Argentina/Buenos_Aires') as costo_mes_usd;
$$;

revoke all on function public.ia_consumo(uuid) from public, anon, authenticated;
grant execute on function public.ia_consumo(uuid) to service_role;
