/* ============================================================
   ПЛАНИРОВЩИК (crm-cron) — подключение.

   Экран живёт в «Событиях», а не в настройках. Сначала он стоял среди интеграций рядом
   с Jira и подключениями к БД — по устройству это ровно оно, — но искать его там никто
   не стал: планировщик нужен тому, кто заводит события по расписанию, и думает он в этот
   момент про событие, а не про список интеграций.

   Зачем экран нужен. События по расписанию исполняет Quartz, и знает он о них не по
   строке в scheduler.t_launch_settings, а по контексту, который создаёт этот сервис.
   Панель строку пишет, контекст не создаёт — значит заведённое ею событие не срабатывает
   никогда. Здесь настраивается связь; сами задания заводятся кнопками в карточке события.

   Токен экран не показывает никогда: сервер отдаёт только признак «задан». Пустое поле
   при сохранении значит «не менять», а не «стереть» — иначе правка адреса молча уносила
   бы токен, которого человек не видел.
   ============================================================ */
window.CronPanel = (function () {
  "use strict";

  var data = null;
  var busy = false;

  function el(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

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
    var n = el("cronMsg");
    if (!n) return;
    n.textContent = text || "";
    n.className = "ev-msg" + (kind ? " " + kind : "");
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
      '<div class="ev-step">' +
        '<div class="t">Подключение</div>' +
        '<div class="ev-fields">' +
          '<div class="ev-f wide"><label for="cronUrl">Адрес планировщика</label>' +
            '<input type="text" id="cronUrl" autocomplete="off" value="' + esc(data.baseUrl) +
              '" placeholder="https://crm-cron.int.banki.ru">' +
            '<span class="hint">Только схема и хост, без пути.</span></div>' +
          '<div class="ev-f wide"><label for="cronToken">Токен</label>' +
            '<input type="password" id="cronToken" autocomplete="new-password" placeholder="' +
              (data.hasToken ? "задан — оставьте пустым, чтобы не менять" : "не задан") + '">' +
            '<span class="hint">Уходит заголовком <code>Authorization: Bearer</code>. Обратно панель' +
              " его не показывает." +
              (data.hasToken
                ? ' <button type="button" class="ev-mini" onclick="CronPanel.clearToken()">стереть</button>'
                : "") +
            "</span></div>" +
          '<div class="ev-f"><label for="cronGroup">job_group</label>' +
            '<input type="text" id="cronGroup" autocomplete="off" value="' + esc(data.jobGroup) + '"></div>' +
          '<div class="ev-f"><label for="cronPrio">Приоритет</label>' +
            '<select id="cronPrio">' + opts + "</select></div>" +
          '<div class="ev-f wide"><label for="cronProbe">Путь для проверки связи</label>' +
            '<input type="text" id="cronProbe" autocomplete="off" value="' + esc(data.probePath) + '">' +
            '<span class="hint">Только чтение. По умолчанию описание OpenAPI — оно ничего не меняет.</span></div>' +
        "</div>" +
        '<div class="ev-checks">' +
          '<label class="ev-chk"><input type="checkbox" id="cronOn"' + (data.enabled ? " checked" : "") +
            "> Интеграция включена" +
            '<span class="hint">Выключена — панель не отправляет планировщику ничего, кроме' +
              " проверки связи. Настройки лежат на всех трёх контурах, а планировщик один.</span></label>" +
        "</div>" +
      "</div>" +

      '<div class="ev-foot">' +
        '<button class="ev-btn" type="button" onclick="CronPanel.save()">Сохранить</button>' +
        '<button class="ev-btn ghost" type="button" onclick="CronPanel.check()">Проверить связь</button>' +
        '<span class="ev-msg" id="cronMsg"></span>' +
      "</div>" +

      '<div class="ev-card' + (data.lastStatus === "ERROR" ? " bad" : "") + '">' +
        "<h4>Последняя проверка</h4>" +
        "<dl><dt>когда</dt><dd>" + esc(when(data.lastCheckedAt)) + "</dd>" +
        "<dt>итог</dt><dd>" + esc(data.lastStatus || "—") + "</dd>" +
        "<dt>кто менял</dt><dd>" + esc(data.updatedBy || "—") + "</dd></dl>" +
        (data.lastError ? '<div class="ev-warn">' + esc(data.lastError) + "</div>" : "") +
      "</div>";
  }

  function collect() {
    return {
      baseUrl: el("cronUrl").value,
      token: el("cronToken").value,
      probePath: el("cronProbe").value,
      jobGroup: el("cronGroup").value,
      priority: el("cronPrio").value,
      enabled: el("cronOn").checked
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
      if (host && !data) host.innerHTML = '<div class="ev-card">Загружаю…</div>';
      return api("GET", "/api/cron/settings").then(function (d) {
        data = d;
        render();
      }).catch(function (e) {
        if (host) host.innerHTML = '<div class="ev-card" style="color:var(--coral)">' +
                                   esc(e.message) + "</div>";
      });
    },

    save: function () {
      run(api("PUT", "/api/cron/settings", collect()).then(function (d) {
        data = d;
        render();
        return d;
      }), function () { return "Сохранено"; });
    },

    clearToken: function () {
      if (!confirm("Стереть токен? Панель перестанет аутентифицироваться у планировщика.")) return;
      var body = collect();
      body.clearToken = true;
      run(api("PUT", "/api/cron/settings", body).then(function (d) {
        data = d;
        render();
        return d;
      }), function () { return "Токен стёрт"; });
    },

    /* Проверка ходит наружу и записывает результат — поэтому POST, а не GET: повторять
       её обновлением страницы неправильно. Работает и при выключенной интеграции: она
       ничего не меняет, а требовать включить вслепую — плохая идея. */
    check: function () {
      note("Проверяю…");
      run(api("POST", "/api/cron/check").then(function (res) {
        return api("GET", "/api/cron/settings").then(function (d) {
          data = d;
          render();
          return res;
        });
      }), function (res) {
        return res.ok
          ? "Связь есть. Ответ: " + String(res.sample || "").slice(0, 140)
          : "Связи нет: " + (res.error || "неизвестно");
      });
    }
  };
})();

window.initEventCronSection = function () { window.CronPanel.open(); };
