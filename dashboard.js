// --- Dashboard básico (CRM BNI) ---
// Agregaciones de los demás módulos (networkers, visitantes, GPNC, 1 a 1,
// esferas) en un solo endpoint para la pantalla principal de un capítulo.

import { jsonResponse } from "./src/utils/response.js";
import { obtenerSesion, esSuperAdmin } from "./src/middleware/authMiddleware.js";
import { withCollection } from "./lib/db.js";

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

export async function handleResumenDashboard(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = esSuperAdmin(sesion) ? url.searchParams.get("capituloId") : sesion.capituloId;
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  try {
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const totalNetworkers = await withCollection(env, "usuarios", (collection) =>
      collection.countDocuments({ capituloId, rol: "networker" })
    );

    const [totalVisitantes, visitantesDelMes] = await withCollection(env, "visitantes", async (collection) => [
      await collection.countDocuments({ capituloId }),
      await collection.countDocuments({ capituloId, fechaVisita: { $gte: inicioMes } })
    ]);

    const [gpncAgg, gpncMesAgg] = await withCollection(env, "gpnc", async (collection) => {
      const total = await collection
        .aggregate([{ $match: { capituloId } }, { $group: { _id: null, monto: { $sum: "$monto" }, cantidad: { $sum: 1 } } }])
        .toArray();
      const mes = await collection
        .aggregate([
          { $match: { capituloId, fecha: { $gte: inicioMes } } },
          { $group: { _id: null, monto: { $sum: "$monto" }, cantidad: { $sum: 1 } } }
        ])
        .toArray();
      return [total[0] || { monto: 0, cantidad: 0 }, mes[0] || { monto: 0, cantidad: 0 }];
    });

    const totalUnoAUno = await withCollection(env, "unoauno", (collection) =>
      collection.countDocuments({ capituloId, estado: "realizado" })
    );

    const esferas = await withCollection(env, "esferas", async (collection) => {
      const total = await collection.countDocuments({ capituloId });
      if (total === 0) {
        await collection.insertMany(ESFERAS_DEFECTO.map((nombre) => ({ nombre, capituloId, creadoEn: new Date() })));
      }
      return collection.find({ capituloId }).toArray();
    });
    const conteoPorEsfera = await withCollection(env, "usuarios", (collection) =>
      collection
        .aggregate([{ $match: { capituloId, esferaId: { $ne: null } } }, { $group: { _id: "$esferaId", total: { $sum: 1 } } }])
        .toArray()
    );
    const cubiertas = new Set(conteoPorEsfera.map((c) => c._id));
    const esferasSinCubrir = esferas.filter((e) => !cubiertas.has(String(e._id))).map((e) => e.nombre);

    // Ranking simple: visitantes invitados + GPNC generado (cantidad) +
    // 1 a 1 realizados, sumados por networker.
    const [rankingVisitantes, rankingGpnc, rankingUnoAUno] = await Promise.all([
      withCollection(env, "visitantes", (collection) =>
        collection
          .aggregate([{ $match: { capituloId } }, { $group: { _id: "$invitadoPorTelefono", total: { $sum: 1 } } }])
          .toArray()
      ),
      withCollection(env, "gpnc", (collection) =>
        collection.aggregate([{ $match: { capituloId } }, { $group: { _id: "$generoTelefono", total: { $sum: 1 } } }]).toArray()
      ),
      withCollection(env, "unoauno", (collection) =>
        collection
          .aggregate([
            { $match: { capituloId, estado: "realizado" } },
            { $project: { participantes: ["$participante1Telefono", "$participante2Telefono"] } },
            { $unwind: "$participantes" },
            { $group: { _id: "$participantes", total: { $sum: 1 } } }
          ])
          .toArray()
      )
    ]);

    const puntajes = new Map();
    const sumar = (lista) => lista.forEach((r) => puntajes.set(r._id, (puntajes.get(r._id) || 0) + r.total));
    sumar(rankingVisitantes);
    sumar(rankingGpnc);
    sumar(rankingUnoAUno);

    const networkers = await withCollection(env, "usuarios", (collection) =>
      collection.find({ capituloId, rol: "networker" }, { projection: { telefono: 1, nombre: 1 } }).toArray()
    );
    const rankingMiembros = networkers
      .map((n) => ({ telefono: n.telefono, nombre: n.nombre, puntaje: puntajes.get(n.telefono) || 0 }))
      .sort((a, b) => b.puntaje - a.puntaje)
      .slice(0, 10);

    return jsonResponse({
      totalNetworkers,
      totalVisitantes,
      visitantesDelMes,
      totalGpnc: gpncAgg.monto,
      cantidadGpnc: gpncAgg.cantidad,
      gpncDelMes: gpncMesAgg.monto,
      cantidadGpncDelMes: gpncMesAgg.cantidad,
      totalUnoAUno,
      esferasTotal: esferas.length,
      esferasSinCubrir,
      rankingMiembros
    });
  } catch (error) {
    return jsonResponse({ error: "Error al consultar el dashboard.", message: error.message }, 500);
  }
}
