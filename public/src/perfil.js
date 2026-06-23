// Cliente de la API del perfil propio: solo hace las llamadas de red y
// devuelve datos o lanza errores con el mensaje del servidor. El render del
// avatar/estado de API key y el modal de confirmación de DPI se quedan en
// app.js, porque leen usuarioActual (estado global del archivo) y el DOM
// directamente -- no por nada que dependa de este archivo.

export async function actualizarFotoPerfil(fotoPerfil, dpiActual) {
  const r = await fetch("/api/usuario", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fotoPerfil, dpiActual }) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "No se pudo actualizar la foto.");
  return data;
}

export async function actualizarCuenta(nombre, telefono, dpiNuevo, dpiActual) {
  const r = await fetch("/api/usuario", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre, telefono, dpiNuevo, dpiActual })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "No se pudo actualizar la cuenta.");
  return data;
}

export async function guardarApiKey(openaiApiKey) {
  const r = await fetch("/api/usuario/openai-key", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ openaiApiKey }) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "No se pudo guardar la API key.");
  return data;
}
