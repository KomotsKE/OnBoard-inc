// Поведение стенда: SPA-навигация без перезагрузки, модалка и элемент,
// появляющийся с задержкой. Ровно те случаи, на которых виджет ломается,
// если сделан наивно.

(() => {
  "use strict";

  const DELAY_MS = 2000;

  const views = {
    "/reports": {
      title: "Отчёты",
      html: `
        <div class="card">
          <h1>Отчёты</h1>
          <p>Страница по умолчанию. Элемент ниже появляется с задержкой.</p>
          <p class="muted">
            Кнопка «Экспорт» вставляется через ${DELAY_MS} мс после отрисовки: виджет
            обязан дождаться её появления, а не решить, что шаг сломан.
          </p>
          <div id="delayed-slot"></div>
        </div>
        <div class="card transformed">
          <h2>Блок с трансформацией</h2>
          <p class="muted">
            У контейнера <code>transform: translateZ(0)</code> — он создаёт containing
            block, поэтому <code>position: fixed</code> внутри него ведёт себя иначе.
          </p>
          <button type="button" class="_btn_a1b2c">Цель в трансформированном блоке</button>
        </div>
        <div class="card dark-section">
          <h2>Тёмная секция</h2>
          <p>Проверка контраста подсветки и подсказки на тёмном фоне.</p>
          <button type="button" data-testid="dark-target">Цель на тёмном</button>
        </div>`,
    },
    "/dashboard": {
      title: "Дашборд",
      html: `
        <div class="card">
          <h1>Дашборд</h1>
          <p>Другой маршрут. Открыт без перезагрузки страницы.</p>
          <button type="button" data-testid="dashboard-target">Цель на дашборде</button>
        </div>`,
    },
    "/delayed": {
      title: "Отложенная цель",
      html: `
        <div class="card">
          <h1>Отложенная цель</h1>
          <p>
            На странице ровно один интересный элемент, и он появляется через
            ${DELAY_MS} мс после отрисовки.
          </p>
          <p class="muted">
            Отдельный маршрут, а не <code>/reports</code>: неизвестный путь стенд
            заменяет на <code>/reports</code> через <code>replaceState</code>
            раньше, чем успевает выполниться async-загрузчик виджета.
          </p>
          <div id="delayed-slot"></div>
        </div>`,
    },
    "/settings": {
      title: "Настройки",
      html: `
        <div class="card">
          <h1>Настройки</h1>
          <p>Здесь целей нет: тур, привязанный к другому разделу, показываться не должен.</p>
        </div>`,
    },
  };

  const view = document.getElementById("view");
  let delayedTimer = null;

  function render(path) {
    const route = views[path] ?? views["/reports"];
    view.innerHTML = route.html;
    document.title = `${route.title} — стенд OnBoard`;

    if (delayedTimer) {
      clearTimeout(delayedTimer);
      delayedTimer = null;
    }

    const slot = document.getElementById("delayed-slot");
    if (slot) {
      delayedTimer = setTimeout(() => {
        const button = document.createElement("button");
        button.type = "button";
        button.id = "export";
        button.dataset.testid = "export-button";
        button.textContent = "Экспорт";
        slot.appendChild(button);
      }, DELAY_MS);
    }
  }

  function navigate(path, { replace = false } = {}) {
    // Именно pushState, без перезагрузки: виджет должен заметить смену адреса
    // через обёртку над History API (T2.7).
    if (replace) {
      history.replaceState({ path }, "", path);
    } else {
      history.pushState({ path }, "", path);
    }
    render(path);
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-route]");
    if (link) {
      event.preventDefault();
      navigate(new URL(link.href).pathname);
      return;
    }

    if (event.target.id === "filters") {
      document.getElementById("modal").hidden = false;
    }
    if (event.target.id === "modal-close") {
      document.getElementById("modal").hidden = true;
    }
  });

  window.addEventListener("popstate", (event) => {
    render(event.state?.path ?? location.pathname);
  });

  const initial = views[location.pathname] ? location.pathname : "/reports";
  navigate(initial, { replace: true });
})();
