/* ============================================================
   СПРАВОЧНИКИ ЗНАЧЕНИЙ — экран из двух уровней: список таблиц и редактор одной из них.

   Раньше все справочники висели карточками на одной странице. Пока их было два и оба
   состояли из одного слова, это читалось; с появлением «Процессов каналов», где в строке
   четыре поля, одностраничный вид превратился в кашу — списки разного устройства рядом
   выглядят как один список. Поэтому сначала выбираем таблицу, потом правим её.

   Ни разметка строки, ни форма добавления здесь не зашиты: сервер отдаёт описание колонок
   (имя, подпись, тип, обязательность, варианты выбора), а экран строится по нему. Добавить
   третий справочник — запись в REF_TABLES на сервере, правок здесь не требуется.

   Два решения, которые важнее кода.

   Первое: удалять можно только неиспользуемое. Внешнего ключа между справочником и
   template.d_template нет — там обычная строка. Удаление значения из справочника не
   уберёт его из шаблонов, а только лишит объяснения: в шаблоне останется touch_point,
   которого «не существует». Поэтому занятое значение выключают, и кнопка удаления у него
   не показывается вовсе, а не отказывает по нажатию.

   Второе: выключенные значения видны. В выпадашках их нет, но здесь человек должен
   видеть, что значение существует, — иначе заведёт заново и упрётся в UNIQUE.
   ============================================================ */
