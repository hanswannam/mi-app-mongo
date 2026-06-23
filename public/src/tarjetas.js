// Cliente de la API de tarjetas: solo hace la llamada de red. La mayoría
// devuelve status/ok/data crudos (en vez de lanzar) porque el llamador
// necesita distinguir 401 (sesión vencida), 409 con duplicado, y otros
// errores con reacciones distintas en cada caso.

import { fetchConLimite } from "./utils/network.js";

export async function guardarTarjeta(datos, idDestino) {
  const url = idDestino ? `/api/tarjetas/${idDestino}` : "/api/tarjetas";
  const r = await fetch(url, { method: idDestino ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
  const data = await r.json();
  return { status: r.status, ok: r.ok, data };
}

export async function obtenerTarjetas() {
  const r = await fetchConLimite("/api/tarjetas", { cache: "no-store" });
  return { status: r.status, ok: r.ok, data: r.ok ? await r.json() : null };
}

export async function obtenerDirectorio() {
  const r = await fetchConLimite("/api/directorio", { cache: "no-store" });
  return { status: r.status, ok: r.ok, data: r.ok ? await r.json() : null };
}

// La lista solo trae una miniatura liviana; el detalle de una tarjeta
// puntual necesita las imágenes completas (frente/reverso).
export async function obtenerTarjeta(id) {
  const r = await fetchConLimite(`/api/tarjetas/${id}`, { cache: "no-store" });
  if (!r.ok) throw new Error("No se pudo obtener la tarjeta.");
  return r.json();
}

export async function invitarContacto(id) {
  const r = await fetchConLimite(`/api/tarjetas/${id}/invitar`, { method: "POST" });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "No se pudo generar la invitación.");
  return data;
}

// Envía una copia de una tarjeta guardada a otro usuario registrado de la
// app (por teléfono). Devuelve status/ok/data crudos porque el llamador
// necesita distinguir "no existe ese usuario" (404, ofrece invitar) de
// "ya la tiene" (409) de un envío exitoso.
export async function enviarTarjeta(id, telefono) {
  const r = await fetch(`/api/tarjetas/${id}/enviar`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ telefono })
  });
  const data = await r.json();
  return { status: r.status, ok: r.ok, data };
}
