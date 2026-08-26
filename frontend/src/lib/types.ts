export type Rol = 'tecnico' | 'administrador' | 'superadministrador'

export type Profile = {
  id: string
  nombre: string
  rol: Rol
  email: string
}

export type FormularioEstado = 'borrador' | 'publicado' | 'archivado'

export type Formulario = {
  id: string
  nombre: string
  descripcion: string | null
  estado: FormularioEstado
  created_at: string
}

export type TipoCampo =
  | 'texto_corto'
  | 'texto_largo'
  | 'numero'
  | 'seleccion_unica'
  | 'seleccion_multiple'
  | 'si_no'
  | 'telefono'
  | 'email'
  | 'fecha'
  | 'foto'

export type Pregunta = {
  id: string
  form_id: string
  codigo: string
  seccion: string | null
  texto_pregunta: string
  tipo_campo: TipoCampo
  obligatorio: boolean
  opciones: string[] | null
  orden: number
}

export type LogicaCondicional = {
  id: string
  question_id: string
  pregunta_origen_id: string
  valor_esperado: string
  accion: 'mostrar' | 'ocultar'
}

export type SubmissionEstado = 'nuevo' | 'en_revision' | 'aprobado' | 'rechazado'

export type Submission = {
  id: string
  form_id: string
  enviado_por: string
  cliente: string | null
  estado: SubmissionEstado
  codigo_seguimiento: string
  created_at: string
}
