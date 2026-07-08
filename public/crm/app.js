// --- CRM BNI: shell, navegación y vistas de la Fase 1 ---
// Reutiliza las mismas cookies/sesión del Worker que la PWA de tarjetas;
// es una superficie nueva, no toca nada de /public/app.js.

import { whatsappUrl } from "../src/utils/contactLinks.js";
import { recortarYComprimirCuadrado } from "../src/utils/imageProcessing.js";

let usuarioActual = null;
let capitulosDisponibles = [];
let capituloIdActivo = null;
let capituloNombreActivo = "";
let esferasCache = [];
let vistaActiva = "dashboard";
let misPermisos = {}; // { moduloKey: ["ver","crear",...] }, ver cargarMisPermisos()

// Un superadmin puede TAMBIÉN ser networker de su propio capítulo (ver
// "Mi Perfil"); este switch solo cambia qué muestra el menú -- nunca
// quita permisos reales, el backend sigue dejándolo entrar a todo. Es
// puramente para que pueda navegar como lo haría su propio networker sin
// el ruido de las pantallas de administración.
let modoNetworkerActivo = false;
const MODULOS_OCULTOS_EN_MODO_NETWORKER = ["capitulos", "usuarios", "configuracion"];

const SECCIONES = [
  { id: "dashboard", label: "Dashboard", icono: "📊" },
  { id: "capitulos", label: "Capítulos", icono: "🏷️", soloSuperAdmin: true },
  { id: "mi-perfil", label: "Mi Perfil", icono: "🪪", soloNetworker: true },
  { id: "usuarios", label: "Usuarios", icono: "🧑‍💼" },
  { id: "networkers", label: "Networkers", icono: "👥" },
  { id: "tarjetas", label: "Tarjetas Digitales", icono: "💳" },
  { id: "esferas", label: "Esferas", icono: "🧭" },
  { id: "referencias", label: "Referencias", icono: "🔗" },
  { id: "gpnc", label: "GPNC", icono: "🤝" },
  { id: "unoauno", label: "Uno a Uno", icono: "☕" },
  { id: "visitantes", label: "Visitantes", icono: "🚪" },
  { id: "invitados", label: "Invitados", icono: "🎯" },
  { id: "calendario", label: "Calendario", icono: "📅" },
  { id: "capacitacion", label: "Capacitación", icono: "🎓" },
  { id: "recursos", label: "Recursos", icono: "📚" },
  { id: "asistencia", label: "Asistencia", icono: "✅" },
  { id: "mensajes", label: "Mensajes", icono: "📨" },
  { id: "metas", label: "Metas", icono: "🎯", proximamente: true },
  { id: "reportes", label: "Reportes", icono: "📈", proximamente: true },
  { id: "configuracion", label: "Configuración", icono: "⚙️" }
];

const NOMBRES_MODULO = {
  dashboard: "Dashboard", networkers: "Networkers", tarjetas: "Tarjetas Digitales", esferas: "Esferas",
  referencias: "Referencias", gpnc: "GPNC", unoauno: "Uno a Uno", visitantes: "Visitantes", invitados: "Invitados",
  calendario: "Calendario", capacitacion: "Capacitación", recursos: "Recursos", asistencia: "Asistencia",
  mensajes: "Mensajes", metas: "Metas", rankings: "Rankings", reportes: "Reportes"
};

// El módulo "capitulos" se controla aparte (soloSuperAdmin); para el resto,
// el menú solo muestra lo que /api/permisos/mis-permisos diga que puede
// "ver" -- ni el rol, ni el capítulo, ni un override por usuario lo tienen
// bloqueado. Así el menú nunca muestra algo a lo que la URL respondería 403.
function puedeVer(moduloKey) {
  return (misPermisos[moduloKey] || []).includes("ver");
}
function puede(moduloKey, accion) {
  return (misPermisos[moduloKey] || []).includes(accion);
}

// ---------- utilidades ----------
function esSuperAdmin() {
  return usuarioActual && (usuarioActual.rol === "admin" || usuarioActual.rol === "superadmin");
}

async function api(path, opciones = {}) {
  const r = await fetch(path, {
    ...opciones,
    headers: { "Content-Type": "application/json", ...(opciones.headers || {}) }
  });
  let data = null;
  try { data = await r.json(); } catch { /* respuesta sin cuerpo */ }
  return { ok: r.ok, status: r.status, data: data || {} };
}

function conCapitulo(path) {
  if (!capituloIdActivo) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}capituloId=${capituloIdActivo}`;
}

function escapeHtml(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatFecha(valor) {
  if (!valor) return "—";
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-GT", { day: "2-digit", month: "short", year: "numeric" });
}

function formatMonto(valor, moneda = "GTQ") {
  const n = Number(valor) || 0;
  return `${moneda} ${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pill(texto, claseExtra) {
  return `<span class="pill pill-${claseExtra}">${escapeHtml(texto)}</span>`;
}

// La librería de QR se carga desde un CDN externo en el <head>; en una red
// lenta puede no estar lista todavía cuando se abre Mi Perfil. Reintenta
// una vez antes de rendirse (mismo patrón que la PWA móvil).
let qrCodePromise = null;
function asegurarQRCode() {
  if (window.QRCode) return Promise.resolve(true);
  if (!qrCodePromise) {
    qrCodePromise = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }
  return qrCodePromise;
}

// ---------- panel lateral genérico ----------
function asegurarPanelDom() {
  if (document.getElementById("panel-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "panel-overlay";
  overlay.className = "panel-overlay";
  const panel = document.createElement("div");
  panel.id = "panel-lateral";
  panel.className = "panel-lateral";
  document.body.append(overlay, panel);
  overlay.addEventListener("click", cerrarPanel);
}

function abrirPanel(titulo, html) {
  asegurarPanelDom();
  document.getElementById("panel-lateral").innerHTML =
    `<div class="panel-titulo">${escapeHtml(titulo)}</div>${html}`;
  document.getElementById("panel-overlay").classList.add("visible");
  document.getElementById("panel-lateral").classList.add("abierto");
}

function cerrarPanel() {
  const overlay = document.getElementById("panel-overlay");
  const panel = document.getElementById("panel-lateral");
  if (overlay) overlay.classList.remove("visible");
  if (panel) panel.classList.remove("abierto");
}

// ---------- arranque ----------
async function iniciar() {
  const { ok, data } = await api("/api/auth/yo");
  if (!ok) {
    mostrarLogin();
    return;
  }
  usuarioActual = data;
  await mostrarApp();
}

function mostrarLogin() {
  document.getElementById("pantalla-login").style.display = "flex";
  document.getElementById("app").style.display = "none";
  renderCuentasDemo();
}

// Cuentas reales del capítulo de demostración "EJEMPLO" (datos ficticios,
// no son networkers reales). Viven en la base como cualquier otra cuenta;
// esta lista solo las muestra para que cualquiera pueda entrar a probar
// el sistema sin tener que pedirle credenciales a alguien.
const CUENTAS_DEMO = [
  { nombre: "Ejemplo Admin EJEMPLO", rol: "Administrador de capítulo", telefono: "90000001", dpi: "1111111111111" },
  { nombre: "Carlos Méndez", rol: "Networker · Construcción", telefono: "90000002", dpi: "2222222222222" },
  { nombre: "Ana López", rol: "Networker · Legal", telefono: "90000003", dpi: "3333333333333" },
  { nombre: "Roberto Díaz", rol: "Networker · Finanzas", telefono: "90000004", dpi: "4444444444444" },
  { nombre: "María Fernández", rol: "Networker · Marketing", telefono: "90000005", dpi: "5555555555555" },
  { nombre: "Jorge Ramírez", rol: "Networker · Tecnología", telefono: "90000006", dpi: "6666666666666" },
  { nombre: "Lucía Morales", rol: "Networker · Inmobiliaria", telefono: "90000007", dpi: "7777777777777" }
];

function renderCuentasDemo() {
  const cont = document.getElementById("demo-lista");
  cont.innerHTML = CUENTAS_DEMO.map((c, i) => `
    <div class="demo-fila">
      <div class="demo-info">
        <div class="demo-nombre">${escapeHtml(c.nombre)}</div>
        <div class="demo-rol">${escapeHtml(c.rol)}</div>
        <div class="demo-credenciales">Tel: ${c.telefono} · DPI: ${c.dpi}</div>
      </div>
      <div class="demo-botones">
        <button type="button" class="btn-demo" data-i="${i}" data-accion="copiar">Copiar</button>
        <button type="button" class="btn-demo" data-i="${i}" data-accion="usar">Usar</button>
      </div>
    </div>`).join("");

  cont.querySelectorAll(".btn-demo").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const cuenta = CUENTAS_DEMO[Number(btn.dataset.i)];
      if (btn.dataset.accion === "copiar") {
        await navigator.clipboard.writeText(`Teléfono: ${cuenta.telefono}\nDPI: ${cuenta.dpi}`);
        const original = btn.textContent;
        btn.textContent = "✅ Copiado";
        setTimeout(() => { btn.textContent = original; }, 1500);
      } else {
        document.getElementById("login-telefono").value = cuenta.telefono;
        document.getElementById("login-dpi").value = cuenta.dpi;
      }
    });
  });
}

document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const telefono = document.getElementById("login-telefono").value.trim();
  const dpi = document.getElementById("login-dpi").value.trim();
  const msg = document.getElementById("login-mensaje");
  msg.textContent = "";
  const { ok, data } = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ telefono, dpi }) });
  if (!ok) {
    msg.textContent = data.error || "No se pudo iniciar sesión.";
    return;
  }
  usuarioActual = data;
  await mostrarApp();
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  location.reload();
});

document.getElementById("btn-salir-ver-como").addEventListener("click", async () => {
  await api("/api/auth/salir-ver-como", { method: "POST" });
  location.reload();
});

document.getElementById("btn-modo-networker").addEventListener("click", async () => {
  modoNetworkerActivo = !modoNetworkerActivo;
  localStorage.setItem(`modoNetworker_${usuarioActual.telefono}`, String(modoNetworkerActivo));

  // Al activarlo, se cambia a SU PROPIO capítulo (si ya lo tiene asignado
  // en Mi Perfil) -- si no, se queda en el que tenía seleccionado como
  // administrador, para no dejarlo sin nada que ver.
  if (modoNetworkerActivo) {
    const { ok, data } = await api("/api/mi-perfil");
    if (ok && data.capituloId) {
      capituloIdActivo = data.capituloId;
      capituloNombreActivo = data.capituloNombre || "";
    }
  }

  renderModoNetworkerBoton();
  renderTopbarCapitulo();
  renderSidebar();
  renderBottomNav();
  vistaActiva = "dashboard";
  await renderVista();
});

// ---------- Menú lateral en celular (drawer) ----------
function abrirSidebarMovil() {
  document.getElementById("sidebar").classList.add("abierto");
  document.getElementById("sidebar-overlay").classList.add("visible");
}
function cerrarSidebarMovil() {
  document.getElementById("sidebar").classList.remove("abierto");
  document.getElementById("sidebar-overlay").classList.remove("visible");
}
document.getElementById("btn-hamburguesa").addEventListener("click", abrirSidebarMovil);
document.getElementById("sidebar-overlay").addEventListener("click", cerrarSidebarMovil);

async function cargarMisPermisos() {
  const { ok, data } = await api("/api/permisos/mis-permisos");
  misPermisos = ok && data.permisos ? data.permisos : {};
}

async function mostrarApp() {
  document.getElementById("pantalla-login").style.display = "none";
  document.getElementById("app").style.display = "flex";
  document.getElementById("topbar-nombre").textContent = usuarioActual.nombre;
  document.getElementById("topbar-rol").textContent = usuarioActual.rol;
  document.getElementById("banner-ver-como").style.display = usuarioActual.viendoComo ? "flex" : "none";

  await cargarMisPermisos();

  if (esSuperAdmin()) {
    const { ok, data } = await api("/api/capitulos");
    capitulosDisponibles = ok && Array.isArray(data) ? data : [];
    capituloIdActivo = capitulosDisponibles[0]?._id || null;
    capituloNombreActivo = capitulosDisponibles[0]?.nombre || "Sin capítulos";
  } else {
    capituloIdActivo = usuarioActual.capituloId;
    if (capituloIdActivo) {
      const { ok, data } = await api(`/api/capitulos/${capituloIdActivo}`);
      capituloNombreActivo = ok ? data.nombre : "Capítulo";
    } else {
      capituloNombreActivo = "Sin capítulo asignado";
    }
  }

  modoNetworkerActivo = localStorage.getItem(`modoNetworker_${usuarioActual.telefono}`) === "true";
  renderModoNetworkerBoton();
  renderTopbarCapitulo();
  renderSidebar();
  renderBottomNav();
  await renderVista();

  if (!localStorage.getItem(`tourCompletado_${usuarioActual.telefono}`)) {
    setTimeout(() => iniciarTour(), 600);
  }
}

function renderTopbarCapitulo() {
  const cont = document.getElementById("topbar-capitulo");
  if (esSuperAdmin() && capitulosDisponibles.length > 0) {
    cont.innerHTML = `<select id="selector-capitulo" style="font-weight:700;border:none;background:transparent;font-size:15px;">
      ${capitulosDisponibles.map((c) => `<option value="${c._id}" ${c._id === capituloIdActivo ? "selected" : ""}>${escapeHtml(c.nombre)}</option>`).join("")}
    </select>`;
    document.getElementById("selector-capitulo").addEventListener("change", async (e) => {
      capituloIdActivo = e.target.value;
      capituloNombreActivo = capitulosDisponibles.find((c) => c._id === capituloIdActivo)?.nombre || "";
      await renderVista();
    });
  } else {
    cont.textContent = capituloNombreActivo;
  }
}

function renderModoNetworkerBoton() {
  const btn = document.getElementById("btn-modo-networker");
  if (!esSuperAdmin()) { btn.style.display = "none"; return; }
  btn.style.display = "block";
  btn.textContent = modoNetworkerActivo ? "🔄 Ver como administrador" : "🔄 Ver como networker";
}

function renderSidebar() {
  const nav = document.getElementById("sidebar-nav");
  nav.innerHTML = SECCIONES.filter((s) =>
    (!s.soloSuperAdmin || esSuperAdmin()) &&
    (!s.soloNetworker || usuarioActual.rol === "networker" || esSuperAdmin()) &&
    (s.proximamente || s.soloNetworker || puedeVer(s.id)) &&
    !(modoNetworkerActivo && MODULOS_OCULTOS_EN_MODO_NETWORKER.includes(s.id))
  )
    .map((s) => {
      const claseExtra = s.proximamente ? "proximamente" : (s.id === vistaActiva ? "activo" : "");
      return `<div class="sidebar-item ${claseExtra}" data-vista="${s.id}" title="${s.proximamente ? "Próximamente" : ""}">
        <span>${s.icono}</span><span>${s.label}</span>
      </div>`;
    })
    .join("");
  nav.querySelectorAll(".sidebar-item:not(.proximamente)").forEach((el) => {
    el.addEventListener("click", async () => {
      vistaActiva = el.dataset.vista;
      cerrarSidebarMovil();
      renderSidebar();
      renderBottomNav();
      await renderVista();
    });
  });
}

// Subconjunto de SECCIONES para la barra inferior en celular -- los
// accesos de uso más frecuente día a día. "Más" abre el menú lateral
// completo como un drawer en vez de navegar a una vista.
const SECCIONES_BOTTOM_NAV = ["dashboard", "networkers", "gpnc", "visitantes"];

function renderBottomNav() {
  const nav = document.getElementById("bottom-nav");
  const items = SECCIONES.filter((s) => SECCIONES_BOTTOM_NAV.includes(s.id) && puedeVer(s.id));
  nav.innerHTML = items
    .map((s) => `<button type="button" class="bottom-nav-item ${s.id === vistaActiva ? "activo" : ""}" data-vista="${s.id}">
      <span class="icono">${s.icono}</span><span>${s.label.split(" ")[0]}</span>
    </button>`)
    .join("") + `<button type="button" class="bottom-nav-item" id="btn-bottom-mas"><span class="icono">☰</span><span>Más</span></button>`;

  nav.querySelectorAll(".bottom-nav-item[data-vista]").forEach((el) => {
    el.addEventListener("click", async () => {
      vistaActiva = el.dataset.vista;
      renderSidebar();
      renderBottomNav();
      await renderVista();
    });
  });
  document.getElementById("btn-bottom-mas").addEventListener("click", abrirSidebarMovil);
}

async function renderVista() {
  cerrarPanel();
  const cont = document.getElementById("contenido");
  cont.innerHTML = "";
  if (!capituloIdActivo && vistaActiva !== "capitulos" && vistaActiva !== "usuarios") {
    cont.innerHTML = `<div class="estado-vacio"><div class="icono">🏷️</div>No hay un capítulo activo. ${esSuperAdmin() ? "Crea uno en la sección Capítulos." : "Contacta a tu administrador."}</div>`;
    return;
  }
  const renderers = {
    dashboard: renderDashboard,
    capitulos: renderCapitulos,
    usuarios: renderUsuarios,
    networkers: renderNetworkers,
    tarjetas: renderTarjetas,
    esferas: renderEsferas,
    visitantes: renderVisitantes,
    invitados: renderInvitados,
    gpnc: renderGpnc,
    unoauno: renderUnoAUno,
    referencias: renderReferencias,
    calendario: renderCalendario,
    capacitacion: renderCapacitacion,
    recursos: renderRecursos,
    asistencia: renderAsistencia,
    configuracion: renderConfiguracion,
    mensajes: renderMensajes,
    "mi-perfil": renderMiPerfil
  };
  const fn = renderers[vistaActiva] || renderDashboard;
  await fn(cont);
}

