// Si la conexión está muy lenta o se cae a mitad de la petición, un fetch()
// normal puede quedar esperando indefinidamente sin avisar (se ve como que
// la pantalla nunca termina de cargar). Con un límite de tiempo, en vez de
// eso se muestra un mensaje claro para que el usuario sepa que es su señal,
// no que la app esté rota.
export function fetchConLimite(url, opciones = {}, limiteMs = 15000) {
  const controlador = new AbortController();
  const aviso = setTimeout(() => controlador.abort(), limiteMs);
  return fetch(url, { ...opciones, signal: controlador.signal }).finally(() => clearTimeout(aviso));
}

export function mensajeDeError(error) {
  if (error.name === "AbortError") return "Tu conexión está muy lenta o no responde. Verifica tu señal e intenta de nuevo.";
  return error.message;
}
