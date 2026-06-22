const MAX_IMAGEN_BASE64 = 2_000_000; // ~1.5 MB de imagen real, ya comprimida en el navegador

export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

export function texto(valor) {
  return (valor || "").trim();
}

export function soloDigitos(valor) {
  return (valor || "").replace(/\D/g, "");
}

// "empresa.com" no es una URL válida para usar en un href (el navegador la
// resuelve como ruta relativa al propio sitio en vez de abrir el sitio
// externo). Si no trae protocolo, se le agrega https:// antes de guardarla.
export function normalizarUrl(valor) {
  const v = texto(valor).replace(/\s+/g, "");
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

export function leerImagen(valor, nombreCampo) {
  if (!valor) return "";
  if (typeof valor !== "string" || !valor.startsWith("data:image/")) {
    throw new Error(`El campo '${nombreCampo}' debe ser una imagen válida.`);
  }
  if (valor.length > MAX_IMAGEN_BASE64) {
    throw new Error(`La imagen de '${nombreCampo}' es demasiado grande. Usa una más liviana.`);
  }
  return valor;
}
