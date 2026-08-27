// Alta, reseteo de contraseña y baja de usuarios (técnicos/administradores)
// desde el panel de administrador — sin tener que pasar por Supabase Studio
// + SQL Editor + curl a mano cada vez, como veníamos haciendo.
//
// Por qué esto es una Edge Function y no algo directo desde el navegador:
// crear un usuario, resetearle la contraseña o eliminarlo requiere la API
// de administración de Supabase Auth, que solo acepta la service_role key
// — una clave que NUNCA debe viajar al frontend (da acceso total a la base,
// saltando todas las reglas de RLS). Por eso esta lógica vive acá, del lado
// del servidor, con la service_role key guardada como variable de entorno
// de este servicio (mismo mecanismo que ANTHROPIC_API_KEY en ping-ia — ver
// el README de esa carpeta para el paso a paso de cómo cargar variables de
// entorno de forma durable en Coolify).
//
// Cambiar el ROL de un usuario que ya existe NO pasa por acá: eso se hace
// directo desde el frontend con supabase-js, porque las políticas de RLS ya
// le permiten a un administrador actualizar cualquier fila de `profiles`
// sin necesitar la service_role key.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

type Accion = "crear" | "resetear_password" | "eliminar";

Deno.serve(async (req: Request) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
    return json(
      {
        ok: false,
        stage: "config",
        error:
          "Faltan variables de entorno en este servicio (SUPABASE_URL / SUPABASE_ANON_KEY / " +
          "SUPABASE_SERVICE_ROLE_KEY). Ver README.md de la carpeta ping-ia para cómo cargarlas " +
          "de forma durable en Coolify.",
      },
      500,
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!callerToken) {
    return json({ ok: false, stage: "auth", error: "Falta el token de sesión." }, 401);
  }

  // 1) ¿Quién llama? Se valida el token contra el propio Auth del servidor.
  const callerRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${callerToken}` },
  });
  if (!callerRes.ok) {
    return json({ ok: false, stage: "auth", error: "Sesión inválida o vencida — volvé a iniciar sesión." }, 401);
  }
  const caller = await callerRes.json();

  // 2) ¿Es administrador? Se lee con la service_role key para no depender
  //    de que el propio caller ya tenga permisos de lectura.
  const perfilRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=rol`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const perfiles = await perfilRes.json();
  const rolCaller = Array.isArray(perfiles) ? perfiles[0]?.rol : null;
  if (rolCaller !== "administrador" && rolCaller !== "superadministrador") {
    return json({ ok: false, stage: "auth", error: "Esta acción es solo para administradores." }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, stage: "body", error: "Body inválido, se esperaba JSON." }, 400);
  }

  const accion = body.accion as Accion;

  // ---- Crear usuario ----
  if (accion === "crear") {
    const nombre = String(body.nombre ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const rol = body.rol === "administrador" ? "administrador" : "tecnico";

    if (!nombre || !email || password.length < 6) {
      return json(
        { ok: false, stage: "validacion", error: "Faltan datos, o la contraseña tiene menos de 6 caracteres." },
        400,
      );
    }

    const crearRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SERVICE_ROLE_KEY,
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const nuevoUsuario = await crearRes.json();
    if (!crearRes.ok) {
      return json({ ok: false, stage: "crear_auth", error: nuevoUsuario?.msg ?? nuevoUsuario }, crearRes.status);
    }

    const perfilNuevoRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SERVICE_ROLE_KEY,
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        prefer: "return=representation",
      },
      body: JSON.stringify({ id: nuevoUsuario.id, nombre, rol, email }),
    });
    const perfilNuevo = await perfilNuevoRes.json();
    if (!perfilNuevoRes.ok) {
      return json(
        {
          ok: false,
          stage: "crear_perfil",
          error:
            "El usuario se creó en Auth pero no se pudo crear su perfil: " +
            JSON.stringify(perfilNuevo) +
            ". Puede haber que eliminarlo desde Studio (Authentication → Users) y reintentar.",
        },
        500,
      );
    }

    return json({ ok: true, usuario: Array.isArray(perfilNuevo) ? perfilNuevo[0] : perfilNuevo });
  }

  // ---- Resetear contraseña ----
  if (accion === "resetear_password") {
    const userId = String(body.userId ?? "");
    const password = String(body.password ?? "");
    if (!userId || password.length < 6) {
      return json(
        { ok: false, stage: "validacion", error: "Falta el usuario, o la contraseña tiene menos de 6 caracteres." },
        400,
      );
    }
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        apikey: SERVICE_ROLE_KEY,
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) {
      return json({ ok: false, stage: "resetear_password", error: data?.msg ?? data }, res.status);
    }
    return json({ ok: true });
  }

  // ---- Eliminar usuario ----
  if (accion === "eliminar") {
    const userId = String(body.userId ?? "");
    if (!userId) {
      return json({ ok: false, stage: "validacion", error: "Falta el usuario a eliminar." }, 400);
    }
    if (userId === caller.id) {
      return json({ ok: false, stage: "validacion", error: "No podés eliminar tu propio usuario." }, 400);
    }
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
    if (!res.ok) {
      let detalle: unknown = null;
      try {
        detalle = await res.json();
      } catch {
        // sin body en la respuesta
      }
      return json(
        {
          ok: false,
          stage: "eliminar",
          error:
            "No se pudo eliminar. Si ya tiene envíos cargados, la base lo bloquea a propósito — no se puede " +
            "borrar un usuario con historial. Detalle: " +
            JSON.stringify(detalle),
        },
        res.status,
      );
    }
    return json({ ok: true });
  }

  return json({ ok: false, stage: "accion", error: `Acción desconocida: "${accion}".` }, 400);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}
