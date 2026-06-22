import { MongoClient, ObjectId } from "mongodb";

const MAX_IMAGEN_BASE64 = 2_000_000; // ~1.5 MB de imagen real, ya comprimida en el navegador
const SESION_DURACION_MS = 1000 * 60 * 60 * 24 * 30; // 30 días

const CATEGORIAS_DEFECTO = [
  "Tecnología",
  "Restaurantes y Alimentos",
  "Construcción",
  "Salud y Bienestar",
  "Educación",
  "Legal",
  "Finanzas y Seguros",
  "Belleza y Estética",
  "Automotriz",
  "Bienes Raíces",
  "Eventos y Entretenimiento",
  "Diseño y Marketing",
  "Transporte y Logística",
  "Turismo y Hotelería",
  "Moda y Retail",
  "Servicios Profesionales",
  "Otros"
];

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

function texto(valor) {
  return (valor || "").trim();
}

function soloDigitos(valor) {
  return (valor || "").replace(/\D/g, "");
}

function leerImagen(valor, nombreCampo) {
  if (!valor) return "";
  if (typeof valor !== "string" || !valor.startsWith("data:image/")) {
    throw new Error(`El campo '${nombreCampo}' debe ser una imagen válida.`);
  }
  if (valor.length > MAX_IMAGEN_BASE64) {
    throw new Error(`La imagen de '${nombreCampo}' es demasiado grande. Usa una más liviana.`);
  }
  return valor;
}

function parseObjectId(id) {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
}

// --- Criptografía (Web Crypto, disponible nativamente en Workers) ---

function bytesAHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexABytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function generarSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesAHex(bytes);
}

async function hashConSalt(valor, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(valor), "PBKDF2", false, ["deriveBits"]);
  const derivado = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexABytes(saltHex), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bytesAHex(derivado);
}

