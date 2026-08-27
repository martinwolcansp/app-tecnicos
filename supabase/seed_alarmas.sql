-- ============================================================================
-- Seed de datos — Rama ALARMAS del formulario piloto "Informe de Servicio Técnico"
--
-- Fuente: estructura_informe_ST_1.mermaid (misma fuente que usó seed.sql para
-- la rama Cámaras). Este script AGREGA preguntas a un formulario que ya
-- existe — no crea un formulario nuevo, así que hay que correr primero
-- seed.sql (Cámaras) si todavía no se corrió.
--
-- Numeración: los códigos "2" y "2.x" ya están tomados por Cámaras, así que
-- esta rama arranca en "3" (equivalente al "Q2" de Alarmas en el diagrama
-- original — ahí comparte número con Cámaras porque son dos árboles
-- separados; acá conviven en el mismo formulario, así que necesitan códigos
-- distintos). A partir de "Q3 · Problema trabajado en Alarmas" (nuestro
-- código "4"), la numeración ya coincide con la del diagrama original,
-- porque ahí sus hijas ya se numeran como "4.x".
--
-- Dos ramas quedan sin pregunta de seguimiento a propósito, igual que en el
-- diagrama original: "4.3.3" → "Está desconectado", y "4.3.3.1" → "Sí".
-- ============================================================================

do $$
declare
  v_form_id uuid;
  v_q1 uuid;    -- pregunta raíz, ya existente (código "1")
  v_q3 uuid;    -- "3"
  v_q4 uuid;    -- "4"
  v_q41 uuid;
  v_q42 uuid;
  v_q43 uuid;
  v_q431 uuid;
  v_q432 uuid;
  v_q433 uuid;
  v_q4331 uuid;
  v_q44 uuid;
  v_q45 uuid;
  v_tmp uuid;
