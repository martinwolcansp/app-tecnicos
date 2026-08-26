# Prueba de conectividad IA — `ping-ia`

Antes de construir nada del módulo de IA en serio (RF-36/37/38), esta función responde una
sola pregunta: **¿el servidor de la empresa (WebInterna, vía Coolify) puede salir a internet
hacia `api.anthropic.com`, y qué tan rápido responde?**

Es a propósito lo mínimo posible: no toca la base de datos, no depende de ningún formulario,
solo hace una llamada de un renglón a Claude Haiku 4.5 y devuelve si funcionó y cuánto tardó.

## Cómo es la "ida y vuelta" con la IA (para pedirle lo justo a Redes)

Importante para no pedir de más: esto es una llamada HTTPS saliente común y corriente, igual
que cuando cualquier PC de la oficina abre una página web. El servidor abre la conexión hacia
afuera, manda la pregunta y recibe la respuesta **en esa misma conexión** — no hace falta
abrir ningún puerto de entrada ni registrar la IP del servidor en ningún lado de Anthropic.
Todo el requisito de red se resume en: **salida saliente permitida por TCP 443 (HTTPS) desde
el servidor hacia `api.anthropic.com`.**

## 0. Qué pedirle a Redes/IT antes de probar

Como es un servidor interno, es razonable asumir que por default tiene la salida a internet
restringida (así debería ser, por seguridad). Lo que hace falta pedir, en este orden:

1. **Salida HTTPS (TCP 443) permitida desde el servidor WebInterna hacia el dominio
   `api.anthropic.com`.** Pedirlo por dominio, no por IP — Anthropic no publica un rango de
   IPs fijo (están detrás de un CDN, la IP puede cambiar), así que un filtro por IP se rompe
   solo. Si el firewall de la empresa filtra por dominio/SNI (lo más común en firewalls
   corporativos modernos), alcanza con agregar ese dominio a la lista permitida de salida.
2. **Preguntar si existe un proxy de salida obligatorio** para que cualquier servidor de la
   red interna llegue a internet. Si lo hay, vamos a necesitar la URL y el puerto del proxy
   para configurarlo en el contenedor (ver nota en el paso 3 más abajo).
3. **Preguntar si hay inspección/interceptación TLS (SSL inspection)** en el firewall de
   salida. Si la hay, la conexión a Anthropic va a fallar por certificado inválido a menos
   que se instale el certificado raíz corporativo dentro del contenedor, o se excluya este
   dominio de la inspección.
4. **Confirmar que el DNS que usa el servidor resuelve dominios públicos de internet** (a
   veces el DNS interno de una empresa solo resuelve nombres internos y hace falta un
   resolver secundario para lo externo).

Con esos cuatro puntos resueltos (o confirmados que ya están bien), el resto es solo
verificar con las pruebas de abajo.

## 1. Probar la conexión cruda primero, sin tocar Supabase

Esto es lo más rápido para saber si hay un bloqueo de red, sin necesidad de configurar nada
de Coolify/Supabase todavía. Por SSH al servidor WebInterna:

```bash
# 1a. DNS: ¿el servidor puede resolver el dominio?
getent hosts api.anthropic.com

# 1b. TCP + TLS: ¿el servidor puede completar la conexión y recibir una respuesta HTTP?
curl -v https://api.anthropic.com/v1/messages -o /dev/null -w "\nHTTP %{http_code}  total:%{time_total}s\n"
```

No hace falta una API key para este paso — sin ella, Anthropic va a devolver un error 401
("falta la API key"), y **eso ya es una buena noticia**: significa que la conexión llegó y
volvió bien, el único problema sería la autenticación (que resolvemos en el paso 3).

Lo que puede pasar y qué significa:
- **Se cuelga sin responder / timeout** → bloqueo de firewall de salida. Volver al punto 0
  con Redes, con este resultado como evidencia concreta.
- **`curl: (7) Failed to connect` o "no route to host"** → bloqueo explícito, mismo caso
  que arriba.
- **Error de certificado (`SSL certificate problem`)** → probable inspección TLS
  corporativa (punto 0.3).
