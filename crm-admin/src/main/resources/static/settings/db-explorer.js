/* ============================================================
   СХЕМЫ И ТАБЛИЦЫ — обозреватель фактического состояния базы.

   Показывает НЕ модель, а то, что реально лежит в БД: схемы, внутри —
   таблицы. Модель это намерение, и расходиться с базой она будет всегда:
   часть схем заведена миграциями, часть Scheme Builder-ом, что-то могли
   создать руками. Обозреватель отвечает на вопрос «что есть на самом деле»
   и служит проверкой после применения DDL.

   Только чтение: ничего не создаёт, не меняет и не удаляет.
   ============================================================ */
(function(){
"use strict";

function T(s){ return (typeof window.t2 === "function") ? window.t2(s) : s; }
const esc = s => String(s ?? "").replace(/[&<>"']/g, m =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));

let data = null;          /* последний ответ сервера */
let open = {};            /* какие схемы развёрнуты — состояние интерфейса */
let loading = false;

function host(){ return document.getElementById("dbxHost"); }

/* Оценка строк — из статистики планировщика, а не count(*): точный подсчёт по каждой
   таблице превратил бы открытие раздела в полное сканирование базы. Отсюда «≈». */
function rows(n){
  if (n == null) return "—";
  if (n === 0) return "0";
  if (n < 1000) return "≈ " + n;
  if (n < 1000000) return "≈ " + Math.round(n / 100) / 10 + " тыс.";
  return "≈ " + Math.round(n / 100000) / 10 + " млн";
}

function render(){
  const el = host();
  if (!el) return;
  if (loading){ el.innerHTML = `<div class="dbx-empty">${T("Читаем структуру базы…")}</div>`; return; }
  if (!data){ el.innerHTML = `<div class="dbx-empty">${T("Не удалось прочитать структуру базы")}</div>`; return; }
  if (!data.length){ el.innerHTML = `<div class="dbx-empty">${T("В базе нет ни одной схемы")}</div>`; return; }

  el.innerHTML = data.map(s => {
    const isOpen = !!open[s.name];
    const badges =
      (s.owned ? `<span class="dbx-badge own" title="${T("Создана конструктором схемы")}">${T("наша")}</span>` : "") +
      (s.reserved ? `<span class="dbx-badge res" title="${T("Служебная схема: конструктору недоступна")}">${T("защищена")}</span>` : "");
    const tables = s.tables.length
      ? `<table class="dbx-tbl"><thead><tr>
           <th>${T("Таблица")}</th><th>${T("Описание")}</th>
           <th class="num">${T("Колонок")}</th><th class="num">${T("Строк")}</th></tr></thead><tbody>` +
        s.tables.map(t => `<tr>
           <td class="mono">${esc(t.name)}</td>
           <td class="dbx-cmt">${esc(t.comment || "")}</td>
           <td class="num">${t.columns}</td>
           <td class="num">${esc(rows(t.rows))}</td></tr>`).join("") +
        `</tbody></table>`
      : `<div class="dbx-empty small">${T("В схеме нет таблиц")}</div>`;
    return `<div class="dbx-schema${isOpen ? " open" : ""}">
        <div class="dbx-head" data-s="${esc(s.name)}">
          <span class="dbx-caret">${isOpen ? "▾" : "▸"}</span>
          <span class="dbx-name mono">${esc(s.name)}</span>
          ${badges}
          <span class="dbx-cnt">${s.tableCount} ${T("табл.")}</span>
          <span class="dbx-cmt">${esc(s.comment || "")}</span>
        </div>
        <div class="dbx-body">${isOpen ? tables : ""}</div>
      </div>`;
  }).join("");

  el.querySelectorAll(".dbx-head").forEach(h => {
    h.onclick = () => { const n = h.dataset.s; open[n] = !open[n]; render(); };
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
