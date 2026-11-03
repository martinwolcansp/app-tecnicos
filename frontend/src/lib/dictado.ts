import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Dictado por voz (RF-06/07/08) con la Web Speech API del navegador, en es-AR.
 *
 * Todo el wizard usa SOLO este módulo para la voz. Motivo: el WebView de
 * Android que usa Capacitor NO implementa la Web Speech API, así que en la
 * Etapa 6 (APK) este archivo se reemplaza por el plugin nativo
 * `@capacitor-community/speech-recognition`, manteniendo la misma interfaz
 * (`useDictado`), sin tocar el wizard.
 *
 * Limitaciones conocidas de la Web Speech API:
 *  - Necesita internet: el audio se reconoce en la nube del navegador. Sin
 *    señal el dictado se deshabilita y el técnico sigue tipeando (Etapa 5).
 *  - El micrófono solo se habilita en HTTPS o en localhost. Sobre el
 *    http://…sslip.io actual de Coolify no va a aparecer el botón.
 *  - Anda en Chrome/Edge (Android y PC). Firefox no la soporta.
 */

// Tipos mínimos: la Web Speech API no está en todas las versiones de lib.dom.
type ResultadoReconocimiento = { isFinal: boolean; 0: { transcript: string } }
type EventoResultado = { resultIndex: number; results: ArrayLike<ResultadoReconocimiento> }
type EventoError = { error: string }
type Reconocedor = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: EventoResultado) => void) | null
  onerror: ((e: EventoError) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type ConstructorReconocedor = new () => Reconocedor

function obtenerConstructor(): ConstructorReconocedor | null {
  const w = window as unknown as {
    SpeechRecognition?: ConstructorReconocedor
    webkitSpeechRecognition?: ConstructorReconocedor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** null si el dictado está disponible; si no, el motivo para mostrarle al técnico. */
function calcularMotivoNoDisponible(): string | null {
  if (!obtenerConstructor()) return 'Este navegador no permite dictar por voz. Usá Chrome para dictar.'
  if (!window.isSecureContext) return 'El dictado por voz necesita que la app se abra por HTTPS.'
  if (!navigator.onLine) return 'Sin señal: el dictado por voz no está disponible. Podés seguir tipeando.'
  return null
}

function mensajeDeError(codigo: string): string {
  switch (codigo) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'No hay permiso para usar el micrófono. Habilitalo en la configuración del navegador.'
    case 'no-speech':
      return 'No se escuchó nada. Probá de nuevo.'
    case 'audio-capture':
      return 'No se encontró un micrófono.'
    case 'network':
      return 'Sin conexión: el dictado necesita internet. Podés seguir tipeando.'
    default:
      return 'No se pudo usar el dictado. Probá de nuevo o tipeá la respuesta.'
  }
}

function normalizar(s: string): string {
  return s.toLowerCase().replace(/[.,;:!¡?¿]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Agrega `nuevo` a `acumulado` evitando duplicados:
 *  - si `nuevo` ya contiene todo lo anterior ("hola cómo" después de "hola"),
 *    reemplaza;
 *  - si `nuevo` ya está al final de lo acumulado, lo ignora;
 *  - si no, lo agrega con un espacio.
 */
function unirSinRepetir(acumulado: string, nuevo: string): string {
  if (!nuevo) return acumulado
  if (!acumulado) return nuevo
  const a = normalizar(acumulado)
  const n = normalizar(nuevo)
  if (n.startsWith(a)) return nuevo
  if (a.endsWith(n)) return acumulado
  return `${acumulado} ${nuevo}`
}

export type OpcionesDictado = {
  /** true para textos largos: sigue escuchando hasta que el técnico toca "Detener". */
  continuo: boolean
  /** Se llama una vez al terminar, con todo lo reconocido (vacío no dispara). */
  alTerminar: (texto: string) => void
}

export function useDictado() {
  const [motivoNoDisponible, setMotivoNoDisponible] = useState<string | null>(() => calcularMotivoNoDisponible())
  const [activoId, setActivoId] = useState<string | null>(null)
  const [parcial, setParcial] = useState('')
  const [error, setError] = useState<{ id: string; mensaje: string } | null>(null)
  const reconocedorRef = useRef<Reconocedor | null>(null)

  // Recalcula disponibilidad cuando se pierde o vuelve la señal.
  useEffect(() => {
    const actualizar = () => setMotivoNoDisponible(calcularMotivoNoDisponible())
    window.addEventListener('online', actualizar)
    window.addEventListener('offline', actualizar)
    return () => {
      window.removeEventListener('online', actualizar)
      window.removeEventListener('offline', actualizar)
    }
  }, [])

  // Si el técnico sale del wizard con el micrófono abierto, se corta.
  useEffect(() => () => reconocedorRef.current?.abort(), [])

  const detener = useCallback(() => {
    reconocedorRef.current?.stop()
  }, [])

  const iniciar = useCallback((id: string, opciones: OpcionesDictado) => {
    const motivo = calcularMotivoNoDisponible()
    if (motivo) {
      setMotivoNoDisponible(motivo)
      return
    }
    const Ctor = obtenerConstructor()
    if (!Ctor) return

    // Un solo micrófono abierto a la vez en todo el wizard.
    reconocedorRef.current?.abort()

    const rec = new Ctor()
    rec.lang = 'es-AR'
    rec.continuous = opciones.continuo
    rec.interimResults = true
    rec.maxAlternatives = 1

    let textoFinal = ''

    // El texto se rearma desde cero en cada evento, recorriendo TODOS los
    // resultados (no solo desde resultIndex). Motivo: Chrome en Android, en
    // modo continuo, vuelve a emitir resultados que ya había dado y además
    // cada resultado final suele repetir todo lo anterior ("hola", "hola
    // cómo", "hola cómo estás"). Sumarlos tal cual duplicaba el texto en el
    // campo. `unirSinRepetir` descarta esas repeticiones.
    rec.onresult = (e) => {
      let finales = ''
      let provisorio = ''
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        const t = r[0].transcript.trim()
        if (!t) continue
        if (r.isFinal) finales = unirSinRepetir(finales, t)
        else provisorio = unirSinRepetir(provisorio, t)
      }
      textoFinal = finales
      setParcial(unirSinRepetir(finales, provisorio))
    }

    rec.onerror = (e) => {
      if (e.error === 'aborted') return
      setError({ id, mensaje: mensajeDeError(e.error) })
    }

    rec.onend = () => {
      if (reconocedorRef.current === rec) reconocedorRef.current = null
      setActivoId((actual) => (actual === id ? null : actual))
      setParcial('')
      const texto = textoFinal.trim()
      if (texto) opciones.alTerminar(texto)
    }

    reconocedorRef.current = rec
    setError(null)
    setParcial('')
    setActivoId(id)
    try {
      rec.start()
    } catch {
      reconocedorRef.current = null
      setActivoId(null)
      setError({ id, mensaje: mensajeDeError('') })
    }
  }, [])

  return { motivoNoDisponible, activoId, parcial, error, iniciar, detener }
}