- **HTTP 401 (Unauthorized)** → todo bien de red, falta la API key. Seguir al paso 2/3.

## 2. Repetir la misma prueba, pero adentro del contenedor Docker

Docker a veces tiene su propia configuración de red (DNS, reglas) distinta a la del host —
puede andar en el servidor y no andar adentro del contenedor. Por eso conviene repetir el
mismo chequeo ahí adentro antes de asumir que ya está resuelto:

```bash
docker ps                              # ubicar el contenedor de Edge Functions de Supabase
docker exec -it <nombre-contenedor> sh # entrar
# adentro, repetir el mismo curl del paso 1b (si no hay curl instalado, probar con wget)
```

Si el paso 1 anduvo bien pero este falla, el problema no es el firewall perimetral sino la
configuración de red específica de ese contenedor/servicio en Coolify (red aislada, DNS
propio del contenedor, etc.) — es un ajuste de configuración, no un pedido a Redes.

## 3. Conseguir una API key de Anthropic

En <https://console.anthropic.com>, generar una API key. Esa key es un secreto: no la
pegues en el chat de Claude ni en ningún documento del repo — solo va a la configuración
del servidor (paso 4).

## 4. Cargarla en el servidor (self-hosted, vía Coolify)

En un self-hosted Supabase, las Edge Functions corren en un contenedor que lee sus
variables de entorno de un archivo `.env.functions` (o variables inline en el
`docker-compose.yml` del servicio `functions`) — **no** existe el concepto de
`supabase secrets set` de Supabase Cloud acá.

Pasos:
1. En Coolify, entrar al servicio de Supabase de `app-tecnicos` → la parte de
   Environment Variables del contenedor `functions` (o el archivo `.env.functions` que
   Coolify te deje editar para ese stack).
2. Agregar `ANTHROPIC_API_KEY=<la key generada en el paso 3>`.
3. Si el punto 0.2 confirmó que hace falta un proxy de salida obligatorio, agregar también
   `HTTPS_PROXY=http://<host-del-proxy>:<puerto>` en ese mismo lugar (Deno respeta esa
   variable de entorno para las conexiones salientes).
4. Reiniciar/recrear solo ese servicio (`functions`) para que tome las variables nuevas —
   no hace falta redeployar todo el stack.

## 5. Subir la función al servidor

En un self-hosted, las funciones no se "deployan" con un comando de la CLI apuntando a un
proyecto remoto como en Supabase Cloud — el contenedor de Edge Functions lee directamente
una carpeta montada del servidor (`volumes/functions/<nombre>/index.ts`).

Opción simple sin cambiar el flujo de trabajo actual:
1. Este archivo `index.ts` ya queda guardado en el repo, en
   `supabase/functions/ping-ia/index.ts` — commiteálo con GitHub Desktop como siempre.
2. Copiá esa misma carpeta al servidor, dentro de la carpeta `volumes/functions/` del
   stack de Supabase de `app-tecnicos` (por SSH/SCP, o copiando el archivo a mano si
   tenés una terminal ahí). Quedaría como
   `volumes/functions/ping-ia/index.ts` en el servidor.
3. Reiniciar el servicio `functions` (en Coolify, o `sh run.sh restart functions` si
   tenés esa utilidad del self-hosted de Supabase disponible ahí).

## 6. Probarla de verdad

Con el anon key de tu proyecto Supabase (lo sacás de Environment Variables en Coolify,
mismo lugar de donde falta sacar la Project URL para la Etapa 8):

```bash
curl -i -X POST https://<tu-dominio-supabase>/functions/v1/ping-ia \
  -H "Authorization: Bearer <tu-anon-key>"
```

## 7. Qué nos dice el resultado

- `{"ok": true, "latencyMs": ..., "reply": "listo"}` → el servidor SÍ puede hablar con
  Claude, de punta a punta, con la key real. El número de `latencyMs` es la latencia real
  desde tu infraestructura — nos sirve para confirmar (o ajustar) el timeout de 2 segundos
  que definimos para RF-36.
