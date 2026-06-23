import { verificarSesion } from "./crypto.js";
import { jsonResponse } from "./utils.js";

export const SESION_DURACION_MS = 1000 * 60 * 60 * 24 * 30; // 30 días

export function leerCookie(request, nombre) {
  const header = request.headers.get("Cookie") || "";
  for (const parte of header.split(";")) {
    const idx = parte.indexOf("=");
    if (idx === -1) continue;
    if (parte.slice(0, idx).trim() === nombre) {
      return decodeURIComponent(parte.slice(idx + 1).trim());
    }
  }
  return null;
}

export function cookieSesion(token) {
  return `sesion=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESION_DURACION_MS / 1000}`;
}

export const COOKIE_LOGOUT = "sesion=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";

// Cloudflare tiene dos formas de inyectar secrets: como variable de entorno
// plana (env.X es un string) o como binding de "Secrets Store" (env.X es un
// objeto con .get() async). Soportamos ambas para no depender de cuál esté
// disponible en el dashboard.
async function leerSecretoBinding(binding) {
  if (!binding) return null;
  if (typeof binding === "string") return binding;
  if (typeof binding.get === "function") return await binding.get();
  return null;
}

export async function obtenerConfig(env) {
  const [mongoUri, mongoDatabase, sessionSecret] = await Promise.all([
    leerSecretoBinding(env.MONGO_URI),
    leerSecretoBinding(env.MONGO_DATABASE),
    leerSecretoBinding(env.SESSION_SECRET)
  ]);
  return { mongoUri, mongoDatabase, sessionSecret };
}

export async function obtenerSesion(request, env) {
  const { sessionSecret } = await obtenerConfig(env);
  if (!sessionSecret) return null;
  const token = leerCookie(request, "sesion");
  return verificarSesion(token, sessionSecret);
}

// Guard reutilizado por cualquier ruta que exija rol admin (categorías,
// administración). Vive aquí (no en un módulo de "admin") justamente para
// que dominios como categorías no tengan que depender del módulo admin.
export async function requerirAdmin(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return { error: jsonResponse({ error: "No autenticado." }, 401) };
  if (sesion.rol !== "admin") return { error: jsonResponse({ error: "No tienes permisos de administrador." }, 403) };
  return { sesion };
}
