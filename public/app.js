// Captura de errores visible en pantalla (temporal, para diagnosticar sin
// necesitar conectar el teléfono a una computadora). Si algo falla antes de
// que la app termine de cargar, se muestra el error aquí mismo en vez de
// quedar la pantalla pegada en "Cargando...".
function mostrarErrorVisible(origen, detalle) {
  const caja = document.createElement("div");
  caja.style.cssText = "position:fixed; bottom:0; left:0; right:0; max-height:40vh; overflow:auto; background:#1a0a0a; color:#ffb4b4; font-size:11px; font-family:monospace; padding:10px; z-index:99999; white-space:pre-wrap; border-top:3px solid #ff4444;";
  caja.textContent = `[${origen}] ${detalle}`;
  document.body.appendChild(caja);
}
window.addEventListener("error", (e) => {
  mostrarErrorVisible("error", `${e.message} — ${e.filename}:${e.lineno}:${e.colno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  mostrarErrorVisible("promesa", String(e.reason && e.reason.stack ? e.reason.stack : e.reason));
});

let usuarioActual = null;
let contactos = [];
let directorio = [];
let categorias = [];
let vistaContactos = "mis"; // "mis" | "directorio"
let filtroActivo = { inicio: "todos", contactos: "todos" };
let capturas = { frente: "", reverso: "" };
let avatarMiniBase64 = "";
let ladoActivo = "frente";
let editandoId = null;
let detalleActualId = null;
let detalleActualData = null;
let detalleEsDirectorio = false;
let detalleFlipped = false;

const REDES = [
  { campo: "facebook", etiqueta: "Facebook", glyph: "📘", base: "https://facebook.com/" },
  { campo: "instagram", etiqueta: "Instagram", glyph: "📸", base: "https://instagram.com/" },
  { campo: "linkedin", etiqueta: "LinkedIn", glyph: "💼", base: "https://linkedin.com/in/" },
  { campo: "tiktok", etiqueta: "TikTok", glyph: "🎵", base: "https://tiktok.com/@" },
  { campo: "twitter", etiqueta: "X", glyph: "✖️", base: "https://x.com/" }
];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function iniciales(nombre) {
  return (nombre || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("");
}

// ---------- Tema oscuro ----------
function aplicarTema(oscuro) {
  document.documentElement.setAttribute("data-theme", oscuro ? "oscuro" : "claro");
  localStorage.setItem("tema", oscuro ? "oscuro" : "claro");
  const toggle = document.getElementById("toggle-tema");
  if (toggle) toggle.checked = oscuro;
  const btn = document.getElementById("btn-tema-inicio");
  if (btn) btn.textContent = oscuro ? "☀️" : "🌙";
}

document.getElementById("btn-tema-inicio").addEventListener("click", () => {
  aplicarTema(localStorage.getItem("tema") !== "oscuro");
});
document.getElementById("toggle-tema").addEventListener("change", (e) => aplicarTema(e.target.checked));
aplicarTema(localStorage.getItem("tema") === "oscuro");

// ---------- Vistas raíz ----------
function mostrarAuth() {
  document.getElementById("vista-cargando").style.display = "none";
  document.getElementById("vista-auth").style.display = "block";
  document.getElementById("vista-app").style.display = "none";
}

function mostrarApp() {
  document.getElementById("vista-cargando").style.display = "none";
  document.getElementById("vista-auth").style.display = "none";
  document.getElementById("vista-app").style.display = "block";
  document.getElementById("saludo-nombre").textContent = (usuarioActual.nombre || "").split(" ")[0];
  document.getElementById("perfil-nombre-display").textContent = usuarioActual.nombre;
  document.getElementById("cuenta-nombre").value = usuarioActual.nombre;
  document.getElementById("cuenta-telefono").value = usuarioActual.telefono;
  document.getElementById("perfil-admin-link").style.display = usuarioActual.rol === "admin" ? "block" : "none";
  actualizarAvatarPerfil();
  actualizarEstadoApiKey();
  cargarCategorias();
  cargarContactos();
  mostrarPantalla("inicio");
}

function actualizarAvatarPerfil() {
  const el = document.getElementById("perfil-avatar");
  el.innerHTML = usuarioActual.fotoPerfil
    ? `<img src="${usuarioActual.fotoPerfil}" alt="">`
    : iniciales(usuarioActual.nombre);
  el.appendChild(document.getElementById("input-foto-perfil"));
}

function actualizarEstadoApiKey() {
  document.getElementById("estado-api-key").textContent = usuarioActual.tieneApiKey
    ? "API key configurada." : "Todavía no has configurado tu API key.";
}

async function iniciar() {
  try {
    const r = await fetchConLimite("/api/auth/yo", {}, 12000);
    if (r.ok) { usuarioActual = await r.json(); mostrarApp(); } else { mostrarAuth(); }
  } catch (error) {
    console.error("iniciar:", error);
    mostrarAuth();
  }
}

// ---------- Auth ----------
document.querySelectorAll(".auth-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("form-login").style.display = btn.dataset.tab === "login" ? "block" : "none";
    document.getElementById("form-registro").style.display = btn.dataset.tab === "registro" ? "block" : "none";
    document.getElementById("auth-message").innerHTML = "";
  });
});

document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target, msg = document.getElementById("auth-message");
  msg.innerHTML = "";
  try {
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ telefono: form.telefono.value, dpi: form.dpi.value }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "No se pudo iniciar sesión.");
    usuarioActual = data; mostrarApp();
  } catch (error) { msg.innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`; }
});

