// --- OCR vía OpenAI (usa la API key guardada por el propio usuario) ---

import { jsonResponse } from "./src/utils/response.js";
import { errorResponse } from "./src/utils/errorResponse.js";
import { parseJson } from "./src/utils/parseJson.js";
import { obtenerSesion } from "./lib/sesion.js";
import { withUsuarios } from "./lib/db.js";

export async function handleOcr(request, env) {
  const sesion = await obtenerSesion(request, env);
  if (!sesion) return jsonResponse({ error: "No autenticado." }, 401);

  const { body, error: errorJson } = await parseJson(request);
  if (errorJson) return errorResponse(errorJson, 400);

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
    return jsonResponse({ error: "Configura tu API key de OpenAI en Perfil antes de usar el OCR." }, 400);
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

    // Solo se cuenta cuando el escaneo realmente se completó (no en errores
    // de OpenAI ni de formato), para que el total del dashboard sea fiel.
    await withUsuarios(env, (collection) => collection.updateOne({ telefono: sesion.telefono }, { $inc: { ocrUsos: 1 } }));

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
