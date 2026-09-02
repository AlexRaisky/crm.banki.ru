/* ============================================================
   БЭКЛОГ — задачи на доработку панели.

   Раздел админский целиком: /api/admin/** закрыт ролью на сервере, а здесь пункт
   меню прячется от не-админов. Своей секции в матрице прав у него нет.

   Список — единственное представление: фильтр по статусу вкладками, правка строки
   на месте. Отдельной карточки задачи нет намеренно — запись живёт от «записали на
   ходу» до «сделано», и открывать ради двух полей вторую страницу незачем.
   ============================================================ */
window.Backlog = (function(){
  "use strict";

  var bound = false, items = [], filter = "", editing = null;
  /* Кому можно поручить — учётки с супер-ролью: доработки делают они. Список приходит
     с сервера, здесь только показываем. */
  var assignees = [];

  var STATUS = [
    { v:"new",         label:"Новые" },
    { v:"in_progress", label:"В работе" },
    { v:"done",        label:"Сделано" },
    { v:"rejected",    label:"Отклонено" }
  ];
  var PRIORITY = [
    { v:"high",   label:"Высокий" },
    { v:"normal", label:"Обычный" },
    { v:"low",    label:"Низкий" }
  ];

  function T(s){ return (typeof window.t2 === "function") ? window.t2(s) : s; }
  function esc(v){ return String(v == null ? "" : v)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function labelOf(list, v){
    for (var i = 0; i < list.length; i++) if (list[i].v === v) return T(list[i].label);
    return v || "";
  }
  /* Дату показываем без секунд и без часового пояса: в бэклоге важен день, а точное
     время только удлиняет строку. */
  function day(s){ return String(s || "").slice(0, 16).replace("T", " "); }

  function note(text, bad){
    var n = document.getElementById("bkMsg");
    if (!n) return;
    n.textContent = text || "";
    n.classList.toggle("show", !!text);
    n.style.color = bad ? "var(--coral)" : "";
  }

  function req(method, url, body){
    var opts = { method: method, credentials: "same-origin", headers: { Accept: "application/json" } };
    if (body !== undefined){
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function(r){
      if (r.ok) return r.status === 204 ? null : r.json();
      return r.text().then(function(t){
        var msg = "";
        try { msg = JSON.parse(t).message || ""; } catch(e){ msg = ""; }
        throw new Error(msg || (r.status + " " + r.statusText));
      });
    });
  }

  /* Варианты исполнителя. Уже сохранённое значение добавляем первым, даже если такой
     учётки в списке больше нет: иначе select молча подменил бы его соседним, и правка
     заголовка заодно переназначила бы задачу. */
  function assigneeOptions(cur){
    var v = String(cur || "");
    var html = '<option value=""' + (v ? "" : " selected") + ">" + T("не назначен") + "</option>";
    var known = false;
    assignees.forEach(function(a){
      if (a.email === v) known = true;
      html += '<option value="' + esc(a.email) + '"' + (a.email === v ? " selected" : "") + ">" +
        esc(a.name ? (a.name + " · " + a.email) : a.email) + "</option>";
    });
    if (v && !known){
      html += '<option value="' + esc(v) + '" selected>' + esc(v) + " · " + T("вне списка") + "</option>";
    }
    return html;
  }

  function loadAssignees(){
    return req("GET", "../api/admin/backlog/assignees").then(function(list){
      assignees = list || [];
      var sel = document.getElementById("bkAssignee");
      if (sel) sel.innerHTML = assigneeOptions(sel.value);
    }).catch(function(){ assignees = []; });
  }

  function load(){
    return req("GET", "../api/admin/backlog" + (filter ? "?status=" + encodeURIComponent(filter) : ""))
      .then(function(list){ items = list || []; render(); })
      .catch(function(e){
        items = [];
        var host = document.getElementById("bkList");
        if (host){
          host.className = "empty";
          host.textContent = T("Не удалось прочитать бэклог") + ": " + ((e && e.message) || "");
        }
      });
  }

  function renderTabs(counts){
    var host = document.getElementById("bkTabs");
    if (!host) return;
    var all = (counts && counts.total) || 0;
    var html = '<button type="button" class="bk-tab' + (filter ? "" : " on") + '" data-st="">' +
      T("Все") + ' <span class="n">' + all + '</span></button>';
    STATUS.forEach(function(s){
      html += '<button type="button" class="bk-tab' + (filter === s.v ? " on" : "") + '" data-st="' + s.v + '">' +
        T(s.label) + ' <span class="n">' + ((counts && counts[s.v]) || 0) + '</span></button>';
    });
    host.innerHTML = html;
    Array.prototype.forEach.call(host.querySelectorAll(".bk-tab"), function(b){
      b.onclick = function(){ filter = b.dataset.st; editing = null; load(); };
    });
  }

  function refreshCounts(){
    return req("GET", "../api/admin/backlog/counts")
      .then(renderTabs)
      .catch(function(){ renderTabs(null); });
  }

  function optionsHtml(list, cur){
    return list.map(function(o){
      return '<option value="' + o.v + '"' + (o.v === cur ? " selected" : "") + ">" + esc(T(o.label)) + "</option>";
    }).join("");
  }

  function render(){
    var host = document.getElementById("bkList");
    if (!host) return;
    if (!items.length){
      host.className = "empty";
      host.textContent = filter
        ? T("В этом статусе задач нет")
        : T("Бэклог пуст. Заведите первую задачу формой выше.");
      return;
    }
    host.className = "";
    host.innerHTML = items.map(function(it){
      var open = editing === it.id;
      return '<div class="bk-item' + (it.status === "done" || it.status === "rejected" ? " muted" : "") + '">' +
        '<div class="bk-row">' +
          '<span class="bk-pri ' + esc(it.priority) + '" title="' + esc(T("Приоритет")) + '">' +
            esc(labelOf(PRIORITY, it.priority)) + "</span>" +
          '<div class="bk-main">' +
            '<div class="bk-title">' + esc(it.title) + "</div>" +
            '<div class="bk-sub">' +
              (it.area ? "<b>" + esc(it.area) + "</b> · " : "") +
              esc(it.author || "—") + " · " + esc(day(it.createdAt)) +
              (it.assignee ? " · " + T("на") + " " + esc(it.assignee) : "") +
            "</div>" +
          "</div>" +
          '<select class="dbc-in bk-st" data-id="' + it.id + '">' + optionsHtml(STATUS, it.status) + "</select>" +
          '<button type="button" class="btn bk-edit" data-id="' + it.id + '">' +
            (open ? T("Свернуть") : T("Изменить")) + "</button>" +
        "</div>" +
        (it.description && !open ? '<div class="bk-desc">' + esc(it.description) + "</div>" : "") +
        (open ? editorHtml(it) : "") +
      "</div>";
    }).join("");

    Array.prototype.forEach.call(host.querySelectorAll(".bk-st"), function(sel){
      sel.onchange = function(){ save(Number(sel.dataset.id), { status: sel.value }); };
    });
    Array.prototype.forEach.call(host.querySelectorAll(".bk-edit"), function(b){
      b.onclick = function(){
        var id = Number(b.dataset.id);
        editing = (editing === id) ? null : id;
        render();
      };
    });
    var box = host.querySelector(".bk-editor");
    if (box){
      var id = Number(box.dataset.id);
      box.querySelector(".bk-save").onclick = function(){
        save(id, {
          title: box.querySelector(".bk-e-title").value,
          description: box.querySelector(".bk-e-desc").value,
          area: box.querySelector(".bk-e-area").value,
          assignee: box.querySelector(".bk-e-assignee").value,
          priority: box.querySelector(".bk-e-priority").value
        });
      };
      box.querySelector(".bk-del").onclick = function(){
        var it = items.filter(function(x){ return x.id === id; })[0];
        if (!confirm(T("Удалить задачу") + " «" + ((it && it.title) || id) + "»?")) return;
        req("DELETE", "../api/admin/backlog/" + id)
          .then(function(){ editing = null; note(T("Удалено")); return load().then(refreshCounts); })
          .catch(function(e){ note((e && e.message) || T("Не удалось удалить"), true); });
      };
    }
  }

  function editorHtml(it){
    return '<div class="bk-editor" data-id="' + it.id + '">' +
      '<div class="dbc-grid">' +
        '<div class="dbc-fld wide"><label>' + T("Задача") + "</label>" +
          '<input class="dbc-in bk-e-title" value="' + esc(it.title) + '"></div>' +
        '<div class="dbc-fld"><label>' + T("Раздел") + "</label>" +
          '<input class="dbc-in bk-e-area" value="' + esc(it.area) + '"></div>' +
        '<div class="dbc-fld"><label>' + T("Приоритет") + "</label>" +
          '<select class="dbc-in bk-e-priority">' + optionsHtml(PRIORITY, it.priority) + "</select></div>" +
        '<div class="dbc-fld"><label>' + T("Исполнитель") + "</label>" +
          '<select class="dbc-in bk-e-assignee">' + assigneeOptions(it.assignee) + "</select></div>" +
        '<div class="dbc-fld wide"><label>' + T("Описание") + "</label>" +
          '<textarea class="dbc-in bk-e-desc" rows="3">' + esc(it.description) + "</textarea></div>" +
      "</div>" +
      '<div class="row" style="gap:10px;margin-top:10px">' +
        '<button type="button" class="btn primary bk-save">' + T("Сохранить") + "</button>" +
        '<button type="button" class="btn ghost-danger bk-del">' + T("Удалить") + "</button>" +
        '<span class="bk-meta">' + T("правил") + ": " + esc(it.updatedBy || "—") + " · " + esc(day(it.updatedAt)) + "</span>" +
      "</div>" +
    "</div>";
  }

  function save(id, patch){
    note(T("Сохраняем…"));
    req("PUT", "../api/admin/backlog/" + id, patch)
      .then(function(){ note(T("Сохранено")); editing = null; return load().then(refreshCounts); })
      .catch(function(e){ note((e && e.message) || T("Не удалось сохранить"), true); load(); });
  }

  function add(){
    var title = document.getElementById("bkTitle").value.trim();
    if (!title){ note(T("Нужен заголовок задачи"), true); return; }
    note(T("Добавляем…"));
    req("POST", "../api/admin/backlog", {
      title: title,
      description: document.getElementById("bkDesc").value,
      area: document.getElementById("bkArea").value,
      priority: document.getElementById("bkPriority").value,
      assignee: document.getElementById("bkAssignee").value
    }).then(function(){
      document.getElementById("bkTitle").value = "";
      document.getElementById("bkDesc").value = "";
      document.getElementById("bkAssignee").value = "";   // «не назначен»
      note(T("Добавлено"));
      /* Фильтр сбрасываем на «Новые»: только что заведённая задача должна быть видна,
         а не спрятаться за вкладкой, на которой человек стоял. */
      if (filter && filter !== "new") filter = "new";
      return load().then(refreshCounts);
    }).catch(function(e){ note((e && e.message) || T("Не удалось добавить"), true); });
  }

  function bind(){
    if (bound) return;
    var b = document.getElementById("bkAdd");
    if (!b) return;
    bound = true;
    b.onclick = add;
    /* Enter в заголовке — тот же «Добавить»: строку бэклога заводят на бегу. */
    document.getElementById("bkTitle").onkeydown = function(ev){
      if (ev.key === "Enter"){ ev.preventDefault(); add(); }
    };
  }

  return {
    open: function(){
      bind();
      /* Сначала исполнители: список нужен уже первой отрисовке строк, иначе в редакторе
         сохранённый исполнитель показался бы «вне списка». */
      loadAssignees().then(load);
      refreshCounts();
    }
  };
})();
