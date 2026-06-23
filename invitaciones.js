import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { soloDigitos, normalizarTelefono } from "./src/utils/normalizePhone.js";
import { bytesAHex, generarSalt, hashConSalt, firmarSesion } from "./lib/crypto.js";
import { SESION_DURACION_MS, cookieSesion, obtenerConfig } from "./lib/sesion.js";
import { obtenerSesion } from "./src/middleware/authMiddleware.js";
import { parseObjectId, withUsuarios, withTarjetas, withInvitaciones } from "./lib/db.js";
import { infoUsuarioPublica } from "./usuarios.js";

const INVITACION_DURACION_MS = 1000 * 60 * 60 * 24 * 30; // 30 días

function generarToken(longitudBytes = 24) {
  const bytes = new Uint8Array(longitudBytes);
  crypto.getRandomValues(bytes);
  return bytesAHex(bytes);
}

function infoInvitacionPublica(invitacion, request) {
  const origen = new URL(request.url).origin;
  return {
    token: invitacion.token,
    link: `${origen}/activar?token=${invitacion.token}`,
    nombreContacto: invitacion.nombreContacto,
    telefonoContacto: invitacion.telefonoContacto
  };
}

// Crea (o reutiliza una pendiente sin vencer) una invitación para que el
// contacto de esta tarjeta reclame su propia cuenta. Solo el dueño de la
// tarjeta puede invitar a su propio contacto.
export async function handleCrearInvitacion(request, env, idTarjeta) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(idTarjeta);
  if (!objectId) return jsonResponse({ error: "ID de tarjeta inválido." }, 400);

  try {
    const tarjeta = await withTarjetas(env, (collection) => collection.findOne({ _id: objectId }));
    if (!tarjeta) return jsonResponse({ error: "Tarjeta no encontrada." }, 404);
    if (tarjeta.propietarioTelefono !== sesion.telefono) {
      return jsonResponse({ error: "No tienes permiso sobre esta tarjeta." }, 403);
    }

    const telefonoNormalizado = tarjeta.telefonoNormalizado || normalizarTelefono(tarjeta.telefono);
    if (!telefonoNormalizado) {
      return jsonResponse({ error: "Esta tarjeta no tiene un teléfono válido para invitar." }, 400);
    }

    const yaEsUsuario = await withUsuarios(env, (collection) => collection.findOne({ telefono: telefonoNormalizado }));
    if (yaEsUsuario) {
      return jsonResponse({ error: "Este contacto ya tiene una cuenta en la plataforma." }, 409);
    }

    const existente = await withInvitaciones(env, (collection) =>
      collection.findOne({ telefonoNormalizado, estado: "pendiente", expiraEn: { $gt: new Date() } })
    );
    if (existente) return jsonResponse(infoInvitacionPublica(existente, request));

    const ahora = new Date();
    const invitacion = {
      token: generarToken(),
      nombreContacto: tarjeta.nombre,
      empresaContacto: tarjeta.empresa,
      telefonoContacto: tarjeta.telefono,
      telefonoNormalizado,
      // Estos datos solo se usan para precargar la primera tarjeta del
      // contacto cuando acepte la invitación; no se vuelven a tocar después.
      datosTarjeta: {
        cargo: tarjeta.cargo, email: tarjeta.email, sitioWeb: tarjeta.sitioWeb,
        facebook: tarjeta.facebook, instagram: tarjeta.instagram, linkedin: tarjeta.linkedin,
        tiktok: tarjeta.tiktok, twitter: tarjeta.twitter, categoria: tarjeta.categoria,
        imagenFrente: tarjeta.imagenFrente, imagenReverso: tarjeta.imagenReverso,
        fotoPerfil: tarjeta.fotoPerfil, avatarMini: tarjeta.avatarMini
      },
      invitadoPorTelefono: sesion.telefono,
      estado: "pendiente",
      creadoEn: ahora,
      expiraEn: new Date(ahora.getTime() + INVITACION_DURACION_MS)
    };
    await withInvitaciones(env, (collection) => collection.insertOne(invitacion));
    return jsonResponse(infoInvitacionPublica(invitacion, request), 201);
  } catch (error) {
    return jsonResponse({ error: "Error al crear la invitación.", message: error.message }, 500);
  }
}

