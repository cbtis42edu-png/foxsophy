const blockedWords = [
  "cabrón", "cabron", "chingar", "chinga", "chingada", "chingado", "chingón", "chingon",
  "coño", "culero", "estúpido", "estupido", "estúpida", "estupida", "mierda", "pendejo",
  "pendeja", "puta", "puto", "put4", "put0", "verga", "idiota", "imbécil", "imbecil",
  "bastard", "bitch", "fuck", "shit", "asshole",
];

function normalize(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replaceAll("0", "o").replaceAll("1", "i").replaceAll("3", "e").replaceAll("4", "a").replaceAll("@", "a")
    .replace(/[^a-z]/g, " ");
}

export function containsProfanity(text: string) {
  const normalized = normalize(text);
  return blockedWords.some((word) => {
    const pattern = normalize(word).trim().split(/\s+/).join("[^a-z]*");
    return new RegExp(`(^|[^a-z])${pattern}($|[^a-z])`).test(normalized);
  });
}