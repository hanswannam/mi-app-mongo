import { MongoClient } from "mongodb";

// Se cachea la conexión a nivel de módulo para reutilizarla entre invocaciones
// del mismo isolate (evita reconectar en cada request).
let clientPromise = null;

function getClient(uri) {
  if (!clientPromise) {
    clientPromise = new MongoClient(uri).connect();
  }
  return clientPromise;
}

async function handleLeerUsuarios(env) {
  const mongoUri = env.MONGO_URI;
  const mongoDatabase = env.MONGO_DATABASE;

  if (!mongoUri || !mongoDatabase) {
    return new Response(
      JSON.stringify({ error: "Faltan variables de entorno MONGO_URI o MONGO_DATABASE." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const client = await getClient(mongoUri);
    const usuarios = await client.db(mongoDatabase).collection("usuarios").find({}).toArray();

    return new Response(JSON.stringify(usuarios), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    // Si la conexión cacheada falló, se descarta para reintentar en el próximo request.
    clientPromise = null;
    return new Response(
      JSON.stringify({ error: "Error al conectar o consultar MongoDB.", message: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/leer" && request.method === "GET") {
      return handleLeerUsuarios(env);
    }

    // Cualquier otra ruta: la sirve el binding de assets estáticos.
    return env.ASSETS.fetch(request);
  }
};
