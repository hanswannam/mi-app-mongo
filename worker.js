import { MongoClient } from "mongodb";

const MAX_IMAGEN_BASE64 = 2_000_000; // ~1.5 MB de imagen real, ya comprimida en el navegador

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function texto(valor) {
  return (valor || "").trim();
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

// Se conecta y se cierra dentro de cada request: mantener un MongoClient
// cacheado entre requests deja temporizadores de monitoreo en segundo plano
// huérfanos cuando termina la request, y el runtime de Workers cancela la
// siguiente request al detectarlos como "código que nunca responde".
async function withTarjetasCollection(env, fn) {
  if (!env.MONGO_URI || !env.MONGO_DATABASE) {
    throw new Error("Faltan variables de entorno MONGO_URI o MONGO_DATABASE.");
  }

  const client = new MongoClient(env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const collection = client.db(env.MONGO_DATABASE).collection("tarjetas");
    return await fn(collection);
  } finally {
    await client.close();
  }
}

async function handleListTarjetas(env) {
  try {
    const tarjetas = await withTarjetasCollection(env, (collection) =>
      collection.find({}).sort({ creadoEn: -1 }).toArray()
    );
    return jsonResponse(tarjetas);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar las tarjetas.", message: error.message }, 500);
  }
}

async function handleCreateTarjeta(request, env) {
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
    const insertedId = await withTarjetasCollection(env, async (collection) => {
      const result = await collection.insertOne(tarjeta);
      return result.insertedId;
    });
    return jsonResponse({ ...tarjeta, _id: insertedId }, 201);
  } catch (error) {
    return jsonResponse({ error: "Error al guardar la tarjeta.", message: error.message }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/tarjetas" && request.method === "GET") {
      return handleListTarjetas(env);
    }
    if (url.pathname === "/api/tarjetas" && request.method === "POST") {
      return handleCreateTarjeta(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};
