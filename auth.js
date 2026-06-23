// --- Autenticación ---

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { soloDigitos } from "./src/utils/normalizePhone.js";
import { generarSalt, hashConSalt, firmarSesion } from "./lib/crypto.js";
import { SESION_DURACION_MS, cookieSesion, COOKIE_LOGOUT, obtenerConfig } from "./lib/sesion.js";
import { obtenerSesion } from "./src/middleware/authMiddleware.js";
import { withUsuarios } from "./lib/db.js";
import { infoUsuarioPublica } from "./usuarios.js";

export async function handleRegistro(request, env) {
  const { sessionSecret } = await obtenerConfig(env);
  if (!sessionSecret) {
    return jsonResponse({ error: "Falta configurar SESSION_SECRET en el servidor." }, 500);
  }

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const telefono = soloDigitos(body.telefono);
  const dpi = soloDigitos(body.dpi);
  const nombre = texto(body.nombre);

  if (!nombre) return jsonResponse({ error: "El nombre es obligatorio." }, 400);
  if (telefono.length < 8) return jsonResponse({ error: "El número de teléfono no es válido." }, 400);
  if (dpi.length < 8) return jsonResponse({ error: "El DPI no es válido." }, 400);

  try {
    let usuarioNuevo;
    await withUsuarios(env, async (collection) => {
      const existente = await collection.findOne({ telefono });
      // Una cuenta "completa" (con dpiHash) con ese teléfono ya no se puede
      // volver a registrar. Pero un admin de capítulo puede haber creado de
      // antemano un perfil de networker sin credenciales todavía (ver
      // networkers.js) -- en ese caso, registrarse "completa" ese perfil
      // (conserva capítulo, esfera, etc.) en vez de rechazarlo.
      if (existente && existente.dpiHash) {
        throw new Error("Ya existe una cuenta con ese número de teléfono.");
      }
      const salt = generarSalt();
      const dpiHash = await hashConSalt(dpi, salt);
      if (existente) {
        usuarioNuevo = { ...existente, nombre, dpiHash, dpiSalt: salt, ultimoAcceso: new Date() };
        await collection.updateOne({ telefono }, { $set: { nombre, dpiHash, dpiSalt: salt, ultimoAcceso: new Date() } });
      } else {
        usuarioNuevo = {
          telefono,
          nombre,
          dpiHash,
          dpiSalt: salt,
          rol: "usuario",
          estado: "activo",
          openaiApiKey: "",
          fotoPerfil: "",
          creadoEn: new Date(),
          ultimoAcceso: new Date()
        };
        await collection.insertOne(usuarioNuevo);
      }
    });

    const token = await firmarSesion(
      { telefono, rol: usuarioNuevo.rol, capituloId: usuarioNuevo.capituloId || null, exp: Date.now() + SESION_DURACION_MS },
      sessionSecret
    );
    return jsonResponse(infoUsuarioPublica(usuarioNuevo), 201, { "Set-Cookie": cookieSesion(token) });
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }
}

export async function handleLogin(request, env) {
  const { sessionSecret } = await obtenerConfig(env);
  if (!sessionSecret) {
    return jsonResponse({ error: "Falta configurar SESSION_SECRET en el servidor." }, 500);
  }

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const telefono = soloDigitos(body.telefono);
  const dpi = soloDigitos(body.dpi);
  if (!telefono || !dpi) {
    return jsonResponse({ error: "Teléfono y DPI son obligatorios." }, 400);
  }

  try {
    const usuario = await withUsuarios(env, (collection) => collection.findOne({ telefono }));
    if (!usuario) {
      return jsonResponse({ error: "Usuario o contraseña incorrectos." }, 401);
    }

    const hashCalculado = await hashConSalt(dpi, usuario.dpiSalt);
    if (hashCalculado !== usuario.dpiHash) {
      return jsonResponse({ error: "Usuario o contraseña incorrectos." }, 401);
    }
    if (usuario.estado === "suspendido") {
      return jsonResponse({ error: "Tu cuenta está suspendida. Contacta al administrador." }, 403);
    }

    await withUsuarios(env, (collection) => collection.updateOne({ telefono }, { $set: { ultimoAcceso: new Date() } }));

    const token = await firmarSesion(
      { telefono, rol: usuario.rol, capituloId: usuario.capituloId || null, exp: Date.now() + SESION_DURACION_MS },
      sessionSecret
    );
    return jsonResponse(infoUsuarioPublica(usuario), 200, { "Set-Cookie": cookieSesion(token) });
  } catch (error) {
    return jsonResponse({ error: "Error al iniciar sesión.", message: error.message }, 500);
  }
}

// Sin una API de WhatsApp Business/Twilio (no configurada en este
// proyecto), el servidor no puede "enviar" un mensaje por sí solo. Esta
// ruta solo confirma que la cuenta existe y entrega el teléfono de un
// administrador, para que el frontend abra WhatsApp con el mensaje ya
// escrito y la persona lo envíe ella misma con un toque — el reseteo final
// lo completa un admin con el botón "Resetear DPI" que ya existe en /admin.
export async function handleRecuperarContacto(request, env, telefono) {
  const telefonoLimpio = soloDigitos(telefono);
  if (!telefonoLimpio) return jsonResponse({ error: "Ingresa un número de teléfono válido." }, 400);

  try {
    const usuario = await withUsuarios(env, (collection) => collection.findOne({ telefono: telefonoLimpio }));
    if (!usuario) return jsonResponse({ error: "No existe ninguna cuenta con ese número." }, 404);

    const admin = await withUsuarios(env, (collection) => collection.findOne({ rol: "admin" }, { projection: { telefono: 1 } }));
    if (!admin) return jsonResponse({ error: "No hay un administrador disponible por ahora." }, 503);

    return jsonResponse({ telefonoSoporte: admin.telefono });
  } catch (error) {
    return jsonResponse({ error: "Error al buscar la cuenta.", message: error.message }, 500);
  }
}

export function handleLogout() {
  return jsonResponse({ ok: true }, 200, { "Set-Cookie": COOKIE_LOGOUT });
}

export async function handleYo(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  try {
    const usuario = await withUsuarios(env, (collection) => collection.findOne({ telefono: sesion.telefono }));
    if (!usuario) return jsonResponse({ error: "No autenticado." }, 401);
    if (usuario.estado === "suspendido") {
      return jsonResponse({ error: "Tu cuenta está suspendida. Contacta al administrador." }, 401, { "Set-Cookie": COOKIE_LOGOUT });
    }
    // /api/auth/yo se llama una vez por apertura de la app: es un buen punto,
    // sin saturar la base de datos, para registrar el último acceso real.
    await withUsuarios(env, (collection) => collection.updateOne({ telefono: sesion.telefono }, { $set: { ultimoAcceso: new Date() } }));
    return jsonResponse(infoUsuarioPublica(usuario));
  } catch (error) {
    return jsonResponse({ error: "Error al consultar la sesión.", message: error.message }, 500);
  }
}
