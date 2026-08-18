-- ============================================================================
-- Esquema inicial — App de carga de datos para técnicos
-- Etapa 2: Modelo de datos y backend
--
-- Sigue el modelo descripto en "Especificacion_Funcional_Tecnica_Desarrollo_Propio.docx"
-- (sección 3, Modelo de datos - nivel alto). Pensado para Supabase self-hosted,
-- con permisos resueltos vía Row Level Security en lugar de lógica escrita a mano.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- profiles: usuarios de la aplicación (técnicos y administradores),
-- vinculados 1 a 1 con auth.users de Supabase Auth.
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null,
  rol text not null check (rol in ('tecnico', 'administrador', 'superadministrador')),
  email text not null,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Usuarios de la app (técnicos y administradores), 1 a 1 con auth.users.';

-- ----------------------------------------------------------------------------
-- forms: formularios configurados por el administrador (RF-01, RF-02, RF-03)
-- ----------------------------------------------------------------------------
create table public.forms (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  estado text not null default 'borrador' check (estado in ('borrador', 'publicado', 'archivado')),
  creado_por uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.forms is 'Formularios administrables. Solo los "publicado" son visibles para técnicos (RF-03, RF-04).';

-- ----------------------------------------------------------------------------
-- form_questions: preguntas de cada formulario (RF-06 a RF-09).
-- El árbol de ramificación se resuelve en form_logic; acá va el contenido
-- de cada pregunta y su tipo de campo.
-- ----------------------------------------------------------------------------
create table public.form_questions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  codigo text not null, -- identificador jerárquico legible, ej. '4.3.3.1.1' (ver Estructura de datos informe ST V2.xlsx)
  seccion text, -- ej. 'General', 'Alarmas', 'Camaras' — agrupa preguntas dentro de un mismo formulario
  texto_pregunta text not null,
  tipo_campo text not null check (
    tipo_campo in (
      'texto_corto', 'texto_largo', 'numero', 'seleccion_unica',
      'seleccion_multiple', 'si_no', 'telefono', 'email', 'fecha', 'foto'
    )
  ),
  obligatorio boolean not null default true, -- RF-10
  opciones jsonb, -- array de strings, solo para seleccion_unica / seleccion_multiple
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  unique (form_id, codigo)
);

comment on table public.form_questions is 'Preguntas de un formulario. Tipos de campo según Anexo B del Documento de Requerimientos.';

-- ----------------------------------------------------------------------------
-- form_logic: lógica condicional entre preguntas (RF-13, RF-14).
-- Una fila = "mostrar question_id si pregunta_origen_id fue respondida
-- con valor_esperado". Una pregunta sin fila en esta tabla es raíz
-- (siempre visible cuando el formulario arranca, o dentro de su sección).
-- ----------------------------------------------------------------------------
create table public.form_logic (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.form_questions (id) on delete cascade,
  pregunta_origen_id uuid not null references public.form_questions (id) on delete cascade,
  valor_esperado text not null,
  accion text not null default 'mostrar' check (accion in ('mostrar', 'ocultar')),
  created_at timestamptz not null default now()
);

comment on table public.form_logic is 'Condiciones de ramificación. Ver estructura_informe_ST_1.mermaid para el árbol de referencia del piloto.';

-- ----------------------------------------------------------------------------
-- submissions: envíos recibidos (RF-19, RF-26 a RF-28)
-- ----------------------------------------------------------------------------
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id),
  enviado_por uuid not null references public.profiles (id), -- técnico
  cliente text, -- dato del cliente/sujeto del servicio, si aplica
  estado text not null default 'nuevo' check (estado in ('nuevo', 'en_revision', 'aprobado', 'rechazado')),
  asignado_a uuid references public.profiles (id),
  fecha_vencimiento date,
  codigo_seguimiento text not null unique, -- RF-18: código mostrado en la confirmación
  created_at timestamptz not null default now()
);

comment on table public.submissions is 'Un envío = un formulario completado y enviado por un técnico.';

