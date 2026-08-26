import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import type { Profile } from './types'

type AuthContextValue = {
  session: Session | null
  profile: Profile | null
  loading: boolean
  error: string | null
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

/**
 * Envuelve toda la app. Mantiene la sesión de Supabase Auth sincronizada con
 * la fila correspondiente en `profiles` (que trae el rol: tecnico /
 * administrador / superadministrador). El ruteo por rol (ver App.tsx y
 * ProtectedRoute) depende de `profile.rol`, no del objeto de auth crudo.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function cargarPerfil(userId: string) {
      const { data, error: perfilError } = await supabase
        .from('profiles')
        .select('id, nombre, rol, email')
        .eq('id', userId)
        .single()

      if (!mounted) return

      if (perfilError) {
        setProfile(null)
        setError(
          'Tu usuario existe en Supabase Auth pero no tiene un perfil asociado en la tabla ' +
            '"profiles". Pedile a un administrador que te cree el registro correspondiente.',
        )
      } else {
        setProfile(data)
        setError(null)
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      if (data.session?.user) {
        cargarPerfil(data.session.user.id).finally(() => {
          if (mounted) setLoading(false)
        })
      } else {
        setLoading(false)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nuevaSesion) => {
      setSession(nuevaSesion)
      if (nuevaSesion?.user) {
        setLoading(true)
        cargarPerfil(nuevaSesion.user.id).finally(() => {
          if (mounted) setLoading(false)
        })
      } else {
        setProfile(null)
        setError(null)
        setLoading(false)
      }
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, error, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  }
  return ctx
}
