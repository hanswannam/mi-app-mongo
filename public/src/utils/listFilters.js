export function filtrarLista(lista, filtro, texto, categoria) {
  const t = (texto || "").trim().toLowerCase();
  return lista.filter((c) => {
    const coincideTexto = !t || (c.nombre || "").toLowerCase().includes(t) || (c.empresa || "").toLowerCase().includes(t);
    const coincideFiltro = filtro === "todos" || (filtro === "favorito" ? c.favorito : c.etiqueta === filtro);
    const coincideCategoria = !categoria || c.categoria === categoria;
    return coincideTexto && coincideFiltro && coincideCategoria;
  });
}