// Vista pública (sin login) de la invitación, para que la página de
// activación pueda saludar al contacto por su nombre antes de pedirle datos.
export async function handleVerInvitacion(env, token) {
  try {
    const invitacion = await withInvitaciones(env, (collection) => collection.findOne({ token }));
    if (!invitacion) return jsonResponse({ error: "Invitación no encontrada." }, 404);
    if (invitacion.estado !== "pendiente" || invitacion.expiraEn < new Date()) {
      return jsonResponse({ error: "Esta invitación ya no está disponible." }, 410);
    }
    return jsonResponse({
      nombreContacto: invitacion.nombreContacto,
      empresaContacto: invitacion.empresaContacto,
      telefonoContacto: invitacion.telefonoContacto
    });
  } catch (error) {
    return jsonResponse({ error: "Error al consultar la invitación.", message: error.message }, 500);
  }
}

// El contacto invitado crea su propia cuenta (mismo modelo telefono+DPI de
// siempre) y, de una vez, se le crea su primera tarjeta ("mi tarjeta") ya
// precargada con lo que la persona que lo escaneó había guardado. La
// tarjeta original de quien invitó no se toca: cada uno tiene su copia.
export async function handleActivarInvitacion(request, env, token) {
  const { sessionSecret } = await obtenerConfig(env);
  if (!sessionSecret) return jsonResponse({ error: "Falta configurar SESSION_SECRET en el servidor." }, 500);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  try {
    const invitacion = await withInvitaciones(env, (collection) => collection.findOne({ token }));
    if (!invitacion) return jsonResponse({ error: "Invitación no encontrada." }, 404);
    if (invitacion.estado !== "pendiente" || invitacion.expiraEn < new Date()) {
      return jsonResponse({ error: "Esta invitación ya no está disponible." }, 410);
    }

    const telefono = soloDigitos(body.telefono) || invitacion.telefonoNormalizado;
    const dpi = soloDigitos(body.dpi);
    const nombre = texto(body.nombre) || invitacion.nombreContacto;

    if (!nombre) return jsonResponse({ error: "El nombre es obligatorio." }, 400);
    if (telefono.length < 8) return jsonResponse({ error: "El número de teléfono no es válido." }, 400);
    if (dpi.length < 8) return jsonResponse({ error: "El DPI no es válido." }, 400);

    let usuarioNuevo;
    await withUsuarios(env, async (collection) => {
      const existenteUsuario = await collection.findOne({ telefono });
      if (existenteUsuario) throw new Error("Ya existe una cuenta con ese número de teléfono.");
      const salt = generarSalt();
      const dpiHash = await hashConSalt(dpi, salt);
      usuarioNuevo = {
        telefono, nombre, dpiHash, dpiSalt: salt, rol: "usuario", estado: "activo",
        openaiApiKey: "", fotoPerfil: invitacion.datosTarjeta?.fotoPerfil || "",
        creadoEn: new Date(), ultimoAcceso: new Date()
      };
      await collection.insertOne(usuarioNuevo);
    });

    const ahora = new Date();
    const d = invitacion.datosTarjeta || {};
    const telefonoTarjeta = invitacion.telefonoContacto || telefono;
    await withTarjetas(env, (collection) => collection.insertOne({
      propietarioTelefono: telefono,
      nombre, empresa: invitacion.empresaContacto || "", cargo: d.cargo || "",
      telefono: telefonoTarjeta, telefonoNormalizado: normalizarTelefono(telefonoTarjeta),
      email: d.email || "", sitioWeb: d.sitioWeb || "", notas: "",
      facebook: d.facebook || "", instagram: d.instagram || "", linkedin: d.linkedin || "",
      tiktok: d.tiktok || "", twitter: d.twitter || "", categoria: d.categoria || "",
      etiqueta: "", favorito: false, esMiTarjeta: true,
      imagenFrente: d.imagenFrente || "", imagenReverso: d.imagenReverso || "",
      fotoPerfil: d.fotoPerfil || "", avatarMini: d.avatarMini || "",
      vistas: 0, compartidos: 0, descargas: 0, creadoEn: ahora, actualizadoEn: ahora, editadoPorTelefono: telefono
    }));

    await withInvitaciones(env, (collection) => collection.updateOne({ token }, { $set: { estado: "aceptada", aceptadoEn: ahora } }));

    const sesionToken = await firmarSesion({ telefono, rol: "usuario", exp: Date.now() + SESION_DURACION_MS }, sessionSecret);
    return jsonResponse(infoUsuarioPublica(usuarioNuevo), 201, { "Set-Cookie": cookieSesion(sesionToken) });
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }
}
