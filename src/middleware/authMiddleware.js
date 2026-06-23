// Validacion de sesion y verificacion de usuario autenticado/admin.
// (No es un middleware en el sentido de envolver el request/response --
// esta app no tiene ese pipeline; son las mismas funciones que cada
// handler ya llamaba directamente, solo movidas a un lugar dedicado.)

import { jsonResponse } from "../utils/response.js";
import { verificarSesion } from "../../lib/crypto.js";
import { obtenerConfig, leerCookie } from "../../lib/sesion.js";

// Valida el token de sesion (cookie firmada) contra SESSION_SECRET y
// devuelve su payload {telefono, rol, exp}, o null si no hay sesion
// valida.
export async function obtenerSesion(request, env) {
  const { sessionSecret } = await obtenerConfig(env);
  if (!sessionSecret) return null;
  const token = leerCookie(request, "sesion");
  return verificarSesion(token, sessionSecret);
}

// Guard reutilizado por cualquier ruta que exija rol admin (categorías,
// administración). Vive en el middleware de auth (no en un módulo de
// "admin") justamente para que dominios como categorías no tengan que
// depender del módulo admin.
export async function requerirAdmin(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return { error: jsonResponse({ error: "No autenticado." }, 401) };
  if (!esSuperAdmin(sesion)) return { error: jsonResponse({ error: "No tienes permisos de administrador." }, 403) };
  return { sesion };
}

// --- Multi-capítulo (CRM) ---
// "admin" se mantiene como rol equivalente a "superadmin" por compatibilidad
// con las cuentas que ya existían antes del CRM -- nadie pierde acceso al
// agregar este modelo de roles ampliado.
const ROLES_SUPERADMIN = ["admin", "superadmin"];

export function esSuperAdmin(sesion) {
  return Boolean(sesion) && ROLES_SUPERADMIN.includes(sesion.rol);
}

// Igual que requerirAdmin, pero también deja pasar a un admin_capitulo
// siempre que el capituloId que está administrando sea el suyo. Un
// superadmin (o "admin" por compatibilidad) puede administrar cualquier
// capítulo.
export async function requerirAdminCapitulo(request, env, capituloId) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return { error: jsonResponse({ error: "No autenticado." }, 401) };
  if (esSuperAdmin(sesion)) return { sesion };
  if (sesion.rol === "admin_capitulo" && capituloId && sesion.capituloId === capituloId) {
    return { sesion };
  }
  return { error: jsonResponse({ error: "No tienes permisos de administrador en este capítulo." }, 403) };
}
