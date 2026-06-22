import { MongoClient, ObjectId } from "mongodb";
import { obtenerConfig } from "./sesion.js";

export function parseObjectId(id) {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
}

// --- Mongo ---
// Se conecta y se cierra dentro de cada request: mantener un MongoClient
// cacheado entre requests deja temporizadores de monitoreo en segundo plano
// huérfanos cuando termina la request, y el runtime de Workers cancela la
// siguiente request al detectarlos como "código que nunca responde".
export async function withCollection(env, nombreColeccion, fn) {
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

export const withUsuarios = (env, fn) => withCollection(env, "usuarios", fn);
export const withTarjetas = (env, fn) => withCollection(env, "tarjetas", fn);
export const withCategorias = (env, fn) => withCollection(env, "categorias", fn);
export const withEventos = (env, fn) => withCollection(env, "eventos", fn);
export const withInvitaciones = (env, fn) => withCollection(env, "invitaciones", fn);
