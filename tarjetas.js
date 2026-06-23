// --- Tarjetas (privadas por usuario) ---

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { normalizarUrl } from "./src/utils/validateUrl.js";
import { leerImagen } from "./src/utils/validateImage.js";
import { normalizarTelefono } from "./src/utils/normalizePhone.js";
import { obtenerSesion } from "./src/middleware/authMiddleware.js";
import { parseObjectId, withTarjetas, withUsuarios } from "./lib/db.js";

// Las fotos de frente/reverso/perfil pueden pesar varios cientos de KB cada
// una en base64. Mandarlas completas en una lista de N tarjetas hacía que la
// respuesta llegara a pesar más de 1 MB y se sintiera "trabada" para cargar,
// sobre todo en datos móviles. Las listas excluyen esas imágenes pesadas y
// usan "avatarMini" (una miniatura chica, generada en el navegador) en su
// lugar; el detalle/edición de una tarjeta puntual sí trae las imágenes
// completas vía GET /api/tarjetas/:id.
export const PROYECCION_SIN_IMAGENES_PESADAS = { imagenFrente: 0, imagenReverso: 0, fotoPerfil: 0 };

export async function handleListTarjetas(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  try {
    const tarjetas = await withTarjetas(env, (collection) =>
      collection
        .find({ propietarioTelefono: sesion.telefono }, { projection: PROYECCION_SIN_IMAGENES_PESADAS })
        .sort({ creadoEn: -1 })
        .toArray()
    );
    return jsonResponse(tarjetas);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar las tarjetas.", message: error.message }, 500);
  }
}

const ETIQUETAS_VALIDAS = ["cliente", "proveedor", "aliado"];

export function camposTarjeta(body) {
  const etiqueta = texto(body.etiqueta).toLowerCase();
  return {
    nombre: texto(body.nombre),
    empresa: texto(body.empresa),
    cargo: texto(body.cargo),
    telefono: texto(body.telefono),
    telefonoNormalizado: normalizarTelefono(body.telefono),
    email: texto(body.email),
    sitioWeb: normalizarUrl(body.sitioWeb),
    notas: texto(body.notas),
    facebook: texto(body.facebook),
    instagram: texto(body.instagram),
    linkedin: texto(body.linkedin),
    tiktok: texto(body.tiktok),
    twitter: texto(body.twitter),
    categoria: texto(body.categoria),
    etiqueta: ETIQUETAS_VALIDAS.includes(etiqueta) ? etiqueta : "",
    favorito: Boolean(body.favorito),
    esMiTarjeta: Boolean(body.esMiTarjeta)
  };
}

// Busca si el propio usuario ya tiene guardada una tarjeta con el mismo
// teléfono (sin importar el formato). Solo dentro de su colección — un
// mismo contacto real sí puede aparecer en las colecciones de varios
// usuarios distintos (eso es justamente lo que permite el directorio).
export async function buscarTarjetaDuplicada(env, propietarioTelefono, telefonoNormalizado, excluirId) {
  if (!telefonoNormalizado) return null;
  const filtro = { propietarioTelefono, telefonoNormalizado };
  if (excluirId) filtro._id = { $ne: excluirId };
  return withTarjetas(env, (collection) => collection.findOne(filtro));
}

