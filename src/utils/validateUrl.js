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

const BASE_RED_SOCIAL = {
  facebook: "https://facebook.com/",
  instagram: "https://instagram.com/",
  linkedin: "https://linkedin.com/in/",
  tiktok: "https://tiktok.com/@"
};

// Igual que normalizarUrl, pero para handles de redes sociales: si la
// persona escribe solo "@usuario" o "usuario" (no un link completo), lo
// arma con el dominio correcto en vez de producir "https://@usuario" (un
// link roto -- el navegador lo interpreta como userinfo de una URL sin
// host).
export function normalizarRedSocial(red, valor) {
  const v = texto(valor).replace(/\s+/g, "");
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return BASE_RED_SOCIAL[red] + v.replace(/^@/, "");
}
