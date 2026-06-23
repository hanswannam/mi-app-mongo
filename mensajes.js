// --- Mensajes (CRM BNI) ---
// El administrador envía un mensaje a todo el capítulo, a una esfera, o a
// un networker puntual. El mensaje se guarda UNA vez con la lista de
// destinatarios ya resuelta (no una copia por persona), y cada quien
// marca su propia lectura en leidoPor.

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { soloDigitos } from "./src/utils/normalizePhone.js";
import { obtenerSesion, esSuperAdmin } from "./src/middleware/authMiddleware.js";
import { requerirModulo } from "./permisos.js";
import { parseObjectId, withCollection } from "./lib/db.js";

const withMensajes = (env, fn) => withCollection(env, "mensajes", fn);
const withUsuarios = (env, fn) => withCollection(env, "usuarios", fn);

const TIPOS_VALIDOS = ["todos", "esfera", "individual"];

function capituloDe(sesion, url) {
  return esSuperAdmin(sesion) ? url.searchParams.get("capituloId") : sesion.capituloId;
}

// Mis mensajes recibidos (cualquier rol con acceso al módulo).
export async function handleListMensajes(request, env) {
  const denegado = await requerirModulo(request, env, "mensajes", "ver");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  try {
    const mensajes = await withMensajes(env, (collection) =>
      collection.find({ destinatarios: sesion.telefono }).sort({ creadoEn: -1 }).toArray()
    );
    return jsonResponse(mensajes.map((m) => ({ ...m, leido: (m.leidoPor || []).includes(sesion.telefono) })));
  } catch (error) {
    return jsonResponse({ error: "Error al consultar mensajes.", message: error.message }, 500);
  }
}

// Historial de mensajes enviados por mí (para que el admin vea qué mandó).
export async function handleListMensajesEnviados(request, env) {
  const denegado = await requerirModulo(request, env, "mensajes", "ver");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = capituloDe(sesion, url);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  try {
    const mensajes = await withMensajes(env, (collection) =>
      collection.find({ capituloId, deTelefono: sesion.telefono }).sort({ creadoEn: -1 }).toArray()
    );
    return jsonResponse(mensajes);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar mensajes enviados.", message: error.message }, 500);
  }
}

export async function handleCrearMensaje(request, env) {
  const denegado = await requerirModulo(request, env, "mensajes", "crear");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);
  if (!sesion.capituloId && !esSuperAdmin(sesion)) {
    return jsonResponse({ error: "Tu cuenta no está asignada a un capítulo." }, 403);
  }

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const capituloId = esSuperAdmin(sesion) ? texto(body.capituloId) || sesion.capituloId : sesion.capituloId;
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  const destinoTipo = texto(body.destinoTipo);
  if (!TIPOS_VALIDOS.includes(destinoTipo)) return jsonResponse({ error: "Tipo de destino inválido." }, 400);

  const asunto = texto(body.asunto);
  const cuerpo = texto(body.cuerpo);
  if (!asunto) return jsonResponse({ error: "El asunto es obligatorio." }, 400);
  if (!cuerpo) return jsonResponse({ error: "El mensaje no puede estar vacío." }, 400);

  const esferaId = destinoTipo === "esfera" ? texto(body.esferaId) : null;
  if (destinoTipo === "esfera" && !esferaId) return jsonResponse({ error: "Indica la esfera." }, 400);

  const destinatarioTelefono = destinoTipo === "individual" ? soloDigitos(body.destinatarioTelefono) : null;
  if (destinoTipo === "individual" && !destinatarioTelefono) return jsonResponse({ error: "Indica el networker." }, 400);

  try {
    const filtroDestinatarios = { capituloId, rol: "networker" };
    if (destinoTipo === "esfera") filtroDestinatarios.esferaId = esferaId;
    if (destinoTipo === "individual") filtroDestinatarios.telefono = destinatarioTelefono;

    const destinatarios = await withUsuarios(env, (collection) =>
      collection.find(filtroDestinatarios, { projection: { telefono: 1 } }).toArray()
    ).then((lista) => lista.map((u) => u.telefono));

    if (destinatarios.length === 0) return jsonResponse({ error: "No hay ningún destinatario que coincida." }, 400);

    const ahora = new Date();
    const mensaje = {
      capituloId,
      deTelefono: sesion.telefono,
      destinoTipo,
      esferaId,
      destinatarioTelefono,
      destinatarios,
      asunto,
      cuerpo,
      leidoPor: [],
      creadoEn: ahora
    };
    const insertedId = await withMensajes(env, (collection) => collection.insertOne(mensaje).then((r) => r.insertedId));
    return jsonResponse({ ...mensaje, _id: insertedId, totalDestinatarios: destinatarios.length }, 201);
  } catch (error) {
    return jsonResponse({ error: "Error al enviar el mensaje.", message: error.message }, 500);
  }
}

export async function handleMarcarMensajeLeido(request, env, id) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID inválido." }, 400);

  try {
    const mensaje = await withMensajes(env, (collection) => collection.findOne({ _id: objectId }));
    if (!mensaje) return jsonResponse({ error: "Mensaje no encontrado." }, 404);
    if (!mensaje.destinatarios.includes(sesion.telefono)) {
      return jsonResponse({ error: "Este mensaje no es para ti." }, 403);
    }

    await withMensajes(env, (collection) =>
      collection.updateOne({ _id: objectId }, { $addToSet: { leidoPor: sesion.telefono } })
    );
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: "Error al marcar como leído.", message: error.message }, 500);
  }
}