document.getElementById("form-registro").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target, msg = document.getElementById("auth-message");
  msg.innerHTML = "";
  try {
    const r = await fetch("/api/auth/registro", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre: form.nombre.value, telefono: form.telefono.value, dpi: form.dpi.value }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "No se pudo crear la cuenta.");
    usuarioActual = data; mostrarApp();
  } catch (error) { msg.innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`; }
});

function reiniciarEstadoApp() {
  // Si quedaba un filtro/búsqueda activo de la sesión anterior, al volver a
  // entrar parecía que "no había tarjetas" porque seguían filtradas.
  contactos = [];
  directorio = [];
  vistaContactos = "mis";
  filtroActivo = { inicio: "todos", contactos: "todos" };
  document.getElementById("buscador-inicio").value = "";
  document.getElementById("buscador-contactos").value = "";
  document.getElementById("filtro-categoria-directorio").value = "";
  document.querySelectorAll('.chip-row[data-grupo="inicio"] .chip').forEach((c) => c.classList.toggle("active", c.dataset.filtro === "todos"));
  document.querySelectorAll('.chip-row[data-grupo="contactos"] .chip').forEach((c) => c.classList.toggle("active", c.dataset.filtro === "todos"));
  document.querySelectorAll('[data-vista-contactos]').forEach((c) => c.classList.toggle("active", c.dataset.vistaContactos === "mis"));
}

document.getElementById("btn-logout").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  usuarioActual = null;
  reiniciarEstadoApp();
  mostrarAuth();
});

// ---------- Navegación inferior ----------
function mostrarPantalla(nombre) {
  document.querySelectorAll(".screen").forEach((s) => (s.style.display = "none"));
  document.getElementById(`screen-${nombre}`).style.display = "block";
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.pantalla === nombre));
  window.scrollTo(0, 0);
  if (nombre === "mitarjeta") renderMiTarjeta();
  if (nombre === "contactos") renderContactosLista();
}

document.querySelectorAll(".nav-btn, .nav-fab").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.pantalla === "escanear") { iniciarEscaneo(); return; }
    mostrarPantalla(btn.dataset.pantalla);
  });
});
document.querySelectorAll("[data-volver]").forEach((btn) => btn.addEventListener("click", () => mostrarPantalla(btn.dataset.volver)));
document.getElementById("btn-escanear-cta").addEventListener("click", iniciarEscaneo);

// ---------- Categorías ----------
async function cargarCategorias() {
  try {
    const r = await fetchConLimite("/api/categorias");
    if (!r.ok) return;
    categorias = await r.json();
    const opciones = categorias.map((c) => `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`).join("");
    document.getElementById("c-categoria").innerHTML = '<option value="">Sin categoría</option>' + opciones;
    document.getElementById("filtro-categoria-directorio").innerHTML = '<option value="">Todas las categorías</option>' + opciones;
  } catch {}
}

// ---------- Carga de contactos ----------
// Si la conexión está muy lenta o se cae a mitad de la petición, un fetch()
// normal puede quedar esperando indefinidamente sin avisar (se ve como que
// la pantalla nunca termina de cargar). Con un límite de tiempo, en vez de
// eso se muestra un mensaje claro para que el usuario sepa que es su señal,
// no que la app esté rota.
function fetchConLimite(url, opciones = {}, limiteMs = 15000) {
  const controlador = new AbortController();
  const aviso = setTimeout(() => controlador.abort(), limiteMs);
  return fetch(url, { ...opciones, signal: controlador.signal }).finally(() => clearTimeout(aviso));
}

function mensajeDeError(error) {
  if (error.name === "AbortError") return "Tu conexión está muy lenta o no responde. Verifica tu señal e intenta de nuevo.";
  return error.message;
}

async function cargarContactos() {
  try {
    const r = await fetchConLimite("/api/tarjetas", { cache: "no-store" });
    if (r.status === 401) { mostrarAuth(); return; }
    if (!r.ok) throw new Error(`El servidor respondió ${r.status}`);
    contactos = await r.json();
    renderInicio();
    if (document.getElementById("screen-contactos").style.display !== "none") renderContactosLista();
  } catch (error) {
    console.error("cargarContactos:", error);
    document.getElementById("lista-inicio").innerHTML = `<p class="placeholder-text">${escapeHtml(mensajeDeError(error))}</p>`;
  }
}

async function cargarDirectorio() {
  try {
    const r = await fetchConLimite("/api/directorio", { cache: "no-store" });
    if (r.status === 401) { mostrarAuth(); return; }
    if (!r.ok) throw new Error(`El servidor respondió ${r.status}`);
    directorio = await r.json();
  } catch (error) {
    console.error("cargarDirectorio:", error);
    directorio = [];
  }
}

function filtrarLista(lista, filtro, texto, categoria) {
  const t = (texto || "").trim().toLowerCase();
  return lista.filter((c) => {
    const coincideTexto = !t || (c.nombre || "").toLowerCase().includes(t) || (c.empresa || "").toLowerCase().includes(t);
    const coincideFiltro = filtro === "todos" || (filtro === "favorito" ? c.favorito : c.etiqueta === filtro);
    const coincideCategoria = !categoria || c.categoria === categoria;
    return coincideTexto && coincideFiltro && coincideCategoria;
  });
}

function accionesRapidas(c) {
  const botones = [];
  const wa = whatsappUrl(c.telefono);
  if (wa) botones.push(`<a href="${wa}" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="icon-btn" title="WhatsApp">💬</a>`);
  if (c.telefono) botones.push(`<a href="tel:${escapeHtml(c.telefono)}" onclick="event.stopPropagation()" class="icon-btn" title="Llamar">📞</a>`);
  if (c.email) botones.push(`<a href="mailto:${escapeHtml(c.email)}" onclick="event.stopPropagation()" class="icon-btn" title="Correo">✉️</a>`);
  return botones.join("");
}

function filaContacto(c, esDirectorio) {
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

function estadoVacio(glyph, titulo, texto) {
  return `<div class="empty-state"><div class="glyph">${glyph}</div><h3>${titulo}</h3><p>${texto}</p></div>`;
}

function adjuntarClicksFila(contenedor) {
  contenedor.querySelectorAll(".contact-row").forEach((fila) => {
    fila.addEventListener("click", () => abrirDetalle(fila.dataset.id, fila.dataset.directorio === "1"));
  });
}

// ---------- Inicio ----------
function renderInicio() {
  const total = contactos.length;
  const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
  const nuevas = contactos.filter((c) => new Date(c.creadoEn) >= inicioMes).length;
  document.getElementById("resumen-total").textContent = total;
  document.getElementById("resumen-nuevas").textContent = `+${nuevas} este mes`;

  const cont = document.getElementById("lista-inicio");
  try {
    const texto = document.getElementById("buscador-inicio").value;
    const visibles = filtrarLista(contactos, filtroActivo.inicio, texto).slice(0, 8);
    if (visibles.length === 0) {
      cont.innerHTML = estadoVacio("📇", "No tienes tarjetas guardadas todavía.", "Escanea tu primera tarjeta y comienza a construir tu red de contactos.");
      return;
    }
    cont.innerHTML = visibles.map((c) => filaContacto(c, false)).join("");
    adjuntarClicksFila(cont);
  } catch (error) {
    console.error("renderInicio:", error);
    cont.innerHTML = `<p class="placeholder-text">Ocurrió un error al mostrar tus contactos (${escapeHtml(error.message)}).</p>`;
  }
}

document.getElementById("buscador-inicio").addEventListener("input", renderInicio);
document.querySelectorAll('.chip-row[data-grupo="inicio"] .chip').forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll('.chip-row[data-grupo="inicio"] .chip').forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    filtroActivo.inicio = chip.dataset.filtro;
    renderInicio();
  });
});

// ---------- Contactos ----------
async function renderContactosLista() {
  const cont = document.getElementById("lista-contactos");
  const selectCat = document.getElementById("filtro-categoria-directorio");

  if (vistaContactos === "directorio" && directorio.length === 0) {
    cont.innerHTML = '<p class="placeholder-text">Cargando directorio...</p>';
    await cargarDirectorio();
  }

  selectCat.style.display = vistaContactos === "directorio" ? "block" : "none";
  try {
    const lista = vistaContactos === "directorio" ? directorio : contactos;
    const texto = document.getElementById("buscador-contactos").value;
    const categoria = vistaContactos === "directorio" ? selectCat.value : "";
    const visibles = filtrarLista(lista, filtroActivo.contactos, texto, categoria);

    if (visibles.length === 0) {
      cont.innerHTML = estadoVacio("📇", "No hay contactos para mostrar.", "Ajusta la búsqueda o los filtros.");
      return;
    }
    cont.innerHTML = visibles.map((c) => filaContacto(c, vistaContactos === "directorio")).join("");
    adjuntarClicksFila(cont);
  } catch (error) {
    console.error("renderContactosLista:", error);
    cont.innerHTML = `<p class="placeholder-text">Ocurrió un error al mostrar los contactos (${escapeHtml(error.message)}).</p>`;
  }
}

document.querySelectorAll('[data-vista-contactos]').forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll('[data-vista-contactos]').forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    vistaContactos = chip.dataset.vistaContactos;
    renderContactosLista();
  });
});
document.querySelectorAll('.chip-row[data-grupo="contactos"] .chip').forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll('.chip-row[data-grupo="contactos"] .chip').forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    filtroActivo.contactos = chip.dataset.filtro;
    renderContactosLista();
  });
});
document.getElementById("buscador-contactos").addEventListener("input", renderContactosLista);
document.getElementById("filtro-categoria-directorio").addEventListener("change", renderContactosLista);

// ---------- Acciones de contacto (whatsapp, redes) ----------
// Defensa adicional para tarjetas guardadas antes de normalizar la URL al
// guardar en el servidor (ej. "empresa.com" sin protocolo, que el navegador
// resolvería como ruta relativa al propio sitio en vez de abrir la web real).
function normalizarUrl(valor) {
  const v = (valor || "").trim().replace(/\s+/g, "");
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

function whatsappUrl(telefono, mensaje) {
  const digitos = (telefono || "").replace(/\D/g, "");
  if (!digitos) return null;
  const conCodigo = digitos.length <= 8 ? `502${digitos}` : digitos;
  return `https://wa.me/${conCodigo}` + (mensaje ? `?text=${encodeURIComponent(mensaje)}` : "");
}

