/* ============================================================
   ПЛАНИРОВЩИК (crm-cron) — адрес, токен и выключатель.

   События по расписанию исполняет Quartz, и знает он о них не по строке в
   scheduler.t_launch_settings, а по контексту, который создаёт этот сервис. Панель
   строку пишет, контекст не создаёт — значит заведённое ею событие не срабатывает
   никогда. Здесь настраивается связь; сами задания заводятся кнопками в карточке
   события.

   Экран администраторский: адрес сервиса один на панель и решает, на какой контур уедут
   боевые задания. Выдаваемого права под него нет — на сервере ручки закрыты ролью.
   Настройка при этом действует на всех: задания заводит любой, у кого есть право на
   события по расписанию.

   Токен экран не показывает никогда: сервер отдаёт только признак «задан». Пустое поле
   при сохранении значит «не менять», а не «стереть» — иначе правка адреса молча уносила
   бы токен, которого человек не видел. Для стирания есть отдельная кнопка.
   ============================================================ */
window.Cron = (function () {
  "use strict";

  var data = null;
  var busy = false;

  function T(s) { return (typeof window.t2 === "function") ? window.t2(s) : s; }
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function el(id) { return document.getElementById(id); }

  function api(method, url, body) {
    return fetch(url, {
      method: method, credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body == null ? undefined : JSON.stringify(body)
    }).then(function (r) {
      return r.text().then(function (txt) {
        var j = null;
        try { j = txt ? JSON.parse(txt) : null; } catch (e) { /* не json — ниже */ }
        if (!r.ok) throw new Error((j && (j.message || j.error)) || txt || ("HTTP " + r.status));
        return j;
      });
    });
  }

  function note(text, kind) {
    var n = el("cron-msg");
    if (!n) return;
    n.textContent = text || "";
    n.style.color = kind === "err" ? "var(--coral)"
                  : kind === "ok" ? "var(--green)" : "var(--dim)";
  }

  function when(v) {
    if (!v) return "никогда";
    var d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleString("ru-RU");
  }

  function render() {
    var host = el("cronHost");
    if (!host || !data) return;
    var opts = (data.priorities || ["LOW"]).map(function (p) {
      return '<option value="' + esc(p) + '"' + (data.priority === p ? " selected" : "") + ">" +
             esc(p) + "</option>";
    }).join("");

    host.innerHTML =
      '<div class="cron-card">' +
        '<div class="cron-row"><label for="cron-url">' + T("Адрес планировщика") + "</label>" +
          '<input id="cron-url" value="' + esc(data.baseUrl) + '" placeholder="https://crm-cron.int.banki.ru">' +
          '<span class="cron-hint">' + T("Без пути: только схема и хост.") + "</span></div>" +

        '<div class="cron-row"><label for="cron-token">' + T("Токен") + "</label>" +
          '<input id="cron-token" type="password" autocomplete="new-password" placeholder="' +
            (data.hasToken ? T("задан — оставьте пустым, чтобы не менять") : T("не задан")) + '">' +
          '<span class="cron-hint">' +
            T("Уходит заголовком Authorization: Bearer. Обратно панель его не показывает.") +
            (data.hasToken
              ? ' <button type="button" class="cron-btn del" onclick="Cron.clearToken()">' +
                T("стереть токен") + "</button>"
              : "") +
          "</span></div>" +

        '<div class="cron-row"><label for="cron-probe">' + T("Путь для проверки связи") + "</label>" +
          '<input id="cron-probe" value="' + esc(data.probePath) + '">' +
          '<span class="cron-hint">' +
            T("Только чтение. По умолчанию описание OpenAPI — оно ничего не меняет.") + "</span></div>" +

        '<div class="cron-grid">' +
          '<div class="cron-row"><label for="cron-group">' + T("job_group") + "</label>" +
            '<input id="cron-group" value="' + esc(data.jobGroup) + '"></div>' +
          '<div class="cron-row"><label for="cron-prio">' + T("Приоритет") + "</label>" +
            '<select id="cron-prio">' + opts + "</select></div>" +
        "</div>" +

        '<label class="cron-chk"><span><input type="checkbox" id="cron-on"' +
          (data.enabled ? " checked" : "") + "> " + T("Интеграция включена") + "</span>" +
          '<span class="cron-hint">' +
            T("Выключена — панель не отправляет планировщику ничего, кроме проверки связи." +
              " Настройки лежат на всех трёх контурах, а планировщик один.") +
          "</span></label>" +

        '<div class="cron-foot">' +
          '<button type="button" class="cron-btn primary" onclick="Cron.save()">' + T("Сохранить") + "</button>" +
          '<button type="button" class="cron-btn" onclick="Cron.check()">' + T("Проверить связь") + "</button>" +
          '<span class="cron-msg" id="cron-msg"></span>' +
        "</div>" +

        '<div class="cron-last' + (data.lastStatus === "ERROR" ? " bad" : "") + '">' +
          T("Последняя проверка") + ": " + esc(when(data.lastCheckedAt)) +
          (data.lastStatus ? " · " + esc(data.lastStatus) : "") +
          (data.updatedBy ? " · " + T("менял") + ": " + esc(data.updatedBy) : "") +
          (data.lastError ? '<div class="cron-err">' + esc(data.lastError) + "</div>" : "") +
        "</div>" +
      "</div>";
  }

  function collect() {
    return {
      baseUrl: el("cron-url").value,
      token: el("cron-token").value,
      probePath: el("cron-probe").value,
      jobGroup: el("cron-group").value,
      priority: el("cron-prio").value,
      enabled: el("cron-on").checked
    };
  }

  function run(promise, okText) {
    if (busy) return;
    busy = true;
    promise
      .then(function (res) { note(okText(res), "ok"); })
      .catch(function (e) { note(e.message, "err"); })
      .then(function () { busy = false; });
  }

  return {
    open: function () {
      var host = el("cronHost");
      if (host && !data) host.innerHTML = '<div class="cron-hint">' + T("Загружаю…") + "</div>";
      return api("GET", "../api/cron/settings").then(function (d) {
        data = d;
        render();
      }).catch(function (e) {
        if (host) host.innerHTML = '<div class="cron-hint">' + T("Не удалось прочитать: ") +
                                   esc(e.message) + "</div>";
      });
    },

    save: function () {
      run(api("PUT", "../api/cron/settings", collect()).then(function (d) {
        data = d;
        render();
        return d;
      }), function () { return T("Сохранено"); });
    },

    clearToken: function () {
      if (!confirm(T("Стереть токен? Панель перестанет аутентифицироваться у планировщика."))) return;
      var body = collect();
      body.clearToken = true;
      run(api("PUT", "../api/cron/settings", body).then(function (d) {
        data = d;
        render();
        return d;
      }), function () { return T("Токен стёрт"); });
    },

    /* Проверка ходит наружу и записывает результат — поэтому POST, а не GET: повторять
       её обновлением страницы неправильно. Работает и при выключенной интеграции: она
       ничего не меняет, а требовать включить вслепую — плохая идея. */
    check: function () {
      note(T("Проверяю…"));
      run(api("POST", "../api/cron/check").then(function (res) {
        return api("GET", "../api/cron/settings").then(function (d) {
          data = d;
          render();
          return res;
        });
      }), function (res) {
        return res.ok
          ? T("Связь есть. Ответ: ") + String(res.sample || "").slice(0, 140)
          : T("Связи нет: ") + (res.error || "неизвестно");
      });
    }
  };
})();
