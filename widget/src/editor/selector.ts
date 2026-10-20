/**
 * Генератор устойчивого селектора для выбранного элемента (§5 docs/vision.md).
 *
 * Правила простые и потому предсказуемые: приоритет атрибутов, которые ставит
 * человек, затем всё более хрупкие признаки. На каждом уровне кандидат обязан
 * находить ровно один элемент на текущей странице — иначе спускаемся ниже.
 * Генератор не обязан быть идеальным: селектор остаётся редактируемым
 * в панели, а проверяемым он обязан быть всегда.
 */

/** Атрибуты, которые ставят руками для тестов и автоматизации. */
const STABLE_ATTRIBUTES = ["data-testid", "data-qa", "data-test", "data-onboard-id"];

/** Признаки, по которым элемент опознаётся без классов. */
const DESCRIPTIVE_ATTRIBUTES = ["name", "aria-label", "role"];

/**
 * Имя, пригодное для селектора как есть: буква в начале, дальше буквы, цифры,
 * дефис или подчёркивание. Свойства Unicode, а не `\w`: тот считает буквой
 * только латиницу, и класс `кнопка-выгрузки` выглядел бы для него машинным.
 * Такие имена — корректные идентификаторы CSS и экранирования не требуют,
 * а всё остальное генератор просто не берёт.
 */
const PLAIN_NAME = /^\p{L}[\p{L}\p{N}_-]*$/u;

/**
 * Машинное имя: среди частей есть набор из букв и цифр длиной от четырёх —
 * `css-1q2w3e`, `_btn_a1b2`, `__next_a1b2`. Осмысленные `step-2` и `col-md-6`
 * под правило не попадают: там цифра стоит отдельной частью.
 */
function looksGenerated(name: string): boolean {
  return name
    .split(/[-_]+/)
    .some((part) => part.length >= 4 && /\p{N}/u.test(part) && /\p{L}/u.test(part));
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isUnique(selector: string, element: Element): boolean {
  const found = element.ownerDocument.querySelectorAll(selector);
  return found.length === 1 && found[0] === element;
}

/** Селектор, который однозначно опознаёт элемент сам по себе. */
function standalone(element: Element): string | null {
  for (const attribute of STABLE_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (value !== null) {
      const candidate = `[${attribute}=${quote(value)}]`;
      if (isUnique(candidate, element)) {
        return candidate;
      }
    }
  }

  const id = element.getAttribute("id");
  if (id !== null && PLAIN_NAME.test(id) && !looksGenerated(id)) {
    const candidate = `#${id}`;
    if (isUnique(candidate, element)) {
      return candidate;
    }
  }

  const tag = element.localName;
  for (const attribute of DESCRIPTIVE_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (value !== null && value !== "") {
      const candidate = `${tag}[${attribute}=${quote(value)}]`;
      if (isUnique(candidate, element)) {
        return candidate;
      }
    }
  }

  const classes = Array.from(element.classList).filter(
    (name) => PLAIN_NAME.test(name) && !looksGenerated(name),
  );
  if (classes.length > 0) {
    const candidate = tag + classes.map((name) => `.${name}`).join("");
    if (isUnique(candidate, element)) {
      return candidate;
    }
  }

  return null;
}

/** Положение среди соседей того же тега: единственное, что всегда различает. */
function positional(element: Element): string {
  const parent = element.parentElement;
  if (parent === null) {
    return element.localName;
  }
  const sameTag = Array.from(parent.children).filter(
    (child) => child.localName === element.localName,
  );
  if (sameTag.length === 1) {
    return element.localName;
  }
  return `${element.localName}:nth-of-type(${sameTag.indexOf(element) + 1})`;
}

/**
 * Селектор элемента или `null`, если элемента нет в документе.
 *
 * Пустой результат на элементе страницы означал бы, что пикер молча
 * отказывается выбирать: поэтому последний уровень — путь от ближайшего
 * устойчивого предка, он находится всегда.
 */
export function selectorFor(element: Element): string | null {
  const document_ = element.ownerDocument;
  if (!document_.contains(element)) {
    return null;
  }
  if (element === document_.body) {
    return "body";
  }

  const direct = standalone(element);
  if (direct !== null) {
    return direct;
  }

  const parts: string[] = [];
  let node: Element | null = element;
  while (node !== null && node !== document_.body) {
    parts.unshift(positional(node));
    node = node.parentElement;

    if (node !== null && node !== document_.body) {
      const anchor = standalone(node);
      if (anchor !== null) {
        return [anchor, ...parts].join(" > ");
      }
    }
  }
  return ["body", ...parts].join(" > ");
}
