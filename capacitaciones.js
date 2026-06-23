// --- Capacitación (CRM BNI) ---

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { soloDigitos } from "./src/utils/normalizePhone.js";
import { obtenerSesion, esSuperAdmin } from "./src/middleware/authMiddleware.js";
import { parseObjectId, withCollection } from "./lib/db.js";
import { requerirModulo } from "./permisos.js";

const withCapacitaciones = (env, fn) => withCollection(env, "capacitaciones", fn);

const TIPOS_VALIDOS = ["video", "pdf", "link", "presencial", "virtual"];

function capituloDe(sesion, url) {
  return esSuperAdmin(sesion) ? url.searchParams.get("capituloId") : sesion.capituloId;
}

function camposCapacitacion(body) {
  const tipo = texto(body.tipo).toLowerCase();
  return {
    titulo: texto(body.titulo),
    descripcion: texto(body.descripcion),
    instructor: texto(body.instructor),
    fecha: body.fecha ? new Date(body.fecha) : new Date(),
    duracion: texto(body.duracion),
    tipo: TIPOS_VALIDOS.includes(tipo) ? tipo : "link",
    archivoOEnlace: texto(body.archivoOEnlace)
  };
}

export async function handleListCapacitaciones(request, env) {
  const denegado = await requerirModulo(request, env, "capacitacion", "ver");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = capituloDe(sesion, url);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  try {
    const registros = await withCapacitaciones(env, (collection) => collection.find({ capituloId }).sort({ fecha: -1 }).toArray());
    return jsonResponse(registros);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar capacitaciones.", message: error.message }, 500);
  }
}

export async function handleCrearCapacitacion(request, env) {
  const denegado = await requerirModulo(request, env, "capacitacion", "crear");
  if (denegado) return denegado;
  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const capituloId = esSuperAdmin(sesion) ? texto(body.capituloId) || sesion.capituloId : sesion.capituloId;
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  const campos = camposCapacitacion(body);
  if (!campos.titulo) return jsonResponse({ error: "El título es obligatorio." }, 400);

  const miembrosAsignados = Array.isArray(body.miembrosAsignados)
    ? body.miembrosAsignados.map((t) => ({ telefono: soloDigitos(t), completado: false, fechaCompletado: null })).filter((m) => m.telefono)
    : [];

  try {
    const ahora = new Date();
    const registro = { capituloId, ...campos, miembrosAsignados, creadoEn: ahora, actualizadoEn: ahora };
    const insertedId = await withCapacitaciones(env, (collection) => collection.insertOne(registro).then((r) => r.insertedId));
    return jsonResponse({ ...registro, _id: insertedId }, 201);
  } catch (error) {
    return jsonResponse({ error: "Error al crear la capacitación.", message: error.message }, 500);
  }
}

export async function handleActualizarCapacitacion(request, env, id) {
  const denegado = await requerirModulo(request, env, "capacitacion", "editar");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID inválido." }, 400);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  try {
    const registro = await withCapacitaciones(env, (collection) => collection.findOne({ _id: objectId }));
    if (!registro) return jsonResponse({ error: "Capacitación no encontrada." }, 404);
    if (!esSuperAdmin(sesion) && sesion.capituloId !== registro.capituloId) {
      return jsonResponse({ error: "No tienes acceso a esta capacitación." }, 403);
    }

    const campos = camposCapacitacion(body);
    if (!campos.titulo) return jsonResponse({ error: "El título es obligatorio." }, 400);

    let miembrosAsignados = registro.miembrosAsignados || [];
    if (Array.isArray(body.miembrosAsignados)) {
      const existentes = new Map(miembrosAsignados.map((m) => [m.telefono, m]));
      miembrosAsignados = body.miembrosAsignados
        .map((t) => soloDigitos(t))
        .filter(Boolean)
        .map((telefono) => existentes.get(telefono) || { telefono, completado: false, fechaCompletado: null });
    }

    const cambios = { ...campos, miembrosAsignados, actualizadoEn: new Date() };
    await withCapacitaciones(env, (collection) => collection.updateOne({ _id: objectId }, { $set: cambios }));
    return jsonResponse({ ...registro, ...cambios });
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar la capacitación.", message: error.message }, 500);
  }
}

// Marca (o desmarca) el avance de un miembro asignado, sin tocar el resto
// de la capacitación.
export async function handleMarcarAvance(request, env, id, telefonoParam) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID inválido." }, 400);
  const telefono = soloDigitos(telefonoParam);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  try {
    const registro = await withCapacitaciones(env, (collection) => collection.findOne({ _id: objectId }));
    if (!registro) return jsonResponse({ error: "Capacitación no encontrada." }, 404);
    const esElMismoMiembro = sesion.telefono === telefono;
    if (!esSuperAdmin(sesion) && !esElMismoMiembro && sesion.capituloId !== registro.capituloId) {
      return jsonResponse({ error: "No tienes acceso a esta capacitación." }, 403);
    }

    const completado = Boolean(body.completado);
    const miembros = registro.miembrosAsignados || [];
    const idx = miembros.findIndex((m) => m.telefono === telefono);
    if (idx === -1) return jsonResponse({ error: "Ese miembro no está asignado a esta capacitación." }, 404);

    miembros[idx] = { telefono, completado, fechaCompletado: completado ? new Date() : null };
    await withCapacitaciones(env, (collection) =>
      collection.updateOne({ _id: objectId }, { $set: { miembrosAsignados: miembros, actualizadoEn: new Date() } })
    );
    return jsonResponse({ ok: true, miembrosAsignados: miembros });
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar el avance.", message: error.message }, 500);
  }
}
