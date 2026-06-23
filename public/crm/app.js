// --- CRM BNI: shell, navegación y vistas de la Fase 1 ---
// Reutiliza las mismas cookies/sesión del Worker que la PWA de tarjetas;
// es una superficie nueva, no toca nada de /public/app.js.

let usuarioActual = null;
let capitulosDisponibles = [];
let capituloIdActivo = null;
let capituloNombreActivo = "";
let esferasCache = [];
let vistaActiva = "dashboard";

const SECCIONES = [
  { id: "dashboard", label: "Dashboard", icono: "📊" },
  { id: "capitulos", label: "Capítulos", icono: "🏷️", soloSuperAdmin: true },
  { id: "networkers", label: "Networkers", icono: "👥" },
  { id: "tarjetas", label: "Tarjetas Digitales", icono: "💳" },
  { id: "esferas", label: "Esferas", icono: "🧭" },
  { id: "referencias", label: "Referencias", icono: "🔗", proximamente: true },
  { id: "gpnc", label: "GPNC", icono: "🤝" },
  { id: "unoauno", label: "Uno a Uno", icono: "☕" },
  { id: "visitantes", label: "Visitantes", icono: "🚪" },
  { id: "calendario", label: "Calendario", icono: "📅", proximamente: true },
  { id: "capacitacion", label: "Capacitación", icono: "🎓", proximamente: true },
  { id: "recursos", label: "Recursos", icono: "📚", proximamente: true },
  { id: "asistencia", label: "Asistencia", icono: "✅", proximamente: true },
  { id: "metas", label: "Metas", icono: "🎯", proximamente: true },
  { id: "reportes", label: "Reportes", icono: "📈", proximamente: true },
  { id: "configuracion", label: "Configuración", icono: "⚙️", proximamente: true }
];

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

async function mostrarApp() {
  document.getElementById("pantalla-login").style.display = "none";
  document.getElementById("app").style.display = "flex";
  document.getElementById("topbar-nombre").textContent = usuarioActual.nombre;
  document.getElementById("topbar-rol").textContent = usuarioActual.rol;

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
  nav.innerHTML = SECCIONES.filter((s) => !s.soloSuperAdmin || esSuperAdmin())
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
      renderSidebar();
      await renderVista();
    });
  });
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
    unoauno: renderUnoAUno
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

async function renderNetworkers(cont) {
  cont.innerHTML = `<div class="vista-header"><div><div class="vista-titulo">Networkers</div><div class="vista-sub">Miembros del capítulo</div></div>
    <button class="btn-primario" id="btn-nuevo-networker">+ Agregar networker</button></div>
    <div class="tabla-wrap"><table class="tabla-crm"><thead><tr><th>Nombre</th><th>Empresa</th><th>Esfera</th><th>Estado</th><th>Teléfono</th></tr></thead><tbody id="tabla-networkers"></tbody></table></div>`;

  await cargarEsferasCache();
  document.getElementById("btn-nuevo-networker").addEventListener("click", () => abrirFormNetworker(null));

  const { ok, data } = await api(conCapitulo("/api/networkers"));
  const tbody = document.getElementById("tabla-networkers");
  if (!ok || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="estado-vacio">Todavía no hay networkers en este capítulo.</td></tr>`;
    return;
  }
  const esferaNombre = (id) => esferasCache.find((e) => e._id === id)?.nombre || "—";
  tbody.innerHTML = data.map((n) => `
    <tr data-telefono="${n.telefono}" style="cursor:pointer;">
      <td><strong>${escapeHtml(n.nombre)}</strong></td>
      <td>${escapeHtml(n.empresa || "—")}</td>
      <td>${escapeHtml(esferaNombre(n.esferaId))}</td>
      <td>${pill(n.estadoNetworker || "prospecto", n.estadoNetworker || "prospecto")}</td>
      <td>${escapeHtml(n.telefono)}</td>
    </tr>`).join("");
  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => abrirFormNetworker(data.find((n) => n.telefono === tr.dataset.telefono)));
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

function abrirFormGpnc() {
  abrirPanel("Registrar GPNC", `
    <div class="campo"><label>Networker que generó la referencia (teléfono)</label><input id="gp-genero"></div>
    <div class="campo"><label>Cliente</label><input id="gp-cliente"></div>
    <div class="campo"><label>Descripción del negocio</label><textarea id="gp-descripcion" rows="2"></textarea></div>
    <div class="campo-fila">
      <div class="campo"><label>Monto</label><input type="number" min="0" step="0.01" id="gp-monto"></div>
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

iniciar();
