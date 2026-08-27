import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/AuthContext'
import { Modal } from '../../components/Modal'
import type { Profile, Rol } from '../../lib/types'

type UsuarioFila = Profile & { created_at: string }

const ROLES_EDITABLES: { value: Rol; label: string }[] = [
  { value: 'tecnico', label: 'Técnico' },
  { value: 'administrador', label: 'Administrador' },
]

function generarPassword(): string {
  // Alcanza y sobra para una contraseña temporal que el admin le pasa al
  // usuario y que se puede cambiar más adelante — no hace falta que sea
  // memorable, solo fácil de copiar y pegar una vez.
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let resultado = ''
  for (let i = 0; i < 12; i++) {
    resultado += alfabeto[Math.floor(Math.random() * alfabeto.length)]
  }
  return resultado
}

/**
 * CRUD de usuarios (técnicos/administradores). Crear un usuario y resetear
 * su contraseña pasan por la Edge Function `admin-usuarios` (necesitan la
 * service_role key, que no puede estar en el frontend); cambiar el rol de
 * alguien que ya existe se hace directo contra `profiles` vía RLS.
 */
export function AdminUsuarios() {
  const { profile, session } = useAuth()

  const [usuarios, setUsuarios] = useState<UsuarioFila[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [mostrarNuevo, setMostrarNuevo] = useState(false)
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [emailNuevo, setEmailNuevo] = useState('')
  const [passwordNuevo, setPasswordNuevo] = useState('')
  const [rolNuevo, setRolNuevo] = useState<Rol>('tecnico')
  const [creando, setCreando] = useState(false)
  const [creandoError, setCreandoError] = useState<string | null>(null)

  const [cambiandoRolId, setCambiandoRolId] = useState<string | null>(null)
  const [borrandoId, setBorrandoId] = useState<string | null>(null)

  const [resetUsuario, setResetUsuario] = useState<UsuarioFila | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [reseteando, setReseteando] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetOk, setResetOk] = useState(false)

  function cargar() {
    setLoading(true)
    supabase
      .from('profiles')
      .select('id, nombre, rol, email, created_at')
      .order('created_at', { ascending: false })
      .then(({ data, error: fetchError }) => {
        if (fetchError) setError(fetchError.message)
        else setUsuarios(data ?? [])
        setLoading(false)
      })
  }

  useEffect(cargar, [])

  async function invocarAdminUsuarios(payload: Record<string, unknown>) {
    const { data, error: invokeError } = await supabase.functions.invoke('admin-usuarios', { body: payload })
    if (invokeError) {
      // supabase-js no siempre expone el JSON de error del body en fallas
      // HTTP (4xx/5xx) — el mensaje genérico es mejor que nada acá.
      return { ok: false, error: invokeError.message } as { ok: false; error: string }
    }
    return data as { ok: true; usuario?: UsuarioFila } | { ok: false; error: string }
  }

  async function handleCrear(e: FormEvent) {
    e.preventDefault()
    setCreando(true)
    setCreandoError(null)

    const resultado = await invocarAdminUsuarios({
      accion: 'crear',
      nombre: nombreNuevo.trim(),
      email: emailNuevo.trim(),
      password: passwordNuevo,
      rol: rolNuevo,
    })

    setCreando(false)
    if (!resultado.ok) {
      setCreandoError(typeof resultado.error === 'string' ? resultado.error : 'No se pudo crear el usuario.')
      return
    }

    setMostrarNuevo(false)
    setNombreNuevo('')
    setEmailNuevo('')
    setPasswordNuevo('')
    setRolNuevo('tecnico')
    cargar()
  }

  async function handleCambiarRol(usuario: UsuarioFila, nuevoRol: Rol) {
    setCambiandoRolId(usuario.id)
    const { error: updateError } = await supabase.from('profiles').update({ rol: nuevoRol }).eq('id', usuario.id)
    setCambiandoRolId(null)
    if (updateError) {
      alert(`No se pudo cambiar el rol: ${updateError.message}`)
      return
    }
    cargar()
  }

  async function handleEliminar(usuario: UsuarioFila) {
    if (!confirm(`¿Eliminar a "${usuario.nombre}" (${usuario.email})? Esta acción no se puede deshacer.`)) return
    setBorrandoId(usuario.id)
    const resultado = await invocarAdminUsuarios({ accion: 'eliminar', userId: usuario.id })
    setBorrandoId(null)
    if (!resultado.ok) {
      alert(typeof resultado.error === 'string' ? resultado.error : 'No se pudo eliminar el usuario.')
      return
    }
    cargar()
  }

  function abrirReset(usuario: UsuarioFila) {
    setResetUsuario(usuario)
    setResetPassword(generarPassword())
    setResetError(null)
    setResetOk(false)
  }

  async function handleResetear(e: FormEvent) {
    e.preventDefault()
    if (!resetUsuario) return
    setReseteando(true)
    setResetError(null)

    const resultado = await invocarAdminUsuarios({
      accion: 'resetear_password',
      userId: resetUsuario.id,
      password: resetPassword,
    })

    setReseteando(false)
    if (!resultado.ok) {
      setResetError(typeof resultado.error === 'string' ? resultado.error : 'No se pudo resetear la contraseña.')
      return
    }
    setResetOk(true)
  }

  if (loading) return <p>Cargando usuarios…</p>
  if (error) return <div className="alert alert-error">{error}</div>

  return (
    <div>
      <div className="page-header">
        <h1>Usuarios</h1>
        <button className="btn-primary" onClick={() => setMostrarNuevo((v) => !v)}>
          {mostrarNuevo ? 'Cancelar' : '+ Nuevo usuario'}
        </button>
      </div>

      {mostrarNuevo && (
        <Modal title="Nuevo usuario" onClose={() => setMostrarNuevo(false)}>
          <form className="inline-form" onSubmit={handleCrear}>
            {creandoError && <div className="alert alert-error">{creandoError}</div>}

            <div className="campo">
              <label className="campo-titulo" htmlFor="nombre-u">
                Nombre <span className="requerido">*</span>
              </label>
              <input
                id="nombre-u"
                type="text"
                value={nombreNuevo}
                onChange={(e) => setNombreNuevo(e.target.value)}
                required
              />
            </div>

            <div className="campo">
              <label className="campo-titulo" htmlFor="email-u">
                Email <span className="requerido">*</span>
              </label>
              <input
                id="email-u"
                type="email"
                value={emailNuevo}
                onChange={(e) => setEmailNuevo(e.target.value)}
                required
              />
            </div>

            <div className="campo">
              <label className="campo-titulo" htmlFor="password-u">
                Contraseña <span className="requerido">*</span>
              </label>
              <div className="campo-con-boton">
                <input
                  id="password-u"
                  type="text"
                  value={passwordNuevo}
                  onChange={(e) => setPasswordNuevo(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  required
                />
                <button type="button" className="btn-link" onClick={() => setPasswordNuevo(generarPassword())}>
                  Generar
                </button>
              </div>
              <span className="hint">Copiala antes de guardar — después no se puede volver a ver.</span>
            </div>

            <div className="campo">
              <label className="campo-titulo" htmlFor="rol-u">
                Rol
              </label>
              <select id="rol-u" value={rolNuevo} onChange={(e) => setRolNuevo(e.target.value as Rol)}>
                {ROLES_EDITABLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <button className="btn-primary" type="submit" disabled={creando}>
              {creando ? 'Creando…' : 'Crear usuario'}
            </button>
          </form>
        </Modal>
      )}

      {resetUsuario && (
        <Modal title={`Restablecer contraseña — ${resetUsuario.nombre}`} onClose={() => setResetUsuario(null)}>
          {resetOk ? (
            <div>
              <p>Contraseña actualizada. Pasásela a {resetUsuario.nombre} — no se puede volver a mostrar después:</p>
              <p className="codigo-seguimiento" style={{ fontSize: 18 }}>
                {resetPassword}
              </p>
              <button className="btn-primary" onClick={() => setResetUsuario(null)}>
                Listo
              </button>
            </div>
          ) : (
            <form className="inline-form" onSubmit={handleResetear}>
              {resetError && <div className="alert alert-error">{resetError}</div>}
              <div className="campo">
                <label className="campo-titulo" htmlFor="reset-password">
                  Nueva contraseña
                </label>
                <div className="campo-con-boton">
                  <input
                    id="reset-password"
                    type="text"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    required
                  />
                  <button type="button" className="btn-link" onClick={() => setResetPassword(generarPassword())}>
                    Generar
                  </button>
                </div>
              </div>
              <button className="btn-primary" type="submit" disabled={reseteando}>
                {reseteando ? 'Guardando…' : 'Restablecer'}
              </button>
            </form>
          )}
        </Modal>
      )}

      {usuarios.length === 0 && <p>Todavía no hay usuarios cargados.</p>}

      {usuarios.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Creado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => {
              const esUnoMismo = u.id === profile?.id
              return (
                <tr key={u.id}>
                  <td>
                    {u.nombre}
                    {esUnoMismo && <span className="hint"> (vos)</span>}
                  </td>
                  <td>{u.email}</td>
                  <td>
                    {u.rol === 'superadministrador' ? (
                      <span className="badge badge-admin">Superadministrador</span>
                    ) : (
                      <select
                        value={u.rol}
                        disabled={esUnoMismo || cambiandoRolId === u.id}
                        onChange={(e) => handleCambiarRol(u, e.target.value as Rol)}
                      >
                        {ROLES_EDITABLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>{new Date(u.created_at).toLocaleDateString('es-AR')}</td>
                  <td>
                    <div className="acciones-fila">
                      <button className="btn-link" onClick={() => abrirReset(u)}>
                        Restablecer contraseña
                      </button>
                      <button
                        className="btn-link btn-link-danger"
                        onClick={() => handleEliminar(u)}
                        disabled={esUnoMismo || borrandoId === u.id}
                      >
                        {borrandoId === u.id ? 'Eliminando…' : 'Eliminar'}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {!session && <p className="hint">Sesión no disponible — recargá la página.</p>}
    </div>
  )
}
