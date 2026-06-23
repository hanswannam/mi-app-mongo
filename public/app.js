import { escapeHtml, iniciales } from "./src/utils/strings.js";
import { normalizarUrl, whatsappUrl, urlRedSocial } from "./src/utils/contactLinks.js";
import { filtrarLista } from "./src/utils/listFilters.js";
import { fetchConLimite, mensajeDeError } from "./src/utils/network.js";
import { detectarOrientacion, generarMiniatura, comprimirImagen, recortarYComprimirCuadrado } from "./src/utils/imageProcessing.js";
import { REDES, filaContacto } from "./src/templates/contactRow.js";
import { estadoVacio } from "./src/templates/emptyState.js";
import { dibujarSparkline } from "./src/templates/sparkline.js";
import { consultarSesionActual, iniciarSesion, registrarUsuario, cerrarSesion, solicitarRecuperacion } from "./src/auth.js";
import { actualizarFotoPerfil, actualizarCuenta, guardarApiKey } from "./src/perfil.js";
import { escanearImagen } from "./src/ocr.js";
import { guardarTarjeta, obtenerTarjetas, obtenerDirectorio, obtenerTarjeta, invitarContacto } from "./src/tarjetas.js";

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
  // Un error en cualquiera de estos dos (detalles del perfil) no debe poder
  // tumbar la carga de las tarjetas que viene justo después — eso fue
  // exactamente lo que pasaba antes: un error silencioso aquí dejaba la
  // pantalla pegada en "Cargando..." para siempre, sin aviso.
  try { actualizarAvatarPerfil(); } catch (error) { console.error("actualizarAvatarPerfil:", error); }
  try { actualizarEstadoApiKey(); } catch (error) { console.error("actualizarEstadoApiKey:", error); }
  cargarCategorias();
  cargarContactos();
  mostrarPantalla("inicio");
}

function actualizarAvatarPerfil() {
  // El input de archivo vive aparte en el HTML (no como hijo de este div):
  // si se metiera aquí, el innerHTML de abajo lo destruiría en cada llamada
  // y la siguiente vez ya no existiría — eso causaba un error que detenía
  // por completo la carga de la app (incluyendo las tarjetas) en cada visita.
  const el = document.getElementById("perfil-avatar");
  el.innerHTML = usuarioActual.fotoPerfil
    ? `<img src="${usuarioActual.fotoPerfil}" alt="">`
    : iniciales(usuarioActual.nombre);
}

function actualizarEstadoApiKey() {
  document.getElementById("estado-api-key").textContent = usuarioActual.tieneApiKey
    ? "API key configurada." : "Todavía no has configurado tu API key.";
}

async function iniciar() {
  try {
    usuarioActual = await consultarSesionActual();
    if (usuarioActual) mostrarApp(); else mostrarAuth();
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
    document.getElementById("form-recuperar").style.display = "none";
    document.getElementById("auth-message").innerHTML = "";
  });
});

document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target, msg = document.getElementById("auth-message");
  msg.innerHTML = "";
  try {
    usuarioActual = await iniciarSesion(form.telefono.value, form.dpi.value);
    mostrarApp();
  } catch (error) { msg.innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`; }
});

document.getElementById("form-registro").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target, msg = document.getElementById("auth-message");
  msg.innerHTML = "";
  try {
    usuarioActual = await registrarUsuario(form.nombre.value, form.telefono.value, form.dpi.value);
    mostrarApp();
  } catch (error) { msg.innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`; }
});

