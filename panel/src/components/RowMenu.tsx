import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

const MENU_GAP = 4;

type MenuPosition = { top?: number; bottom?: number; right: number };

/** Под кнопкой, а если снизу не хватает места — над ней. */
function menuPosition(button: HTMLElement | null, menuHeight: number): MenuPosition | null {
  const rect = button?.getBoundingClientRect();
  if (!rect) {
    return null;
  }
  const right = window.innerWidth - rect.right;
  if (rect.bottom + MENU_GAP + menuHeight > window.innerHeight) {
    return { bottom: window.innerHeight - rect.top + MENU_GAP, right };
  }
  return { top: rect.bottom + MENU_GAP, right };
}

/**
 * Меню «Ещё» в портале к <body>: `.table` стоит на overflow-x: auto, внутри строки
 * меню обрезалось бы. Нативный popover не берём: Safari < 17 и CSS anchor
 * positioning без Firefox/Safari не проходят по НФТ совместимости (vision.md).
 * Выбор любого пункта закрывает меню, иначе оно накроет подтверждение удаления.
 */
export function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = position !== null;

  // Пункт исчезает вместе с порталом: без возврата фокуса клавиатурный
  // пользователь оказался бы в начале документа.
  const close = () => {
    if (menu.current?.contains(document.activeElement)) {
      button.current?.focus();
    }
    setPosition(null);
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const reposition = () =>
      setPosition(menuPosition(button.current, menu.current?.offsetHeight ?? 0));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) {
        close();
      }
    };
    // Координаты fixed привязаны к окну: при прокрутке и ресайзе пересчитываем.
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    // Первым пунктом всегда стоит ссылка «Аналитика».
    menu.current?.querySelector<HTMLElement>("a")?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  // Высота меню известна только после первой отрисовки.
  useLayoutEffect(() => {
    if (open) {
      setPosition(menuPosition(button.current, menu.current?.offsetHeight ?? 0));
    }
  }, [open]);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    setPosition(menuPosition(button.current, 0));
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="btn"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={toggle}
      >
        Ещё
      </button>
      {position
        ? createPortal(
            <div
              ref={menu}
              className="row-menu"
              data-testid="tour-menu"
              style={position}
              onClick={close}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
