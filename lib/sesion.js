import { verificarSesion } from "./crypto.js";

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
