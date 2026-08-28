/* ============================================================
   СПРАВОЧНИКИ ЗНАЧЕНИЙ — имена коммуникаций и точки касания.

   Это те самые списки, из которых выбирают в мастере коммуникаций. До сих пор их
   пополняли инсертом в psql на сервере: значение добавляют не для себя, а для всех,
   и такому место в панели, где видно, кто и что менял.

   Два решения, которые здесь важнее кода.

   Первое: удалять можно только неиспользуемое. Внешнего ключа между справочником и
   template.d_template нет — там обычная строка. Удаление значения из справочника не
   уберёт его из шаблонов, а только лишит объяснения: в шаблоне останется touch_point,
   которого «не существует». Поэтому занятое значение выключают, и кнопка удаления у
   него не показывается вовсе, а не отказывает по нажатию.

   Второе: выключенные значения видны. В выпадашках их нет, но здесь человек должен
   видеть, что значение существует, — иначе заведёт заново и упрётся в UNIQUE.
   ============================================================ */
window.Refs = (function () {
  "use strict";

  var KINDS = [
    { kind: "comm-names",   title: "Имена коммуникаций",
      hint: "communication_name — база имени коммуникации. Подставляется в мастере и входит в имя source." },
    { kind: "touch-points", title: "Точки касания",
      hint: "touch_point — в какой момент пути человека уходит коммуникация." }
  ];

  var rows = {}, busy = false;

  function T(s) { return (typeof window.t2 === "function") ? window.t2(s) : s; }
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

  function note(el, text, bad) {
    if (!el) return;
    el.textContent = text || "";
    el.style.color = bad ? "var(--coral)" : "var(--dim)";
  }

  function render(kind) {
    var box = document.getElementById("refs-" + kind);
    if (!box) return;
    var list = rows[kind] || [];
    if (!list.length) {
      box.innerHTML = '<div class="refs-empty">' + T("Справочник пуст") + "</div>";
      return;
    }
    box.innerHTML = list.map(function (r) {
      var used = Number(r.used || 0);
      return '<div class="refs-row' + (r.isActive ? "" : " off") + '">' +
        '<span class="refs-val">' + esc(r.value) + "</span>" +
        '<span class="refs-used" title="' + T("Столько шаблонов используют это значение") + '">' +
          (used ? used + " " + T("шабл.") : "—") + "</span>" +
        '<button type="button" class="refs-btn" onclick="Refs.toggle(\'' + kind + '\',' + r.id + ',' +
          (r.isActive ? "false" : "true") + ')">' +
          T(r.isActive ? "Выключить" : "Включить") + "</button>" +
        (used
          /* У занятого значения кнопки удаления нет: отказ по нажатию человек читает
             как поломку, а отсутствие кнопки — как правило. */
          ? '<span class="refs-lock" title="' + T("Пока значение стоит в шаблонах, удалить его нельзя") +
            '">' + T("занято") + "</span>"
          : '<button type="button" class="refs-btn del" onclick="Refs.remove(\'' + kind + '\',' + r.id +
            ",'" + esc(r.value).replace(/'/g, "&#39;") + "')\">" + T("Удалить") + "</button>") +
        "</div>";
    }).join("");
  }

  function load(kind) {
    var box = document.getElementById("refs-" + kind);
    if (box) box.innerHTML = '<div class="refs-empty">' + T("Загружаю…") + "</div>";
    return api("GET", "../api/dictionaries/refs/" + kind).then(function (data) {
      rows[kind] = data || [];
      render(kind);
      note(document.getElementById("refs-msg-" + kind),
           (rows[kind].length) + " " + T("значений, из них выключено") + " " +
           rows[kind].filter(function (r) { return !r.isActive; }).length);
    }).catch(function (e) {
      if (box) box.innerHTML = "";
      note(document.getElementById("refs-msg-" + kind), T("Не удалось прочитать: ") + e.message, true);
    });
  }

  return {
    open: function () {
      KINDS.forEach(function (k) { load(k.kind); });
    },

    add: function (kind) {
      if (busy) return;
      var inp = document.getElementById("refs-new-" + kind);
      var value = (inp.value || "").trim();
      if (!value) { note(document.getElementById("refs-msg-" + kind), T("Впишите значение"), true); return; }
      busy = true;
      api("POST", "../api/dictionaries/refs/" + kind, { value: value })
        .then(function () {
          inp.value = "";
          return load(kind);
        })
        .catch(function (e) { note(document.getElementById("refs-msg-" + kind), e.message, true); })
        .then(function () { busy = false; });
    },

    toggle: function (kind, id, active) {
      if (busy) return;
      busy = true;
      api("PATCH", "../api/dictionaries/refs/" + kind + "/" + id, { isActive: active })
        .then(function () { return load(kind); })
        .catch(function (e) { note(document.getElementById("refs-msg-" + kind), e.message, true); })
        .then(function () { busy = false; });
    },

    remove: function (kind, id, value) {
      if (busy) return;
      if (!confirm(T("Удалить значение") + " «" + value + "»?\n" +
                   T("Оно исчезнет из выпадающих списков навсегда."))) return;
      busy = true;
      api("DELETE", "../api/dictionaries/refs/" + kind + "/" + id)
        .then(function () { return load(kind); })
        .catch(function (e) { note(document.getElementById("refs-msg-" + kind), e.message, true); })
        .then(function () { busy = false; });
    },

    /** Разметка панели строится здесь же — двум справочникам нужен одинаковый блок. */
    markup: function () {
      return KINDS.map(function (k) {
        return '<div class="refs-card">' +
          "<h2>" + T(k.title) + "</h2>" +
          '<div class="refs-hint">' + T(k.hint) + "</div>" +
          '<div class="refs-add">' +
            '<input id="refs-new-' + k.kind + '" placeholder="' + T("новое значение") +
              '" onkeydown="if(event.key===\'Enter\')Refs.add(\'' + k.kind + '\')">' +
            '<button type="button" class="refs-btn primary" onclick="Refs.add(\'' + k.kind + '\')">' +
              T("Добавить") + "</button>" +
          "</div>" +
          '<div class="refs-msg" id="refs-msg-' + k.kind + '"></div>' +
          '<div class="refs-list" id="refs-' + k.kind + '"></div>' +
        "</div>";
      }).join("");
    }
  };
})();
