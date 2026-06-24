import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { soloDigitos } from "./src/utils/normalizePhone.js";
import { leerImagen } from "./src/utils/validateImage.js";
import { normalizarUrl, normalizarRedSocial } from "./src/utils/validateUrl.js";
import { generarSlugUnico } from "./src/utils/slug.js";
import { generarSalt, hashConSalt, firmarSesion } from "./lib/crypto.js";
import { SESION_DURACION_MS, cookieSesion, obtenerConfig } from "./lib/sesion.js";
import { obtenerSesion } from "./src/middleware/authMiddleware.js";
import { withUsuarios, withTarjetas, withCollection, parseObjectId } from "./lib/db.js";

const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function infoUsuarioPublica(usuario) {
  return {
    telefono: usuario.telefono,
    nombre: usuario.nombre,
    rol: usuario.rol,
    capituloId: usuario.capituloId || null,
    tieneApiKey: Boolean(usuario.openaiApiKey),
    fotoPerfil: usuario.fotoPerfil || ""
  };
}

export async function handleGuardarApiKey(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const openaiApiKey = texto(body.openaiApiKey);

  try {
    await withUsuarios(env, (collection) =>
      collection.updateOne({ telefono: sesion.telefono }, { $set: { openaiApiKey } })
    );
    return jsonResponse({ ok: true, tieneApiKey: Boolean(openaiApiKey) });
  } catch (error) {
    return jsonResponse({ error: "Error al guardar la API key.", message: error.message }, 500);
  }
}

