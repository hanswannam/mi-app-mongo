// --- Permisos por módulo (CRM BNI) ---
// Tres capas, de la más a la menos restrictiva (la primera que niega, gana):
//  1) Matriz de rol (fija en código): qué puede hacer cada rol por módulo.
//  2) Interruptor por capítulo (capituloModulos): el Super Admin puede
//     apagar un módulo completo para un capítulo. Si no hay registro, el
//     módulo está activo por defecto (no rompe capítulos existentes).
//  3) Override por usuario (permisosUsuario): el admin puede limitar, para
//     una persona puntual, CUÁLES acciones le quedan disponibles en un
//     módulo (p.ej. solo "ver", sin "crear"/"editar"). Es un techo: nunca
//     otorga una acción que el rol no daría de por sí, solo puede recortar.

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { soloDigitos } from "./src/utils/normalizePhone.js";
import { obtenerSesion, esSuperAdmin, requerirAdminCapitulo } from "./src/middleware/authMiddleware.js";
import { withCollection } from "./lib/db.js";

export const MODULOS = [
  "dashboard", "capitulos", "usuarios", "networkers", "tarjetas", "esferas",
  "referencias", "gpnc", "unoauno", "visitantes", "calendario", "capacitacion",
  "recursos", "asistencia", "metas", "rankings", "reportes", "configuracion"
];

export const ACCIONES = ["ver", "crear", "editar", "eliminar", "exportar", "activar"];

const set = (...acciones) => new Set(acciones);

// Matriz de permisos por defecto. admin_capitulo y networker no tienen
// entrada para un módulo => sin acceso a ese módulo en absoluto.
const MATRIZ_ROLES = {
  admin_capitulo: {
    dashboard: set("ver"),
    capitulos: set("ver"),
    usuarios: set("ver", "crear", "editar", "activar"),
    networkers: set("ver", "crear", "editar", "activar", "exportar"),
    tarjetas: set("ver"),
    esferas: set("ver", "crear", "editar", "eliminar"),
    referencias: set("ver", "crear", "editar", "exportar"),
    gpnc: set("ver", "crear", "editar", "exportar"),
    unoauno: set("ver", "crear", "editar"),
    visitantes: set("ver", "crear", "editar", "exportar"),
    calendario: set("ver", "crear", "editar", "eliminar"),
    capacitacion: set("ver", "crear", "editar", "eliminar"),
    recursos: set("ver", "crear", "editar", "eliminar"),
    asistencia: set("ver", "crear", "editar", "exportar"),
    metas: set("ver", "crear", "editar"),
    rankings: set("ver"),
    reportes: set("ver", "exportar"),
    configuracion: set("ver", "activar")
  },
  networker: {
    dashboard: set("ver"),
    capitulos: set("ver"),
    networkers: set("ver"),
    tarjetas: set("ver", "crear", "editar"),
    esferas: set("ver"),
    referencias: set("ver", "crear"),
    gpnc: set("ver"),
    unoauno: set("ver", "crear"),
    visitantes: set("ver", "crear"),
    calendario: set("ver"),
    capacitacion: set("ver"),
    recursos: set("ver"),
    asistencia: set("ver"),
    metas: set("ver"),
    rankings: set("ver")
  },
  invitado_especial: {
    dashboard: set("ver"),
    capacitacion: set("ver", "crear", "editar"),
    recursos: set("ver"),
    calendario: set("ver")
  },
  visitante: {
    capitulos: set("ver"),
    networkers: set("ver"),
    tarjetas: set("ver"),
    calendario: set("ver")
  }
};

function matrizDeRol(rol) {
  if (esSuperAdminRol(rol)) return null; // null = sin restricciones, todo permitido
  return MATRIZ_ROLES[rol] || {};
}

export function esSuperAdminRol(rol) {
  return rol === "admin" || rol === "superadmin";
}

// Chequeo síncrono contra la matriz fija (capa 1 solamente). Útil en el
// frontend para decidir qué dibujar, y en el backend como primer filtro
// antes de mirar la base de datos.
export function permiteRol(rol, moduloKey, accion) {
  const matriz = matrizDeRol(rol);
  if (matriz === null) return true;
  return Boolean(matriz[moduloKey]?.has(accion));
}

// Qué módulos ve un rol por defecto (capa 1 solamente) -- para la vista
// previa "este rol verá: ..." al crear un usuario desde el módulo Usuarios.
export function modulosConVistaPorRol(rol) {
  const matriz = matrizDeRol(rol);
  if (matriz === null) return [...MODULOS];
  return MODULOS.filter((m) => matriz[m]?.has("ver"));
}

