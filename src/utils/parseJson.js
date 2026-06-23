// Formaliza el patron repetido en cada handler que recibe body: intenta
// parsear el JSON y, si falla, devuelve el mismo mensaje de error de
// siempre en vez de lanzar. El llamador decide el status/Response exacto.
export async function parseJson(request) {
  try {
    const body = await request.json();
    return { body, error: null };
  } catch {
    return { body: null, error: "El cuerpo de la solicitud debe ser JSON válido." };
  }
}