// ---------- Dashboard ----------
async function renderDashboard(cont) {
  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">Dashboard</div><div class="vista-sub">Resumen general de ${escapeHtml(capituloNombreActivo)}</div></div></div><div id="dash-cont">Cargando…</div>`;
  const { ok, data } = await api(conCapitulo("/api/dashboard/resumen"));
  const zona = document.getElementById("dash-cont");
  if (!ok) {
    zona.innerHTML = `<div class="estado-vacio">${escapeHtml(data.error || "No se pudo cargar el dashboard.")}</div>`;
    return;
  }
  const ranking = data.rankingMiembros || [];
  zona.innerHTML = `
    <div class="metrica-grid">
      <section class="metrica-estrella">
        <div class="lbl">GPNC total del capítulo</div>
        <div class="num">${formatMonto(data.totalGpnc)}</div>
        <div class="delta">${data.cantidadGpnc} negocios concretados · ${formatMonto(data.gpncDelMes)} este mes</div>
      </section>
      <section class="metrica-stack">
        <div class="metrica-fila"><span class="lbl">Networkers</span><span class="val">${data.totalNetworkers}</span></div>
        <div class="metrica-fila"><span class="lbl">Visitantes totales</span><span class="val">${data.totalVisitantes}</span></div>
        <div class="metrica-fila"><span class="lbl">Visitantes este mes</span><span class="val">${data.visitantesDelMes}</span></div>
        <div class="metrica-fila"><span class="lbl">1 a 1 realizados</span><span class="val">${data.totalUnoAUno}</span></div>
      </section>

      <div class="bloque-secundario">
        <h3>Cobertura de esferas (${data.esferasTotal - data.esferasSinCubrir.length}/${data.esferasTotal})</h3>
        <div class="etiquetas-faltantes">
          ${data.esferasSinCubrir.length === 0 ? '<span class="etiqueta-ok">Todas las esferas cubiertas</span>' : data.esferasSinCubrir.map((e) => `<span class="etiqueta-falta">Falta: ${escapeHtml(e)}</span>`).join("")}
        </div>
      </div>

      <div class="bloque-secundario">
        <h3>Ranking de miembros</h3>
        ${ranking.length === 0 ? '<p class="vista-sub">Todavía no hay actividad registrada.</p>' :
          `<ul class="ranking-lista">${ranking.map((r, i) => `<li><span><span class="ranking-pos">${i + 1}</span>${escapeHtml(r.nombre || r.telefono)}</span><span class="ranking-puntaje">${r.puntaje} pts</span></li>`).join("")}</ul>`}
      </div>
    </div>`;
}

// ---------- Capítulos (superadmin) ----------
async function renderCapitulos(cont) {
  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">Capítulos</div><div class="vista-sub">Capítulos BNI dados de alta en la plataforma</div></div>
    <button class="btn-primario" id="btn-nuevo-capitulo">+ Nuevo capítulo</button></div>
    <div class="tabla-wrap"><table class="tabla-crm"><thead><tr><th>Nombre</th><th>País</th><th>Ciudad</th><th>Estado</th></tr></thead><tbody id="tabla-capitulos"></tbody></table></div>`;

  document.getElementById("btn-nuevo-capitulo").addEventListener("click", () => abrirFormCapitulo(null));

  const { ok, data } = await api("/api/capitulos");
  const tbody = document.getElementById("tabla-capitulos");
  if (!ok || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="estado-vacio">Todavía no hay capítulos. Crea el primero.</td></tr>`;
    return;
  }
  capitulosDisponibles = data;
  tbody.innerHTML = data.map((c) => `
    <tr data-id="${c._id}" style="cursor:pointer;">
      <td><strong>${escapeHtml(c.nombre)}</strong></td>
      <td>${escapeHtml(c.pais)}</td>
      <td>${escapeHtml(c.ciudad)}</td>
      <td>${pill(c.estado, c.estado === "activo" ? "activo" : c.estado === "pausado" ? "suspendido" : "invitado")}</td>
    </tr>`).join("");
  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => abrirFormCapitulo(data.find((c) => c._id === tr.dataset.id)));
  });
}

function abrirFormCapitulo(capitulo) {
  const esEdicion = Boolean(capitulo);
  abrirPanel(esEdicion ? "Editar capítulo" : "Nuevo capítulo", `
    <div class="campo"><label>Nombre</label><input id="cap-nombre" value="${escapeHtml(capitulo?.nombre || "")}"></div>
    <div class="campo-fila">
      <div class="campo"><label>País</label><input id="cap-pais" value="${escapeHtml(capitulo?.pais || "Guatemala")}"></div>
      <div class="campo"><label>Ciudad</label><input id="cap-ciudad" value="${escapeHtml(capitulo?.ciudad || "")}"></div>
    </div>
    <div class="campo"><label>Estado</label>
      <select id="cap-estado">
        ${["pre-lanzamiento", "activo", "pausado"].map((e) => `<option value="${e}" ${capitulo?.estado === e ? "selected" : ""}>${e}</option>`).join("")}
      </select>
    </div>
    <div class="campo"><label>Fecha de lanzamiento</label><input type="date" id="cap-fecha" value="${capitulo?.fechaLanzamiento ? new Date(capitulo.fechaLanzamiento).toISOString().slice(0, 10) : ""}"></div>
    <div class="panel-acciones">
      <button class="btn-primario" id="btn-guardar-capitulo">Guardar</button>
      <button class="btn-secundario" id="btn-cancelar-panel">Cancelar</button>
    </div>
    <p class="form-mensaje" id="form-cap-mensaje"></p>
  `);
  document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);
  document.getElementById("btn-guardar-capitulo").addEventListener("click", async () => {
    const cuerpo = {
      nombre: document.getElementById("cap-nombre").value.trim(),
      pais: document.getElementById("cap-pais").value.trim(),
      ciudad: document.getElementById("cap-ciudad").value.trim(),
      estado: document.getElementById("cap-estado").value,
      fechaLanzamiento: document.getElementById("cap-fecha").value || null
    };
    const msg = document.getElementById("form-cap-mensaje");
    const ruta = esEdicion ? `/api/capitulos/${capitulo._id}` : "/api/capitulos";
    const { ok, data } = await api(ruta, { method: esEdicion ? "PUT" : "POST", body: JSON.stringify(cuerpo) });
    if (!ok) { msg.className = "form-mensaje error"; msg.textContent = data.error || "No se pudo guardar."; return; }
    cerrarPanel();
    await renderVista();
  });
}

// ---------- Usuarios del sistema ----------
// "networker" en este contexto es solo un atajo hacia la pantalla
// Networkers (que ya administra los campos de membresía BNI); aquí el
// foco es el rol y el acceso, no el perfil BNI completo.
const ETIQUETA_ROL = {
  superadmin: "Super Admin", admin: "Super Admin", admin_capitulo: "Administrador de capítulo",
  networker: "Networker", invitado_especial: "Invitado especial", visitante: "Visitante"
};

let viendoUsuariosSistema = false;
let opcionesRolesCache = [];

async function renderUsuarios(cont) {
  const puedeCrear = puede("usuarios", "crear");
  const mostrarToggleSistema = esSuperAdmin();

  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">Usuarios</div><div class="vista-sub">Cuentas con acceso al sistema y sus roles</div></div>
    ${puedeCrear ? '<button class="btn-primario" id="btn-nuevo-usuario">+ Nuevo usuario</button>' : ""}</div>
    ${mostrarToggleSistema ? `<div class="barra-busqueda" style="margin-bottom:14px;">
      <button class="btn-secundario" id="btn-toggle-usuarios" style="flex:none;">
        ${viendoUsuariosSistema ? "Ver usuarios del capítulo actual" : "Ver usuarios del sistema (sin capítulo)"}
      </button>
    </div>` : ""}
    <div class="tabla-wrap"><table class="tabla-crm"><thead><tr><th>Nombre</th><th>Teléfono</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody id="tabla-usuarios">Cargando…</tbody></table></div>`;

  if (puedeCrear) document.getElementById("btn-nuevo-usuario").addEventListener("click", () => abrirFormUsuario(null));
  if (mostrarToggleSistema) {
    document.getElementById("btn-toggle-usuarios").addEventListener("click", async () => {
      viendoUsuariosSistema = !viendoUsuariosSistema;
      await renderVista();
    });
  }

  const ruta = viendoUsuariosSistema && esSuperAdmin() ? "/api/usuarios-sistema?sistema=true" : conCapitulo("/api/usuarios-sistema");
  const { ok, data } = await api(ruta);
  const tbody = document.getElementById("tabla-usuarios");
  if (!ok) { tbody.innerHTML = `<tr><td colspan="5" class="estado-vacio">${escapeHtml(data.error || "No se pudo cargar.")}</td></tr>`; return; }
  if (data.length === 0) { tbody.innerHTML = `<tr><td colspan="5" class="estado-vacio">No hay usuarios para mostrar.</td></tr>`; return; }

  tbody.innerHTML = data.map((u) => `
    <tr data-telefono="${u.telefono}">
      <td style="cursor:pointer;"><strong>${escapeHtml(u.nombre)}</strong></td>
      <td>${escapeHtml(u.telefono)}</td>
      <td>${pill(ETIQUETA_ROL[u.rol] || u.rol, u.rol === "admin_capitulo" || esRolDeSistema(u.rol) ? "activo" : "invitado")}</td>
      <td>${u.estado === "suspendido" ? pill("suspendido", "suspendido") : pill("activo", "activo")}</td>
      <td style="text-align:right;">
        ${esRolDeSistema(u.rol) ? "" : `<button class="btn-secundario btn-permisos-usuario" style="padding:6px 12px;font-size:12px;">Permisos</button>`}
        ${puede("usuarios", "editar") ? `<button class="btn-secundario btn-password-usuario" style="padding:6px 12px;font-size:12px;">🔑 Contraseña</button>` : ""}
        ${(esSuperAdmin() || usuarioActual.rol === "admin_capitulo") && u.rol === "networker" ? `<button class="btn-secundario btn-vercomo-usuario" style="padding:6px 12px;font-size:12px;">👁️ Ver como</button>` : ""}
        ${puede("usuarios", "activar") ? `<button class="btn-secundario btn-toggle-estado-usuario" data-estado="${u.estado || "activo"}" style="padding:6px 12px;font-size:12px;">${u.estado === "suspendido" ? "Reactivar" : "Suspender"}</button>` : ""}
      </td>
    </tr>`).join("");

  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.querySelector("td").addEventListener("click", () => abrirFormUsuario(data.find((u) => u.telefono === tr.dataset.telefono)));
    const btnEstado = tr.querySelector(".btn-toggle-estado-usuario");
    if (btnEstado) {
      btnEstado.addEventListener("click", async (e) => {
        e.stopPropagation();
        const nuevoEstado = btnEstado.dataset.estado === "suspendido" ? "activo" : "suspendido";
        const { ok: okEstado, data: dataEstado } = await api(`/api/usuarios-sistema/${tr.dataset.telefono}/estado`, {
          method: "PATCH", body: JSON.stringify({ estado: nuevoEstado })
        });
        if (!okEstado) { alert(dataEstado.error || "No se pudo actualizar."); return; }
        await renderVista();
      });
    }
    const btnPassword = tr.querySelector(".btn-password-usuario");
    if (btnPassword) {
      btnPassword.addEventListener("click", (e) => {
        e.stopPropagation();
        abrirRestablecerPassword(data.find((x) => x.telefono === tr.dataset.telefono));
      });
    }
    const btnVerComo = tr.querySelector(".btn-vercomo-usuario");
    if (btnVerComo) {
      btnVerComo.addEventListener("click", async (e) => {
        e.stopPropagation();
        const u = data.find((x) => x.telefono === tr.dataset.telefono);
        if (!confirm(`Vas a entrar como ${u.nombre}. Para volver a tu cuenta usa el botón "Volver a mi cuenta" que aparecerá arriba. ¿Continuar?`)) return;
        const { ok, data: dataVerComo } = await api(`/api/usuarios-sistema/${u.telefono}/ver-como`, { method: "POST" });
        if (!ok) { alert(dataVerComo.error || "No se pudo cambiar de sesión."); return; }
        location.reload();
      });
    }
    const btnPermisos = tr.querySelector(".btn-permisos-usuario");
    if (btnPermisos) {
      btnPermisos.addEventListener("click", (e) => {
        e.stopPropagation();
        const u = data.find((x) => x.telefono === tr.dataset.telefono);
        abrirPermisosUsuario(u);
      });
    }
  });
}

function generarPasswordAleatoria() {
  return String(Math.floor(10000000 + Math.random() * 89999999));
}

function abrirRestablecerPassword(usuario) {
  abrirPanel(`Restablecer contraseña de ${usuario.nombre}`, `
    <p class="vista-sub" style="margin-bottom:16px;">No es posible ver la contraseña actual (se guarda de forma irreversible, igual que en cualquier sistema serio). Esto fija una nueva.</p>
    <div class="campo">
      <label>Nueva contraseña (DPI, mínimo 8 dígitos)</label>
      <input id="pw-nueva" inputmode="numeric">
    </div>
    <button type="button" class="btn-secundario" id="btn-generar-password" style="margin-bottom:16px;">🎲 Generar automáticamente</button>
    <div class="panel-acciones">
      <button class="btn-primario" id="btn-guardar-password">Guardar nueva contraseña</button>
      <button class="btn-secundario" id="btn-cancelar-panel">Cancelar</button>
    </div>
    <p class="form-mensaje" id="form-pw-mensaje"></p>
  `);
  document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);
  document.getElementById("btn-generar-password").addEventListener("click", () => {
    document.getElementById("pw-nueva").value = generarPasswordAleatoria();
  });
  document.getElementById("btn-guardar-password").addEventListener("click", async () => {
    const nuevaContrasena = document.getElementById("pw-nueva").value.trim();
    const msg = document.getElementById("form-pw-mensaje");
    if (nuevaContrasena.length < 8) { msg.className = "form-mensaje error"; msg.textContent = "Debe tener al menos 8 dígitos."; return; }
    const { ok, data } = await api(`/api/usuarios-sistema/${usuario.telefono}/password`, {
      method: "PATCH", body: JSON.stringify({ nuevaContrasena })
    });
    if (!ok) { msg.className = "form-mensaje error"; msg.textContent = data.error || "No se pudo restablecer."; return; }
    msg.className = "form-mensaje ok";
    msg.textContent = `Contraseña actualizada. Comunícale a ${usuario.nombre}: teléfono ${usuario.telefono}, contraseña ${nuevaContrasena}.`;
  });
}

const ETIQUETA_ACCION = { ver: "Ver", crear: "Crear", editar: "Editar", eliminar: "Eliminar", exportar: "Exportar", activar: "Activar" };

async function abrirPermisosUsuario(usuario) {
  abrirPanel(`Permisos de ${usuario.nombre}`, `<p class="vista-sub" style="margin-bottom:16px;">Desmarca una acción para quitársela solo a esta persona (nunca le da más de lo que su rol ya permite).</p>
    <div id="lista-permisos-usuario">Cargando…</div>
    <div class="panel-acciones">
      <button class="btn-primario" id="btn-guardar-permisos-usuario">Guardar cambios</button>
      <button class="btn-secundario" id="btn-cancelar-panel">Cancelar</button>
    </div>
    <p class="form-mensaje" id="form-permisos-mensaje"></p>`);
  document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);

  const { ok, data } = await api(`/api/usuarios/${usuario.telefono}/permisos`);
  const cont = document.getElementById("lista-permisos-usuario");
  if (!ok) { cont.innerHTML = `<p class="form-mensaje error">${escapeHtml(data.error || "No se pudo cargar.")}</p>`; return; }
  if (data.length === 0) { cont.innerHTML = `<p class="vista-sub">Este rol no tiene módulos para administrar.</p>`; return; }

  cont.innerHTML = data.map((m) => `
    <div class="campo" data-modulo="${m.moduloKey}">
      <label>${escapeHtml(NOMBRES_MODULO[m.moduloKey] || m.moduloKey)}</label>
      <div style="display:flex;gap:14px;flex-wrap:wrap;">
        ${m.accionesDisponibles.map((a) => `<label class="campo-checkbox"><input type="checkbox" value="${a}" ${m.accionesActuales.includes(a) ? "checked" : ""}> ${ETIQUETA_ACCION[a] || a}</label>`).join("")}
      </div>
    </div>`).join("");

  document.getElementById("btn-guardar-permisos-usuario").addEventListener("click", async () => {
    const msg = document.getElementById("form-permisos-mensaje");
    const bloques = cont.querySelectorAll("[data-modulo]");
    for (const bloque of bloques) {
      const moduloKey = bloque.dataset.modulo;
      const acciones = [...bloque.querySelectorAll("input[type=checkbox]:checked")].map((i) => i.value);
      const { ok: okGuardar, data: dataGuardar } = await api(`/api/usuarios/${usuario.telefono}/permisos`, {
        method: "PUT", body: JSON.stringify({ capituloId: usuario.capituloId || capituloIdActivo, moduloKey, acciones })
      });
      if (!okGuardar) { msg.className = "form-mensaje error"; msg.textContent = dataGuardar.error || "No se pudo guardar."; return; }
    }
    cerrarPanel();
  });
}

function esRolDeSistema(rol) {
  return rol === "admin" || rol === "superadmin";
}

async function abrirFormUsuario(usuario) {
  const esEdicion = Boolean(usuario);
  if (opcionesRolesCache.length === 0) {
    const { ok, data } = await api("/api/usuarios-sistema/opciones-roles");
    opcionesRolesCache = ok && Array.isArray(data) ? data : [];
  }

  abrirPanel(esEdicion ? "Editar usuario" : "Nuevo usuario", `
    <div class="campo"><label>Teléfono</label><input id="us-telefono" value="${escapeHtml(usuario?.telefono || "")}" ${esEdicion ? "disabled" : ""}></div>
    <div class="campo"><label>Nombre</label><input id="us-nombre" value="${escapeHtml(usuario?.nombre || "")}"></div>
    <div class="campo"><label>Rol</label>
      <select id="us-rol">${opcionesRolesCache.map((o) => `<option value="${o.rol}" ${usuario?.rol === o.rol ? "selected" : ""}>${escapeHtml(ETIQUETA_ROL[o.rol] || o.rol)}</option>`).join("")}</select>
    </div>
    ${esSuperAdmin() ? `<div class="campo" id="campo-capitulo-usuario"><label>Capítulo</label>
      <select id="us-capitulo">${capitulosDisponibles.map((c) => `<option value="${c._id}" ${(usuario?.capituloId || capituloIdActivo) === c._id ? "selected" : ""}>${escapeHtml(c.nombre)}</option>`).join("")}</select>
    </div>` : ""}
    <div class="campo">
      <label>Este rol vera:</label>
      <div class="etiquetas-faltantes" id="us-preview-modulos"></div>
    </div>
    <div class="panel-acciones">
      <button class="btn-primario" id="btn-guardar-usuario">Guardar</button>
      <button class="btn-secundario" id="btn-cancelar-panel">Cancelar</button>
    </div>
    ${!esEdicion ? '<p class="form-mensaje">Si el teléfono no tiene cuenta todavía, la persona la activará registrándose en la app con este mismo número.</p>' : ""}
    <p class="form-mensaje" id="form-us-mensaje"></p>
  `);

  const actualizarPreview = () => {
    const rolElegido = document.getElementById("us-rol").value;
    const modulos = opcionesRolesCache.find((o) => o.rol === rolElegido)?.modulos || [];
    document.getElementById("us-preview-modulos").innerHTML = modulos.length === 0
      ? '<span class="etiqueta-ok">Sin módulos visibles</span>'
      : modulos.map((m) => `<span class="etiqueta-ok">${escapeHtml(NOMBRES_MODULO[m] || m)}</span>`).join("");
    const campoCapitulo = document.getElementById("campo-capitulo-usuario");
    if (campoCapitulo) campoCapitulo.style.display = (rolElegido === "admin" || rolElegido === "superadmin") ? "none" : "block";
  };
  document.getElementById("us-rol").addEventListener("change", actualizarPreview);
  actualizarPreview();

  document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);
  document.getElementById("btn-guardar-usuario").addEventListener("click", async () => {
    const telefono = document.getElementById("us-telefono").value.trim();
    const rol = document.getElementById("us-rol").value;
    const cuerpo = {
      nombre: document.getElementById("us-nombre").value.trim(),
      rol,
      capituloId: document.getElementById("us-capitulo")?.value || capituloIdActivo
    };
    const msg = document.getElementById("form-us-mensaje");
    if (!telefono) { msg.className = "form-mensaje error"; msg.textContent = "El teléfono es obligatorio."; return; }
    const { ok, data } = await api(`/api/usuarios-sistema/${telefono}`, { method: "PUT", body: JSON.stringify(cuerpo) });
    if (!ok) { msg.className = "form-mensaje error"; msg.textContent = data.error || "No se pudo guardar."; return; }
    cerrarPanel();
    await renderVista();
  });
}

// ---------- Networkers ----------
async function cargarEsferasCache() {
  const { ok, data } = await api(conCapitulo("/api/esferas"));
  esferasCache = ok && Array.isArray(data) ? data : [];
}

function botonesRapidos(n) {
  const wa = n.whatsapp || n.telefono ? whatsappUrl(n.whatsapp || n.telefono) : null;
  const tel = n.telefono ? `tel:${n.telefono}` : null;
  const mail = n.correo ? `mailto:${n.correo}` : null;
  const tarjeta = n.tarjetaPublicaId ? `/t?id=${n.tarjetaPublicaId}` : null;
  const boton = (href, icono, titulo, extra = "") => href
    ? `<a class="btn-rapido" href="${href}" target="_blank" rel="noopener" title="${titulo}" ${extra}>${icono}</a>`
    : `<span class="btn-rapido deshabilitado" title="${titulo} (sin datos)">${icono}</span>`;
  return `<div class="acciones-rapidas">
    ${boton(wa, "💬", "WhatsApp")}
    ${boton(tel, "📞", "Llamar")}
    ${boton(mail, "✉️", "Correo")}
    ${boton(tarjeta, "💳", "Ver tarjeta")}
    <button type="button" class="btn-rapido btn-copiar-link" data-link="${location.origin}${tarjeta || ""}" title="Copiar link" ${tarjeta ? "" : "disabled"}>🔗</button>
  </div>`;
}

let networkersCache = [];

async function renderNetworkers(cont) {
  const puedeCrear = puede("networkers", "crear");
  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">Networkers</div><div class="vista-sub">Directorio de miembros del capítulo</div></div>
    <div style="display:flex;gap:10px;">
      <button class="btn-secundario" id="btn-link-directorio">🔗 Copiar link del directorio público</button>
      ${puedeCrear ? '<button class="btn-primario" id="btn-nuevo-networker">+ Agregar networker</button>' : ""}
    </div></div>
    <div class="barra-busqueda">
      <input type="text" id="nw-buscar" placeholder="Buscar por nombre, empresa o especialidad...">
      <select id="nw-filtro-esfera"><option value="">Todas las esferas</option></select>
    </div>
    <div class="tabla-wrap"><table class="tabla-crm"><thead><tr><th>Nombre</th><th>Empresa</th><th>Esfera</th><th>Estado</th><th>Teléfono</th><th>Acciones rápidas</th></tr></thead><tbody id="tabla-networkers"></tbody></table></div>`;

  document.getElementById("btn-link-directorio").addEventListener("click", async (e) => {
    await navigator.clipboard.writeText(`${location.origin}/directorio?capituloId=${capituloIdActivo}`);
    const btn = e.target;
    const original = btn.textContent;
    btn.textContent = "✅ Copiado";
    setTimeout(() => { btn.textContent = original; }, 1500);
  });

  await cargarEsferasCache();
  document.getElementById("nw-filtro-esfera").innerHTML =
    '<option value="">Todas las esferas</option>' + esferasCache.map((e) => `<option value="${e._id}">${escapeHtml(e.nombre)}</option>`).join("");

  if (puedeCrear) document.getElementById("btn-nuevo-networker").addEventListener("click", () => abrirFormNetworker(null));

  const { ok, data } = await api(conCapitulo("/api/networkers"));
  networkersCache = ok && Array.isArray(data) ? data : [];

  const pintar = () => {
    const texto = document.getElementById("nw-buscar").value.trim().toLowerCase();
    const esfera = document.getElementById("nw-filtro-esfera").value;
    const filtrados = networkersCache.filter((n) => {
      const coincideTexto = !texto || [n.nombre, n.empresa, n.especialidad].some((v) => (v || "").toLowerCase().includes(texto));
      const coincideEsfera = !esfera || n.esferaId === esfera;
      return coincideTexto && coincideEsfera;
    });
    pintarTablaNetworkers(filtrados);
  };

  document.getElementById("nw-buscar").addEventListener("input", pintar);
  document.getElementById("nw-filtro-esfera").addEventListener("change", pintar);
  pintar();
}