function urlRedSocial(red, valor) {
  if (!valor) return null;
  const v = valor.trim();
  if (/^https?:\/\//i.test(v)) return v;
  return red.base + v.replace(/^@/, "");
}

// ---------- Detalle de contacto ----------
function buscarContactoPorId(id) {
  return contactos.find((c) => c._id === id) || directorio.find((c) => c._id === id);
}

async function abrirDetalle(id, esDirectorio) {
  // La lista solo trae una miniatura liviana; el detalle necesita las fotos
  // completas (frente/reverso), así que se piden aparte, solo para esta
  // tarjeta puntual.
  let c;
  try {
    const r = await fetchConLimite(`/api/tarjetas/${id}`, { cache: "no-store" });
    if (!r.ok) throw new Error();
    c = await r.json();
  } catch {
    c = buscarContactoPorId(id);
  }
  if (!c) return;

  detalleActualId = id;
  detalleActualData = c;
  detalleEsDirectorio = esDirectorio;
  detalleFlipped = false;

  document.getElementById("detalle-nombre").textContent = c.nombre;
  document.getElementById("detalle-meta").textContent = [c.cargo, c.empresa].filter(Boolean).join(" · ") || "Sin empresa";

  const flipWrap = document.getElementById("detalle-flip-wrap");
  const flipInner = document.getElementById("detalle-flip-inner");
  const flipHint = document.getElementById("detalle-flip-hint");
  flipInner.classList.remove("flipped");
  flipWrap.classList.remove("es-vertical");
  if (c.imagenFrente || c.imagenReverso) {
    flipWrap.style.display = "block";
    document.getElementById("detalle-cara-frente").innerHTML = c.imagenFrente ? `<img src="${c.imagenFrente}" alt="">` : `<div class="detail-face placeholder">${escapeHtml(c.nombre)}</div>`;
    document.getElementById("detalle-cara-reverso").innerHTML = c.imagenReverso ? `<img src="${c.imagenReverso}" alt="">` : `<div class="detail-face placeholder">Sin reverso</div>`;
    flipHint.style.display = c.imagenReverso ? "block" : "none";
    // El contenedor se ajusta a vertical si cualquiera de las dos caras es vertical,
    // así ninguna de las dos queda recortada al usar el flip.
    Promise.all([detectarOrientacion(c.imagenFrente), detectarOrientacion(c.imagenReverso)]).then(([vFrente, vReverso]) => {
      flipWrap.classList.toggle("es-vertical", vFrente || vReverso);
    });
  } else {
    flipWrap.style.display = "none";
    flipHint.style.display = "none";
  }

  const acciones = [];
  const wa = whatsappUrl(c.telefono, "Hola, nos contactamos por tu tarjeta de presentación.");
  if (wa) acciones.push(`<a href="${wa}" target="_blank" rel="noopener"><span class="glyph">💬</span>WhatsApp</a>`);
  if (c.telefono) acciones.push(`<a href="tel:${escapeHtml(c.telefono)}"><span class="glyph">📞</span>Llamar</a>`);
  if (c.email) acciones.push(`<a href="mailto:${escapeHtml(c.email)}"><span class="glyph">✉️</span>Correo</a>`);
  const sitioWebUrl = normalizarUrl(c.sitioWeb);
  if (sitioWebUrl) acciones.push(`<a href="${escapeHtml(sitioWebUrl)}" target="_blank" rel="noopener"><span class="glyph">🌐</span>Sitio web</a>`);
  REDES.forEach((red) => {
    const url = urlRedSocial(red, c[red.campo]);
    if (url) acciones.push(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><span class="glyph">${red.glyph}</span>${red.etiqueta}</a>`);
  });
  document.getElementById("detalle-acciones").innerHTML = acciones.join("");

  const notas = document.getElementById("detalle-notas");
  notas.style.display = c.notas ? "block" : "none";
  notas.textContent = c.notas || "";

  const btnFav = document.getElementById("btn-favorito-detalle");
  btnFav.textContent = c.favorito ? "★" : "☆";
  btnFav.style.display = esDirectorio ? "none" : "inline-flex";
  document.getElementById("btn-editar-detalle").style.display = esDirectorio ? "none" : "block";

  mostrarPantalla("detalle");
}

document.getElementById("detalle-flip-inner").addEventListener("click", () => {
  detalleFlipped = !detalleFlipped;
  document.getElementById("detalle-flip-inner").classList.toggle("flipped", detalleFlipped);
});

document.getElementById("btn-favorito-detalle").addEventListener("click", async () => {
  const c = detalleActualData;
  if (!c) return;
  const nuevoValor = !c.favorito;
  try {
    const r = await fetch(`/api/tarjetas/${detalleActualId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...datosTarjetaParaEnvio(c), favorito: nuevoValor, imagenFrente: "", imagenReverso: "", fotoPerfil: "" })
    });
    if (!r.ok) throw new Error("No se pudo actualizar.");
    c.favorito = nuevoValor;
    document.getElementById("btn-favorito-detalle").textContent = nuevoValor ? "★" : "☆";
    await cargarContactos();
  } catch (error) { alert(error.message); }
});

