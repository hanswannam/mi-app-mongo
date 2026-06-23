import { texto } from "./strings.js";

// "empresa.com" no es una URL válida para usar en un href (el navegador la
// resuelve como ruta relativa al propio sitio en vez de abrir el sitio
// externo). Si no trae protocolo, se le agrega https:// antes de guardarla.
export function normalizarUrl(valor) {
  const v = texto(valor).replace(/\s+/g, "");
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}
