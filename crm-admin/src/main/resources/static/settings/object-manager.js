/* ============================================================
   «СУЩНОСТИ» (Object Manager) — список объектов CRM и настройка того,
   как они показываются в пользовательской панели.

   ЧТО ЗДЕСЬ НАСТРАИВАЕТСЯ, А ЧТО В SCHEME BUILDER. Здесь — отображение:
   блоки карточки, порядок полей, поля верхней строки, что скрыть, флаг
   «Техническая». Схема как таковая (типы в БД, связи, добавление и
   удаление полей) остаётся за Scheme Builder — эти разделы работают с
   одной моделью и одним хранилищем (SchemaStore из scheme-builder.js),
   поэтому правки одного видны другому.

   ГДЕ ЛЕЖИТ. Настройки пишутся внутрь самой сущности (entity.technical,
   entity.layout) и едут вместе со схемой: сейчас — черновиком в
   localStorage и файлом schema/crm-schema.json в Git, позже — в БД.
   Формат и расчёт раскладки описаны в ../js/entity-layout.js: тот же
   модуль читает панель, поэтому настройка и отображение совпадают.
   ============================================================ */
(function(){
"use strict";

function T(s){ return (typeof window.t2 === "function") ? window.t2(s) : s; }
var esc = function(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(m){
    return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[m];
  });
};
var $ = function(s, r){ return (r || document).querySelector(s); };
var $$ = function(s, r){ return [].slice.call((r || document).querySelectorAll(s)); };

var model = null;          /* вся схема; источник — SchemaStore из scheme-builder.js */
var view = { entity: null, q: "" };

function store(){ return window.SchemeBuilder && window.SchemeBuilder.store; }
function layout(){ return window.EntityLayout; }
function uiLabel(v){
  var list = (window.SchemeBuilder && window.SchemeBuilder.UI_TYPES) || [];
  for (var i = 0; i < list.length; i++) if (list[i].v === v) return T(list[i].label);
  return v || "—";
}
function toast(msg){ if (typeof window.sbToast === "function") window.sbToast(msg); else omToast(msg); }
function omToast(msg){
  var el = document.getElementById("sbToast");
  if (!el) return;
  el.textContent = msg; el.classList.add("show");
  clearTimeout(omToast._t); omToast._t = setTimeout(function(){ el.classList.remove("show"); }, 2000);
}
function entityById(id){
  for (var i = 0; i < model.entities.length; i++) if (model.entities[i].id === id) return model.entities[i];
  return null;
}

/* сохранение: одна модель на два раздела, поэтому после записи просим
   Scheme Builder перечитать её — иначе его следующий commit затрёт наши правки */
function save(what){
  var s = store();
  if (!s) return;
  if (typeof s.log === "function") s.log("update", "layout", what || "", null);
  s.save(model);
  if (window.SchemeBuilder && typeof window.SchemeBuilder.adopt === "function") window.SchemeBuilder.adopt(model);
}

/* ============================================================
   Список объектов
   ============================================================ */
function renderList(){
  var host = $("#omHost");
  var q = view.q.trim().toLowerCase();
  var list = model.entities.filter(function(e){
    if (!q) return true;
    return (e.label || "").toLowerCase().indexOf(q) >= 0 || e.id.indexOf(q) >= 0 ||
      (e.table || "").toLowerCase().indexOf(q) >= 0;
  });
  var rows = list.map(function(e){
    return '<tr class="clickable" data-open="' + esc(e.id) + '">' +
      "<td><b>" + esc(e.label || e.id) + "</b></td>" +
      "<td>" + esc(e.plural_label || "—") + "</td>" +
      '<td class="mono">' + esc(e.id) + "</td>" +
      '<td class="mono">' + esc(e.table || "—") + "</td>" +
      '<td class="num">' + e.fields.length + "</td>" +
      "<td>" + (e.technical
        ? '<span class="om-tag tech">' + T("Техническая") + "</span>"
        : '<span class="om-tag">' + T("В панели") + "</span>") + "</td>" +
      '<td><span class="om-go">' + T("Настроить →") + "</span></td></tr>";
  }).join("");

  host.innerHTML =
    '<div class="om-bar">' +
      '<input class="om-search" id="omSearch" placeholder="' + T("Поиск сущности…") + '" value="' + esc(view.q) + '">' +
      '<span class="spacer"></span>' +
      '<span class="om-count">' + list.length + " / " + model.entities.length + "</span>" +
    "</div>" +
    (list.length
      ? '<div class="om-tbl-wrap"><table class="om-tbl"><thead><tr>' +
          "<th>" + T("Название") + "</th><th>" + T("Множественное") + "</th>" +
          "<th>" + T("API-имя") + "</th><th>" + T("Таблица") + "</th>" +
          '<th class="num">' + T("Полей") + "</th><th>" + T("Показ") + "</th><th></th>" +
        "</tr></thead><tbody>" + rows + "</tbody></table></div>"
      : '<div class="om-tbl-wrap"><div class="om-empty">' + T("Ничего не найдено") + "</div></div>") +
    '<div class="om-note" style="margin-top:14px">' +
      T("Сущности, поля, типы и связи заводятся в разделе «Scheme Builder». Здесь настраивается то, как объект показывается в пользовательской панели: блоки карточки, порядок полей, поля верхней строки и что скрыть.") +
    "</div>";

  var s = $("#omSearch");
  s.oninput = function(){ view.q = s.value; var pos = s.selectionStart; renderList();
    var n = $("#omSearch"); n.focus(); try { n.setSelectionRange(pos, pos); } catch(e){} };
  $$("#omHost [data-open]").forEach(function(tr){
    tr.onclick = function(){ view.entity = tr.dataset.open; render(); };
  });
}

/* ============================================================
   Карточка объекта
   ============================================================ */
function renderEntity(){
  var host = $("#omHost"), e = entityById(view.entity);
  if (!e){ view.entity = null; return renderList(); }
  var L = layout().resolve(e);
  var choices = layout().blockChoices(e);
  var titles = L.blocks.map(function(b){ return b.title; });
  /* блоки, настроенные явно, но сейчас пустые, всё равно показываем в порядке */
  (L.titles || []).forEach(function(t){ if (titles.indexOf(t) < 0) titles.push(t); });

  var headerNames = L.header.map(function(f){ return f.name; });
  var counts = {};
  L.blocks.forEach(function(b){ counts[b.title] = b.fields.length; });

  host.innerHTML =
    '<button type="button" class="om-back" id="omBack">← ' + T("К списку сущностей") + "</button>" +
    '<div class="om-head"><h2>' + esc(e.label || e.id) + "</h2>" +
      '<span class="mono">' + esc(e.id) + " · " + esc(e.table || "—") + "</span>" +
      (e.technical ? '<span class="om-tag tech">' + T("Техническая") + "</span>" : "") +
    "</div>" +

    /* --- свойства объекта --- */
    '<div class="card"><h2>' + T("Свойства объекта") + "</h2>" +
      '<div class="om-grid2">' +
        '<div class="om-fg"><label>' + T("Название") + '</label><input id="omE_label" value="' + esc(e.label || "") + '"></div>' +
        '<div class="om-fg"><label>' + T("Название во множественном числе") + '</label><input id="omE_plural" value="' + esc(e.plural_label || "") + '"></div>' +
      "</div>" +
      '<div class="om-grid2">' +
        '<div class="om-fg"><label>' + T("Таблица") + '</label><input class="mono" id="omE_table" value="' + esc(e.table || "") + '"></div>' +
        '<div class="om-fg"><label>' + T("Поле заголовка записи") + '</label><select id="omE_title"><option value="">—</option>' +
          e.fields.map(function(f){
            return '<option value="' + esc(f.name) + '"' + (e.title_field === f.name ? " selected" : "") + ">" +
              esc(f.label || f.name) + "</option>"; }).join("") +
        "</select></div>" +
      "</div>" +
      '<div class="om-fg"><label>' + T("Описание") + '</label><textarea id="omE_desc">' + esc(e.description || "") + "</textarea></div>" +
      '<label class="om-check"><input type="checkbox" id="omE_tech"' + (e.technical ? " checked" : "") + ">" +
        "<span><b>" + T("Техническая") + "</b>" +
        '<span class="hint">' + T("Служебный справочник: раздел «Сущности» в пользовательской панели такую сущность не показывает — работать с ней нужно в схеме.") + "</span></span></label>" +
      '<div class="om-acts"><button class="btn accent" id="omE_save">' + T("Сохранить") + "</button></div>" +
    "</div>" +

    /* --- порядок блоков --- */
    '<div class="card"><h2>' + T("Блоки карточки") + "</h2>" +
      '<div class="om-note" style="margin-bottom:12px">' +
        T("Порядок блоков в карточке записи. Блок «Служебные» всегда показывается последним, пустые блоки не выводятся.") + "</div>" +
      '<div class="om-blocks" id="omBlocks">' + titles.map(function(t, i){
        return '<div class="om-block" data-b="' + esc(t) + '">' +
          '<span class="t">' + esc(T(t)) + '</span><span class="n">' + (counts[t] || 0) + "</span>" +
          '<button type="button" data-up="' + i + '" title="' + T("Выше") + '"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
          '<button type="button" data-down="' + i + '" title="' + T("Ниже") + '"' + (i === titles.length - 1 ? " disabled" : "") + ">↓</button>" +
          "</div>";
      }).join("") + "</div>" +
      '<div class="om-acts"><button class="btn" id="omAddBlock">+ ' + T("Блок") + "</button>" +
        '<button class="btn" id="omReset">' + T("Сбросить раскладку") + "</button></div>" +
    "</div>" +

    /* --- поля --- */
    '<div class="card"><h2>' + T("Поля и их отображение") + "</h2>" +
      '<div class="om-note" style="margin-bottom:12px">' +
        T("«В шапке» — поле выводится в верхней строке карточки рядом с названием записи. «Скрыть» — поле не показывается в карточке (в схеме и в БД оно остаётся). Стрелки меняют порядок полей внутри блока.") + "</div>" +
      '<div class="om-tbl-wrap"><table class="om-tbl om-fields"><thead><tr>' +
        "<th>" + T("Название") + '</th><th>' + T("API-имя") + "</th><th>" + T("Тип") + "</th>" +
        "<th>" + T("Блок") + '</th><th class="c">' + T("В шапке") + '</th><th class="c">' + T("Скрыть") + '</th><th class="c">' + T("Порядок") + "</th>" +
      "</tr></thead><tbody>" +
      e.fields.map(function(f, i){
        var hid = L.hidden.indexOf(f.name) >= 0;
        return '<tr' + (hid ? ' class="hidden-row"' : "") + ' data-f="' + esc(f.name) + '">' +
          '<td><input type="text" data-label="' + esc(f.name) + '" value="' + esc(f.label || "") + '"></td>' +
          '<td class="mono">' + esc(f.name) + "</td>" +
          "<td>" + esc(uiLabel(f.ui_type)) + "</td>" +
          '<td><select data-block="' + esc(f.name) + '">' + choices.map(function(c){
              return '<option value="' + esc(c) + '"' + ((L.block[f.name] || layout().autoBlock(f)) === c ? " selected" : "") +
                ">" + esc(T(c)) + "</option>"; }).join("") + "</select></td>" +
          '<td class="c"><input type="checkbox" data-header="' + esc(f.name) + '"' +
            (headerNames.indexOf(f.name) >= 0 ? " checked" : "") + "></td>" +
          '<td class="c"><input type="checkbox" data-hidden="' + esc(f.name) + '"' + (hid ? " checked" : "") + "></td>" +
          '<td class="c"><span class="ord">' +
            '<button type="button" data-mv="' + i + '" data-dir="-1"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
            '<button type="button" data-mv="' + i + '" data-dir="1"' + (i === e.fields.length - 1 ? " disabled" : "") + ">↓</button>" +
          "</span></td></tr>";
      }).join("") +
      "</tbody></table></div>" +
    "</div>";

  wireEntity(e);
}

function ensureLayout(e){
  if (!e.layout) e.layout = {};
  var d = layout().defaults(e), L = e.layout;
  if (!Array.isArray(L.blocks) || !L.blocks.length) L.blocks = layout().resolve(e).blocks.map(function(b){ return b.title; });
  if (!L.block) L.block = Object.assign({}, d.block);
  if (!Array.isArray(L.header)) L.header = d.header.slice();
  if (!Array.isArray(L.hidden)) L.hidden = [];
  return L;
}

function wireEntity(e){
  $("#omBack").onclick = function(){ view.entity = null; render(); };

  $("#omE_save").onclick = function(){
    e.label = $("#omE_label").value || e.id;
    e.plural_label = $("#omE_plural").value;
    e.table = $("#omE_table").value || e.id;
    e.title_field = $("#omE_title").value;
    e.description = $("#omE_desc").value;
    e.technical = $("#omE_tech").checked;
    save("entity:" + e.id); render();
    toast(T("Сохранено"));
  };

  /* порядок блоков */
  $$("#omBlocks [data-up], #omBlocks [data-down]").forEach(function(b){
    b.onclick = function(){
      var L = ensureLayout(e);
      var i = Number(b.dataset.up !== undefined ? b.dataset.up : b.dataset.down);
      var j = b.dataset.up !== undefined ? i - 1 : i + 1;
      var arr = $$("#omBlocks .om-block").map(function(x){ return x.dataset.b; });
      if (j < 0 || j >= arr.length) return;
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      L.blocks = arr;
      save("blocks:" + e.id); render();
    };
  });
  $("#omAddBlock").onclick = function(){
    var name = (prompt(T("Название блока")) || "").trim();
    if (!name) return;
    var L = ensureLayout(e);
    if (L.blocks.indexOf(name) < 0) L.blocks.push(name);
    save("blocks:" + e.id); render();
    toast(T("Блок добавлен"));
  };
  $("#omReset").onclick = function(){
    if (!confirm(T("Вернуть раскладку карточки к умолчанию?"))) return;
    delete e.layout;
    save("reset:" + e.id); render();
    toast(T("Раскладка сброшена"));
  };

  /* поля: название, блок, шапка, скрытие */
  $$("#omHost [data-label]").forEach(function(inp){
    inp.onchange = function(){
      var f = e.fields.filter(function(x){ return x.name === inp.dataset.label; })[0];
      if (!f) return;
      f.label = inp.value;
      save("field:" + e.id + "." + f.name);
      toast(T("Сохранено"));
    };
  });
  $$("#omHost [data-block]").forEach(function(sel){
    sel.onchange = function(){
      var L = ensureLayout(e);
      L.block[sel.dataset.block] = sel.value;
      if (L.blocks.indexOf(sel.value) < 0) L.blocks.push(sel.value);
      save("block:" + e.id + "." + sel.dataset.block); render();
    };
  });
  $$("#omHost [data-header]").forEach(function(cb){
    cb.onchange = function(){
      var L = ensureLayout(e), n = cb.dataset.header, i = L.header.indexOf(n);
      if (cb.checked && i < 0) L.header.push(n);
      if (!cb.checked && i >= 0) L.header.splice(i, 1);
      save("header:" + e.id); render();
    };
  });
  $$("#omHost [data-hidden]").forEach(function(cb){
    cb.onchange = function(){
      var L = ensureLayout(e), n = cb.dataset.hidden, i = L.hidden.indexOf(n);
      if (cb.checked && i < 0) L.hidden.push(n);
      if (!cb.checked && i >= 0) L.hidden.splice(i, 1);
      save("hidden:" + e.id); render();
    };
  });
  $$("#omHost [data-mv]").forEach(function(b){
    b.onclick = function(){
      var i = Number(b.dataset.mv), j = i + Number(b.dataset.dir);
      if (j < 0 || j >= e.fields.length) return;
      var tmp = e.fields[i]; e.fields[i] = e.fields[j]; e.fields[j] = tmp;
      save("order:" + e.id); render();
    };
  });
}

/* ============================================================
   Вход раздела
   ============================================================ */
function render(){
  var host = $("#omHost");
  if (!host) return;
  if (!model){ host.innerHTML = '<div class="om-err">' + T("Не удалось загрузить схему") + "</div>"; return; }
  if (view.entity) renderEntity(); else renderList();
}

/* Модель перечитываем при каждом открытии: её мог поменять Scheme Builder
   в этой же вкладке, и работать по устаревшей копии нельзя. */
function open(){
  var host = $("#omHost");
  if (!host) return;
  var s = store();
  if (!s){ host.innerHTML = '<div class="om-err">' + T("Scheme Builder не загружен") + "</div>"; return; }
  s.load().then(function(m){
    model = m;
    if (view.entity && !entityById(view.entity)) view.entity = null;
    render();
  }).catch(function(err){
    host.innerHTML = '<div class="om-err">' + T("Не удалось загрузить схему") + ": " + esc(err.message) + "</div>";
  });
}

window.ObjectManager = { open: open, render: render };
})();
