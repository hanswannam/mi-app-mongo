// --- Esferas de negocio (CRM BNI) ---
// Cobertura de industrias dentro de un capítulo -- distinto de "categorias"
// (que es la industria libre de un contacto en el directorio de tarjetas).
// Cada capítulo tiene su propia lista, sembrada con las esferas típicas de
// BNI la primera vez que se consulta.

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { obtenerSesion, requerirAdminCapitulo, esSuperAdmin } from "./src/middleware/authMiddleware.js";
import { parseObjectId, withCollection } from "./lib/db.js";

const withEsferas = (env, fn) => withCollection(env, "esferas", fn);

const ESFERAS_DEFECTO = [
  "Inmobiliaria",
  "Construcción",
  "Legal",
  "Finanzas",
  "Marketing",
  "Salud",
  "Tecnología",
  "Servicios profesionales",
  "Otros"
];

export async function handleListEsferas(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = esSuperAdmin(sesion) ? url.searchParams.get("capituloId") : sesion.capituloId;
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  try {
    const esferas = await withEsferas(env, async (collection) => {
      const total = await collection.countDocuments({ capituloId });
      if (total === 0) {
        await collection.insertMany(ESFERAS_DEFECTO.map((nombre) => ({ nombre, capituloId, creadoEn: new Date() })));
      }
      return collection.find({ capituloId }).sort({ nombre: 1 }).toArray();
    });
    return jsonResponse(esferas);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar esferas.", message: error.message }, 500);
  }
}

export async function handleCrearEsfera(request, env) {
  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const capituloId = texto(body.capituloId);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  const { error } = await requerirAdminCapitulo(request, env, capituloId);
  if (error) return error;

  const nombre = texto(body.nombre);
  if (!nombre) return jsonResponse({ error: "El nombre de la esfera es obligatorio." }, 400);

  try {
    const insertedId = await withEsferas(env, async (collection) => {
      const existente = await collection.findOne({ nombre, capituloId });
      if (existente) throw new Error("Ya existe una esfera con ese nombre en este capítulo.");
      const result = await collection.insertOne({ nombre, capituloId, creadoEn: new Date() });
      return result.insertedId;
    });
    return jsonResponse({ _id: insertedId, nombre, capituloId }, 201);
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }
}

export async function handleEliminarEsfera(request, env, id) {
  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID inválido." }, 400);

  try {
    const esfera = await withEsferas(env, (collection) => collection.findOne({ _id: objectId }));
    if (!esfera) return jsonResponse({ error: "Esfera no encontrada." }, 404);

    const { error } = await requerirAdminCapitulo(request, env, esfera.capituloId);
    if (error) return error;

    await withEsferas(env, (collection) => collection.deleteOne({ _id: objectId }));
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: "Error al eliminar la esfera.", message: error.message }, 500);
  }
}

// Dashboard: cuántos networkers activos hay por esfera, y cuáles esferas
// del capítulo no tienen ningún networker asignado (cobertura faltante).
export async function handleCoberturaEsferas(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = esSuperAdmin(sesion) ? url.searchParams.get("capituloId") : sesion.capituloId;
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  try {
    const esferas = await withEsferas(env, async (collectionEsferas) => {
      const total = await collectionEsferas.countDocuments({ capituloId });
      if (total === 0) {
        await collectionEsferas.insertMany(ESFERAS_DEFECTO.map((nombre) => ({ nombre, capituloId, creadoEn: new Date() })));
      }
      return collectionEsferas.find({ capituloId }).sort({ nombre: 1 }).toArray();
    });

    const conteos = await withCollection(env, "usuarios", (collection) =>
      collection
        .aggregate([
          { $match: { capituloId, esferaId: { $ne: null } } },
          { $group: { _id: "$esferaId", total: { $sum: 1 } } }
        ])
        .toArray()
    );
    const conteoPorEsfera = new Map(conteos.map((c) => [c._id, c.total]));

    const resultado = esferas.map((esfera) => ({
      _id: esfera._id,
      nombre: esfera.nombre,
      totalNetworkers: conteoPorEsfera.get(String(esfera._id)) || 0
    }));
    const sinCubrir = resultado.filter((e) => e.totalNetworkers === 0).map((e) => e.nombre);

    return jsonResponse({ esferas: resultado, sinCubrir });
  } catch (error) {
    return jsonResponse({ error: "Error al consultar cobertura de esferas.", message: error.message }, 500);
  }
}
