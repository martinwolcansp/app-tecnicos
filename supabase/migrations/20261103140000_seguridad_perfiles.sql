-- ============================================================================
-- Seguridad de perfiles — necesario antes de exponer la API a internet.
--
-- Problema que corrige (de 20260818120000_initial_schema.sql):
--   * "profiles_update_propio_o_admin" deja que cada usuario edite SU perfil
--     sin restringir columnas: un técnico podía cambiarse el `rol` a
--     'administrador' llamando a la API con su propia sesión.
--   * "profiles_admin_insert" deja que un usuario cree su propio perfil
--     (id = auth.uid()) con cualquier rol.
--
-- Qué hace:
--   1. Crear perfiles: solo administradores. La pantalla Usuarios no se ve
--      afectada: el alta pasa por la Edge Function admin-usuarios, que usa la
--      service_role key.
--   2. Un trigger impide cambiar `rol` (o `id`) a quien no sea administrador.
--      Se permite cuando no hay usuario en la sesión (SQL Editor de Studio o
--      service_role), para no trabarse administrando la base a mano.
--
-- Se puede volver a correr sin romper nada.
-- Cómo correrlo: Supabase Studio → SQL Editor → pegar todo → Run.
-- ============================================================================

drop policy if exists "profiles_admin_insert" on public.profiles;
create policy "profiles_admin_insert" on public.profiles
  for insert with check (public.es_administrador());

create or replace function public.proteger_rol_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.rol is distinct from old.rol or new.id is distinct from old.id)
     and auth.uid() is not null
     and not public.es_administrador() then
    raise exception 'Solo un administrador puede cambiar el rol de un usuario.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists proteger_rol_perfil on public.profiles;
create trigger proteger_rol_perfil
  before update on public.profiles
  for each row execute function public.proteger_rol_perfil();
