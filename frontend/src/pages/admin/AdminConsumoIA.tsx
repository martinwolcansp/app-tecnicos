import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

/**
 * Consumo de la IA (RNF-21/22/23): cuánto se está usando la interpretación
 * por IA (RF-36), cuánto cuesta y qué tan rápido responde. Lee la tabla
 * ia_llamadas, que escribe la Edge Function interpretar-respuesta (una fila
 * por llamada). Solo los administradores pueden leerla (RLS).
 */

// Debe coincidir con IA_PRESUPUESTO_MENSUAL_USD de la Edge Function
// interpretar-respuesta (por defecto 20). Si se cambia allá, cambiarlo acá.
const PRESUPUESTO_MENSUAL_USD = 20

const ZONA = 'America/Argentina/Buenos_Aires'
const MESES_A_MOSTRAR = 6

type Resultado =
  | 'ok'
  | 'sin_interpretacion'
  | 'timeout'
  | 'error_api'
  | 'error_red'
  | 'limite_diario'
  | 'presupuesto'

const RESULTADO_LABEL: Record<Resultado, string> = {
  ok: 'Interpretó',
  sin_interpretacion: 'Sin valor claro',
  timeout: 'Timeout',
  error_api: 'Error de Anthropic',
  error_red: 'Error de red',
  limite_diario: 'Límite diario',
  presupuesto: 'Presupuesto agotado',
}

const RESULTADOS_FALLA: Resultado[] = ['timeout', 'error_api', 'error_red']

type Llamada = {
  id: string
  created_at: string
  user_id: string
  resultado: Resultado
  latencia_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  costo_usd: number
  profiles: { nombre: string } | null
  form_questions: { texto_pregunta: string } | null
}

type Agrupado = { clave: string; etiqueta: string; llamadas: number; costo: number; latencias: number[]; fallas: number }

// --- fechas en hora de Argentina (UTC-3 fijo, sin horario de verano) -------

function claveMes(fecha: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit' }).format(fecha)
}

function claveDia(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date(iso))
}

function rangoDelMes(mes: string): { desde: string; hasta: string } {
  const [anio, m] = mes.split('-').map(Number)
  const sigAnio = m === 12 ? anio + 1 : anio
  const sigMes = m === 12 ? 1 : m + 1
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    desde: `${anio}-${pad(m)}-01T00:00:00-03:00`,
    hasta: `${sigAnio}-${pad(sigMes)}-01T00:00:00-03:00`,
  }
}

function ultimosMeses(n: number): string[] {
  const meses: string[] = []
  const hoy = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 15))
    meses.push(claveMes(d))
  }
  return [...new Set(meses)]
}