function pintarTablaNetworkers(data) {
  const tbody = document.getElementById("tabla-networkers");
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="estado-vacio">No se encontraron networkers con ese filtro.</td></tr>`;
    return;
  }
  const esferaNombre = (id) => esferasCache.find((e) => e._id === id)?.nombre || "—";
  tbody.innerHTML = data.map((n) => `
    <tr data-telefono="${n.telefono}">
      <td style="cursor:pointer;"><strong>${escapeHtml(n.nombre)}</strong></td>
      <td>${escapeHtml(n.empresa || "—")}</td>
      <td>${escapeHtml(esferaNombre(n.esferaId))}</td>
      <td>${pill(n.estadoNetworker || "prospecto", n.estadoNetworker || "prospecto")}</td>
      <td>${escapeHtml(n.telefono)}</td>
      <td>${botonesRapidos(n)}</td>
    </tr>`).join("");
  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.querySelector("td").addEventListener("click", () => abrirFormNetworker(networkersCache.find((n) => n.telefono === tr.dataset.telefono)));
    const btnCopiar = tr.querySelector(".btn-copiar-link");
    if (btnCopiar && !btnCopiar.disabled) {
      btnCopiar.addEventListener("click", async () => {
        await navigator.clipboard.writeText(btnCopiar.dataset.link);
        btnCopiar.textContent = "✅";
        setTimeout(() => { btnCopiar.textContent = "🔗"; }, 1500);
      });
    }
  });
}

function abrirFormNetworker(networker) {
  const esEdicion = Boolean(networker);
  abrirPanel(esEdicion ? "Editar networker" : "Agregar networker", `
    <div class="campo"><label>Teléfono</label><input id="nw-telefono" value="${escapeHtml(networker?.telefono || "")}" ${esEdicion ? "disabled" : ""}></div>
    <div class="campo"><label>Nombre</label><input id="nw-nombre" value="${escapeHtml(networker?.nombre || "")}"></div>
    <div class="campo-fila">
      <div class="campo"><label>Empresa</label><input id="nw-empresa" value="${escapeHtml(networker?.empresa || "")}"></div>
      <div class="campo"><label>Especialidad</label><input id="nw-especialidad" value="${escapeHtml(networker?.especialidad || "")}"></div>
    </div>
    <div class="campo-fila">
      <div class="campo"><label>Categoría BNI</label><input id="nw-categoria" value="${escapeHtml(networker?.categoriaBNI || "")}"></div>
      <div class="campo"><label>Esfera</label>
        <select id="nw-esfera"><option value="">—</option>${esferasCache.map((e) => `<option value="${e._id}" ${networker?.esferaId === e._id ? "selected" : ""}>${escapeHtml(e.nombre)}</option>`).join("")}</select>
      </div>
    </div>
    <div class="campo"><label>Estado de membresía</label>
      <select id="nw-estado">${["activo", "invitado", "suspendido", "prospecto"].map((e) => `<option value="${e}" ${networker?.estadoNetworker === e ? "selected" : ""}>${e}</option>`).join("")}</select>
    </div>
    <div class="campo-fila">
      <div class="campo"><label>Fecha de ingreso</label><input type="date" id="nw-ingreso" value="${networker?.fechaIngreso ? new Date(networker.fechaIngreso).toISOString().slice(0, 10) : ""}"></div>
      <div class="campo"><label>Fecha de renovación</label><input type="date" id="nw-renovacion" value="${networker?.fechaRenovacion ? new Date(networker.fechaRenovacion).toISOString().slice(0, 10) : ""}"></div>
    </div>
    ${esEdicion ? `
    <div class="campo">
      <label class="campo-checkbox"><input type="checkbox" id="nw-tarjeta-activa" ${networker?.tarjetaDigitalActiva === false ? "" : "checked"}> Tarjeta digital activa (su link público funciona)</label>
    </div>
    <div class="campo">
      <label>Tarjeta digital pública</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        ${networker?.slug ? `<a href="/card/${networker.slug}" target="_blank" rel="noopener" class="btn-secundario" style="text-decoration:none;padding:8px 14px;font-size:13px;">Ver tarjeta →</a>` : '<span class="vista-sub">Se genera automáticamente al guardar.</span>'}
        <button type="button" class="btn-secundario" id="btn-regenerar-slug" style="padding:8px 14px;font-size:13px;">🔁 Regenerar código (cambia el link)</button>
      </div>
    </div>` : ""}
    <div class="panel-acciones">
      <button class="btn-primario" id="btn-guardar-networker">Guardar</button>
      <button class="btn-secundario" id="btn-cancelar-panel">Cancelar</button>
    </div>
    ${!esEdicion ? '<p class="form-mensaje">Si el teléfono no tiene cuenta todavía, podrá activarla luego registrándose en la app con este mismo número.</p>' : ""}
    <p class="form-mensaje" id="form-nw-mensaje"></p>
  `);
  document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);

  const btnRegenerar = document.getElementById("btn-regenerar-slug");
  if (btnRegenerar) {
    btnRegenerar.addEventListener("click", async () => {
      if (!confirm("El link y el QR actuales de esta persona dejarán de funcionar. ¿Continuar?")) return;
      const { ok, data } = await api(`/api/networkers/${networker.telefono}/regenerar-slug`, { method: "POST" });
      const msg = document.getElementById("form-nw-mensaje");
      if (!ok) { msg.className = "form-mensaje error"; msg.textContent = data.error || "No se pudo regenerar."; return; }
      msg.className = "form-mensaje ok";
      msg.textContent = `Nuevo link: ${location.origin}/card/${data.slug}`;
    });
  }

  document.getElementById("btn-guardar-networker").addEventListener("click", async () => {
    const telefono = document.getElementById("nw-telefono").value.trim();
    const cuerpo = {
      capituloId: capituloIdActivo,
      nombre: document.getElementById("nw-nombre").value.trim(),
      empresa: document.getElementById("nw-empresa").value.trim(),
      especialidad: document.getElementById("nw-especialidad").value.trim(),
      categoriaBNI: document.getElementById("nw-categoria").value.trim(),
      esferaId: document.getElementById("nw-esfera").value || null,
      estadoNetworker: document.getElementById("nw-estado").value,
      fechaIngreso: document.getElementById("nw-ingreso").value || null,
      fechaRenovacion: document.getElementById("nw-renovacion").value || null
    };
    if (esEdicion) cuerpo.tarjetaDigitalActiva = document.getElementById("nw-tarjeta-activa").checked;
    const msg = document.getElementById("form-nw-mensaje");
    if (!telefono) { msg.className = "form-mensaje error"; msg.textContent = "El teléfono es obligatorio."; return; }
    const { ok, data } = await api(`/api/networkers/${telefono}`, { method: "PUT", body: JSON.stringify(cuerpo) });
    if (!ok) { msg.className = "form-mensaje error"; msg.textContent = data.error || "No se pudo guardar."; return; }
    cerrarPanel();
    await renderVista();
  });
}

// ---------- Tarjetas digitales (reutiliza la PWA existente) ----------
async function renderTarjetas(cont) {
  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">Tarjetas Digitales</div><div class="vista-sub">Billetera de Networkers -- vínculo entre cada networker y su tarjeta personal</div></div>
    <a class="btn-secundario" style="text-decoration:none;display:inline-block;" href="/" target="_blank" rel="noopener">Abrir mi Tarjeta Digital →</a></div>
    <div class="tabla-wrap"><table class="tabla-crm"><thead><tr><th>Networker</th><th>Empresa</th><th>Tarjeta</th><th>Vistas</th><th>Compartidos</th><th>Actualizada</th><th></th></tr></thead><tbody id="tabla-tarjetas">Cargando…</tbody></table></div>`;

  const { ok, data } = await api(conCapitulo("/api/networkers-tarjetas"));
  const tbody = document.getElementById("tabla-tarjetas");
  if (!ok) {
    tbody.innerHTML = `<tr><td colspan="7" class="estado-vacio">${escapeHtml(data.error || "No se pudo cargar.")}</td></tr>`;
    return;
  }
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="estado-vacio">Todavía no hay networkers en este capítulo.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map((n) => `
    <tr>
      <td><strong>${escapeHtml(n.nombre)}</strong></td>
      <td>${escapeHtml(n.empresa || "—")}</td>
      <td>${n.tieneTarjeta ? pill("configurada", "activo") : pill("sin configurar", "suspendido")}</td>
      <td>${n.tieneTarjeta ? n.vistas : "—"}</td>
      <td>${n.tieneTarjeta ? n.compartidos : "—"}</td>
      <td>${n.tieneTarjeta ? formatFecha(n.actualizadoEn) : "—"}</td>
      <td style="text-align:right;">
        ${n.tieneTarjeta ? `<a class="btn-rapido" href="/t?id=${n.tarjetaId}" target="_blank" rel="noopener" title="Ver tarjeta">👁️</a>` : `<span class="btn-rapido deshabilitado" title="Sin tarjeta todavía">👁️</span>`}
      </td>
    </tr>`).join("");
}

