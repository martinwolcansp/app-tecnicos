import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import './App.css'

type Form = {
  id: string
  nombre: string
  estado: string
}

type Question = {
  id: string
  codigo: string
  seccion: string | null
  texto_pregunta: string
  tipo_campo: string
}

/**
 * Pantalla de verificación de entorno local (Etapa 1).
 *
 * No es el wizard final (eso es Etapa 3) — solo confirma que la app React
 * puede leer los formularios y preguntas cargados por supabase/seed.sql
 * contra el Supabase local levantado con `supabase start`.
 */
function App() {
  const [forms, setForms] = useState<Form[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function cargar() {
      const { data: formsData, error: formsError } = await supabase
        .from('forms')
        .select('id, nombre, estado')

      if (formsError) {
        setError(formsError.message)
        setLoading(false)
        return
      }

      setForms(formsData ?? [])

      if (formsData && formsData.length > 0) {
        const { data: questionsData, error: questionsError } = await supabase
          .from('form_questions')
          .select('id, codigo, seccion, texto_pregunta, tipo_campo')
          .eq('form_id', formsData[0].id)
          .order('orden')

        if (questionsError) {
          setError(questionsError.message)
        } else {
          setQuestions(questionsData ?? [])
        }
      }

      setLoading(false)
    }

    cargar()
  }, [])

  return (
    <div className="page">
      <h1>App Técnicos — entorno local</h1>
      <p className="subtitle">
        Verificación de conexión: React ↔ Supabase local ↔ formulario piloto
        sembrado por <code>supabase/seed.sql</code>.
      </p>

      {loading && <p>Consultando Supabase local…</p>}

      {error && (
        <div className="error">
          <strong>No se pudo conectar con Supabase.</strong>
          <p>{error}</p>
          <p>
            Revisá que corriste <code>supabase start</code> y que copiaste las
            credenciales a <code>frontend/.env.local</code> (ver{' '}
            <code>.env.example</code>).
          </p>
        </div>
      )}

      {!loading && !error && (
        <>
          <h2>Formularios publicados</h2>
          <ul>
            {forms.map((f) => (
              <li key={f.id}>
                {f.nombre} <span className="badge">{f.estado}</span>
              </li>
            ))}
          </ul>

          <h2>Preguntas del formulario piloto ({questions.length})</h2>
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Sección</th>
                <th>Pregunta</th>
                <th>Tipo</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((q) => (
                <tr key={q.id}>
                  <td>{q.codigo}</td>
                  <td>{q.seccion}</td>
                  <td>{q.texto_pregunta}</td>
                  <td>{q.tipo_campo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

export default App
