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
import { generarSlugBase } from "./src/utils/slug.js";
import { withUsuarios, withTarjetas, withCollection, parseObjectId } from "./lib/db.js";

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

// El vínculo entre una tarjeta y un networker ya existe por identidad
// (tarjeta.propietarioTelefono === networker.telefono); esto solo lo hace
// visible en el CRM, mostrando para cada networker del capítulo si su
// tarjeta personal está configurada y con qué estadísticas, en vez de
// mandar a la persona a la PWA a buscarlo a ciegas.
export async function handleNetworkersConTarjetas(request, env) {
  const denegado = await requerirModulo(request, env, "tarjetas", "ver");
  if (denegado) return denegado;

  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = esSuperAdmin(sesion) ? url.searchParams.get("capituloId") : sesion.capituloId;
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  try {
    const networkers = await withUsuarios(env, (collection) =>
      collection
        .find({ capituloId, rol: "networker" }, { projection: { telefono: 1, nombre: 1, empresa: 1, estadoNetworker: 1 } })
        .sort({ nombre: 1 })
        .toArray()
    );
    const telefonos = networkers.map((n) => n.telefono);
    const tarjetas = await withTarjetas(env, (collection) =>
      collection
        .find(
          { propietarioTelefono: { $in: telefonos }, esMiTarjeta: true },
          { projection: { propietarioTelefono: 1, nombre: 1, empresa: 1, fotoPerfil: 1, vistas: 1, compartidos: 1, actualizadoEn: 1 } }
        )
        .toArray()
    );
    const tarjetaPorTelefono = new Map(tarjetas.map((t) => [t.propietarioTelefono, t]));

    return jsonResponse(
      networkers.map((n) => {
        const t = tarjetaPorTelefono.get(n.telefono);
        return {
          telefono: n.telefono,
          nombre: n.nombre,
          empresa: n.empresa,
          estadoNetworker: n.estadoNetworker,
          tieneTarjeta: Boolean(t),
          tarjetaId: t ? String(t._id) : null,
          fotoPerfil: t?.fotoPerfil || "",
          vistas: t?.vistas || 0,
          compartidos: t?.compartidos || 0,
          actualizadoEn: t?.actualizadoEn || null
        };
      })
    );
  } catch (error) {
    return jsonResponse({ error: "Error al consultar tarjetas de networkers.", message: error.message }, 500);
  }
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
      // Solo se toca si el formulario lo manda explícitamente -- si no, se
      // deja como estaba (evita que editar cualquier otro campo reactive
      // sin querer una tarjeta que el admin había desactivado).
      if (body.tarjetaDigitalActiva !== undefined) cambios.tarjetaDigitalActiva = Boolean(body.tarjetaDigitalActiva);
      await withUsuarios(env, (collection) => collection.updateOne({ telefono }, { $set: cambios }));
      return jsonResponse({ telefono, ...cambios });
    }

    const nuevo = {
      telefono,
      ...campos,
      capituloId,
      rol: "networker",
      estado: "activo", // estado de la cuenta (acceso a la plataforma) -- distinto de estadoNetworker (membresía BNI)
      tarjetaDigitalActiva: true,
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

const PROYECCION_CARD_PUBLICO = {
  nombre: 1, empresa: 1, cargo: 1, especialidad: 1, categoriaBNI: 1, esferaId: 1, capituloId: 1,
  telefono: 1, whatsapp: 1, correo: 1, sitioWeb: 1, facebook: 1, instagram: 1, linkedin: 1, tiktok: 1,
  fotoPerfil: 1, logoEmpresa: 1, direccionComercial: 1, descripcionServicios: 1, palabrasClave: 1,
  horarioAtencion: 1, slug: 1, tarjetaDigitalActiva: 1
};

// Tarjeta digital pública del networker (/card/:slug). A diferencia de
// /api/tarjeta-publica/:id (que lee un documento aparte en "tarjetas"),
// esto lee en vivo del propio perfil del networker -- una sola fuente de
// datos, sin nada que sincronizar ni que pueda quedar desactualizado.
export async function handleObtenerCardPublico(request, env, slug) {
  if (!slug) return jsonResponse({ error: "Falta el slug." }, 400);

  try {
    const networker = await withUsuarios(env, (collection) =>
      collection.findOne({ slug, rol: "networker" }, { projection: PROYECCION_CARD_PUBLICO })
    );
    if (!networker) return jsonResponse({ error: "Tarjeta no encontrada." }, 404);
    if (networker.tarjetaDigitalActiva === false) {
      return jsonResponse({ error: "Esta tarjeta digital no está disponible." }, 404);
    }

    let esferaNombre = "";
    let capituloNombre = "";
    if (networker.esferaId) {
      const esfera = await withCollection(env, "esferas", (c) => c.findOne({ _id: parseObjectId(networker.esferaId) }));
      esferaNombre = esfera?.nombre || "";
    }
    if (networker.capituloId) {
      const capitulo = await withCollection(env, "capitulos", (c) => c.findOne({ _id: parseObjectId(networker.capituloId) }));
      capituloNombre = capitulo?.nombre || "";
    }

    const { esferaId, capituloId, tarjetaDigitalActiva, ...publico } = networker;
    return jsonResponse({ ...publico, esferaNombre, capituloNombre });
  } catch (error) {
    return jsonResponse({ error: "Error al consultar la tarjeta.", message: error.message }, 500);
  }
}

// Solo admin_capitulo (de su propio capítulo) o superadmin pueden forzar un
// slug nuevo -- el link viejo deja de servir apenas se guarda este cambio,
// así que no es algo que el networker deba poder hacer sin permiso.
export async function handleRegenerarSlugNetworker(request, env, telefonoParam) {
  const telefono = soloDigitos(telefonoParam);

  try {
    const networker = await withUsuarios(env, (collection) => collection.findOne({ telefono }));
    if (!networker) return jsonResponse({ error: "Networker no encontrado." }, 404);

    const { error } = await requerirAdminCapitulo(request, env, networker.capituloId);
    if (error) return error;

    // A diferencia de la generación inicial (determinística por
    // nombre+empresa), "regenerar" debe producir SIEMPRE un valor distinto
    // al actual -- si no, alguien con el mismo nombre/empresa de antes
    // recibiría el mismo slug y el link viejo seguiría funcionando.
    const base = generarSlugBase(networker.nombre, networker.empresa);
    let slug;
    do {
      const sufijo = Math.random().toString(36).slice(2, 6);
      slug = `${base}-${sufijo}`;
      // eslint-disable-next-line no-await-in-loop
    } while (slug === networker.slug || (await withUsuarios(env, (c) => c.findOne({ slug }, { projection: { _id: 1 } }))));

    await withUsuarios(env, (collection) => collection.updateOne({ telefono }, { $set: { slug, actualizadoEn: new Date() } }));
    return jsonResponse({ telefono, slug });
  } catch (error) {
    return jsonResponse({ error: "Error al regenerar el código.", message: error.message }, 500);
  }
}