async function firmarSesion(payload, secreto) {
  const data = JSON.stringify(payload);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = bytesAHex(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return `${btoa(data)}.${firma}`;
}

async function verificarSesion(token, secreto) {
  if (!token) return null;
  const [dataB64, firma] = token.split(".");
  if (!dataB64 || !firma) return null;

  let data;
  try {
    data = atob(dataB64);
  } catch {
    return null;
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firmaEsperada = bytesAHex(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  if (firmaEsperada !== firma) return null;

  const payload = JSON.parse(data);
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

function leerCookie(request, nombre) {
  const header = request.headers.get("Cookie") || "";
  for (const parte of header.split(";")) {
    const idx = parte.indexOf("=");
    if (idx === -1) continue;
    if (parte.slice(0, idx).trim() === nombre) {
      return decodeURIComponent(parte.slice(idx + 1).trim());
    }
  }
  return null;
}

function cookieSesion(token) {
  return `sesion=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESION_DURACION_MS / 1000}`;
}

const COOKIE_LOGOUT = "sesion=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";

// Cloudflare tiene dos formas de inyectar secrets: como variable de entorno
// plana (env.X es un string) o como binding de "Secrets Store" (env.X es un
// objeto con .get() async). Soportamos ambas para no depender de cuál esté
// disponible en el dashboard.
async function leerSecretoBinding(binding) {
  if (!binding) return null;
  if (typeof binding === "string") return binding;
  if (typeof binding.get === "function") return await binding.get();
  return null;
}

async function obtenerConfig(env) {
  const [mongoUri, mongoDatabase, sessionSecret] = await Promise.all([
    leerSecretoBinding(env.MONGO_URI),
    leerSecretoBinding(env.MONGO_DATABASE),
    leerSecretoBinding(env.SESSION_SECRET)
  ]);
  return { mongoUri, mongoDatabase, sessionSecret };
}

async function obtenerSesion(request, env) {
  const { sessionSecret } = await obtenerConfig(env);
  if (!sessionSecret) return null;
  const token = leerCookie(request, "sesion");
  return verificarSesion(token, sessionSecret);
}

// --- Mongo ---
// Se conecta y se cierra dentro de cada request: mantener un MongoClient
// cacheado entre requests deja temporizadores de monitoreo en segundo plano
// huérfanos cuando termina la request, y el runtime de Workers cancela la
// siguiente request al detectarlos como "código que nunca responde".
async function withCollection(env, nombreColeccion, fn) {
  const { mongoUri, mongoDatabase } = await obtenerConfig(env);
  if (!mongoUri || !mongoDatabase) {
    throw new Error("Faltan variables de entorno MONGO_URI o MONGO_DATABASE.");
  }

  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const collection = client.db(mongoDatabase).collection(nombreColeccion);
    return await fn(collection);
  } finally {
    await client.close();
  }
}

const withUsuarios = (env, fn) => withCollection(env, "usuarios", fn);
const withTarjetas = (env, fn) => withCollection(env, "tarjetas", fn);
const withCategorias = (env, fn) => withCollection(env, "categorias", fn);

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
    await withUsuarios(env, async (collection) => {
      const existente = await collection.findOne({ telefono });
      if (existente) {
        throw new Error("Ya existe una cuenta con ese número de teléfono.");
      }
      const salt = generarSalt();
      const dpiHash = await hashConSalt(dpi, salt);
      await collection.insertOne({
        telefono,
        nombre,
        dpiHash,
        dpiSalt: salt,
        rol: "usuario",
        openaiApiKey: "",
        creadoEn: new Date()
      });
    });

    const token = await firmarSesion({ telefono, rol: "usuario", exp: Date.now() + SESION_DURACION_MS }, sessionSecret);
    return jsonResponse(
      { telefono, nombre, rol: "usuario", tieneApiKey: false },
      201,
      { "Set-Cookie": cookieSesion(token) }
    );
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

    const token = await firmarSesion({ telefono, rol: usuario.rol, exp: Date.now() + SESION_DURACION_MS }, sessionSecret);
    return jsonResponse(
      { telefono, nombre: usuario.nombre, rol: usuario.rol, tieneApiKey: Boolean(usuario.openaiApiKey) },
      200,
      { "Set-Cookie": cookieSesion(token) }
    );
  } catch (error) {
    return jsonResponse({ error: "Error al iniciar sesión.", message: error.message }, 500);
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

    return jsonResponse({
      telefono: usuario.telefono,
      nombre: usuario.nombre,
      rol: usuario.rol,
      tieneApiKey: Boolean(usuario.openaiApiKey)
    });
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

// Edición del propio perfil: nombre, teléfono (usuario de login) y/o DPI
// (contraseña). Siempre exige el DPI actual para confirmar el cambio. Si el
// teléfono cambia, también migra el propietario de sus tarjetas guardadas.
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

  try {
    const resultado = await withUsuarios(env, async (collection) => {
      const usuario = await collection.findOne({ telefono: sesion.telefono });
      if (!usuario) return { tipo: "no-encontrado" };

      const hashActual = await hashConSalt(dpiActual, usuario.dpiSalt);
      if (hashActual !== usuario.dpiHash) return { tipo: "dpi-incorrecto" };

      const cambios = {};
      if (nombreNuevo) cambios.nombre = nombreNuevo;

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

    const usuarioActualizado = resultado.usuario;
    const token = await firmarSesion(
      { telefono: usuarioActualizado.telefono, rol: usuarioActualizado.rol, exp: Date.now() + SESION_DURACION_MS },
      sessionSecret
    );
    return jsonResponse(
      {
        telefono: usuarioActualizado.telefono,
        nombre: usuarioActualizado.nombre,
        rol: usuarioActualizado.rol,
        tieneApiKey: Boolean(usuarioActualizado.openaiApiKey)
      },
      200,
      { "Set-Cookie": cookieSesion(token) }
    );
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar tu cuenta.", message: error.message }, 500);
  }
}

// --- Tarjetas (privadas por usuario) ---

async function handleListTarjetas(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  try {
    const tarjetas = await withTarjetas(env, (collection) =>
      collection.find({ propietarioTelefono: sesion.telefono }).sort({ creadoEn: -1 }).toArray()
    );
    return jsonResponse(tarjetas);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar las tarjetas.", message: error.message }, 500);
  }
}

function camposTarjeta(body) {
  return {
    nombre: texto(body.nombre),
    empresa: texto(body.empresa),
    cargo: texto(body.cargo),
    telefono: texto(body.telefono),
    email: texto(body.email),
    sitioWeb: texto(body.sitioWeb),
    notas: texto(body.notas),
    facebook: texto(body.facebook),
    instagram: texto(body.instagram),
    linkedin: texto(body.linkedin),
    tiktok: texto(body.tiktok),
    twitter: texto(body.twitter),
    categoria: texto(body.categoria),
    esMiTarjeta: Boolean(body.esMiTarjeta)
  };
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

  let imagenFrente;
  let imagenReverso;
  try {
    imagenFrente = leerImagen(body.imagenFrente, "imagen del frente");
    imagenReverso = leerImagen(body.imagenReverso, "imagen del reverso");
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  const ahora = new Date();
  const tarjeta = {
    propietarioTelefono: sesion.telefono,
    ...campos,
    imagenFrente,
    imagenReverso,
    creadoEn: ahora,
    actualizadoEn: ahora
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

  const cambios = { ...campos, actualizadoEn: new Date() };
  try {
    // Si no se manda una imagen nueva, se conserva la que ya estaba guardada.
    if (body.imagenFrente) cambios.imagenFrente = leerImagen(body.imagenFrente, "imagen del frente");
    if (body.imagenReverso) cambios.imagenReverso = leerImagen(body.imagenReverso, "imagen del reverso");
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  try {
    const resultado = await withTarjetas(env, async (collection) => {
      const existente = await collection.findOne({ _id: objectId });
      if (!existente) return { tipo: "no-encontrada" };
      if (existente.propietarioTelefono !== sesion.telefono) return { tipo: "prohibido" };

      if (cambios.esMiTarjeta) {
        await collection.updateMany(
          { propietarioTelefono: sesion.telefono, _id: { $ne: objectId } },
          { $set: { esMiTarjeta: false } }
        );
      }

      await collection.updateOne({ _id: objectId }, { $set: cambios });
      return { tipo: "ok", tarjeta: { ...existente, ...cambios } };
    });

    if (resultado.tipo === "no-encontrada") return jsonResponse({ error: "Tarjeta no encontrada." }, 404);
    if (resultado.tipo === "prohibido") return jsonResponse({ error: "No puedes editar una tarjeta que no es tuya." }, 403);
    return jsonResponse(resultado.tarjeta);
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
      collection.find({}, { projection: { propietarioTelefono: 0 } }).sort({ creadoEn: -1 }).toArray()
    );
    return jsonResponse(tarjetas);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar el directorio.", message: error.message }, 500);
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

// --- OCR vía OpenAI (usa la API key guardada por el propio usuario) ---

async function handleOcr(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "El cuerpo de la solicitud debe ser JSON válido." }, 400);
  }

  const imagen = body.imagen;
  if (!imagen || typeof imagen !== "string" || !imagen.startsWith("data:image/")) {
    return jsonResponse({ error: "Debes enviar una imagen válida para escanear." }, 400);
  }

  let usuario;
  try {
    usuario = await withUsuarios(env, (collection) => collection.findOne({ telefono: sesion.telefono }));
  } catch (error) {
    return jsonResponse({ error: "Error al consultar tu cuenta.", message: error.message }, 500);
  }

  if (!usuario || !usuario.openaiApiKey) {
    return jsonResponse({ error: "Configura tu API key de OpenAI en Configuración antes de usar el OCR." }, 400);
  }

  try {
    const respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${usuario.openaiApiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        max_tokens: 600,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extrae los datos de esta tarjeta de presentación. Responde SOLO con un objeto JSON con exactamente estas claves: nombre, empresa, cargo, telefono, email, sitioWeb. Si un dato no aparece en la imagen, usa una cadena vacía. No incluyas explicaciones ni markdown."
              },
              { type: "image_url", image_url: { url: imagen } }
            ]
          }
        ]
      })
    });

    const data = await respuesta.json();

    if (!respuesta.ok) {
      const mensaje = data?.error?.message || `Error ${respuesta.status} desde OpenAI.`;
      return jsonResponse({ error: mensaje }, 502);
    }

    let extraido;
    try {
      extraido = JSON.parse(data.choices[0].message.content);
    } catch {
      return jsonResponse({ error: "OpenAI respondió en un formato inesperado." }, 502);
    }

    return jsonResponse({
      nombre: extraido.nombre || "",
      empresa: extraido.empresa || "",
      cargo: extraido.cargo || "",
      telefono: extraido.telefono || "",
      email: extraido.email || "",
      sitioWeb: extraido.sitioWeb || ""
    });
  } catch (error) {
    return jsonResponse({ error: "Error al comunicarse con OpenAI.", message: error.message }, 500);
  }
}

