import { supabase } from './supabaseClient'
import type { TipoCampo } from './types'

/**
 * Cliente de RF-36: pide a la Edge Function `interpretar-respuesta` que
 * convierta lo que dijo el técnico en el valor que espera la pregunta.
 *
 * Reglas (Especificación Técnica, RF-36/38 y RNF-24):
 *  - Nunca bloquea el wizard: se llama en segundo plano y, pase lo que pase,
 *    devuelve un resultado (nunca tira excepción).
 *  - Timeout de 2 s para respuestas estructuradas, con 1 reintento.
 *    La corrección de textos genera más tokens y tiene más margen.
 *  - Circuit breaker: tras 3 llamadas fallidas seguidas, deja de intentar
 *    durante 60 s y el wizard sigue con lo que el técnico dictó o tipeó.
 */

export type ResultadoIA =
  | { estado: 'ok'; valor: string | string[] }
  | { estado: 'sin_interpretacion' }
  | { estado: 'no_disponible'; motivo: string }

type RespuestaFuncion = {
  ok: boolean
  resultado?: string
  valor?: string | string[] | null
  error?: string
}

const FALLAS_PARA_CORTAR = 3
const PAUSA_CIRCUIT_BREAKER_MS = 60_000

const circuito = { fallasSeguidas: 0, pausadoHasta: 0 }

function timeoutClienteMs(tipo: TipoCampo): number {
  if (tipo === 'texto_largo') return 9000
  if (tipo === 'texto_corto') return 5000
  return 2000
}

function registrarFalla() {
  circuito.fallasSeguidas += 1
  if (circuito.fallasSeguidas >= FALLAS_PARA_CORTAR) {
    circuito.pausadoHasta = Date.now() + PAUSA_CIRCUIT_BREAKER_MS
    circuito.fallasSeguidas = 0
  }
}

async function llamarUnaVez(
  questionId: string,
  texto: string,
  timeoutMs: number,
): Promise<RespuestaFuncion | null> {
  try {
    const { data, error } = await supabase.functions.invoke<RespuestaFuncion>('interpretar-respuesta', {
      body: { question_id: questionId, texto },
      timeout: timeoutMs,
    })
    if (error || !data) return null
    return data
  } catch {
    return null
  }
}

export async function interpretarRespuesta(
  questionId: string,
  texto: string,
  tipo: TipoCampo,
): Promise<ResultadoIA> {
  if (!navigator.onLine) return { estado: 'no_disponible', motivo: 'Sin señal.' }
  if (Date.now() < circuito.pausadoHasta) {
    return { estado: 'no_disponible', motivo: 'La interpretación automática está pausada un momento.' }
  }

  const timeoutMs = timeoutClienteMs(tipo)

  for (let intento = 1; intento <= 2; intento++) {
    const r = await llamarUnaVez(questionId, texto, timeoutMs)

    if (r?.ok) {
      circuito.fallasSeguidas = 0
      if (r.resultado === 'ok' && r.valor != null) return { estado: 'ok', valor: r.valor }
      return { estado: 'sin_interpretacion' }
    }

    // Topes alcanzados: no tiene sentido reintentar ni cuentan como caída.
    if (r?.resultado === 'limite_diario' || r?.resultado === 'presupuesto') {
      return { estado: 'no_disponible', motivo: r.error ?? 'Se alcanzó el límite de uso de la IA.' }
    }
  }

  registrarFalla()
  return { estado: 'no_disponible', motivo: 'No se pudo interpretar a tiempo.' }
}

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,;:!¡?¿"'«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Si lo dictado ES exactamente una de las opciones (ej. "sí", "cámaras"),
 * no hace falta llamar a la IA: se propone directo, sin costo ni demora.
 */
export function coincidenciaLocal(opciones: string[], texto: string): string | null {
  const n = normalizar(texto)
  return opciones.find((o) => normalizar(o) === n) ?? null
}