export async function handleCreateTarjeta(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const campos = camposTarjeta(body);
  if (!campos.nombre) {
    return jsonResponse({ error: "El campo 'nombre' es obligatorio." }, 400);
  }

  const duplicada = await buscarTarjetaDuplicada(env, sesion.telefono, campos.telefonoNormalizado);
  if (duplicada) {
    return jsonResponse({
      error: "Ya existe una tarjeta registrada con este número.",
      duplicado: { _id: duplicada._id, nombre: duplicada.nombre, empresa: duplicada.empresa }
    }, 409);
  }

  let imagenFrente;
  let imagenReverso;
  let fotoPerfil;
  let avatarMini;
  try {
    imagenFrente = leerImagen(body.imagenFrente, "imagen del frente");
    imagenReverso = leerImagen(body.imagenReverso, "imagen del reverso");
    fotoPerfil = leerImagen(body.fotoPerfil, "foto de perfil");
    avatarMini = leerImagen(body.avatarMini, "miniatura de avatar");
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  const ahora = new Date();
  const tarjeta = {
    propietarioTelefono: sesion.telefono,
    // Si quien crea la tarjeta pertenece a un capítulo (CRM BNI), la
    // tarjeta queda vinculada a ese capítulo para reportes -- campo
    // puramente aditivo, no afecta a quien no usa el CRM.
    capituloId: sesion.capituloId || null,
    ...campos,
    imagenFrente,
    imagenReverso,
    fotoPerfil,
    avatarMini,
    vistas: 0,
    compartidos: 0,
    descargas: 0,
    creadoEn: ahora,
    actualizadoEn: ahora,
    editadoPorTelefono: sesion.telefono
  };

  try {
    const insertedId = await withTarjetas(env, async (collection) => {
      // Nota: no se hace deduplicación por número de teléfono — si ya existe
      // una tarjeta (propia o de otro usuario) con ese contacto, simplemente
      // se guarda una nueva, tal como se pidió.
      if (tarjeta.esMiTarjeta) {
        await collection.updateMany({ propietarioTelefono: sesion.telefono }, { $set: { esMiTarjeta: false } });
      }
      const result = await collection.insertOne(tarjeta);
      return result.insertedId;
    });
    return jsonResponse({ ...tarjeta, _id: insertedId }, 201);
  } catch (error) {
    return jsonResponse({ error: "Error al guardar la tarjeta.", message: error.message }, 500);
  }
}

export async function handleUpdateTarjeta(request, env, id) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID de tarjeta inválido." }, 400);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const campos = camposTarjeta(body);
  if (!campos.nombre) {
    return jsonResponse({ error: "El campo 'nombre' es obligatorio." }, 400);
  }

  const existente = await withTarjetas(env, (collection) => collection.findOne({ _id: objectId }));
  if (!existente) return jsonResponse({ error: "Tarjeta no encontrada." }, 404);
  // El dueño siempre puede editar la suya; un admin puede editar cualquiera
  // (Mejora 7 — administración completa de la plataforma).
  if (existente.propietarioTelefono !== sesion.telefono && sesion.rol !== "admin") {
    return jsonResponse({ error: "No puedes editar una tarjeta que no es tuya." }, 403);
  }

  // El duplicado se busca en la colección del DUEÑO de la tarjeta, no en la
  // de quien edita (relevante cuando es un admin editando una tarjeta ajena).
  const duplicada = await buscarTarjetaDuplicada(env, existente.propietarioTelefono, campos.telefonoNormalizado, objectId);
  if (duplicada) {
    return jsonResponse({
      error: "Ya existe otra tarjeta de ese usuario registrada con este número.",
      duplicado: { _id: duplicada._id, nombre: duplicada.nombre, empresa: duplicada.empresa }
    }, 409);
  }

  const cambios = { ...campos, actualizadoEn: new Date(), editadoPorTelefono: sesion.telefono };
  try {
    // Si no se manda una imagen nueva, se conserva la que ya estaba guardada.
    if (body.imagenFrente) cambios.imagenFrente = leerImagen(body.imagenFrente, "imagen del frente");
    if (body.imagenReverso) cambios.imagenReverso = leerImagen(body.imagenReverso, "imagen del reverso");
    if (body.fotoPerfil) cambios.fotoPerfil = leerImagen(body.fotoPerfil, "foto de perfil");
    if (body.avatarMini) cambios.avatarMini = leerImagen(body.avatarMini, "miniatura de avatar");
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  try {
    const resultado = await withTarjetas(env, async (collection) => {
      if (cambios.esMiTarjeta) {
        await collection.updateMany(
          { propietarioTelefono: existente.propietarioTelefono, _id: { $ne: objectId } },
          { $set: { esMiTarjeta: false } }
        );
      }
      await collection.updateOne({ _id: objectId }, { $set: cambios });
      return { ...existente, ...cambios };
    });
    return jsonResponse(resultado);
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar la tarjeta.", message: error.message }, 500);
  }
}

// Directorio compartido: todas las tarjetas de todos los usuarios, sin
// revelar quién las guardó. Pensado para buscar proveedores ya conocidos
// por otros miembros del sistema.
export async function handleDirectorio(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  try {
    const tarjetas = await withTarjetas(env, (collection) =>
      collection
        .find({}, { projection: { propietarioTelefono: 0, ...PROYECCION_SIN_IMAGENES_PESADAS } })
        .sort({ creadoEn: -1 })
        .toArray()
    );
    return jsonResponse(tarjetas);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar el directorio.", message: error.message }, 500);
  }
}

// Una tarjeta puntual con sus imágenes completas (frente/reverso/perfil),
// para el detalle y la edición. Cualquier usuario autenticado puede verla
// (igual que en el directorio), pero solo se revela quién es el dueño si es
// el propio usuario.
export async function handleGetTarjeta(request, env, id) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID de tarjeta inválido." }, 400);

  try {
    const tarjeta = await withTarjetas(env, (collection) => collection.findOne({ _id: objectId }));
    if (!tarjeta) return jsonResponse({ error: "Tarjeta no encontrada." }, 404);
    if (tarjeta.propietarioTelefono !== sesion.telefono) delete tarjeta.propietarioTelefono;
    return jsonResponse(tarjeta);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar la tarjeta.", message: error.message }, 500);
  }
}

