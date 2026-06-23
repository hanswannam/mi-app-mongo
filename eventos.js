// --- Eventos (vistas / compartidos / descargas) y estadísticas ---

import { jsonResponse, texto } from "./lib/utils.js";
import { obtenerSesion } from "./lib/sesion.js";
import { parseObjectId, withUsuarios, withTarjetas, withEventos } from "./lib/db.js";

const TIPOS_EVENTO = ["vista", "compartido", "descarga"];

// Endpoint público a propósito: lo llama la página pública /t cuando
// alguien sin sesión abre el enlace de la tarjeta. Si quien la abre tiene
// sesión activa, se guarda su identidad; si no, queda como anónimo.
export async function handleRegistrarEvento(request, env, id) {
  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID inválido." }, 400);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "El cuerpo de la solicitud debe ser JSON válido." }, 400);
  }

  const tipo = texto(body.tipo).toLowerCase();
  if (!TIPOS_EVENTO.includes(tipo)) {
    return jsonResponse({ error: "Tipo de evento inválido." }, 400);
  }

  const sesion = await obtenerSesion(request, env);
  let viewerNombre = null;
  if (sesion) {
    try {
      const visor = await withUsuarios(env, (collection) => collection.findOne({ telefono: sesion.telefono }));
      if (visor) viewerNombre = visor.nombre;
    } catch {
      // Si falla la consulta del visor, el evento se sigue registrando como anónimo.
    }
  }

  const campoContador = { vista: "vistas", compartido: "compartidos", descarga: "descargas" }[tipo];

  try {
    await withTarjetas(env, (collection) =>
      collection.updateOne({ _id: objectId }, { $inc: { [campoContador]: 1 } })
    );
    await withEventos(env, (collection) =>
      collection.insertOne({
        tarjetaId: objectId,
        tipo,
        fecha: new Date(),
        viewerTelefono: sesion ? sesion.telefono : null,
        viewerNombre
      })
    );
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: "Error al registrar el evento.", message: error.message }, 500);
  }
}

export async function handleEstadisticasTarjeta(request, env, id) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID inválido." }, 400);

  try {
    const tarjeta = await withTarjetas(env, (collection) => collection.findOne({ _id: objectId }));
    if (!tarjeta) return jsonResponse({ error: "Tarjeta no encontrada." }, 404);
    if (tarjeta.propietarioTelefono !== sesion.telefono) {
      return jsonResponse({ error: "No puedes ver las estadísticas de una tarjeta que no es tuya." }, 403);
    }

    const haceTreintaDias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const eventos = await withEventos(env, (collection) =>
      collection.find({ tarjetaId: objectId, fecha: { $gte: haceTreintaDias } }).sort({ fecha: -1 }).toArray()
    );

    const porDia = {};
    for (const ev of eventos) {
      if (ev.tipo !== "vista") continue;
      const clave = ev.fecha.toISOString().slice(0, 10);
      porDia[clave] = (porDia[clave] || 0) + 1;
    }
    const serieVistas = Object.entries(porDia)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([fecha, conteo]) => ({ fecha, conteo }));

    const recientes = eventos.slice(0, 10).map((ev) => ({
      tipo: ev.tipo,
      fecha: ev.fecha,
      viewerNombre: ev.viewerNombre
    }));

    return jsonResponse({
      totalVistas: tarjeta.vistas || 0,
      totalCompartidos: tarjeta.compartidos || 0,
      totalDescargas: tarjeta.descargas || 0,
      serieVistas,
      recientes
    });
  } catch (error) {
    return jsonResponse({ error: "Error al consultar las estadísticas.", message: error.message }, 500);
  }
}