function datosTarjetaParaEnvio(c) {
  return {
    nombre: c.nombre, empresa: c.empresa, cargo: c.cargo, telefono: c.telefono, email: c.email,
    sitioWeb: c.sitioWeb, notas: c.notas, facebook: c.facebook, instagram: c.instagram, linkedin: c.linkedin,
    tiktok: c.tiktok, twitter: c.twitter, categoria: c.categoria, etiqueta: c.etiqueta, favorito: c.favorito, esMiTarjeta: c.esMiTarjeta
  };
}

document.getElementById("btn-volver-detalle").addEventListener("click", () => mostrarPantalla(detalleEsDirectorio ? "contactos" : "contactos"));
document.getElementById("btn-compartir-detalle").addEventListener("click", () => {
  const c = detalleActualData;
  if (!c) return;
  const texto = `${c.nombre}${c.empresa ? " - " + c.empresa : ""}${c.telefono ? " - " + c.telefono : ""}`;
  if (navigator.share) navigator.share({ title: c.nombre, text: texto }).catch(() => {});
  else { navigator.clipboard?.writeText(texto); alert("Datos del contacto copiados."); }
});
document.getElementById("btn-editar-detalle").addEventListener("click", () => {
  if (detalleActualData) iniciarEdicion(detalleActualData);
});

