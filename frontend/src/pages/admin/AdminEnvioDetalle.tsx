import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import type { Pregunta, Submission, SubmissionAnswer, SubmissionEstado } from '../../lib/types'

const ESTADOS: { value: SubmissionEstado; label: string }[] = [
  { value: 'nuevo', label: 'Nuevo' },
  { value: 'en_revision', label: 'En revisión' },
  { value: 'aprobado', label: 'Aprobado' },
  { value: 'rechazado', label: 'Rechazado' },
]

const TIPOS_CAMPO_LABEL: Record<string, string> = {
  texto_corto: 'Texto corto',
  texto_largo: 'Texto largo',
  numero: 'Número',
  seleccion_unica: 'Selección única',
  seleccion_multiple: 'Selección múltiple',
  si_no: 'Sí / No',
  telefono: 'Teléfono',
  email: 'Email',
  fecha: 'Fecha',
  foto: 'Foto',
}

type EdicionRespuesta = {
  valor: string | string[]
  archivo_url: string | null
}

function valorInicial(p: Pregunta, r: SubmissionAnswer | undefined): EdicionRespuesta {
  if (p.tipo_campo === 'foto') {
    return { valor: '', archivo_url: r?.archivo_url ?? null }
  }
  if (p.tipo_campo === 'seleccion_multiple') {
    const partes = r?.valor
      ? r.valor
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
    return { valor: partes, archivo_url: null }
  }
  return { valor: r?.valor ?? '', archivo_url: null }
}

/**
 * Ver, editar y eliminar un envío puntual — el administrador entra acá desde
 * la fila del código de seguimiento en AdminEnvios. Solo se muestran las
 * preguntas que realmente tienen una respuesta guardada (lo que el técnico
 * completó), no todo el cuestionario del formulario: reconstruir qué
 * preguntas hubieran estado visibles según la lógica condicional no aporta
 * nada acá, ya que lo que importa es corregir lo que efectivamente se cargó.
 */
