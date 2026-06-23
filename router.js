import { handleListCategorias, handleCrearCategoria, handleEliminarCategoria } from "./categorias.js";
import { handleOcr } from "./ocr.js";
import { handleRegistrarEvento, handleEstadisticasTarjeta } from "./eventos.js";
import { handleRegistro, handleLogin, handleRecuperarContacto, handleLogout, handleYo } from "./auth.js";
import { handleGuardarApiKey, handleActualizarUsuario } from "./usuarios.js";
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
  handleGuardarNetworker
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
  handleResumenVisitantes
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

  if (pathname === "/api/esferas" && metodo === "GET") return handleListEsferas(request, env);
  if (pathname === "/api/esferas" && metodo === "POST") return handleCrearEsfera(request, env);
  if (pathname === "/api/esferas/cobertura" && metodo === "GET") return handleCoberturaEsferas(request, env);

  const matchEsferaId = pathname.match(/^\/api\/esferas\/([^/]+)$/);
  if (matchEsferaId && metodo === "DELETE") return handleEliminarEsfera(request, env, decodeURIComponent(matchEsferaId[1]));

  if (pathname === "/api/visitantes" && metodo === "GET") return handleListVisitantes(request, env);
  if (pathname === "/api/visitantes" && metodo === "POST") return handleCrearVisitante(request, env);
  if (pathname === "/api/visitantes/resumen" && metodo === "GET") return handleResumenVisitantes(request, env);

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

  return env.ASSETS.fetch(request);
}
