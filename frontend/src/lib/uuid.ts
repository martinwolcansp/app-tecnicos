// crypto.randomUUID() solo está disponible en "contextos seguros" (HTTPS o
// localhost) — en un dominio http:// que no sea localhost (como el que asigna
// Coolify por defecto en *.sslip.io sin certificado), el navegador ni
// siquiera expone la función, y llamarla revienta toda la app con
// "crypto.randomUUID is not a function".
//
// Esta función genera un id igual de válido usando crypto.getRandomValues()
// (que sí está disponible en cualquier contexto) cuando randomUUID() no
// existe, y solo cae a Math.random() como último recurso. El id se usa nada
// más como prefijo temporal para organizar fotos durante la carga del
// formulario, así que no necesita ser criptográficamente perfecto — solo
// necesita no colisionar en la práctica.
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40 // versión 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80 // variante
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
