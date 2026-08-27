import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/AuthContext'
import { generateId } from '../../lib/uuid'
import type { LogicaCondicional, Pregunta } from '../../lib/types'

type Respuestas = Record<string, string | string[]>

function generarCodigoSeguimiento(): string {
  const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const azar = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `ST-${fecha}-${azar}`
}

/**
 * v1 del wizard (RF-19 a RF-21 en su forma más simple): renderiza las
 * preguntas de form_questions en orden, respetando la ramificación de
 * form_logic, y crea submission + submission_answers al enviar.
 *
 * A propósito NO incluye todavía: voz (RF-06/07/08), interpretación por IA
 * (RF-36/37/38, ver supabase/functions/ping-ia/ para la PoC de eso), ni modo
 * offline (Etapa 5). Es la base funcional sobre la que se suman esas capas.
 */
export function TecnicoWizard() {
  const { formId } = useParams<{ formId: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [preguntas, setPreguntas] = useState<Pregunta[]>([])
  const [logica, setLogica] = useState<LogicaCondicional[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [cliente, setCliente] = useState('')
  const [respuestas, setRespuestas] = useState<Respuestas>({})
  const [subiendoArchivo, setSubiendoArchivo] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [envioError, setEnvioError] = useState<string | null>(null)
  const [codigoSeguimiento, setCodigoSeguimiento] = useState<string | null>(null)

  // Prefijo estable para organizar las fotos subidas durante esta carga,
  // aunque la submission todavía no exista (se crea recién al enviar).
  const wizardId = useMemo(() => generateId(), [])

  useEffect(() => {
    if (!formId) return
    let mounted = true

    async function cargar() {
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

  function toggleMultiple(questionId: string, opcion: string, marcado: boolean) {
    setRespuestas((prev) => {
      const actual = Array.isArray(prev[questionId]) ? (prev[questionId] as string[]) : []
      const nuevo = marcado ? [...actual, opcion] : actual.filter((o) => o !== opcion)
      return { ...prev, [questionId]: nuevo }
    })
  }

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
    }
    return null
  }

  async function handleEnviar() {
    const problema = validar()
    if (problema) {
      setEnvioError(problema)
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
        return {
          submission_id: submission.id,
          question_id: p.id,
          valor: esFoto ? null : Array.isArray(val) ? val.join(', ') : val,
          archivo_url: esFoto ? (val as string) : null,
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
            onChange={(e) => setRespuesta(p.id, e.target.value)}
          />
        )
      case 'texto_largo':
        return (
          <textarea
            value={(valor as string) ?? ''}
            onChange={(e) => setRespuesta(p.id, e.target.value)}
          />
        )
      case 'numero':
        return (
          <input
            type="number"
            value={(valor as string) ?? ''}
            onChange={(e) => setRespuesta(p.id, e.target.value)}
          />
        )
      case 'fecha':
        return (
          <input
            type="date"
            value={(valor as string) ?? ''}
            onChange={(e) => setRespuesta(p.id, e.target.value)}
          />
        )
      case 'si_no':
        return (
          <div className="opciones-radio">
            {['Sí', 'No'].map((op) => (
              <label key={op}>
                <input
                  type="radio"
                  name={p.id}
                  checked={valor === op}
                  onChange={() => setRespuesta(p.id, op)}
                />
                {op}
              </label>
            ))}
          </div>
        )
      case 'seleccion_unica':
        return (
          <div className="opciones-radio">
            {(p.opciones ?? []).map((op) => (
              <label key={op}>
                <input
                  type="radio"
                  name={p.id}
                  checked={valor === op}
                  onChange={() => setRespuesta(p.id, op)}
                />
                {op}
              </label>
            ))}
          </div>
        )
      case 'seleccion_multiple':
        return (
          <div className="opciones-check">
            {(p.opciones ?? []).map((op) => (
              <label key={op}>
                <input
                  type="checkbox"
                  checked={Array.isArray(valor) && valor.includes(op)}
                  onChange={(e) => toggleMultiple(p.id, op, e.target.checked)}
                />
                {op}
              </label>
            ))}
          </div>
        )
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
    return (
      <div className="confirmacion">
        <h1>¡Envío registrado!</h1>
        <p className="subtitle">Guardá este código de seguimiento:</p>
        <div className="codigo-seguimiento">{codigoSeguimiento}</div>
        <button className="btn-primary" onClick={() => navigate('/tecnico')}>
          Volver a formularios
        </button>
      </div>
    )
  }

  return (
    <div className="wizard">
      <button className="btn-link" onClick={() => navigate('/tecnico')}>
        ← Volver
      </button>
      <h1>Cargar informe</h1>

      <div className="campo">
        <span className="campo-titulo">Cliente (opcional)</span>
        <input type="text" value={cliente} onChange={(e) => setCliente(e.target.value)} />
      </div>

      {preguntasVisibles.map((p) => (
        <div key={p.id} className="campo">
          <span className="campo-titulo">
            {p.texto_pregunta}
            {p.obligatorio && <span className="requerido"> *</span>}
          </span>
          {renderCampo(p)}
        </div>
      ))}

      {envioError && <div className="alert alert-error">{envioError}</div>}

      <button className="btn-primary" onClick={handleEnviar} disabled={enviando}>
        {enviando ? 'Enviando…' : 'Enviar'}
      </button>
    </div>
  )
}
