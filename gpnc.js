// --- GPNC: Gracias Por Negocio Concretado (CRM BNI) ---
// Registro de un negocio cerrado gracias a una referencia entre dos
// networkers del mismo capítulo.

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { soloDigitos } from "./src/utils/normalizePhone.js";
import { obtenerSesion, esSuperAdmin } from "./src/middleware/authMiddleware.js";
import { parseObjectId, withCollection } from "./lib/db.js";
import { requerirModulo } from "./permisos.js";

const withGpnc = (env, fn) => withCollection(env, "gpnc", fn);

function capituloDe(sesion, url) {
  return esSuperAdmin(sesion) ? url.searchParams.get("capituloId") : sesion.capituloId;
}

export async function handleListGpnc(request, env) {
  const denegado = await requerirModulo(request, env, "gpnc", "ver");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = capituloDe(sesion, url);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  try {
    const registros = await withGpnc(env, (collection) => collection.find({ capituloId }).sort({ fecha: -1 }).toArray());
    return jsonResponse(registros);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar GPNC.", message: error.message }, 500);
  }
}

// Quien agradece (agradeceTelefono) es por defecto quien hace la petición --
// un networker registrando el negocio que cerró gracias a otro miembro.
export async function handleCrearGpnc(request, env) {
  const denegado = await requerirModulo(request, env, "gpnc", "crear");
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

  const generoTelefono = soloDigitos(body.generoTelefono);
  if (!generoTelefono) return jsonResponse({ error: "Indica quién generó la referencia." }, 400);

  const cliente = texto(body.cliente);
  if (!cliente) return jsonResponse({ error: "El nombre del cliente es obligatorio." }, 400);

  const monto = Number(body.monto);
  if (!Number.isFinite(monto) || monto < 0) return jsonResponse({ error: "El monto no es válido." }, 400);

  try {
    const ahora = new Date();
    const registro = {
      capituloId,
      fecha: body.fecha ? new Date(body.fecha) : ahora,
      agradeceTelefono: soloDigitos(body.agradeceTelefono) || sesion.telefono,
      generoTelefono,
      cliente,
      descripcionNegocio: texto(body.descripcionNegocio),
      monto,
      moneda: texto(body.moneda) || "GTQ",
      observaciones: texto(body.observaciones),
      // Si este GPNC viene de una referencia marcada como "ganado" (ver
      // referencias.js), queda enlazado sin duplicar los datos del cliente.
      referenciaId: texto(body.referenciaId) || null,
      creadoEn: ahora
    };
    const insertedId = await withGpnc(env, (collection) => collection.insertOne(registro).then((r) => r.insertedId));
    return jsonResponse({ ...registro, _id: insertedId }, 201);
  } catch (error) {
    return jsonResponse({ error: "Error al registrar el GPNC.", message: error.message }, 500);
  }
}

export async function handleEliminarGpnc(request, env, id) {
  const denegado = await requerirModulo(request, env, "gpnc", "eliminar");
  if (denegado) return denegado;
  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID inválido." }, 400);

  try {
    const registro = await withGpnc(env, (collection) => collection.findOne({ _id: objectId }));
    if (!registro) return jsonResponse({ error: "Registro no encontrado." }, 404);

    const sesion = await obtenerSesion(request, env);
    if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);
    const puede = esSuperAdmin(sesion) || sesion.telefono === registro.agradeceTelefono || sesion.capituloId === registro.capituloId;
    if (!puede) return jsonResponse({ error: "No tienes acceso a este registro." }, 403);

    await withGpnc(env, (collection) => collection.deleteOne({ _id: objectId }));
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: "Error al eliminar el registro.", message: error.message }, 500);
  }
}

// Dashboard: total del capítulo, del mes, por networker (lo que cada uno
// generó para otros) y ranking.
export async function handleResumenGpnc(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = capituloDe(sesion, url);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  try {
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const [totales, totalMes, ranking] = await withGpnc(env, async (collection) => {
      const totalesArr = await collection
        .aggregate([{ $match: { capituloId } }, { $group: { _id: null, total: { $sum: "$monto" }, cantidad: { $sum: 1 } } }])
        .toArray();
      const totalMesArr = await collection
        .aggregate([
          { $match: { capituloId, fecha: { $gte: inicioMes } } },
          { $group: { _id: null, total: { $sum: "$monto" }, cantidad: { $sum: 1 } } }
        ])
        .toArray();
      const rankingArr = await collection
        .aggregate([
          { $match: { capituloId } },
          { $group: { _id: "$generoTelefono", total: { $sum: "$monto" }, cantidad: { $sum: 1 } } },
          { $sort: { total: -1 } },
          { $limit: 10 }
        ])
        .toArray();
      return [totalesArr[0] || { total: 0, cantidad: 0 }, totalMesArr[0] || { total: 0, cantidad: 0 }, rankingArr];
    });

    return jsonResponse({
      total: totales.total,
      cantidadTotal: totales.cantidad,
      totalDelMes: totalMes.total,
      cantidadDelMes: totalMes.cantidad,
      ranking: ranking.map((r) => ({ telefono: r._id, totalGenerado: r.total, cantidad: r.cantidad }))
    });
  } catch (error) {
    return jsonResponse({ error: "Error al consultar el resumen de GPNC.", message: error.message }, 500);
  }
}
