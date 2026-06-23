// Formato "AAAA-MM-DD" usado para agrupar eventos por dia calendario.
export function formatDateYYYYMMDD(fecha) {
  return fecha.toISOString().slice(0, 10);
}