// ---------- Escaneo ----------
function iniciarEscaneo() {
  capturas = { frente: "", reverso: "" };
  avatarMiniBase64 = "";
  ladoActivo = "frente";
  editandoId = null;
  document.getElementById("dot-frente").style.display = "none";
  document.getElementById("dot-reverso").style.display = "none";
  document.querySelectorAll(".scan-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.lado === "frente"));
  const viewfinder = document.getElementById("scan-viewfinder");
  viewfinder.innerHTML = '<p class="hint">Coloca la tarjeta dentro del marco y toma la foto</p>';
  viewfinder.classList.remove("es-vertical");
  document.getElementById("btn-continuar-escaneo").disabled = true;
  mostrarPantalla("escanear");
}

async function refrescarViewfinder() {
  const cont = document.getElementById("scan-viewfinder");
  const src = capturas[ladoActivo];
  cont.innerHTML = src ? `<img src="${src}" alt="">` : '<p class="hint">Coloca la tarjeta dentro del marco y toma la foto</p>';
  cont.classList.toggle("es-vertical", src ? await detectarOrientacion(src) : false);
}

document.querySelectorAll(".scan-toggle button").forEach((btn) => {
  btn.addEventListener("click", () => {
    ladoActivo = btn.dataset.lado;
    document.querySelectorAll(".scan-toggle button").forEach((b) => b.classList.toggle("active", b === btn));
    refrescarViewfinder();
  });
});

document.getElementById("btn-shutter").addEventListener("click", () => document.getElementById("input-captura").click());

// Detecta si una imagen (ya sea recién capturada o ya guardada) es vertical
// u horizontal, para que el contenedor que la muestra se ajuste sin recortar
// ni deformar. Funciona igual para fotos nuevas y para las que ya están
// guardadas en la base de datos (no requiere conocer la orientación de
// antemano).
function detectarOrientacion(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(false); return; }
    const img = new Image();
    img.onload = () => resolve(img.naturalHeight > img.naturalWidth);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

// Miniatura chica (para avatares en listas) a partir de la foto del frente
// ya comprimida. Las listas (Inicio/Contactos) usan esto en vez de la foto
// completa para no descargar cientos de KB por tarjeta solo para mostrar un
// avatar pequeño.
function generarMiniatura(dataUrlOrigen, maxLado = 120, calidad = 0.6) {
  return new Promise((resolve) => {
    if (!dataUrlOrigen) { resolve(""); return; }
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", calidad));
    };
    img.onerror = () => resolve("");
    img.src = dataUrlOrigen;
  });
}

function comprimirImagen(file, maxAncho = 1200, calidad = 0.75) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error("No se pudo leer la imagen."));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("El archivo no es una imagen válida."));
      img.onload = () => {
        const escala = Math.min(1, maxAncho / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", calidad));
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(file);
  });
}

document.getElementById("input-captura").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const base64 = await comprimirImagen(file);
    capturas[ladoActivo] = base64;
    if (ladoActivo === "frente") avatarMiniBase64 = await generarMiniatura(base64);
    await refrescarViewfinder();
    document.getElementById(`dot-${ladoActivo}`).style.display = "inline-block";
    document.getElementById("btn-continuar-escaneo").disabled = !capturas.frente;
  } catch (error) { alert(error.message); }
  e.target.value = "";
});