export function AdminEnvioDetalle() {
  const { submissionId } = useParams<{ submissionId: string }>()
  const navigate = useNavigate()

  const [submission, setSubmission] = useState<Submission | null>(null)
  const [formularioNombre, setFormularioNombre] = useState('—')
  const [tecnico, setTecnico] = useState<{ nombre: string; email: string } | null>(null)
  const [preguntas, setPreguntas] = useState<Pregunta[]>([])
  const [respuestasOriginales, setRespuestasOriginales] = useState<SubmissionAnswer[]>([])
  const [edicion, setEdicion] = useState<Record<string, EdicionRespuesta>>({})

  const [cliente, setCliente] = useState('')
  const [estado, setEstado] = useState<SubmissionEstado>('nuevo')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subiendoArchivo, setSubiendoArchivo] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [guardadoOk, setGuardadoOk] = useState(false)
  const [borrando, setBorrando] = useState(false)

  function cargarTodo() {
    if (!submissionId) return
    setLoading(true)
    setError(null)

    supabase
      .from('submissions')
      .select('id, form_id, enviado_por, cliente, estado, codigo_seguimiento, created_at')
      .eq('id', submissionId)
      .single()
      .then(async ({ data: sub, error: subError }) => {
        if (subError || !sub) {
          setError(subError?.message ?? 'No se encontró el envío.')
          setLoading(false)
          return
        }
        setSubmission(sub)
        setCliente(sub.cliente ?? '')
        setEstado(sub.estado)

        const [{ data: form }, { data: perfil }, { data: respuestas }] = await Promise.all([
          supabase.from('forms').select('nombre').eq('id', sub.form_id).single(),
          supabase.from('profiles').select('nombre, email').eq('id', sub.enviado_por).single(),
          supabase
            .from('submission_answers')
            .select('id, submission_id, question_id, valor, archivo_url')
            .eq('submission_id', sub.id),
        ])

        setFormularioNombre(form?.nombre ?? '—')
        setTecnico(perfil ? { nombre: perfil.nombre, email: perfil.email } : null)

        const respuestasCargadas = respuestas ?? []
        setRespuestasOriginales(respuestasCargadas)

        const preguntaIds = respuestasCargadas.map((r) => r.question_id)
        if (preguntaIds.length === 0) {
          setPreguntas([])
          setEdicion({})
          setLoading(false)
          return
        }

        const { data: preguntasData, error: preguntasError } = await supabase
          .from('form_questions')
          .select('id, form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden')
          .in('id', preguntaIds)
          .order('orden', { ascending: true })

        if (preguntasError) {
          setError(preguntasError.message)
          setLoading(false)
          return
        }

        const preguntasCargadas = preguntasData ?? []
        setPreguntas(preguntasCargadas)

        const respuestasPorPregunta = new Map(respuestasCargadas.map((r) => [r.question_id, r]))
        const edicionInicial: Record<string, EdicionRespuesta> = {}
        for (const p of preguntasCargadas) {
          edicionInicial[p.id] = valorInicial(p, respuestasPorPregunta.get(p.id))
        }
        setEdicion(edicionInicial)
        setLoading(false)
      })
  }

  useEffect(cargarTodo, [submissionId])

  const respuestaIdPorPregunta = useMemo(
    () => new Map(respuestasOriginales.map((r) => [r.question_id, r.id])),
    [respuestasOriginales],
  )

  function setValor(preguntaId: string, valor: string | string[]) {
    setEdicion((prev) => ({ ...prev, [preguntaId]: { ...prev[preguntaId], valor } }))
  }

  function toggleMultiple(preguntaId: string, opcion: string, marcado: boolean) {
    setEdicion((prev) => {
      const actual = Array.isArray(prev[preguntaId]?.valor) ? (prev[preguntaId].valor as string[]) : []
      const nuevo = marcado ? [...actual, opcion] : actual.filter((o) => o !== opcion)
      return { ...prev, [preguntaId]: { ...prev[preguntaId], valor: nuevo } }
    })
  }

  async function handleFoto(pregunta: Pregunta, file: File | null) {
    if (!file || !submissionId) return
    setSubiendoArchivo(pregunta.id)
    setError(null)

    const ruta = `${submissionId}/${pregunta.codigo}-${file.name}`
    const { error: uploadError } = await supabase.storage.from('submissions').upload(ruta, file, { upsert: true })

    setSubiendoArchivo(null)
    if (uploadError) {
      setError(`No se pudo subir la foto de "${pregunta.texto_pregunta}": ${uploadError.message}`)
      return
    }

    const { data: pub } = supabase.storage.from('submissions').getPublicUrl(ruta)
    setEdicion((prev) => ({ ...prev, [pregunta.id]: { valor: '', archivo_url: pub.publicUrl } }))
  }

  async function handleGuardar() {
    if (!submissionId) return
    setGuardando(true)
    setGuardadoOk(false)
    setError(null)

    const { error: subError } = await supabase
      .from('submissions')
      .update({ cliente: cliente.trim() || null, estado })
      .eq('id', submissionId)

    const resultadosRespuestas = await Promise.all(
      preguntas.map((p) => {
        const respuestaId = respuestaIdPorPregunta.get(p.id)
        if (!respuestaId) return Promise.resolve({ error: null })
        const ed = edicion[p.id]
        const esFoto = p.tipo_campo === 'foto'
        const valor = esFoto ? null : Array.isArray(ed.valor) ? ed.valor.join(', ') : ed.valor
        return supabase
          .from('submission_answers')
          .update({ valor, archivo_url: esFoto ? ed.archivo_url : null })
          .eq('id', respuestaId)
      }),
    )

    setGuardando(false)
    const errorRespuesta = resultadosRespuestas.find((r) => r.error)?.error
    if (subError || errorRespuesta) {
      setError(subError?.message ?? errorRespuesta?.message ?? 'No se pudo guardar.')
      return
    }
    setGuardadoOk(true)
    setTimeout(() => setGuardadoOk(false), 2500)
    cargarTodo()
  }

  async function handleEliminar() {
    if (!submission) return
    if (!confirm(`¿Eliminar el envío "${submission.codigo_seguimiento}"? Esta acción no se puede deshacer.`)) return
    setBorrando(true)
    const { error: answersError } = await supabase
      .from('submission_answers')
      .delete()
      .eq('submission_id', submission.id)
    if (answersError) {
      setBorrando(false)
      alert(`No se pudo eliminar: ${answersError.message}`)
      return
    }
    const { error: deleteError } = await supabase.from('submissions').delete().eq('id', submission.id)
    setBorrando(false)
    if (deleteError) {
      alert(`No se pudo eliminar: ${deleteError.message}`)
      return
    }
    navigate('/admin/envios')
  }

  function renderCampoEditable(p: Pregunta) {
    const ed = edicion[p.id]
    if (!ed) return null

    switch (p.tipo_campo) {
      case 'texto_corto':
      case 'telefono':
      case 'email':
        return (
          <input
            type={p.tipo_campo === 'email' ? 'email' : p.tipo_campo === 'telefono' ? 'tel' : 'text'}
            value={(ed.valor as string) ?? ''}
            onChange={(e) => setValor(p.id, e.target.value)}
          />
        )
      case 'texto_largo':
        return <textarea value={(ed.valor as string) ?? ''} onChange={(e) => setValor(p.id, e.target.value)} />
      case 'numero':
        return (
          <input type="number" value={(ed.valor as string) ?? ''} onChange={(e) => setValor(p.id, e.target.value)} />
        )
      case 'fecha':
        return <input type="date" value={(ed.valor as string) ?? ''} onChange={(e) => setValor(p.id, e.target.value)} />
      case 'si_no':
        return (
          <div className="opciones-radio">
            {['Sí', 'No'].map((op) => (
              <label key={op}>
                <input type="radio" name={p.id} checked={ed.valor === op} onChange={() => setValor(p.id, op)} />
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
                <input type="radio" name={p.id} checked={ed.valor === op} onChange={() => setValor(p.id, op)} />
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
                  checked={Array.isArray(ed.valor) && ed.valor.includes(op)}
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
            {ed.archivo_url && (
              <a href={ed.archivo_url} target="_blank" rel="noreferrer">
                <img src={ed.archivo_url} alt={p.texto_pregunta} style={{ maxWidth: 160, borderRadius: 8 }} />
              </a>
            )}
            <input type="file" accept="image/*" onChange={(e) => handleFoto(p, e.target.files?.[0] ?? null)} />
            {subiendoArchivo === p.id && <span className="hint">Subiendo…</span>}
          </div>
        )
      default:
        return null
    }
  }

  if (loading) return <p>Cargando envío…</p>
  if (error && !submission) return <div className="alert alert-error">{error}</div>
  if (!submission) return null

  return (
    <div>
      <p>
        <Link to="/admin/envios" className="btn-link">
          ← Volver a envíos
        </Link>
      </p>
      <h1>
        <code>{submission.codigo_seguimiento}</code>
      </h1>

      {error && <div className="alert alert-error">{error}</div>}

      <h2>Datos generales</h2>
      <div className="inline-form">
        <div className="campo">
          <span className="campo-titulo">Formulario</span>
          <span>{formularioNombre}</span>
        </div>
        <div className="campo">
          <span className="campo-titulo">Técnico</span>
          <span>{tecnico ? `${tecnico.nombre} (${tecnico.email})` : '—'}</span>
        </div>
        <div className="campo">
          <span className="campo-titulo">Fecha</span>
          <span>{new Date(submission.created_at).toLocaleString('es-AR')}</span>
        </div>
        <div className="campo">
          <label className="campo-titulo" htmlFor="cliente-envio">
            Cliente
          </label>
          <input id="cliente-envio" type="text" value={cliente} onChange={(e) => setCliente(e.target.value)} />
        </div>
        <div className="campo">
          <label className="campo-titulo" htmlFor="estado-envio">
            Estado
          </label>
          <select id="estado-envio" value={estado} onChange={(e) => setEstado(e.target.value as SubmissionEstado)}>
            {ESTADOS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <h2>Respuestas ({preguntas.length})</h2>
      {preguntas.length === 0 && <p className="hint">Este envío no tiene respuestas guardadas.</p>}

      {preguntas.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Pregunta</th>
              <th className="celda-nowrap">Tipo</th>
              <th>Respuesta</th>
            </tr>
          </thead>
          <tbody>
            {preguntas.map((p) => (
              <tr key={p.id}>
                <td>{p.codigo}</td>
                <td>{p.texto_pregunta}</td>
                <td className="celda-nowrap">{TIPOS_CAMPO_LABEL[p.tipo_campo] ?? p.tipo_campo}</td>
                <td>{renderCampoEditable(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="acciones-fila" style={{ marginTop: 20 }}>
        <button className="btn-primary" onClick={handleGuardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
        {guardadoOk && <span className="hint hint-ok">Guardado.</span>}
      </div>

      <p style={{ marginTop: 32 }}>
        <button className="btn-link btn-link-danger" onClick={handleEliminar} disabled={borrando}>
          {borrando ? 'Eliminando…' : 'Eliminar este envío'}
        </button>
      </p>
    </div>
  )
}
