import { createClient } from '@supabase/supabase-js'

// Estas variables las genera `supabase start` (correr en la raíz del repo,
// donde está la carpeta supabase/). Se imprimen en la terminal al arrancar:
// API URL y anon key. Copiarlas a frontend/.env.local (ver .env.example).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
      'Copiá frontend/.env.example a frontend/.env.local y completá los valores ' +
      'que imprime "supabase start".'
  )
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '')
