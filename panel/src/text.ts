/**
 * Русский счёт словами.
 *
 * Выделено, когда понадобилось во второй раз (туры и запуски): «2 запуск(ов)»
 * в интерфейсе владельца выглядит как недоделка.
 */
export function plural(count: number, forms: [one: string, few: string, many: string]): string {
  const remainder100 = count % 100;
  const remainder10 = count % 10;
  if (remainder100 >= 11 && remainder100 <= 14) {
    return `${count} ${forms[2]}`;
  }
  if (remainder10 === 1) {
    return `${count} ${forms[0]}`;
  }
  if (remainder10 >= 2 && remainder10 <= 4) {
    return `${count} ${forms[1]}`;
  }
  return `${count} ${forms[2]}`;
}