document.getElementById("btn-saltar-reverso").addEventListener("click", () => continuarAFormulario());
document.getElementById("btn-continuar-escaneo").addEventListener("click", () => continuarAFormulario());

async function continuarAFormulario() {
  abrirFormularioVacio();
  if (capturas.frente && usuarioActual.tieneApiKey) {
    await ejecutarOcr(capturas.frente, true);
  }
  mostrarPantalla("formulario");
}

// ---------- Formulario contacto ----------
function abrirFormularioVacio() {
  editandoId = null;
  document.getElementById("formulario-titulo").textContent = "Nuevo contacto";
  document.getElementById("form-contacto").reset();
  document.getElementById("form-message").innerHTML = "";
  actualizarThumb("frente", capturas.frente);
  actualizarThumb("reverso", capturas.reverso);
  document.querySelectorAll(".etiqueta-opt").forEach((o) => o.classList.remove("active"));
}

function actualizarThumb(lado, src) {
  const el = document.getElementById(`thumb-${lado}`);
  el.innerHTML = src ? `<img src="${src}" alt="">` : `<span>+ ${lado === "frente" ? "Frente" : "Reverso"}</span>`;
}

document.querySelectorAll(".form-thumbs .thumb").forEach((thumb) => {
  thumb.addEventListener("click", () => document.getElementById(`input-thumb-${thumb.dataset.lado}`).click());
});
document.getElementById("input-thumb-frente").addEventListener("change", async (e) => {
  if (!e.target.files[0]) return;
  capturas.frente = await comprimirImagen(e.target.files[0]);
  avatarMiniBase64 = await generarMiniatura(capturas.frente);
  actualizarThumb("frente", capturas.frente);
  e.target.value = "";
});
document.getElementById("input-thumb-reverso").addEventListener("change", async (e) => {
  if (!e.target.files[0]) return;
  capturas.reverso = await comprimirImagen(e.target.files[0]);
  actualizarThumb("reverso", capturas.reverso);
  e.target.value = "";
});

document.querySelectorAll(".etiqueta-opt").forEach((opt) => {
  opt.addEventListener("click", () => {
    const yaActiva = opt.classList.contains("active");
    document.querySelectorAll(".etiqueta-opt").forEach((o) => o.classList.remove("active"));
    if (!yaActiva) opt.classList.add("active");
  });
});

async function ejecutarOcr(imagen, silencioso) {
  const msg = document.getElementById("form-message");
  if (!silencioso) msg.innerHTML = '<p class="message success">Escaneando...</p>';
  try {
    const r = await fetch("/api/ocr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imagen }) });
    const datos = await r.json();
    if (!r.ok) throw new Error(datos.error || "No se pudo escanear la imagen.");
    const form = document.getElementById("form-contacto");
    if (datos.nombre) form.nombre.value = datos.nombre;
    if (datos.empresa) form.empresa.value = datos.empresa;
    if (datos.cargo) form.cargo.value = datos.cargo;
    if (datos.telefono) form.telefono.value = datos.telefono;
    if (datos.email) form.email.value = datos.email;
    if (datos.sitioWeb) form.sitioWeb.value = datos.sitioWeb;
    msg.innerHTML = '<p class="message success">Datos extraídos con OCR. Revísalos antes de guardar.</p>';
  } catch (error) {
    msg.innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`;
  }
}

document.getElementById("btn-reescanear-ocr").addEventListener("click", () => {
  if (!capturas.frente) { alert("Primero agrega la foto del frente."); return; }
  ejecutarOcr(capturas.frente, false);
});

document.getElementById("btn-volver-formulario").addEventListener("click", () => mostrarPantalla(editandoId ? "detalle" : "inicio"));

function iniciarEdicion(c) {
  editandoId = c._id;
  capturas = { frente: c.imagenFrente || "", reverso: c.imagenReverso || "" };
  avatarMiniBase64 = c.avatarMini || "";
  document.getElementById("formulario-titulo").textContent = "Editar contacto";
  document.getElementById("form-message").innerHTML = "";
  const form = document.getElementById("form-contacto");
  form.nombre.value = c.nombre || "";
  form.empresa.value = c.empresa || "";
  form.cargo.value = c.cargo || "";
  form.telefono.value = c.telefono || "";
  form.email.value = c.email || "";
  form.sitioWeb.value = c.sitioWeb || "";
  form.notas.value = c.notas || "";
  form.categoria.value = c.categoria || "";
  form.facebook.value = c.facebook || "";
  form.instagram.value = c.instagram || "";
  form.linkedin.value = c.linkedin || "";
  form.tiktok.value = c.tiktok || "";
  form.twitter.value = c.twitter || "";
  document.getElementById("c-favorito").checked = Boolean(c.favorito);
  document.getElementById("c-mitarjeta").checked = Boolean(c.esMiTarjeta);
  document.querySelectorAll(".etiqueta-opt").forEach((o) => o.classList.toggle("active", o.dataset.etiqueta === c.etiqueta));
  actualizarThumb("frente", capturas.frente);
  actualizarThumb("reverso", capturas.reverso);
  mostrarPantalla("formulario");
}

document.getElementById("btn-guardar-contacto").addEventListener("click", async () => {
  const form = document.getElementById("form-contacto");
  if (!form.reportValidity()) return;
  const btn = document.getElementById("btn-guardar-contacto");
  const msg = document.getElementById("form-message");

  const etiquetaActiva = document.querySelector(".etiqueta-opt.active");
  const datos = {
    nombre: form.nombre.value, empresa: form.empresa.value, cargo: form.cargo.value, telefono: form.telefono.value,
    email: form.email.value, sitioWeb: form.sitioWeb.value, notas: form.notas.value, categoria: form.categoria.value,
    facebook: form.facebook.value, instagram: form.instagram.value, linkedin: form.linkedin.value,
    tiktok: form.tiktok.value, twitter: form.twitter.value,
    etiqueta: etiquetaActiva ? etiquetaActiva.dataset.etiqueta : "",
    favorito: document.getElementById("c-favorito").checked,
    esMiTarjeta: document.getElementById("c-mitarjeta").checked,
    imagenFrente: capturas.frente, imagenReverso: capturas.reverso, avatarMini: avatarMiniBase64
  };

  btn.disabled = true; btn.textContent = "Guardando...";
  try {
    const url = editandoId ? `/api/tarjetas/${editandoId}` : "/api/tarjetas";
    const r = await fetch(url, { method: editandoId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
    if (r.status === 401) { mostrarAuth(); return; }
    const resultado = await r.json();
    if (!r.ok) throw new Error(resultado.error || `Error ${r.status}`);
    await cargarContactos();
    mostrarPantalla("contactos");
  } catch (error) {
    msg.innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`;
  } finally {
    btn.disabled = false; btn.textContent = "Guardar";
  }
});

