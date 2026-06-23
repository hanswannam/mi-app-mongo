import { fetchConLimite } from "./utils/network.js";

// Pública a propósito (la llama también la página /t sin sesión). Se traga
// el error porque es un registro "best effort": si falla, no debe
// interrumpir lo que el usuario estaba haciendo (compartir, descargar, etc).
export async function registrarEvento(id, tipo) {
  try {
    await fetch(`/api/eventos-tarjeta/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo }) });
  } catch {}
}

export async function obtenerEstadisticas(id) {
  const r = await fetchConLimite(`/api/tarjetas/${id}/estadisticas`);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "No se pudieron cargar las estadísticas.");
  return data;
}
