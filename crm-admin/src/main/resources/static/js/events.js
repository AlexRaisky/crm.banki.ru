/* Раздел «События»: две пошаговые формы завода события — «Онлайн-событие»
   (#sec-event-online) и «Событие по расписанию» (#sec-event-offline).

   Повторяют формы старой Appsmith-админки. Отличие от «Цепочек»: там событие рисуется
   на канве и материализуется из схемы, здесь задаётся напрямую. Пишут обе дороги в одно
   и то же — слой A (flow.*) и слой B (tracker/scheduler/template/commapi), поэтому
   событие, заведённое формой, видно так же, как заведённое цепочкой.

   Справочники общие для обеих форм и тянутся один раз (GET /api/events/dictionaries).
   Права: read открывает форму, add разрешает кнопку — секции ev-online и ev-offline. */
(function () {
  "use strict";

  var dict = null;          // кэш справочников
  var dictPromise = null;   // защита от параллельных загрузок при быстром переключении
  var inited = { online: false, offline: false };

  var API = "/api/events";

  function el(id) { return document.getElementById(id); }
  function can(cap, section) { return !!(window.CRM && CRM.can && CRM.can(cap, section)); }

  /* Свой транспорт, как в abtests.js: в api.js методы именованные, и ради двух ручек
     раздела туда не лезем. Текст ошибки достаём из message — его кладёт
     ValidationErrorHandler, иначе пользователь видел бы «400 Bad Request». */
  function evReq(method, path, body) {
    var opts = { method: method, headers: { Accept: "application/json" }, credentials: "same-origin" };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(API + path, opts).then(function (r) {
      if (r.ok) return r.status === 204 ? null : r.json();
      return r.text().then(function (t) {
        var msg = t;
        try { msg = JSON.parse(t).message || t; } catch (e) { /* не JSON — покажем как есть */ }
        throw new Error(msg || (r.status + " " + r.statusText));
      });
    });
  }

  /* Список значений в <select>. Пустая опция первой: в старой форме поля стартовали
     с «Select option», и незаполненное поле должно оставаться незаполненным, а не
     молча принимать первое значение справочника. */
  function fillSelect(node, values, placeholder) {
    if (!node) return;
    var html = '<option value="">' + (placeholder || "Select option") + "</option>";
    (values || []).forEach(function (v) {
      html += '<option value="' + esc(v) + '">' + esc(v) + "</option>";
    });
    node.innerHTML = html;
  }

  function fillOptions(node, rows, valueKey, labelFn, placeholder) {
    if (!node) return;
    var html = '<option value="">' + (placeholder || "Select option") + "</option>";
    (rows || []).forEach(function (r) {
      html += '<option value="' + esc(r[valueKey]) + '">' + esc(labelFn(r)) + "</option>";
    });
    node.innerHTML = html;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function dictionaries() {
    if (dict) return Promise.resolve(dict);
    if (!dictPromise) {
      dictPromise = evReq("GET", "/dictionaries").then(function (d) {
        dict = d || {};
        return dict;
      }).catch(function (e) {
        dictPromise = null;                 // дать следующему открытию раздела повторить
        throw e;
      });
    }
    return dictPromise;
  }

  // --------------------------------------------------------------- общий вывод

  function say(msgId, text, cls) {
    var m = el(msgId);
    if (!m) return;
    m.textContent = text || "";
    m.className = "ev-msg" + (cls ? " " + cls : "");
  }

  /* Что именно создалось. Показываем таблицами слоя B с их id: по ним человек найдёт
     строку в базе, если понадобится проверить руками. */
  function renderResult(boxId, res) {
    var box = el(boxId);
    if (!box) return;
    if (!res) { box.innerHTML = ""; return; }
    var rows = (res.rows || []).map(function (r) {
      return "<tr><td class=\"tbl\">" + esc(r.table) + "</td><td>" + esc(r.id) + "</td></tr>";
    }).join("");
    var warn = (res.warnings || []).map(function (w) {
      return '<div class="ev-warn">' + esc(w) + "</div>";
    }).join("");
    box.innerHTML =
      '<div class="ev-rows"><table><thead><tr><th>Таблица</th><th>id</th></tr></thead>' +
      "<tbody>" + rows + "</tbody></table></div>" + warn;
  }

  function fail(msgId, e) {
    var text = (e && (e.message || e.error)) || "Не удалось завести событие";
    say(msgId, text, "err");
  }

  function num(id) {
    var v = el(id) ? String(el(id).value).trim() : "";
    if (v === "") return null;
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : null;
  }

  function str(id) { return el(id) ? String(el(id).value).trim() : ""; }

  /* date_start в форме только показывается: поле недоступно для правки, а реальную
     метку ставит сервер в момент вставки. Держать здесь значение, набранное при
     открытии раздела, нельзя — форму заполняют и по десять минут, и в t_launch_settings
     уехало бы время открытия страницы, а не время заведения события. */
  function stampNow(id) {
    var node = el(id);
    if (!node) return;
    var d = new Date();
    function p2(n) { return (n < 10 ? "0" : "") + n; }
    node.value = d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) +
                 "T" + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds());
  }
  function chk(id) { return !!(el(id) && el(id).checked); }

  // ============================================================ ОНЛАЙН-СОБЫТИЕ

  function initOnline() {
    if (inited.online) return;
    inited.online = true;

    el("evoSubmit").onclick = submitOnline;
    el("evoReset").onclick = function () { resetOnline(); };
    if (!can("add", "ev-online")) {
      el("evoSubmit").disabled = true;
      el("evoSubmit").title = "Нет права на заведение событий в этом разделе";
    }

    dictionaries().then(function (d) {
      fillSelect(el("evoChannel"), d.notifyChannels);
      fillSelect(el("evoDefKey"), d.definitionKeys);
      fillSelect(el("evoPrefix"), d.businessKeyPrefixes);
      fillSelect(el("evoSystem"), d.systems);
      fillOptions(el("evoComm"), d.commCreations, "id", function (c) {
        /* подпись собираем из параметров: по одному id набор не опознать */
        return "#" + c.id + " · " + (c.notify_channel || "—") +
               " · delay " + (c.send_delay == null ? "—" : c.send_delay) +
               " · lifetime " + (c.lifetime == null ? "—" : c.lifetime);
      });
    }).catch(function (e) { fail("evoMsg", e); });
  }

  function resetOnline() {
    ["evoName", "evoSource", "evoTemplate"].forEach(function (id) {
      if (el(id)) el(id).value = id === "evoTemplate" ? "0" : "";
    });
    ["evoChannel", "evoDefKey", "evoPrefix", "evoSystem", "evoComm"].forEach(function (id) {
      if (el(id)) el(id).value = "";
    });
    if (el("evoActive")) el("evoActive").checked = false;
    say("evoMsg", "");
    renderResult("evoResult", null);
  }

  function submitOnline() {
    say("evoMsg", "Сохраняем…");
    renderResult("evoResult", null);
    var body = {
      eventName: str("evoName"),
      source: str("evoSource"),
      notifyChannel: str("evoChannel"),
      definitionKey: str("evoDefKey"),
      businessKeyPrefix: str("evoPrefix"),
      templateId: num("evoTemplate"),
      system: str("evoSystem"),
      isActive: chk("evoActive"),
      isBatch: false,
      idCommCreation: num("evoComm")
    };
    evReq("POST", "/online", body).then(function (res) {
      say("evoMsg", "Событие «" + res.eventName + "» заведено (id " + res.eventId + ")", "ok");
      renderResult("evoResult", res);
      /* Имя события уникально вместе с системой — очищаем поле, чтобы повторное
         нажатие не упёрлось в «уже заведено». Остальное оставляем: соседнее событие
         обычно отличается одним-двумя полями. */
      if (el("evoName")) el("evoName").value = "";
    }).catch(function (e) { fail("evoMsg", e); });
  }

  // =================================================== СОБЫТИЕ ПО РАСПИСАНИЮ

  function initOffline() {
    if (inited.offline) return;
    inited.offline = true;

    el("evfSubmit").onclick = submitOffline;
    el("evfReset").onclick = function () { resetOffline(); };
    el("evfStepCount").oninput = renderSteps;
    if (!can("add", "ev-offline")) {
      el("evfSubmit").disabled = true;
      el("evfSubmit").title = "Нет права на заведение событий в этом разделе";
    }
    renderSteps();
    stampNow("evfDateStart");

    dictionaries().then(function (d) {
      fillSelect(el("evfChannel"), d.notifyChannels);
      fillSelect(el("evfDefKey"), d.definitionKeys);
      fillSelect(el("evfPrefix"), d.businessKeyPrefixes);
      fillSelect(el("evfSystem"), d.systems);
      /* Базы — из справочника flow.d_database: на колонке database висит внешний ключ,
         и значение вне справочника упало бы уже на вставке. */
      fillSelect(el("evfDatabase"), d.databases, "Select option");
      if (el("evfDatabase") && (d.databases || []).indexOf("crmdb") >= 0) {
        el("evfDatabase").value = "crmdb";
      }
    }).catch(function (e) { fail("evfMsg", e); });
  }

  /* Блоки SQL-шагов по числу из «количество шагов». Уже введённый текст сохраняем:
     человек мог набрать три запроса и опечататься в счётчике. */
  function renderSteps() {
    var box = el("evfSteps");
    if (!box) return;
    var want = Math.max(1, Math.min(20, parseInt(el("evfStepCount").value, 10) || 1));
    /* Сохраняем и текст, и галку «вернуть результат»: блоки перерисовываются на каждый
       ввод в счётчике шагов, и без этого набранное пропадало бы от одной опечатки. */
    var kept = [], keptRes = [];
    box.querySelectorAll("[data-step-sql]").forEach(function (t) { kept.push(t.value); });
    box.querySelectorAll("[data-step-res]").forEach(function (c) { keptRes.push(c.checked); });

    var html = "";
    for (var i = 0; i < want; i++) {
      var n = i + 1;
      var res = i < keptRes.length ? keptRes[i] : true;
      html +=
        '<div class="ev-sql">' +
          '<div class="h"><b>Шаг ' + n + "</b>" +
            '<label class="ev-chk"><input type="checkbox" data-step-res="' + i + '"' +
              (res ? " checked" : "") + "> вернуть результат</label>" +
          "</div>" +
          '<div class="ev-fields">' +
            '<div class="ev-f wide"><label>Шаг ' + n + " — SQL</label>" +
              '<textarea data-step-sql="' + i + '" spellcheck="false">' + esc(kept[i] || "") + "</textarea></div>" +
            '<div class="ev-f"><label>Шаг ' + n + ' — порядковый номер</label>' +
              '<input type="number" data-step-ord="' + i + '" value="' + (n * 10) + '" min="1" step="1"></div>' +
          "</div>" +
        "</div>";
    }
    box.innerHTML = html;
  }

  function collectSteps() {
    var box = el("evfSteps");
    var out = [];
    if (!box) return out;
    box.querySelectorAll("[data-step-sql]").forEach(function (t) {
      var i = t.getAttribute("data-step-sql");
      var ord = box.querySelector('[data-step-ord="' + i + '"]');
      var res = box.querySelector('[data-step-res="' + i + '"]');
      out.push({
        sql: String(t.value || "").trim(),
        orderNum: ord ? (parseInt(ord.value, 10) || null) : null,
        returnsResultSet: res ? !!res.checked : true
      });
    });
    return out;
  }

  function resetOffline() {
    ["evfName", "evfSource", "evfCrontab"]
      .forEach(function (id) { if (el(id)) el(id).value = ""; });
    stampNow("evfDateStart");
    if (el("evfTemplate")) el("evfTemplate").value = "0";
    ["evfChannel", "evfDefKey", "evfPrefix", "evfSystem"].forEach(function (id) {
      if (el(id)) el(id).value = "";
    });
    if (el("evfActive")) el("evfActive").checked = false;
    if (el("evfBatch")) el("evfBatch").checked = true;
    if (el("evfChain")) el("evfChain").checked = false;
    if (el("evfStepCount")) el("evfStepCount").value = "1";
    renderSteps();
    say("evfMsg", "");
    renderResult("evfResult", null);
  }

  function submitOffline() {
    var steps = collectSteps();
    if (steps.some(function (s) { return !s.sql; })) {
      say("evfMsg", "У каждого шага должен быть SQL", "err");
      return;
    }
    say("evfMsg", "Сохраняем…");
    renderResult("evfResult", null);
    var body = {
      /* selection не передаём: он равен имени события, и сервер подставит его сам —
         иначе форма несла бы два поля с одним и тем же значением. */
      eventName: str("evfName"),
      source: str("evfSource"),
      notifyChannel: str("evfChannel"),
      definitionKey: str("evfDefKey"),
      businessKeyPrefix: str("evfPrefix"),
      templateId: num("evfTemplate"),
      system: str("evfSystem"),
      isActive: chk("evfActive"),
      isBatch: chk("evfBatch"),
      isChain: chk("evfChain"),
      database: str("evfDatabase"),
      crontab: str("evfCrontab"),
      steps: steps
    };
    evReq("POST", "/offline", body).then(function (res) {
      say("evfMsg", "Событие «" + res.eventName + "» заведено (id " + res.eventId + ")", "ok");
      renderResult("evfResult", res);
      if (el("evfName")) el("evfName").value = "";
      stampNow("evfDateStart");
    }).catch(function (e) { fail("evfMsg", e); });
  }

  // Инициализация ленивая, по первому открытию раздела (см. openSection в shell.js).
  window.initEventOnlineSection = initOnline;
  window.initEventOfflineSection = initOffline;
})();
