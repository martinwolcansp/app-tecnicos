import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/AuthContext'
import { generateId } from '../../lib/uuid'
import { generarReporteTexto } from '../../lib/reporteTexto'
import { useDictado } from '../../lib/dictado'
import { coincidenciaLocal, interpretarRespuesta } from '../../lib/interpretarIA'
import { ReporteImpresion } from '../../components/ReporteImpresion'
import type { LogicaCondicional, Pregunta, TipoCampo } from '../../lib/types'

type Respuestas = Record<string, string | string[]>

// Estado de la interpretación por IA (RF-36) de una pregunta. `base` es el
// texto que se mandó a interpretar: si el técnico lo cambia mientras tanto,
// la respuesta que llegue queda vieja y se descarta.
type Sugerencia =
  | { estado: 'interpretando'; base: string }
  | { estado: 'lista'; base: string; valor: string | string[] }
  | { estado: 'sin_resultado'; base: string; mensaje: string }

const TIPOS_TEXTO: TipoCampo[] = ['texto_corto', 'texto_largo', 'telefono', 'email']
const TIPOS_OPCIONES: TipoCampo[] = ['si_no', 'seleccion_unica', 'seleccion_multiple']

function generarCodigoSeguimiento(): string {
  const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const azar = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `ST-${fecha}-${azar}`
}

function opcionesDe(p: Pregunta): string[] {
  return p.tipo_campo === 'si_no' ? ['Sí', 'No'] : (p.opciones ?? [])
}

function comoTexto(v: string | string[]): string {
  return Array.isArray(v) ? v.join(', ') : v
}

/**
 * Wizard del técnico: renderiza las preguntas de form_questions en orden,
 * respetando la ramificación de form_logic, y crea submission +
 * submission_answers al enviar.
 *
 * Voz (RF-06/07/08): cada pregunta (salvo foto) tiene un botón "Dictar".
 * Interpretación por IA (RF-36), en segundo plano y sin bloquear:
 *  - Textos: lo dictado se escribe en el campo tal cual, y la IA propone una
 *    versión corregida que el técnico puede usar o descartar.
 *  - Opciones, Sí/No, número, fecha, teléfono, email: la IA propone el valor
 *    ("¿Quisiste decir: Cámaras?") y el técnico lo confirma con un toque. La
 *    IA nunca elige sola una opción, así que nunca decide sola qué rama del
 *    formulario sigue (form_logic sigue mandando).
 *  - Si la IA falla, tarda o no hay señal, el técnico sigue con lo que
 *    dictó/tipeó y el envío nunca se bloquea (RF-38).
 * Se guarda lo dictado (valor_dictado), lo propuesto (valor_ia) y si se usó
 * (ia_aceptada), además del valor final.
 *
 * Todavía NO incluye: resumen final por IA (RF-37) ni modo offline (Etapa 5).
 *
 * `modoPrueba`: se usa cuando el administrador abre "Probar formulario"
 * desde el editor. Recorre las mismas preguntas y respeta la misma lógica
 * condicional que vería un técnico real, pero al enviar NO crea
 * submission/submission_answers en la base — solo confirma que el recorrido
 * llegó al final.
 */
