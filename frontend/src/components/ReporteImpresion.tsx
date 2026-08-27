import { useState } from 'react'

/**
 * Muestra un informe como texto plano con dos acciones: "Imprimir" (usa
 * window.print() — la regla @media print en app.css oculta todo lo demás
 * de la página y deja solo el bloque con className="imprimible") y "Copiar
 * texto" (al portapapeles, pensado para pegar en un campo sin formato).
 */
export function ReporteImpresion({ texto }: { texto: string }) {
  const [copiadoOk, setCopiadoOk] = useState(false)
  const [copiadoError, setCopiadoError] = useState(false)

  async function copiar() {
    setCopiadoError(false)

    // navigator.clipboard requiere "contexto seguro" (HTTPS o localhost) —
    // en el dominio del Coolify sin HTTPS todavía no existe, igual que pasó
    // con crypto.randomUUID(). Fallback: un textarea oculto + el comando de
    // copiado clásico, que no tiene esa restricción.
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(texto)
        setCopiadoOk(true)
        setTimeout(() => setCopiadoOk(false), 2000)
        return
      } catch {
        // sigue al fallback de abajo
      }
    }

    try {
      const textarea = document.createElement('textarea')
      textarea.value = texto
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(textarea)
      if (!ok) throw new Error('execCommand copy devolvió false')
      setCopiadoOk(true)
      setTimeout(() => setCopiadoOk(false), 2000)
    } catch {
      setCopiadoError(true)
    }
  }

  return (
    <div>
      <div className="no-imprimir acciones-fila" style={{ marginBottom: 12 }}>
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Imprimir
        </button>
        <button type="button" className="btn-link" onClick={copiar}>
          Copiar texto
        </button>
        {copiadoOk && <span className="hint hint-ok">Copiado.</span>}
        {copiadoError && <span className="hint">No se pudo copiar solo — seleccioná el texto de abajo a mano.</span>}
      </div>
      <pre className="imprimible reporte-texto">{texto}</pre>
    </div>
  )
}
