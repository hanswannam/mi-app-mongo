import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { soloDigitos } from "./src/utils/normalizePhone.js";
import { leerImagen } from "./src/utils/validateImage.js";
import { generarSalt, hashConSalt, firmarSesion } from "./lib/crypto.js";
import { SESION_DURACION_MS, cookieSesion, obtenerConfig } from "./lib/sesion.js";
import { obtenerSesion } from "./src/middleware/authMiddleware.js";
import { withUsuarios, withTarjetas } from "./lib/db.js";

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