// ---------- Esferas ----------
async function renderEsferas(cont) {
  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">Esferas</div><div class="vista-sub">Cobertura de industrias del capítulo</div></div>
    <button class="btn-primario" id="btn-nueva-esfera">+ Nueva esfera</button></div>
    <div class="tabla-wrap"><table class="tabla-crm"><thead><tr><th>Esfera</th><th>Networkers asignados</th><th></th></tr></thead><tbody id="tabla-esferas"></tbody></table></div>`;

  document.getElementById("btn-nueva-esfera").addEventListener("click", () => abrirFormEsfera());

  const { ok, data } = await api(conCapitulo("/api/esferas/cobertura"));
  const tbody = document.getElementById("tabla-esferas");
  if (!ok) { tbody.innerHTML = `<tr><td colspan="3" class="estado-vacio">${escapeHtml(data.error || "Error al cargar esferas.")}</td></tr>`; return; }
  tbody.innerHTML = data.esferas.map((e) => `
    <tr>
      <td><strong>${escapeHtml(e.nombre)}</strong></td>
      <td>${e.totalNetworkers === 0 ? pill("sin cubrir", "suspendido") : `${e.totalNetworkers} networker(s)`}</td>
      <td style="text-align:right;"><button class="btn-secundario btn-eliminar-esfera" data-id="${e._id}" style="padding:6px 12px;font-size:12px;">Eliminar</button></td>
    </tr>`).join("");
  tbody.querySelectorAll(".btn-eliminar-esfera").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar esta esfera?")) return;
      await api(`/api/esferas/${btn.dataset.id}`, { method: "DELETE" });
      await renderVista();
    });
  });
}

function abrirFormEsfera() {
  abrirPanel("Nueva esfera", `
    <div class="campo"><label>Nombre</label><input id="esf-nombre"></div>
    <div class="panel-acciones">
      <button class="btn-primario" id="btn-guardar-esfera">Guardar</button>
      <button class="btn-secundario" id="btn-cancelar-panel">Cancelar</button>
    </div>
    <p class="form-mensaje" id="form-esf-mensaje"></p>
  `);
  document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);
  document.getElementById("btn-guardar-esfera").addEventListener("click", async () => {
    const nombre = document.getElementById("esf-nombre").value.trim();
    const msg = document.getElementById("form-esf-mensaje");
    const { ok, data } = await api("/api/esferas", { method: "POST", body: JSON.stringify({ nombre, capituloId: capituloIdActivo }) });
    if (!ok) { msg.className = "form-mensaje error"; msg.textContent = data.error || "No se pudo guardar."; return; }
    cerrarPanel();
    await renderVista();
  });
}

// ---------- Visitantes ----------
async function renderVisitantes(cont) {
  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">Visitantes</div><div class="vista-sub">Invitados a las reuniones del capítulo</div></div>
    <button class="btn-primario" id="btn-nuevo-visitante">+ Registrar visitante</button></div>
    <div class="tabla-wrap"><table class="tabla-crm"><thead><tr><th>Nombre</th><th>Empresa</th><th>Invitado por</th><th>Fecha</th><th>Estado</th></tr></thead><tbody id="tabla-visitantes"></tbody></table></div>`;

  document.getElementById("btn-nuevo-visitante").addEventListener("click", () => abrirFormVisitante(null));

  const { ok, data } = await api(conCapitulo("/api/visitantes"));
  const tbody = document.getElementById("tabla-visitantes");
  if (!ok || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="estado-vacio">Todavía no hay visitantes registrados.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map((v) => `
    <tr data-id="${v._id}" style="cursor:pointer;">
      <td><strong>${escapeHtml(v.nombre)}</strong></td>
      <td>${escapeHtml(v.empresa || "—")}</td>
      <td>${escapeHtml(v.invitadoPorTelefono)}</td>
      <td>${formatFecha(v.fechaVisita)}</td>
      <td>${pill(v.estado, v.estado)}</td>
    </tr>`).join("");
  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => abrirFormVisitante(data.find((v) => v._id === tr.dataset.id)));
  });
}

function abrirFormVisitante(visitante) {
  const esEdicion = Boolean(visitante);
  abrirPanel(esEdicion ? "Editar visitante" : "Registrar visitante", `
    <div class="campo"><label>Nombre</label><input id="vis-nombre" value="${escapeHtml(visitante?.nombre || "")}"></div>
    <div class="campo-fila">
      <div class="campo"><label>Empresa</label><input id="vis-empresa" value="${escapeHtml(visitante?.empresa || "")}"></div>
      <div class="campo"><label>Especialidad</label><input id="vis-especialidad" value="${escapeHtml(visitante?.especialidad || "")}"></div>
    </div>
    <div class="campo-fila">
      <div class="campo"><label>Teléfono</label><input id="vis-telefono" value="${escapeHtml(visitante?.telefono || "")}"></div>
      <div class="campo"><label>WhatsApp</label><input id="vis-whatsapp" value="${escapeHtml(visitante?.whatsapp || "")}"></div>
    </div>
    <div class="campo"><label>Correo</label><input id="vis-correo" value="${escapeHtml(visitante?.correo || "")}"></div>
    <div class="campo-fila">
      <div class="campo"><label>Fecha de visita</label><input type="date" id="vis-fecha" value="${visitante?.fechaVisita ? new Date(visitante.fechaVisita).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)}"></div>
      <div class="campo"><label>Estado</label>
        <select id="vis-estado">${["prospecto", "visitante", "interesado", "aplicado", "miembro", "descartado"].map((e) => `<option value="${e}" ${visitante?.estado === e ? "selected" : ""}>${e}</option>`).join("")}</select>
      </div>
    </div>
    <div class="campo-fila">
      <label class="campo-checkbox"><input type="checkbox" id="vis-asistio" ${visitante?.asistio ? "checked" : ""}> Asistió</label>
      <label class="campo-checkbox"><input type="checkbox" id="vis-volvio" ${visitante?.volvioAsistir ? "checked" : ""}> Volvió a asistir</label>
    </div>
    <div class="campo-fila">
      <label class="campo-checkbox"><input type="checkbox" id="vis-aplico" ${visitante?.aplico ? "checked" : ""}> Aplicó</label>
      <label class="campo-checkbox"><input type="checkbox" id="vis-miembro" ${visitante?.seConvirtioEnMiembro ? "checked" : ""}> Se convirtió en miembro</label>
    </div>
    <div class="campo"><label>Notas</label><textarea id="vis-notas" rows="3">${escapeHtml(visitante?.notas || "")}</textarea></div>
    <div class="panel-acciones">
      <button class="btn-primario" id="btn-guardar-visitante">Guardar</button>
      <button class="btn-secundario" id="btn-cancelar-panel">Cancelar</button>
    </div>
    <p class="form-mensaje" id="form-vis-mensaje"></p>
  `);
  document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);
  document.getElementById("btn-guardar-visitante").addEventListener("click", async () => {
    const cuerpo = {
      nombre: document.getElementById("vis-nombre").value.trim(),
      empresa: document.getElementById("vis-empresa").value.trim(),
      especialidad: document.getElementById("vis-especialidad").value.trim(),
      telefono: document.getElementById("vis-telefono").value.trim(),
      whatsapp: document.getElementById("vis-whatsapp").value.trim(),
      correo: document.getElementById("vis-correo").value.trim(),
      fechaVisita: document.getElementById("vis-fecha").value,
      estado: document.getElementById("vis-estado").value,
      asistio: document.getElementById("vis-asistio").checked,
      volvioAsistir: document.getElementById("vis-volvio").checked,
      aplico: document.getElementById("vis-aplico").checked,
      seConvirtioEnMiembro: document.getElementById("vis-miembro").checked,
      notas: document.getElementById("vis-notas").value.trim(),
      capituloId: capituloIdActivo
    };
    const msg = document.getElementById("form-vis-mensaje");
    const ruta = esEdicion ? `/api/visitantes/${visitante._id}` : "/api/visitantes";
    const { ok, data } = await api(ruta, { method: esEdicion ? "PUT" : "POST", body: JSON.stringify(cuerpo) });
    if (!ok) { msg.className = "form-mensaje error"; msg.textContent = data.error || "No se pudo guardar."; return; }
    cerrarPanel();
    await renderVista();
  });
}

// ---------- Invitados Funnel ----------
async function renderInvitados(cont) {
  const puedeCrear = puede("invitados", "crear");
  cont.innerHTML = `
    <div class="vista-header">
      <div><div class="vista-titulo">Invitados</div><div class="vista-sub">Prospectos que llegaron a través del funnel de captación</div></div>
      ${puedeCrear ? '<button class="btn-primario" id="btn-generar-enlace">🔗 Generar enlace</button>' : ""}
    </div>
    <div class="tabla-wrap"><table class="tabla-crm">
      <thead><tr><th>Nombre</th><th>Profesión</th><th>Teléfono</th><th>Correo</th><th>Invitado por</th><th>Fecha Networket</th><th>Registrado</th><th>Estado</th></tr></thead>
      <tbody id="tabla-invitados"></tbody>
    </table></div>`;

  if (puedeCrear) {
    document.getElementById("btn-generar-enlace").addEventListener("click", () => abrirGenerarEnlaceInvitados());
  }

  const { ok, data } = await api(conCapitulo("/api/invitados-funnel"));
  const tbody = document.getElementById("tabla-invitados");
  if (!ok || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="estado-vacio">Todavía no hay invitados registrados desde el funnel.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map((inv) => `
    <tr data-id="${inv._id}" style="cursor:pointer;">
      <td><strong>${escapeHtml(inv.nombre)}</strong></td>
      <td>${escapeHtml(inv.profesion || "—")}</td>
      <td>${escapeHtml(inv.telefono)}</td>
      <td>${escapeHtml(inv.correo || "—")}</td>
      <td>${escapeHtml(inv.invitadoPorNombre || "—")}</td>
      <td>${formatFecha(inv.fechaNetworket)}</td>
      <td>${formatFecha(inv.creadoEn)}</td>
      <td>${pill(inv.estado || "nuevo", inv.estado || "nuevo")}</td>
    </tr>`).join("");
  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => abrirDetalleInvitado(data.find((i) => i._id === tr.dataset.id)));
  });
}

function abrirDetalleInvitado(inv) {
  const ESTADOS = ["nuevo", "contactado", "interesado", "aplicado", "descartado"];
  abrirPanel("Detalle del invitado", `
    <div class="campo-fila">
      <div class="campo"><label>Nombre</label><input value="${escapeHtml(inv.nombre)}" disabled></div>
      <div class="campo"><label>Profesión</label><input value="${escapeHtml(inv.profesion || "")}" disabled></div>
    </div>
    <div class="campo-fila">
      <div class="campo"><label>Teléfono</label><input value="${escapeHtml(inv.telefono)}" disabled></div>
      <div class="campo"><label>Correo</label><input value="${escapeHtml(inv.correo || "")}" disabled></div>
    </div>
    <div class="campo-fila">
      <div class="campo"><label>Invitado por</label><input value="${escapeHtml(inv.invitadoPorNombre || "—")}" disabled></div>
      <div class="campo"><label>Fecha networket</label><input value="${inv.fechaNetworket ? new Date(inv.fechaNetworket).toLocaleDateString("es-GT") : "—"}" disabled></div>
    </div>
    <div class="campo-fila">
      <div class="campo"><label>Registrado el</label><input value="${formatFecha(inv.creadoEn)}" disabled></div>
      <div class="campo"><label>Estado</label>
        <select id="det-inv-estado">${ESTADOS.map((e) => `<option value="${e}" ${(inv.estado || "nuevo") === e ? "selected" : ""}>${e}</option>`).join("")}</select>
      </div>
    </div>
    <div class="campo"><label>Notas de seguimiento</label><textarea id="det-inv-notas" rows="3">${escapeHtml(inv.notas || "")}</textarea></div>
    <div class="panel-acciones">
      <button class="btn-primario" id="btn-guardar-inv-det">Guardar</button>
      <button class="btn-secundario" id="btn-cancelar-panel">Cancelar</button>
    </div>
    <p class="form-mensaje" id="form-inv-det-msg"></p>
  `);
  document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);
  document.getElementById("btn-guardar-inv-det").addEventListener("click", async () => {
    const cuerpo = {
      estado: document.getElementById("det-inv-estado").value,
      notas: document.getElementById("det-inv-notas").value.trim()
    };
    const { ok, data } = await api(`/api/invitados-funnel/${inv._id}`, { method: "PUT", body: JSON.stringify(cuerpo) });
    const msg = document.getElementById("form-inv-det-msg");
    if (!ok) { msg.className = "form-mensaje error"; msg.textContent = data.error || "No se pudo guardar."; return; }
    cerrarPanel();
    await renderVista();
  });
}

function abrirGenerarEnlaceInvitados() {
  const hoy = new Date().toISOString().slice(0, 10);
  const nombreNW = escapeHtml(usuarioActual?.nombre || "");
  const telNW = usuarioActual?.telefono || "";
  abrirPanel("Generar enlace de captación", `
    <p style="font-size:13px;color:var(--texto-claro);margin-bottom:16px;">
      Genera un enlace único para invitar personas al próximo Networket. Compártelo por WhatsApp, correo o redes sociales.
    </p>
    <div class="campo"><label>Fecha del networket *</label><input type="date" id="gl-fecha" value="${hoy}"></div>
    <div class="campo"><label>Tu nombre (quien invita)</label><input id="gl-nombre" value="${nombreNW}" placeholder="Nombre del networker"></div>
    <div class="campo"><label>Cupos disponibles</label><input type="number" id="gl-cupos" value="5" min="1" max="99"></div>
    <div class="campo"><label>ID del video de YouTube (opcional)</label>
      <input id="gl-video" placeholder="Ej: dQw4w9WgXcQ (solo el ID, no la URL completa)">
    </div>
    <div class="campo"><label>Enlace generado</label>
      <div style="display:flex;gap:8px;align-items:stretch;">
        <input id="gl-url" readonly style="font-size:11px;background:var(--gris-claro);flex:1;">
        <button class="btn-secundario" id="btn-copiar-gl" style="white-space:nowrap;padding:10px 14px;flex-shrink:0;">Copiar</button>
      </div>
    </div>
    <div class="panel-acciones" style="margin-top:6px;">
      <button class="btn-primario" id="btn-generar-gl">Actualizar</button>
      <button class="btn-secundario" id="btn-cancelar-panel">Cerrar</button>
    </div>
  `);
  document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);

  function generarUrl() {
    const p = new URLSearchParams();
    p.set("cap", capituloIdActivo);
    p.set("nom_cap", capituloNombreActivo);
    const fecha = document.getElementById("gl-fecha").value;
    const nombre = document.getElementById("gl-nombre").value.trim();
    const cupos = document.getElementById("gl-cupos").value || "5";
    const video = document.getElementById("gl-video").value.trim();
    if (fecha) p.set("fecha", fecha);
    if (nombre) p.set("inv", nombre);
    if (telNW) p.set("invtel", telNW);
    if (cupos) p.set("cupos", cupos);
    if (video) p.set("video", video);
    document.getElementById("gl-url").value = `${location.origin}/unete?${p.toString()}`;
  }

  generarUrl();
  document.getElementById("btn-generar-gl").addEventListener("click", generarUrl);
  ["gl-fecha", "gl-nombre", "gl-cupos", "gl-video"].forEach((id) =>
    document.getElementById(id).addEventListener("input", generarUrl)
  );
  document.getElementById("btn-copiar-gl").addEventListener("click", async () => {
    const url = document.getElementById("gl-url").value;
    try {
      await navigator.clipboard.writeText(url);
      const btn = document.getElementById("btn-copiar-gl");
      btn.textContent = "¡Copiado!";
      setTimeout(() => { btn.textContent = "Copiar"; }, 2000);
    } catch {
      document.getElementById("gl-url").select();
    }
  });
}