// --- Categorías (gestionadas por el administrador) ---

async function handleListCategorias(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  try {
    const categorias = await withCategorias(env, async (collection) => {
      const total = await collection.countDocuments();
      if (total === 0) {
        await collection.insertMany(CATEGORIAS_DEFECTO.map((nombre) => ({ nombre, creadoEn: new Date() })));
      }
      return collection.find({}).sort({ nombre: 1 }).toArray();
    });
    return jsonResponse(categorias);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar categorías.", message: error.message }, 500);
  }
}

async function handleCrearCategoria(request, env) {
  const { error } = await requerirAdmin(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "El cuerpo de la solicitud debe ser JSON válido." }, 400);
  }

  const nombre = texto(body.nombre);
  if (!nombre) return jsonResponse({ error: "El nombre de la categoría es obligatorio." }, 400);

  try {
    const insertedId = await withCategorias(env, async (collection) => {
      const existente = await collection.findOne({ nombre });
      if (existente) throw new Error("Ya existe una categoría con ese nombre.");
      const result = await collection.insertOne({ nombre, creadoEn: new Date() });
      return result.insertedId;
    });
    return jsonResponse({ _id: insertedId, nombre }, 201);
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }
}

async function handleEliminarCategoria(request, env, id) {
  const { error } = await requerirAdmin(request, env);
  if (error) return error;

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID inválido." }, 400);

  try {
    const resultado = await withCategorias(env, (collection) => collection.deleteOne({ _id: objectId }));
    if (resultado.deletedCount === 0) return jsonResponse({ error: "Categoría no encontrada." }, 404);
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: "Error al eliminar la categoría.", message: error.message }, 500);
  }
}

