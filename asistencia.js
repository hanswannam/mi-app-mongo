// --- Asistencia (CRM BNI) ---
// Se toma una vez por reunión, para todo el roster a la vez (no una
// petición por networker). Un registro se identifica por
// capituloId + fechaReunion + telefono; volver a enviar la misma fecha
// actualiza en vez de duplicar.

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { soloDigitos } from "./src/utils/normalizePhone.js";
import { obtenerSesion, esSuperAdmin } from "./src/middleware/authMiddleware.js";
import { withCollection } from "./lib/db.js";
import { requerirModulo } from "./permisos.js";

const withAsistencia = (env, fn) => withCollection(env, "asistencia", fn);

function capituloDe(sesion, url) {
  return esSuperAdmin(sesion) ? url.searchParams.get("capituloId") : sesion.capituloId;
}

export async function handleListAsistencia(request, env) {
  const denegado = await requerirModulo(request, env, "asistencia", "ver");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = capituloDe(sesion, url);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  const filtro = { capituloId };
  const fechaReunion = url.searchParams.get("fechaReunion");
  if (fechaReunion) filtro.fechaReunion = fechaReunion;

  try {
    const registros = await withAsistencia(env, (collection) => collection.find(filtro).sort({ fechaReunion: -1 }).toArray());
    return jsonResponse(registros);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar asistencia.", message: error.message }, 500);
  }
}

// body: { fechaReunion: "2026-06-23", registros: [{ telefono, asistio,
// llegoTarde, ausente, envioSustituto, observaciones }, ...] }
export async function handleGuardarAsistencia(request, env) {
  const denegado = await requerirModulo(request, env, "asistencia", "crear");
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

  const fechaReunion = texto(body.fechaReunion);
  if (!fechaReunion) return jsonResponse({ error: "Falta la fecha de la reunión." }, 400);

  const registros = Array.isArray(body.registros) ? body.registros : [];
  if (registros.length === 0) return jsonResponse({ error: "No hay registros de asistencia para guardar." }, 400);

  try {
    const ahora = new Date();
    await withAsistencia(env, async (collection) => {
      for (const r of registros) {
        const telefono = soloDigitos(r.telefono);
        if (!telefono) continue;
        const datos = {
          capituloId,
          fechaReunion,
          telefono,
          asistio: Boolean(r.asistio),
          llegoTarde: Boolean(r.llegoTarde),
          ausente: Boolean(r.ausente),
          envioSustituto: Boolean(r.envioSustituto),
          observaciones: texto(r.observaciones),
          actualizadoEn: ahora
        };
        await collection.updateOne(
          { capituloId, fechaReunion, telefono },
          { $set: datos, $setOnInsert: { creadoEn: ahora } },
          { upsert: true }
        );
      }
    });
    return jsonResponse({ ok: true, guardados: registros.length });
  } catch (error) {
    return jsonResponse({ error: "Error al guardar la asistencia.", message: error.message }, 500);
  }
}

// Dashboard: % de asistencia global, ranking por networker, y alerta para
// quienes están debajo del 70% de asistencia (con al menos 3 reuniones
// registradas, para no alertar por falta de datos).
export async function handleResumenAsistencia(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = capituloDe(sesion, url);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  try {
    const porNetworker = await withAsistencia(env, (collection) =>
      collection
        .aggregate([
          { $match: { capituloId } },
          { $group: { _id: "$telefono", total: { $sum: 1 }, asistencias: { $sum: { $cond: ["$asistio", 1, 0] } } } }
        ])
        .toArray()
    );

    const ranking = porNetworker
      .map((n) => ({
        telefono: n._id,
        totalReuniones: n.total,
        asistencias: n.asistencias,
        porcentaje: n.total > 0 ? Math.round((n.asistencias / n.total) * 1000) / 10 : 0
      }))
      .sort((a, b) => b.porcentaje - a.porcentaje);

    const alertas = ranking.filter((n) => n.totalReuniones >= 3 && n.porcentaje < 70);

    const totalGeneral = porNetworker.reduce((acc, n) => acc + n.total, 0);
    const asistenciasGeneral = porNetworker.reduce((acc, n) => acc + n.asistencias, 0);
    const porcentajeGeneral = totalGeneral > 0 ? Math.round((asistenciasGeneral / totalGeneral) * 1000) / 10 : 0;

    return jsonResponse({ porcentajeGeneral, ranking, alertas });
  } catch (error) {
    return jsonResponse({ error: "Error al consultar el resumen de asistencia.", message: error.message }, 500);
  }
}
