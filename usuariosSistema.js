// --- Usuarios del sistema (módulo "Usuarios" del CRM) ---
// A diferencia de networkers.js (que siempre asigna rol "networker" y
// administra campos de membresía BNI), aquí se elige el rol: superadmin
// decide cualquier rol en cualquier capítulo; un admin_capitulo solo puede
// crear sub-admins (otros admin_capitulo) o networkers/invitados, y solo
// dentro de su propio capítulo -- nunca otro superadmin, nunca otro capítulo.

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { soloDigitos } from "./src/utils/normalizePhone.js";
import { obtenerSesion, esSuperAdmin } from "./src/middleware/authMiddleware.js";
import { requerirModulo, rolesQuePuedeAsignar, modulosConVistaPorRol } from "./permisos.js";
import { generarSalt, hashConSalt, firmarSesion } from "./lib/crypto.js";
import { SESION_DURACION_MS, cookieSesion, obtenerConfig } from "./lib/sesion.js";
import { withUsuarios } from "./lib/db.js";

const PROYECCION_SIN_CREDENCIALES = { dpiHash: 0, dpiSalt: 0, openaiApiKey: 0 };

// Quién puede ver/crear: superadmin sin capítulo ve "usuarios del sistema"
// (admin/superadmin, sin capítulo asignado); con un capituloId ve a
// quienes pertenecen a ese capítulo. Un admin_capitulo siempre ve solo el
// suyo.
export async function handleListUsuariosSistema(request, env) {
  const denegado = await requerirModulo(request, env, "usuarios", "ver");
  if (denegado) return denegado;

  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const soloSistema = url.searchParams.get("sistema") === "true";
  const capituloId = esSuperAdmin(sesion) ? url.searchParams.get("capituloId") : sesion.capituloId;

  if (!esSuperAdmin(sesion) && !capituloId) {
    return jsonResponse({ error: "Tu cuenta no está asignada a un capítulo." }, 403);
  }

  const filtro = soloSistema && esSuperAdmin(sesion)
    ? { rol: { $in: ["admin", "superadmin"] } }
    : { capituloId };

  try {
    const usuarios = await withUsuarios(env, (collection) =>
      collection.find(filtro, { projection: PROYECCION_SIN_CREDENCIALES }).sort({ nombre: 1 }).toArray()
    );
    return jsonResponse(usuarios);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar usuarios.", message: error.message }, 500);
  }
}

// Qué roles puede asignar quien hace la petición, y qué módulos vería cada
// uno de esos roles por defecto -- para que el formulario de creación
// muestre la vista previa "este rol vera: ..." sin duplicar la matriz en
// el frontend.
export async function handleOpcionesRoles(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const roles = rolesQuePuedeAsignar(sesion.rol);
  return jsonResponse(roles.map((rol) => ({ rol, modulos: modulosConVistaPorRol(rol) })));
}

export async function handleGuardarUsuarioSistema(request, env, telefonoParam) {
  const denegado = await requerirModulo(request, env, "usuarios", "crear");
  if (denegado) return denegado;

  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const telefono = soloDigitos(telefonoParam);
  if (!telefono) return jsonResponse({ error: "Teléfono inválido." }, 400);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const rol = texto(body.rol);
  const rolesPermitidos = rolesQuePuedeAsignar(sesion.rol);
  if (!rolesPermitidos.includes(rol)) {
    return jsonResponse({ error: "No tienes permiso para asignar ese rol." }, 403);
  }

  // Un rol de sistema (admin/superadmin) no pertenece a un capítulo; el
  // resto sí, y un admin_capitulo solo puede asignarlo al suyo.
  const esRolDeSistema = rol === "admin" || rol === "superadmin";
  let capituloId = null;
  if (!esRolDeSistema) {
    capituloId = esSuperAdmin(sesion) ? texto(body.capituloId) : sesion.capituloId;
    if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);
  }

  const nombre = texto(body.nombre);
  if (!nombre) return jsonResponse({ error: "El nombre es obligatorio." }, 400);

  try {
    const existente = await withUsuarios(env, (collection) => collection.findOne({ telefono }));
    const ahora = new Date();

    if (existente) {
      if (!esSuperAdmin(sesion) && existente.capituloId && existente.capituloId !== sesion.capituloId) {
        return jsonResponse({ error: "No tienes acceso a este usuario." }, 403);
      }
      const cambios = { nombre, rol, capituloId, actualizadoEn: ahora };
      await withUsuarios(env, (collection) => collection.updateOne({ telefono }, { $set: cambios }));
      return jsonResponse({ telefono, ...cambios });
    }

    // Mismo patrón que networkers.js: perfil sin credenciales todavía --
    // la persona lo completa registrándose con este mismo teléfono.
    const nuevo = {
      telefono,
      nombre,
      rol,
      capituloId,
      estado: "activo",
      dpiHash: null,
      dpiSalt: null,
      openaiApiKey: "",
      fotoPerfil: "",
      creadoEn: ahora,
      actualizadoEn: ahora
    };
    await withUsuarios(env, (collection) => collection.insertOne(nuevo));
    const { dpiHash, dpiSalt, ...sinCredenciales } = nuevo;
    return jsonResponse(sinCredenciales, 201);
  } catch (error) {
    return jsonResponse({ error: "Error al guardar el usuario.", message: error.message }, 500);
  }
}

// Mismo chequeo de acceso que ya se repetía en handleCambiarEstado: el
// superadmin puede tocar a cualquiera; un admin_capitulo solo a quien
// pertenece a su propio capítulo, y nunca a un superadmin.
function puedeAdministrarUsuario(sesion, objetivo) {
  if (esSuperAdmin(sesion)) return true;
  if (esSuperAdmin(objetivo)) return false;
  return objetivo.capituloId === sesion.capituloId;
}

