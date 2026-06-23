// --- Networkers (miembros de un capítulo) ---
// Un networker ES un usuario (misma identidad/teléfono); este módulo solo
// administra los campos de membresía BNI (empresa, esfera, categoría,
// fechas, estado de membresía, capítulo) sobre la colección "usuarios"
// existente -- no se crea una colección paralela para no duplicar la
// identidad de la persona.

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { soloDigitos } from "./src/utils/normalizePhone.js";
import { obtenerSesion, requerirAdminCapitulo, esSuperAdmin } from "./src/middleware/authMiddleware.js";
import { requerirModulo } from "./permisos.js";
import { withUsuarios, withTarjetas } from "./lib/db.js";

const ESTADOS_NETWORKER_VALIDOS = ["activo", "invitado", "suspendido", "prospecto"];
const PROYECCION_SIN_CREDENCIALES = { dpiHash: 0, dpiSalt: 0, openaiApiKey: 0 };
const PROYECCION_PUBLICA = {
  telefono: 1, nombre: 1, empresa: 1, especialidad: 1, categoriaBNI: 1, esferaId: 1,
  whatsapp: 1, sitioWeb: 1, fotoPerfil: 1, estadoNetworker: 1
};

function camposNetworker(body) {
  const estadoNetworker = texto(body.estadoNetworker).toLowerCase();
  return {
    nombre: texto(body.nombre),
    empresa: texto(body.empresa),
    especialidad: texto(body.especialidad),
    categoriaBNI: texto(body.categoriaBNI),
    esferaId: texto(body.esferaId) || null,
    whatsapp: soloDigitos(body.whatsapp),
    sitioWeb: texto(body.sitioWeb),
    estadoNetworker: ESTADOS_NETWORKER_VALIDOS.includes(estadoNetworker) ? estadoNetworker : "prospecto",
    fechaIngreso: body.fechaIngreso ? new Date(body.fechaIngreso) : null,
    fechaRenovacion: body.fechaRenovacion ? new Date(body.fechaRenovacion) : null
  };
}

// Lista los networkers de un capítulo. Un superadmin puede pedir cualquier
// capituloId por query string; cualquier otro rol solo ve el de su propia
// sesión (se ignora cualquier capituloId que no sea el suyo).
export async function handleListNetworkers(request, env) {
  const denegado = await requerirModulo(request, env, "networkers", "ver");
  if (denegado) return denegado;

  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = esSuperAdmin(sesion) ? url.searchParams.get("capituloId") : sesion.capituloId;
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  try {
    const networkers = await withUsuarios(env, (collection) =>
      collection.find({ capituloId }, { projection: PROYECCION_SIN_CREDENCIALES }).sort({ nombre: 1 }).toArray()
    );
    return jsonResponse(await conTarjetaPublica(env, networkers));
  } catch (error) {
    return jsonResponse({ error: "Error al consultar networkers.", message: error.message }, 500);
  }
}

// Agrega tarjetaPublicaId (si la tiene marcada con esMiTarjeta) a cada
// networker, para que el botón "Ver tarjeta" enlace a /t?id=... sin que el
// frontend tenga que hacer una consulta aparte por persona.
async function conTarjetaPublica(env, networkers) {
  const telefonos = networkers.map((n) => n.telefono);
  const tarjetas = await withTarjetas(env, (collection) =>
    collection.find({ propietarioTelefono: { $in: telefonos }, esMiTarjeta: true }, { projection: { propietarioTelefono: 1 } }).toArray()
  );
  const tarjetaPorTelefono = new Map(tarjetas.map((t) => [t.propietarioTelefono, String(t._id)]));
  return networkers.map((n) => ({ ...n, tarjetaPublicaId: tarjetaPorTelefono.get(n.telefono) || null }));
}

export async function handleObtenerNetworker(request, env, telefono) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  try {
    const networker = await withUsuarios(env, (collection) =>
      collection.findOne({ telefono }, { projection: PROYECCION_SIN_CREDENCIALES })
    );
    if (!networker) return jsonResponse({ error: "Networker no encontrado." }, 404);
    if (!esSuperAdmin(sesion) && sesion.telefono !== telefono && sesion.capituloId !== networker.capituloId) {
      return jsonResponse({ error: "No tienes acceso a este networker." }, 403);
    }
    return jsonResponse(networker);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar el networker.", message: error.message }, 500);
  }
}

// Crea o actualiza el perfil de networker de un teléfono dentro de un
// capítulo. Si ese teléfono no tiene cuenta todavía, se crea un perfil sin
// credenciales (dpiHash null) -- la persona lo "completa" registrándose
// normalmente con ese mismo número (ver el ajuste correspondiente en
// auth.js: handleRegistro permite completar un perfil así en vez de
// rechazarlo como duplicado).
export async function handleGuardarNetworker(request, env, telefonoParam) {
  const denegado = await requerirModulo(request, env, "networkers", "crear");
  if (denegado) return denegado;

  const telefono = soloDigitos(telefonoParam);
  if (!telefono) return jsonResponse({ error: "Teléfono inválido." }, 400);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const capituloId = texto(body.capituloId);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  const { error } = await requerirAdminCapitulo(request, env, capituloId);
  if (error) return error;

  const campos = camposNetworker(body);
  if (!campos.nombre) return jsonResponse({ error: "El nombre es obligatorio." }, 400);

  try {
    const existente = await withUsuarios(env, (collection) => collection.findOne({ telefono }));
    const ahora = new Date();

    if (existente) {
      // No se le quita el rol admin/superadmin a alguien que ya lo tenía
      // solo por asignarlo a un capítulo como networker.
      const rolNuevo = existente.rol === "admin" || existente.rol === "superadmin" ? existente.rol : "networker";
      const cambios = { ...campos, capituloId, rol: rolNuevo, actualizadoEn: ahora };
      await withUsuarios(env, (collection) => collection.updateOne({ telefono }, { $set: cambios }));
      return jsonResponse({ telefono, ...cambios });
    }

    const nuevo = {
      telefono,
      ...campos,
      capituloId,
      rol: "networker",
      estado: "activo", // estado de la cuenta (acceso a la plataforma) -- distinto de estadoNetworker (membresía BNI)
      dpiHash: null,
      dpiSalt: null,
      openaiApiKey: "",
      fotoPerfil: "",
      creadoEn: ahora,
      actualizadoEn: ahora
    };
    await withUsuarios(env, (collection) => collection.insertOne(nuevo));
    const { dpiHash, dpiSalt, ...sinCredenciales } = nuevo;
    return jsonResponse(sinCredenciales, 201);
  } catch (error) {
    return jsonResponse({ error: "Error al guardar el networker.", message: error.message }, 500);
  }
}

// Directorio público sin autenticación, para visitantes o prospectos. Solo
// expone campos de contacto, nunca datos administrativos ni de otros
// capítulos. Si el networker tiene una tarjeta marcada como "esMiTarjeta",
// se incluye su id para enlazar a la vista pública /t?id=... que ya existe.
export async function handleDirectorioPublico(request, env) {
  const url = new URL(request.url);
  const capituloId = texto(url.searchParams.get("capituloId"));
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  try {
    const networkers = await withUsuarios(env, (collection) =>
      collection.find({ capituloId, rol: "networker", estadoNetworker: "activo" }, { projection: PROYECCION_PUBLICA }).sort({ nombre: 1 }).toArray()
    );
    return jsonResponse(await conTarjetaPublica(env, networkers));
  } catch (error) {
    return jsonResponse({ error: "Error al consultar el directorio público.", message: error.message }, 500);
  }
}
