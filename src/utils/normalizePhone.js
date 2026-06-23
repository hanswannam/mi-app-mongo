export function soloDigitos(valor) {
  return (valor || "").replace(/\D/g, "");
}

// "50251136189", "+50251136189" y "51136189" deben tratarse como el mismo
// número: se normaliza a solo dígitos y se le quita el código de país
// (502) cuando está presente, dejando el número local de 8 dígitos.
export function normalizarTelefono(valor) {
  let digitos = soloDigitos(valor);
  if (digitos.length > 8 && digitos.startsWith("502")) {
    digitos = digitos.slice(3);
  }
  return digitos;
}
