// Cliente de la API de tarjetas: solo hace la llamada de red y devuelve
// status/ok/data crudos (en vez de lanzar) porque el llamador necesita
// distinguir 401 (sesión vencida), 409 con duplicado, y otros errores con
// reacciones distintas en cada caso.
export async function guardarTarjeta(datos, idDestino) {
  const url = idDestino ? `/api/tarjetas/${idDestino}` : "/api/tarjetas";
  const r = await fetch(url, { method: idDestino ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
  const data = await r.json();
  return { status: r.status, ok: r.ok, data };
}
