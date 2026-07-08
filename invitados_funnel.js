// --- Invitados Funnel ---
// Prospectos que se auto-registran desde la landing page /unete. A diferencia
// de "visitantes" (que el networker registra manualmente), aquí el prospecto
// llega solo por un enlace único por networket y llena su propio formulario.

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { texto } from "./src/utils/strings.js";
import { soloDigitos } from "./src/utils/normalizePhone.js";
import { obtenerSesion, esSuperAdmin } from "./src/middleware/authMiddleware.js";
import { parseObjectId, withCollection } from "./lib/db.js";
import { requerirModulo } from "./permisos.js";

const withInvitadosFunnel = (env, fn) => withCollection(env, "invitados_funnel", fn);
const withCapitulos = (env, fn) => withCollection(env, "capitulos", fn);

const ESTADOS_VALIDOS = ["nuevo", "contactado", "interesado", "aplicado", "descartado"];

function capituloDe(sesion, url) {
  return esSuperAdmin(sesion) ? url.searchParams.get("capituloId") : sesion.capituloId;
}

// Registro público (sin sesión) desde el landing funnel /unete.
export async function handleRegistrarInvitadoFunnel(request, env) {
  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const capituloId = texto(body.capituloId);
  if (!capituloId || !parseObjectId(capituloId)) {
    return jsonResponse({ error: "Enlace inválido: falta el capítulo." }, 400);
  }

  const nombre = texto(body.nombre);
  const profesion = texto(body.profesion);
  const telefono = soloDigitos(body.telefono);
  const correo = texto(body.correo).toLowerCase();

  if (!nombre) return jsonResponse({ error: "El nombre es obligatorio." }, 400);
  if (!telefono) return jsonResponse({ error: "El teléfono es obligatorio." }, 400);
  if (!correo) return jsonResponse({ error: "El correo es obligatorio." }, 400);

  try {
    const capitulo = await withCapitulos(env, (col) =>
      col.findOne({ _id: parseObjectId(capituloId) }, { projection: { _id: 1 } })
    );
    if (!capitulo) return jsonResponse({ error: "Capítulo no encontrado." }, 404);

    const ahora = new Date();
    const invitado = {
      nombre,
      profesion,
      telefono,
      correo,
      capituloId,
      fechaNetworket: body.fechaNetworket ? new Date(body.fechaNetworket) : null,
      invitadoPorNombre: texto(body.invitadoPorNombre),
      invitadoPorTelefono: soloDigitos(body.invitadoPorTelefono || ""),
      origen: "funnel",
      estado: "nuevo",
      notas: "",
      creadoEn: ahora,
      actualizadoEn: ahora
    };

    const insertedId = await withInvitadosFunnel(env, (col) =>
      col.insertOne(invitado).then((r) => r.insertedId)
    );
    return jsonResponse({ ok: true, _id: insertedId }, 201);
  } catch (error) {
    return jsonResponse({ error: "Error al registrar el invitado.", message: error.message }, 500);
  }
}

// Lista invitados del funnel para el CRM (requiere sesión y permiso).
export async function handleListInvitadosFunnel(request, env) {
  const denegado = await requerirModulo(request, env, "invitados", "ver");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const url = new URL(request.url);
  const capituloId = capituloDe(sesion, url);
  if (!capituloId) return jsonResponse({ error: "Falta indicar el capítulo." }, 400);

  const filtro = { capituloId };
  // Networkers solo ven los invitados de sus propios enlaces.
  if (sesion.rol === "networker") {
    filtro.invitadoPorTelefono = sesion.telefono;
  } else {
    const filtroPorTel = url.searchParams.get("invitadoPorTelefono");
    if (filtroPorTel) filtro.invitadoPorTelefono = soloDigitos(filtroPorTel);
  }

  const filtroPorFecha = url.searchParams.get("fechaNetworket");
  if (filtroPorFecha) {
    const desde = new Date(filtroPorFecha);
    const hasta = new Date(desde);
    hasta.setDate(hasta.getDate() + 1);
    filtro.fechaNetworket = { $gte: desde, $lt: hasta };
  }

  try {
    const invitados = await withInvitadosFunnel(env, (col) =>
      col.find(filtro).sort({ creadoEn: -1 }).toArray()
    );
    return jsonResponse(invitados);
  } catch (error) {
    return jsonResponse({ error: "Error al consultar invitados.", message: error.message }, 500);
  }
}

// Actualiza estado y notas de seguimiento de un invitado (CRM).
export async function handleActualizarInvitadoFunnel(request, env, id) {
  const denegado = await requerirModulo(request, env, "invitados", "editar");
  if (denegado) return denegado;
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const objectId = parseObjectId(id);
  if (!objectId) return jsonResponse({ error: "ID inválido." }, 400);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

  const estado = texto(body.estado).toLowerCase();

  try {
    const invitado = await withInvitadosFunnel(env, (col) => col.findOne({ _id: objectId }));
    if (!invitado) return jsonResponse({ error: "Invitado no encontrado." }, 404);
    if (!esSuperAdmin(sesion) && sesion.capituloId !== invitado.capituloId) {
      return jsonResponse({ error: "No tienes acceso a este invitado." }, 403);
    }

    const cambios = {
      notas: texto(body.notas),
      estado: ESTADOS_VALIDOS.includes(estado) ? estado : invitado.estado,
      actualizadoEn: new Date()
    };
    await withInvitadosFunnel(env, (col) => col.updateOne({ _id: objectId }, { $set: cambios }));
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: "Error al actualizar.", message: error.message }, 500);
  }
}
