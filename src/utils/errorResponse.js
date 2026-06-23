import { jsonResponse } from "./response.js";

export function errorResponse(mensaje, status = 400, extra = {}) {
  return jsonResponse({ error: mensaje, ...extra }, status);
}
