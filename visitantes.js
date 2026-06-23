// --- Visitantes (CRM BNI) ---
// Personas invitadas a una reunión por un networker. No son usuarios de la
// plataforma (no inician sesión); se registran y dan seguimiento desde el
// CRM por quien los invitó o por el admin del capítulo.

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { soloDigitos } from "./src/utils/normalizePhone.js";
import { obtenerSesion, esSuperAdmin } from "./src/middleware/authMiddleware.js";
import { parseObjectId, withCollection } from "./lib/db.js";

const withVisitantes = (env, fn) => withCollection(env, "visitantes", fn);

const ESTADOS_VALIDOS = ["prospecto", "visitante", "interesado", "aplicado", "miembro", "descartado"];

function camposVisitante(body) {
  const estado = texto(body.estado).toLowerCase();
  return {
    nombre: texto(body.nombre),
    empresa: texto(body.empresa),
    especialidad: texto(body.especialidad),
    telefono: soloDigitos(body.telefono),
    whatsapp: soloDigitos(body.whatsapp),
    correo: texto(body.correo),
    fechaVisita: body.fechaVisita ? new Date(body.fechaVisita) : new Date(),
    asistio: Boolean(body.asistio),
    volvioAsistir: Boolean(body.volvioAsistir),
    aplico: Boolean(body.aplico),
    seConvirtioEnMiembro: Boolean(body.seConvirtioEnMiembro),
    estado: ESTADOS_VALIDOS.includes(estado) ? estado : "prospecto",
    notas: texto(body.notas)
  };
}

function capituloDe(sesion, url) {
  return esSuperAdmin(sesion) ? url.searchParams.get("capituloId") : sesion.capituloId;
}

// Lista visitantes del capítulo. Filtro opcional por quién invitó
// (?invitadoPorTelefono=...) para la vista "mis visitantes" de un networker.
export async function handleListVisitantes(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = capituloDe(sesion, url);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  const filtro = { capituloId };
  const invitadoPorTelefono = url.searchParams.get("invitadoPorTelefono");
  if (invitadoPorTelefono) filtro.invitadoPorTelefono = soloDigitos(invitadoPorTelefono);

  try {
    const visitantes = await withVisitantes(env, (collection) =>
      collection.find(filtro).sort({ fechaVisita: -1 }).toArray()
    );
    return jsonResponse(visitantes);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar visitantes.", message: error.message }, 500);
  }
}

// Cualquier networker de un capítulo puede registrar un visitante que
// invitó; queda vinculado a su propio capítulo (de la sesión, no del body,
// para que no se pueda registrar en un capítulo ajeno).
export async function handleCrearVisitante(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);
  if (!sesion.capituloId && !esSuperAdmin(sesion)) {
    return jsonResponse({ error: "Tu cuenta no está asignada a un capítulo." }, 403);
  }

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const capituloId = esSuperAdmin(sesion) ? texto(body.capituloId) || sesion.capituloId : sesion.capituloId;
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  const campos = camposVisitante(body);
  if (!campos.nombre) return jsonResponse({ error: "El nombre del visitante es obligatorio." }, 400);

  try {
    const ahora = new Date();
    const visitante = {
      ...campos,
      capituloId,
      invitadoPorTelefono: sesion.telefono,
      creadoEn: ahora,
      actualizadoEn: ahora
    };
    const insertedId = await withVisitantes(env, (collection) => collection.insertOne(visitante).then((r) => r.insertedId));
    return jsonResponse({ ...visitante, _id: insertedId }, 201);
  } catch (error) {
    return jsonResponse({ error: "Error al registrar el visitante.", message: error.message }, 500);
  }
}

export async function handleActualizarVisitante(request, env, id) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID de visitante inválido." }, 400);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  try {
    const visitante = await withVisitantes(env, (collection) => collection.findOne({ _id: objectId }));
    if (!visitante) return jsonResponse({ error: "Visitante no encontrado." }, 404);
    if (!esSuperAdmin(sesion) && sesion.capituloId !== visitante.capituloId) {
      return jsonResponse({ error: "No tienes acceso a este visitante." }, 403);
    }

    const campos = camposVisitante(body);
    if (!campos.nombre) return jsonResponse({ error: "El nombre del visitante es obligatorio." }, 400);

    const cambios = { ...campos, actualizadoEn: new Date() };
    await withVisitantes(env, (collection) => collection.updateOne({ _id: objectId }, { $set: cambios }));
    return jsonResponse({ _id: id, ...visitante, ...cambios });
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar el visitante.", message: error.message }, 500);
  }
}

// Dashboard: total, visitantes del mes, conversión visitante->miembro,
// ranking de quién invita más, agrupado por networker.
export async function handleResumenVisitantes(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = capituloDe(sesion, url);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  try {
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const [total, delMes, miembros, ranking] = await withVisitantes(env, async (collection) => {
      const total = await collection.countDocuments({ capituloId });
      const delMes = await collection.countDocuments({ capituloId, fechaVisita: { $gte: inicioMes } });
      const miembros = await collection.countDocuments({ capituloId, seConvirtioEnMiembro: true });
      const ranking = await collection
        .aggregate([
          { $match: { capituloId } },
          { $group: { _id: "$invitadoPorTelefono", total: { $sum: 1 } } },
          { $sort: { total: -1 } },
          { $limit: 10 }
        ])
        .toArray();
      return [total, delMes, miembros, ranking];
    });

    const conversion = total > 0 ? Math.round((miembros / total) * 1000) / 10 : 0;
    return jsonResponse({
      total,
      delMes,
      convertidosEnMiembro: miembros,
      porcentajeConversion: conversion,
      ranking: ranking.map((r) => ({ telefono: r._id, totalInvitados: r.total }))
    });
  } catch (error) {
    return jsonResponse({ error: "Error al consultar el resumen de visitantes.", message: error.message }, 500);
  }
}
