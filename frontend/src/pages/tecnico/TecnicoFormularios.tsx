import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import type { Formulario } from '../../lib/types'

export function TecnicoFormularios() {
  const [forms, setForms] = useState<Formulario[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('forms')
      .select('id, nombre, descripcion, estado, created_at')
      .eq('estado', 'publicado')
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
      <h1>Formularios disponibles</h1>

      {forms.length === 0 && <p className="subtitle">No hay formularios publicados todavía.</p>}

      <div className="card-list">
        {forms.map((f) => (
          <Link key={f.id} to={`/tecnico/formulario/${f.id}`} className="card card-link">
            <strong>{f.nombre}</strong>
            {f.descripcion && <p>{f.descripcion}</p>}
          </Link>
        ))}
      </div>
    </div>
  )
}
