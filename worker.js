import { jsonResponse, texto, soloDigitos, normalizarUrl, leerImagen } from "./lib/utils.js";
import { bytesAHex, generarSalt, hashConSalt, firmarSesion } from "./lib/crypto.js";
import {
  SESION_DURACION_MS,
  cookieSesion,
  COOKIE_LOGOUT,
  obtenerConfig,
  obtenerSesion,
  requerirAdmin
} from "./lib/sesion.js";
import {
  parseObjectId,
  withUsuarios,
  withTarjetas,
  withEventos,
  withInvitaciones
} from "./lib/db.js";
import { handleListCategorias, handleCrearCategoria, handleEliminarCategoria } from "./categorias.js";
import { handleOcr } from "./ocr.js";
import { handleRegistrarEvento, handleEstadisticasTarjeta } from "./eventos.js";

function infoUsuarioPublica(usuario) {
  return {
    telefono: usuario.telefono,
    nombre: usuario.nombre,
    rol: usuario.rol,
    tieneApiKey: Boolean(usuario.openaiApiKey),
    fotoPerfil: usuario.fotoPerfil || ""
  };
}

// --- Autenticación ---

async function handleRegistro(request, env) {
  const { sessionSecret } = await obtenerConfig(env);
  if (!sessionSecret) {
    return jsonResponse({ error: "Falta configurar SESSION_SECRET en el servidor." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "El cuerpo de la solicitud debe ser JSON válido." }, 400);
  }

  const telefono = soloDigitos(body.telefono);
  const dpi = soloDigitos(body.dpi);
  const nombre = texto(body.nombre);

  if (!nombre) return jsonResponse({ error: "El nombre es obligatorio." }, 400);
  if (telefono.length < 8) return jsonResponse({ error: "El número de teléfono no es válido." }, 400);
  if (dpi.length < 8) return jsonResponse({ error: "El DPI no es válido." }, 400);

  try {
    let usuarioNuevo;
    await withUsuarios(env, async (collection) => {
      const existente = await collection.findOne({ telefono });
      if (existente) {
        throw new Error("Ya existe una cuenta con ese número de teléfono.");
      }
      const salt = generarSalt();
      const dpiHash = await hashConSalt(dpi, salt);
      usuarioNuevo = {
        telefono,
        nombre,
        dpiHash,
        dpiSalt: salt,
        rol: "usuario",
        estado: "activo",
        openaiApiKey: "",
        fotoPerfil: "",
        creadoEn: new Date(),
        ultimoAcceso: new Date()
      };
      await collection.insertOne(usuarioNuevo);
    });

    const token = await firmarSesion({ telefono, rol: "usuario", exp: Date.now() + SESION_DURACION_MS }, sessionSecret);
    return jsonResponse(infoUsuarioPublica(usuarioNuevo), 201, { "Set-Cookie": cookieSesion(token) });
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }
}

async function handleLogin(request, env) {
  const { sessionSecret } = await obtenerConfig(env);
  if (!sessionSecret) {
    return jsonResponse({ error: "Falta configurar SESSION_SECRET en el servidor." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "El cuerpo de la solicitud debe ser JSON válido." }, 400);
  }

  const telefono = soloDigitos(body.telefono);
  const dpi = soloDigitos(body.dpi);
  if (!telefono || !dpi) {
    return jsonResponse({ error: "Teléfono y DPI son obligatorios." }, 400);
  }

  try {
    const usuario = await withUsuarios(env, (collection) => collection.findOne({ telefono }));
    if (!usuario) {
      return jsonResponse({ error: "Usuario o contraseña incorrectos." }, 401);
    }

    const hashCalculado = await hashConSalt(dpi, usuario.dpiSalt);
    if (hashCalculado !== usuario.dpiHash) {
      return jsonResponse({ error: "Usuario o contraseña incorrectos." }, 401);
    }
    if (usuario.estado === "suspendido") {
      return jsonResponse({ error: "Tu cuenta está suspendida. Contacta al administrador." }, 403);
    }

    await withUsuarios(env, (collection) => collection.updateOne({ telefono }, { $set: { ultimoAcceso: new Date() } }));

    const token = await firmarSesion({ telefono, rol: usuario.rol, exp: Date.now() + SESION_DURACION_MS }, sessionSecret);
    return jsonResponse(infoUsuarioPublica(usuario), 200, { "Set-Cookie": cookieSesion(token) });
  } catch (error) {
    return jsonResponse({ error: "Error al iniciar sesión.", message: error.message }, 500);
  }
}

// Sin una API de WhatsApp Business/Twilio (no configurada en este
// proyecto), el servidor no puede "enviar" un mensaje por sí solo. Esta
// ruta solo confirma que la cuenta existe y entrega el teléfono de un
// administrador, para que el frontend abra WhatsApp con el mensaje ya
// escrito y la persona lo envíe ella misma con un toque — el reseteo final
// lo completa un admin con el botón "Resetear DPI" que ya existe en /admin.
async function handleRecuperarContacto(request, env, telefono) {
  const telefonoLimpio = soloDigitos(telefono);
  if (!telefonoLimpio) return jsonResponse({ error: "Ingresa un número de teléfono válido." }, 400);

  try {
    const usuario = await withUsuarios(env, (collection) => collection.findOne({ telefono: telefonoLimpio }));
    if (!usuario) return jsonResponse({ error: "No existe ninguna cuenta con ese número." }, 404);

    const admin = await withUsuarios(env, (collection) => collection.findOne({ rol: "admin" }, { projection: { telefono: 1 } }));
    if (!admin) return jsonResponse({ error: "No hay un administrador disponible por ahora." }, 503);

    return jsonResponse({ telefonoSoporte: admin.telefono });
  } catch (error) {
    return jsonResponse({ error: "Error al buscar la cuenta.", message: error.message }, 500);
  }
}

