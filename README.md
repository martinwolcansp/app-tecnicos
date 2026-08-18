# App Técnicos — repo de desarrollo

Carga de datos para técnicos (formulario guiado por chat y voz). Ver los
documentos de requerimientos y especificación técnica en la carpeta del
proyecto para el contexto completo. Este repo es el punto de partida de la
**Etapa 1 (entorno local)** de la hoja de ruta.

Formulario piloto cargado: **Informe de Servicio Técnico**, rama **Cámaras**
(la más simple de las dos ramas del relevamiento original — ver
`Estructura de datos informe ST V2.xlsx` / `estructura_informe_ST_1.mermaid`
en la carpeta del proyecto). La rama Alarmas y los 2 puntos sin definir del
original (`Fuente`, `Dvr/Nvr → No`) se suman más adelante — el modelo de
datos está armado para que eso sea agregar filas, no reescribir código.

## Estructura

```
supabase/
  migrations/    esquema de base de datos (versionado, se aplica con supabase CLI)
  seed.sql       datos de ejemplo: el formulario piloto completo
frontend/        app React + TypeScript (Vite). Panel admin y app del técnico
                 van a vivir acá, con vistas según el rol del usuario logueado.
```

## Requisitos en tu máquina

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado y corriendo (Supabase local lo usa para levantar Postgres, Auth, Storage, etc.).
- [Node.js](https://nodejs.org/) 20 o superior.
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started):
  ```
  npm install -g supabase
  ```

## Puesta en marcha (primera vez)

Desde la **raíz del repo** (no desde `frontend/`):

```bash
# 1. Inicializa la config de Supabase CLI (crea supabase/config.toml;
#    no toca migrations/ ni seed.sql, que ya vienen armados)
supabase init

# 2. Levanta el stack local (Postgres, Auth, Storage, Studio, etc. en Docker)
supabase start
```

Al terminar, `supabase start` imprime algo así — copiá esos valores:

```
API URL: http://127.0.0.1:54321
anon key: eyJ...
Studio URL: http://127.0.0.1:54323
```

```bash
# 3. Aplica el esquema (migrations/) y carga el formulario piloto (seed.sql)
supabase db reset
```

```bash
# 4. Configura el frontend con esas credenciales
cd frontend
cp .env.example .env.local
# editar .env.local y pegar API URL y anon key del paso 2

npm install
npm run dev
```

Abrí `http://localhost:5173`: debería mostrar el formulario piloto y sus
preguntas leídas directamente desde tu Supabase local — eso confirma que el
entorno completo (Etapa 1) está funcionando.

Studio (panel visual de la base de datos, útil para inspeccionar las tablas
sin escribir SQL) queda disponible en `http://127.0.0.1:54323`.

## Uso día a día

- `supabase start` / `supabase stop` — prender/apagar el stack local.
- `supabase db reset` — vuelve a aplicar migrations + seed desde cero (borra
  los datos actuales de la base local).
- Cambios de esquema: agregar un archivo nuevo en `supabase/migrations/`
  (no editar los ya aplicados), después `supabase db reset` o
  `supabase migration up`.
- `cd frontend && npm run dev` — levanta la app con hot-reload.

## Por qué este entorno es igual al de producción

Todo esto corre con el mismo Supabase self-hosted que después se despliega
en el servidor Docker de la empresa vía Coolify. El esquema, las políticas
de permisos (Row Level Security) y las Edge Functions que se escriban acá se
trasladan sin reescribir — lo único que cambia es la URL a la que apunta el
frontend (local vs. la del servidor real).

## Estado

Ver la hoja de ruta del proyecto (`Hoja_de_Ruta_App_Tecnicos.html` en la
carpeta del proyecto, y el artefacto persistido en Cowork) para el detalle
de etapas y lo que falta.
