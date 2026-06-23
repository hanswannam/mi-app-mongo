// --- CRM BNI: shell, navegación y vistas de la Fase 1 ---
// Reutiliza las mismas cookies/sesión del Worker que la PWA de tarjetas;
// es una superficie nueva, no toca nada de /public/app.js.

import { whatsappUrl } from "../src/utils/contactLinks.js";

let usuarioActual = null;
let capitulosDisponibles = [];
let capituloIdActivo = null;
let capituloNombreActivo = "";
let esferasCache = [];
let vistaActiva = "dashboard";
let misPermisos = {}; // { moduloKey: ["ver","crear",...] }, ver cargarMisPermisos()

const SECCIONES = [
  { id: "dashboard", label: "Dashboard", icono: "📊" },
  { id: "capitulos", label: "Capítulos", icono: "🏷️", soloSuperAdmin: true },
  { id: "networkers", label: "Networkers", icono: "👥" },
  { id: "tarjetas", label: "Tarjetas Digitales", icono: "💳" },
  { id: "esferas", label: "Esferas", icono: "🧭" },
  { id: "referencias", label: "Referencias", icono: "🔗" },
  { id: "gpnc", label: "GPNC", icono: "🤝" },
  { id: "unoauno", label: "Uno a Uno", icono: "☕" },
  { id: "visitantes", label: "Visitantes", icono: "🚪" },
  { id: "calendario", label: "Calendario", icono: "📅" },
  { id: "capacitacion", label: "Capacitación", icono: "🎓" },
  { id: "recursos", label: "Recursos", icono: "📚" },
  { id: "asistencia", label: "Asistencia", icono: "✅" },
  { id: "metas", label: "Metas", icono: "🎯", proximamente: true },
  { id: "reportes", label: "Reportes", icono: "📈", proximamente: true },
  { id: "configuracion", label: "Configuración", icono: "⚙️" }
];

const NOMBRES_MODULO = {
  dashboard: "Dashboard", networkers: "Networkers", tarjetas: "Tarjetas Digitales", esferas: "Esferas",
  referencias: "Referencias", gpnc: "GPNC", unoauno: "Uno a Uno", visitantes: "Visitantes",
  calendario: "Calendario", capacitacion: "Capacitación", recursos: "Recursos", asistencia: "Asistencia",
  metas: "Metas", rankings: "Rankings", reportes: "Reportes"
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

  renderTopbarCapitulo();
  renderSidebar();
  renderBottomNav();
  await renderVista();
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

function renderSidebar() {
  const nav = document.getElementById("sidebar-nav");
  nav.innerHTML = SECCIONES.filter((s) => (!s.soloSuperAdmin || esSuperAdmin()) && (s.proximamente || puedeVer(s.id)))
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
  if (!capituloIdActivo && vistaActiva !== "capitulos") {
    cont.innerHTML = `<div class="estado-vacio"><div class="icono">🏷️</div>No hay un capítulo activo. ${esSuperAdmin() ? "Crea uno en la sección Capítulos." : "Contacta a tu administrador."}</div>`;
    return;
  }
  const renderers = {
    dashboard: renderDashboard,
    capitulos: renderCapitulos,
    networkers: renderNetworkers,
    tarjetas: renderTarjetas,
    esferas: renderEsferas,
    visitantes: renderVisitantes,
    gpnc: renderGpnc,
    unoauno: renderUnoAUno,
    referencias: renderReferencias,
    calendario: renderCalendario,
    capacitacion: renderCapacitacion,
    recursos: renderRecursos,
    asistencia: renderAsistencia,
    configuracion: renderConfiguracion
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
    <div class="panel-acciones">
      <button class="btn-primario" id="btn-guardar-networker">Guardar</button>
      <button class="btn-secundario" id="btn-cancelar-panel">Cancelar</button>
    </div>
    ${!esEdicion ? '<p class="form-mensaje">Si el teléfono no tiene cuenta todavía, podrá activarla luego registrándose en la app con este mismo número.</p>' : ""}
    <p class="form-mensaje" id="form-nw-mensaje"></p>
  `);
  document.getElementById("btn-cancelar-panel").addEventListener("click", cerrarPanel);
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
    const msg = document.getElementById("form-nw-mensaje");
    if (!telefono) { msg.className = "form-mensaje error"; msg.textContent = "El teléfono es obligatorio."; return; }
    const { ok, data } = await api(`/api/networkers/${telefono}`, { method: "PUT", body: JSON.stringify(cuerpo) });
    if (!ok) { msg.className = "form-mensaje error"; msg.textContent = data.error || "No se pudo guardar."; return; }
    cerrarPanel();
    await renderVista();
  });
}

// ---------- Tarjetas digitales (reutiliza la PWA existente) ----------
function renderTarjetas(cont) {
  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">Tarjetas Digitales</div><div class="vista-sub">Billetera de Networkers</div></div></div>
    <div class="placeholder-fase">
      <p style="font-size:15px;color:var(--texto);margin-bottom:18px;">Cada networker ya tiene su propia tarjeta digital, QR personal y directorio de contactos en la app de Billetera. El CRM no la reemplaza: la reutiliza.</p>
      <a class="btn-primario" style="text-decoration:none;display:inline-block;" href="/" target="_blank" rel="noopener">Abrir mi Tarjeta Digital →</a>
    </div>`;
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

function abrirFormUnoAUno(registro) {
  const esEdicion = Boolean(registro);
  abrirPanel(esEdicion ? "Editar 1 a 1" : "Agendar 1 a 1", `
    ${!esEdicion ? '<div class="campo"><label>Teléfono del otro participante</label><input id="uo-participante2"></div>' :
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
  tbody.innerHTML = data.map((a) => `
    <tr>
      <td>${formatFecha(a.fecha)} ${escapeHtml(a.hora || "")}</td>
      <td>${pill(a.tipo.replace(/_/g, " "), a.completado ? "activo" : "programado")}</td>
      <td style="cursor:pointer;" data-id="${a._id}" class="td-editar-evento"><strong>${escapeHtml(a.titulo)}</strong></td>
      <td>${escapeHtml(a.lugarOLink || "—")}</td>
      <td style="text-align:right;"><button class="btn-secundario btn-eliminar-evento" data-id="${a._id}" style="padding:6px 12px;font-size:12px;">Eliminar</button></td>
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

iniciar();
