// Cliente de la API de autenticación: solo hace las llamadas de red y
// devuelve datos o lanza errores con el mensaje del servidor. A propósito
// no decide qué pantalla mostrar (eso sigue en app.js, junto con
// mostrarAuth/mostrarApp) para no crear una dependencia circular entre este
// archivo y app.js.

import { fetchConLimite } from "./utils/network.js";

export async function consultarSesionActual() {
  const r = await fetchConLimite("/api/auth/yo", {}, 12000);
  if (!r.ok) return null;
  return r.json();
}

export async function iniciarSesion(telefono, dpi) {
  const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ telefono, dpi }) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "No se pudo iniciar sesión.");
  return data;
}

export async function registrarUsuario(nombre, telefono, dpi) {
  const r = await fetch("/api/auth/registro", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre, telefono, dpi }) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "No se pudo crear la cuenta.");
  return data;
}

export async function cerrarSesion() {
  await fetch("/api/auth/logout", { method: "POST" });
}

// Sin una API de WhatsApp Business/Twilio, el servidor no puede enviar un
// mensaje por su cuenta. Esto solo confirma que la cuenta existe y entrega
// el teléfono de un administrador, para que el llamador abra WhatsApp con
// el mensaje ya escrito.
export async function solicitarRecuperacion(telefono) {
  const r = await fetchConLimite(`/api/auth/recuperar/${encodeURIComponent(telefono)}`);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "No se pudo procesar la solicitud.");
  return data;
}