// Envía una copia independiente de una tarjeta guardada a otro usuario
// registrado de la app (por su teléfono). No transfiere propiedad: el
// remitente conserva su tarjeta y el destinatario recibe su propia copia
// editable, igual que ya funciona con escaneo e invitaciones. Se guarda el
// origen y quién la compartió como metadata del propio documento (no hay
// una tabla de relación separada -- el modelo es Mongo, no SQL).
export async function handleEnviarTarjeta(request, env, id) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID de tarjeta inválido." }, 400);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const telefonoReceptor = normalizarTelefono(body.telefono);
  if (!telefonoReceptor) return jsonResponse({ error: "Ingresa un número de teléfono válido." }, 400);

  try {
    const tarjeta = await withTarjetas(env, (collection) => collection.findOne({ _id: objectId }));
    if (!tarjeta) return jsonResponse({ error: "Tarjeta no encontrada." }, 404);
    // Solo se puede compartir una tarjeta que uno mismo tiene guardada.
    if (tarjeta.propietarioTelefono !== sesion.telefono) {
      return jsonResponse({ error: "Solo puedes enviar tarjetas que tienes guardadas." }, 403);
    }
    if (telefonoReceptor === sesion.telefono) {
      return jsonResponse({ error: "No puedes enviarte una tarjeta a ti mismo." }, 400);
    }

    const receptor = await withUsuarios(env, (collection) => collection.findOne({ telefono: telefonoReceptor }));
    if (!receptor) {
      return jsonResponse({ error: "No existe un usuario registrado con ese número." }, 404);
    }

    const duplicada = await buscarTarjetaDuplicada(env, telefonoReceptor, tarjeta.telefonoNormalizado);
    if (duplicada) {
      return jsonResponse({ error: "Este usuario ya tiene esta tarjeta guardada." }, 409);
    }

    const ahora = new Date();
    const copia = {
      propietarioTelefono: telefonoReceptor,
      capituloId: receptor.capituloId || null,
      nombre: tarjeta.nombre, empresa: tarjeta.empresa, cargo: tarjeta.cargo,
      telefono: tarjeta.telefono, telefonoNormalizado: tarjeta.telefonoNormalizado,
      email: tarjeta.email, sitioWeb: tarjeta.sitioWeb, notas: "",
      facebook: tarjeta.facebook, instagram: tarjeta.instagram, linkedin: tarjeta.linkedin,
      tiktok: tarjeta.tiktok, twitter: tarjeta.twitter, categoria: tarjeta.categoria,
      etiqueta: "", favorito: false, esMiTarjeta: false,
      imagenFrente: tarjeta.imagenFrente || "", imagenReverso: tarjeta.imagenReverso || "",
      fotoPerfil: tarjeta.fotoPerfil || "", avatarMini: tarjeta.avatarMini || "",
      vistas: 0, compartidos: 0, descargas: 0,
      creadoEn: ahora, actualizadoEn: ahora, editadoPorTelefono: telefonoReceptor,
      origen: "compartida", compartidaPorTelefono: sesion.telefono, compartidaEn: ahora
    };
    const insertedId = await withTarjetas(env, (collection) => collection.insertOne(copia).then((r) => r.insertedId));

    return jsonResponse({ ok: true, _id: insertedId, receptorNombre: receptor.nombre }, 201);
  } catch (error) {
    return jsonResponse({ error: "Error al enviar la tarjeta.", message: error.message }, 500);
  }
}

// Vista pública (sin login) de una tarjeta marcada como "mi tarjeta" por su
// dueño, para poder compartirla por WhatsApp/redes con un enlace directo.
export async function handleTarjetaPublica(env, id) {
  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID inválido." }, 400);

  try {
    const tarjeta = await withTarjetas(env, (collection) =>
      collection.findOne({ _id: objectId, esMiTarjeta: true }, { projection: { propietarioTelefono: 0 } })
    );
    if (!tarjeta) return jsonResponse({ error: "Tarjeta no encontrada o no es pública." }, 404);
    return jsonResponse(tarjeta);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar la tarjeta.", message: error.message }, 500);
  }
}