export function TecnicoWizard({ modoPrueba = false }: { modoPrueba?: boolean } = {}) {
  const { formId } = useParams<{ formId: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const volverA = modoPrueba ? `/admin/formularios/${formId}` : '/tecnico'

  const [preguntas, setPreguntas] = useState<Pregunta[]>([])
  const [logica, setLogica] = useState<LogicaCondicional[]>([])
  const [formularioNombre, setFormularioNombre] = useState('Informe')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [cliente, setCliente] = useState('')
  const [respuestas, setRespuestas] = useState<Respuestas>({})
  // Preguntas de selección (si_no / seleccion_unica / seleccion_multiple) ya
  // "confirmadas": quedan deshabilitadas para que no se puedan volver a
  // tocar por accidente mientras se sigue completando el resto del
  // formulario — cambiar una respuesta de estas a mitad de carga puede
  // alterar qué preguntas de la rama siguen visibles (RF-13/RF-14). El
  // técnico puede desbloquear una puntual con "Cambiar respuesta" si se
  // equivocó. Los campos de texto libre no se bloquean.
  const [confirmadas, setConfirmadas] = useState<Set<string>>(new Set())
  const [subiendoArchivo, setSubiendoArchivo] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [envioError, setEnvioError] = useState<string | null>(null)
  const [codigoSeguimiento, setCodigoSeguimiento] = useState<string | null>(null)

  // Voz + IA
  const dictado = useDictado()
  const [dictados, setDictados] = useState<Record<string, string>>({})
  const [sugerencias, setSugerencias] = useState<Record<string, Sugerencia>>({})
  const [valorIA, setValorIA] = useState<Record<string, string>>({})
  const [iaAceptada, setIaAceptada] = useState<Record<string, boolean>>({})

  // El dictado termina de forma asíncrona (cuando el navegador cierra el
  // micrófono): esta referencia le da acceso a las respuestas actuales.
  const respuestasRef = useRef<Respuestas>(respuestas)
  respuestasRef.current = respuestas

  // Id de esta carga: prefijo de las fotos subidas y client_uuid del envío
  // (clave única que evita duplicados si un envío se reintenta — Etapa 5).
  const wizardId = useMemo(() => generateId(), [])

  useEffect(() => {
    if (!formId) return
    let mounted = true

    async function cargar() {
      const { data: formData } = await supabase.from('forms').select('nombre').eq('id', formId).single()
      if (mounted && formData?.nombre) setFormularioNombre(formData.nombre)

      const { data: qData, error: qError } = await supabase
        .from('form_questions')
        .select('id, form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden')
        .eq('form_id', formId)
        .order('orden')

      if (!mounted) return

      if (qError) {
        setError(qError.message)
        setLoading(false)
        return
      }

      const preguntasCargadas = qData ?? []
      const ids = preguntasCargadas.map((q) => q.id)

      const { data: lData, error: lError } = ids.length
        ? await supabase
            .from('form_logic')
            .select('id, question_id, pregunta_origen_id, valor_esperado, accion')
            .in('question_id', ids)
        : { data: [] as LogicaCondicional[], error: null }

      if (!mounted) return

      if (lError) {
        setError(lError.message)
      } else {
        setPreguntas(preguntasCargadas)
        setLogica(lData ?? [])
      }
      setLoading(false)
    }

    cargar()
    return () => {
      mounted = false
    }
  }, [formId])

  const logicaPorPregunta = useMemo(() => {
    const map = new Map<string, LogicaCondicional[]>()
    for (const l of logica) {
      const arr = map.get(l.question_id) ?? []
      arr.push(l)
      map.set(l.question_id, arr)
    }
    return map
  }, [logica])

  function respuestaCoincide(preguntaOrigenId: string, valorEsperado: string): boolean {
    const val = respuestas[preguntaOrigenId]
    if (val == null) return false
    if (Array.isArray(val)) return val.includes(valorEsperado)
    return val === valorEsperado
  }

  function esVisible(pregunta: Pregunta): boolean {
    const reglas = logicaPorPregunta.get(pregunta.id) ?? []
    if (reglas.length === 0) return true // sin reglas = pregunta raíz, siempre visible

    const ocultarCoincide = reglas.some(
      (r) => r.accion === 'ocultar' && respuestaCoincide(r.pregunta_origen_id, r.valor_esperado),
    )
    if (ocultarCoincide) return false

    const reglasMostrar = reglas.filter((r) => r.accion === 'mostrar')
    if (reglasMostrar.length === 0) return true // solo había reglas de "ocultar" y ninguna aplicó

    return reglasMostrar.some((r) => respuestaCoincide(r.pregunta_origen_id, r.valor_esperado))
  }

  const preguntasVisibles = useMemo(
    () => preguntas.filter(esVisible),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preguntas, respuestas, logicaPorPregunta],
  )

  function setRespuesta(questionId: string, valor: string | string[]) {
    setRespuestas((prev) => ({ ...prev, [questionId]: valor }))
  }

  function quitarDe<T>(setter: (fn: (prev: Record<string, T>) => Record<string, T>) => void, ids: string[]) {
    setter((prev) => {
      if (!ids.some((id) => id in prev)) return prev
      const siguiente = { ...prev }
      for (const id of ids) delete siguiente[id]
      return siguiente
    })
  }

  // Cambio manual en un campo de texto/número/fecha: si había una sugerencia
  // de la IA para el texto anterior, deja de tener sentido.
  function cambiarManual(questionId: string, valor: string) {
    setRespuesta(questionId, valor)
    quitarDe(setSugerencias, [questionId])
  }

  function toggleMultiple(questionId: string, opcion: string, marcado: boolean) {
    setRespuestas((prev) => {
      const actual = Array.isArray(prev[questionId]) ? (prev[questionId] as string[]) : []
      const nuevo = marcado ? [...actual, opcion] : actual.filter((o) => o !== opcion)
      return { ...prev, [questionId]: nuevo }
    })
  }

  // si_no / seleccion_unica: una sola opción alcanza para responder, así que
  // se confirma (y se bloquea) en el mismo click.
  function seleccionarUnica(pregunta: Pregunta, valor: string) {
    setRespuesta(pregunta.id, valor)
    setConfirmadas((prev) => new Set(prev).add(pregunta.id))
    quitarDe(setSugerencias, [pregunta.id])
  }

  // seleccion_multiple: puede necesitar tildar varias opciones, así que acá
  // el bloqueo es un paso aparte ("Confirmar selección"), no automático.
  function confirmarMultiple(preguntaId: string) {
    setConfirmadas((prev) => new Set(prev).add(preguntaId))
    quitarDe(setSugerencias, [preguntaId])
  }

  // Toda pregunta que dependa (directa o indirectamente) de la respuesta de
  // `preguntaId` para decidir si se muestra u oculta.
  function idsDependientes(preguntaId: string): string[] {
    const directos = logica.filter((l) => l.pregunta_origen_id === preguntaId).map((l) => l.question_id)
    const todos = new Set(directos)
    for (const id of directos) {
      for (const nieto of idsDependientes(id)) todos.add(nieto)
    }
    return [...todos]
  }

  function editarRespuesta(preguntaId: string) {
    const dependientes = idsDependientes(preguntaId)

    // Al cambiar esta respuesta, todo lo que se había cargado más adelante
    // en base al valor anterior deja de tener sentido — se borra.
    setRespuestas((prev) => {
      const siguiente = { ...prev }
      for (const id of dependientes) delete siguiente[id]
      return siguiente
    })
    setConfirmadas((prev) => {
      const siguiente = new Set(prev)
      siguiente.delete(preguntaId)
      for (const id of dependientes) siguiente.delete(id)
      return siguiente
    })

    const afectados = [preguntaId, ...dependientes]
    quitarDe(setDictados, afectados)
    quitarDe(setSugerencias, afectados)
    quitarDe(setValorIA, afectados)
    quitarDe(setIaAceptada, afectados)

    window.requestAnimationFrame(() => {
      document.getElementById(`pregunta-${preguntaId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  // ---------------------------------------------------------------------------
  // Voz + IA (RF-06/07/08 y RF-36)
  // ---------------------------------------------------------------------------

  function lanzarInterpretacion(p: Pregunta, base: string) {
    const esTexto = TIPOS_TEXTO.includes(p.tipo_campo)
    setSugerencias((prev) => ({ ...prev, [p.id]: { estado: 'interpretando', base } }))

    interpretarRespuesta(p.id, base, p.tipo_campo).then((r) => {
      setSugerencias((prev) => {
        const actual = prev[p.id]
        if (!actual || actual.base !== base) return prev // quedó vieja: el técnico cambió algo
        const siguiente = { ...prev }

        if (r.estado === 'ok') {
          // Texto que ya estaba bien: no hace falta sugerir nada.
          if (esTexto && typeof r.valor === 'string' && r.valor.trim() === base.trim()) {
            delete siguiente[p.id]
          } else {
            siguiente[p.id] = { estado: 'lista', base, valor: r.valor }
          }
        } else if (esTexto) {
          // En textos, si la IA no responde se queda lo dictado y listo (RF-38).
          delete siguiente[p.id]
        } else {
          const motivo = r.estado === 'no_disponible' ? `${r.motivo} ` : 'No se pudo interpretar lo dictado. '
          siguiente[p.id] = { estado: 'sin_resultado', base, mensaje: `${motivo}Completalo a mano.` }
        }
        return siguiente
      })
    })
  }

  function alTerminarDictado(p: Pregunta, texto: string) {
    // Respuesta nueva: lo que la IA haya propuesto antes ya no corresponde.
    quitarDe(setValorIA, [p.id])
    quitarDe(setIaAceptada, [p.id])

    if (TIPOS_TEXTO.includes(p.tipo_campo)) {
      // Textos libres: lo dictado se suma a lo que ya había. Teléfono y email
      // se reemplazan (no tiene sentido concatenar dos teléfonos).
      const anterior = respuestasRef.current[p.id]
      const sumar =
        (p.tipo_campo === 'texto_corto' || p.tipo_campo === 'texto_largo') &&
        typeof anterior === 'string' &&
        anterior.trim() !== ''
      const nuevo = sumar ? `${(anterior as string).trim()} ${texto}` : texto

      setDictados((prev) => ({
        ...prev,
        [p.id]: sumar && prev[p.id] ? `${prev[p.id]} ${texto}` : texto,
      }))
      setRespuesta(p.id, nuevo)
      lanzarInterpretacion(p, nuevo)
      return
    }

    setDictados((prev) => ({ ...prev, [p.id]: texto }))

    if (TIPOS_OPCIONES.includes(p.tipo_campo)) {
      const local = coincidenciaLocal(opcionesDe(p), texto)
      if (local) {
        setSugerencias((prev) => ({
          ...prev,
          [p.id]: { estado: 'lista', base: texto, valor: p.tipo_campo === 'seleccion_multiple' ? [local] : local },
        }))
        return
      }
    }

    lanzarInterpretacion(p, texto)
  }

  function aceptarSugerencia(p: Pregunta) {
    const s = sugerencias[p.id]
    if (!s || s.estado !== 'lista') return
    const v = s.valor

    if (p.tipo_campo === 'si_no' || p.tipo_campo === 'seleccion_unica') {
      seleccionarUnica(p, comoTexto(v))
    } else if (p.tipo_campo === 'seleccion_multiple') {
      setRespuesta(p.id, Array.isArray(v) ? v : [v])
      confirmarMultiple(p.id)
    } else {
      setRespuesta(p.id, comoTexto(v))
    }

    setValorIA((prev) => ({ ...prev, [p.id]: comoTexto(v) }))
    setIaAceptada((prev) => ({ ...prev, [p.id]: true }))
    quitarDe(setSugerencias, [p.id])
  }

  function descartarSugerencia(p: Pregunta) {
    const s = sugerencias[p.id]
    if (s?.estado === 'lista') {
      setValorIA((prev) => ({ ...prev, [p.id]: comoTexto(s.valor) }))
      setIaAceptada((prev) => ({ ...prev, [p.id]: false }))
    }
    quitarDe(setSugerencias, [p.id])
  }

  function renderBotonDictar(p: Pregunta) {
    if (p.tipo_campo === 'foto' || dictado.motivoNoDisponible) return null
    if (TIPOS_OPCIONES.includes(p.tipo_campo) && confirmadas.has(p.id)) return null

    const escuchando = dictado.activoId === p.id
    return (
      <button
        type="button"
        className={escuchando ? 'btn-dictar escuchando' : 'btn-dictar'}
        aria-label={escuchando ? 'Detener dictado' : `Dictar respuesta: ${p.texto_pregunta}`}
        onClick={() =>
          escuchando
            ? dictado.detener()
            : dictado.iniciar(p.id, {
                continuo: p.tipo_campo === 'texto_largo',
                alTerminar: (texto) => alTerminarDictado(p, texto),
              })
        }
      >
        {escuchando ? '■ Detener' : '🎤 Dictar'}
      </button>
    )
  }

  function renderAsistenciaVoz(p: Pregunta) {
    const escuchando = dictado.activoId === p.id
    const errorVoz = dictado.error?.id === p.id ? dictado.error.mensaje : null
    const s = sugerencias[p.id]
    const esTexto = TIPOS_TEXTO.includes(p.tipo_campo)
    const esOpciones = TIPOS_OPCIONES.includes(p.tipo_campo)
    const dicho = dictados[p.id]

    if (!escuchando && !errorVoz && !s && (esTexto || !dicho)) return null

    return (
      <div className="asistencia-voz">
        {escuchando && (
          <div className="voz-escuchando">
            Escuchando…{dictado.parcial && <> «{dictado.parcial}»</>}
          </div>
        )}
        {errorVoz && <div className="hint voz-error">{errorVoz}</div>}
        {!escuchando && !esTexto && dicho && <div className="hint">Dictado: «{dicho}»</div>}

        {s?.estado === 'interpretando' && <div className="hint ia-interpretando">Interpretando…</div>}

        {s?.estado === 'sin_resultado' && <div className="hint">{s.mensaje}</div>}

        {s?.estado === 'lista' && (
          <div className="sugerencia-ia">
            {esOpciones ? (
              <span>
                ¿Quisiste decir: <strong>{comoTexto(s.valor)}</strong>?
              </span>
            ) : esTexto && p.tipo_campo !== 'telefono' && p.tipo_campo !== 'email' ? (
              <>
                <span className="sugerencia-etiqueta">Corrección sugerida:</span>
                <span className="sugerencia-texto">{comoTexto(s.valor)}</span>
              </>
            ) : (
              <span>
                Valor interpretado: <strong>{comoTexto(s.valor)}</strong>
              </span>
            )}
            <div className="sugerencia-acciones">
              <button type="button" className="btn-secondary btn-sm" onClick={() => aceptarSugerencia(p)}>
                {esOpciones ? 'Confirmar' : 'Usar'}
              </button>
              <button type="button" className="btn-link" onClick={() => descartarSugerencia(p)}>
                Descartar
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Fotos, validación y envío
  // ---------------------------------------------------------------------------

  async function handleFoto(pregunta: Pregunta, file: File | null) {
    if (!file) return
    setSubiendoArchivo(pregunta.id)
    setEnvioError(null)

    const ruta = `${wizardId}/${pregunta.codigo}-${file.name}`
    const { error: uploadError } = await supabase.storage
      .from('submissions')
      .upload(ruta, file, { upsert: true })

    setSubiendoArchivo(null)

    if (uploadError) {
      setEnvioError(
        `No se pudo subir la foto de "${pregunta.texto_pregunta}": ${uploadError.message}. ` +
          'Puede que falte crear el bucket "submissions" en Supabase Storage.',
      )
      return
    }

    const { data: pub } = supabase.storage.from('submissions').getPublicUrl(ruta)
    setRespuesta(pregunta.id, pub.publicUrl)
  }

  function validar(): string | null {
    for (const p of preguntasVisibles) {
      if (!p.obligatorio) continue
      const val = respuestas[p.id]
      const vacio = val == null || (Array.isArray(val) ? val.length === 0 : val.trim() === '')
      if (vacio) {
        return `Falta responder: "${p.texto_pregunta}"`
      }
      if (p.tipo_campo === 'seleccion_multiple' && !confirmadas.has(p.id)) {
        return `Confirmá la selección de: "${p.texto_pregunta}"`
      }
    }
    return null
  }

  async function handleEnviar() {
    const problema = validar()
    if (problema) {
      setEnvioError(problema)
      return
    }

    dictado.detener()

    if (modoPrueba) {
      setCodigoSeguimiento('PRUEBA')
      return
    }

    if (!profile || !formId) return

    setEnviando(true)
    setEnvioError(null)

    const codigo = generarCodigoSeguimiento()

    const { data: submission, error: subError } = await supabase
      .from('submissions')
      .insert({
        form_id: formId,
        enviado_por: profile.id,
        cliente: cliente.trim() || null,
        codigo_seguimiento: codigo,
        client_uuid: wizardId,
        // Hoy toda la interpretación (RF-36) ocurre durante la carga, así que
        // el envío llega ya completo. Cuando existan RF-37 (resumen) y el modo
        // offline, se va a mandar 'recibido' y el servidor lo hará avanzar.
        processing_status: 'completo',
      })
      .select('id')
      .single()

    if (subError || !submission) {
      setEnviando(false)
      setEnvioError(subError?.message ?? 'No se pudo crear el envío.')
      return
    }

    const filas = preguntasVisibles
      .filter((p) => respuestas[p.id] != null)
      .map((p) => {
        const val = respuestas[p.id]
        const esFoto = p.tipo_campo === 'foto'
        // Una sugerencia que quedó en pantalla sin usar cuenta como no aceptada.
        // Si todavía estaba "interpretando", se ignora: el envío no espera a la IA (RF-38).
        const pendiente = sugerencias[p.id]
        const sugerida = pendiente?.estado === 'lista' ? comoTexto(pendiente.valor) : null
        return {
          submission_id: submission.id,
          question_id: p.id,
          valor: esFoto ? null : Array.isArray(val) ? val.join(', ') : val,
          archivo_url: esFoto ? (val as string) : null,
          valor_dictado: dictados[p.id] ?? null,
          valor_ia: valorIA[p.id] ?? sugerida,
          ia_aceptada: iaAceptada[p.id] ?? (sugerida != null ? false : null),
        }
      })

    if (filas.length > 0) {
      const { error: ansError } = await supabase.from('submission_answers').insert(filas)
      if (ansError) {
        setEnviando(false)
        setEnvioError(
          `El envío se creó (código ${codigo}) pero hubo un problema guardando las respuestas: ${ansError.message}`,
        )
        return
      }
    }

    setEnviando(false)
    setCodigoSeguimiento(codigo)
  }

  function renderCampo(p: Pregunta) {
    const valor = respuestas[p.id]

    switch (p.tipo_campo) {
      case 'texto_corto':
      case 'telefono':
      case 'email':
        return (
          <input
            type={p.tipo_campo === 'email' ? 'email' : p.tipo_campo === 'telefono' ? 'tel' : 'text'}
            value={(valor as string) ?? ''}
            onChange={(e) => cambiarManual(p.id, e.target.value)}
          />
        )
      case 'texto_largo':
        return (
          <textarea
            value={(valor as string) ?? ''}
            onChange={(e) => cambiarManual(p.id, e.target.value)}
          />
        )
      case 'numero':
        return (
          <input
            type="number"
            value={(valor as string) ?? ''}
            onChange={(e) => cambiarManual(p.id, e.target.value)}
          />
        )
      case 'fecha':
        return (
          <input
            type="date"
            value={(valor as string) ?? ''}
            onChange={(e) => cambiarManual(p.id, e.target.value)}
          />
        )
      case 'si_no': {
        const confirmada = confirmadas.has(p.id)
        return (
          <div className="campo-opciones-confirmable">
            <div className="opciones-radio">
              {['Sí', 'No'].map((op) => (
                <label key={op} className={confirmada ? 'opcion-deshabilitada' : undefined}>
                  <input
                    type="radio"
                    name={p.id}
                    checked={valor === op}
                    disabled={confirmada}
                    onChange={() => seleccionarUnica(p, op)}
                  />
                  {op}
                </label>
              ))}
            </div>
            {confirmada && (
              <button type="button" className="btn-link" onClick={() => editarRespuesta(p.id)}>
                Cambiar respuesta
              </button>
            )}
          </div>
        )
      }
      case 'seleccion_unica': {
        const confirmada = confirmadas.has(p.id)
        return (
          <div className="campo-opciones-confirmable">
            <div className="opciones-radio">
              {(p.opciones ?? []).map((op) => (
                <label key={op} className={confirmada ? 'opcion-deshabilitada' : undefined}>
                  <input
                    type="radio"
                    name={p.id}
                    checked={valor === op}
                    disabled={confirmada}
                    onChange={() => seleccionarUnica(p, op)}
                  />
                  {op}
                </label>
              ))}
            </div>
            {confirmada && (
              <button type="button" className="btn-link" onClick={() => editarRespuesta(p.id)}>
                Cambiar respuesta
              </button>
            )}
          </div>
        )
      }
      case 'seleccion_multiple': {
        const confirmada = confirmadas.has(p.id)
        const hayAlgunaMarcada = Array.isArray(valor) && valor.length > 0
        return (
          <div className="campo-opciones-confirmable">
            <div className="opciones-check">
              {(p.opciones ?? []).map((op) => (
                <label key={op} className={confirmada ? 'opcion-deshabilitada' : undefined}>
                  <input
                    type="checkbox"
                    checked={Array.isArray(valor) && valor.includes(op)}
                    disabled={confirmada}
                    onChange={(e) => toggleMultiple(p.id, op, e.target.checked)}
                  />
                  {op}
                </label>
              ))}
            </div>
            {!confirmada && (
              <button
                type="button"
                className="btn-link"
                onClick={() => confirmarMultiple(p.id)}
                disabled={!hayAlgunaMarcada}
              >
                Confirmar selección
              </button>
            )}
            {confirmada && (
              <button type="button" className="btn-link" onClick={() => editarRespuesta(p.id)}>
                Cambiar respuesta
              </button>
            )}
          </div>
        )
      }
      case 'foto':
        return (
          <div className="campo-foto">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleFoto(p, e.target.files?.[0] ?? null)}
            />
            {subiendoArchivo === p.id && <span className="hint">Subiendo…</span>}
            {typeof valor === 'string' && valor && <span className="hint">✓ foto cargada</span>}
          </div>
        )
      default:
        return null
    }
  }

  if (loading) return <p>Cargando formulario…</p>
  if (error) return <div className="alert alert-error">{error}</div>

  if (codigoSeguimiento) {
    const lineasReporte = preguntasVisibles
      .filter((p) => respuestas[p.id] != null)
      .map((p) => {
        const val = respuestas[p.id]
        const respuesta =
          p.tipo_campo === 'foto'
            ? typeof val === 'string' && val
              ? '[Foto adjunta]'
              : '—'
            : Array.isArray(val)
              ? val.join(', ')
              : val
        return { codigo: p.codigo, texto_pregunta: p.texto_pregunta, respuesta: respuesta || '—' }
      })

    const textoReporte = generarReporteTexto({
      formularioNombre,
      tecnicoNombre: profile?.nombre ?? '—',
      cliente: cliente.trim() || null,
      fecha: new Date(),
      codigoSeguimiento: modoPrueba ? 'PRUEBA — no se envió' : codigoSeguimiento,
      lineas: lineasReporte,
    })

    return (
      <div className="confirmacion">
        {modoPrueba ? (
          <>
            <h1>Prueba completa</h1>
            <p className="subtitle">
              El recorrido llegó hasta el final respetando la lógica condicional. No se guardó ningún envío real.
            </p>
          </>
        ) : (
          <>
            <h1>¡Envío registrado!</h1>
            <p className="subtitle">Guardá este código de seguimiento:</p>
            <div className="codigo-seguimiento">{codigoSeguimiento}</div>
          </>
        )}

        <div style={{ textAlign: 'left', maxWidth: 560, margin: '24px auto' }}>
          <ReporteImpresion texto={textoReporte} />
        </div>

        <button className="btn-primary no-imprimir" onClick={() => navigate(volverA)}>
          {modoPrueba ? 'Volver al editor' : 'Volver a formularios'}
        </button>
      </div>
    )
  }

  return (
    <div className="wizard">
      <button className="btn-link" onClick={() => navigate(volverA)}>
        ← Volver
      </button>
      <h1>Cargar informe</h1>

      {modoPrueba && (
        <div className="alert alert-info">
          Modo prueba — estás viendo el formulario como lo vería un técnico. Nada de esto se guarda.
        </div>
      )}

      {dictado.motivoNoDisponible && <div className="alert alert-info">{dictado.motivoNoDisponible}</div>}

      <div className="campo">
        <span className="campo-titulo">Cliente (opcional)</span>
        <input type="text" value={cliente} onChange={(e) => setCliente(e.target.value)} />
      </div>

      {preguntasVisibles.map((p) => (
        <div key={p.id} id={`pregunta-${p.id}`} className="campo">
          <div className="campo-encabezado">
            <span className="campo-titulo">
              {p.texto_pregunta}
              {p.obligatorio && <span className="requerido"> *</span>}
            </span>
            {renderBotonDictar(p)}
          </div>
          {renderCampo(p)}
          {renderAsistenciaVoz(p)}
        </div>
      ))}

      {envioError && <div className="alert alert-error">{envioError}</div>}

      <button className="btn-primary" onClick={handleEnviar} disabled={enviando}>
        {enviando ? 'Enviando…' : 'Enviar'}
      </button>
    </div>
  )
}