begin
  select id into v_form_id from public.forms where nombre = 'Informe de Servicio Técnico' limit 1;
  if v_form_id is null then
    raise exception 'No se encontró el formulario "Informe de Servicio Técnico" — corré primero seed.sql (rama Cámaras).';
  end if;

  select id into v_q1 from public.form_questions where form_id = v_form_id and codigo = '1';
  if v_q1 is null then
    raise exception 'No se encontró la pregunta raíz (código "1") en ese formulario.';
  end if;

  -- Q3 · "¿Relacionado a la instalación?"
  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '3', 'Alarmas', '¿Relacionado a la instalación?', 'seleccion_unica', true, '["Sí", "No"]'::jsonb, 13)
  returning id into v_q3;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q3, v_q1, 'Alarmas');

  -- Q4 · "Problema trabajado en Alarmas"
  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '4', 'Alarmas', 'Problema trabajado en Alarmas', 'seleccion_unica', true,
          '["Falla de zona", "Batería baja central", "Problema de comunicación", "Problema de panel", "Problema con la app"]'::jsonb, 14)
  returning id into v_q4;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q4, v_q1, 'Alarmas');

  -- ---- 4.1 · Falla de zona ----
  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '4.1', 'Alarmas', 'Qué zona/zonas estaba fallando', 'seleccion_unica', true,
          '["Sensor roto", "Cableado con problemas", "Problema zona RF"]'::jsonb, 15)
  returning id into v_q41;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q41, v_q4, 'Falla de zona');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '4.1.1', 'Alarmas', '¿Se cambió? Indique Sí / No y, si aplica, cantidad y tipo', 'texto_largo', true, 16)
  returning id into v_tmp;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_tmp, v_q41, 'Sensor roto');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '4.1.2', 'Alarmas', '¿Solucionó el problema? (Sí / No / Relay / Recoordinó / Recableó)', 'texto_largo', true, 17)
  returning id into v_tmp;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_tmp, v_q41, 'Cableado con problemas');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '4.1.3', 'Alarmas', 'Qué tipo de falla', 'texto_largo', true, 18)
  returning id into v_tmp;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_tmp, v_q41, 'Problema zona RF');

  -- ---- 4.2 · Batería baja central ----
  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '4.2', 'Alarmas', '¿Se cambió la batería?', 'seleccion_unica', true, '["Sí", "No"]'::jsonb, 19)
  returning id into v_q42;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q42, v_q4, 'Batería baja central');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '4.2.1', 'Alarmas', 'Número de serie', 'texto_corto', true, 20)
  returning id into v_tmp;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_tmp, v_q42, 'Sí');
  -- "No" queda sin pregunta de seguimiento, igual que en el diagrama original.

  -- ---- 4.3 · Problema de comunicación ----
  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '4.3', 'Alarmas', 'Cuál es la falla por la que no comunica', 'seleccion_unica', true,
          '["Señal de chip", "Señal de internet", "Problema con el comunicador"]'::jsonb, 21)
  returning id into v_q43;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q43, v_q4, 'Problema de comunicación');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '4.3.1', 'Alarmas', '¿Se cambió?', 'seleccion_unica', true, '["Sí", "No"]'::jsonb, 22)
  returning id into v_q431;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q431, v_q43, 'Señal de chip');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '4.3.1.1', 'Alarmas', 'N° de chip y prestador de servicio', 'texto_corto', true, 23)
  returning id into v_tmp;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_tmp, v_q431, 'Sí');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '4.3.1.2', 'Alarmas', '¿Se corrió el comunicador?', 'texto_corto', true, 24)
  returning id into v_tmp;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_tmp, v_q431, 'No');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '4.3.2', 'Alarmas', 'Qué problema con internet', 'seleccion_unica', true,
          '["Falta de red 2.4 wifi", "Cambio de red wifi"]'::jsonb, 25)
  returning id into v_q432;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q432, v_q43, 'Señal de internet');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '4.3.2.1', 'Alarmas', 'Cuál es el inconveniente', 'texto_largo', true, 26)
  returning id into v_tmp;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_tmp, v_q432, 'Falta de red 2.4 wifi');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '4.3.2.2', 'Alarmas', '¿Solucionó el problema?', 'seleccion_unica', true, '["Sí", "No"]'::jsonb, 27)
  returning id into v_tmp;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_tmp, v_q432, 'Cambio de red wifi');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '4.3.3', 'Alarmas', 'Qué tipo de falla tiene el comunicador', 'seleccion_unica', true,
          '["Se encuentra tildado", "Está desconectado"]'::jsonb, 28)
  returning id into v_q433;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q433, v_q43, 'Problema con el comunicador');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '4.3.3.1', 'Alarmas', '¿Solucionó el inconveniente?', 'seleccion_unica', true, '["Sí", "No"]'::jsonb, 29)
  returning id into v_q4331;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q4331, v_q433, 'Se encuentra tildado');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '4.3.3.1.1', 'Alarmas', 'Indique reparación a realizar', 'texto_largo', true, 30)
  returning id into v_tmp;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_tmp, v_q4331, 'No');
  -- "Sí" (de 4.3.3.1) y "Está desconectado" (de 4.3.3) quedan sin pregunta de
  -- seguimiento, igual que en el diagrama original.

  -- ---- 4.4 · Problema de panel ----
  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '4.4', 'Alarmas', 'Falla la placa', 'seleccion_unica', true,
          '["Cambio de placa", "Cambio de teclado", "Cambio de central"]'::jsonb, 31)
  returning id into v_q44;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q44, v_q4, 'Problema de panel');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '4.4.1.1', 'Alarmas', 'Tipo de placa, tiempo y motivo', 'texto_largo', true, 32)
  returning id into v_tmp;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_tmp, v_q44, 'Cambio de placa');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '4.4.1.2', 'Alarmas', 'Tipo de placa, tiempo y motivo', 'texto_largo', true, 33)
  returning id into v_tmp;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_tmp, v_q44, 'Cambio de teclado');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '4.4.1.3', 'Alarmas', 'Tipo de placa, tiempo y motivo', 'texto_largo', true, 34)
  returning id into v_tmp;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_tmp, v_q44, 'Cambio de central');

  -- ---- 4.5 · Problema con la app ----
  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden)
  values (v_form_id, '4.5', 'Alarmas', '¿Solucionó el problema?', 'seleccion_unica', true, '["Sí", "No"]'::jsonb, 35)
  returning id into v_q45;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_q45, v_q4, 'Problema con la app');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '4.5.1', 'Alarmas', 'Indique cuál era el problema', 'texto_largo', true, 36)
  returning id into v_tmp;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_tmp, v_q45, 'Sí');

  insert into public.form_questions (form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, orden)
  values (v_form_id, '4.5.2', 'Alarmas', 'Indique cuál es el problema', 'texto_largo', true, 37)
  returning id into v_tmp;
  insert into public.form_logic (question_id, pregunta_origen_id, valor_esperado) values (v_tmp, v_q45, 'No');

  -- Actualiza la descripción del formulario para reflejar que ya tiene las dos ramas.
  update public.forms
  set descripcion = 'Formulario piloto: relevamiento de servicio técnico (alarmas y cámaras). Ambas ramas cargadas.',
      updated_at = now()
  where id = v_form_id;

  raise notice 'Rama Alarmas cargada en el formulario % (25 preguntas nuevas)', v_form_id;
end $$;
