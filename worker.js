import { MongoClient } from "mongodb";

const MAX_IMAGEN_BASE64 = 2_000_000; // ~1.5 MB de imagen real, ya comprimida en el navegador
const SESION_DURACION_MS = 1000 * 60 * 60 * 24 * 30; // 30 días

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

async function handleCreateTarjeta(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "El cuerpo de la solicitud debe ser JSON válido." }, 400);
  }

  const nombre = texto(body.nombre);
  if (!nombre) {
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

  const tarjeta = {
    propietarioTelefono: sesion.telefono,
    nombre,
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
    imagenFrente,
    imagenReverso,
    creadoEn: new Date()
  };

  try {
    const insertedId = await withTarjetas(env, async (collection) => {
      const result = await collection.insertOne(tarjeta);
      return result.insertedId;
    });
    return jsonResponse({ ...tarjeta, _id: insertedId }, 201);
  } catch (error) {
    return jsonResponse({ error: "Error al guardar la tarjeta.", message: error.message }, 500);
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const metodo = request.method;

    if (pathname === "/api/auth/registro" && metodo === "POST") return handleRegistro(request, env);
    if (pathname === "/api/auth/login" && metodo === "POST") return handleLogin(request, env);
    if (pathname === "/api/auth/logout" && metodo === "POST") return handleLogout();
    if (pathname === "/api/auth/yo" && metodo === "GET") return handleYo(request, env);
    if (pathname === "/api/usuario/openai-key" && metodo === "PUT") return handleGuardarApiKey(request, env);
    if (pathname === "/api/tarjetas" && metodo === "GET") return handleListTarjetas(request, env);
    if (pathname === "/api/tarjetas" && metodo === "POST") return handleCreateTarjeta(request, env);
    if (pathname === "/api/ocr" && metodo === "POST") return handleOcr(request, env);
    if (pathname === "/api/admin/usuarios" && metodo === "GET") return handleListUsuarios(request, env);

    const matchRol = pathname.match(/^\/api\/admin\/usuarios\/([^/]+)\/rol$/);
    if (matchRol && metodo === "PATCH") return handleCambiarRol(request, env, decodeURIComponent(matchRol[1]));

    return env.ASSETS.fetch(request);
  }
};
