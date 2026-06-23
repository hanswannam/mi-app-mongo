// --- Categorías (gestionadas por el administrador) ---

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { obtenerSesion, requerirAdmin } from "./src/middleware/authMiddleware.js";
import { parseObjectId, withCategorias } from "./lib/db.js";

const CATEGORIAS_DEFECTO = [
  "Tecnología",
  "Restaurantes y Alimentos",
  "Construcción",
  "Salud y Bienestar",
  "Educación",
  "Legal",
  "Finanzas y Seguros",
  "Belleza y Estética",
  "Automotriz",
  "Bienes Raíces",
  "Eventos y Entretenimiento",
  "Diseño y Marketing",
  "Transporte y Logística",
  "Turismo y Hotelería",
  "Moda y Retail",
  "Servicios Profesionales",
  "Otros"
];

export async function handleListCategorias(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  try {
    const categorias = await withCategorias(env, async (collection) => {
      const total = await collection.countDocuments();
      if (total === 0) {
        await collection.insertMany(CATEGORIAS_DEFECTO.map((nombre) => ({ nombre, creadoEn: new Date() })));
      }
      return collection.find({}).sort({ nombre: 1 }).toArray();
    });
    return jsonResponse(categorias);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar categorías.", message: error.message }, 500);
  }
}

export async function handleCrearCategoria(request, env) {
  const { error } = await requerirAdmin(request, env);
  if (error) return error;

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const nombre = texto(body.nombre);
  if (!nombre) return jsonResponse({ error: "El nombre de la categoría es obligatorio." }, 400);

  try {
    const insertedId = await withCategorias(env, async (collection) => {
      const existente = await collection.findOne({ nombre });
      if (existente) throw new Error("Ya existe una categoría con ese nombre.");
      const result = await collection.insertOne({ nombre, creadoEn: new Date() });
      return result.insertedId;
    });
    return jsonResponse({ _id: insertedId, nombre }, 201);
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }
}

export async function handleEliminarCategoria(request, env, id) {
  const { error } = await requerirAdmin(request, env);
  if (error) return error;

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID inválido." }, 400);

  try {
    const resultado = await withCategorias(env, (collection) => collection.deleteOne({ _id: objectId }));
    if (resultado.deletedCount === 0) return jsonResponse({ error: "Categoría no encontrada." }, 404);
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: "Error al eliminar la categoría.", message: error.message }, 500);
  }
}
