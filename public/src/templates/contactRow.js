import { escapeHtml, iniciales } from "../utils/strings.js";
import { whatsappUrl } from "../utils/contactLinks.js";

export const REDES = [
  { campo: "facebook", etiqueta: "Facebook", glyph: "📘", base: "https://facebook.com/" },
  { campo: "instagram", etiqueta: "Instagram", glyph: "📸", base: "https://instagram.com/" },
  { campo: "linkedin", etiqueta: "LinkedIn", glyph: "💼", base: "https://linkedin.com/in/" },
  { campo: "tiktok", etiqueta: "TikTok", glyph: "🎵", base: "https://tiktok.com/@" },
  { campo: "twitter", etiqueta: "X", glyph: "✖️", base: "https://x.com/" }
];

export function accionesRapidas(c) {
  const botones = [];
  const wa = whatsappUrl(c.telefono);
  if (wa) botones.push(`<a href="${wa}" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="icon-btn" title="WhatsApp">💬</a>`);
  if (c.telefono) botones.push(`<a href="tel:${escapeHtml(c.telefono)}" onclick="event.stopPropagation()" class="icon-btn" title="Llamar">📞</a>`);
  if (c.email) botones.push(`<a href="mailto:${escapeHtml(c.email)}" onclick="event.stopPropagation()" class="icon-btn" title="Correo">✉️</a>`);
  return botones.join("");
}

export function filaContacto(c, esDirectorio) {
  const meta = [c.cargo, c.empresa].filter(Boolean).join(" · ");
  const fuenteAvatar = c.avatarMini || c.fotoPerfil || c.imagenFrente;
  const avatar = fuenteAvatar ? `<img src="${fuenteAvatar}" alt="">` : iniciales(c.nombre);
  return `
    <div class="contact-row" data-id="${c._id}" data-directorio="${esDirectorio ? "1" : "0"}">
      <div class="avatar">${avatar}</div>
      <div class="contact-info">
        <div class="nombre">${escapeHtml(c.nombre)} ${c.favorito ? '<span class="star">★</span>' : ""}</div>
        <div class="meta">${escapeHtml(meta || "Sin empresa")}</div>
      </div>
      <div class="quick-actions">${accionesRapidas(c)}</div>
    </div>
  `;
}
