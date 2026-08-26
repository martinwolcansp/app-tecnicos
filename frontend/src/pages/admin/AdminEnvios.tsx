import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import type { Submission } from '../../lib/types'

/**
 * v1: solo lectura, con el join a forms/profiles resuelto a mano (dos
 * consultas + merge en el cliente) en vez de un embed de PostgREST, para no
 * depender de adivinar el nombre exacto de la foreign key de "enviado_por"
 * (submissions tiene DOS relaciones hacia profiles: enviado_por y
 * asignado_a, lo que hace ambiguo un embed simple `profiles(nombre)`).
 */
export function AdminEnvios() {
  const [rows, setRows] = useState<Submission[]>([])
  const [formNames, setFormNames] = useState<Record<string, string>>({})
  const [tecnicoNames, setTecnicoNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function cargar() {
      const { data: submissions, error: subError } = await supabase
        .from('submissions')
        .select('id, form_id, enviado_por, cliente, estado, codigo_seguimiento, created_at')
        .order('created_at', { ascending: false })

      if (!mounted) return

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

      if (!mounted) return

      setFormNames(Object.fromEntries((forms ?? []).map((f) => [f.id, f.nombre])))
      setTecnicoNames(Object.fromEntries((profiles ?? []).map((p) => [p.id, p.nombre])))
      setLoading(false)
    }

    cargar()
    return () => {
      mounted = false
    }
  }, [])

  if (loading) return <p>Cargando envíos…</p>
  if (error) return <div className="alert alert-error">{error}</div>

  return (
    <div>
      <h1>Envíos</h1>

      {rows.length === 0 && <p className="subtitle">Todavía no hay envíos registrados.</p>}

      {rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Formulario</th>
              <th>Técnico</th>
              <th>Cliente</th>
              <th>Estado</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <code>{r.codigo_seguimiento}</code>
                </td>
                <td>{formNames[r.form_id] ?? '—'}</td>
                <td>{tecnicoNames[r.enviado_por] ?? '—'}</td>
                <td>{r.cliente ?? '—'}</td>
                <td>
                  <span className={`badge badge-${r.estado}`}>{r.estado}</span>
                </td>
                <td>{new Date(r.created_at).toLocaleString('es-AR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
