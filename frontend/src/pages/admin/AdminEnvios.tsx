import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import type { Submission, SubmissionEstado } from '../../lib/types'

const ESTADOS: { value: SubmissionEstado; label: string }[] = [
  { value: 'nuevo', label: 'Nuevo' },
  { value: 'en_revision', label: 'En revisión' },
  { value: 'aprobado', label: 'Aprobado' },
  { value: 'rechazado', label: 'Rechazado' },
]

/**
 * Lista de envíos, con el join a forms/profiles resuelto a mano (dos
 * consultas + merge en el cliente) en vez de un embed de PostgREST, para no
 * depender de adivinar el nombre exacto de la foreign key de "enviado_por"
 * (submissions tiene DOS relaciones hacia profiles: enviado_por y
 * asignado_a, lo que hace ambiguo un embed simple `profiles(nombre)`).
 * Cada fila lleva a AdminEnvioDetalle, donde se ven/editan las respuestas;
 * el estado se puede cambiar acá mismo sin entrar, para revisar rápido.
 *
 * Los filtros (formulario/técnico/fechas) son en el cliente, sobre los
 * envíos ya cargados — no hay tantos como para justificar repetir el viaje
 * a la base por cada cambio de filtro.
 */
export function AdminEnvios() {
  const [rows, setRows] = useState<Submission[]>([])
  const [formNames, setFormNames] = useState<Record<string, string>>({})
  const [tecnicoNames, setTecnicoNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [borrandoId, setBorrandoId] = useState<string | null>(null)
  const [cambiandoEstadoId, setCambiandoEstadoId] = useState<string | null>(null)

  const [filtroForm, setFiltroForm] = useState('')
  const [filtroTecnico, setFiltroTecnico] = useState('')
  const [filtroDesde, setFiltroDesde] = useState('')
  const [filtroHasta, setFiltroHasta] = useState('')

  function cargar() {
    setLoading(true)
    supabase
      .from('submissions')
      .select('id, form_id, enviado_por, cliente, estado, codigo_seguimiento, created_at')
      .order('created_at', { ascending: false })
      .then(async ({ data: submissions, error: subError }) => {
        if (subError) {
          setError(subError.message)
          setLoading(false)
          return
        }

        const envios = submissions ?? []
        setRows(envios)

        const formIds = [...new Set(envios.map((r) => r.form_id))]
        const profileIds = [...new Set(envios.map((r) => r.enviado_por))]

        const [{ data: forms }, { data: profiles }] = await Promise.all([
          formIds.length
            ? supabase.from('forms').select('id, nombre').in('id', formIds)
            : Promise.resolve({ data: [] as { id: string; nombre: string }[] }),
          profileIds.length
            ? supabase.from('profiles').select('id, nombre').in('id', profileIds)
            : Promise.resolve({ data: [] as { id: string; nombre: string }[] }),
        ])

        setFormNames(Object.fromEntries((forms ?? []).map((f) => [f.id, f.nombre])))
        setTecnicoNames(Object.fromEntries((profiles ?? []).map((p) => [p.id, p.nombre])))
        setLoading(false)
      })
  }

  useEffect(cargar, [])

  const opcionesForm = useMemo(
    () => Object.entries(formNames).sort((a, b) => a[1].localeCompare(b[1])),
    [formNames],
  )
  const opcionesTecnico = useMemo(
    () => Object.entries(tecnicoNames).sort((a, b) => a[1].localeCompare(b[1])),
    [tecnicoNames],
  )

  const hayFiltrosActivos = Boolean(filtroForm || filtroTecnico || filtroDesde || filtroHasta)

  function limpiarFiltros() {
    setFiltroForm('')
    setFiltroTecnico('')
    setFiltroDesde('')
    setFiltroHasta('')
  }

  const filasFiltradas = useMemo(() => {
    return rows.filter((r) => {
      if (filtroForm && r.form_id !== filtroForm) return false
      if (filtroTecnico && r.enviado_por !== filtroTecnico) return false
      if (filtroDesde && new Date(r.created_at) < new Date(`${filtroDesde}T00:00:00`)) return false
      if (filtroHasta && new Date(r.created_at) > new Date(`${filtroHasta}T23:59:59`)) return false
      return true
    })
  }, [rows, filtroForm, filtroTecnico, filtroDesde, filtroHasta])

  async function handleCambiarEstado(s: Submission, nuevoEstado: SubmissionEstado) {
    setCambiandoEstadoId(s.id)
    const { data, error: updateError } = await supabase
      .from('submissions')
      .update({ estado: nuevoEstado })
      .eq('id', s.id)
      .select('id')
    setCambiandoEstadoId(null)
    if (updateError) {
      alert(`No se pudo cambiar el estado: ${updateError.message}`)
      return
    }
    // 0 filas sin error = la política de RLS bloqueó el update en silencio.
    if ((data?.length ?? 0) === 0) {
      alert('No se guardó el cambio de estado: problema de permisos (RLS).')
      return
    }
    setRows((prev) => prev.map((r) => (r.id === s.id ? { ...r, estado: nuevoEstado } : r)))
  }

  async function handleEliminar(s: Submission) {
    if (!confirm(`¿Eliminar el envío "${s.codigo_seguimiento}"? Esta acción no se puede deshacer.`)) return
    setBorrandoId(s.id)
    // submission_answers tiene ON DELETE CASCADE hacia submissions, así que
    // alcanza con borrar el envío — sus respuestas se van solas.
    const { data: subData, error: deleteError } = await supabase
      .from('submissions')
      .delete()
      .eq('id', s.id)
      .select('id')
    setBorrandoId(null)
    if (deleteError) {
      alert(`No se pudo eliminar: ${deleteError.message}`)
      return
    }
    // 0 filas sin error = la política de RLS bloqueó el delete en silencio
    // (Postgres/PostgREST no avisan con un error en ese caso).
    if ((subData?.length ?? 0) === 0) {
      alert(
        'No se eliminó nada: el servidor no dio error, pero tampoco borró filas. ' +
          'Es un problema de permisos (RLS) — el administrador todavía no tiene permiso para eliminar envíos.',
      )
      return
    }
    cargar()
  }

  if (loading) return <p>Cargando envíos…</p>
  if (error) return <div className="alert alert-error">{error}</div>

  return (
    <div>
      <h1>Envíos</h1>

      {rows.length === 0 && <p className="subtitle">Todavía no hay envíos registrados.</p>}

      {rows.length > 0 && (
        <div className="filtros-fila">
          <div className="campo">
            <label className="campo-titulo" htmlFor="filtro-form">
              Formulario
            </label>
            <select id="filtro-form" value={filtroForm} onChange={(e) => setFiltroForm(e.target.value)}>
              <option value="">Todos</option>
              {opcionesForm.map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label className="campo-titulo" htmlFor="filtro-tecnico">
              Técnico
            </label>
            <select id="filtro-tecnico" value={filtroTecnico} onChange={(e) => setFiltroTecnico(e.target.value)}>
              <option value="">Todos</option>
              {opcionesTecnico.map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label className="campo-titulo" htmlFor="filtro-desde">
              Desde
            </label>
            <input id="filtro-desde" type="date" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} />
          </div>
          <div className="campo">
            <label className="campo-titulo" htmlFor="filtro-hasta">
              Hasta
            </label>
            <input id="filtro-hasta" type="date" value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)} />
          </div>
          {hayFiltrosActivos && (
            <button type="button" className="btn-link" onClick={limpiarFiltros}>
              Limpiar filtros
            </button>
          )}
        </div>
      )}

      {rows.length > 0 && filasFiltradas.length === 0 && (
        <p className="hint">Ningún envío coincide con estos filtros.</p>
      )}

      {filasFiltradas.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Formulario</th>
              <th>Técnico</th>
              <th>Cliente</th>
              <th>Estado</th>
              <th>Fecha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filasFiltradas.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/admin/envios/${r.id}`} className="table-link">
                    <code>{r.codigo_seguimiento}</code>
                  </Link>
                </td>
                <td>{formNames[r.form_id] ?? '—'}</td>
                <td>{tecnicoNames[r.enviado_por] ?? '—'}</td>
                <td>{r.cliente ?? '—'}</td>
                <td>
                  <select
                    value={r.estado}
                    disabled={cambiandoEstadoId === r.id}
                    onChange={(e) => handleCambiarEstado(r, e.target.value as SubmissionEstado)}
                  >
                    {ESTADOS.map((e) => (
                      <option key={e.value} value={e.value}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{new Date(r.created_at).toLocaleString('es-AR')}</td>
                <td>
                  <button
                    className="btn-link btn-link-danger"
                    onClick={() => handleEliminar(r)}
                    disabled={borrandoId === r.id}
                  >
                    {borrandoId === r.id ? 'Eliminando…' : 'Eliminar'}
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
