// --- Referencias (CRM BNI) ---
// Una referencia de negocio entre dos networkers del mismo capítulo. Si se
// cierra como negocio ganado, puede convertirse en un registro de GPNC
// (ver referenciaId en gpnc.js) sin duplicar los datos del cliente.

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { soloDigitos } from "./src/utils/normalizePhone.js";
import { obtenerSesion, esSuperAdmin } from "./src/middleware/authMiddleware.js";
import { parseObjectId, withCollection } from "./lib/db.js";
import { requerirModulo } from "./permisos.js";

const withReferencias = (env, fn) => withCollection(env, "referencias", fn);

const ESTADOS_VALIDOS = ["pendiente", "contactado", "cotizado", "ganado", "perdido"];

function capituloDe(sesion, url) {
  return esSuperAdmin(sesion) ? url.searchParams.get("capituloId") : sesion.capituloId;
}

function camposReferencia(body) {
  const estado = texto(body.estado).toLowerCase();
  const monto = Number(body.montoEstimado);
  return {
    clienteReferido: texto(body.clienteReferido),
    telefonoCliente: soloDigitos(body.telefonoCliente),
    correoCliente: texto(body.correoCliente),
    descripcion: texto(body.descripcion),
    estado: ESTADOS_VALIDOS.includes(estado) ? estado : "pendiente",
    montoEstimado: Number.isFinite(monto) ? monto : 0,
    fechaSeguimiento: body.fechaSeguimiento ? new Date(body.fechaSeguimiento) : null,
    notas: texto(body.notas)
  };
}

export async function handleListReferencias(request, env) {
  const denegado = await requerirModulo(request, env, "referencias", "ver");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = capituloDe(sesion, url);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  try {
    const registros = await withReferencias(env, (collection) => collection.find({ capituloId }).sort({ fecha: -1 }).toArray());
    return jsonResponse(registros);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar referencias.", message: error.message }, 500);
  }
}

// Quien da la referencia (referenciaDadaPorTelefono) es quien hace la
// petición; referenciaRecibidaPorTelefono es a quién se la está dando.
export async function handleCrearReferencia(request, env) {
  const denegado = await requerirModulo(request, env, "referencias", "crear");
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

  const referenciaRecibidaPorTelefono = soloDigitos(body.referenciaRecibidaPorTelefono);
  if (!referenciaRecibidaPorTelefono) return jsonResponse({ error: "Indica quién recibe la referencia." }, 400);

  const campos = camposReferencia(body);
  if (!campos.clienteReferido) return jsonResponse({ error: "El nombre del cliente referido es obligatorio." }, 400);

  try {
    const ahora = new Date();
    const referencia = {
      capituloId,
      fecha: body.fecha ? new Date(body.fecha) : ahora,
      referenciaDadaPorTelefono: sesion.telefono,
      referenciaRecibidaPorTelefono,
      ...campos,
      creadoEn: ahora,
      actualizadoEn: ahora
    };
    const insertedId = await withReferencias(env, (collection) => collection.insertOne(referencia).then((r) => r.insertedId));
    return jsonResponse({ ...referencia, _id: insertedId }, 201);
  } catch (error) {
    return jsonResponse({ error: "Error al registrar la referencia.", message: error.message }, 500);
  }
}

export async function handleActualizarReferencia(request, env, id) {
  const denegado = await requerirModulo(request, env, "referencias", "editar");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID de referencia inválido." }, 400);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  try {
    const referencia = await withReferencias(env, (collection) => collection.findOne({ _id: objectId }));
    if (!referencia) return jsonResponse({ error: "Referencia no encontrada." }, 404);

    const esParticipante = sesion.telefono === referencia.referenciaDadaPorTelefono || sesion.telefono === referencia.referenciaRecibidaPorTelefono;
    if (!esSuperAdmin(sesion) && !esParticipante && sesion.capituloId !== referencia.capituloId) {
      return jsonResponse({ error: "No tienes acceso a esta referencia." }, 403);
    }

    const cambios = { ...camposReferencia(body), actualizadoEn: new Date() };
    if (!cambios.clienteReferido) return jsonResponse({ error: "El nombre del cliente referido es obligatorio." }, 400);

    await withReferencias(env, (collection) => collection.updateOne({ _id: objectId }, { $set: cambios }));
    return jsonResponse({ ...referencia, ...cambios });
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar la referencia.", message: error.message }, 500);
  }
}

// Dashboard: total, pendientes, cerradas (ganadas), y monto estimado en
// juego (pendiente/contactado/cotizado).
export async function handleResumenReferencias(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = capituloDe(sesion, url);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  try {
    const [total, pendientes, ganadas, perdidas] = await withReferencias(env, async (collection) => [
      await collection.countDocuments({ capituloId }),
      await collection.countDocuments({ capituloId, estado: { $in: ["pendiente", "contactado", "cotizado"] } }),
      await collection.countDocuments({ capituloId, estado: "ganado" }),
      await collection.countDocuments({ capituloId, estado: "perdido" })
    ]);
    return jsonResponse({ total, pendientes, ganadas, perdidas });
  } catch (error) {
    return jsonResponse({ error: "Error al consultar el resumen de referencias.", message: error.message }, 500);
  }
}
