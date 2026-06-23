// Construccion de enlaces de accion para un contacto (whatsapp, sitio web,
// redes sociales). Defensa adicional para tarjetas guardadas antes de
// normalizar la URL al guardar en el servidor (ej. "empresa.com" sin
// protocolo, que el navegador resolveria como ruta relativa al propio sitio
// en vez de abrir la web real).
export function normalizarUrl(valor) {
  const v = (valor || "").trim().replace(/\s+/g, "");
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

export function whatsappUrl(telefono, mensaje) {
  const digitos = (telefono || "").replace(/\D/g, "");
  if (!digitos) return null;
  const conCodigo = digitos.length <= 8 ? `502${digitos}` : digitos;
  return `https://wa.me/${conCodigo}` + (mensaje ? `?text=${encodeURIComponent(mensaje)}` : "");
}

export function urlRedSocial(red, valor) {
  if (!valor) return null;
  const v = valor.trim();
  if (/^https?:\/\//i.test(v)) return v;
  return red.base + v.replace(/^@/, "");
}
