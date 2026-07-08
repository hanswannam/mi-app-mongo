import { handleListCategorias, handleCrearCategoria, handleEliminarCategoria } from "./categorias.js";
import { handleOcr } from "./ocr.js";
import { handleRegistrarEvento, handleEstadisticasTarjeta } from "./eventos.js";
import { handleRegistro, handleLogin, handleRecuperarContacto, handleLogout, handleYo } from "./auth.js";
import {
  handleGuardarApiKey,
  handleActualizarUsuario,
  handleObtenerMiPerfil,
  handleActualizarMiPerfil,
  handleCambiarMiPassword
} from "./usuarios.js";
import {
  handleListTarjetas,
  handleCreateTarjeta,
  handleUpdateTarjeta,
  handleDirectorio,
  handleGetTarjeta,
  handleTarjetaPublica,
  handleEnviarTarjeta
} from "./tarjetas.js";
import { handleCrearInvitacion, handleVerInvitacion, handleActivarInvitacion } from "./invitaciones.js";
import {
  handleListUsuarios,
  handleResumenAdmin,
  handleCambiarEstado,
  handleCambiarRol,
  handleAdminEditarUsuario
} from "./admin.js";
import {
  handleListCapitulos,
  handleCrearCapitulo,
  handleObtenerCapitulo,
  handleActualizarCapitulo
} from "./capitulos.js";
import {
  handleListNetworkers,
  handleObtenerNetworker,
  handleGuardarNetworker,
  handleDirectorioPublico,
  handleNetworkersConTarjetas,
  handleObtenerCardPublico,
  handleRegenerarSlugNetworker
} from "./networkers.js";
import {
  handleListEsferas,
  handleCrearEsfera,
  handleEliminarEsfera,
  handleCoberturaEsferas
} from "./esferas.js";
import {
  handleListVisitantes,
  handleCrearVisitante,
  handleActualizarVisitante,
  handleResumenVisitantes,
  handleAutoRegistroVisitante
} from "./visitantes.js";
import {
  handleListGpnc,
  handleCrearGpnc,
  handleEliminarGpnc,
  handleResumenGpnc
} from "./gpnc.js";
import {
  handleListUnoAUno,
  handleCrearUnoAUno,
  handleActualizarUnoAUno,
  handleResumenUnoAUno
} from "./unoauno.js";
import { handleResumenDashboard } from "./dashboard.js";
import {
  handleListReferencias,
  handleCrearReferencia,
  handleActualizarReferencia,
  handleResumenReferencias
} from "./referencias.js";
import {
  handleListAgenda,
  handleCrearAgenda,
  handleActualizarAgenda,
  handleEliminarAgenda
} from "./agenda.js";
import {
  handleListCapacitaciones,
  handleCrearCapacitacion,
  handleActualizarCapacitacion,
  handleMarcarAvance
} from "./capacitaciones.js";
import { handleListRecursos, handleCrearRecurso, handleEliminarRecurso } from "./recursos.js";
import { handleListAsistencia, handleGuardarAsistencia, handleResumenAsistencia } from "./asistencia.js";
import {
  handleMisPermisos,
  handleListCapituloModulos,
  handleGuardarCapituloModulo,
  handleListPermisosUsuario,
  handleGuardarPermisoUsuario
} from "./permisos.js";
import {
  handleListUsuariosSistema,
  handleOpcionesRoles,
  handleGuardarUsuarioSistema,
  handleCambiarEstadoUsuarioSistema,
  handleRestablecerPasswordUsuario,
  handleVerComoUsuario,
  handleSalirVerComo
} from "./usuariosSistema.js";
import {
  handleListMensajes,
  handleListMensajesEnviados,
  handleCrearMensaje,
  handleMarcarMensajeLeido
} from "./mensajes.js";
import {
  handleRegistrarInvitadoFunnel,
  handleListInvitadosFunnel,
  handleActualizarInvitadoFunnel
} from "./invitados_funnel.js";

