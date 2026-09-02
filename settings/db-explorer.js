/* ============================================================
   СХЕМЫ И ТАБЛИЦЫ — обозреватель фактического состояния базы.

   Показывает НЕ модель, а то, что реально лежит в БД: схемы, внутри —
   таблицы. Модель это намерение, и расходиться с базой она будет всегда:
   часть схем заведена миграциями, часть Scheme Builder-ом, что-то могли
   создать руками. Обозреватель отвечает на вопрос «что есть на самом деле»
   и служит проверкой после применения DDL.

   Единственное, что раздел меняет, — удаление. Кнопка есть только у того,
   что билдер создал сам (флаг owned приходит с сервера из app.schema_owned):
   на чужую таблицу её не покажут, а если и подделать запрос — откажет сервер.
   Удаление таблицы уносит и её сущность из модели, иначе следующее
   «Применить» вернуло бы таблицу обратно.
   ============================================================ */
(function(){
"use strict";

function T(s){ return (typeof window.t2 === "function") ? window.t2(s) : s; }
const esc = s => String(s ?? "").replace(/[&<>"']/g, m =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));

let data = null;          /* последний ответ сервера */
let open = {};            /* какие схемы развёрнуты — состояние интерфейса */
let loading = false;
let busy = false;         /* идёт удаление: второй клик по той же кнопке не нужен */

function host(){ return document.getElementById("dbxHost"); }

/* Колонки «Строк» здесь нет намеренно. Точный count(*) по каждой таблице превратил бы
   открытие раздела в полное сканирование базы, а оценка планировщика (reltuples) врёт
   тем сильнее, чем дольше не было ANALYZE: на свежей таблице она попросту -1. Раздел
   про структуру, и приблизительное число строк в нём только сбивало с толку. Зато перед
   удалением конкретной таблицы точное число спрашивается отдельно — там оно и нужно. */

/* Право на удаление: delete в любом из разделов конструктора. Сервер проверяет то же
   самое; здесь — только чтобы не показывать кнопку, которая всё равно откажет. */
function mayDrop(){
  const me = window.SET_ME;
  if (!me) return false;                       // ответа ещё нет — кнопку не рисуем
  if (me.isAdmin) return true;
  const caps = me.caps || {};
  return ["set-dbtree", "set-scheme", "set-objects"]
    .some(s => caps[s] && caps[s]["delete"]);
}

function req(url, body){
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body || {})
  }).then(r => {
    if (r.ok) return r.status === 204 ? null : r.json();
    return r.text().then(t => {
      let msg = "";
      try { msg = JSON.parse(t).message || ""; } catch(e){ msg = ""; }
      throw new Error(msg || ("HTTP " + r.status));
    });
  });
}

function render(){
  const el = host();
  if (!el) return;
  if (loading){ el.innerHTML = `<div class="dbx-empty">${T("Читаем структуру базы…")}</div>`; return; }
  if (!data){ el.innerHTML = `<div class="dbx-empty">${T("Не удалось прочитать структуру базы")}</div>`; return; }
  if (!data.length){ el.innerHTML = `<div class="dbx-empty">${T("В базе нет ни одной схемы")}</div>`; return; }

  const canDrop = mayDrop();
  el.innerHTML = data.map(s => {
    const isOpen = !!open[s.name];
    const badges =
      (s.owned ? `<span class="dbx-badge own" title="${T("Создана конструктором схемы")}">${T("наша")}</span>` : "") +
      (s.reserved ? `<span class="dbx-badge res" title="${T("Служебная схема: конструктору недоступна")}">${T("защищена")}</span>` : "");
    /* Схему предлагаем удалить только пустую: непустую всё равно не отдаст сервер
       (DROP SCHEMA RESTRICT), а кнопка, которая всегда ругается, — плохая кнопка. */
    const schemaBtn = (canDrop && s.owned && !s.reserved && !s.tableCount)
      ? `<button type="button" class="dbx-del" data-drop-schema="${esc(s.name)}"
                 title="${T("Удалить пустую схему")}">${T("Удалить схему")}</button>`
      : "";
    const tables = s.tables.length
      ? `<table class="dbx-tbl"><thead><tr>
           <th>${T("Таблица")}</th><th>${T("Описание")}</th>
           <th class="num">${T("Колонок")}</th><th class="act"></th></tr></thead><tbody>` +
        s.tables.map(t => `<tr>
           <td class="mono">${esc(t.name)}</td>
           <td class="dbx-cmt">${esc(t.comment || "")}</td>
           <td class="num">${t.columns}</td>
           <td class="act">${
             canDrop && t.owned
               ? `<button type="button" class="dbx-del" data-drop-table="${esc(t.name)}"
                          data-schema="${esc(s.name)}">${T("Удалить")}</button>`
               : ""
           }</td></tr>`).join("") +
        `</tbody></table>`
      : `<div class="dbx-empty small">${T("В схеме нет таблиц")}</div>`;
    return `<div class="dbx-schema${isOpen ? " open" : ""}">
        <div class="dbx-head" data-s="${esc(s.name)}">
          <span class="dbx-caret">${isOpen ? "▾" : "▸"}</span>
          <span class="dbx-name mono">${esc(s.name)}</span>
          ${badges}
          <span class="dbx-cnt">${s.tableCount} ${T("табл.")}</span>
          <span class="dbx-cmt">${esc(s.comment || "")}</span>
          ${schemaBtn}
        </div>
        <div class="dbx-body">${isOpen ? tables : ""}</div>
      </div>`;
  }).join("");

  el.querySelectorAll(".dbx-head").forEach(h => {
    h.onclick = () => { const n = h.dataset.s; open[n] = !open[n]; render(); };
  });
  el.querySelectorAll("[data-drop-table]").forEach(b => {
    b.onclick = ev => {
      ev.stopPropagation();
      dropTable(b.dataset.schema, b.dataset.dropTable);
    };
  });
  el.querySelectorAll("[data-drop-schema]").forEach(b => {
    b.onclick = ev => {
      /* Кнопка живёт в заголовке схемы, а он сам по себе — переключатель. Без этого
         удаление заодно сворачивало бы карточку, и человек терял бы место. */
      ev.stopPropagation();
      dropSchema(b.dataset.dropSchema);
    };
  });
}

/**
 * Удаление таблицы в два шага: сначала спрашиваем сервер, что в ней и кто на неё
 * ссылается, и только потом показываем вопрос. Число строк из ответа уезжает обратно
 * в запросе — если за это время в таблицу писали, сервер откажет: значит удаляют уже
 * не то, про что спрашивали.
 */
function dropTable(schema, table){
  if (busy) return;
  busy = true;
  req("/api/schema/ddl/table-info", { schema, table }).then(info => {
    busy = false;
    if (!info || !info.droppable){
      alert((info && info.reason) || T("Эту таблицу удалять нельзя"));
      return;
    }
    const rows = Number(info.rows || 0);
    const refs = info.refs || [];
    let msg = T("Удалить таблицу") + " " + schema + "." + table + "?";
    msg += "\n\n" + (rows
      ? T("В ней строк") + ": " + rows + ". " + T("Они будут удалены безвозвратно.")
      : T("Таблица пустая."));
    if (refs.length){
      msg += "\n\n" + T("На неё ссылаются") + ": " +
        refs.map(r => r.schema + "." + r.table + " (" + r.columns + ")").join(", ") +
        ". " + T("Эти связи будут сняты.");
    }
    msg += "\n\n" + T("Сущность таблицы будет убрана и из модели конструктора.");
    if (!confirm(msg)) return;
    /* Непустая таблица — второе подтверждение именем. Один неверный клик не должен
       стоить данных, а набрать имя случайно нельзя. */
    if (rows){
      const typed = prompt(T("Введите имя таблицы, чтобы подтвердить удаление") +
        " (" + rows + " " + T("строк") + "):", "");
      if (typed !== table){
        if (typed !== null) alert(T("Имя не совпало — ничего не удалено"));
        return;
      }
    }
    busy = true;
    return req("/api/schema/ddl/drop-table", {
      schema, table, rows: rows || null, cascade: refs.length > 0
    }).then(res => {
      busy = false;
      alert(T("Удалено") + ": " + (res && res.dropped ? res.dropped : schema + "." + table) +
        (res && res.entities ? "\n" + T("Сущность убрана из модели.") : ""));
      load();
    });
  }).catch(e => {
    busy = false;
    alert(T("Не удалось удалить") + ": " + (e && e.message ? e.message : e));
  });
}

function dropSchema(schema){
  if (busy) return;
  if (!confirm(T("Удалить схему") + " " + schema + "?\n\n" +
      T("Схема пустая, но если в ней успели что-то создать, удаление не пройдёт."))) return;
  busy = true;
  req("/api/schema/ddl/drop-schema", { schema }).then(() => {
    busy = false;
    delete open[schema];
    load();
  }).catch(e => {
    busy = false;
    alert(T("Не удалось удалить схему") + ": " + (e && e.message ? e.message : e));
  });
}

function load(){
  loading = true; render();
  return fetch("/api/schema/db", { credentials:"same-origin" })
    .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(j => { data = j; loading = false; render(); })
    .catch(e => {
      loading = false; data = null; render();
      if (typeof console !== "undefined") console.warn("Схемы и таблицы: не удалось прочитать —", e);
    });
}

/* Раздел перечитывается при каждом открытии: структура базы меняется мимо панели
   (миграции при выкате, применение DDL), и показывать кеш прошлого раза было бы враньём. */
window.DbExplorer = { open: load, reload: load };
})();
