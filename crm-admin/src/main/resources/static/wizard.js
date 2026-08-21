/* Инициализация форм «Мастера коммуникаций» под набор полей v2:
   - наполнение селектов Product Type / Touch point значениями из v2;
   - подсказки редактируемого combobox «Communication Name» (сид + живые из БД);
   - переключатель поля цепочки (chain);
   - синхронизация data-comname-base при ручном вводе. */
(function () {
  "use strict";

  // Значения из Appsmith-экспорта v2 (sourceData соответствующих SELECT-виджетов).
  var PRODUCT_OPTIONS = [
    "rko", "deposits", "creditcards", "business_credits", "insurance_etc",
    "investments", "savings_account", "mortgages", "osago", "debitcards",
    "microloans", "insurance_health", "autocredits", "kasko", "lsre",
    "general", "cash_register", "insurance_combo", "exchange_rate",
    "insurance_estate", "credits"
  ];
  // Резерв на случай недоступного справочника: основной источник — reference.d_touch_point
  var TOUCH_OPTIONS = [
    "promo", "abandoned-view", "abandoned-form", "abandoned-showcase",
    "abandoned-application", "abandoned-approval", "abandoned-splash",
    "abandoned-rejection", "abandoned-identification", "abandoned-doc-load",
    "sign", "abandoned-payment", "abandoned-refill", "issue", "renewal", "mobile-app"
  ];
  // Резерв подсказок communication_name; основной источник — reference.d_communication_name.
  var COMNAME_SEED = [
    "NoComName", "subscription", "out-trigger-", "promo", "reset-email",
    "reset-password", "change-email", "change-password", "change-phone",
    "confirm-email", "confirm-phone", "promocode", "nps", "loyalty", "welcome",
    "-cross", "-marketplace", "-nr", "-loyalty",
    "abandoned-view", "abandoned-form", "abandoned-showcase", "abandoned-application",
    "abandoned-approval", "abandoned-rejection", "abandoned-identification",
    "abandoned-doc-load", "sign", "abandoned-payment", "abandoned-refill", "issue", "renewal"
  ];

  function fillSelect(sel, options, def) {
    if (!sel || sel.dataset.filled) return;
    sel.dataset.filled = "1";
    sel.innerHTML = "";
    options.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o; opt.textContent = o;
      sel.appendChild(opt);
    });
    if (def != null && options.indexOf(def) >= 0) sel.value = def;
  }

  /* Перезаполнить селект значениями из справочника БД, сохранив выбранное. */
  function refillSelect(sel, options, def) {
    if (!sel || !options || !options.length) return;
    var current = sel.value;
    sel.innerHTML = "";
    options.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o; opt.textContent = o;
      sel.appendChild(opt);
    });
    if (current && options.indexOf(current) >= 0) sel.value = current;
    else if (def != null && options.indexOf(def) >= 0) sel.value = def;
  }

  /* Точки касания: справочник reference.d_touch_point (фолбэк — зашитый список). */
  function loadTouchPoints() {
    if (!window.CRM || !CRM.dictTouchPoints) return;
    CRM.dictTouchPoints().then(function (list) {
      if (!Array.isArray(list) || !list.length) return;
      document.querySelectorAll("select.touch").forEach(function (s) {
        refillSelect(s, list, "promo");
      });
    }).catch(function () { /* справочник недоступен — остаётся фолбэк */ });
  }

  // Столбцы таблицы цепочки по каналу (день + редактируемые поля шаблона), как в v2 generateRows.
  var CHAIN_COLUMNS = {
    sms:   [{ key: "message",  label: "Message Text", type: "textarea" }],
    push:  [{ key: "title",    label: "Title Text",   type: "text" },
            { key: "message",  label: "Message Text", type: "textarea" },
            { key: "deeplink", label: "Deep Link",    type: "text" },
            { key: "webview",  label: "Webview link", type: "text" }],
    email: [{ key: "letteros_id", label: "Letteros Id", type: "text" }]
  };

  // Переключатель блока цепочки: показать/скрыть ввод дней и таблицу.
  window.toggleChainField = function (el) {
    var form = el.closest(".form");
    if (!form) return;
    var wrap = form.querySelector(".chain-field");
    if (!wrap) return;
    if (el.checked) { wrap.style.display = ""; }
    else {
      wrap.style.display = "none";
      var days = form.querySelector(".chain-days"); if (days) days.value = "";
      var rows = form.querySelector(".chain-rows"); if (rows) rows.innerHTML = "";
    }
  };

  // Генерация строк цепочки: парсим список дней → строим таблицу для ввода данных по каждому дню.
  window.buildChainRows = function (el) {
    var form = el.closest(".form");
    if (!form) return;
    var channel = form.id;                       // sms | push | email
    var cols = CHAIN_COLUMNS[channel];
    if (!cols) return;
    var raw = (form.querySelector(".chain-days") || {}).value || "";
    var days = raw.split(/[\s,;]+/).map(function (s) { return s.trim(); })
                  .filter(function (s) { return s !== ""; }).map(Number)
                  .filter(function (n) { return !isNaN(n); });
    if (!days.length) { alert("Введите хотя бы один день (число), напр. 0, 3, 7"); return; }
    if (new Set(days).size !== days.length) { alert("Дни не должны повторяться"); return; }

    var host = form.querySelector(".chain-rows");
    if (!host) return;
    var html = '<table class="chain-table"><thead><tr><th style="width:70px;">День</th>';
    cols.forEach(function (c) { html += "<th>" + c.label + "</th>"; });
    html += "</tr></thead><tbody>";
    days.forEach(function (day) {
      html += '<tr data-chain-row data-day="' + day + '"><td class="chain-day">' + day + "</td>";
      cols.forEach(function (c) {
        if (c.type === "textarea") html += '<td><textarea class="crow-' + c.key + '" rows="2"></textarea></td>';
        else html += '<td><input class="crow-' + c.key + '"></td>';
      });
      html += "</tr>";
    });
    html += "</tbody></table>";
    host.innerHTML = html;
  };

  // Считать строки цепочки из таблицы. Возвращает [{day, overrides:{...}}] или null при ошибке валидации.
  window.readChainRows = function (formEl, channel) {
    var cols = CHAIN_COLUMNS[channel] || [];
    var trs = formEl.querySelectorAll(".chain-rows tr[data-chain-row]");
    if (!trs.length) return [];
    var required = { sms: ["message"], push: ["title", "message"], email: ["letteros_id"] }[channel] || [];
    var out = [];
    for (var i = 0; i < trs.length; i++) {
      var tr = trs[i];
      var day = tr.getAttribute("data-day");
      var overrides = {};
      cols.forEach(function (c) {
        var inp = tr.querySelector(".crow-" + c.key);
        overrides[c.key] = inp ? inp.value : "";
      });
      for (var j = 0; j < required.length; j++) {
        if (!String(overrides[required[j]] || "").trim()) {
          alert("Заполните «" + (cols.filter(function (c) { return c.key === required[j]; })[0] || {}).label +
                "» для дня " + day);
          return null;
        }
      }
      out.push({ day: day, overrides: overrides });
    }
    return out;
  };

  function initForms(root) {
    (root || document).querySelectorAll("select.product").forEach(function (s) { fillSelect(s, PRODUCT_OPTIONS, "credits"); });
    (root || document).querySelectorAll("select.touch").forEach(function (s) { fillSelect(s, TOUCH_OPTIONS, "promo"); });

    // combobox communication_name: сид-подсказки + attach.
    (root || document).querySelectorAll("input.combo-input.comname").forEach(function (inp) {
      if (window.Combobox) window.Combobox.setOptions(inp, COMNAME_SEED.slice());
      // при ручном вводе фиксируем базу для авто-достройки флагов
      if (!inp._baseBound) {
        inp._baseBound = true;
        inp.addEventListener("input", function () {
          if (typeof inferComNameBase === "function") {
            var base = inferComNameBase(inp.value);
            if (base) inp.setAttribute("data-comname-base", base);
          }
        });
      }
    });
    if (window.Combobox) window.Combobox.attach(root || document);
  }

  // Живые значения communication_name из БД по каналам → в подсказки combobox.
  function loadLiveComNames() {
    if (!window.CRM || !CRM.dictCommNames) return;
    [["sms", "sms"], ["push", "push"], ["email", "email"], ["cc", "cc"]].forEach(function (pair) {
      var domId = pair[0], channel = pair[1];
      CRM.dictCommNames(channel).then(function (list) {
        if (!Array.isArray(list) || !list.length) return;
        var inp = document.querySelector("#" + domId + " input.combo-input.comname");
        if (!inp || !window.Combobox) return;
        var merged = list.concat(COMNAME_SEED.filter(function (s) { return list.indexOf(s) < 0; }));
        window.Combobox.setOptions(inp, merged);
      }).catch(function () { /* нет эндпоинта/данных — остаются сид-подсказки */ });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initForms(document);
    loadTouchPoints();   // reference.d_touch_point
    loadLiveComNames();  // reference.d_communication_name + значения из шаблонов
  });
})();
