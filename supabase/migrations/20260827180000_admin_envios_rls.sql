-- Arregla el permiso que le falta al administrador para el CRUD de envíos.
-- Reviso la migración original (20260818120000_initial_schema.sql) y esto
-- es lo que encontré:
--
--   * submissions ya tenía una política de UPDATE que incluye al
--     administrador ("submissions_update_admin_o_dueño") — por eso cambiar
--     cliente/estado debería andar. Lo que le faltaba es una política de
--     DELETE: no existía ninguna, así que borrar un envío no tiraba error,
--     pero tampoco borraba nada (con RLS activado y ningún policy de DELETE,
--     Postgres no encuentra filas para borrar).
--
--   * submission_answers solo tenía políticas de SELECT e INSERT — nunca se
--     agregó ninguna de UPDATE ni de DELETE. Por eso "Guardar cambios" en el
--     detalle de un envío tampoco guardaba nada en las respuestas.
--
-- Se usa DROP POLICY IF EXISTS antes de cada CREATE para que este script se
-- pueda volver a correr sin problema si ya existiera una política con el
-- mismo nombre.
--
-- Cómo correrlo: Supabase Studio → SQL Editor → pegar todo → Run.

drop policy if exists "submissions_delete_admin" on public.submissions;
create policy "submissions_delete_admin"
  on public.submissions
  for delete
  using (public.es_administrador());

drop policy if exists "submission_answers_admin_write" on public.submission_answers;
create policy "submission_answers_admin_write"
  on public.submission_answers
  for all
  using (public.es_administrador())
  with check (public.es_administrador());

-- Chequeo rápido: después de correr esto, esta consulta debería mostrar
-- "submissions_delete_admin" (DELETE) y "submission_answers_admin_write"
-- (ALL) entre los resultados.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and tablename in ('submissions', 'submission_answers')
order by tablename, cmd;
