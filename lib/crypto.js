// --- Criptografía (Web Crypto, disponible nativamente en Workers) ---

export function bytesAHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexABytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export function generarSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesAHex(bytes);
}

export async function hashConSalt(valor, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(valor), "PBKDF2", false, ["deriveBits"]);
  const derivado = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexABytes(saltHex), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bytesAHex(derivado);
}

export async function firmarSesion(payload, secreto) {
  const data = JSON.stringify(payload);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = bytesAHex(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return `${btoa(data)}.${firma}`;
}

export async function verificarSesion(token, secreto) {
  if (!token) return null;
  const [dataB64, firma] = token.split(".");
  if (!dataB64 || !firma) return null;

  let data;
  try {
    data = atob(dataB64);
  } catch {
    return null;
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firmaEsperada = bytesAHex(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  if (firmaEsperada !== firma) return null;

  const payload = JSON.parse(data);
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}