// ---------- GPNC ----------
async function renderGpnc(cont) {
  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">GPNC</div><div class="vista-sub">Gracias Por Negocio Concretado</div></div>
    <button class="btn-primario" id="btn-nuevo-gpnc">+ Registrar GPNC</button></div>
    <div class="tabla-wrap"><table class="tabla-crm"><thead><tr><th>Fecha</th><th>Generó</th><th>Agradece</th><th>Cliente</th><th>Monto</th><th></th></tr></thead><tbody id="tabla-gpnc"></tbody></table></div>`;

  document.getElementById("btn-nuevo-gpnc").addEventListener("click", () => abrirFormGpnc());

  const { ok, data } = await api(conCapitulo("/api/gpnc"));
  const tbody = document.getElementById("tabla-gpnc");
  if (!ok || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="estado-vacio">Todavía no hay GPNC registrados.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map((g) => `
    <tr>
      <td>${formatFecha(g.fecha)}</td>
      <td>${escapeHtml(g.generoTelefono)}</td>
      <td>${escapeHtml(g.agradeceTelefono)}</td>
      <td>${escapeHtml(g.cliente)}</td>
      <td><strong>${formatMonto(g.monto, g.moneda)}</strong></td>
      <td style="text-align:right;"><button class="btn-secundario btn-eliminar-gpnc" data-id="${g._id}" style="padding:6px 12px;font-size:12px;">Eliminar</button></td>
    </tr>`).join("");
  tbody.querySelectorAll(".btn-eliminar-gpnc").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar este registro de GPNC?")) return;
      await api(`/api/gpnc/${btn.dataset.id}`, { method: "DELETE" });
      await renderVista();
    });
  });
}

function abrirFormGpnc(prellenado) {
  const p = prellenado || {};
  abrirPanel("Registrar GPNC", `
    <div class="campo"><label>Networker que generó la referencia (teléfono)</label><input id="gp-genero" value="${escapeHtml(p.generoTelefono || "")}"></div>
    <div class="campo"><label>Cliente</label><input id="gp-cliente" value="${escapeHtml(p.cliente || "")}"></div>
    <div class="campo"><label>Descripción del negocio</label><textarea id="gp-descripcion" rows="2"></textarea></div>
    <div class="campo-fila">
      <div class="campo"><label>Monto</label><input type="number" min="0" step="0.01" id="gp-monto" value="${p.monto || ""}"></div>
      <div class="campo"><label>Moneda</label>
        <select id="gp-moneda"><option value="GTQ">GTQ</option><option value="USD">USD</option></select>
      </div>
    </div>
    <div class="campo"><label>Fecha</label><input type="date" id="gp-fecha" value="${new Date().toISOString().slice(0, 10)}"></div>
    <div class="campo"><label>Observaciones</label><textarea id="gp-observaciones" rows="2"></textarea></div>
    <div class="panel-acciones">
      <button class="btn-primario" id="btn-guardar-gpnc">Guardar</button>
      <button class="btn-secundario" id="btn-cancelar-panel">Cancelar</button>
    </div>
    <p class="form-mensaje" id="form-gp-mensaje"></p>
  `);
  document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);
  document.getElementById("btn-guardar-gpnc").addEventListener("click", async () => {
    const cuerpo = {
      generoTelefono: document.getElementById("gp-genero").value.trim(),
      cliente: document.getElementById("gp-cliente").value.trim(),
      descripcionNegocio: document.getElementById("gp-descripcion").value.trim(),
      monto: document.getElementById("gp-monto").value,
      moneda: document.getElementById("gp-moneda").value,
      fecha: document.getElementById("gp-fecha").value,
      observaciones: document.getElementById("gp-observaciones").value.trim(),
      referenciaId: p.referenciaId || null,
      capituloId: capituloIdActivo
    };
    const msg = document.getElementById("form-gp-mensaje");
    const { ok, data } = await api("/api/gpnc", { method: "POST", body: JSON.stringify(cuerpo) });
    if (!ok) { msg.className = "form-mensaje error"; msg.textContent = data.error || "No se pudo guardar."; return; }
    cerrarPanel();
    await renderVista();
  });
}

// ---------- Uno a Uno ----------
async function renderUnoAUno(cont) {
  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">Uno a Uno</div><div class="vista-sub">Reuniones individuales entre networkers</div></div>
    <button class="btn-primario" id="btn-nuevo-unoauno">+ Agendar 1 a 1</button></div>
    <div class="tabla-wrap"><table class="tabla-crm"><thead><tr><th>Fecha</th><th>Participantes</th><th>Tema</th><th>Estado</th></tr></thead><tbody id="tabla-unoauno"></tbody></table></div>`;

  document.getElementById("btn-nuevo-unoauno").addEventListener("click", () => abrirFormUnoAUno(null));

  const { ok, data } = await api(conCapitulo("/api/unoauno"));
  const tbody = document.getElementById("tabla-unoauno");
  if (!ok || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="estado-vacio">Todavía no hay 1 a 1 registrados.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map((u) => `
    <tr data-id="${u._id}" style="cursor:pointer;">
      <td>${formatFecha(u.fecha)}</td>
      <td>${escapeHtml(u.participante1Telefono)} ↔ ${escapeHtml(u.participante2Telefono)}</td>
      <td>${escapeHtml(u.tema || "—")}</td>
      <td>${pill(u.estado, u.estado)}</td>
    </tr>`).join("");
  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => abrirFormUnoAUno(data.find((u) => u._id === tr.dataset.id)));
  });
}

async function abrirFormUnoAUno(registro) {
  const esEdicion = Boolean(registro);
  let opcionesNetworkers = "";
  if (!esEdicion) {
    const { ok, data } = await api(conCapitulo("/api/networkers"));
    const candidatos = (ok && Array.isArray(data) ? data : []).filter((n) => n.telefono !== usuarioActual.telefono);
    opcionesNetworkers = candidatos.length === 0
      ? '<option value="">No hay otros networkers en el capítulo todavía</option>'
      : '<option value="">Selecciona...</option>' + candidatos.map((n) => `<option value="${n.telefono}">${escapeHtml(n.nombre)}</option>`).join("");
  }

  abrirPanel(esEdicion ? "Editar 1 a 1" : "Agendar 1 a 1", `
    ${!esEdicion ? `<div class="campo"><label>¿Con quién es el 1 a 1?</label><select id="uo-participante2">${opcionesNetworkers}</select></div>` :
      `<div class="campo"><label>Participantes</label><input value="${escapeHtml(registro.participante1Telefono)} ↔ ${escapeHtml(registro.participante2Telefono)}" disabled></div>`}
    <div class="campo-fila">
      <div class="campo"><label>Fecha</label><input type="date" id="uo-fecha" value="${registro?.fecha ? new Date(registro.fecha).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)}"></div>
      <div class="campo"><label>Hora</label><input type="time" id="uo-hora" value="${escapeHtml(registro?.hora || "")}"></div>
    </div>
    <div class="campo"><label>Lugar o link</label><input id="uo-lugar" value="${escapeHtml(registro?.lugarOLink || "")}"></div>
    <div class="campo"><label>Tema</label><input id="uo-tema" value="${escapeHtml(registro?.tema || "")}"></div>
    <div class="campo"><label>Estado</label>
      <select id="uo-estado">${["programado", "realizado", "cancelado"].map((e) => `<option value="${e}" ${registro?.estado === e ? "selected" : ""}>${e}</option>`).join("")}</select>
    </div>
    <div class="campo"><label>Compromisos</label><textarea id="uo-compromisos" rows="2">${escapeHtml(registro?.compromisos || "")}</textarea></div>
    <div class="campo"><label>Notas</label><textarea id="uo-notas" rows="2">${escapeHtml(registro?.notas || "")}</textarea></div>
    <div class="panel-acciones">
      <button class="btn-primario" id="btn-guardar-unoauno">Guardar</button>
      <button class="btn-secundario" id="btn-cancelar-panel">Cancelar</button>
    </div>
    <p class="form-mensaje" id="form-uo-mensaje"></p>
  `);
  document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);
  document.getElementById("btn-guardar-unoauno").addEventListener("click", async () => {
    const cuerpo = {
      fecha: document.getElementById("uo-fecha").value,
      hora: document.getElementById("uo-hora").value,
      lugarOLink: document.getElementById("uo-lugar").value.trim(),
      tema: document.getElementById("uo-tema").value.trim(),
      estado: document.getElementById("uo-estado").value,
      compromisos: document.getElementById("uo-compromisos").value.trim(),
      notas: document.getElementById("uo-notas").value.trim(),
      capituloId: capituloIdActivo
    };
    const msg = document.getElementById("form-uo-mensaje");
    let ruta = "/api/unoauno";
    let metodo = "POST";
    if (esEdicion) {
      ruta = `/api/unoauno/${registro._id}`;
      metodo = "PUT";
    } else {
      cuerpo.participante2Telefono = document.getElementById("uo-participante2").value.trim();
    }
    const { ok, data } = await api(ruta, { method: metodo, body: JSON.stringify(cuerpo) });
    if (!ok) { msg.className = "form-mensaje error"; msg.textContent = data.error || "No se pudo guardar."; return; }
    cerrarPanel();
    await renderVista();
  });
}

