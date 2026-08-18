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
  var inited = { online: false, offline: false, list: false };

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
    /* Галка «вернуть результат» стоит ТОЛЬКО у последнего шага: промежуточные шаги
       готовят выборку, а отдаёт её движку последний. Ставили её всем — и тогда
       результат возвращал каждый шаг. Правку руками уважаем: если человек снял или
       поставил галку сам, при перерисовке блоков она сохраняется. */
    var touched = box.getAttribute("data-res-touched") === "1";

    var html = "";
    for (var i = 0; i < want; i++) {
      var n = i + 1;
      var res = touched && i < keptRes.length ? keptRes[i] : (i === want - 1);
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
    box.querySelectorAll("[data-step-res]").forEach(function (c) {
      c.onchange = function () { box.setAttribute("data-res-touched", "1"); };
    });
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
    if (el("evfSteps")) el("evfSteps").removeAttribute("data-res-touched");
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

  // ============================================================ СПИСОК СОБЫТИЙ

  var evl = { offset: 0, limit: 50, total: 0 };

  function initList() {
    if (inited.list) return;
    inited.list = true;
    el("evlApply").onclick = function () { evl.offset = 0; loadList(); };
    el("evlReset").onclick = function () {
      ["evlQ", "evlKind", "evlChannel", "evlActive", "evlExported"].forEach(function (id) {
        if (el(id)) el(id).value = "";
      });
      evl.offset = 0;
      loadList();
    };
    el("evlPrev").onclick = function () {
      evl.offset = Math.max(0, evl.offset - evl.limit);
      loadList();
    };
    el("evlNext").onclick = function () {
      if (evl.offset + evl.limit < evl.total) { evl.offset += evl.limit; loadList(); }
    };
    /* Enter в поиске — то же, что «Показать»: набрал и нажал, без похода к кнопке. */
    el("evlQ").onkeydown = function (e) {
      if (e.key === "Enter") { evl.offset = 0; loadList(); }
    };
    evReq("GET", "/list/facets").then(function (f) {
      fillSelect(el("evlChannel"), f.channels, "любой");
    }).catch(function () { /* фильтр по каналу останется пустым, список от этого не зависит */ });
    loadList();
  }

  function listQuery() {
    var p = [];
    function add(k, v) { if (v) p.push(k + "=" + encodeURIComponent(v)); }
    add("q", str("evlQ"));
    add("kind", str("evlKind"));
    add("channel", str("evlChannel"));
    add("active", str("evlActive"));
    add("exported", str("evlExported"));
    p.push("limit=" + evl.limit);
    p.push("offset=" + evl.offset);
    return "?" + p.join("&");
  }

  function loadList() {
    say("evlMsg", "Загружаем…");
    evReq("GET", "/list" + listQuery()).then(function (d) {
      evl.total = Number(d.total || 0);
      say("evlMsg", evl.total ? "Найдено событий: " + evl.total : "Ничего не нашлось", "");
      renderList(d.rows || []);
      var pager = el("evlPager");
      pager.style.display = evl.total > evl.limit ? "" : "none";
      el("evlPrev").disabled = evl.offset === 0;
      el("evlNext").disabled = evl.offset + evl.limit >= evl.total;
      el("evlPage").textContent = evl.total
        ? (evl.offset + 1) + "-" + Math.min(evl.offset + evl.limit, evl.total) + " из " + evl.total
        : "";
    }).catch(function (e) { fail("evlMsg", e); });
  }

  function kindLabel(k) { return k === "time" ? "по расписанию" : "онлайновое"; }

  /* Состояние планировщика словами: три колонки прода со словом status разложены по
     трём с честными именами, и показывать их сырыми значениями незачем. */
  function stateLabel(r) {
    if (!r.phase && !r.cron_state && !r.last_result) return "—";
    var parts = [];
    if (r.phase) parts.push({ NEW: "новое", WAITING: "ждёт", PROCESSING: "идёт" }[r.phase] || r.phase);
    if (r.cron_state) parts.push(r.cron_state === "STARTED" ? "крон знает" : "крон не знает");
    if (r.last_result) parts.push(r.last_result === "SUCCESS" ? "прошлый успешно" : "прошлый с ошибкой");
    return parts.join(" · ");
  }

  function renderList(rows) {
    var box = el("evlBox");
    if (!box) return;
    if (!rows.length) { box.innerHTML = ""; return; }
    var html = '<div class="ev-rows"><table><thead><tr>' +
      "<th>id</th><th>Событие</th><th>Система</th><th>Род</th><th>Канал</th>" +
      "<th>Расписание</th><th>Шаблоны</th><th>Состояние</th><th>Активно</th><th>В проде</th>" +
      "</tr></thead><tbody>";
    rows.forEach(function (r) {
      var tplCell = r.templates
        ? esc(r.templates)
        : (Number(r.templates_total || 0) ? "не опознаны (" + r.templates_total + ")" : "—");
      html += '<tr class="clickable" data-ev="' + esc(r.id) + '">' +
        "<td>" + esc(r.id) + "</td>" +
        "<td>" + esc(r.event_name) + "</td>" +
        "<td>" + esc(r.system || "—") + "</td>" +
        "<td>" + kindLabel(r.kind) + "</td>" +
        "<td>" + esc(r.notify_channel || "—") + "</td>" +
        "<td>" + esc(r.crontab || "—") + "</td>" +
        "<td>" + tplCell + "</td>" +
        "<td>" + esc(stateLabel(r)) + "</td>" +
        "<td>" + (r.is_active ? "да" : "нет") + "</td>" +
        "<td>" + (Number(r.exported || 0) ? "да" : "нет") + "</td>" +
        "</tr>" +
        '<tr data-card="' + esc(r.id) + '" style="display:none"><td colspan="10"></td></tr>';
    });
    box.innerHTML = html + "</tbody></table></div>";
    box.querySelectorAll("[data-ev]").forEach(function (tr) {
      tr.onclick = function () { toggleCard(tr.getAttribute("data-ev")); };
    });
  }

  /* Карточка грузится по клику, а не вместе со списком: полная обвязка это ещё шесть
     запросов на строку, и на странице в пятьдесят строк вышло бы триста запросов. */
  function toggleCard(id) {
    var row = el("evlBox").querySelector('[data-card="' + id + '"]');
    if (!row) return;
    if (row.style.display !== "none") { row.style.display = "none"; return; }
    var cell = row.firstChild;
    cell.innerHTML = '<div class="ev-card">Загружаем…</div>';
    row.style.display = "";
    evReq("GET", "/list/" + encodeURIComponent(id)).then(function (d) {
      cell.innerHTML = renderCard(d);
    }).catch(function (e) {
      cell.innerHTML = '<div class="ev-card" style="color:var(--red,#e5484d)">' +
        esc((e && e.message) || "Не удалось загрузить карточку") + "</div>";
    });
  }

  function dlist(pairs) {
    var out = "";
    pairs.forEach(function (p) {
      if (p[1] === null || p[1] === undefined || p[1] === "") return;
      out += "<dt>" + esc(p[0]) + "</dt><dd>" + esc(p[1]) + "</dd>";
    });
    return out ? "<dl>" + out + "</dl>" : '<div style="color:var(--faint)">пусто</div>';
  }

  function renderCard(d) {
    var e = d.event || {}, dv = d.delivery || {}, s = d.schedule || {}, st = d.state || {};
    var html = '<div class="ev-card"><h4>Событие</h4>' + dlist([
      ["source", e.source], ["группа", e.group_event_descr], ["описание", e.description],
      ["заведено", String(e.timestamp_cr || "").slice(0, 19).replace("T", " ")]
    ]) + "</div>";

    html += '<div class="ev-card"><h4>Доставка</h4>' + dlist([
      ["канал", dv.notify_channel], ["sub_channel", dv.sub_channel], ["платформа", dv.platform],
      ["задержка", dv.send_delay], ["время жизни", dv.life_time], ["ML", dv.allow_ml ? "да" : null]
    ]) + "</div>";

    if (e.kind === "time") {
      html += '<div class="ev-card"><h4>Расписание</h4>' + dlist([
        ["кронтаб", s.crontab], ["база выборки", s.database],
        ["массовая отправка", s.is_batch ? "да" : "нет"],
        ["попыток", s.max_retry_attempts], ["группа заданий", s.job_group],
        ["фаза", st.phase], ["крон", st.cron_state], ["прошлый прогон", st.last_result],
        ["следующий запуск", st.date_next]
      ]) + "</div>";

      var steps = d.steps || [];
      html += '<div class="ev-card"><h4>Шаги выборки (' + steps.length + ")</h4>";
      html += steps.length ? steps.map(function (x) {
        return '<div style="margin-bottom:8px"><b>' + esc(x.order_num) + ". " + esc(x.process_name || "") + "</b>" +
          (x.returns_result_set ? " · возвращает результат" : "") +
          (x.is_active ? "" : " · выключен") +
          "<pre>" + esc(x.sql_text || "") + "</pre></div>";
      }).join("") : '<div style="color:var(--faint)">нет</div>';
      html += "</div>";
    }

    var tpl = d.templates || [];
    html += '<div class="ev-card"><h4>Шаблоны (' + tpl.length + ")</h4>";
    html += tpl.length ? '<div class="ev-rows"><table><tbody>' + tpl.map(function (x) {
      return "<tr><td>" + (x.step_no == null ? "одиночный" : "шаг " + esc(x.step_no)) + "</td>" +
        "<td>" + (x.code ? esc(x.channel) + ":" + esc(x.code) : "не найден у нас") + "</td>" +
        "<td>" + esc(x.communication_name || "") + "</td></tr>";
    }).join("") + "</tbody></table></div>" : '<div style="color:var(--faint)">нет</div>';
    html += "</div>";

    var links = d.links || [];
    if (links.length) {
      html += '<div class="ev-card"><h4>Связи с crmdb (' + links.length + ")</h4>" +
        '<div class="ev-rows"><table><thead><tr><th>Таблица</th><th>наш id</th>' +
        "<th>id в crmdb</th><th>Направление</th></tr></thead><tbody>" +
        links.map(function (x) {
          return '<tr><td class="tbl">' + esc(x.our_table) + "</td><td>" + esc(x.our_id) +
            "</td><td>" + esc(x.prod_id) + "</td><td>" +
            (x.direction === "IMPORT" ? "затянуто из crmdb" : "отправлено в crmdb") + "</td></tr>";
        }).join("") + "</tbody></table></div></div>";
    }
    return html;
  }

  /* Перелив события в боевую базу уехал в настройки (/settings → «Переливы» →
     «Перелив событий в прод»). Раздел «События» остался про заведение и просмотр:
     доставка наружу — процесс того же рода, что синхронизация шаблонов, и место
     ему рядом с ней. Ручки не менялись, секция ev-export тоже. */

  // Инициализация ленивая, по первому открытию раздела (см. openSection в shell.js).
  window.initEventOnlineSection = initOnline;
  window.initEventOfflineSection = initOffline;
  window.initEventListSection = initList;
})();
