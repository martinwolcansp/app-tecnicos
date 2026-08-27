import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/AuthContext'
import type { Formulario, FormularioEstado } from '../../lib/types'

/**
 * CRUD de formularios (RF-01 a RF-03). Crear/editar preguntas y lógica
 * condicional de cada formulario se hace en AdminFormularioEditor, a donde
 * lleva cada fila de esta lista.
 */
export function AdminFormularios() {
  const { profile } = useAuth()
  const [forms, setForms] = useState<Formulario[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [mostrarNuevo, setMostrarNuevo] = useState(false)
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [descripcionNuevo, setDescripcionNuevo] = useState('')
  const [creando, setCreando] = useState(false)
  const [creandoError, setCreandoError] = useState<string | null>(null)

  const [borrandoId, setBorrandoId] = useState<string | null>(null)

  function cargar() {
    setLoading(true)
    supabase
      .from('forms')
      .select('id, nombre, descripcion, estado, created_at')
      .order('created_at', { ascending: false })
      .then(({ data, error: fetchError }) => {
        if (fetchError) setError(fetchError.message)
        else setForms(data ?? [])
        setLoading(false)
      })
  }

  useEffect(cargar, [])

  async function handleCrear(e: FormEvent) {
    e.preventDefault()
    if (!nombreNuevo.trim()) return
    setCreando(true)
    setCreandoError(null)

    const { error: insertError } = await supabase.from('forms').insert({
      nombre: nombreNuevo.trim(),
      descripcion: descripcionNuevo.trim() || null,
      estado: 'borrador',
      creado_por: profile?.id ?? null,
    })

    setCreando(false)
    if (insertError) {
      setCreandoError(insertError.message)
      return
    }
    setNombreNuevo('')
    setDescripcionNuevo('')
    setMostrarNuevo(false)
    cargar()
  }

  async function handleEliminar(f: Formulario) {
    if (!confirm(`¿Eliminar el formulario "${f.nombre}"? Esta acción no se puede deshacer.`)) return
    setBorrandoId(f.id)
    const { error: deleteError } = await supabase.from('forms').delete().eq('id', f.id)
    setBorrandoId(null)
    if (deleteError) {
      // El caso más común: ya tiene envíos asociados, y la base lo bloquea a
      // propósito (no hay on delete cascade desde submissions hacia forms).
      alert(
        `No se pudo eliminar: ${deleteError.message}\n\nSi el formulario ya tiene envíos cargados, ` +
          'no se puede borrar — probá archivarlo en su lugar (cambiando el estado desde el editor).'
      )
      return
    }
    cargar()
  }

  if (loading) return <p>Cargando formularios…</p>
  if (error) return <div className="alert alert-error">{error}</div>

  return (
    <div>
      <div className="page-header">
        <h1>Formularios</h1>
        <button className="btn-primary" onClick={() => setMostrarNuevo((v) => !v)}>
          {mostrarNuevo ? 'Cancelar' : '+ Nuevo formulario'}
        </button>
      </div>

      {mostrarNuevo && (
        <form className="inline-form" onSubmit={handleCrear}>
          {creandoError && <div className="alert alert-error">{creandoError}</div>}
          <div className="campo">
            <label className="campo-titulo" htmlFor="nombre-nuevo">
              Nombre <span className="requerido">*</span>
            </label>
            <input
              id="nombre-nuevo"
              type="text"
              value={nombreNuevo}
              onChange={(e) => setNombreNuevo(e.target.value)}
              placeholder="Ej: Informe de Servicio Técnico"
              required
            />
          </div>
          <div className="campo">
            <label className="campo-titulo" htmlFor="descripcion-nueva">
              Descripción
            </label>
            <textarea
              id="descripcion-nueva"
              value={descripcionNuevo}
              onChange={(e) => setDescripcionNuevo(e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <button className="btn-primary" type="submit" disabled={creando}>
            {creando ? 'Creando…' : 'Crear formulario'}
          </button>
          <p className="hint">Se crea en estado "borrador". Las preguntas se agregan en el paso siguiente.</p>
        </form>
      )}

      {forms.length === 0 && !mostrarNuevo && <p>Todavía no hay formularios cargados.</p>}

      {forms.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Descripción</th>
              <th>Estado</th>
              <th>Creado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {forms.map((f) => (
              <tr key={f.id}>
                <td>
                  <Link to={`/admin/formularios/${f.id}`} className="table-link">
                    {f.nombre}
                  </Link>
                </td>
                <td>{f.descripcion ?? '—'}</td>
                <td>
                  <span className={`badge badge-${f.estado as FormularioEstado}`}>{f.estado}</span>
                </td>
                <td>{new Date(f.created_at).toLocaleDateString('es-AR')}</td>
                <td>
                  <button
                    className="btn-danger btn-sm"
                    onClick={() => handleEliminar(f)}
                    disabled={borrandoId === f.id}
                  >
                    {borrandoId === f.id ? 'Eliminando…' : 'Eliminar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
