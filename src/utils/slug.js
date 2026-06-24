// Genera el slug base (sin verificar unicidad) a partir de nombre+empresa:
// minúsculas, sin acentos, solo letras/números/guiones.
export function generarSlugBase(nombre, empresa) {
  const partes = [nombre, empresa].filter(Boolean).join("-");
  const normalizado = partes
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos (marcas diacríticas que deja NFD)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalizado || "networker";
}

// Agrega -2, -3, etc. hasta encontrar un slug que no exista ya en la
// colección "usuarios" (excluyendo opcionalmente al propio usuario, para
// poder "regenerar" sin chocar contra el slug que ya tenía).
export async function generarSlugUnico(env, withUsuarios, nombre, empresa, telefonoAExcluir = null) {
  const base = generarSlugBase(nombre, empresa);
  let candidato = base;
  let contador = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const filtro = { slug: candidato };
    if (telefonoAExcluir) filtro.telefono = { $ne: telefonoAExcluir };
    const existente = await withUsuarios(env, (collection) => collection.findOne(filtro, { projection: { _id: 1 } }));
    if (!existente) return candidato;
    candidato = `${base}-${contador}`;
    contador++;
  }
}
