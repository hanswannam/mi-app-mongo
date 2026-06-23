export async function escanearImagen(imagen) {
  const r = await fetch("/api/ocr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imagen }) });
  const datos = await r.json();
  if (!r.ok) throw new Error(datos.error || "No se pudo escanear la imagen.");
  return datos;
}
