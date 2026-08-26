import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import type { Formulario } from '../../lib/types'

/**
 * v1: solo lectura. Alcanza para confirmar que el admin ve todos los
 * formularios (borrador incluido, gracias a RLS) y para tener un punto de
 * partida visual — la creación/edición de formularios desde acá es una
 * siguiente iteración (hoy se cargan por SQL vía seed.sql).
 */
export function AdminFormularios() {
  const [forms, setForms] = useState<Formulario[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('forms')
      .select('id, nombre, descripcion, estado, created_at')
      .order('created_at', { ascending: false })
      .then(({ data, error: fetchError }) => {
        if (fetchError) setError(fetchError.message)
        else setForms(data ?? [])
        setLoading(false)
      })
  }, [])

  if (loading) return <p>Cargando formularios…</p>
  if (error) return <div className="alert alert-error">{error}</div>

  return (
    <div>
      <h1>Formularios</h1>
      <p className="subtitle">
        Vista de solo lectura por ahora — crear y editar formularios desde acá se suma en una
        siguiente iteración.
      </p>

      {forms.length === 0 && <p>Todavía no hay formularios cargados.</p>}

      {forms.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Descripción</th>
              <th>Estado</th>
              <th>Creado</th>
            </tr>
          </thead>
          <tbody>
            {forms.map((f) => (
              <tr key={f.id}>
                <td>{f.nombre}</td>
                <td>{f.descripcion ?? '—'}</td>
                <td>
                  <span className={`badge badge-${f.estado}`}>{f.estado}</span>
                </td>
                <td>{new Date(f.created_at).toLocaleDateString('es-AR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
