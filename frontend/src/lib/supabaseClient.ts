import { createClient } from '@supabase/supabase-js'

// Estas variables salen del Supabase Studio del servidor de la empresa
// (Project Settings → API): Project URL y anon public key.
// Copiarlas a frontend/.env.local (ver .env.example).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
      'Copiá frontend/.env.example a frontend/.env.local y completá los valores ' +
      'del Supabase Studio del servidor (Project Settings → API).'
  )
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '')