- `"stage": "timeout"` → el mismo síntoma que en el paso 1, pero ahora desde dentro del flujo
  completo. Si los pasos 1 y 2 ya habían andado bien, revisar que la variable de entorno
  `ANTHROPIC_API_KEY`/`HTTPS_PROXY` haya quedado bien cargada tras el reinicio del servicio.
- `"stage": "anthropic_api"` → el servidor sí salió a internet, pero Anthropic devolvió un
  error (API key mal cargada, vencida, o mal escrita) — no es un problema de red.
- `"stage": "config"` → la variable de entorno no quedó bien cargada en el paso 4.

Cualquiera sea el resultado, avisame y seguimos desde ahí: si da bien, pasamos a diseñar
RF-36 en serio sobre esta misma base; si da mal, vemos con qué información contamos (a qué
paso llegamos, 1/2/6, y qué error dio) para resolver el bloqueo antes de seguir.

## 8. Página de test sin terminal (`test_conectividad.html`) — confirmado 26 ago 2026

Conectividad y latencia ya quedaron confirmadas con datos reales del servidor (ver bitácora).
Para no tener que repetir el curl del paso 6 por SSH cada vez, esta carpeta tiene además
`test_conectividad.html`: una página local (sin dependencias, no requiere instalar nada) que
llama a `ping-ia` con un botón, muestra el resultado con colores y guarda un historial de las
pruebas hechas en esa sesión del navegador.

También suma dos cosas que el test por curl no daba:

- **Tokens y costo estimado por llamada** — la función ahora devuelve `usage.inputTokens`,
  `usage.outputTokens` y `costUsd` (calculado con el precio publicado de Claude Haiku 4.5:
  $1/millón de tokens de entrada, $5/millón de salida — verificado en
  platform.claude.com/docs/about-claude/pricing el 26 ago 2026). Es la primera medición real
  para los requisitos de costo (RNF-21/22/23) — antes eran estimaciones de papel.
- **Modo "Pregunta libre"** — permite mandar cualquier texto (por ejemplo, una respuesta
  típica de técnico) y ver la respuesta real de Claude, sin ningún prompt de sistema agregado.
  Es un sandbox crudo para probar enfoques antes de diseñar el prompt final de RF-36 — no es
  el comportamiento final del módulo. Tiene un tope de 300 tokens de respuesta para no
  disparar el costo por error.

### Para actualizar la función en el servidor con estos cambios

El código de `index.ts` cambió (agrega tokens/costo y el modo de mensaje libre). Como el
router de Supabase self-hosted puede mantener el worker "caliente" en memoria con el código
viejo, después de reemplazar el archivo en el servidor conviene reiniciar el servicio para
asegurar que tome el cambio:

1. Reemplazar `volumes/functions/ping-ia/index.ts` en el servidor con la versión nueva (mismo
   método que usaste para subirla la primera vez).
2. `docker compose up -d supabase-edge-functions` desde la carpeta del stack de `app-tecnicos`
   (mismo comando que usamos para cargar la API key) — esto recrea el worker con el código
   actualizado.
3. Probar con la página o con el curl del paso 6; si ves `usage`/`costUsd` en la respuesta,
   quedó aplicado.

### Para compartirla con el resto del equipo

Antes de subirla a cualquier lado, **editá la constante `SHARED_PASSWORD` al principio del
`<script>`** del HTML y poné una clave del equipo (no la dejes con el valor de ejemplo). Es un
freno simple para que no quede abierta a cualquiera con el link, no una autenticación fuerte —
la protección real sigue siendo que el servidor solo es alcanzable desde la red de la
oficina/VPN.

Para publicarla en una URL interna, la forma más simple con la infraestructura que ya tenés es
crear un recurso nuevo de tipo "sitio estático" en Coolify (dentro del proyecto `app-tecnicos`,
separado del servicio de Supabase — no toca nada de lo que ya está andando) apuntando a esta
carpeta o a un repo/carpeta que contenga el HTML, y Coolify le va a asignar una URL tipo
`*.sslip.io` igual que a los demás servicios. Avisame cuando quieras hacer ese paso y te guío.
