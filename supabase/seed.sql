-- ============================================================================
-- Seed de datos — Formulario piloto "Informe de Servicio Técnico"
--
-- Fuente: Estructura de datos informe ST V2.xlsx / estructura_informe_ST_1.mermaid
-- (carpeta del proyecto). Se carga primero la rama CÁMARAS por ser la más
-- simple de las dos (11 preguntas, hasta 3 niveles de profundidad), acordado
-- como punto de partida del piloto. La rama Alarmas queda para la Etapa 2b,
-- una vez validado el flujo completo de punta a punta con esta rama.
--
-- Dos ramas del árbol original quedan sin pregunta de seguimiento a propósito
-- (2 → "Fuente", y 2.3 → "No"): en el archivo original tampoco estaban
-- definidas. No se inventa contenido acá — se retoman cuando se defina esa
-- parte del formulario. El motor de formularios (form_questions/form_logic)
-- está pensado justamente para que ampliar o modificar el árbol más adelante
-- sea agregar filas, no tocar código.
-- ============================================================================

do $$
declare
  v_form_id uuid;
  v_q1 uuid;
  v_q2 uuid;
  v_q21 uuid;
  v_q23 uuid;
  v_q24 uuid;
begin
  insert into public.forms (nombre, descripcion, estado)
  values (
    'Informe de Servicio Técnico',
    'Formulario piloto: relevamiento de servicio técnico (alarmas y cámaras). Rama Cámaras cargada primero como punto de partida.',
    'publicado'
  )
  returning id into v_form_id;

  -- Q1 · General — raíz común a ambas ramas
  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '1', 'General', 'El motivo de servicio técnico es por', 'seleccion_unica', true,
          '["Alarmas", "Cámaras", "Otros"]'::jsonb, 1)
  returning id into v_q1;

  -- Q2 · Cámaras
  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '2', 'Camaras', '¿Cuál es el problema?', 'seleccion_unica', true,
          '["Cámara", "Balún / fichas", "Fuente", "Dvr/Nvr", "Cableado", "Video verificación"]'::jsonb, 2)
  returning id into v_q2;

  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado)
  values (v_q2, v_q1, 'Cámaras');

  -- Q2.1 · rama "Cámara"
  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '2.1', 'Camaras', '¿Cambió la cámara?', 'seleccion_unica', true, '["Sí", "No"]'::jsonb, 3)
  returning id into v_q21;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q21, v_q2, 'Cámara');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '2.1.1', 'Camaras', 'Indique tipo y modelo de cámara', 'texto_largo', true, 4)
  returning id into v_q1; -- reutilizo la variable como id temporal
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q1, v_q21, 'Sí');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '2.1.2', 'Camaras', 'Determine tiempo y elementos para la reparación', 'texto_largo', true, 5)
  returning id into v_q1;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q1, v_q21, 'No');

  -- Q2.2 · rama "Balún / fichas"
  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '2.2', 'Camaras', 'Indique cantidad de balún / fichas de alimentación cambiadas', 'texto_corto', true, 6)
  returning id into v_q1;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q1, v_q2, 'Balún / fichas');

  -- Q2 · rama "Fuente": sin pregunta de seguimiento definida en el original.
  -- No se crea form_questions hijo a propósito — ver nota arriba.

  -- Q2.3 · rama "Dvr/Nvr"
  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '2.3', 'Camaras', '¿Solucionó el problema?', 'seleccion_unica', true, '["Sí", "No"]'::jsonb, 7)
  returning id into v_q23;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q23, v_q2, 'Dvr/Nvr');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '2.3.1', 'Camaras', '¿Cuál era el inconveniente?', 'seleccion_unica', true,
          '["Dvr sin alimentación", "Fuente del Dvr quemada", "Dvr fuera de hora"]'::jsonb, 8)
  returning id into v_q1;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q1, v_q23, 'Sí');

  -- Q2.3 · "No": sin pregunta de seguimiento definida en el original — ídem Fuente.

  -- Q2.4 · rama "Cableado"
  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '2.4', 'Camaras', '¿Solucionó el problema?', 'seleccion_unica', true, '["Sí", "No"]'::jsonb, 9)
  returning id into v_q24;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q24, v_q2, 'Cableado');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '2.4.1', 'Camaras', 'Indique el trabajo realizado', 'texto_largo', true, 10)
  returning id into v_q1;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q1, v_q24, 'Sí');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '2.4.2', 'Camaras', 'Indique el trabajo a realizar', 'texto_largo', true, 11)
  returning id into v_q1;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q1, v_q24, 'No');

  -- Q2.5 · rama "Video verificación"
  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '2.5', 'Camaras', 'Indique trabajo realizado', 'texto_largo', true, 12)
  returning id into v_q1;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q1, v_q2, 'Video verificación');

  raise notice 'Formulario piloto creado con id %', v_form_id;
end $$;
