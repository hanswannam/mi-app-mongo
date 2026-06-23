// --- Calendario / Agenda (CRM BNI) ---
// Colección separada de "eventos" (que es el tracking de vista/compartido/
// descarga de una tarjeta) -- esto es el calendario de actividades del
// capítulo: reuniones semanales, 1 a 1, capacitaciones, lanzamientos,
// eventos regionales y seguimientos de referencias/visitantes.

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { obtenerSesion, esSuperAdmin } from "./src/middleware/authMiddleware.js";
import { parseObjectId, withCollection } from "./lib/db.js";

const withAgenda = (env, fn) => withCollection(env, "agenda", fn);

const TIPOS_VALIDOS = [
  "reunion_semanal",
  "uno_a_uno",
  "capacitacion",
  "lanzamiento",
  "regional",
  "seguimiento_referencia",
  "seguimiento_visitante",
  "otro"
];

function capituloDe(sesion, url) {
  return esSuperAdmin(sesion) ? url.searchParams.get("capituloId") : sesion.capituloId;
}

function camposAgenda(body) {
  const tipo = texto(body.tipo).toLowerCase();
  return {
    tipo: TIPOS_VALIDOS.includes(tipo) ? tipo : "otro",
    titulo: texto(body.titulo),
    descripcion: texto(body.descripcion),
    fecha: body.fecha ? new Date(body.fecha) : new Date(),
    hora: texto(body.hora),
    lugarOLink: texto(body.lugarOLink),
    referenciaId: texto(body.referenciaId) || null,
    visitanteId: texto(body.visitanteId) || null,
    completado: Boolean(body.completado)
  };
}

// Lista la agenda del capítulo. Filtros opcionales: ?desde=&hasta= (rango
// de fechas, para vistas de mes/semana) y ?proximos=true (solo futuros,
// orden ascendente, para la lista de "próximos eventos").
export async function handleListAgenda(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = capituloDe(sesion, url);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  const filtro = { capituloId };
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");
  if (desde || hasta) {
    filtro.fecha = {};
    if (desde) filtro.fecha.$gte = new Date(desde);
    if (hasta) filtro.fecha.$lte = new Date(hasta);
  }
  if (url.searchParams.get("proximos") === "true") {
    filtro.fecha = { ...(filtro.fecha || {}), $gte: new Date() };
  }

  try {
    const orden = url.searchParams.get("proximos") === "true" ? 1 : -1;
    const registros = await withAgenda(env, (collection) => collection.find(filtro).sort({ fecha: orden }).toArray());
    return jsonResponse(registros);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar la agenda.", message: error.message }, 500);
  }
}

export async function handleCrearAgenda(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);
  if (!sesion.capituloId && !esSuperAdmin(sesion)) {
    return jsonResponse({ error: "Tu cuenta no está asignada a un capítulo." }, 403);
  }

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const capituloId = esSuperAdmin(sesion) ? texto(body.capituloId) || sesion.capituloId : sesion.capituloId;
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  const campos = camposAgenda(body);
  if (!campos.titulo) return jsonResponse({ error: "El título es obligatorio." }, 400);

  try {
    const ahora = new Date();
    const registro = { capituloId, ...campos, creadoPorTelefono: sesion.telefono, creadoEn: ahora, actualizadoEn: ahora };
    const insertedId = await withAgenda(env, (collection) => collection.insertOne(registro).then((r) => r.insertedId));
    return jsonResponse({ ...registro, _id: insertedId }, 201);
  } catch (error) {
    return jsonResponse({ error: "Error al crear el evento.", message: error.message }, 500);
  }
}

export async function handleActualizarAgenda(request, env, id) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID de evento inválido." }, 400);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  try {
    const registro = await withAgenda(env, (collection) => collection.findOne({ _id: objectId }));
    if (!registro) return jsonResponse({ error: "Evento no encontrado." }, 404);
    if (!esSuperAdmin(sesion) && sesion.capituloId !== registro.capituloId) {
      return jsonResponse({ error: "No tienes acceso a este evento." }, 403);
    }

    const campos = camposAgenda(body);
    if (!campos.titulo) return jsonResponse({ error: "El título es obligatorio." }, 400);

    const cambios = { ...campos, actualizadoEn: new Date() };
    await withAgenda(env, (collection) => collection.updateOne({ _id: objectId }, { $set: cambios }));
    return jsonResponse({ ...registro, ...cambios });
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar el evento.", message: error.message }, 500);
  }
}

export async function handleEliminarAgenda(request, env, id) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID inválido." }, 400);

  try {
    const registro = await withAgenda(env, (collection) => collection.findOne({ _id: objectId }));
    if (!registro) return jsonResponse({ error: "Evento no encontrado." }, 404);
    if (!esSuperAdmin(sesion) && sesion.capituloId !== registro.capituloId) {
      return jsonResponse({ error: "No tienes acceso a este evento." }, 403);
    }

    await withAgenda(env, (collection) => collection.deleteOne({ _id: objectId }));
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: "Error al eliminar el evento.", message: error.message }, 500);
  }
}