export async function enrutar(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const metodo = request.method;

  if (pathname === "/api/auth/registro" && metodo === "POST") return handleRegistro(request, env);
  if (pathname === "/api/auth/login" && metodo === "POST") return handleLogin(request, env);
  if (pathname === "/api/auth/logout" && metodo === "POST") return handleLogout();
  if (pathname === "/api/auth/yo" && metodo === "GET") return handleYo(request, env);

  const matchRecuperar = pathname.match(/^\/api\/auth\/recuperar\/([^/]+)$/);
  if (matchRecuperar && metodo === "GET") return handleRecuperarContacto(request, env, decodeURIComponent(matchRecuperar[1]));
  if (pathname === "/api/usuario" && metodo === "PUT") return handleActualizarUsuario(request, env);
  if (pathname === "/api/usuario/openai-key" && metodo === "PUT") return handleGuardarApiKey(request, env);

  if (pathname === "/api/mi-perfil" && metodo === "GET") return handleObtenerMiPerfil(request, env);
  if (pathname === "/api/mi-perfil" && metodo === "PUT") return handleActualizarMiPerfil(request, env);
  if (pathname === "/api/mi-perfil/password" && metodo === "PUT") return handleCambiarMiPassword(request, env);

  if (pathname === "/api/tarjetas" && metodo === "GET") return handleListTarjetas(request, env);
  if (pathname === "/api/tarjetas" && metodo === "POST") return handleCreateTarjeta(request, env);

  const matchTarjetaId = pathname.match(/^\/api\/tarjetas\/([^/]+)$/);
  if (matchTarjetaId && metodo === "GET") return handleGetTarjeta(request, env, decodeURIComponent(matchTarjetaId[1]));
  if (matchTarjetaId && metodo === "PUT") return handleUpdateTarjeta(request, env, decodeURIComponent(matchTarjetaId[1]));

  const matchEstadisticas = pathname.match(/^\/api\/tarjetas\/([^/]+)\/estadisticas$/);
  if (matchEstadisticas && metodo === "GET") return handleEstadisticasTarjeta(request, env, decodeURIComponent(matchEstadisticas[1]));

  const matchInvitar = pathname.match(/^\/api\/tarjetas\/([^/]+)\/invitar$/);
  if (matchInvitar && metodo === "POST") return handleCrearInvitacion(request, env, decodeURIComponent(matchInvitar[1]));

  const matchEnviar = pathname.match(/^\/api\/tarjetas\/([^/]+)\/enviar$/);
  if (matchEnviar && metodo === "POST") return handleEnviarTarjeta(request, env, decodeURIComponent(matchEnviar[1]));

  const matchVerInvitacion = pathname.match(/^\/api\/invitaciones\/([^/]+)$/);
  if (matchVerInvitacion && metodo === "GET") return handleVerInvitacion(env, decodeURIComponent(matchVerInvitacion[1]));

  const matchActivarInvitacion = pathname.match(/^\/api\/invitaciones\/([^/]+)\/activar$/);
  if (matchActivarInvitacion && metodo === "POST") return handleActivarInvitacion(request, env, decodeURIComponent(matchActivarInvitacion[1]));

  if (pathname === "/api/directorio" && metodo === "GET") return handleDirectorio(request, env);

  const matchTarjetaPublica = pathname.match(/^\/api\/tarjeta-publica\/([^/]+)$/);
  if (matchTarjetaPublica && metodo === "GET") return handleTarjetaPublica(env, decodeURIComponent(matchTarjetaPublica[1]));

  const matchEvento = pathname.match(/^\/api\/eventos-tarjeta\/([^/]+)$/);
  if (matchEvento && metodo === "POST") return handleRegistrarEvento(request, env, decodeURIComponent(matchEvento[1]));

  if (pathname === "/api/ocr" && metodo === "POST") return handleOcr(request, env);

  if (pathname === "/api/categorias" && metodo === "GET") return handleListCategorias(request, env);
  if (pathname === "/api/admin/categorias" && metodo === "POST") return handleCrearCategoria(request, env);

  const matchCategoriaId = pathname.match(/^\/api\/admin\/categorias\/([^/]+)$/);
  if (matchCategoriaId && metodo === "DELETE") return handleEliminarCategoria(request, env, decodeURIComponent(matchCategoriaId[1]));

  if (pathname === "/api/admin/usuarios" && metodo === "GET") return handleListUsuarios(request, env);
  if (pathname === "/api/admin/resumen" && metodo === "GET") return handleResumenAdmin(request, env);

  const matchRol = pathname.match(/^\/api\/admin\/usuarios\/([^/]+)\/rol$/);
  if (matchRol && metodo === "PATCH") return handleCambiarRol(request, env, decodeURIComponent(matchRol[1]));

  const matchEstado = pathname.match(/^\/api\/admin\/usuarios\/([^/]+)\/estado$/);
  if (matchEstado && metodo === "PATCH") return handleCambiarEstado(request, env, decodeURIComponent(matchEstado[1]));

  const matchAdminUsuario = pathname.match(/^\/api\/admin\/usuarios\/([^/]+)$/);
  if (matchAdminUsuario && metodo === "PUT") return handleAdminEditarUsuario(request, env, decodeURIComponent(matchAdminUsuario[1]));

  if (pathname === "/api/capitulos" && metodo === "GET") return handleListCapitulos(request, env);
  if (pathname === "/api/capitulos" && metodo === "POST") return handleCrearCapitulo(request, env);

  const matchCapituloId = pathname.match(/^\/api\/capitulos\/([^/]+)$/);
  if (matchCapituloId && metodo === "GET") return handleObtenerCapitulo(request, env, decodeURIComponent(matchCapituloId[1]));
  if (matchCapituloId && metodo === "PUT") return handleActualizarCapitulo(request, env, decodeURIComponent(matchCapituloId[1]));

  if (pathname === "/api/networkers" && metodo === "GET") return handleListNetworkers(request, env);

  const matchNetworkerTelefono = pathname.match(/^\/api\/networkers\/([^/]+)$/);
  if (matchNetworkerTelefono && metodo === "GET") return handleObtenerNetworker(request, env, decodeURIComponent(matchNetworkerTelefono[1]));
  if (matchNetworkerTelefono && metodo === "PUT") return handleGuardarNetworker(request, env, decodeURIComponent(matchNetworkerTelefono[1]));

  const matchRegenerarSlug = pathname.match(/^\/api\/networkers\/([^/]+)\/regenerar-slug$/);
  if (matchRegenerarSlug && metodo === "POST") {
    return handleRegenerarSlugNetworker(request, env, decodeURIComponent(matchRegenerarSlug[1]));
  }

  const matchCardSlug = pathname.match(/^\/api\/card\/([^/]+)$/);
  if (matchCardSlug && metodo === "GET") return handleObtenerCardPublico(request, env, decodeURIComponent(matchCardSlug[1]));

  if (pathname === "/api/esferas" && metodo === "GET") return handleListEsferas(request, env);
  if (pathname === "/api/esferas" && metodo === "POST") return handleCrearEsfera(request, env);
  if (pathname === "/api/esferas/cobertura" && metodo === "GET") return handleCoberturaEsferas(request, env);

  const matchEsferaId = pathname.match(/^\/api\/esferas\/([^/]+)$/);
  if (matchEsferaId && metodo === "DELETE") return handleEliminarEsfera(request, env, decodeURIComponent(matchEsferaId[1]));

  if (pathname === "/api/visitantes" && metodo === "GET") return handleListVisitantes(request, env);
  if (pathname === "/api/visitantes" && metodo === "POST") return handleCrearVisitante(request, env);
  if (pathname === "/api/visitantes/resumen" && metodo === "GET") return handleResumenVisitantes(request, env);
  if (pathname === "/api/visitantes/auto-registro" && metodo === "POST") return handleAutoRegistroVisitante(request, env);

  const matchVisitanteId = pathname.match(/^\/api\/visitantes\/([^/]+)$/);
  if (matchVisitanteId && metodo === "PUT") return handleActualizarVisitante(request, env, decodeURIComponent(matchVisitanteId[1]));

  if (pathname === "/api/gpnc" && metodo === "GET") return handleListGpnc(request, env);
  if (pathname === "/api/gpnc" && metodo === "POST") return handleCrearGpnc(request, env);
  if (pathname === "/api/gpnc/resumen" && metodo === "GET") return handleResumenGpnc(request, env);

  const matchGpncId = pathname.match(/^\/api\/gpnc\/([^/]+)$/);
  if (matchGpncId && metodo === "DELETE") return handleEliminarGpnc(request, env, decodeURIComponent(matchGpncId[1]));

  if (pathname === "/api/unoauno" && metodo === "GET") return handleListUnoAUno(request, env);
  if (pathname === "/api/unoauno" && metodo === "POST") return handleCrearUnoAUno(request, env);
  if (pathname === "/api/unoauno/resumen" && metodo === "GET") return handleResumenUnoAUno(request, env);

  const matchUnoAUnoId = pathname.match(/^\/api\/unoauno\/([^/]+)$/);
  if (matchUnoAUnoId && metodo === "PUT") return handleActualizarUnoAUno(request, env, decodeURIComponent(matchUnoAUnoId[1]));

  if (pathname === "/api/dashboard/resumen" && metodo === "GET") return handleResumenDashboard(request, env);

  if (pathname === "/api/referencias" && metodo === "GET") return handleListReferencias(request, env);
  if (pathname === "/api/referencias" && metodo === "POST") return handleCrearReferencia(request, env);
  if (pathname === "/api/referencias/resumen" && metodo === "GET") return handleResumenReferencias(request, env);

  const matchReferenciaId = pathname.match(/^\/api\/referencias\/([^/]+)$/);
  if (matchReferenciaId && metodo === "PUT") return handleActualizarReferencia(request, env, decodeURIComponent(matchReferenciaId[1]));

  if (pathname === "/api/agenda" && metodo === "GET") return handleListAgenda(request, env);
  if (pathname === "/api/agenda" && metodo === "POST") return handleCrearAgenda(request, env);

  const matchAgendaId = pathname.match(/^\/api\/agenda\/([^/]+)$/);
  if (matchAgendaId && metodo === "PUT") return handleActualizarAgenda(request, env, decodeURIComponent(matchAgendaId[1]));
  if (matchAgendaId && metodo === "DELETE") return handleEliminarAgenda(request, env, decodeURIComponent(matchAgendaId[1]));

  if (pathname === "/api/capacitaciones" && metodo === "GET") return handleListCapacitaciones(request, env);
  if (pathname === "/api/capacitaciones" && metodo === "POST") return handleCrearCapacitacion(request, env);

  const matchCapacitacionAvance = pathname.match(/^\/api\/capacitaciones\/([^/]+)\/avance\/([^/]+)$/);
  if (matchCapacitacionAvance && metodo === "PATCH") {
    return handleMarcarAvance(request, env, decodeURIComponent(matchCapacitacionAvance[1]), decodeURIComponent(matchCapacitacionAvance[2]));
  }

  const matchCapacitacionId = pathname.match(/^\/api\/capacitaciones\/([^/]+)$/);
  if (matchCapacitacionId && metodo === "PUT") return handleActualizarCapacitacion(request, env, decodeURIComponent(matchCapacitacionId[1]));

  if (pathname === "/api/recursos" && metodo === "GET") return handleListRecursos(request, env);
  if (pathname === "/api/recursos" && metodo === "POST") return handleCrearRecurso(request, env);

  const matchRecursoId = pathname.match(/^\/api\/recursos\/([^/]+)$/);
  if (matchRecursoId && metodo === "DELETE") return handleEliminarRecurso(request, env, decodeURIComponent(matchRecursoId[1]));

  if (pathname === "/api/asistencia" && metodo === "GET") return handleListAsistencia(request, env);
  if (pathname === "/api/asistencia" && metodo === "POST") return handleGuardarAsistencia(request, env);
  if (pathname === "/api/asistencia/resumen" && metodo === "GET") return handleResumenAsistencia(request, env);

  if (pathname === "/api/permisos/mis-permisos" && metodo === "GET") return handleMisPermisos(request, env);

  const matchCapituloModulos = pathname.match(/^\/api\/capitulos\/([^/]+)\/modulos$/);
  if (matchCapituloModulos && metodo === "GET") return handleListCapituloModulos(request, env, decodeURIComponent(matchCapituloModulos[1]));
  if (matchCapituloModulos && metodo === "PUT") return handleGuardarCapituloModulo(request, env, decodeURIComponent(matchCapituloModulos[1]));

  const matchPermisosUsuario = pathname.match(/^\/api\/usuarios\/([^/]+)\/permisos$/);
  if (matchPermisosUsuario && metodo === "GET") return handleListPermisosUsuario(request, env, decodeURIComponent(matchPermisosUsuario[1]));
  if (matchPermisosUsuario && metodo === "PUT") return handleGuardarPermisoUsuario(request, env, decodeURIComponent(matchPermisosUsuario[1]));

  if (pathname === "/api/directorio-publico" && metodo === "GET") return handleDirectorioPublico(request, env);
  if (pathname === "/api/networkers-tarjetas" && metodo === "GET") return handleNetworkersConTarjetas(request, env);

  if (pathname === "/api/usuarios-sistema" && metodo === "GET") return handleListUsuariosSistema(request, env);
  if (pathname === "/api/usuarios-sistema/opciones-roles" && metodo === "GET") return handleOpcionesRoles(request, env);

  const matchUsuarioSistemaEstado = pathname.match(/^\/api\/usuarios-sistema\/([^/]+)\/estado$/);
  if (matchUsuarioSistemaEstado && metodo === "PATCH") {
    return handleCambiarEstadoUsuarioSistema(request, env, decodeURIComponent(matchUsuarioSistemaEstado[1]));
  }

  const matchUsuarioSistemaPassword = pathname.match(/^\/api\/usuarios-sistema\/([^/]+)\/password$/);
  if (matchUsuarioSistemaPassword && metodo === "PATCH") {
    return handleRestablecerPasswordUsuario(request, env, decodeURIComponent(matchUsuarioSistemaPassword[1]));
  }

  const matchUsuarioSistemaVerComo = pathname.match(/^\/api\/usuarios-sistema\/([^/]+)\/ver-como$/);
  if (matchUsuarioSistemaVerComo && metodo === "POST") {
    return handleVerComoUsuario(request, env, decodeURIComponent(matchUsuarioSistemaVerComo[1]));
  }

  if (pathname === "/api/auth/salir-ver-como" && metodo === "POST") return handleSalirVerComo(request, env);

  const matchUsuarioSistema = pathname.match(/^\/api\/usuarios-sistema\/([^/]+)$/);
  if (matchUsuarioSistema && metodo === "PUT") return handleGuardarUsuarioSistema(request, env, decodeURIComponent(matchUsuarioSistema[1]));

  if (pathname === "/api/mensajes" && metodo === "GET") return handleListMensajes(request, env);
  if (pathname === "/api/mensajes" && metodo === "POST") return handleCrearMensaje(request, env);
  if (pathname === "/api/mensajes/enviados" && metodo === "GET") return handleListMensajesEnviados(request, env);

  const matchMensajeLeido = pathname.match(/^\/api\/mensajes\/([^/]+)\/leido$/);
  if (matchMensajeLeido && metodo === "PATCH") return handleMarcarMensajeLeido(request, env, decodeURIComponent(matchMensajeLeido[1]));

  if (pathname === "/api/invitados-funnel" && metodo === "POST") return handleRegistrarInvitadoFunnel(request, env);
  if (pathname === "/api/invitados-funnel" && metodo === "GET") return handleListInvitadosFunnel(request, env);

  const matchInvitadoFunnelId = pathname.match(/^\/api\/invitados-funnel\/([^/]+)$/);
  if (matchInvitadoFunnelId && metodo === "PUT") return handleActualizarInvitadoFunnel(request, env, decodeURIComponent(matchInvitadoFunnelId[1]));

  // Tarjeta pública del networker con URL amigable (/card/su-slug). Es una
  // sola página estática (card.html) que lee el slug de la propia URL en
  // el navegador; aquí solo se reescribe la ruta para servir ese archivo.
  const matchCardPagina = pathname.match(/^\/card\/([^/]+)$/);
  if (matchCardPagina && metodo === "GET") {
    // Pedir "/card.html" directo aquí provoca que el servidor de assets
    // responda con un 307 hacia la URL "limpia" /card (su propio
    // comportamiento de quitar el .html), perdiendo el slug. Pidiendo ya
    // la URL limpia "/card" se evita ese redirect y se sirve el HTML tal
    // cual; el slug lo termina leyendo el propio card.html desde
    // location.pathname en el navegador, no algo que dependa de esto.
    const assetUrl = new URL(request.url);
    assetUrl.pathname = "/card";
    return env.ASSETS.fetch(new Request(assetUrl, request));
  }

  return env.ASSETS.fetch(request);
}