// --- Administración ---

async function requerirAdmin(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return { error: jsonResponse({ error: "No autenticado." }, 401) };
  if (sesion.rol !== "admin") return { error: jsonResponse({ error: "No tienes permisos de administrador." }, 403) };
  return { sesion };
}

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
    return jsonResponse(usuarios);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar usuarios.", message: error.message }, 500);
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
    if (pathname === "/api/usuario" && metodo === "PUT") return handleActualizarUsuario(request, env);
    if (pathname === "/api/usuario/openai-key" && metodo === "PUT") return handleGuardarApiKey(request, env);

    if (pathname === "/api/tarjetas" && metodo === "GET") return handleListTarjetas(request, env);
    if (pathname === "/api/tarjetas" && metodo === "POST") return handleCreateTarjeta(request, env);

    const matchTarjetaId = pathname.match(/^\/api\/tarjetas\/([^/]+)$/);
    if (matchTarjetaId && metodo === "PUT") return handleUpdateTarjeta(request, env, decodeURIComponent(matchTarjetaId[1]));

    if (pathname === "/api/directorio" && metodo === "GET") return handleDirectorio(request, env);

    const matchTarjetaPublica = pathname.match(/^\/api\/tarjeta-publica\/([^/]+)$/);
    if (matchTarjetaPublica && metodo === "GET") return handleTarjetaPublica(env, decodeURIComponent(matchTarjetaPublica[1]));

    if (pathname === "/api/ocr" && metodo === "POST") return handleOcr(request, env);

    if (pathname === "/api/categorias" && metodo === "GET") return handleListCategorias(request, env);
    if (pathname === "/api/admin/categorias" && metodo === "POST") return handleCrearCategoria(request, env);

    const matchCategoriaId = pathname.match(/^\/api\/admin\/categorias\/([^/]+)$/);
    if (matchCategoriaId && metodo === "DELETE") return handleEliminarCategoria(request, env, decodeURIComponent(matchCategoriaId[1]));

    if (pathname === "/api/admin/usuarios" && metodo === "GET") return handleListUsuarios(request, env);

    const matchRol = pathname.match(/^\/api\/admin\/usuarios\/([^/]+)\/rol$/);
    if (matchRol && metodo === "PATCH") return handleCambiarRol(request, env, decodeURIComponent(matchRol[1]));

    const matchAdminUsuario = pathname.match(/^\/api\/admin\/usuarios\/([^/]+)$/);
    if (matchAdminUsuario && metodo === "PUT") return handleAdminEditarUsuario(request, env, decodeURIComponent(matchAdminUsuario[1]));

    return env.ASSETS.fetch(request);
  }
};