-- ----------------------------------------------------------------------------
-- submission_answers: respuestas de cada envío
-- ----------------------------------------------------------------------------
create table public.submission_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  question_id uuid not null references public.form_questions (id),
  valor text,
  archivo_url text, -- referencia a Supabase Storage, si el tipo de campo es 'foto'
  created_at timestamptz not null default now(),
  unique (submission_id, question_id)
);

comment on table public.submission_answers is 'Respuesta puntual a una pregunta dentro de un envío.';

-- ----------------------------------------------------------------------------
-- integrations: envío automático vía API por formulario (RF-22 a RF-24)
-- ----------------------------------------------------------------------------
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  tipo text not null check (tipo in ('webhook', 'slack', 'whatsapp')),
  config jsonb not null default '{}'::jsonb, -- url, secreto HMAC, etc. según el tipo
  eventos text[] not null default array['nuevo_envio'], -- nuevo_envio | cambio_estado | asignacion
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.integrations is 'Destinos de envío automático configurados por el administrador (RF-22).';

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.forms enable row level security;
alter table public.form_questions enable row level security;
alter table public.form_logic enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_answers enable row level security;
alter table public.integrations enable row level security;

-- Función auxiliar: ¿el usuario autenticado es administrador o superadministrador?
create function public.es_administrador()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and rol in ('administrador', 'superadministrador')
  );
$$;

-- profiles: cada usuario ve su propio perfil; los administradores ven todos.
create policy "profiles_select_propio_o_admin" on public.profiles
  for select using (id = auth.uid() or public.es_administrador());

create policy "profiles_update_propio_o_admin" on public.profiles
  for update using (id = auth.uid() or public.es_administrador());

create policy "profiles_admin_insert" on public.profiles
  for insert with check (public.es_administrador() or id = auth.uid());

-- forms: técnicos ven solo los publicados; administradores ven y editan todo.
create policy "forms_select_publicados_o_admin" on public.forms
  for select using (estado = 'publicado' or public.es_administrador());

create policy "forms_admin_all" on public.forms
  for all using (public.es_administrador()) with check (public.es_administrador());

-- form_questions / form_logic: visibles si se puede ver el formulario al que pertenecen.
create policy "form_questions_select" on public.form_questions
  for select using (
    exists (
      select 1 from public.forms f
      where f.id = form_questions.form_id
        and (f.estado = 'publicado' or public.es_administrador())
    )
  );

create policy "form_questions_admin_write" on public.form_questions
  for all using (public.es_administrador()) with check (public.es_administrador());

create policy "form_logic_select" on public.form_logic
  for select using (
    exists (
      select 1 from public.form_questions q
      join public.forms f on f.id = q.form_id
      where q.id = form_logic.question_id
        and (f.estado = 'publicado' or public.es_administrador())
    )
  );

create policy "form_logic_admin_write" on public.form_logic
  for all using (public.es_administrador()) with check (public.es_administrador());

-- submissions: un técnico solo ve/crea sus propios envíos (RNF-09); admin ve todo.
create policy "submissions_select_propio_o_admin" on public.submissions
  for select using (enviado_por = auth.uid() or public.es_administrador());

create policy "submissions_insert_propio" on public.submissions
  for insert with check (enviado_por = auth.uid());

create policy "submissions_update_admin_o_dueño" on public.submissions
  for update using (enviado_por = auth.uid() or public.es_administrador());

-- submission_answers: sigue el mismo criterio que su submission.
create policy "submission_answers_select" on public.submission_answers
  for select using (
    exists (
      select 1 from public.submissions s
      where s.id = submission_answers.submission_id
        and (s.enviado_por = auth.uid() or public.es_administrador())
    )
  );

create policy "submission_answers_insert" on public.submission_answers
  for insert with check (
    exists (
      select 1 from public.submissions s
      where s.id = submission_answers.submission_id
        and s.enviado_por = auth.uid()
    )
  );

-- integrations: solo administradores.
create policy "integrations_admin_only" on public.integrations
  for all using (public.es_administrador()) with check (public.es_administrador());