function handleLogout() {
  return jsonResponse({ ok: true }, 200, { "Set-Cookie": COOKIE_LOGOUT });
}

async function handleYo(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  try {
    const usuario = await withUsuarios(env, (collection) => collection.findOne({ telefono: sesion.telefono }));
    if (!usuario) return jsonResponse({ error: "No autenticado." }, 401);
    if (usuario.estado === "suspendido") {
      return jsonResponse({ error: "Tu cuenta está suspendida. Contacta al administrador." }, 401, { "Set-Cookie": COOKIE_LOGOUT });
    }
    // /api/auth/yo se llama una vez por apertura de la app: es un buen punto,
    // sin saturar la base de datos, para registrar el último acceso real.
    await withUsuarios(env, (collection) => collection.updateOne({ telefono: sesion.telefono }, { $set: { ultimoAcceso: new Date() } }));
    return jsonResponse(infoUsuarioPublica(usuario));
  } catch (error) {
    return jsonResponse({ error: "Error al consultar la sesión.", message: error.message }, 500);
  }
}

async function handleGuardarApiKey(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "El cuerpo de la solicitud debe ser JSON válido." }, 400);
  }

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
async function handleActualizarUsuario(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const { sessionSecret } = await obtenerConfig(env);
  if (!sessionSecret) {
    return jsonResponse({ error: "Falta configurar SESSION_SECRET en el servidor." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "El cuerpo de la solicitud debe ser JSON válido." }, 400);
  }

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
      { telefono: resultado.usuario.telefono, rol: resultado.usuario.rol, exp: Date.now() + SESION_DURACION_MS },
      sessionSecret
    );
    return jsonResponse(infoUsuarioPublica(resultado.usuario), 200, { "Set-Cookie": cookieSesion(token) });
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar tu cuenta.", message: error.message }, 500);
  }
}

// --- Tarjetas (privadas por usuario) ---

// Las fotos de frente/reverso/perfil pueden pesar varios cientos de KB cada
// una en base64. Mandarlas completas en una lista de N tarjetas hacía que la
// respuesta llegara a pesar más de 1 MB y se sintiera "trabada" para cargar,
// sobre todo en datos móviles. Las listas excluyen esas imágenes pesadas y
// usan "avatarMini" (una miniatura chica, generada en el navegador) en su
// lugar; el detalle/edición de una tarjeta puntual sí trae las imágenes
// completas vía GET /api/tarjetas/:id.
const PROYECCION_SIN_IMAGENES_PESADAS = { imagenFrente: 0, imagenReverso: 0, fotoPerfil: 0 };

async function handleListTarjetas(request, env) {
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

// "50251136189", "+50251136189" y "51136189" deben tratarse como el mismo
// número: se normaliza a solo dígitos y se le quita el código de país
// (502) cuando está presente, dejando el número local de 8 dígitos.
function normalizarTelefono(valor) {
  let digitos = (valor || "").replace(/\D/g, "");
  if (digitos.length > 8 && digitos.startsWith("502")) {
    digitos = digitos.slice(3);
  }
  return digitos;
}

function camposTarjeta(body) {
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
async function buscarTarjetaDuplicada(env, propietarioTelefono, telefonoNormalizado, excluirId) {
  if (!telefonoNormalizado) return null;
  const filtro = { propietarioTelefono, telefonoNormalizado };
  if (excluirId) filtro._id = { $ne: excluirId };
  return withTarjetas(env, (collection) => collection.findOne(filtro));
}

async function handleCreateTarjeta(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "El cuerpo de la solicitud debe ser JSON válido." }, 400);
  }

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

async function handleUpdateTarjeta(request, env, id) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID de tarjeta inválido." }, 400);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "El cuerpo de la solicitud debe ser JSON válido." }, 400);
  }

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
async function handleDirectorio(request, env) {
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
async function handleGetTarjeta(request, env, id) {
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
async function handleCrearInvitacion(request, env, idTarjeta) {
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
async function handleVerInvitacion(env, token) {
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
async function handleActivarInvitacion(request, env, token) {
  const { sessionSecret } = await obtenerConfig(env);
  if (!sessionSecret) return jsonResponse({ error: "Falta configurar SESSION_SECRET en el servidor." }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "El cuerpo de la solicitud debe ser JSON válido." }, 400);
  }

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

// Vista pública (sin login) de una tarjeta marcada como "mi tarjeta" por su
// dueño, para poder compartirla por WhatsApp/redes con un enlace directo.
async function handleTarjetaPublica(env, id) {
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