// ---------- Mi Tarjeta ----------
function miTarjetaActual() {
  return contactos.find((c) => c.esMiTarjeta);
}

async function registrarEvento(id, tipo) {
  try { await fetch(`/api/eventos-tarjeta/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo }) }); } catch {}
}

async function renderMiTarjeta() {
  const cont = document.getElementById("mitarjeta-contenido");
  const referencia = miTarjetaActual();

  if (!referencia) {
    cont.innerHTML = estadoVacio("💳", "Todavía no tienes una tarjeta personal.", "Edita o crea un contacto y marca \"Esta es mi tarjeta personal\" para activarla aquí.") +
      `<button type="button" class="btn btn-block" id="btn-crear-mitarjeta">Crear mi tarjeta</button>`;
    document.getElementById("btn-crear-mitarjeta").addEventListener("click", iniciarEscaneo);
    return;
  }

  // La lista solo trae una miniatura; aquí se necesita la foto completa.
  let t = referencia;
  try {
    const r = await fetchConLimite(`/api/tarjetas/${referencia._id}`, { cache: "no-store" });
    if (r.ok) t = await r.json();
  } catch {
    // Si falla, se usa la versión liviana de la lista (sin foto completa) para no dejar la pantalla en blanco.
  }

  const enlace = `${location.origin}/t?id=${t._id}`;
  const avatar = t.fotoPerfil || t.imagenFrente ? `<img src="${t.fotoPerfil || t.imagenFrente}" alt="">` : iniciales(t.nombre);
  cont.innerHTML = `
    <div class="wallet-card">
      <div class="wallet-top">
        <div class="wallet-avatar">${avatar}</div>
        <div><div class="wallet-name">${escapeHtml(t.nombre)}</div><div class="wallet-role">${escapeHtml([t.cargo, t.empresa].filter(Boolean).join(" · "))}</div></div>
      </div>
      <div class="wallet-contact">
        ${t.telefono ? `📞 ${escapeHtml(t.telefono)}<br>` : ""}
        ${t.email ? `✉️ ${escapeHtml(t.email)}<br>` : ""}
        ${t.sitioWeb ? `🌐 ${escapeHtml(t.sitioWeb)}` : ""}
      </div>
    </div>
    <div class="qr-wrap"><canvas id="qr-canvas"></canvas></div>
    <div class="mi-tarjeta-actions">
      <button type="button" class="btn" id="btn-compartir-mt">Compartir</button>
      <button type="button" class="btn btn-outline" id="btn-descargar-qr">Descargar QR</button>
      <button type="button" class="btn btn-outline" id="btn-copiar-enlace">Copiar enlace</button>
      <button type="button" class="btn btn-outline" id="btn-editar-mt">Editar</button>
    </div>
    <button type="button" class="btn-ghost btn-block" id="btn-ver-estadisticas" style="text-align:center; width:100%;">Ver estadísticas →</button>
  `;

  if (window.QRCode) {
    QRCode.toCanvas(document.getElementById("qr-canvas"), enlace, { width: 200, margin: 1, color: { dark: "#1F2937" } });
  }

  document.getElementById("btn-compartir-mt").addEventListener("click", async () => {
    await registrarEvento(t._id, "compartido");
    const mensaje = encodeURIComponent(`Te comparto mi tarjeta de presentación: ${enlace}`);
    window.open(`https://wa.me/?text=${mensaje}`, "_blank");
  });
  document.getElementById("btn-copiar-enlace").addEventListener("click", async () => {
    await registrarEvento(t._id, "compartido");
    navigator.clipboard?.writeText(enlace);
    alert("Enlace copiado.");
  });
  document.getElementById("btn-descargar-qr").addEventListener("click", async () => {
    await registrarEvento(t._id, "descarga");
    const canvas = document.getElementById("qr-canvas");
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "mi-tarjeta-qr.png";
    a.click();
  });
  document.getElementById("btn-editar-mt").addEventListener("click", () => iniciarEdicion(t));
  document.getElementById("btn-ver-estadisticas").addEventListener("click", () => { mostrarPantalla("estadisticas"); cargarEstadisticas(t._id); });
}