// Edición del propio perfil: nombre, teléfono (usuario de login), DPI
// (contraseña) y/o foto de perfil. Siempre exige el DPI actual para
// confirmar el cambio. Si el teléfono cambia, también migra el
// propietario de sus tarjetas guardadas.
export async function handleActualizarUsuario(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const { sessionSecret } = await obtenerConfig(env);
  if (!sessionSecret) {
    return jsonResponse({ error: "Falta configurar SESSION_SECRET en el servidor." }, 500);
  }

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const dpiActual = soloDigitos(body.dpiActual);
  if (!dpiActual) {
    return jsonResponse({ error: "Debes ingresar tu DPI actual para confirmar los cambios." }, 400);
  }

  const nombreNuevo = texto(body.nombre);
  const telefonoNuevo = soloDigitos(body.telefono);
  const dpiNuevo = soloDigitos(body.dpiNuevo);

  let fotoPerfilNueva;
  try {
    fotoPerfilNueva = body.fotoPerfil ? leerImagen(body.fotoPerfil, "foto de perfil") : undefined;
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  try {
    const resultado = await withUsuarios(env, async (collection) => {
      const usuario = await collection.findOne({ telefono: sesion.telefono });
      if (!usuario) return { tipo: "no-encontrado" };

      const hashActual = await hashConSalt(dpiActual, usuario.dpiSalt);
      if (hashActual !== usuario.dpiHash) return { tipo: "dpi-incorrecto" };

      const cambios = {};
      if (nombreNuevo) cambios.nombre = nombreNuevo;
      if (fotoPerfilNueva !== undefined) cambios.fotoPerfil = fotoPerfilNueva;

      let telefonoAnterior = null;
      if (telefonoNuevo && telefonoNuevo !== usuario.telefono) {
        if (telefonoNuevo.length < 8) return { tipo: "telefono-invalido" };
        const existente = await collection.findOne({ telefono: telefonoNuevo });
        if (existente) return { tipo: "telefono-en-uso" };
        telefonoAnterior = usuario.telefono;
        cambios.telefono = telefonoNuevo;
      }

      if (dpiNuevo) {
        if (dpiNuevo.length < 8) return { tipo: "dpi-invalido" };
        const nuevoSalt = generarSalt();
        cambios.dpiSalt = nuevoSalt;
        cambios.dpiHash = await hashConSalt(dpiNuevo, nuevoSalt);
      }

      if (Object.keys(cambios).length > 0) {
        await collection.updateOne({ telefono: sesion.telefono }, { $set: cambios });
      }

      return { tipo: "ok", usuario: { ...usuario, ...cambios }, telefonoAnterior };
    });

    if (resultado.tipo === "no-encontrado") return jsonResponse({ error: "No autenticado." }, 401);
    if (resultado.tipo === "dpi-incorrecto") return jsonResponse({ error: "El DPI actual no es correcto." }, 401);
    if (resultado.tipo === "telefono-invalido") return jsonResponse({ error: "El nuevo número de teléfono no es válido." }, 400);
    if (resultado.tipo === "telefono-en-uso") return jsonResponse({ error: "Ese número de teléfono ya está en uso por otra cuenta." }, 409);
    if (resultado.tipo === "dpi-invalido") return jsonResponse({ error: "El nuevo DPI no es válido." }, 400);

    if (resultado.telefonoAnterior) {
      await withTarjetas(env, (collection) =>
        collection.updateMany(
          { propietarioTelefono: resultado.telefonoAnterior },
          { $set: { propietarioTelefono: resultado.usuario.telefono } }
        )
      );
    }

    const token = await firmarSesion(
      {
        telefono: resultado.usuario.telefono,
        rol: resultado.usuario.rol,
        capituloId: resultado.usuario.capituloId || null,
        exp: Date.now() + SESION_DURACION_MS
      },
      sessionSecret
    );
    return jsonResponse(infoUsuarioPublica(resultado.usuario), 200, { "Set-Cookie": cookieSesion(token) });
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar tu cuenta.", message: error.message }, 500);
  }
}

// --- Mi Perfil (panel del networker) ---
// Distinto de handleActualizarUsuario: aquí viven los campos de membresía
// BNI y de la tarjeta digital (empresa, esfera, redes sociales, etc.), no
// la identidad de la cuenta (teléfono/DPI) -- eso sigue en el flujo de
// arriba, ya probado y en uso.

const PROYECCION_SIN_CREDENCIALES = { dpiHash: 0, dpiSalt: 0, openaiApiKey: 0 };

export async function handleObtenerMiPerfil(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  try {
    let usuario = await withUsuarios(env, (collection) =>
      collection.findOne({ telefono: sesion.telefono }, { projection: PROYECCION_SIN_CREDENCIALES })
    );
    if (!usuario) return jsonResponse({ error: "No autenticado." }, 401);

    // El slug es lo que arma el link público (/card/slug); se genera una
    // sola vez, perezosamente, para no tener que migrar a todos los
    // networkers existentes de antemano.
    if (usuario.rol === "networker" && !usuario.slug) {
      const slug = await generarSlugUnico(env, withUsuarios, usuario.nombre, usuario.empresa);
      await withUsuarios(env, (collection) => collection.updateOne({ telefono: usuario.telefono }, { $set: { slug } }));
      usuario = { ...usuario, slug };
    }

    let esferaNombre = "";
    let capituloNombre = "";
    if (usuario.esferaId) {
      const esfera = await withCollection(env, "esferas", (c) => c.findOne({ _id: parseObjectId(usuario.esferaId) }));
      esferaNombre = esfera?.nombre || "";
    }
    if (usuario.capituloId) {
      const capitulo = await withCollection(env, "capitulos", (c) => c.findOne({ _id: parseObjectId(usuario.capituloId) }));
      capituloNombre = capitulo?.nombre || "";
    }

    return jsonResponse({ ...usuario, esferaNombre, capituloNombre });
  } catch (error) {
    return jsonResponse({ error: "Error al consultar tu perfil.", message: error.message }, 500);
  }
}

// Campos que el propio networker puede editar de su perfil. Todo lo que
// no esté en esta lista (capituloId, rol, telefono, estado, slug,
// tarjetaDigitalActiva, dpiHash...) se ignora aunque venga en el body --
// nunca se lee desde aquí, ni siquiera por error.
export async function handleActualizarMiPerfil(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  let fotoPerfil;
  let logoEmpresa;
  try {
    fotoPerfil = body.fotoPerfil !== undefined ? leerImagen(body.fotoPerfil, "foto de perfil") : undefined;
    logoEmpresa = body.logoEmpresa !== undefined ? leerImagen(body.logoEmpresa, "logo de empresa") : undefined;
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  const correo = texto(body.correo);
  if (correo && !REGEX_CORREO.test(correo)) {
    return jsonResponse({ error: "El correo no es válido." }, 400);
  }

  const cambios = {};
  if (body.nombre !== undefined) cambios.nombre = texto(body.nombre);
  if (fotoPerfil !== undefined) cambios.fotoPerfil = fotoPerfil;
  if (body.empresa !== undefined) cambios.empresa = texto(body.empresa);
  if (body.cargo !== undefined) cambios.cargo = texto(body.cargo);
  if (body.especialidad !== undefined) cambios.especialidad = texto(body.especialidad);
  if (body.categoriaBNI !== undefined) cambios.categoriaBNI = texto(body.categoriaBNI);
  if (body.esferaId !== undefined) cambios.esferaId = texto(body.esferaId) || null;
  if (body.whatsapp !== undefined) cambios.whatsapp = soloDigitos(body.whatsapp);
  if (body.correo !== undefined) cambios.correo = correo;
  if (body.sitioWeb !== undefined) cambios.sitioWeb = normalizarUrl(body.sitioWeb);
  if (body.facebook !== undefined) cambios.facebook = normalizarRedSocial("facebook", body.facebook);
  if (body.instagram !== undefined) cambios.instagram = normalizarRedSocial("instagram", body.instagram);
  if (body.linkedin !== undefined) cambios.linkedin = normalizarRedSocial("linkedin", body.linkedin);
  if (body.tiktok !== undefined) cambios.tiktok = normalizarRedSocial("tiktok", body.tiktok);
  if (body.direccionComercial !== undefined) cambios.direccionComercial = texto(body.direccionComercial);
  if (body.descripcionServicios !== undefined) cambios.descripcionServicios = texto(body.descripcionServicios);
  if (body.palabrasClave !== undefined) cambios.palabrasClave = texto(body.palabrasClave);
  if (body.horarioAtencion !== undefined) cambios.horarioAtencion = texto(body.horarioAtencion);
  if (logoEmpresa !== undefined) cambios.logoEmpresa = logoEmpresa;

  if (!cambios.nombre && cambios.nombre !== undefined) {
    return jsonResponse({ error: "El nombre no puede quedar vacío." }, 400);
  }

  try {
    cambios.actualizadoEn = new Date();
    await withUsuarios(env, (collection) => collection.updateOne({ telefono: sesion.telefono }, { $set: cambios }));
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar tu perfil.", message: error.message }, 500);
  }
}

export async function handleCambiarMiPassword(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const contrasenaActual = soloDigitos(body.contrasenaActual);
  const nuevaContrasena = soloDigitos(body.nuevaContrasena);
  const confirmarContrasena = soloDigitos(body.confirmarContrasena);

  if (!contrasenaActual) return jsonResponse({ error: "Ingresa tu contraseña actual." }, 400);
  if (nuevaContrasena.length < 8) return jsonResponse({ error: "La nueva contraseña debe tener al menos 8 dígitos." }, 400);
  if (nuevaContrasena !== confirmarContrasena) return jsonResponse({ error: "Las contraseñas nuevas no coinciden." }, 400);

  try {
    const usuario = await withUsuarios(env, (collection) => collection.findOne({ telefono: sesion.telefono }));
    if (!usuario) return jsonResponse({ error: "No autenticado." }, 401);

    const hashActual = await hashConSalt(contrasenaActual, usuario.dpiSalt);
    if (hashActual !== usuario.dpiHash) return jsonResponse({ error: "Tu contraseña actual no es correcta." }, 401);

    const nuevoSalt = generarSalt();
    const dpiHash = await hashConSalt(nuevaContrasena, nuevoSalt);
    await withUsuarios(env, (collection) =>
      collection.updateOne({ telefono: sesion.telefono }, { $set: { dpiHash, dpiSalt: nuevoSalt, actualizadoEn: new Date() } })
    );
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: "Error al cambiar tu contraseña.", message: error.message }, 500);
  }
}
