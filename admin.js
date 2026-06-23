// --- Administración ---
// Es el módulo más transversal: el resumen del dashboard consulta las 5
// colecciones a la vez (usuarios, tarjetas, eventos, invitaciones).

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { soloDigitos } from "./src/utils/normalizePhone.js";
import { generarSalt, hashConSalt } from "./lib/crypto.js";
import { requerirAdmin } from "./lib/sesion.js";
import { withUsuarios, withTarjetas, withEventos, withInvitaciones } from "./lib/db.js";

export async function handleListUsuarios(request, env) {
  const { error } = await requerirAdmin(request, env);
  if (error) return error;

  try {
    const usuarios = await withUsuarios(env, (collection) =>
      collection
        .find({}, { projection: { dpiHash: 0, dpiSalt: 0, openaiApiKey: 0 } })
        .sort({ creadoEn: -1 })
        .toArray()
    );

    // Empresa/correo no viven en el usuario sino en su "mi tarjeta" (si tiene
    // una) — se completan aquí solo para la tabla del panel de admin.
    const telefonos = usuarios.map((u) => u.telefono);
    const tarjetasPropias = await withTarjetas(env, (collection) =>
      collection
        .find(
          { propietarioTelefono: { $in: telefonos }, esMiTarjeta: true },
          { projection: { propietarioTelefono: 1, empresa: 1, email: 1, avatarMini: 1 } }
        )
        .toArray()
    );
    const propiaPorTelefono = new Map(tarjetasPropias.map((t) => [t.propietarioTelefono, t]));

    const enriquecidos = usuarios.map((u) => {
      const propia = propiaPorTelefono.get(u.telefono);
      return {
        ...u,
        empresa: propia?.empresa || "",
        email: propia?.email || "",
        avatarMini: propia?.avatarMini || u.fotoPerfil || ""
      };
    });

    return jsonResponse(enriquecidos);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar usuarios.", message: error.message }, 500);
  }
}

// Agrupa documentos de una colección por mes calendario sobre un campo de
// fecha, para alimentar las gráficas simples del panel de admin.
async function agregarPorMes(collection, campoFecha, filtroExtra = {}) {
  const resultado = await collection
    .aggregate([
      { $match: { ...filtroExtra, [campoFecha]: { $exists: true, $ne: null } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: `$${campoFecha}` } }, total: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ])
    .toArray();
  return resultado.map((r) => ({ mes: r._id, total: r.total }));
}

export async function handleResumenAdmin(request, env) {
  const { error } = await requerirAdmin(request, env);
  if (error) return error;

  try {
    const telefonosSuspendidos = await withUsuarios(env, (collection) =>
      collection.find({ estado: "suspendido" }, { projection: { telefono: 1 } }).toArray()
    ).then((arr) => arr.map((u) => u.telefono));

    const [
      totalUsuarios,
      totalTarjetas,
      totalTarjetasActivas,
      totalTarjetasCompartidas,
      totalInvitacionesPendientes,
      sumaOcr,
      usuariosPorMes,
      tarjetasPorMes,
      compartidosPorMes,
      activacionesPorMes
    ] = await Promise.all([
      withUsuarios(env, (c) => c.countDocuments()),
      withTarjetas(env, (c) => c.countDocuments()),
      withTarjetas(env, (c) => c.countDocuments({ propietarioTelefono: { $nin: telefonosSuspendidos } })),
      withTarjetas(env, (c) => c.countDocuments({ compartidos: { $gt: 0 } })),
      withInvitaciones(env, (c) => c.countDocuments({ estado: "pendiente", expiraEn: { $gt: new Date() } })),
      withUsuarios(env, (c) => c.aggregate([{ $group: { _id: null, total: { $sum: "$ocrUsos" } } }]).toArray()),
      withUsuarios(env, (c) => agregarPorMes(c, "creadoEn")),
      withTarjetas(env, (c) => agregarPorMes(c, "creadoEn")),
      withEventos(env, (c) => agregarPorMes(c, "fecha", { tipo: "compartido" })),
      withInvitaciones(env, (c) => agregarPorMes(c, "aceptadoEn", { estado: "aceptada" }))
    ]);

    return jsonResponse({
      totalUsuarios,
      totalTarjetas,
      totalTarjetasActivas,
      totalTarjetasCompartidas,
      totalEscaneosOcr: sumaOcr[0]?.total || 0,
      totalInvitacionesPendientes,
      usuariosPorMes,
      tarjetasPorMes,
      compartidosPorMes,
      activacionesPorMes
    });
  } catch (error) {
    return jsonResponse({ error: "Error al consultar el resumen.", message: error.message }, 500);
  }
}

export async function handleCambiarEstado(request, env, telefonoObjetivo) {
  const { error, sesion } = await requerirAdmin(request, env);
  if (error) return error;

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const nuevoEstado = body.estado === "suspendido" ? "suspendido" : "activo";
  if (telefonoObjetivo === sesion.telefono && nuevoEstado === "suspendido") {
    return jsonResponse({ error: "No puedes suspender tu propia cuenta." }, 400);
  }

  try {
    const resultado = await withUsuarios(env, (collection) =>
      collection.updateOne({ telefono: telefonoObjetivo }, { $set: { estado: nuevoEstado } })
    );
    if (resultado.matchedCount === 0) {
      return jsonResponse({ error: "Usuario no encontrado." }, 404);
    }
    return jsonResponse({ ok: true, telefono: telefonoObjetivo, estado: nuevoEstado });
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar el estado.", message: error.message }, 500);
  }
}

export async function handleCambiarRol(request, env, telefonoObjetivo) {
  const { error } = await requerirAdmin(request, env);
  if (error) return error;

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const nuevoRol = body.rol === "admin" ? "admin" : "usuario";

  try {
    const resultado = await withUsuarios(env, (collection) =>
      collection.updateOne({ telefono: telefonoObjetivo }, { $set: { rol: nuevoRol } })
    );
    if (resultado.matchedCount === 0) {
      return jsonResponse({ error: "Usuario no encontrado." }, 404);
    }
    return jsonResponse({ ok: true, telefono: telefonoObjetivo, rol: nuevoRol });
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar el rol.", message: error.message }, 500);
  }
}

// El admin puede corregir el nombre de cualquier usuario y/o resetearle el
// DPI (soporte cuando alguien lo olvida) sin necesitar el DPI anterior.
export async function handleAdminEditarUsuario(request, env, telefonoObjetivo) {
  const { error } = await requerirAdmin(request, env);
  if (error) return error;

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const nombreNuevo = texto(body.nombre);
  const dpiNuevo = soloDigitos(body.dpiNuevo);

  if (!nombreNuevo && !dpiNuevo) {
    return jsonResponse({ error: "No hay cambios para aplicar." }, 400);
  }

  const cambios = {};
  if (nombreNuevo) cambios.nombre = nombreNuevo;
  if (dpiNuevo) {
    if (dpiNuevo.length < 8) return jsonResponse({ error: "El nuevo DPI no es válido." }, 400);
    const salt = generarSalt();
    cambios.dpiSalt = salt;
    cambios.dpiHash = await hashConSalt(dpiNuevo, salt);
  }

  try {
    const resultado = await withUsuarios(env, (collection) =>
      collection.updateOne({ telefono: telefonoObjetivo }, { $set: cambios })
    );
    if (resultado.matchedCount === 0) return jsonResponse({ error: "Usuario no encontrado." }, 404);
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar el usuario.", message: error.message }, 500);
  }
}
