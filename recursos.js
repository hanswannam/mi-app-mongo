// --- Biblioteca de recursos (CRM BNI) ---
// Fase 2: recursos como enlaces (Drive, YouTube, PDFs alojados afuera,
// formularios, etc.) -- no se suben archivos binarios al documento para
// no inflar Mongo; si más adelante se necesita adjuntar archivos propios,
// se puede agregar como campo aparte sin romper esto.

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { normalizarUrl } from "./src/utils/validateUrl.js";
import { obtenerSesion, esSuperAdmin } from "./src/middleware/authMiddleware.js";
import { parseObjectId, withCollection } from "./lib/db.js";

const withRecursos = (env, fn) => withCollection(env, "recursos", fn);

const TIPOS_VALIDOS = ["link", "pdf", "video", "manual", "presentacion", "formulario"];
const CATEGORIAS_VALIDAS = ["BNI", "Capacitación", "Networking", "Ventas", "Marketing", "Inteligencia Artificial", "Herramientas"];

function capituloDe(sesion, url) {
  return esSuperAdmin(sesion) ? url.searchParams.get("capituloId") : sesion.capituloId;
}

export async function handleListRecursos(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = capituloDe(sesion, url);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  const filtro = { capituloId };
  const categoria = url.searchParams.get("categoria");
  if (categoria) filtro.categoria = categoria;

  try {
    const recursos = await withRecursos(env, (collection) => collection.find(filtro).sort({ creadoEn: -1 }).toArray());
    return jsonResponse(recursos);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar recursos.", message: error.message }, 500);
  }
}

export async function handleCrearRecurso(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);
  if (!sesion.capituloId && !esSuperAdmin(sesion)) {
    return jsonResponse({ error: "Tu cuenta no está asignada a un capítulo." }, 403);
  }

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const capituloId = esSuperAdmin(sesion) ? texto(body.capituloId) || sesion.capituloId : sesion.capituloId;
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  const titulo = texto(body.titulo);
  if (!titulo) return jsonResponse({ error: "El título es obligatorio." }, 400);

  const enlace = normalizarUrl(body.enlace);
  if (!enlace) return jsonResponse({ error: "El enlace no es válido." }, 400);

  const tipo = texto(body.tipo).toLowerCase();
  const categoria = texto(body.categoria);

  try {
    const ahora = new Date();
    const recurso = {
      capituloId,
      titulo,
      descripcion: texto(body.descripcion),
      tipo: TIPOS_VALIDOS.includes(tipo) ? tipo : "link",
      categoria: CATEGORIAS_VALIDAS.includes(categoria) ? categoria : "Herramientas",
      enlace,
      creadoPorTelefono: sesion.telefono,
      creadoEn: ahora
    };
    const insertedId = await withRecursos(env, (collection) => collection.insertOne(recurso).then((r) => r.insertedId));
    return jsonResponse({ ...recurso, _id: insertedId }, 201);
  } catch (error) {
    return jsonResponse({ error: "Error al guardar el recurso.", message: error.message }, 500);
  }
}

export async function handleEliminarRecurso(request, env, id) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID inválido." }, 400);

  try {
    const recurso = await withRecursos(env, (collection) => collection.findOne({ _id: objectId }));
    if (!recurso) return jsonResponse({ error: "Recurso no encontrado." }, 404);
    const puede = esSuperAdmin(sesion) || sesion.telefono === recurso.creadoPorTelefono || sesion.capituloId === recurso.capituloId;
    if (!puede) return jsonResponse({ error: "No tienes acceso a este recurso." }, 403);

    await withRecursos(env, (collection) => collection.deleteOne({ _id: objectId }));
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: "Error al eliminar el recurso.", message: error.message }, 500);
  }
}