// ---------- Referencias ----------
async function renderReferencias(cont) {
  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">Referencias</div><div class="vista-sub">Referencias de negocio entre networkers</div></div>
    <button class="btn-primario" id="btn-nueva-referencia">+ Nueva referencia</button></div>
    <div class="tabla-wrap"><table class="tabla-crm"><thead><tr><th>Fecha</th><th>Dada por</th><th>Recibida por</th><th>Cliente</th><th>Estado</th><th>Monto est.</th></tr></thead><tbody id="tabla-referencias"></tbody></table></div>`;

  document.getElementById("btn-nueva-referencia").addEventListener("click", () => abrirFormReferencia(null));

  const { ok, data } = await api(conCapitulo("/api/referencias"));
  const tbody = document.getElementById("tabla-referencias");
  if (!ok || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="estado-vacio">Todavía no hay referencias registradas.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map((r) => `
    <tr data-id="${r._id}" style="cursor:pointer;">
      <td>${formatFecha(r.fecha)}</td>
      <td>${escapeHtml(r.referenciaDadaPorTelefono)}</td>
      <td>${escapeHtml(r.referenciaRecibidaPorTelefono)}</td>
      <td>${escapeHtml(r.clienteReferido)}</td>
      <td>${pill(r.estado, r.estado === "ganado" ? "miembro" : r.estado === "perdido" ? "descartado" : "prospecto")}</td>
      <td>${formatMonto(r.montoEstimado)}</td>
    </tr>`).join("");
  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => abrirFormReferencia(data.find((r) => r._id === tr.dataset.id)));
  });
}

function abrirFormReferencia(referencia) {
  const esEdicion = Boolean(referencia);
  abrirPanel(esEdicion ? "Editar referencia" : "Nueva referencia", `
    ${!esEdicion ? '<div class="campo"><label>Teléfono de quien recibe la referencia</label><input id="rf-recibe"></div>' : ""}
    <div class="campo"><label>Cliente referido</label><input id="rf-cliente" value="${escapeHtml(referencia?.clienteReferido || "")}"></div>
    <div class="campo-fila">
      <div class="campo"><label>Teléfono del cliente</label><input id="rf-telefono" value="${escapeHtml(referencia?.telefonoCliente || "")}"></div>
      <div class="campo"><label>Correo del cliente</label><input id="rf-correo" value="${escapeHtml(referencia?.correoCliente || "")}"></div>
    </div>
    <div class="campo"><label>Descripción</label><textarea id="rf-descripcion" rows="2">${escapeHtml(referencia?.descripcion || "")}</textarea></div>
    <div class="campo-fila">
      <div class="campo"><label>Estado</label>
        <select id="rf-estado">${["pendiente", "contactado", "cotizado", "ganado", "perdido"].map((e) => `<option value="${e}" ${referencia?.estado === e ? "selected" : ""}>${e}</option>`).join("")}</select>
      </div>
      <div class="campo"><label>Monto estimado</label><input type="number" min="0" step="0.01" id="rf-monto" value="${referencia?.montoEstimado || ""}"></div>
    </div>
    <div class="campo"><label>Fecha de seguimiento</label><input type="date" id="rf-seguimiento" value="${referencia?.fechaSeguimiento ? new Date(referencia.fechaSeguimiento).toISOString().slice(0, 10) : ""}"></div>
    <div class="campo"><label>Notas</label><textarea id="rf-notas" rows="2">${escapeHtml(referencia?.notas || "")}</textarea></div>
    <div class="panel-acciones">
      <button class="btn-primario" id="btn-guardar-referencia">Guardar</button>
      <button class="btn-secundario" id="btn-cancelar-panel">Cancelar</button>
    </div>
    ${esEdicion && referencia.estado === "ganado" ? '<button class="btn-secundario" id="btn-convertir-gpnc" style="margin-top:10px;width:100%;">Convertir en GPNC →</button>' : ""}
    <p class="form-mensaje" id="form-rf-mensaje"></p>
  `);
  document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);
  document.getElementById("btn-guardar-referencia").addEventListener("click", async () => {
    const cuerpo = {
      clienteReferido: document.getElementById("rf-cliente").value.trim(),
      telefonoCliente: document.getElementById("rf-telefono").value.trim(),
      correoCliente: document.getElementById("rf-correo").value.trim(),
      descripcion: document.getElementById("rf-descripcion").value.trim(),
      estado: document.getElementById("rf-estado").value,
      montoEstimado: document.getElementById("rf-monto").value,
      fechaSeguimiento: document.getElementById("rf-seguimiento").value || null,
      notas: document.getElementById("rf-notas").value.trim(),
      capituloId: capituloIdActivo
    };
    const msg = document.getElementById("form-rf-mensaje");
    let ruta = "/api/referencias";
    let metodo = "POST";
    if (esEdicion) {
      ruta = `/api/referencias/${referencia._id}`;
      metodo = "PUT";
    } else {
      cuerpo.referenciaRecibidaPorTelefono = document.getElementById("rf-recibe").value.trim();
    }
    const { ok, data } = await api(ruta, { method: metodo, body: JSON.stringify(cuerpo) });
    if (!ok) { msg.className = "form-mensaje error"; msg.textContent = data.error || "No se pudo guardar."; return; }
    cerrarPanel();
    await renderVista();
  });
  const btnConvertir = document.getElementById("btn-convertir-gpnc");
  if (btnConvertir) {
    btnConvertir.addEventListener("click", () => {
      cerrarPanel();
      abrirFormGpnc({
        generoTelefono: referencia.referenciaDadaPorTelefono,
        cliente: referencia.clienteReferido,
        monto: referencia.montoEstimado,
        referenciaId: referencia._id
      });
    });
  }
}

// ---------- Calendario ----------
async function renderCalendario(cont) {
  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">Calendario</div><div class="vista-sub">Reuniones, capacitaciones y seguimientos del capítulo</div></div>
    <button class="btn-primario" id="btn-nuevo-evento">+ Nuevo evento</button></div>
    <div class="tabla-wrap"><table class="tabla-crm"><thead><tr><th>Fecha</th><th>Tipo</th><th>Título</th><th>Lugar / link</th><th></th></tr></thead><tbody id="tabla-agenda"></tbody></table></div>`;

  document.getElementById("btn-nuevo-evento").addEventListener("click", () => abrirFormEvento(null));

  const { ok, data } = await api(conCapitulo("/api/agenda?proximos=true"));
  const tbody = document.getElementById("tabla-agenda");
  if (!ok || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="estado-vacio">No hay próximos eventos en el calendario.</td></tr>`;
    return;
  }
  // Un networker solo puede editar/eliminar sus propios eventos; un admin
  // de capítulo puede tocar cualquiera (ya validado igual en el backend,
  // esto solo evita mostrar una accion que terminaria en un 403).
  const esPropio = (a) => usuarioActual.rol !== "networker" || a.creadoPorTelefono === usuarioActual.telefono;
  const puedeEditar = puede("calendario", "editar");
  const puedeEliminar = puede("calendario", "eliminar");

  tbody.innerHTML = data.map((a) => `
    <tr>
      <td>${formatFecha(a.fecha)} ${escapeHtml(a.hora || "")}</td>
      <td>${pill(a.tipo.replace(/_/g, " "), a.completado ? "activo" : "programado")}</td>
      <td ${puedeEditar && esPropio(a) ? `style="cursor:pointer;" data-id="${a._id}" class="td-editar-evento"` : ""}><strong>${escapeHtml(a.titulo)}</strong></td>
      <td>${escapeHtml(a.lugarOLink || "—")}</td>
      <td style="text-align:right;">${puedeEliminar && esPropio(a) ? `<button class="btn-secundario btn-eliminar-evento" data-id="${a._id}" style="padding:6px 12px;font-size:12px;">Eliminar</button>` : ""}</td>
    </tr>`).join("");
  tbody.querySelectorAll(".td-editar-evento").forEach((td) => {
    td.addEventListener("click", () => abrirFormEvento(data.find((a) => a._id === td.dataset.id)));
  });
  tbody.querySelectorAll(".btn-eliminar-evento").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar este evento?")) return;
      await api(`/api/agenda/${btn.dataset.id}`, { method: "DELETE" });
      await renderVista();
    });
  });
}

const TIPOS_AGENDA = ["reunion_semanal", "uno_a_uno", "capacitacion", "lanzamiento", "regional", "seguimiento_referencia", "seguimiento_visitante", "otro"];

function abrirFormEvento(evento) {
  const esEdicion = Boolean(evento);
  abrirPanel(esEdicion ? "Editar evento" : "Nuevo evento", `
    <div class="campo"><label>Título</label><input id="ag-titulo" value="${escapeHtml(evento?.titulo || "")}"></div>
    <div class="campo"><label>Tipo</label>
      <select id="ag-tipo">${TIPOS_AGENDA.map((t) => `<option value="${t}" ${evento?.tipo === t ? "selected" : ""}>${t.replace(/_/g, " ")}</option>`).join("")}</select>
    </div>
    <div class="campo-fila">
      <div class="campo"><label>Fecha</label><input type="date" id="ag-fecha" value="${evento?.fecha ? new Date(evento.fecha).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)}"></div>
      <div class="campo"><label>Hora</label><input type="time" id="ag-hora" value="${escapeHtml(evento?.hora || "")}"></div>
    </div>
    <div class="campo"><label>Lugar o link</label><input id="ag-lugar" value="${escapeHtml(evento?.lugarOLink || "")}"></div>
    <div class="campo"><label>Descripción</label><textarea id="ag-descripcion" rows="2">${escapeHtml(evento?.descripcion || "")}</textarea></div>
    <label class="campo-checkbox" style="margin-bottom:16px;"><input type="checkbox" id="ag-completado" ${evento?.completado ? "checked" : ""}> Completado</label>
    <div class="panel-acciones">
      <button class="btn-primario" id="btn-guardar-evento">Guardar</button>
      <button class="btn-secundario" id="btn-cancelar-panel">Cancelar</button>
    </div>
    <p class="form-mensaje" id="form-ag-mensaje"></p>
  `);
  document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);
  document.getElementById("btn-guardar-evento").addEventListener("click", async () => {
    const cuerpo = {
      titulo: document.getElementById("ag-titulo").value.trim(),
      tipo: document.getElementById("ag-tipo").value,
      fecha: document.getElementById("ag-fecha").value,
      hora: document.getElementById("ag-hora").value,
      lugarOLink: document.getElementById("ag-lugar").value.trim(),
      descripcion: document.getElementById("ag-descripcion").value.trim(),
      completado: document.getElementById("ag-completado").checked,
      capituloId: capituloIdActivo
    };
    const msg = document.getElementById("form-ag-mensaje");
    const ruta = esEdicion ? `/api/agenda/${evento._id}` : "/api/agenda";
    const { ok, data } = await api(ruta, { method: esEdicion ? "PUT" : "POST", body: JSON.stringify(cuerpo) });
    if (!ok) { msg.className = "form-mensaje error"; msg.textContent = data.error || "No se pudo guardar."; return; }
    cerrarPanel();
    await renderVista();
  });
}

// ---------- Capacitación ----------
async function renderCapacitacion(cont) {
  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">Capacitación</div><div class="vista-sub">Material y sesiones de formación del capítulo</div></div>
    <button class="btn-primario" id="btn-nueva-capacitacion">+ Nueva capacitación</button></div>
    <div class="tabla-wrap"><table class="tabla-crm"><thead><tr><th>Título</th><th>Instructor</th><th>Fecha</th><th>Tipo</th><th>Avance</th></tr></thead><tbody id="tabla-capacitacion"></tbody></table></div>`;

  await cargarNetworkersCache();
  document.getElementById("btn-nueva-capacitacion").addEventListener("click", () => abrirFormCapacitacion(null));

  const { ok, data } = await api(conCapitulo("/api/capacitaciones"));
  const tbody = document.getElementById("tabla-capacitacion");
  if (!ok || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="estado-vacio">Todavía no hay capacitaciones registradas.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map((c) => {
    const miembros = c.miembrosAsignados || [];
    const completados = miembros.filter((m) => m.completado).length;
    return `<tr data-id="${c._id}" style="cursor:pointer;">
      <td><strong>${escapeHtml(c.titulo)}</strong></td>
      <td>${escapeHtml(c.instructor || "—")}</td>
      <td>${formatFecha(c.fecha)}</td>
      <td>${escapeHtml(c.tipo)}</td>
      <td>${miembros.length === 0 ? "—" : `${completados}/${miembros.length}`}</td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => abrirFormCapacitacion(data.find((c) => c._id === tr.dataset.id)));
  });
}

async function cargarNetworkersCache() {
  const { ok, data } = await api(conCapitulo("/api/networkers"));
  return ok && Array.isArray(data) ? data : [];
}

async function abrirFormCapacitacion(capacitacion) {
  const esEdicion = Boolean(capacitacion);
  const networkers = await cargarNetworkersCache();
  const asignados = new Map((capacitacion?.miembrosAsignados || []).map((m) => [m.telefono, m]));
  abrirPanel(esEdicion ? "Editar capacitación" : "Nueva capacitación", `
    <div class="campo"><label>Título</label><input id="cp-titulo" value="${escapeHtml(capacitacion?.titulo || "")}"></div>
    <div class="campo-fila">
      <div class="campo"><label>Instructor</label><input id="cp-instructor" value="${escapeHtml(capacitacion?.instructor || "")}"></div>
      <div class="campo"><label>Duración</label><input id="cp-duracion" value="${escapeHtml(capacitacion?.duracion || "")}"></div>
    </div>
    <div class="campo-fila">
      <div class="campo"><label>Fecha</label><input type="date" id="cp-fecha" value="${capacitacion?.fecha ? new Date(capacitacion.fecha).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)}"></div>
      <div class="campo"><label>Tipo</label>
        <select id="cp-tipo">${["video", "pdf", "link", "presencial", "virtual"].map((t) => `<option value="${t}" ${capacitacion?.tipo === t ? "selected" : ""}>${t}</option>`).join("")}</select>
      </div>
    </div>
    <div class="campo"><label>Archivo o enlace</label><input id="cp-enlace" value="${escapeHtml(capacitacion?.archivoOEnlace || "")}"></div>
    <div class="campo"><label>Descripción</label><textarea id="cp-descripcion" rows="2">${escapeHtml(capacitacion?.descripcion || "")}</textarea></div>
    <div class="campo"><label>Miembros asignados</label>
      <div style="max-height:180px;overflow-y:auto;border:1px solid var(--gris-borde);border-radius:4px;padding:10px;">
        ${networkers.map((n) => `<label class="campo-checkbox" style="margin-bottom:8px;">
          <input type="checkbox" class="cp-miembro" value="${n.telefono}" ${asignados.has(n.telefono) ? "checked" : ""}>
          ${escapeHtml(n.nombre)} ${asignados.get(n.telefono)?.completado ? "✅" : ""}
        </label>`).join("") || "<p class='vista-sub'>No hay networkers en este capítulo.</p>"}
      </div>
    </div>
    <div class="panel-acciones">
      <button class="btn-primario" id="btn-guardar-capacitacion">Guardar</button>
      <button class="btn-secundario" id="btn-cancelar-panel">Cancelar</button>
    </div>
    <p class="form-mensaje" id="form-cp-mensaje"></p>
  `);
  document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);
  document.getElementById("btn-guardar-capacitacion").addEventListener("click", async () => {
    const miembrosAsignados = Array.from(document.querySelectorAll(".cp-miembro:checked")).map((el) => el.value);
    const cuerpo = {
      titulo: document.getElementById("cp-titulo").value.trim(),
      instructor: document.getElementById("cp-instructor").value.trim(),
      duracion: document.getElementById("cp-duracion").value.trim(),
      fecha: document.getElementById("cp-fecha").value,
      tipo: document.getElementById("cp-tipo").value,
      archivoOEnlace: document.getElementById("cp-enlace").value.trim(),
      descripcion: document.getElementById("cp-descripcion").value.trim(),
      miembrosAsignados,
      capituloId: capituloIdActivo
    };
    const msg = document.getElementById("form-cp-mensaje");
    const ruta = esEdicion ? `/api/capacitaciones/${capacitacion._id}` : "/api/capacitaciones";
    const { ok, data } = await api(ruta, { method: esEdicion ? "PUT" : "POST", body: JSON.stringify(cuerpo) });
    if (!ok) { msg.className = "form-mensaje error"; msg.textContent = data.error || "No se pudo guardar."; return; }
    cerrarPanel();
    await renderVista();
  });
}

// ---------- Recursos ----------
const CATEGORIAS_RECURSOS = ["BNI", "Capacitación", "Networking", "Ventas", "Marketing", "Inteligencia Artificial", "Herramientas"];
let filtroCategoriaRecursoActivo = "";

async function renderRecursos(cont) {
  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">Recursos</div><div class="vista-sub">Biblioteca de material del capítulo</div></div>
    <button class="btn-primario" id="btn-nuevo-recurso">+ Nuevo recurso</button></div>
    <div class="barra-acciones"><select id="filtro-categoria-recurso" style="padding:8px 12px;border:1px solid var(--gris-borde);border-radius:4px;">
      <option value="">Todas las categorías</option>
      ${CATEGORIAS_RECURSOS.map((c) => `<option value="${c}" ${filtroCategoriaRecursoActivo === c ? "selected" : ""}>${c}</option>`).join("")}
    </select></div>
    <div class="tabla-wrap"><table class="tabla-crm"><thead><tr><th>Título</th><th>Categoría</th><th>Tipo</th><th>Enlace</th><th></th></tr></thead><tbody id="tabla-recursos"></tbody></table></div>`;

  document.getElementById("btn-nuevo-recurso").addEventListener("click", () => abrirFormRecurso());
  document.getElementById("filtro-categoria-recurso").addEventListener("change", async (e) => {
    filtroCategoriaRecursoActivo = e.target.value;
    await renderVista();
  });

  const categoria = filtroCategoriaRecursoActivo;
  const ruta = categoria ? conCapitulo(`/api/recursos?categoria=${encodeURIComponent(categoria)}`) : conCapitulo("/api/recursos");
  const { ok, data } = await api(ruta);
  const tbody = document.getElementById("tabla-recursos");
  if (!ok || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="estado-vacio">Todavía no hay recursos guardados.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map((r) => `
    <tr>
      <td><strong>${escapeHtml(r.titulo)}</strong>${r.descripcion ? `<div class="vista-sub">${escapeHtml(r.descripcion)}</div>` : ""}</td>
      <td>${escapeHtml(r.categoria)}</td>
      <td>${escapeHtml(r.tipo)}</td>
      <td><a href="${escapeHtml(r.enlace)}" target="_blank" rel="noopener">Abrir →</a></td>
      <td style="text-align:right;"><button class="btn-secundario btn-eliminar-recurso" data-id="${r._id}" style="padding:6px 12px;font-size:12px;">Eliminar</button></td>
    </tr>`).join("");
  tbody.querySelectorAll(".btn-eliminar-recurso").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar este recurso?")) return;
      await api(`/api/recursos/${btn.dataset.id}`, { method: "DELETE" });
      await renderVista();
    });
  });
}

function abrirFormRecurso() {
  abrirPanel("Nuevo recurso", `
    <div class="campo"><label>Título</label><input id="rc-titulo"></div>
    <div class="campo-fila">
      <div class="campo"><label>Categoría</label>
        <select id="rc-categoria">${CATEGORIAS_RECURSOS.map((c) => `<option value="${c}">${c}</option>`).join("")}</select>
      </div>
      <div class="campo"><label>Tipo</label>
        <select id="rc-tipo">${["link", "pdf", "video", "manual", "presentacion", "formulario"].map((t) => `<option value="${t}">${t}</option>`).join("")}</select>
      </div>
    </div>
    <div class="campo"><label>Enlace</label><input id="rc-enlace" placeholder="https://..."></div>
    <div class="campo"><label>Descripción</label><textarea id="rc-descripcion" rows="2"></textarea></div>
    <div class="panel-acciones">
      <button class="btn-primario" id="btn-guardar-recurso">Guardar</button>
      <button class="btn-secundario" id="btn-cancelar-panel">Cancelar</button>
    </div>
    <p class="form-mensaje" id="form-rc-mensaje"></p>
  `);
  document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);
  document.getElementById("btn-guardar-recurso").addEventListener("click", async () => {
    const cuerpo = {
      titulo: document.getElementById("rc-titulo").value.trim(),
      categoria: document.getElementById("rc-categoria").value,
      tipo: document.getElementById("rc-tipo").value,
      enlace: document.getElementById("rc-enlace").value.trim(),
      descripcion: document.getElementById("rc-descripcion").value.trim(),
      capituloId: capituloIdActivo
    };
    const msg = document.getElementById("form-rc-mensaje");
    const { ok, data } = await api("/api/recursos", { method: "POST", body: JSON.stringify(cuerpo) });
    if (!ok) { msg.className = "form-mensaje error"; msg.textContent = data.error || "No se pudo guardar."; return; }
    cerrarPanel();
    await renderVista();
  });
}

// ---------- Asistencia ----------
async function renderAsistencia(cont) {
  const hoy = new Date().toISOString().slice(0, 10);
  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">Asistencia</div><div class="vista-sub">Pase de lista por reunión</div></div></div>
    <div class="campo-fila" style="max-width:320px;margin-bottom:18px;">
      <div class="campo"><label>Fecha de la reunión</label><input type="date" id="as-fecha" value="${hoy}"></div>
    </div>
    <div class="tabla-wrap" style="margin-bottom:28px;"><table class="tabla-crm"><thead><tr><th>Networker</th><th>Asistió</th><th>Llegó tarde</th><th>Ausente</th><th>Sustituto</th></tr></thead><tbody id="tabla-asistencia"></tbody></table></div>
    <button class="btn-primario" id="btn-guardar-asistencia">Guardar asistencia</button>
    <p class="form-mensaje" id="form-as-mensaje"></p>
    <div class="bloque-secundario" style="margin-top:36px;"><h3>Resumen de asistencia</h3><div id="as-resumen">Cargando…</div></div>`;

  const networkers = await cargarNetworkersCache();
  let registrosExistentes = [];

  async function cargarFila() {
    const fecha = document.getElementById("as-fecha").value;
    const { ok, data } = await api(conCapitulo(`/api/asistencia?fechaReunion=${fecha}`));
    registrosExistentes = ok ? data : [];
    const porTelefono = new Map(registrosExistentes.map((r) => [r.telefono, r]));
    const tbody = document.getElementById("tabla-asistencia");
    if (networkers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="estado-vacio">No hay networkers en este capítulo.</td></tr>`;
      return;
    }
    tbody.innerHTML = networkers.map((n) => {
      const r = porTelefono.get(n.telefono) || {};
      return `<tr data-telefono="${n.telefono}">
        <td><strong>${escapeHtml(n.nombre)}</strong></td>
        <td><input type="checkbox" class="as-asistio" ${r.asistio ? "checked" : ""}></td>
        <td><input type="checkbox" class="as-tarde" ${r.llegoTarde ? "checked" : ""}></td>
        <td><input type="checkbox" class="as-ausente" ${r.ausente ? "checked" : ""}></td>
        <td><input type="checkbox" class="as-sustituto" ${r.envioSustituto ? "checked" : ""}></td>
      </tr>`;
    }).join("");
  }

  await cargarFila();
  document.getElementById("as-fecha").addEventListener("change", cargarFila);

  document.getElementById("btn-guardar-asistencia").addEventListener("click", async () => {
    const fechaReunion = document.getElementById("as-fecha").value;
    const registros = Array.from(document.querySelectorAll("#tabla-asistencia tr")).map((tr) => ({
      telefono: tr.dataset.telefono,
      asistio: tr.querySelector(".as-asistio").checked,
      llegoTarde: tr.querySelector(".as-tarde").checked,
      ausente: tr.querySelector(".as-ausente").checked,
      envioSustituto: tr.querySelector(".as-sustituto").checked
    }));
    const msg = document.getElementById("form-as-mensaje");
    const { ok, data } = await api("/api/asistencia", { method: "POST", body: JSON.stringify({ fechaReunion, registros, capituloId: capituloIdActivo }) });
    if (!ok) { msg.className = "form-mensaje error"; msg.textContent = data.error || "No se pudo guardar."; return; }
    msg.className = "form-mensaje ok";
    msg.textContent = "Asistencia guardada.";
    await renderResumenAsistencia();
  });

  await renderResumenAsistencia();
}

async function renderResumenAsistencia() {
  const zona = document.getElementById("as-resumen");
  if (!zona) return;
  const networkers = await cargarNetworkersCache();
  const nombrePorTelefono = new Map(networkers.map((n) => [n.telefono, n.nombre]));
  const { ok, data } = await api(conCapitulo("/api/asistencia/resumen"));
  if (!ok) { zona.innerHTML = `<p class="vista-sub">${escapeHtml(data.error || "No se pudo cargar el resumen.")}</p>`; return; }
  if (data.ranking.length === 0) {
    zona.innerHTML = `<p class="vista-sub">Todavía no hay asistencia registrada.</p>`;
    return;
  }
  zona.innerHTML = `
    <p class="vista-sub">Asistencia general del capítulo: <strong>${data.porcentajeGeneral}%</strong></p>
    <ul class="ranking-lista">${data.ranking.map((r) => `<li><span>${escapeHtml(nombrePorTelefono.get(r.telefono) || r.telefono)}</span><span class="ranking-puntaje">${r.porcentaje}%</span></li>`).join("")}</ul>
    ${data.alertas.length > 0 ? `<div class="etiquetas-faltantes" style="margin-top:14px;">${data.alertas.map((a) => `<span class="etiqueta-falta">⚠ ${escapeHtml(nombrePorTelefono.get(a.telefono) || a.telefono)}: ${a.porcentaje}%</span>`).join("")}</div>` : ""}
  `;
}

