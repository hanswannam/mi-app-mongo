// --- Funnel Networkets ---
// Cada networket es un evento de networking con su propio enlace guardado.
// El admin/networker crea el networket, obtiene una URL /unete?net=ID, y los
// prospectos que se registran quedan vinculados a ese networket específico.

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { obtenerSesion, esSuperAdmin } from "./src/middleware/authMiddleware.js";
import { parseObjectId, withCollection } from "./lib/db.js";
import { requerirModulo } from "./permisos.js";

const withNetworkets = (env, fn) => withCollection(env, "funnel_networkets", fn);

function capituloDe(sesion, url) {
  return esSuperAdmin(sesion) ? url.searchParams.get("capituloId") : sesion.capituloId;
}

function camposNetworket(body, sesion) {
  return {
    fechaNetworket: body.fechaNetworket ? new Date(body.fechaNetworket) : new Date(),
    titulo: texto(body.titulo),
    nombreNetworker: texto(body.nombreNetworker) || texto(sesion?.nombre),
    cupos: Math.max(1, parseInt(body.cupos, 10) || 5),
    videoId: texto(body.videoId),
    activo: body.activo !== false
  };
}

export async function handleListNetworkets(request, env) {
  const denegado = await requerirModulo(request, env, "invitados", "ver");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = capituloDe(sesion, url);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  const filtro = { capituloId };
  if (sesion.rol === "networker") filtro.telefonoNetworker = sesion.telefono;

  try {
    const networkets = await withNetworkets(env, (col) =>
      col.find(filtro).sort({ fechaNetworket: -1 }).toArray()
    );
    return jsonResponse(networkets);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar networkets.", message: error.message }, 500);
  }
}

export async function handleCrearNetworket(request, env) {
  const denegado = await requerirModulo(request, env, "invitados", "crear");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const capituloId = esSuperAdmin(sesion)
    ? texto(body.capituloId) || sesion.capituloId
    : sesion.capituloId;
  if (!capituloId) return jsonResponse({ error: "Falta el capítulo." }, 400);

  try {
    const ahora = new Date();
    const networket = {
      ...camposNetworket(body, sesion),
      capituloId,
      telefonoNetworker: sesion.telefono,
      creadoEn: ahora,
      actualizadoEn: ahora
    };
    const insertedId = await withNetworkets(env, (col) =>
      col.insertOne(networket).then((r) => r.insertedId)
    );
    return jsonResponse({ ...networket, _id: insertedId }, 201);
  } catch (error) {
    return jsonResponse({ error: "Error al crear el networket.", message: error.message }, 500);
  }
}

export async function handleActualizarNetworket(request, env, id) {
  const denegado = await requerirModulo(request, env, "invitados", "editar");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID inválido." }, 400);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  try {
    const networket = await withNetworkets(env, (col) => col.findOne({ _id: objectId }));
    if (!networket) return jsonResponse({ error: "Networket no encontrado." }, 404);
    if (!esSuperAdmin(sesion) && sesion.capituloId !== networket.capituloId) {
      return jsonResponse({ error: "No tienes acceso a este networket." }, 403);
    }
    const cambios = { ...camposNetworket(body, sesion), actualizadoEn: new Date() };
    await withNetworkets(env, (col) => col.updateOne({ _id: objectId }, { $set: cambios }));
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar.", message: error.message }, 500);
  }
}

export async function handleEliminarNetworket(request, env, id) {
  const denegado = await requerirModulo(request, env, "invitados", "eliminar");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID inválido." }, 400);

  try {
    const networket = await withNetworkets(env, (col) => col.findOne({ _id: objectId }));
    if (!networket) return jsonResponse({ error: "Networket no encontrado." }, 404);
    if (!esSuperAdmin(sesion) && sesion.capituloId !== networket.capituloId) {
      return jsonResponse({ error: "No tienes acceso a este networket." }, 403);
    }
    await withNetworkets(env, (col) => col.deleteOne({ _id: objectId }));
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: "Error al eliminar.", message: error.message }, 500);
  }
}