function nombreMes(mes: string): string {
  const [anio, m] = mes.split('-').map(Number)
  const texto = new Date(Date.UTC(anio, m - 1, 15)).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

// --- formato -----------------------------------------------------------------

function usd(n: number): string {
  return `US$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 })}`
}

function ms(n: number | null): string {
  return n == null ? '—' : `${Math.round(n).toLocaleString('es-AR')} ms`
}

function promedio(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

function percentil(xs: number[], p: number): number | null {
  if (!xs.length) return null
  const orden = [...xs].sort((a, b) => a - b)
  return orden[Math.min(orden.length - 1, Math.ceil((p / 100) * orden.length) - 1)]
}

function porcentaje(parte: number, total: number): string {
  return total ? `${Math.round((parte / total) * 100)}%` : '—'
}

function agrupar(llamadas: Llamada[], clave: (l: Llamada) => string, etiqueta: (l: Llamada) => string): Agrupado[] {
  const mapa = new Map<string, Agrupado>()
  for (const l of llamadas) {
    const k = clave(l)
    const g = mapa.get(k) ?? { clave: k, etiqueta: etiqueta(l), llamadas: 0, costo: 0, latencias: [], fallas: 0 }
    g.llamadas += 1
    g.costo += l.costo_usd
    if (l.latencia_ms != null && (l.resultado === 'ok' || l.resultado === 'sin_interpretacion')) {
      g.latencias.push(l.latencia_ms)
    }
    if (RESULTADOS_FALLA.includes(l.resultado)) g.fallas += 1
    mapa.set(k, g)
  }
  return [...mapa.values()]
}

export function AdminConsumoIA() {
  const meses = useMemo(() => ultimosMeses(MESES_A_MOSTRAR), [])
  const [mes, setMes] = useState(meses[0])
  const [llamadas, setLlamadas] = useState<Llamada[]>([])
  const [sugerencias, setSugerencias] = useState({ usadas: 0, noUsadas: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { desde, hasta } = rangoDelMes(mes)

    const [{ data: lData, error: lError }, { data: sData, error: sError }] = await Promise.all([
      supabase
        .from('ia_llamadas')
        .select(
          'id, created_at, user_id, resultado, latencia_ms, input_tokens, output_tokens, costo_usd, ' +
            'profiles(nombre), form_questions(texto_pregunta)',
        )
        .gte('created_at', desde)
        .lt('created_at', hasta)
        .order('created_at', { ascending: false })
        .limit(10000),
      supabase
        .from('submission_answers')
        .select('ia_aceptada')
        .not('valor_ia', 'is', null)
        .gte('created_at', desde)
        .lt('created_at', hasta)
        .limit(10000),
    ])

    if (lError || sError) {
      setError((lError ?? sError)?.message ?? 'No se pudo cargar el consumo.')
      setLoading(false)
      return
    }

    const filas = ((lData ?? []) as unknown as Llamada[]).map((l) => ({ ...l, costo_usd: Number(l.costo_usd) || 0 }))
    setLlamadas(filas)

    const respuestas = (sData ?? []) as { ia_aceptada: boolean | null }[]
    setSugerencias({
      usadas: respuestas.filter((r) => r.ia_aceptada === true).length,
      noUsadas: respuestas.filter((r) => r.ia_aceptada === false).length,
    })
    setLoading(false)
  }, [mes])

  useEffect(() => {
    cargar()
  }, [cargar])

  const resumen = useMemo(() => {
    const costo = llamadas.reduce((a, l) => a + l.costo_usd, 0)
    const latencias = llamadas
      .filter((l) => l.latencia_ms != null && (l.resultado === 'ok' || l.resultado === 'sin_interpretacion'))
      .map((l) => l.latencia_ms as number)
    const fallas = llamadas.filter((l) => RESULTADOS_FALLA.includes(l.resultado)).length

    // Proyección a fin de mes, solo para el mes en curso.
    let proyeccion: number | null = null
    if (mes === meses[0] && costo > 0) {
      const [anio, m] = mes.split('-').map(Number)
      const diasDelMes = new Date(Date.UTC(anio, m, 0)).getUTCDate()
      const diaActual = Number(new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, day: '2-digit' }).format(new Date()))
      proyeccion = (costo / diaActual) * diasDelMes
    }

    return {
      costo,
      proyeccion,
      llamadas: llamadas.length,
      costoPorLlamada: llamadas.length ? costo / llamadas.length : 0,
      demoraPromedio: promedio(latencias),
      demoraP90: percentil(latencias, 90),
      fallas,
    }
  }, [llamadas, mes, meses])

  const porResultado = useMemo(() => {
    const conteo = new Map<Resultado, number>()
    for (const l of llamadas) conteo.set(l.resultado, (conteo.get(l.resultado) ?? 0) + 1)
    return (Object.keys(RESULTADO_LABEL) as Resultado[])
      .map((r) => ({ resultado: r, cantidad: conteo.get(r) ?? 0 }))
      .filter((x) => x.cantidad > 0)
  }, [llamadas])

  const porTecnico = useMemo(
    () =>
      agrupar(
        llamadas,
        (l) => l.user_id,
        (l) => l.profiles?.nombre ?? '—',
      ).sort((a, b) => b.costo - a.costo),
    [llamadas],
  )

  const porDia = useMemo(
    () =>
      agrupar(
        llamadas,
        (l) => claveDia(l.created_at),
        (l) => new Date(l.created_at).toLocaleDateString('es-AR', { timeZone: ZONA }),
      ).sort((a, b) => b.clave.localeCompare(a.clave)),
    [llamadas],
  )

  const usoPresupuesto = Math.min(100, (resumen.costo / PRESUPUESTO_MENSUAL_USD) * 100)
  const totalSugerencias = sugerencias.usadas + sugerencias.noUsadas

  return (
    <div>
      <div className="page-header">
        <h1>Consumo IA</h1>
        <div className="acciones-fila">
          <select value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mes">
            {meses.map((m) => (
              <option key={m} value={m}>
                {nombreMes(m)}
              </option>
            ))}
          </select>
          <button className="btn-secondary btn-sm" onClick={cargar} disabled={loading}>
            Actualizar
          </button>
        </div>
      </div>
      <p className="hint">
        Interpretación de respuestas dictadas (RF-36). Cada fila de <code>ia_llamadas</code> es una llamada a Claude
        Haiku desde el servidor.
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p>Cargando…</p>}

      {!loading && !error && (
        <>
          <div className="kpis">
            <div className="kpi">
              <span className="kpi-etiqueta">Costo del mes</span>
              <span className="kpi-valor">{usd(resumen.costo)}</span>
              <div
                className="barra-presupuesto"
                role="progressbar"
                aria-valuenow={Math.round(usoPresupuesto)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className={usoPresupuesto >= 80 ? 'barra-presupuesto-relleno alto' : 'barra-presupuesto-relleno'}
                  style={{ width: `${usoPresupuesto}%` }}
                />
              </div>
              <span className="kpi-detalle">
                {Math.round(usoPresupuesto)}% del tope de {usd(PRESUPUESTO_MENSUAL_USD)}
                {resumen.proyeccion != null && <> · proyección a fin de mes: {usd(resumen.proyeccion)}</>}
              </span>
            </div>
            <div className="kpi">
              <span className="kpi-etiqueta">Llamadas</span>
              <span className="kpi-valor">{resumen.llamadas.toLocaleString('es-AR')}</span>
              <span className="kpi-detalle">{usd(resumen.costoPorLlamada)} por llamada en promedio</span>
            </div>
            <div className="kpi">
              <span className="kpi-etiqueta">Demora</span>
              <span className="kpi-valor">{ms(resumen.demoraPromedio)}</span>
              <span className="kpi-detalle">promedio · 90% por debajo de {ms(resumen.demoraP90)}</span>
            </div>
            <div className="kpi">
              <span className="kpi-etiqueta">Fallas</span>
              <span className="kpi-valor">{porcentaje(resumen.fallas, resumen.llamadas)}</span>
              <span className="kpi-detalle">{resumen.fallas} por timeout o error</span>
            </div>
            <div className="kpi">
              <span className="kpi-etiqueta">Sugerencias usadas</span>
              <span className="kpi-valor">{porcentaje(sugerencias.usadas, totalSugerencias)}</span>
              <span className="kpi-detalle">
                {sugerencias.usadas} de {totalSugerencias} en envíos de este mes
              </span>
            </div>
          </div>

          {llamadas.length === 0 ? (
            <p className="hint" style={{ marginTop: 24 }}>
              No hubo llamadas a la IA en {nombreMes(mes).toLowerCase()}.
            </p>
          ) : (
            <>
              <h2>Por resultado</h2>
              <table>
                <thead>
                  <tr>
                    <th>Resultado</th>
                    <th>Llamadas</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {porResultado.map((r) => (
                    <tr key={r.resultado}>
                      <td>{RESULTADO_LABEL[r.resultado]}</td>
                      <td>{r.cantidad}</td>
                      <td>{porcentaje(r.cantidad, resumen.llamadas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h2>Por técnico</h2>
              <table>
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Llamadas</th>
                    <th>Costo</th>
                    <th>Demora prom.</th>
                    <th>Fallas</th>
                  </tr>
                </thead>
                <tbody>
                  {porTecnico.map((g) => (
                    <tr key={g.clave}>
                      <td>{g.etiqueta}</td>
                      <td>{g.llamadas}</td>
                      <td className="celda-nowrap">{usd(g.costo)}</td>
                      <td className="celda-nowrap">{ms(promedio(g.latencias))}</td>
                      <td>{g.fallas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h2>Por día</h2>
              <table>
                <thead>
                  <tr>
                    <th>Día</th>
                    <th>Llamadas</th>
                    <th>Costo</th>
                    <th>Demora prom.</th>
                    <th>Fallas</th>
                  </tr>
                </thead>
                <tbody>
                  {porDia.map((g) => (
                    <tr key={g.clave}>
                      <td className="celda-nowrap">{g.etiqueta}</td>
                      <td>{g.llamadas}</td>
                      <td className="celda-nowrap">{usd(g.costo)}</td>
                      <td className="celda-nowrap">{ms(promedio(g.latencias))}</td>
                      <td>{g.fallas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h2>Últimas llamadas</h2>
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Usuario</th>
                    <th>Pregunta</th>
                    <th>Resultado</th>
                    <th>Demora</th>
                    <th>Tokens (ent./sal.)</th>
                    <th>Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {llamadas.slice(0, 25).map((l) => (
                    <tr key={l.id}>
                      <td className="celda-nowrap">{new Date(l.created_at).toLocaleString('es-AR', { timeZone: ZONA })}</td>
                      <td>{l.profiles?.nombre ?? '—'}</td>
                      <td>{l.form_questions?.texto_pregunta ?? '—'}</td>
                      <td className="celda-nowrap">{RESULTADO_LABEL[l.resultado] ?? l.resultado}</td>
                      <td className="celda-nowrap">{ms(l.latencia_ms)}</td>
                      <td className="celda-nowrap">
                        {l.input_tokens ?? '—'} / {l.output_tokens ?? '—'}
                      </td>
                      <td className="celda-nowrap">{usd(l.costo_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  )
}