// ---------- Configuración (módulos activos del capítulo) ----------
async function renderConfiguracion(cont) {
  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">Configuración</div><div class="vista-sub">Módulos activos para ${escapeHtml(capituloNombreActivo)}</div></div></div>
    <p class="vista-sub" style="margin-bottom:18px;">Si apagas un módulo aquí, nadie de este capítulo podrá usarlo (ni aunque escriba la URL directamente), sin importar su rol.</p>
    <div class="tabla-wrap"><table class="tabla-crm"><thead><tr><th>Módulo</th><th>Estado</th><th></th></tr></thead><tbody id="tabla-config-modulos">Cargando…</tbody></table></div>`;

  const { ok, data } = await api(`/api/capitulos/${capituloIdActivo}/modulos`);
  const tbody = document.getElementById("tabla-config-modulos");
  if (!ok) {
    tbody.innerHTML = `<tr><td colspan="3" class="estado-vacio">${escapeHtml(data.error || "No se pudo cargar la configuración.")}</td></tr>`;
    return;
  }
  const visibles = data.filter((m) => NOMBRES_MODULO[m.moduloKey]);
  tbody.innerHTML = visibles.map((m) => `
    <tr data-modulo="${m.moduloKey}">
      <td><strong>${escapeHtml(NOMBRES_MODULO[m.moduloKey])}</strong></td>
      <td>${m.activo ? pill("activo", "activo") : pill("desactivado", "suspendido")}</td>
      <td style="text-align:right;">
        <button class="btn-secundario btn-toggle-modulo" data-activo="${m.activo}" style="padding:6px 14px;font-size:12px;">
          ${m.activo ? "Desactivar" : "Activar"}
        </button>
      </td>
    </tr>`).join("");

  tbody.querySelectorAll(".btn-toggle-modulo").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tr = btn.closest("tr");
      const moduloKey = tr.dataset.modulo;
      const activoNuevo = btn.dataset.activo !== "true";
      btn.disabled = true;
      const { ok: okGuardar, data: dataGuardar } = await api(`/api/capitulos/${capituloIdActivo}/modulos`, {
        method: "PUT", body: JSON.stringify({ moduloKey, activo: activoNuevo })
      });
      if (!okGuardar) { alert(dataGuardar.error || "No se pudo actualizar."); btn.disabled = false; return; }
      await renderVista();
    });
  });
}

// ---------- Mensajes ----------
let viendoMensajesEnviados = false;

async function renderMensajes(cont) {
  const puedeEnviar = puede("mensajes", "crear");
  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">Mensajes</div><div class="vista-sub">Comunicados del capítulo</div></div>
    <div style="display:flex;gap:10px;">
      ${puedeEnviar ? `<button class="btn-secundario" id="btn-toggle-mensajes">${viendoMensajesEnviados ? "📥 Ver recibidos" : "📤 Ver enviados"}</button>` : ""}
      ${puedeEnviar ? '<button class="btn-primario" id="btn-nuevo-mensaje">+ Nuevo mensaje</button>' : ""}
    </div></div>
    <div id="lista-mensajes">Cargando…</div>`;

  if (puedeEnviar) {
    document.getElementById("btn-nuevo-mensaje").addEventListener("click", () => abrirFormMensaje());
    document.getElementById("btn-toggle-mensajes").addEventListener("click", async () => {
      viendoMensajesEnviados = !viendoMensajesEnviados;
      await renderVista();
    });
  }

  if (viendoMensajesEnviados && puedeEnviar) {
    await renderMensajesEnviados();
  } else {
    await renderMensajesRecibidos();
  }
}

async function renderMensajesRecibidos() {
  const { ok, data } = await api("/api/mensajes");
  const cont2 = document.getElementById("lista-mensajes");
  if (!ok) { cont2.innerHTML = `<div class="estado-vacio">${escapeHtml(data.error || "No se pudo cargar.")}</div>`; return; }
  if (data.length === 0) { cont2.innerHTML = `<div class="estado-vacio">📭 No tienes mensajes todavía.</div>`; return; }

  cont2.innerHTML = `<div class="tabla-wrap"><table class="tabla-crm"><thead><tr><th></th><th>Asunto</th><th>De</th><th>Fecha</th></tr></thead><tbody id="tabla-mensajes"></tbody></table></div>`;
  const tbody = document.getElementById("tabla-mensajes");
  tbody.innerHTML = data.map((m) => `
    <tr data-id="${m._id}" style="cursor:pointer;${m.leido ? "" : "font-weight:700;"}">
      <td>${m.leido ? "" : pill("nuevo", "invitado")}</td>
      <td>${escapeHtml(m.asunto)}</td>
      <td>${escapeHtml(m.deTelefono)}</td>
      <td>${formatFecha(m.creadoEn)}</td>
    </tr>`).join("");

  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", async () => {
      const m = data.find((x) => x._id === tr.dataset.id);
      if (!m.leido) await api(`/api/mensajes/${m._id}/leido`, { method: "PATCH" });
      abrirPanel(m.asunto, `
        <p class="vista-sub" style="margin-bottom:14px;">De ${escapeHtml(m.deTelefono)} · ${formatFecha(m.creadoEn)}</p>
        <p style="white-space:pre-wrap;line-height:1.6;">${escapeHtml(m.cuerpo)}</p>
        <div class="panel-acciones"><button class="btn-secundario" id="btn-cancelar-panel">Cerrar</button></div>
      `);
      document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);
      if (!m.leido) await renderVista();
    });
  });
}

async function renderMensajesEnviados() {
  const cont2 = document.getElementById("lista-mensajes");
  const [{ ok, data }, { data: esferas }, { data: networkers }] = await Promise.all([
    api(conCapitulo("/api/mensajes/enviados")),
    api(conCapitulo("/api/esferas")),
    api(conCapitulo("/api/networkers"))
  ]);
  const listaEsferas = Array.isArray(esferas) ? esferas : [];
  const listaNetworkers = Array.isArray(networkers) ? networkers : [];

  const describirDestino = (m) => {
    if (m.destinoTipo === "todos") return "Todos los networkers";
    if (m.destinoTipo === "esfera") return `Esfera: ${listaEsferas.find((e) => e._id === m.esferaId)?.nombre || "—"}`;
    return `Individual: ${listaNetworkers.find((n) => n.telefono === m.destinatarioTelefono)?.nombre || m.destinatarioTelefono}`;
  };

  if (!ok) { cont2.innerHTML = `<div class="estado-vacio">${escapeHtml(data.error || "No se pudo cargar.")}</div>`; return; }
  if (data.length === 0) { cont2.innerHTML = `<div class="estado-vacio">📤 Todavía no has enviado ningún mensaje.</div>`; return; }

  cont2.innerHTML = `<div class="tabla-wrap"><table class="tabla-crm"><thead><tr><th>Asunto</th><th>Para</th><th>Fecha</th><th>Leído</th><th></th></tr></thead><tbody id="tabla-mensajes-enviados"></tbody></table></div>`;
  const tbody = document.getElementById("tabla-mensajes-enviados");
  tbody.innerHTML = data.map((m) => `
    <tr data-id="${m._id}">
      <td><strong>${escapeHtml(m.asunto)}</strong></td>
      <td>${escapeHtml(describirDestino(m))}</td>
      <td>${formatFecha(m.creadoEn)}</td>
      <td>${(m.leidoPor || []).length} de ${m.destinatarios.length}</td>
      <td style="text-align:right;"><button class="btn-secundario btn-reenviar-mensaje" style="padding:6px 12px;font-size:12px;">🔁 Reenviar</button></td>
    </tr>`).join("");

  tbody.querySelectorAll(".btn-reenviar-mensaje").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = data.find((x) => x._id === btn.closest("tr").dataset.id);
      abrirFormMensaje(m);
    });
  });
}

async function abrirFormMensaje(mensajeOriginal) {
  const { ok: okEsf, data: esferas } = await api(conCapitulo("/api/esferas"));
  const { ok: okNet, data: networkers } = await api(conCapitulo("/api/networkers"));
  const listaEsferas = okEsf && Array.isArray(esferas) ? esferas : [];
  const listaNetworkers = okNet && Array.isArray(networkers) ? networkers : [];
  const destinoInicial = mensajeOriginal?.destinoTipo || "todos";

  abrirPanel(mensajeOriginal ? "Reenviar mensaje" : "Nuevo mensaje", `
    <div class="campo"><label>Enviar a</label>
      <select id="msg-destino-tipo">
        <option value="todos" ${destinoInicial === "todos" ? "selected" : ""}>Todos los networkers del capítulo</option>
        <option value="esfera" ${destinoInicial === "esfera" ? "selected" : ""}>Una esfera específica</option>
        <option value="individual" ${destinoInicial === "individual" ? "selected" : ""}>Un networker específico</option>
      </select>
    </div>
    <div class="campo" id="msg-campo-esfera" style="display:${destinoInicial === "esfera" ? "block" : "none"};"><label>Esfera</label>
      <select id="msg-esfera">${listaEsferas.map((e) => `<option value="${e._id}" ${mensajeOriginal?.esferaId === e._id ? "selected" : ""}>${escapeHtml(e.nombre)}</option>`).join("")}</select>
    </div>
    <div class="campo" id="msg-campo-networker" style="display:${destinoInicial === "individual" ? "block" : "none"};"><label>Networker</label>
      <select id="msg-networker">${listaNetworkers.map((n) => `<option value="${n.telefono}" ${mensajeOriginal?.destinatarioTelefono === n.telefono ? "selected" : ""}>${escapeHtml(n.nombre)}</option>`).join("")}</select>
    </div>
    <div class="campo"><label>Asunto</label><input id="msg-asunto" value="${escapeHtml(mensajeOriginal?.asunto || "")}"></div>
    <div class="campo"><label>Mensaje</label><textarea id="msg-cuerpo" rows="5">${escapeHtml(mensajeOriginal?.cuerpo || "")}</textarea></div>
    <div class="panel-acciones">
      <button class="btn-primario" id="btn-enviar-mensaje">Enviar</button>
      <button class="btn-secundario" id="btn-cancelar-panel">Cancelar</button>
    </div>
    <p class="form-mensaje" id="form-msg-mensaje"></p>
  `);

  document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);
  document.getElementById("msg-destino-tipo").addEventListener("change", (e) => {
    document.getElementById("msg-campo-esfera").style.display = e.target.value === "esfera" ? "block" : "none";
    document.getElementById("msg-campo-networker").style.display = e.target.value === "individual" ? "block" : "none";
  });

  document.getElementById("btn-enviar-mensaje").addEventListener("click", async () => {
    const destinoTipo = document.getElementById("msg-destino-tipo").value;
    const cuerpo = {
      destinoTipo,
      asunto: document.getElementById("msg-asunto").value.trim(),
      cuerpo: document.getElementById("msg-cuerpo").value.trim(),
      capituloId: capituloIdActivo
    };
    if (destinoTipo === "esfera") cuerpo.esferaId = document.getElementById("msg-esfera").value;
    if (destinoTipo === "individual") cuerpo.destinatarioTelefono = document.getElementById("msg-networker").value;

    const msg = document.getElementById("form-msg-mensaje");
    if (!cuerpo.asunto || !cuerpo.cuerpo) { msg.className = "form-mensaje error"; msg.textContent = "Completa asunto y mensaje."; return; }
    const { ok, data } = await api("/api/mensajes", { method: "POST", body: JSON.stringify(cuerpo) });
    if (!ok) { msg.className = "form-mensaje error"; msg.textContent = data.error || "No se pudo enviar."; return; }
    cerrarPanel();
    alert(`Mensaje enviado a ${data.totalDestinatarios} persona(s).`);
  });
}

// ---------- Mi Perfil ----------
let mpFotoNueva; // undefined = sin cambio, string = nueva dataURL a guardar
let mpLogoNueva;

async function renderMiPerfil(cont) {
  mpFotoNueva = undefined;
  mpLogoNueva = undefined;

  const { ok, data: perfil } = await api("/api/mi-perfil");
  if (!ok) { cont.innerHTML = `<div class="estado-vacio">${escapeHtml(perfil.error || "No se pudo cargar tu perfil.")}</div>`; return; }

  // Las esferas son las del capítulo PROPIO de este perfil, no las del
  // capítulo que el superadmin esté mirando en la barra superior --
  // pueden ser distintos.
  let listaEsferas = [];
  if (perfil.capituloId) {
    const { data: esferas } = await api(`/api/esferas?capituloId=${perfil.capituloId}`);
    listaEsferas = Array.isArray(esferas) ? esferas : [];
  }

  cont.innerHTML = `
    <div class="vista-header"><div><div class="vista-titulo">Mi Perfil</div><div class="vista-sub">Tu información personal y tu tarjeta digital</div></div></div>

    <div class="seccion-perfil">
      <h3>Foto de perfil</h3>
      <div class="foto-perfil-editor">
        <div class="foto-perfil-preview" id="mp-foto-preview">${perfil.fotoPerfil ? `<img src="${perfil.fotoPerfil}" alt="">` : "🧑"}</div>
        <div>
          <input type="file" accept="image/*" id="mp-foto-input" style="display:none;">
          <button type="button" class="btn-secundario" id="mp-btn-foto">Cambiar foto</button>
        </div>
      </div>
    </div>

    <div class="seccion-perfil">
      <h3>Datos personales</h3>
      <div class="campo"><label>Nombre completo</label><input id="mp-nombre" value="${escapeHtml(perfil.nombre)}"></div>
      <div class="campo-fila">
        <div class="campo"><label>Teléfono (tu usuario, no editable aquí)</label><input value="${escapeHtml(perfil.telefono)}" disabled></div>
        <div class="campo"><label>Correo</label><input type="email" id="mp-correo" value="${escapeHtml(perfil.correo || "")}"></div>
      </div>
    </div>

    <div class="seccion-perfil">
      <h3>Empresa y especialidad</h3>
      <div class="campo-fila">
        <div class="campo"><label>Empresa</label><input id="mp-empresa" value="${escapeHtml(perfil.empresa || "")}"></div>
        <div class="campo"><label>Cargo</label><input id="mp-cargo" value="${escapeHtml(perfil.cargo || "")}"></div>
      </div>
      <div class="campo-fila">
        <div class="campo"><label>Especialidad</label><input id="mp-especialidad" value="${escapeHtml(perfil.especialidad || "")}"></div>
        <div class="campo"><label>Categoría BNI</label><input id="mp-categoriabni" value="${escapeHtml(perfil.categoriaBNI || "")}"></div>
      </div>
      <div class="campo-fila">
        <div class="campo"><label>Esfera</label>
          <select id="mp-esfera"><option value="">—</option>${listaEsferas.map((e) => `<option value="${e._id}" ${perfil.esferaId === e._id ? "selected" : ""}>${escapeHtml(e.nombre)}</option>`).join("")}</select>
        </div>
        <div class="campo"><label>Capítulo${esSuperAdmin() ? "" : " (solo lo asigna tu administrador)"}</label>
          ${esSuperAdmin()
            ? `<select id="mp-capitulo"><option value="">Ninguno (solo administración)</option>${capitulosDisponibles.map((c) => `<option value="${c._id}" ${perfil.capituloId === c._id ? "selected" : ""}>${escapeHtml(c.nombre)}</option>`).join("")}</select>`
            : `<input value="${escapeHtml(perfil.capituloNombre || "—")}" disabled>`}
        </div>
      </div>
    </div>

    <div class="seccion-perfil">
      <h3>Datos de contacto</h3>
      <div class="campo-fila">
        <div class="campo"><label>WhatsApp</label><input id="mp-whatsapp" value="${escapeHtml(perfil.whatsapp || "")}"></div>
        <div class="campo"><label>Sitio web</label><input id="mp-sitioweb" value="${escapeHtml(perfil.sitioWeb || "")}"></div>
      </div>
      <div class="campo"><label>Dirección comercial</label><input id="mp-direccion" value="${escapeHtml(perfil.direccionComercial || "")}"></div>
      <div class="campo"><label>Horario de atención</label><input id="mp-horario" value="${escapeHtml(perfil.horarioAtencion || "")}" placeholder="Ej. Lunes a viernes, 8am - 5pm"></div>
    </div>

    <div class="seccion-perfil">
      <h3>Redes sociales</h3>
      <div class="campo-fila">
        <div class="campo"><label>Facebook</label><input id="mp-facebook" value="${escapeHtml(perfil.facebook || "")}"></div>
        <div class="campo"><label>Instagram</label><input id="mp-instagram" value="${escapeHtml(perfil.instagram || "")}"></div>
      </div>
      <div class="campo-fila">
        <div class="campo"><label>LinkedIn</label><input id="mp-linkedin" value="${escapeHtml(perfil.linkedin || "")}"></div>
        <div class="campo"><label>TikTok</label><input id="mp-tiktok" value="${escapeHtml(perfil.tiktok || "")}"></div>
      </div>
    </div>

    <div class="seccion-perfil">
      <h3>Descripción de tu negocio</h3>
      <div class="campo"><label>Descripción de servicios</label><textarea id="mp-descripcion" rows="3">${escapeHtml(perfil.descripcionServicios || "")}</textarea></div>
      <div class="campo"><label>Palabras clave de búsqueda</label><input id="mp-palabrasclave" value="${escapeHtml(perfil.palabrasClave || "")}" placeholder="separadas por coma"></div>
      <div class="foto-perfil-editor">
        <div class="foto-perfil-preview" id="mp-logo-preview">${perfil.logoEmpresa ? `<img src="${perfil.logoEmpresa}" alt="">` : "🏢"}</div>
        <div>
          <input type="file" accept="image/*" id="mp-logo-input" style="display:none;">
          <button type="button" class="btn-secundario" id="mp-btn-logo">Subir logo de empresa</button>
        </div>
      </div>
    </div>

    <div class="panel-acciones" style="margin-bottom:24px;">
      <button type="button" class="btn-primario" id="mp-btn-guardar">Guardar cambios</button>
    </div>
    <p class="form-mensaje" id="mp-mensaje-guardar"></p>

    <div class="seccion-perfil">
      <h3>Tarjeta digital</h3>
      <div id="mp-tarjeta-zona">Cargando…</div>
    </div>

    <div class="seccion-perfil">
      <h3>Seguridad</h3>
      <div class="campo"><label>Contraseña actual</label><input type="password" id="mp-pw-actual"></div>
      <div class="campo-fila">
        <div class="campo"><label>Nueva contraseña</label><input type="password" id="mp-pw-nueva"></div>
        <div class="campo"><label>Confirmar nueva contraseña</label><input type="password" id="mp-pw-confirmar"></div>
      </div>
      <button type="button" class="btn-primario" id="mp-btn-cambiar-password">Cambiar contraseña</button>
      <p class="form-mensaje" id="mp-mensaje-password"></p>
    </div>
  `;

  // ---- foto / logo ----
  document.getElementById("mp-btn-foto").addEventListener("click", () => document.getElementById("mp-foto-input").click());
  document.getElementById("mp-foto-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      mpFotoNueva = await recortarYComprimirCuadrado(file, 400, 0.8);
      document.getElementById("mp-foto-preview").innerHTML = `<img src="${mpFotoNueva}" alt="">`;
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById("mp-btn-logo").addEventListener("click", () => document.getElementById("mp-logo-input").click());
  document.getElementById("mp-logo-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      mpLogoNueva = await recortarYComprimirCuadrado(file, 400, 0.8);
      document.getElementById("mp-logo-preview").innerHTML = `<img src="${mpLogoNueva}" alt="">`;
    } catch (error) {
      alert(error.message);
    }
  });

  // ---- guardar perfil ----
  document.getElementById("mp-btn-guardar").addEventListener("click", async () => {
    const msg = document.getElementById("mp-mensaje-guardar");
    const cuerpo = {
      nombre: document.getElementById("mp-nombre").value.trim(),
      correo: document.getElementById("mp-correo").value.trim(),
      empresa: document.getElementById("mp-empresa").value.trim(),
      cargo: document.getElementById("mp-cargo").value.trim(),
      especialidad: document.getElementById("mp-especialidad").value.trim(),
      categoriaBNI: document.getElementById("mp-categoriabni").value.trim(),
      esferaId: document.getElementById("mp-esfera").value || null,
      whatsapp: document.getElementById("mp-whatsapp").value.trim(),
      sitioWeb: document.getElementById("mp-sitioweb").value.trim(),
      direccionComercial: document.getElementById("mp-direccion").value.trim(),
      horarioAtencion: document.getElementById("mp-horario").value.trim(),
      facebook: document.getElementById("mp-facebook").value.trim(),
      instagram: document.getElementById("mp-instagram").value.trim(),
      linkedin: document.getElementById("mp-linkedin").value.trim(),
      tiktok: document.getElementById("mp-tiktok").value.trim(),
      descripcionServicios: document.getElementById("mp-descripcion").value.trim(),
      palabrasClave: document.getElementById("mp-palabrasclave").value.trim()
    };
    if (mpFotoNueva !== undefined) cuerpo.fotoPerfil = mpFotoNueva;
    if (mpLogoNueva !== undefined) cuerpo.logoEmpresa = mpLogoNueva;
    const selectorCapitulo = document.getElementById("mp-capitulo");
    const capituloCambio = esSuperAdmin() && selectorCapitulo && selectorCapitulo.value !== (perfil.capituloId || "");
    if (selectorCapitulo) cuerpo.capituloId = selectorCapitulo.value || null;

    const { ok: okGuardar, data: dataGuardar } = await api("/api/mi-perfil", { method: "PUT", body: JSON.stringify(cuerpo) });
    if (!okGuardar) { msg.className = "form-mensaje error"; msg.textContent = dataGuardar.error || "No se pudo guardar."; return; }
    msg.className = "form-mensaje ok";
    msg.textContent = "Perfil actualizado. Tu tarjeta digital ya refleja estos cambios.";
    if (capituloCambio) { await renderVista(); return; }
    await renderTarjetaMiPerfil();
  });

  // ---- cambiar contraseña ----
  document.getElementById("mp-btn-cambiar-password").addEventListener("click", async () => {
    const msg = document.getElementById("mp-mensaje-password");
    const cuerpo = {
      contrasenaActual: document.getElementById("mp-pw-actual").value.trim(),
      nuevaContrasena: document.getElementById("mp-pw-nueva").value.trim(),
      confirmarContrasena: document.getElementById("mp-pw-confirmar").value.trim()
    };
    const { ok: okPw, data: dataPw } = await api("/api/mi-perfil/password", { method: "PUT", body: JSON.stringify(cuerpo) });
    if (!okPw) { msg.className = "form-mensaje error"; msg.textContent = dataPw.error || "No se pudo cambiar la contraseña."; return; }
    msg.className = "form-mensaje ok";
    msg.textContent = "Contraseña actualizada correctamente.";
    document.getElementById("mp-pw-actual").value = "";
    document.getElementById("mp-pw-nueva").value = "";
    document.getElementById("mp-pw-confirmar").value = "";
  });

  await renderTarjetaMiPerfil(perfil);
}

