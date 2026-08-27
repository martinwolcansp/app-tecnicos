export type LineaReporte = {
  codigo: string
  texto_pregunta: string
  respuesta: string
}

export type DatosReporte = {
  formularioNombre: string
  tecnicoNombre: string
  cliente: string | null
  fecha: Date
  codigoSeguimiento: string
  lineas: LineaReporte[]
}

/**
 * Arma el informe como texto plano (sin ningún formato enriquecido), para
 * poder pegarlo tal cual en un campo de texto simple — WhatsApp, un mail,
 * un sistema de terceros, etc. Se usa tanto desde la confirmación del
 * técnico al enviar (RF interno, no numerado) como desde "Imprimir" en el
 * panel de administrador.
 */
export function generarReporteTexto(datos: DatosReporte): string {
  const partes: string[] = []
  partes.push(datos.formularioNombre.toUpperCase())
  partes.push(`Técnico: ${datos.tecnicoNombre}`)
  if (datos.cliente) partes.push(`Cliente: ${datos.cliente}`)
  partes.push(`Fecha: ${datos.fecha.toLocaleString('es-AR')}`)
  partes.push(`Código de seguimiento: ${datos.codigoSeguimiento}`)
  partes.push('')

  for (const l of datos.lineas) {
    partes.push(`${l.codigo} — ${l.texto_pregunta}`)
    partes.push(`  ${l.respuesta}`)
    partes.push('')
  }

  return partes.join('\n').trimEnd()
}