// Quién puede crear/editar usuarios con qué rol: superadmin puede asignar
// cualquier rol; un admin_capitulo solo puede crear sub-admins de su propio
// capítulo o networkers/invitados -- nunca otro superadmin, ni tocar
// capítulos ajenos (eso ya lo filtra requerirAdminCapitulo aparte).
const ROLES_ASIGNABLES_POR_SUPERADMIN = ["superadmin", "admin_capitulo", "networker", "invitado_especial", "visitante"];
const ROLES_ASIGNABLES_POR_ADMIN_CAPITULO = ["admin_capitulo", "networker", "invitado_especial"];

export function rolesQuePuedeAsignar(rolCreador) {
  if (esSuperAdminRol(rolCreador)) return ROLES_ASIGNABLES_POR_SUPERADMIN;
  if (rolCreador === "admin_capitulo") return ROLES_ASIGNABLES_POR_ADMIN_CAPITULO;
  return [];
}

const withCapituloModulos = (env, fn) => withCollection(env, "capituloModulos", fn);
const withPermisosUsuario = (env, fn) => withCollection(env, "permisosUsuario", fn);

// Una sola consulta trae el estado de TODOS los módulos del capítulo (en vez
// de una consulta por módulo) -- evita N llamadas a Mongo al resolver todo
// el menú de una persona.
async function obtenerMapaCapitulo(env, capituloId) {
  if (!capituloId) return new Map();
  const registros = await withCapituloModulos(env, (c) => c.find({ capituloId }).toArray());
  return new Map(registros.map((r) => [r.moduloKey, r.activo]));
}

async function obtenerMapaUsuario(env, telefono) {
  if (!telefono) return new Map();
  const registros = await withPermisosUsuario(env, (c) => c.find({ telefono }).toArray());
  return new Map(registros.map((r) => [r.moduloKey, new Set(r.acciones || [])]));
}

// Resuelve las tres capas de forma síncrona a partir de mapas ya cargados.
// Si hay un override de usuario para ese módulo, actúa como techo: la
// acción solo se permite si además está en el conjunto que le dejaron
// (p.ej. alguien con override ["ver"] nunca puede "editar", aunque su rol
// si lo permitiría).
function resolverPermiso(rol, moduloKey, accion, mapaCapitulo, mapaUsuario) {
  if (esSuperAdminRol(rol)) return true;
  if (!permiteRol(rol, moduloKey, accion)) return false;
  if (mapaCapitulo.has(moduloKey) && mapaCapitulo.get(moduloKey) === false) return false;
  if (mapaUsuario.has(moduloKey) && !mapaUsuario.get(moduloKey).has(accion)) return false;
  return true;
}

// Resuelve las tres capas para una sesión + módulo + acción puntual. Hace
// como máximo 2 consultas (una por capa con estado en DB); para resolver
// MUCHOS módulos/acciones a la vez usar obtenerMapaCapitulo/obtenerMapaUsuario
// una sola vez y luego resolverPermiso() en memoria (ver handleMisPermisos).
export async function tienePermiso(env, sesion, moduloKey, accion) {
  if (!sesion) return false;
  if (esSuperAdminRol(sesion.rol)) return true;
  if (!permiteRol(sesion.rol, moduloKey, accion)) return false;
  const [mapaCapitulo, mapaUsuario] = await Promise.all([
    obtenerMapaCapitulo(env, sesion.capituloId),
    obtenerMapaUsuario(env, sesion.telefono)
  ]);
  return resolverPermiso(sesion.rol, moduloKey, accion, mapaCapitulo, mapaUsuario);
}

// Guard de una línea para usar al inicio de cualquier handler de módulo:
// const denegado = await requerirModulo(request, env, "gpnc", "crear");
// if (denegado) return denegado;
export async function requerirModulo(request, env, moduloKey, accion) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);
  if (!(await tienePermiso(env, sesion, moduloKey, accion))) {
    return jsonResponse({ error: "No tienes permiso para esta acción." }, 403);
  }
  return null;
}

// Permisos resueltos del usuario actual, para que el frontend construya el
// menú y oculte botones sin tener que duplicar la matriz de roles.
export async function handleMisPermisos(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  try {
    // Dos consultas en total (no una por módulo/acción): se cargan los
    // mapas una sola vez y se resuelve todo en memoria.
    const [mapaCapitulo, mapaUsuario] = await Promise.all([
      obtenerMapaCapitulo(env, sesion.capituloId),
      obtenerMapaUsuario(env, sesion.telefono)
    ]);

    const resultado = {};
    for (const moduloKey of MODULOS) {
      resultado[moduloKey] = ACCIONES.filter((accion) => resolverPermiso(sesion.rol, moduloKey, accion, mapaCapitulo, mapaUsuario));
    }
    return jsonResponse({ rol: sesion.rol, capituloId: sesion.capituloId, permisos: resultado });
  } catch (error) {
    return jsonResponse({ error: "Error al consultar permisos.", message: error.message }, 500);
  }
}