// Restablece la contraseña (DPI) de alguien. No existe un "ver la
// contraseña actual" -- se guarda como hash de un solo sentido (PBKDF2),
// igual que cualquier sistema serio; nadie, ni el superadmin, puede
// recuperarla. Esto es lo que sí se puede hacer: fijar una nueva.
export async function handleRestablecerPasswordUsuario(request, env, telefonoParam) {
  const denegado = await requerirModulo(request, env, "usuarios", "editar");
  if (denegado) return denegado;

  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const telefono = soloDigitos(telefonoParam);
  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const nuevaContrasena = soloDigitos(body.nuevaContrasena);
  if (nuevaContrasena.length < 8) return jsonResponse({ error: "La nueva contraseña debe tener al menos 8 dígitos." }, 400);

  try {
    const objetivo = await withUsuarios(env, (collection) => collection.findOne({ telefono }));
    if (!objetivo) return jsonResponse({ error: "Usuario no encontrado." }, 404);
    if (!puedeAdministrarUsuario(sesion, objetivo)) {
      return jsonResponse({ error: "No tienes acceso a este usuario." }, 403);
    }

    const salt = generarSalt();
    const dpiHash = await hashConSalt(nuevaContrasena, salt);
    await withUsuarios(env, (collection) =>
      collection.updateOne({ telefono }, { $set: { dpiHash, dpiSalt: salt, actualizadoEn: new Date() } })
    );
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: "Error al restablecer la contraseña.", message: error.message }, 500);
  }
}

// "Ver como": entra a la sesión de otra persona sin necesitar su
// contraseña, para que el administrador vea exactamente lo que esa
// persona ve. Nunca se puede impersonar a un admin/superadmin (evita que
// esto se use para escalar privilegios) ni salir del propio capítulo.
export async function handleVerComoUsuario(request, env, telefonoParam) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);
  if (!esSuperAdmin(sesion) && sesion.rol !== "admin_capitulo") {
    return jsonResponse({ error: "No tienes permisos para esto." }, 403);
  }

  const telefono = soloDigitos(telefonoParam);
  const { sessionSecret } = await obtenerConfig(env);
  if (!sessionSecret) return jsonResponse({ error: "Falta configurar SESSION_SECRET en el servidor." }, 500);

  try {
    const objetivo = await withUsuarios(env, (collection) => collection.findOne({ telefono }));
    if (!objetivo) return jsonResponse({ error: "Usuario no encontrado." }, 404);
    if (esSuperAdmin(objetivo) || objetivo.rol === "admin_capitulo") {
      return jsonResponse({ error: "No se puede entrar como un administrador." }, 403);
    }
    if (!esSuperAdmin(sesion) && objetivo.capituloId !== sesion.capituloId) {
      return jsonResponse({ error: "No tienes acceso a este usuario." }, 403);
    }

    const token = await firmarSesion(
      {
        telefono: objetivo.telefono,
        rol: objetivo.rol,
        capituloId: objetivo.capituloId || null,
        impersonadoPor: sesion.telefono,
        exp: Date.now() + SESION_DURACION_MS
      },
      sessionSecret
    );
    return jsonResponse({ ok: true, nombre: objetivo.nombre }, 200, { "Set-Cookie": cookieSesion(token) });
  } catch (error) {
    return jsonResponse({ error: "Error al cambiar de sesión.", message: error.message }, 500);
  }
}

// Vuelve de "ver como" a la sesión real del administrador.
export async function handleSalirVerComo(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion || !sesion.impersonadoPor) return jsonResponse({ error: "No estás viendo como otro usuario." }, 400);

  const { sessionSecret } = await obtenerConfig(env);
  if (!sessionSecret) return jsonResponse({ error: "Falta configurar SESSION_SECRET en el servidor." }, 500);

  try {
    const admin = await withUsuarios(env, (collection) => collection.findOne({ telefono: sesion.impersonadoPor }));
    if (!admin) return jsonResponse({ error: "No se encontró la cuenta original." }, 404);

    const token = await firmarSesion(
      { telefono: admin.telefono, rol: admin.rol, capituloId: admin.capituloId || null, exp: Date.now() + SESION_DURACION_MS },
      sessionSecret
    );
    return jsonResponse({ ok: true }, 200, { "Set-Cookie": cookieSesion(token) });
  } catch (error) {
    return jsonResponse({ error: "Error al volver a tu cuenta.", message: error.message }, 500);
  }
}

export async function handleCambiarEstadoUsuarioSistema(request, env, telefonoParam) {
  const denegado = await requerirModulo(request, env, "usuarios", "activar");
  if (denegado) return denegado;

  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const telefono = soloDigitos(telefonoParam);
  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const estado = texto(body.estado);
  if (!["activo", "suspendido"].includes(estado)) return jsonResponse({ error: "Estado inválido." }, 400);

  try {
    const objetivo = await withUsuarios(env, (collection) => collection.findOne({ telefono }));
    if (!objetivo) return jsonResponse({ error: "Usuario no encontrado." }, 404);
    if (!puedeAdministrarUsuario(sesion, objetivo)) {
      return jsonResponse({ error: "No tienes acceso a este usuario." }, 403);
    }

    await withUsuarios(env, (collection) => collection.updateOne({ telefono }, { $set: { estado, actualizadoEn: new Date() } }));
    return jsonResponse({ telefono, estado });
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar el estado.", message: error.message }, 500);
  }
}