window.Refs = (function () {
  "use strict";

  var catalog = [];     // список справочников с описанием колонок
  var current = null;   // открытый справочник, null — показываем список
  var rows = [];
  var editing = null;   // id строки в режиме правки
  var busy = false;

  function T(s) { return (typeof window.t2 === "function") ? window.t2(s) : s; }
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function host() { return document.getElementById("refsHost"); }

  function api(method, url, body) {
    return fetch(url, {
      method: method, credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body == null ? undefined : JSON.stringify(body)
    }).then(function (r) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { /* не json — ниже */ }
        if (!r.ok) {
          /* Сообщение сервера показываем как есть: там написано, ПОЧЕМУ нельзя
             («значение стоит у 12 шаблонов»), и своими словами это не пересказать. */
          throw new Error((data && (data.message || data.error)) || txt || ("HTTP " + r.status));
        }
        return data;
      });
    });
  }

  function note(text, bad) {
    var el = document.getElementById("refs-msg");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = bad ? "var(--coral)" : "var(--dim)";
  }

  // ------------------------------------------------------------------ экран 1: таблицы

  function renderCatalog() {
    var h = host();
    if (!h) return;
    h.className = "refs-host";
    if (!catalog.length) {
      h.innerHTML = '<div class="refs-empty">' + T("Справочников нет") + "</div>";
      return;
    }
    h.innerHTML = catalog.map(function (c) {
      var cols = c.columns.map(function (x) { return x.label; }).join(" · ");
      return '<div class="refs-card link" onclick="Refs.openKind(\'' + c.kind + '\')">' +
        "<h2>" + esc(c.title) + "</h2>" +
        '<div class="refs-tbl">' + esc(c.table) + "</div>" +
        '<div class="refs-hint">' + esc(c.hint) + "</div>" +
        '<div class="refs-meta">' + c.total + " " + T("значений") +
          (c.inactive ? " · " + c.inactive + " " + T("выключено") : "") +
          '<span class="refs-cols">' + esc(cols) + "</span></div>" +
      "</div>";
    }).join("");
  }

  // ------------------------------------------------------------------ экран 2: одна таблица

  /** Поле формы по описанию колонки: тип решает сервер, не разметка. */
  function field(col, value, idPrefix) {
    var id = idPrefix + col.name;
    if (col.type === "select") {
      return '<select id="' + id + '" class="refs-inp">' +
        col.options.map(function (o) {
          return '<option value="' + esc(o) + '"' + (String(value) === o ? " selected" : "") + ">" +
                 esc(o) + "</option>";
        }).join("") + "</select>";
    }
    return '<input id="' + id + '" class="refs-inp"' +
      (col.type === "int" ? ' type="number"' : "") +
      ' placeholder="' + esc(col.label) + '" value="' + esc(value == null ? "" : value) + '">';
  }

  /* Число колонок уезжает переменной, а не готовым grid-template-columns: инлайновый
     стиль медиазапросом не перебить иначе как !important, а на узком экране строка
     должна складываться в столбик. */
  function grid(n) { return "--cols:" + n + ";"; }

  /* Ячейка помнит подпись своей колонки: на узком экране шапки нет, и без подписи
     «100» под именем партнёра прочитать нельзя. */
  function cell(col, inner) {
    return '<div class="refs-cell" data-label="' + esc(col.label) + '">' + inner + "</div>";
  }

  function renderTable() {
    var h = host();
    if (!h || !current) return;
    h.className = "refs-one";
    var cols = current.columns;

    var head = '<div class="refs-head">' +
      '<button type="button" class="refs-btn" onclick="Refs.back()">← ' + T("к списку") + "</button>" +
      "<h2>" + esc(current.title) + "</h2>" +
      '<span class="refs-tbl">' + esc(current.table) + "</span></div>" +
      '<div class="refs-hint">' + esc(current.hint) + "</div>";

    /* Форма добавления повторяет колонки строки один в один и стоит НАД списком:
       кнопка «+» под длинным списком уезжает за экран, и её ищут прокруткой. */
    var add = '<div class="refs-add" style="' + grid(cols.length) + '">' +
      cols.map(function (c) { return cell(c, field(c, "", "refs-new-")); }).join("") +
      '<button type="button" class="refs-btn primary" onclick="Refs.add()">' + T("Добавить") +
      "</button></div>" +
      '<div class="refs-msg" id="refs-msg"></div>';

    var header = '<div class="refs-row header" style="' + grid(cols.length) + '">' +
      cols.map(function (c) { return "<span>" + esc(c.label) + "</span>"; }).join("") +
      "<span></span></div>";

    var list = rows.length
      ? rows.map(function (r) { return row(r, cols); }).join("")
      : '<div class="refs-empty">' + T("Справочник пуст") + "</div>";

    h.innerHTML = head + add + header + '<div class="refs-list">' + list + "</div>";
  }

  function row(r, cols) {
    var used = Number(r.used || 0);
    var edit = editing === r.id;
    var cells = cols.map(function (c) {
      return cell(c, edit ? field(c, r[c.name], "refs-ed-")
                          : '<span class="refs-val">' + esc(r[c.name]) + "</span>");
    }).join("");
    var acts = edit
      ? '<button type="button" class="refs-btn primary" onclick="Refs.save(' + r.id + ')">' +
          T("Сохранить") + '</button><button type="button" class="refs-btn" onclick="Refs.edit(null)">' +
          T("Отмена") + "</button>"
      : '<button type="button" class="refs-btn" onclick="Refs.edit(' + r.id + ')">' + T("Править") +
        '</button><button type="button" class="refs-btn" onclick="Refs.toggle(' + r.id + "," +
          (r.isActive ? "false" : "true") + ')">' + T(r.isActive ? "Выключить" : "Включить") +
        "</button>" +
        (used
          /* У занятого значения кнопки удаления нет: отказ по нажатию человек читает
             как поломку, а отсутствие кнопки — как правило. */
          ? '<span class="refs-lock" title="' + T("Пока значение стоит в шаблонах, удалить его нельзя") +
            '">' + used + " " + T("шабл.") + "</span>"
          : '<button type="button" class="refs-btn del" onclick="Refs.remove(' + r.id + ')">' +
            T("Удалить") + "</button>");
    return '<div class="refs-row' + (r.isActive ? "" : " off") + '" style="' + grid(cols.length) + '">' +
      cells + '<span class="refs-acts">' + acts + "</span></div>";
  }

  // ------------------------------------------------------------------ данные

  function loadRows() {
    return api("GET", "../api/dictionaries/refs/" + current.kind).then(function (data) {
      rows = data || [];
      renderTable();
    }).catch(function (e) {
      renderTable();
      note(T("Не удалось прочитать: ") + e.message, true);
    });
  }

  /** Значения из формы: пустые не отправляем — сервер сам скажет, чего не хватает. */
  function collect(prefix) {
    var body = {};
    current.columns.forEach(function (c) {
      var el = document.getElementById(prefix + c.name);
      if (!el) return;
      var v = String(el.value || "").trim();
      if (v !== "") body[c.name] = v;
    });
    return body;
  }

  function run(promise) {
    if (busy) return;
    busy = true;
    promise
      .then(function () { editing = null; return loadRows(); })
      .catch(function (e) { note(e.message, true); })
      .then(function () { busy = false; });
  }

  return {
    open: function () {
      var h = host();
      if (h) h.innerHTML = '<div class="refs-empty">' + T("Загружаю…") + "</div>";
      current = null;
      editing = null;
      return api("GET", "../api/dictionaries/refs").then(function (data) {
        catalog = data || [];
        renderCatalog();
      }).catch(function (e) {
        if (h) h.innerHTML = '<div class="refs-empty">' + T("Не удалось прочитать: ") +
                             esc(e.message) + "</div>";
      });
    },

    openKind: function (kind) {
      for (var i = 0; i < catalog.length; i++) {
        if (catalog[i].kind === kind) { current = catalog[i]; break; }
      }
      if (!current) return;
      editing = null;
      rows = [];
      renderTable();
      loadRows();
    },

    /* Возврат перечитывает список: счётчики значений на карточках должны совпадать
       с тем, что человек только что наменял, иначе им перестают верить. */
    back: function () { this.open(); },

    add: function () { run(api("POST", "../api/dictionaries/refs/" + current.kind, collect("refs-new-"))); },

    edit: function (id) { editing = id; renderTable(); },

    save: function (id) {
      run(api("PATCH", "../api/dictionaries/refs/" + current.kind + "/" + id, collect("refs-ed-")));
    },

    toggle: function (id, active) {
      run(api("PATCH", "../api/dictionaries/refs/" + current.kind + "/" + id, { isActive: active }));
    },

    remove: function (id) {
      var what = "";
      rows.forEach(function (r) {
        if (r.id === id) what = current.columns.map(function (c) { return r[c.name]; }).join(" · ");
      });
      if (!confirm(T("Удалить строку") + "\n" + what + "\n" +
                   T("Она исчезнет из выпадающих списков навсегда."))) return;
      run(api("DELETE", "../api/dictionaries/refs/" + current.kind + "/" + id));
    },

    /* Разметку экран строит сам — прежний markup() оставлен пустым ради вызова из
       settings/index.html, где он подставлялся один раз при первом открытии. */
    markup: function () { return '<div class="refs-empty"></div>'; }
  };
})();
