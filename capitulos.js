// --- Capítulos (CRM multi-capítulo) ---
// Un capítulo BNI: nombre, país, ciudad, fecha de lanzamiento, estado y
// logo. Todo lo demás del CRM (networkers, esferas, visitantes, GPNC,
// 1 a 1) se filtra por capituloId.

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { obtenerSesion, requerirAdmin, requerirAdminCapitulo, esSuperAdmin } from "./src/middleware/authMiddleware.js";
import { parseObjectId, withCollection } from "./lib/db.js";

const withCapitulos = (env, fn) => withCollection(env, "capitulos", fn);

const ESTADOS_VALIDOS = ["pre-lanzamiento", "activo", "pausado"];

function camposCapitulo(body) {
  const estado = texto(body.estado).toLowerCase();
  return {
    nombre: texto(body.nombre),
    pais: texto(body.pais),
    ciudad: texto(body.ciudad),
    fechaLanzamiento: body.fechaLanzamiento ? new Date(body.fechaLanzamiento) : null,
    estado: ESTADOS_VALIDOS.includes(estado) ? estado : "pre-lanzamiento",
    logo: texto(body.logo)
  };
}

// Solo superadmin ve la lista completa de capítulos (es quien vende/crea
// capítulos nuevos). Un admin_capitulo o networker ya conoce el suyo por
// su propia sesión (GET /api/capitulos/:id).
export async function handleListCapitulos(request, env) {
  const { error } = await requerirAdmin(request, env);
  if (error) return error;

  try {
    const capitulos = await withCapitulos(env, (collection) => collection.find({}).sort({ nombre: 1 }).toArray());
    return jsonResponse(capitulos);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar capítulos.", message: error.message }, 500);
  }
}

export async function handleCrearCapitulo(request, env) {
  const { error } = await requerirAdmin(request, env);
  if (error) return error;

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const campos = camposCapitulo(body);
  if (!campos.nombre) return jsonResponse({ error: "El nombre del capítulo es obligatorio." }, 400);

  try {
    const ahora = new Date();
    const capitulo = { ...campos, creadoEn: ahora, actualizadoEn: ahora };
    const insertedId = await withCapitulos(env, (collection) => collection.insertOne(capitulo).then((r) => r.insertedId));
    return jsonResponse({ ...capitulo, _id: insertedId }, 201);
  } catch (error) {
    return jsonResponse({ error: "Error al crear el capítulo.", message: error.message }, 500);
  }
}

// Cualquier usuario autenticado puede ver el capítulo al que pertenece (o
// cualquiera, si es superadmin); no expone nada sensible.
export async function handleObtenerCapitulo(request, env, id) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID de capítulo inválido." }, 400);

  try {
    const capitulo = await withCapitulos(env, (collection) => collection.findOne({ _id: objectId }));
    if (!capitulo) return jsonResponse({ error: "Capítulo no encontrado." }, 404);
    if (!esSuperAdmin(sesion) && sesion.capituloId !== id) {
      return jsonResponse({ error: "No tienes acceso a este capítulo." }, 403);
    }
    return jsonResponse(capitulo);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar el capítulo.", message: error.message }, 500);
  }
}

export async function handleActualizarCapitulo(request, env, id) {
  const { error } = await requerirAdminCapitulo(request, env, id);
  if (error) return error;

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID de capítulo inválido." }, 400);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const campos = camposCapitulo(body);
  if (!campos.nombre) return jsonResponse({ error: "El nombre del capítulo es obligatorio." }, 400);

  try {
    const cambios = { ...campos, actualizadoEn: new Date() };
    const resultado = await withCapitulos(env, (collection) => collection.updateOne({ _id: objectId }, { $set: cambios }));
    if (resultado.matchedCount === 0) return jsonResponse({ error: "Capítulo no encontrado." }, 404);
    return jsonResponse({ _id: id, ...cambios });
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar el capítulo.", message: error.message }, 500);
  }
}
