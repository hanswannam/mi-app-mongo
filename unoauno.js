// --- Reuniones 1 a 1 (CRM BNI) ---

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { soloDigitos } from "./src/utils/normalizePhone.js";
import { obtenerSesion, esSuperAdmin } from "./src/middleware/authMiddleware.js";
import { parseObjectId, withCollection } from "./lib/db.js";
import { requerirModulo } from "./permisos.js";

const withUnoAUno = (env, fn) => withCollection(env, "unoauno", fn);

const ESTADOS_VALIDOS = ["programado", "realizado", "cancelado"];

function capituloDe(sesion, url) {
  return esSuperAdmin(sesion) ? url.searchParams.get("capituloId") : sesion.capituloId;
}

function camposUnoAUno(body) {
  const estado = texto(body.estado).toLowerCase();
  return {
    fecha: body.fecha ? new Date(body.fecha) : new Date(),
    hora: texto(body.hora),
    lugarOLink: texto(body.lugarOLink),
    tema: texto(body.tema),
    notas: texto(body.notas),
    compromisos: texto(body.compromisos),
    proximoSeguimiento: body.proximoSeguimiento ? new Date(body.proximoSeguimiento) : null,
    estado: ESTADOS_VALIDOS.includes(estado) ? estado : "programado"
  };
}

// Lista los 1 a 1 del capítulo. Filtro opcional ?telefono= para ver solo
// los de un participante ("mis 1 a 1").
export async function handleListUnoAUno(request, env) {
  const denegado = await requerirModulo(request, env, "unoauno", "ver");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = capituloDe(sesion, url);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  const filtro = { capituloId };
  const telefono = url.searchParams.get("telefono");
  if (telefono) {
    const t = soloDigitos(telefono);
    filtro.$or = [{ participante1Telefono: t }, { participante2Telefono: t }];
  }

  try {
    const registros = await withUnoAUno(env, (collection) => collection.find(filtro).sort({ fecha: -1 }).toArray());
    return jsonResponse(registros);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar 1 a 1.", message: error.message }, 500);
  }
}

export async function handleCrearUnoAUno(request, env) {
  const denegado = await requerirModulo(request, env, "unoauno", "crear");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);
  if (!sesion.capituloId && !esSuperAdmin(sesion)) {
    return jsonResponse({ error: "Tu cuenta no está asignada a un capítulo." }, 403);
  }

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const capituloId = esSuperAdmin(sesion) ? texto(body.capituloId) || sesion.capituloId : sesion.capituloId;
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  const participante1Telefono = soloDigitos(body.participante1Telefono) || sesion.telefono;
  const participante2Telefono = soloDigitos(body.participante2Telefono);
  if (!participante2Telefono) return jsonResponse({ error: "Indica con quién es el 1 a 1." }, 400);
  if (participante1Telefono === participante2Telefono) {
    return jsonResponse({ error: "Los dos participantes deben ser distintos." }, 400);
  }

  try {
    const ahora = new Date();
    const registro = {
      capituloId,
      participante1Telefono,
      participante2Telefono,
      ...camposUnoAUno(body),
      creadoEn: ahora,
      actualizadoEn: ahora
    };
    const insertedId = await withUnoAUno(env, (collection) => collection.insertOne(registro).then((r) => r.insertedId));
    return jsonResponse({ ...registro, _id: insertedId }, 201);
  } catch (error) {
    return jsonResponse({ error: "Error al registrar el 1 a 1.", message: error.message }, 500);
  }
}

export async function handleActualizarUnoAUno(request, env, id) {
  const denegado = await requerirModulo(request, env, "unoauno", "editar");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID inválido." }, 400);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  try {
    const registro = await withUnoAUno(env, (collection) => collection.findOne({ _id: objectId }));
    if (!registro) return jsonResponse({ error: "Registro no encontrado." }, 404);

    const esParticipante = sesion.telefono === registro.participante1Telefono || sesion.telefono === registro.participante2Telefono;
    if (!esSuperAdmin(sesion) && !esParticipante && sesion.capituloId !== registro.capituloId) {
      return jsonResponse({ error: "No tienes acceso a este registro." }, 403);
    }

    const cambios = { ...camposUnoAUno(body), actualizadoEn: new Date() };
    await withUnoAUno(env, (collection) => collection.updateOne({ _id: objectId }, { $set: cambios }));
    return jsonResponse({ ...registro, ...cambios });
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar el registro.", message: error.message }, 500);
  }
}

// Dashboard: total, ranking por miembro (cuántos 1 a 1 ha tenido) y quiénes
// tienen menos actividad dentro de los networkers activos del capítulo.
export async function handleResumenUnoAUno(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = capituloDe(sesion, url);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  try {
    const [total, ranking] = await withUnoAUno(env, async (collection) => {
      const total = await collection.countDocuments({ capituloId, estado: "realizado" });
      const rankingArr = await collection
        .aggregate([
          { $match: { capituloId, estado: "realizado" } },
          { $project: { participantes: ["$participante1Telefono", "$participante2Telefono"] } },
          { $unwind: "$participantes" },
          { $group: { _id: "$participantes", total: { $sum: 1 } } },
          { $sort: { total: -1 } }
        ])
        .toArray();
      return [total, rankingArr];
    });

    const networkersActivos = await withCollection(env, "usuarios", (collection) =>
      collection.find({ capituloId, rol: "networker" }, { projection: { telefono: 1, nombre: 1 } }).toArray()
    );
    const conteoMap = new Map(ranking.map((r) => [r._id, r.total]));
    const menosActivos = networkersActivos
      .map((n) => ({ telefono: n.telefono, nombre: n.nombre, total: conteoMap.get(n.telefono) || 0 }))
      .sort((a, b) => a.total - b.total)
      .slice(0, 10);

    return jsonResponse({
      total,
      ranking: ranking.slice(0, 10).map((r) => ({ telefono: r._id, total: r.total })),
      menosActivos
    });
  } catch (error) {
    return jsonResponse({ error: "Error al consultar el resumen de 1 a 1.", message: error.message }, 500);
  }
}
