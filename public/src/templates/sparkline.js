export function dibujarSparkline(serie) {
  if (serie.length === 0) return '<p class="placeholder-text">Todavía no hay vistas registradas.</p>';
  const max = Math.max(...serie.map((p) => p.conteo), 1);
  const w = 280, h = 70, paso = w / Math.max(serie.length - 1, 1);
  const puntos = serie.map((p, i) => `${i * paso},${h - (p.conteo / max) * (h - 10) - 5}`).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%; height:80px;"><polyline points="${puntos}" fill="none" stroke="#FF6B00" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
