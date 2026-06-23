import { jsonResponse, texto, soloDigitos } from "./lib/utils.js";
import { generarSalt, hashConSalt } from "./lib/crypto.js";
import { requerirAdmin } from "./lib/sesion.js";
import { withUsuarios, withTarjetas, withEventos, withInvitaciones } from "./lib/db.js";
import { handleListCategorias, handleCrearCategoria, handleEliminarCategoria } from "./categorias.js";
import { handleOcr } from "./ocr.js";
import { handleRegistrarEvento, handleEstadisticasTarjeta } from "./eventos.js";
import { handleRegistro, handleLogin, handleRecuperarContacto, handleLogout, handleYo } from "./auth.js";
import { handleGuardarApiKey, handleActualizarUsuario } from "./usuarios.js";
import {
  handleListTarjetas,
  handleCreateTarjeta,
  handleUpdateTarjeta,
  handleDirectorio,
  handleGetTarjeta,
  handleTarjetaPublica
} from "./tarjetas.js";
import { handleCrearInvitacion, handleVerInvitacion, handleActivarInvitacion } from "./invitaciones.js";

// --- Administración ---

async function handleListUsuarios(request, env) {
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

async function handleResumenAdmin(request, env) {
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

async function handleCambiarEstado(request, env, telefonoObjetivo) {
  const { error, sesion } = await requerirAdmin(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "El cuerpo de la solicitud debe ser JSON válido." }, 400);
  }

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

async function handleCambiarRol(request, env, telefonoObjetivo) {
  const { error } = await requerirAdmin(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "El cuerpo de la solicitud debe ser JSON válido." }, 400);
  }

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
async function handleAdminEditarUsuario(request, env, telefonoObjetivo) {
  const { error } = await requerirAdmin(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "El cuerpo de la solicitud debe ser JSON válido." }, 400);
  }

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const metodo = request.method;

    if (pathname === "/api/auth/registro" && metodo === "POST") return handleRegistro(request, env);
    if (pathname === "/api/auth/login" && metodo === "POST") return handleLogin(request, env);
    if (pathname === "/api/auth/logout" && metodo === "POST") return handleLogout();
    if (pathname === "/api/auth/yo" && metodo === "GET") return handleYo(request, env);

    const matchRecuperar = pathname.match(/^\/api\/auth\/recuperar\/([^/]+)$/);
    if (matchRecuperar && metodo === "GET") return handleRecuperarContacto(request, env, decodeURIComponent(matchRecuperar[1]));
    if (pathname === "/api/usuario" && metodo === "PUT") return handleActualizarUsuario(request, env);
    if (pathname === "/api/usuario/openai-key" && metodo === "PUT") return handleGuardarApiKey(request, env);

    if (pathname === "/api/tarjetas" && metodo === "GET") return handleListTarjetas(request, env);
    if (pathname === "/api/tarjetas" && metodo === "POST") return handleCreateTarjeta(request, env);

    const matchTarjetaId = pathname.match(/^\/api\/tarjetas\/([^/]+)$/);
    if (matchTarjetaId && metodo === "GET") return handleGetTarjeta(request, env, decodeURIComponent(matchTarjetaId[1]));
    if (matchTarjetaId && metodo === "PUT") return handleUpdateTarjeta(request, env, decodeURIComponent(matchTarjetaId[1]));

    const matchEstadisticas = pathname.match(/^\/api\/tarjetas\/([^/]+)\/estadisticas$/);
    if (matchEstadisticas && metodo === "GET") return handleEstadisticasTarjeta(request, env, decodeURIComponent(matchEstadisticas[1]));

    const matchInvitar = pathname.match(/^\/api\/tarjetas\/([^/]+)\/invitar$/);
    if (matchInvitar && metodo === "POST") return handleCrearInvitacion(request, env, decodeURIComponent(matchInvitar[1]));

    const matchVerInvitacion = pathname.match(/^\/api\/invitaciones\/([^/]+)$/);
    if (matchVerInvitacion && metodo === "GET") return handleVerInvitacion(env, decodeURIComponent(matchVerInvitacion[1]));

    const matchActivarInvitacion = pathname.match(/^\/api\/invitaciones\/([^/]+)\/activar$/);
    if (matchActivarInvitacion && metodo === "POST") return handleActivarInvitacion(request, env, decodeURIComponent(matchActivarInvitacion[1]));

    if (pathname === "/api/directorio" && metodo === "GET") return handleDirectorio(request, env);

    const matchTarjetaPublica = pathname.match(/^\/api\/tarjeta-publica\/([^/]+)$/);
    if (matchTarjetaPublica && metodo === "GET") return handleTarjetaPublica(env, decodeURIComponent(matchTarjetaPublica[1]));

    const matchEvento = pathname.match(/^\/api\/eventos-tarjeta\/([^/]+)$/);
    if (matchEvento && metodo === "POST") return handleRegistrarEvento(request, env, decodeURIComponent(matchEvento[1]));

    if (pathname === "/api/ocr" && metodo === "POST") return handleOcr(request, env);

    if (pathname === "/api/categorias" && metodo === "GET") return handleListCategorias(request, env);
    if (pathname === "/api/admin/categorias" && metodo === "POST") return handleCrearCategoria(request, env);

    const matchCategoriaId = pathname.match(/^\/api\/admin\/categorias\/([^/]+)$/);
    if (matchCategoriaId && metodo === "DELETE") return handleEliminarCategoria(request, env, decodeURIComponent(matchCategoriaId[1]));

    if (pathname === "/api/admin/usuarios" && metodo === "GET") return handleListUsuarios(request, env);
    if (pathname === "/api/admin/resumen" && metodo === "GET") return handleResumenAdmin(request, env);

    const matchRol = pathname.match(/^\/api\/admin\/usuarios\/([^/]+)\/rol$/);
    if (matchRol && metodo === "PATCH") return handleCambiarRol(request, env, decodeURIComponent(matchRol[1]));

    const matchEstado = pathname.match(/^\/api\/admin\/usuarios\/([^/]+)\/estado$/);
    if (matchEstado && metodo === "PATCH") return handleCambiarEstado(request, env, decodeURIComponent(matchEstado[1]));

    const matchAdminUsuario = pathname.match(/^\/api\/admin\/usuarios\/([^/]+)$/);
    if (matchAdminUsuario && metodo === "PUT") return handleAdminEditarUsuario(request, env, decodeURIComponent(matchAdminUsuario[1]));

    return env.ASSETS.fetch(request);
  }
};