// ---------- Módulos activos por capítulo ----------
export async function handleListCapituloModulos(request, env, capituloId) {
  const { error } = await requerirAdminCapitulo(request, env, capituloId);
  if (error) return error;

  try {
    const registros = await withCapituloModulos(env, (c) => c.find({ capituloId }).toArray());
    const mapa = new Map(registros.map((r) => [r.moduloKey, r.activo]));
    return jsonResponse(MODULOS.map((m) => ({ moduloKey: m, activo: mapa.has(m) ? mapa.get(m) : true })));
  } catch (error) {
    return jsonResponse({ error: "Error al consultar módulos del capítulo.", message: error.message }, 500);
  }
}

export async function handleGuardarCapituloModulo(request, env, capituloId) {
  const { error } = await requerirAdminCapitulo(request, env, capituloId);
  if (error) return error;

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const moduloKey = texto(body.moduloKey);
  if (!MODULOS.includes(moduloKey)) return jsonResponse({ error: "Módulo inválido." }, 400);

  try {
    await withCapituloModulos(env, (c) =>
      c.updateOne({ capituloId, moduloKey }, { $set: { capituloId, moduloKey, activo: Boolean(body.activo) } }, { upsert: true })
    );
    return jsonResponse({ capituloId, moduloKey, activo: Boolean(body.activo) });
  } catch (error) {
    return jsonResponse({ error: "Error al guardar el módulo del capítulo.", message: error.message }, 500);
  }
}

// ---------- Overrides por usuario ----------
// Lista, para un usuario, los módulos que su ROL le da por defecto junto
// con cuáles acciones le quedan realmente disponibles (ya aplicado el
// override, si existe) -- así el panel de "permisos de este usuario" en
// el CRM puede mostrar checkboxes ver/crear/editar/eliminar/exportar/
// activar por módulo, precargados con el estado actual.
export async function handleListPermisosUsuario(request, env, telefonoParam) {
  const telefono = soloDigitos(telefonoParam);
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  try {
    const objetivo = await withUsuariosPublico(env, telefono);
    if (!objetivo) return jsonResponse({ error: "Usuario no encontrado." }, 404);
    if (!esSuperAdminRol(sesion.rol) && sesion.capituloId !== objetivo.capituloId) {
      return jsonResponse({ error: "No tienes acceso a los permisos de este usuario." }, 403);
    }

    const mapaUsuario = await obtenerMapaUsuario(env, telefono);
    const modulosDelRol = modulosConVistaPorRol(objetivo.rol);
    const resultado = modulosDelRol.map((moduloKey) => {
      const accionesDelRol = ACCIONES.filter((a) => permiteRol(objetivo.rol, moduloKey, a));
      const override = mapaUsuario.get(moduloKey);
      const accionesActuales = override ? accionesDelRol.filter((a) => override.has(a)) : accionesDelRol;
      return { moduloKey, accionesDisponibles: accionesDelRol, accionesActuales };
    });
    return jsonResponse(resultado);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar permisos del usuario.", message: error.message }, 500);
  }
}

export async function handleGuardarPermisoUsuario(request, env, telefonoParam) {
  const telefono = soloDigitos(telefonoParam);
  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const capituloId = texto(body.capituloId);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  const { error } = await requerirAdminCapitulo(request, env, capituloId);
  if (error) return error;

  const moduloKey = texto(body.moduloKey);
  if (!MODULOS.includes(moduloKey)) return jsonResponse({ error: "Módulo inválido." }, 400);

  const acciones = Array.isArray(body.acciones) ? body.acciones.filter((a) => ACCIONES.includes(a)) : [];

  try {
    await withPermisosUsuario(env, (c) =>
      c.updateOne(
        { telefono, moduloKey },
        { $set: { telefono, moduloKey, capituloId, acciones } },
        { upsert: true }
      )
    );
    return jsonResponse({ telefono, moduloKey, acciones });
  } catch (error) {
    return jsonResponse({ error: "Error al guardar el permiso del usuario.", message: error.message }, 500);
  }
}

async function withUsuariosPublico(env, telefono) {
  return withCollection(env, "usuarios", (c) => c.findOne({ telefono }, { projection: { telefono: 1, rol: 1, capituloId: 1, nombre: 1 } }));
}
