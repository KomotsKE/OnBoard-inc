/**
 * Идентификаторы прогонов, посетителей и событий.
 *
 * `crypto.randomUUID` доступен только в защищённом контексте: на сайте
 * клиента по http его может не быть, а виджет работать обязан.
 */
export function uuid(view: Window = window): string {
  const api = view.crypto;
  if (typeof api?.randomUUID === "function") {
    return api.randomUUID();
  }
  const bytes = new Uint8Array(16);
  api.getRandomValues(bytes);
  // Версия 4 и вариант RFC 4122 — иначе это просто случайная строка.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
