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
  if (sesion.rol !== "admin") return { error: jsonResponse({ error: "No tienes permisos de administrador." }, 403) };
  return { sesion };
}
