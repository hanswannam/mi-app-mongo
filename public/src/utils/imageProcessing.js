// Detecta si una imagen (ya sea recién capturada o ya guardada) es vertical
// u horizontal, para que el contenedor que la muestra se ajuste sin recortar
// ni deformar. Funciona igual para fotos nuevas y para las que ya están
// guardadas en la base de datos (no requiere conocer la orientación de
// antemano).
export function detectarOrientacion(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(false); return; }
    const img = new Image();
    img.onload = () => resolve(img.naturalHeight > img.naturalWidth);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

// Miniatura chica (para avatares en listas) a partir de la foto del frente
// ya comprimida. Las listas (Inicio/Contactos) usan esto en vez de la foto
// completa para no descargar cientos de KB por tarjeta solo para mostrar un
// avatar pequeño.
export function generarMiniatura(dataUrlOrigen, maxLado = 120, calidad = 0.6) {
  return new Promise((resolve) => {
    if (!dataUrlOrigen) { resolve(""); return; }
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", calidad));
    };
    img.onerror = () => resolve("");
    img.src = dataUrlOrigen;
  });
}

// Convierte un File en dataURL sin comprimir todavía (para previsualizar
// antes de aplicar rotación/compresión final).
export function leerComoDataUrl(file) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error("No se pudo leer la imagen."));
    lector.onload = () => resolve(lector.result);
    lector.readAsDataURL(file);
  });
}

// Rota una imagen ya cargada (dataURL) en pasos de 90° y la comprime al
// mismo tiempo. Si el giro no es de 180° (o 0°), intercambia ancho/alto del
// lienzo final para que la imagen rotada no quede recortada. Se usa tanto
// para la previsualización en vivo (re-rotando siempre desde el original,
// para no perder calidad en cada vuelta) como para el resultado final.
export function rotarImagenDataUrl(dataUrl, grados = 0, maxAncho = 1200, calidad = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("El archivo no es una imagen válida."));
    img.onload = () => {
      const anguloRad = (grados * Math.PI) / 180;
      const esGiroDeLado = grados % 180 !== 0;
      const anchoOrigen = img.naturalWidth || img.width;
      const altoOrigen = img.naturalHeight || img.height;
      const escala = Math.min(1, maxAncho / (esGiroDeLado ? altoOrigen : anchoOrigen));
      const anchoDibujo = anchoOrigen * escala;
      const altoDibujo = altoOrigen * escala;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(esGiroDeLado ? altoDibujo : anchoDibujo);
      canvas.height = Math.round(esGiroDeLado ? anchoDibujo : altoDibujo);
      const ctx = canvas.getContext("2d");
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(anguloRad);
      ctx.drawImage(img, -anchoDibujo / 2, -altoDibujo / 2, anchoDibujo, altoDibujo);
      resolve(canvas.toDataURL("image/jpeg", calidad));
    };
    img.src = dataUrl;
  });
}

export function comprimirImagen(file, maxAncho = 1200, calidad = 0.75) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error("No se pudo leer la imagen."));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("El archivo no es una imagen válida."));
      img.onload = () => {
        const escala = Math.min(1, maxAncho / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", calidad));
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(file);
  });
}

// Recorta al cuadrado central de la imagen (la foto de perfil siempre se ve
// redonda/cuadrada) antes de comprimirla, así no queda estirada ni deformada
// sin importar la proporción de la foto original.
export function recortarYComprimirCuadrado(file, lado = 400, calidad = 0.8) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error("No se pudo leer la imagen."));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("El archivo no es una imagen válida."));
      img.onload = () => {
        const tamanoMenor = Math.min(img.naturalWidth, img.naturalHeight);
        const offsetX = (img.naturalWidth - tamanoMenor) / 2;
        const offsetY = (img.naturalHeight - tamanoMenor) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = lado;
        canvas.height = lado;
        canvas.getContext("2d").drawImage(img, offsetX, offsetY, tamanoMenor, tamanoMenor, 0, 0, lado, lado);
        resolve(canvas.toDataURL("image/jpeg", calidad));
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(file);
  });
}