// ---------- Estadísticas ----------
function dibujarSparkline(serie) {
  if (serie.length === 0) return '<p class="placeholder-text">Todavía no hay vistas registradas.</p>';
  const max = Math.max(...serie.map((p) => p.conteo), 1);
  const w = 280, h = 70, paso = w / Math.max(serie.length - 1, 1);
  const puntos = serie.map((p, i) => `${i * paso},${h - (p.conteo / max) * (h - 10) - 5}`).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%; height:80px;"><polyline points="${puntos}" fill="none" stroke="#FF6B00" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

async function cargarEstadisticas(id) {
  const cont = document.getElementById("estadisticas-contenido");
  cont.innerHTML = '<p class="placeholder-text">Cargando...</p>';
  try {
    const r = await fetchConLimite(`/api/tarjetas/${id}/estadisticas`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "No se pudieron cargar las estadísticas.");

    const iconos = { vista: "👁️", compartido: "↗️", descarga: "⬇️" };
    const actividad = data.recientes.length
      ? data.recientes.map((ev) => `
          <div class="activity-row">
            <div class="glyph">${iconos[ev.tipo] || "•"}</div>
            <div style="flex:1;">${ev.viewerNombre ? escapeHtml(ev.viewerNombre) : "Alguien"} ${ev.tipo === "vista" ? "vio" : ev.tipo === "compartido" ? "compartió" : "descargó"} tu tarjeta
              <div class="meta">${new Date(ev.fecha).toLocaleString("es-GT")}</div>
            </div>
          </div>`).join("")
      : '<p class="placeholder-text">Sin actividad reciente.</p>';

    cont.innerHTML = `
      <div class="stat-grid">
        <div class="stat-box"><div class="num">${data.totalVistas}</div><div class="lbl">Vistas</div></div>
        <div class="stat-box"><div class="num">${data.totalCompartidos}</div><div class="lbl">Compartidos</div></div>
        <div class="stat-box"><div class="num">${data.totalDescargas}</div><div class="lbl">Descargas</div></div>
      </div>
      <div class="section-label">Vistas (últimos 30 días)</div>
      <div class="card" style="margin-bottom:22px;">${dibujarSparkline(data.serieVistas)}</div>
      <div class="section-label">Actividad reciente</div>
      <div class="card">${actividad}</div>
    `;
  } catch (error) {
    cont.innerHTML = `<p class="placeholder-text">${escapeHtml(mensajeDeError(error))}</p>`;
  }
}

// ---------- Perfil ----------
document.getElementById("btn-cambiar-foto").addEventListener("click", () => document.getElementById("input-foto-perfil").click());
document.getElementById("input-foto-perfil").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const base64 = await comprimirImagen(file, 400, 0.8);
    const dpiActual = prompt("Ingresa tu DPI actual para confirmar el cambio de foto:");
    if (!dpiActual) return;
    const r = await fetch("/api/usuario", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fotoPerfil: base64, dpiActual }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "No se pudo actualizar la foto.");
    usuarioActual = data;
    actualizarAvatarPerfil();
  } catch (error) { alert(error.message); }
  e.target.value = "";
});

document.getElementById("form-cuenta").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target, msg = document.getElementById("cuenta-message");
  msg.innerHTML = "";
  try {
    const r = await fetch("/api/usuario", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: form.nombre.value, telefono: form.telefono.value, dpiNuevo: form.dpiNuevo.value, dpiActual: form.dpiActual.value })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "No se pudo actualizar la cuenta.");
    usuarioActual = data;
    form.dpiNuevo.value = ""; form.dpiActual.value = "";
    document.getElementById("saludo-nombre").textContent = (usuarioActual.nombre || "").split(" ")[0];
    document.getElementById("perfil-nombre-display").textContent = usuarioActual.nombre;
    msg.innerHTML = '<p class="message success">Cuenta actualizada.</p>';
  } catch (error) { msg.innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`; }
});

document.getElementById("btn-guardar-key").addEventListener("click", async () => {
  const input = document.getElementById("input-openai-key");
  try {
    const r = await fetch("/api/usuario/openai-key", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ openaiApiKey: input.value }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "No se pudo guardar la API key.");
    usuarioActual.tieneApiKey = data.tieneApiKey;
    actualizarEstadoApiKey();
    input.value = "";
    alert("API key guardada.");
  } catch (error) { alert(error.message); }
});

iniciar();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
