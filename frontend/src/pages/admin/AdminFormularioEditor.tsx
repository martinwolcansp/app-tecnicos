import { Fragment, useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { Modal } from '../../components/Modal'
import type { Formulario, FormularioEstado, LogicaCondicional, Pregunta, TipoCampo } from '../../lib/types'

const TIPOS_CAMPO: { value: TipoCampo; label: string }[] = [
  { value: 'texto_corto', label: 'Texto corto' },
  { value: 'texto_largo', label: 'Texto largo' },
  { value: 'numero', label: 'Número' },
  { value: 'seleccion_unica', label: 'Selección única' },
  { value: 'seleccion_multiple', label: 'Selección múltiple' },
  { value: 'si_no', label: 'Sí / No' },
  { value: 'telefono', label: 'Teléfono' },
  { value: 'email', label: 'Email' },
  { value: 'fecha', label: 'Fecha' },
  { value: 'foto', label: 'Foto' },
]

const TIPOS_CON_OPCIONES: TipoCampo[] = ['seleccion_unica', 'seleccion_multiple']

type PreguntaFormState = {
  codigo: string
  seccion: string
  texto_pregunta: string
  tipo_campo: TipoCampo
  obligatorio: boolean
  opcionesTexto: string // una opción por línea
  orden: number
}

const PREGUNTA_VACIA: PreguntaFormState = {
  codigo: '',
  seccion: '',
  texto_pregunta: '',
  tipo_campo: 'texto_corto',
  obligatorio: true,
  opcionesTexto: '',
  orden: 0,
}

/**
 * Editor de un formulario: datos generales + CRUD de preguntas (RF-06 a
 * RF-10) + lógica condicional entre preguntas (RF-13, RF-14). Reemplaza la
 * carga manual por seed.sql que usamos para el formulario piloto.
 */
export function AdminFormularioEditor() {
  const { formId } = useParams<{ formId: string }>()

  const [formulario, setFormulario] = useState<Formulario | null>(null)
  const [preguntas, setPreguntas] = useState<Pregunta[]>([])
  const [logica, setLogica] = useState<LogicaCondicional[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Datos generales del formulario
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [estado, setEstado] = useState<FormularioEstado>('borrador')
  const [guardandoDatos, setGuardandoDatos] = useState(false)
  const [datosGuardadosOk, setDatosGuardadosOk] = useState(false)

  // Alta/edición de pregunta
  const [preguntaEnEdicion, setPreguntaEnEdicion] = useState<Pregunta | 'nueva' | null>(null)
  const [preguntaForm, setPreguntaForm] = useState<PreguntaFormState>(PREGUNTA_VACIA)
  const [guardandoPregunta, setGuardandoPregunta] = useState(false)
  const [preguntaError, setPreguntaError] = useState<string | null>(null)
  const [borrandoPreguntaId, setBorrandoPreguntaId] = useState<string | null>(null)

  // Reordenar preguntas (arrastrar y soltar, con flechas como alternativa
  // accesible / para pantallas táctiles donde el drag nativo no anda bien)
  const [arrastrandoId, setArrastrandoId] = useState<string | null>(null)
  const [sobreId, setSobreId] = useState<string | null>(null)
  const [guardandoOrden, setGuardandoOrden] = useState(false)

  // Panel de lógica condicional expandido para una pregunta
  const [logicaAbiertaPara, setLogicaAbiertaPara] = useState<string | null>(null)
  const [nuevaLogicaOrigen, setNuevaLogicaOrigen] = useState('')
  const [nuevaLogicaValor, setNuevaLogicaValor] = useState('')
  const [nuevaLogicaAccion, setNuevaLogicaAccion] = useState<'mostrar' | 'ocultar'>('mostrar')
  const [guardandoLogica, setGuardandoLogica] = useState(false)

  function cargarTodo() {
    if (!formId) return
    setLoading(true)
    setError(null)

    supabase
      .from('forms')
      .select('id, nombre, descripcion, estado, created_at')
      .eq('id', formId)
      .single()
      .then(async ({ data: formData, error: formError }) => {
        if (formError || !formData) {
          setError(formError?.message ?? 'No se encontró el formulario.')
          setLoading(false)
          return
        }
        setFormulario(formData)
        setNombre(formData.nombre)
        setDescripcion(formData.descripcion ?? '')
        setEstado(formData.estado)

        const { data: preguntasData, error: preguntasError } = await supabase
          .from('form_questions')
          .select('id, form_id, codigo, seccion, texto_pregunta, tipo_campo, obligatorio, opciones, orden')
          .eq('form_id', formId)
          .order('orden', { ascending: true })

        if (preguntasError) {
          setError(preguntasError.message)
          setLoading(false)
          return
        }
        setPreguntas(preguntasData ?? [])

        const ids = (preguntasData ?? []).map((p) => p.id)
        if (ids.length > 0) {
          const { data: logicaData, error: logicaError } = await supabase
            .from('form_logic')
            .select('id, question_id, pregunta_origen_id, valor_esperado, accion')
            .in('question_id', ids)
          if (logicaError) setError(logicaError.message)
          else setLogica(logicaData ?? [])
        } else {
          setLogica([])
        }

        setLoading(false)
      })
  }

  useEffect(cargarTodo, [formId])

  const preguntasPorId = useMemo(() => new Map(preguntas.map((p) => [p.id, p])), [preguntas])

  async function handleGuardarDatos(e: FormEvent) {
    e.preventDefault()
    if (!formId) return
    setGuardandoDatos(true)
    setDatosGuardadosOk(false)

    const { error: updateError } = await supabase
      .from('forms')
      .update({
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || null,
        estado,
        updated_at: new Date().toISOString(),
      })
      .eq('id', formId)

    setGuardandoDatos(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setDatosGuardadosOk(true)
    setTimeout(() => setDatosGuardadosOk(false), 2500)
  }

  function abrirNuevaPregunta() {
    setPreguntaForm({ ...PREGUNTA_VACIA, orden: preguntas.length })
    setPreguntaEnEdicion('nueva')
    setPreguntaError(null)
  }

  function abrirEdicionPregunta(p: Pregunta) {
    setPreguntaForm({
      codigo: p.codigo,
      seccion: p.seccion ?? '',
      texto_pregunta: p.texto_pregunta,
      tipo_campo: p.tipo_campo,
      obligatorio: p.obligatorio,
      opcionesTexto: (p.opciones ?? []).join('\n'),
      orden: p.orden,
    })
    setPreguntaEnEdicion(p)
    setPreguntaError(null)
  }

  async function handleGuardarPregunta(e: FormEvent) {
    e.preventDefault()
    if (!formId || !preguntaEnEdicion) return
    setGuardandoPregunta(true)
    setPreguntaError(null)

    const requiereOpciones = TIPOS_CON_OPCIONES.includes(preguntaForm.tipo_campo)
    const opciones = requiereOpciones
      ? preguntaForm.opcionesTexto
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
      : null

    if (requiereOpciones && (!opciones || opciones.length < 2)) {
      setPreguntaError('Este tipo de campo necesita al menos dos opciones (una por línea).')
      setGuardandoPregunta(false)
      return
    }

    const payload = {
      form_id: formId,
      codigo: preguntaForm.codigo.trim(),
      seccion: preguntaForm.seccion.trim() || null,
      texto_pregunta: preguntaForm.texto_pregunta.trim(),
      tipo_campo: preguntaForm.tipo_campo,
      obligatorio: preguntaForm.obligatorio,
      opciones,
      orden: preguntaForm.orden,
    }

    const { error: saveError } =
      preguntaEnEdicion === 'nueva'
        ? await supabase.from('form_questions').insert(payload)
        : await supabase.from('form_questions').update(payload).eq('id', preguntaEnEdicion.id)

    setGuardandoPregunta(false)
    if (saveError) {
      setPreguntaError(
        saveError.message.includes('duplicate')
          ? `Ya existe una pregunta con el código "${payload.codigo}" en este formulario.`
          : saveError.message
      )
      return
    }
    setPreguntaEnEdicion(null)
    cargarTodo()
  }

  async function handleEliminarPregunta(p: Pregunta) {
    if (!confirm(`¿Eliminar la pregunta "${p.codigo} — ${p.texto_pregunta}"?`)) return
    setBorrandoPreguntaId(p.id)
    const { error: deleteError } = await supabase.from('form_questions').delete().eq('id', p.id)
    setBorrandoPreguntaId(null)
    if (deleteError) {
      alert(
        `No se pudo eliminar: ${deleteError.message}\n\nSi ya hay envíos con respuestas a esta pregunta, ` +
          'no se puede borrar.'
      )
      return
    }
    cargarTodo()
  }

  // Mueve `origenId` a la posición que ocupaba `destinoId`, recalcula el
  // orden secuencial (0, 1, 2…) de toda la lista y lo persiste en la base.
  // Así, insertar una pregunta a mitad del formulario es: crearla al final
  // y arrastrarla (o usar las flechas) hasta donde corresponda, sin tener
  // que retocar a mano el orden de todas las que quedan después.
  async function moverPregunta(origenId: string, destinoId: string) {
    if (origenId === destinoId) return
    const origenIdx = preguntas.findIndex((p) => p.id === origenId)
    const destinoIdx = preguntas.findIndex((p) => p.id === destinoId)
    if (origenIdx === -1 || destinoIdx === -1) return

    const reordenadas = [...preguntas]
    const [movida] = reordenadas.splice(origenIdx, 1)
    reordenadas.splice(destinoIdx, 0, movida)

    // Se ve al toque, sin esperar el viaje de ida y vuelta a la base.
    setPreguntas(reordenadas.map((p, i) => ({ ...p, orden: i })))

    setGuardandoOrden(true)
    const resultados = await Promise.all(
      reordenadas.map((p, i) => supabase.from('form_questions').update({ orden: i }).eq('id', p.id))
    )
    setGuardandoOrden(false)

    const conError = resultados.find((r) => r.error)
    if (conError?.error) {
      setError(`No se pudo guardar el nuevo orden: ${conError.error.message}`)
      cargarTodo() // vuelve a traer el orden real de la base ante la duda
    }
  }

  function moverArriba(preguntaId: string) {
    const idx = preguntas.findIndex((p) => p.id === preguntaId)
    if (idx <= 0) return
    moverPregunta(preguntaId, preguntas[idx - 1].id)
  }

  function moverAbajo(preguntaId: string) {
    const idx = preguntas.findIndex((p) => p.id === preguntaId)
    if (idx === -1 || idx >= preguntas.length - 1) return
    moverPregunta(preguntaId, preguntas[idx + 1].id)
  }

  function handleDragStart(e: DragEvent<HTMLSpanElement>, preguntaId: string) {
    setArrastrandoId(preguntaId)
    e.dataTransfer.effectAllowed = 'move'
    const fila = (e.target as HTMLElement).closest('tr')
    if (fila) e.dataTransfer.setDragImage(fila, 20, 20)
  }

  function handleDragOver(e: DragEvent<HTMLTableRowElement>, preguntaId: string) {
    e.preventDefault()
    if (arrastrandoId && arrastrandoId !== preguntaId && sobreId !== preguntaId) {
      setSobreId(preguntaId)
    }
  }

  function handleDrop(e: DragEvent<HTMLTableRowElement>, destinoId: string) {
    e.preventDefault()
    setSobreId(null)
    if (arrastrandoId) moverPregunta(arrastrandoId, destinoId)
    setArrastrandoId(null)
  }

  function handleDragEnd() {
    setArrastrandoId(null)
    setSobreId(null)
  }

  function abrirLogica(preguntaId: string) {
    setLogicaAbiertaPara(logicaAbiertaPara === preguntaId ? null : preguntaId)
    setNuevaLogicaOrigen('')
    setNuevaLogicaValor('')
    setNuevaLogicaAccion('mostrar')
  }

  async function handleAgregarLogica(questionId: string) {
    if (!nuevaLogicaOrigen || !nuevaLogicaValor.trim()) return
    setGuardandoLogica(true)
    const { error: insertError } = await supabase.from('form_logic').insert({
      question_id: questionId,
      pregunta_origen_id: nuevaLogicaOrigen,
      valor_esperado: nuevaLogicaValor.trim(),
      accion: nuevaLogicaAccion,
    })
    setGuardandoLogica(false)
    if (insertError) {
      alert(`No se pudo guardar la regla: ${insertError.message}`)
      return
    }
    setNuevaLogicaOrigen('')
    setNuevaLogicaValor('')
    cargarTodo()
  }

  async function handleEliminarLogica(id: string) {
    if (!confirm('¿Quitar esta regla de lógica condicional? No se puede deshacer.')) return
    const { error: deleteError } = await supabase.from('form_logic').delete().eq('id', id)
    if (deleteError) {
      alert(`No se pudo eliminar la regla: ${deleteError.message}`)
      return
    }
    cargarTodo()
  }

  if (loading) return <p>Cargando formulario…</p>
  if (error && !formulario) return <div className="alert alert-error">{error}</div>
  if (!formulario) return null

  return (
    <div>
      <div className="page-header">
        <p>
          <Link to="/admin/formularios" className="btn-link">
            ← Volver a formularios
          </Link>
        </p>
        <Link to={`/admin/formularios/${formId}/probar`} className="btn-link">
          Probar formulario →
        </Link>
      </div>
      <h1>{formulario.nombre}</h1>

      {error && <div className="alert alert-error">{error}</div>}

      <h2>Datos generales</h2>
      <form className="inline-form" onSubmit={handleGuardarDatos}>
        <div className="campo">
          <label className="campo-titulo" htmlFor="nombre-form">
            Nombre <span className="requerido">*</span>
          </label>
          <input id="nombre-form" type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </div>
        <div className="campo">
          <label className="campo-titulo" htmlFor="descripcion-form">
            Descripción
          </label>
          <textarea id="descripcion-form" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </div>
        <div className="campo">
          <label className="campo-titulo" htmlFor="estado-form">
            Estado
          </label>
          <select id="estado-form" value={estado} onChange={(e) => setEstado(e.target.value as FormularioEstado)}>
            <option value="borrador">Borrador (no visible para técnicos)</option>
            <option value="publicado">Publicado (visible para técnicos)</option>
            <option value="archivado">Archivado</option>
          </select>
        </div>
        <button className="btn-primary" type="submit" disabled={guardandoDatos}>
          {guardandoDatos ? 'Guardando…' : 'Guardar cambios'}
        </button>
        {datosGuardadosOk && <span className="hint hint-ok">Guardado.</span>}
      </form>

      <h2>Preguntas ({preguntas.length})</h2>
      {preguntas.length > 1 && (
        <p className="hint">
          Arrastrá el ícono <span className="asa-arrastre-ejemplo">⠿</span> para reordenar, o usá las flechas.
          {guardandoOrden && ' Guardando orden…'}
        </p>
      )}

      {preguntas.length === 0 && <p>Todavía no hay preguntas. Agregá la primera para empezar.</p>}

      {preguntas.length > 0 && (
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Código</th>
              <th>Sección</th>
              <th>Pregunta</th>
              <th>Tipo</th>
              <th>Oblig.</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {preguntas.map((p, indice) => {
              const reglas = logica.filter((l) => l.question_id === p.id)
              return (
                <Fragment key={p.id}>
                  <tr
                    className={
                      arrastrandoId === p.id ? 'fila-arrastrando' : sobreId === p.id ? 'fila-drop-objetivo' : undefined
                    }
                    onDragOver={(e) => handleDragOver(e, p.id)}
                    onDragLeave={() => setSobreId((actual) => (actual === p.id ? null : actual))}
                    onDrop={(e) => handleDrop(e, p.id)}
                  >
                    <td>
                      <div className="celda-orden">
                        <span
                          className="asa-arrastre"
                          draggable
                          onDragStart={(e) => handleDragStart(e, p.id)}
                          onDragEnd={handleDragEnd}
                          title="Arrastrar para reordenar"
                        >
                          ⠿
                        </span>
                        <div className="flechas-orden">
                          <button
                            type="button"
                            className="btn-flecha"
                            onClick={() => moverArriba(p.id)}
                            disabled={indice === 0}
                            aria-label="Mover arriba"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className="btn-flecha"
                            onClick={() => moverAbajo(p.id)}
                            disabled={indice === preguntas.length - 1}
                            aria-label="Mover abajo"
                          >
                            ▼
                          </button>
                        </div>
                      </div>
                    </td>
                    <td>{p.codigo}</td>
                    <td>{p.seccion ?? '—'}</td>
                    <td>{p.texto_pregunta}</td>
                    <td className="celda-nowrap">{TIPOS_CAMPO.find((t) => t.value === p.tipo_campo)?.label ?? p.tipo_campo}</td>
                    <td>{p.obligatorio ? 'Sí' : 'No'}</td>
                    <td>
                      <div className="acciones-fila">
                        <button className="btn-link" onClick={() => abrirLogica(p.id)}>
                          Lógica ({reglas.length})
                        </button>
                        <button className="btn-link" onClick={() => abrirEdicionPregunta(p)}>
                          Editar
                        </button>
                        <button
                          className="btn-link btn-link-danger"
                          onClick={() => handleEliminarPregunta(p)}
                          disabled={borrandoPreguntaId === p.id}
                        >
                          {borrandoPreguntaId === p.id ? 'Eliminando…' : 'Eliminar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {logicaAbiertaPara === p.id && (
                    <tr>
                      <td colSpan={7}>
                        <div className="panel-logica">
                          <p className="campo-titulo">
                            Mostrar/ocultar "{p.codigo}" según la respuesta de otra pregunta:
                          </p>
                          {reglas.length === 0 && (
                            <p className="hint">
                              Sin reglas — esta pregunta siempre es visible (salvo que otra regla la oculte).
                            </p>
                          )}
                          {reglas.map((r) => {
                            const origen = preguntasPorId.get(r.pregunta_origen_id)
                            return (
                              <div key={r.id} className="regla-logica">
                                <span>
                                  {r.accion === 'mostrar' ? 'Mostrar' : 'Ocultar'} si{' '}
                                  <strong>{origen ? `${origen.codigo} — ${origen.texto_pregunta}` : '(pregunta eliminada)'}</strong>{' '}
                                  = "<strong>{r.valor_esperado}</strong>"
                                </span>
                                <button className="btn-link btn-link-danger" onClick={() => handleEliminarLogica(r.id)}>
                                  Quitar
                                </button>
                              </div>
                            )
                          })}
                          <div className="nueva-regla">
                            <select value={nuevaLogicaAccion} onChange={(e) => setNuevaLogicaAccion(e.target.value as 'mostrar' | 'ocultar')}>
                              <option value="mostrar">Mostrar</option>
                              <option value="ocultar">Ocultar</option>
                            </select>
                            <span>si</span>
                            <select value={nuevaLogicaOrigen} onChange={(e) => setNuevaLogicaOrigen(e.target.value)}>
                              <option value="">Elegí una pregunta…</option>
                              {preguntas
                                .filter((otra) => otra.id !== p.id)
                                .map((otra) => (
                                  <option key={otra.id} value={otra.id}>
                                    {otra.codigo} — {otra.texto_pregunta}
                                  </option>
                                ))}
                            </select>
                            <span>=</span>
                            <input
                              type="text"
                              placeholder="valor esperado, ej: Si"
                              value={nuevaLogicaValor}
                              onChange={(e) => setNuevaLogicaValor(e.target.value)}
                            />
                            <button
                              className="btn-primary"
                              onClick={() => handleAgregarLogica(p.id)}
                              disabled={guardandoLogica || !nuevaLogicaOrigen || !nuevaLogicaValor.trim()}
                            >
                              Agregar
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}

      {preguntaEnEdicion === null && (
        <button className="btn-primary" onClick={abrirNuevaPregunta} style={{ marginTop: 16 }}>
          + Agregar pregunta
        </button>
      )}

      {preguntaEnEdicion !== null && (
        <Modal
          title={preguntaEnEdicion === 'nueva' ? 'Nueva pregunta' : 'Editar pregunta'}
          onClose={() => setPreguntaEnEdicion(null)}
        >
        <form className="inline-form" onSubmit={handleGuardarPregunta}>
          {preguntaError && <div className="alert alert-error">{preguntaError}</div>}

          <div className="campo">
            <label className="campo-titulo" htmlFor="codigo-p">
              Código <span className="requerido">*</span>
            </label>
            <input
              id="codigo-p"
              type="text"
              value={preguntaForm.codigo}
              onChange={(e) => setPreguntaForm((f) => ({ ...f, codigo: e.target.value }))}
              placeholder="Ej: 2.1.3"
              required
            />
          </div>

          <div className="campo">
            <label className="campo-titulo" htmlFor="seccion-p">
              Sección
            </label>
            <input
              id="seccion-p"
              type="text"
              value={preguntaForm.seccion}
              onChange={(e) => setPreguntaForm((f) => ({ ...f, seccion: e.target.value }))}
              placeholder="Ej: Cámaras"
            />
          </div>

          <div className="campo">
            <label className="campo-titulo" htmlFor="texto-p">
              Texto de la pregunta <span className="requerido">*</span>
            </label>
            <textarea
              id="texto-p"
              value={preguntaForm.texto_pregunta}
              onChange={(e) => setPreguntaForm((f) => ({ ...f, texto_pregunta: e.target.value }))}
              required
            />
          </div>

          <div className="campo">
            <label className="campo-titulo" htmlFor="tipo-p">
              Tipo de campo
            </label>
            <select
              id="tipo-p"
              value={preguntaForm.tipo_campo}
              onChange={(e) => setPreguntaForm((f) => ({ ...f, tipo_campo: e.target.value as TipoCampo }))}
            >
              {TIPOS_CAMPO.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {TIPOS_CON_OPCIONES.includes(preguntaForm.tipo_campo) && (
            <div className="campo">
              <label className="campo-titulo" htmlFor="opciones-p">
                Opciones (una por línea) <span className="requerido">*</span>
              </label>
              <textarea
                id="opciones-p"
                value={preguntaForm.opcionesTexto}
                onChange={(e) => setPreguntaForm((f) => ({ ...f, opcionesTexto: e.target.value }))}
                placeholder={'Opción A\nOpción B\nOpción C'}
              />
            </div>
          )}

          <div className="campo campo-checkbox">
            <label>
              <input
                type="checkbox"
                checked={preguntaForm.obligatorio}
                onChange={(e) => setPreguntaForm((f) => ({ ...f, obligatorio: e.target.checked }))}
              />
              Obligatoria
            </label>
          </div>

          <p className="hint">
            {preguntaEnEdicion === 'nueva'
              ? 'Se agrega al final de la lista — después podés arrastrarla a la posición que quieras.'
              : 'El orden se cambia arrastrando la pregunta en la lista, no desde acá.'}
          </p>

          <div className="acciones-fila">
            <button className="btn-primary" type="submit" disabled={guardandoPregunta}>
              {guardandoPregunta ? 'Guardando…' : 'Guardar pregunta'}
            </button>
            <button type="button" className="btn-link" onClick={() => setPreguntaEnEdicion(null)}>
              Cancelar
            </button>
          </div>
        </form>
        </Modal>
      )}
    </div>
  )
}
