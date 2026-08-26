# App Técnicos — repo de desarrollo

Carga de datos para técnicos (formulario guiado por chat y voz). Ver los
documentos de requerimientos y especificación técnica en la carpeta del
proyecto para el contexto completo.

Formulario piloto cargado: **Informe de Servicio Técnico**, rama **Cámaras**
(la más simple de las dos ramas del relevamiento original — ver
`Estructura de datos informe ST V2.xlsx` / `estructura_informe_ST_1.mermaid`
en la carpeta del proyecto). La rama Alarmas y los 2 puntos sin definir del
original (`Fuente`, `Dvr/Nvr → No`) se suman más adelante — el modelo de
datos está armado para que eso sea agregar filas, no reescribir código.

## Estructura

```
supabase/
  migrations/    esquema de base de datos (SQL, versionado)
  seed.sql       datos de ejemplo: el formulario piloto completo
frontend/        app React + TypeScript (Vite). Panel admin y app del técnico
                 van a vivir acá, con vistas según el rol del usuario logueado.
```

## Backend: Supabase en el servidor de la empresa (Coolify)

No se usa Supabase local (Docker) — el backend corre directamente en el
Supabase self-hosted ya desplegado en el servidor de la empresa vía Coolify.
Los archivos de `supabase/migrations/` y `supabase/seed.sql` son SQL estándar:
se cargan desde el **SQL Editor** del Supabase Studio del servidor, sin
necesidad de Supabase CLI ni Docker.

**Primera vez / cada vez que se agregue una migración nueva:**

1. Entrar al Supabase Studio del servidor (URL que da Coolify) → **SQL Editor**.
2. Pegar y ejecutar el contenido de la migración más reciente en
   `supabase/migrations/` (en orden, si hay más de una).
3. Solo la primera vez: pegar y ejecutar también `supabase/seed.sql`, para
   cargar el formulario piloto. No volver a correrlo después salvo que se
   quiera resetear los datos de prueba (inserta filas nuevas, no es
   idempotente).
4. En **Project Settings → API** del Studio, copiar la **Project URL** y la
   **anon public key** — se usan en el frontend (ver abajo).

## Frontend: desarrollo local con Node.js

El código de la interfaz (`frontend/`) se corre con Node.js en tu compu para
tener recarga en caliente mientras se programa — no necesita Docker, solo
se conecta por red al Supabase del servidor.

Requisitos: [Node.js](https://nodejs.org/) 20 o superior (LTS).

```bash
cd frontend
cp .env.example .env.local
# editar .env.local y pegar la Project URL y la anon key (paso 4 de arriba)

npm install
npm run dev
```

Abrí `http://localhost:5173`: debería mostrar el formulario piloto y sus
preguntas, leídas en vivo desde el Supabase del servidor — eso confirma que
todo el circuito (servidor ↔ frontend) está funcionando.

Si la compu donde corrés `npm run dev` no está en la misma red que el
servidor (por ejemplo, trabajando fuera de la oficina sin VPN), la app no
va a poder conectarse — por ahora el desarrollo del frontend hay que hacerlo
en red con el servidor.

## Uso día a día

- Cambios de esquema: agregar un archivo nuevo en `supabase/migrations/`
  con fecha más reciente (no editar los ya aplicados), pegarlo y ejecutarlo
  en el SQL Editor del Studio del servidor.
- `cd frontend && npm run dev` — levanta la app con hot-reload, apuntando
  siempre al Supabase del servidor.
- Cambios de código: se manejan con GitHub Desktop (editar → revisar diff →
  Commit to main → Push origin).

## Estado

Ver la hoja de ruta del proyecto (`Hoja_de_Ruta_App_Tecnicos.html` en la
carpeta del proyecto, y el artefacto persistido en Cowork) para el detalle
de etapas y lo que falta.