const TEMAS_TARJETA = [
  { id: "bni", nombre: "BNI Clásico", from: "#0F1B3D", to: "#1B2A57", acento: "#D9A441" },
  { id: "esmeralda", nombre: "Esmeralda", from: "#064E3B", to: "#0D9467", acento: "#34D399" },
  { id: "electrico", nombre: "Eléctrico", from: "#0C2D6B", to: "#1554C4", acento: "#38BDF8" },
  { id: "editorial", nombre: "Editorial", from: "#18181B", to: "#3F3F46", acento: "#F97316" },
  { id: "violeta", nombre: "Violeta", from: "#3B0764", to: "#7E22CE", acento: "#F472B6" }
];

// La vista previa es un iframe a la propia tarjeta pública -- nunca se
// desincroniza de lo que ve cualquiera con el link, porque es literalmente
// la misma página, no una copia del diseño mantenida por separado.
async function renderTarjetaMiPerfil(perfilArg) {
  const zona = document.getElementById("mp-tarjeta-zona");
  const { ok, data: perfil } = perfilArg ? { ok: true, data: perfilArg } : await api("/api/mi-perfil");
  if (!ok) { zona.innerHTML = `<div class="estado-vacio">No se pudo cargar tu tarjeta.</div>`; return; }

  if (perfil.tarjetaDigitalActiva === false) {
    zona.innerHTML = `<div class="estado-vacio">🚫 Tu tarjeta digital está desactivada. Contacta a tu administrador de capítulo.</div>`;
    return;
  }

  const enlace = `${location.origin}/card/${perfil.slug}`;
  const temaActual = perfil.temaTarjeta || "bni";
  const modoActual = perfil.modoColorPreferido || "claro";

  zona.innerHTML = `
    <div class="campo">
      <label>Tema de color</label>
      <div class="muestras-tema" id="muestras-tema">
        ${TEMAS_TARJETA.map((t) => `
          <button type="button" class="muestra-tema ${t.id === temaActual ? "seleccionada" : ""}" data-tema="${t.id}" title="${escapeHtml(t.nombre)}"
            style="background:linear-gradient(135deg, ${t.from}, ${t.to});">
            <span class="muestra-acento" style="background:${t.acento};"></span>
          </button>`).join("")}
      </div>
    </div>
    <div class="campo-checkbox" style="margin-bottom:18px;">
      <input type="checkbox" id="mp-modo-oscuro" ${modoActual === "oscuro" ? "checked" : ""}>
      <label for="mp-modo-oscuro" style="margin:0;">Mostrar mi tarjeta en modo oscuro</label>
    </div>
    <div class="tarjeta-preview-frame">
      <iframe id="mp-iframe-preview" src="${enlace}" title="Vista previa de tu tarjeta"></iframe>
    </div>
    <div class="tarjeta-preview-link">
      <code>${escapeHtml(enlace)}</code>
    </div>
    <div class="panel-acciones">
      <button type="button" class="btn-secundario" id="mp-btn-copiar-link">🔗 Copiar link</button>
      <button type="button" class="btn-secundario" id="mp-btn-descargar-qr">⬇️ Descargar QR</button>
      <a class="btn-primario" href="${enlace}" target="_blank" rel="noopener" style="text-decoration:none;">Ver tarjeta pública →</a>
    </div>
    <canvas id="mp-qr-canvas" style="display:none;"></canvas>
  `;

  const guardarApariencia = async (cambios) => {
    await api("/api/mi-perfil", { method: "PUT", body: JSON.stringify(cambios) });
    document.getElementById("mp-iframe-preview").src = enlace; // recarga para reflejar el cambio
  };
  document.querySelectorAll(".muestra-tema").forEach((btn) => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".muestra-tema").forEach((b) => b.classList.remove("seleccionada"));
      btn.classList.add("seleccionada");
      await guardarApariencia({ temaTarjeta: btn.dataset.tema });
    });
  });
  document.getElementById("mp-modo-oscuro").addEventListener("change", async (e) => {
    await guardarApariencia({ modoColorPreferido: e.target.checked ? "oscuro" : "claro" });
  });

  if (await asegurarQRCode()) {
    QRCode.toCanvas(document.getElementById("mp-qr-canvas"), enlace, { width: 280, margin: 1, color: { dark: "#0F1B3D" } });
  }

  document.getElementById("mp-btn-copiar-link").addEventListener("click", async (e) => {
    await navigator.clipboard.writeText(enlace);
    const btn = e.currentTarget;
    const original = btn.textContent;
    btn.textContent = "✅ Copiado";
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
  document.getElementById("mp-btn-descargar-qr").addEventListener("click", () => {
    const canvas = document.getElementById("mp-qr-canvas");
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `qr-${perfil.slug}.png`;
    a.click();
  });
}

// ---------- Tour guiado ----------
// Recorre solo los módulos que esta persona realmente puede ver (mismo
// filtro que el menú lateral), así nadie ve un paso de un módulo al que
// no tiene acceso. Se guarda en localStorage por teléfono para no
// repetirlo solo en este navegador; "Tour guiado" en el menú lo vuelve a
// lanzar cuando quieran.
const DESCRIPCION_MODULO_TOUR = {
  dashboard: "El resumen de tu capítulo: GPNC total, visitantes, referencias, 1 a 1 realizados, ranking de miembros y qué esferas todavía no están cubiertas.",
  capitulos: "Aquí creas y administras los capítulos de la plataforma. Cada capítulo tiene su propia información, separada de los demás.",
  usuarios: "Administra quién tiene acceso al sistema y con qué rol: administradores, sub-administradores (co-administradores de tu capítulo) y networkers. También puedes ajustar permisos puntuales por persona.",
  networkers: "El directorio de miembros del capítulo. Busca por nombre, empresa o esfera, y contáctalos directo con los botones de WhatsApp, llamada o correo.",
  tarjetas: "Aquí ves si cada networker ya configuró su tarjeta digital personal, y sus estadísticas de vistas y veces compartida.",
  esferas: "Las industrias que cubre tu capítulo. El sistema te avisa cuáles todavía no tienen ningún networker asignado.",
  referencias: "Registra los negocios que te recomiendan o que tú le diste a otro networker. Solo ves las que te involucran a ti.",
  gpnc: "Gracias Por Negocio Concretado: registra cuando una referencia se convierte en un negocio real cerrado, con el monto.",
  unoauno: "Agenda tus reuniones individuales con otros networkers para conocerse mejor y encontrar oportunidades de negocio.",
  visitantes: "Registra a las personas que invitas a una reunión y da seguimiento hasta que se conviertan en miembros. Solo ves los que tú invitaste.",
  invitados: "Landing pages de captación: genera un enlace único por networket con un video y FOMO. Cada prospecto que se registra llega aquí con su nombre, profesión, teléfono y correo.",
  calendario: "El calendario del capítulo: reuniones semanales, capacitaciones, lanzamientos. Cada networker puede agendar y editar lo suyo; el administrador gestiona todo.",
  capacitacion: "Material y sesiones de formación organizadas por el administrador del capítulo, con seguimiento del avance de cada persona.",
  recursos: "Biblioteca de enlaces útiles para el capítulo: manuales, plantillas, videos.",
  asistencia: "El control de asistencia a las reuniones, con el porcentaje de cada networker y alertas de baja asistencia.",
  mensajes: "Comunicados del capítulo: el administrador puede escribirle a todos, a una esfera, o a un networker puntual.",
  configuracion: "Aquí el administrador puede prender o apagar módulos completos para todo el capítulo.",
  "mi-perfil": "Tu información personal, tu empresa, redes sociales y tu tarjeta digital con QR -- todo en un solo lugar, y se actualiza junto con tu tarjeta automáticamente."
};

let tourPasos = [];
let tourIndice = 0;

function construirPasosTour() {
  const modulos = SECCIONES.filter((s) =>
    !s.proximamente &&
    (!s.soloSuperAdmin || esSuperAdmin()) &&
    (!s.soloNetworker || usuarioActual.rol === "networker" || esSuperAdmin()) &&
    (s.soloNetworker || puedeVer(s.id))
  );
  return [
    { titulo: "Bienvenido al CRM BNI", texto: "Este recorrido te muestra para qué sirve cada sección del menú. Puedes cerrarlo cuando quieras y volver a verlo después desde \"Tour guiado\".", target: null },
    ...modulos.map((s) => ({ titulo: `${s.icono} ${s.label}`, texto: DESCRIPCION_MODULO_TOUR[s.id] || "", target: `.sidebar-item[data-vista="${s.id}"]` })),
    { titulo: "¡Listo!", texto: "Ya conoces el sistema. Explora con confianza -- y si algo no te deja hacer algo, probablemente sea por tu rol o porque el administrador lo desactivó para tu capítulo.", target: null }
  ];
}

function iniciarTour() {
  tourPasos = construirPasosTour();
  tourIndice = 0;
  mostrarPasoTour();
}

function limpiarResaltadoTour() {
  document.querySelectorAll(".tour-resaltado").forEach((el) => el.classList.remove("tour-resaltado"));
}

function cerrarTour() {
  limpiarResaltadoTour();
  document.getElementById("tour-overlay-dim").classList.remove("visible");
  document.getElementById("tour-card").classList.remove("visible");
  if (usuarioActual) localStorage.setItem(`tourCompletado_${usuarioActual.telefono}`, "true");
}

function posicionarCardTour(targetEl) {
  const card = document.getElementById("tour-card");
  const esMovil = window.innerWidth <= 880;
  if (!targetEl) {
    card.style.transform = "translate(-50%, -50%)";
    card.style.top = "50%";
    card.style.left = "50%";
    return;
  }
  targetEl.classList.add("tour-resaltado");
  targetEl.scrollIntoView({ block: "center", behavior: "smooth" });
  card.style.transform = "none";
  const r = targetEl.getBoundingClientRect();
  if (esMovil) {
    card.style.top = `${Math.min(r.bottom + 12, window.innerHeight - 220)}px`;
    card.style.left = "16px";
  } else {
    card.style.top = `${Math.max(16, Math.min(r.top, window.innerHeight - 240))}px`;
    card.style.left = `${r.right + 16}px`;
  }
}

function mostrarPasoTour() {
  limpiarResaltadoTour();
  const paso = tourPasos[tourIndice];
  const esMovil = window.innerWidth <= 880;

  if (paso.target) {
    if (esMovil) abrirSidebarMovil();
  } else if (esMovil) {
    cerrarSidebarMovil();
  }

  const overlay = document.getElementById("tour-overlay-dim");
  const card = document.getElementById("tour-card");
  overlay.classList.add("visible");
  card.classList.add("visible");

  card.innerHTML = `
    <div class="tour-card-paso">Paso ${tourIndice + 1} de ${tourPasos.length}</div>
    <div class="tour-card-titulo">${escapeHtml(paso.titulo)}</div>
    <div class="tour-card-texto">${escapeHtml(paso.texto)}</div>
    <div class="tour-card-botones">
      <button type="button" class="btn-tour-cerrar" id="btn-tour-cerrar">Cerrar tour</button>
      <div class="tour-card-nav">
        ${tourIndice > 0 ? '<button type="button" class="btn-secundario" id="btn-tour-anterior">Anterior</button>' : ""}
        <button type="button" class="btn-primario" id="btn-tour-siguiente">${tourIndice === tourPasos.length - 1 ? "Terminar" : "Siguiente"}</button>
      </div>
    </div>`;

  // En móvil, abrir el drawer del sidebar dispara una transición CSS de
  // 0.2s; medir la posición del elemento antes de que termine daría una
  // posición a medio camino. En escritorio el sidebar ya está visible, no
  // hace falta esperar.
  if (paso.target && esMovil) {
    setTimeout(() => posicionarCardTour(document.querySelector(paso.target)), 220);
  } else {
    posicionarCardTour(paso.target ? document.querySelector(paso.target) : null);
  }

  document.getElementById("btn-tour-cerrar").addEventListener("click", cerrarTour);
  const btnSiguiente = document.getElementById("btn-tour-siguiente");
  btnSiguiente.addEventListener("click", () => {
    if (tourIndice === tourPasos.length - 1) { cerrarTour(); return; }
    tourIndice++;
    mostrarPasoTour();
  });
  const btnAnterior = document.getElementById("btn-tour-anterior");
  if (btnAnterior) {
    btnAnterior.addEventListener("click", () => {
      tourIndice--;
      mostrarPasoTour();
    });
  }
}

document.getElementById("tour-overlay-dim").addEventListener("click", cerrarTour);
document.getElementById("btn-tour").addEventListener("click", iniciarTour);

iniciar();