// Sin una API de WhatsApp Business/Twilio, el servidor no puede enviar un
// mensaje por su cuenta. Esto solo confirma que la cuenta existe y abre
// WhatsApp con el mensaje ya escrito hacia un administrador, que completa
// el reseteo con el botón "Resetear DPI" que ya existe en /admin.
document.getElementById("btn-abrir-recuperar").addEventListener("click", () => {
  document.getElementById("form-login").style.display = "none";
  document.getElementById("form-recuperar").style.display = "block";
  document.getElementById("auth-message").innerHTML = "";
});
document.getElementById("btn-cerrar-recuperar").addEventListener("click", () => {
  document.getElementById("form-recuperar").style.display = "none";
  document.getElementById("form-login").style.display = "block";
  document.getElementById("auth-message").innerHTML = "";
});
document.getElementById("form-recuperar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const telefono = e.target.telefono.value;
  const msg = document.getElementById("auth-message");
  msg.innerHTML = "";
  try {
    const data = await solicitarRecuperacion(telefono);
    const mensaje = `Hola, olvidé el acceso a mi cuenta de Billetera Virtual. Mi número registrado es ${telefono}. ¿Me ayudas a restablecerlo?`;
    const wa = whatsappUrl(data.telefonoSoporte, mensaje);
    if (wa) window.open(wa, "_blank");
    msg.innerHTML = '<p class="message success">Te ayudamos a abrir WhatsApp con tu solicitud. Envíala para que un administrador te ayude.</p>';
  } catch (error) { msg.innerHTML = `<p class="message error">${escapeHtml(mensajeDeError(error))}</p>`; }
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
  await cerrarSesion();
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
async function cargarContactos() {
  try {
    const { status, ok, data } = await obtenerTarjetas();
    if (status === 401) { mostrarAuth(); return; }
    if (!ok) throw new Error(`El servidor respondió ${status}`);
    contactos = data;
    renderInicio();
    if (document.getElementById("screen-contactos").style.display !== "none") renderContactosLista();
  } catch (error) {
    console.error("cargarContactos:", error);
    document.getElementById("lista-inicio").innerHTML = `<p class="placeholder-text">${escapeHtml(mensajeDeError(error))}</p>`;
  }
}

async function cargarDirectorio() {
  try {
    const { status, ok, data } = await obtenerDirectorio();
    if (status === 401) { mostrarAuth(); return; }
    if (!ok) throw new Error(`El servidor respondió ${status}`);
    directorio = data;
  } catch (error) {
    console.error("cargarDirectorio:", error);
    directorio = [];
  }
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
    c = await obtenerTarjeta(id);
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

  const btnInvitar = document.getElementById("btn-invitar-detalle");
  btnInvitar.style.display = (!esDirectorio && !c.esMiTarjeta && c.telefono) ? "block" : "none";
  btnInvitar.disabled = false;
  btnInvitar.textContent = "📲 Invitar a la plataforma";

  mostrarPantalla("detalle");
}

document.getElementById("btn-invitar-detalle").addEventListener("click", async () => {
  const btn = document.getElementById("btn-invitar-detalle");
  if (!detalleActualId) return;
  btn.disabled = true; btn.textContent = "Generando enlace...";
  try {
    const data = await invitarContacto(detalleActualId);
    const mensaje = `Hola ${data.nombreContacto || ""}. Hemos digitalizado tu tarjeta de presentación. Ahora puedes administrar y actualizar tu información directamente. Activa tu cuenta aquí: ${data.link}`;
    const wa = whatsappUrl(data.telefonoContacto, mensaje);
    if (wa) window.open(wa, "_blank");
    else { await navigator.clipboard?.writeText(data.link); alert("Enlace de invitación copiado: " + data.link); }
  } catch (error) {
    alert(mensajeDeError(error));
  } finally {
    btn.disabled = false; btn.textContent = "📲 Invitar a la plataforma";
  }
});

document.getElementById("detalle-flip-inner").addEventListener("click", () => {
  detalleFlipped = !detalleFlipped;
  document.getElementById("detalle-flip-inner").classList.toggle("flipped", detalleFlipped);
});

document.getElementById("btn-favorito-detalle").addEventListener("click", async () => {
  const c = detalleActualData;
  if (!c) return;
  const nuevoValor = !c.favorito;
  try {
    const { ok } = await guardarTarjeta(
      { ...datosTarjetaParaEnvio(c), favorito: nuevoValor, imagenFrente: "", imagenReverso: "", fotoPerfil: "" },
      detalleActualId
    );
    if (!ok) throw new Error("No se pudo actualizar.");
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
    const datos = await escanearImagen(imagen);
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

async function guardarContacto(idForzado) {
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

  const idDestino = idForzado || editandoId;
  btn.disabled = true; btn.textContent = "Guardando...";
  try {
    const { status, ok, data: resultado } = await guardarTarjeta(datos, idDestino);
    if (status === 401) { mostrarAuth(); return; }

    if (status === 409 && resultado.duplicado) {
      mostrarAvisoDuplicado(resultado.error, resultado.duplicado, datos);
      return;
    }
    if (!ok) throw new Error(resultado.error || `Error ${status}`);

    await cargarContactos();
    mostrarPantalla("contactos");
  } catch (error) {
    msg.innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`;
  } finally {
    btn.disabled = false; btn.textContent = "Guardar";
  }
}

function mostrarAvisoDuplicado(mensaje, duplicado) {
  const msg = document.getElementById("form-message");
  msg.innerHTML = `
    <div class="message error">
      <p style="margin:0 0 10px;">${escapeHtml(mensaje)} (<strong>${escapeHtml(duplicado.nombre)}</strong>${duplicado.empresa ? " · " + escapeHtml(duplicado.empresa) : ""})</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button type="button" class="btn btn-sm" id="dup-ver">Ver tarjeta existente</button>
        <button type="button" class="btn btn-outline btn-sm" id="dup-actualizar">Actualizar información</button>
        <button type="button" class="btn-ghost" id="dup-cancelar">Cancelar</button>
      </div>
    </div>
  `;
  document.getElementById("dup-ver").addEventListener("click", () => abrirDetalle(duplicado._id, false));
  document.getElementById("dup-actualizar").addEventListener("click", () => guardarContacto(duplicado._id));
  document.getElementById("dup-cancelar").addEventListener("click", () => { msg.innerHTML = ""; });
}

document.getElementById("btn-guardar-contacto").addEventListener("click", () => guardarContacto());

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

// Reemplaza window.prompt(): en Chrome/Android, un prompt() llamado después
// de un await (aquí, después de comprimir la imagen) puede bloquearse en
// silencio si ya pasó el breve margen de "interacción reciente" del toque
// original — eso era lo que hacía que "Cambiar foto" no hiciera nada.
function pedirConfirmacionDpi(mensaje) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("modal-confirmar-dpi");
    const input = document.getElementById("modal-dpi-input");
    document.getElementById("modal-dpi-texto").textContent = mensaje || "Ingresa tu DPI actual para confirmar.";
    input.value = "";
    overlay.style.display = "flex";
    input.focus();

    const btnConfirmar = document.getElementById("modal-dpi-confirmar");
    const btnCancelar = document.getElementById("modal-dpi-cancelar");
    function limpiar() {
      overlay.style.display = "none";
      btnConfirmar.removeEventListener("click", onConfirmar);
      btnCancelar.removeEventListener("click", onCancelar);
    }
    function onConfirmar() { const v = input.value.trim(); limpiar(); resolve(v || null); }
    function onCancelar() { limpiar(); resolve(null); }
    btnConfirmar.addEventListener("click", onConfirmar);
    btnCancelar.addEventListener("click", onCancelar);
  });
}

document.getElementById("btn-cambiar-foto").addEventListener("click", () => document.getElementById("input-foto-perfil").click());
document.getElementById("input-foto-perfil").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const base64 = await recortarYComprimirCuadrado(file);
    const dpiActual = await pedirConfirmacionDpi("Ingresa tu DPI actual para guardar la nueva foto.");
    if (!dpiActual) return;
    usuarioActual = await actualizarFotoPerfil(base64, dpiActual);
    actualizarAvatarPerfil();
  } catch (error) { alert(mensajeDeError(error)); }
  e.target.value = "";
});

document.getElementById("form-cuenta").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target, msg = document.getElementById("cuenta-message");
  msg.innerHTML = "";
  try {
    usuarioActual = await actualizarCuenta(form.nombre.value, form.telefono.value, form.dpiNuevo.value, form.dpiActual.value);
    form.dpiNuevo.value = ""; form.dpiActual.value = "";
    document.getElementById("saludo-nombre").textContent = (usuarioActual.nombre || "").split(" ")[0];
    document.getElementById("perfil-nombre-display").textContent = usuarioActual.nombre;
    msg.innerHTML = '<p class="message success">Cuenta actualizada.</p>';
  } catch (error) { msg.innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`; }
});

document.getElementById("btn-guardar-key").addEventListener("click", async () => {
  const input = document.getElementById("input-openai-key");
  try {
    const data = await guardarApiKey(input.value);
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
