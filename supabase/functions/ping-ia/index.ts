// Prueba de conectividad + sandbox de interacción con la API de Claude (Anthropic) desde el
// servidor propio.
//
// Objetivo: confirmar que el contenedor de Edge Functions de Supabase, corriendo en Coolify
// en el servidor de la empresa (WebInterna), puede salir a internet hacia api.anthropic.com,
// medir cuánto tarda, cuántos tokens consume y qué costo estimado tiene cada llamada — y
// permitir mandar una pregunta libre para previsualizar cómo respondería Claude a un caso
// real (por ejemplo, una respuesta típica de un técnico), como paso previo al diseño formal
// de RF-36. No toca la base de datos ni depende de ningún formulario.
//
// Ver README.md en esta misma carpeta para cómo cargar la API key y desplegar/probar esto
// en el setup self-hosted (self-hosted != Supabase Cloud: la forma de deployar y de pasar
// variables de entorno es distinta).

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

// Alias de modelo (Anthropic los resuelve a un snapshot fijo). Antes de pasar esto a
// producción, conviene fijar el snapshot con fecha exacta (ver docs.claude.com/.../models)
// para que un futuro cambio de default de Anthropic no altere el comportamiento sin aviso.
const MODEL = "claude-haiku-4-5";

// Precio de Claude Haiku 4.5 (verificado en platform.claude.com/docs/about-claude/pricing,
// 26 ago 2026). Actualizar acá si Anthropic cambia el precio del modelo.
const PRICE_USD_PER_MTOK_INPUT = 1.0;
const PRICE_USD_PER_MTOK_OUTPUT = 5.0;

// Timeout generoso a propósito: para ESTA prueba de diagnóstico queremos medir la latencia
// real desde el servidor, no cortarla temprano como sí conviene hacer en el flujo real de
// carga de formulario (ahí el timeout es de 2s, ver RF-36 en la Especificación Técnica).
const TIMEOUT_MS = 15_000;

const DEFAULT_PROMPT = "Respondé solo con la palabra: listo";
const DEFAULT_MAX_TOKENS = 16;
const CUSTOM_MAX_TOKENS = 300; // tope de costo cuando alguien manda una pregunta libre

Deno.serve(async (req: Request) => {
  if (!ANTHROPIC_API_KEY) {
    return json(
      {
        ok: false,
        stage: "config",
        error:
          "Falta la variable de entorno ANTHROPIC_API_KEY en este servicio. Ver README.md de esta carpeta.",
      },
      500,
    );
  }

  // Mensaje opcional: si viene un body con { "message": "..." } se usa ese texto en vez del
  // ping fijo — permite probar interacciones reales (por ej. una respuesta típica de técnico)
  // sin tocar nada del flujo del formulario todavía.
  let customMessage: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.message === "string" && body.message.trim().length > 0) {
      customMessage = body.message.trim().slice(0, 4000); // límite defensivo de largo
    }
  } catch {
    // sin body o body no-JSON: se usa el ping por defecto, no es un error
  }

  const prompt = customMessage ?? DEFAULT_PROMPT;
  const maxTokens = customMessage ? CUSTOM_MAX_TOKENS : DEFAULT_MAX_TOKENS;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = performance.now();

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    const latencyMs = Math.round(performance.now() - start);
    const data = await res.json();

    if (!res.ok) {
      // El servidor SÍ pudo salir a internet (llegamos a tener respuesta HTTP), pero
      // Anthropic devolvió un error — normalmente API key inválida/vencida, o modelo mal
      // escrito. Esto NO es un problema de conectividad de red.
      return json(
        { ok: false, stage: "anthropic_api", status: res.status, error: data, latencyMs },
        502,
      );
    }

    const reply = data?.content?.[0]?.text ?? null;
    const inputTokens: number | null = data?.usage?.input_tokens ?? null;
    const outputTokens: number | null = data?.usage?.output_tokens ?? null;
    const costUsd =
      inputTokens != null && outputTokens != null
        ? round6(
            (inputTokens / 1_000_000) * PRICE_USD_PER_MTOK_INPUT +
              (outputTokens / 1_000_000) * PRICE_USD_PER_MTOK_OUTPUT,
          )
        : null;

    return json({
      ok: true,
      latencyMs,
      model: MODEL,
      prompt,
      reply,
      usage: { inputTokens, outputTokens },
      costUsd,
    });
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    return json(
      {
        ok: false,
        stage: isAbort ? "timeout" : "network",
        error: isAbort
          ? `Sin respuesta en ${TIMEOUT_MS}ms. Es el síntoma esperado si el servidor NO tiene salida a internet hacia api.anthropic.com (firewall/proxy corporativo bloqueando el puerto 443 saliente hacia ese dominio).`
          : `Error de red antes de recibir respuesta: ${String(err)}`,
        latencyMs,
      },
      504,
    );
  } finally {
    clearTimeout(timeoutHandle);
  }
});

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}
