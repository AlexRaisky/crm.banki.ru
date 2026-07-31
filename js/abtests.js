/* ==========================================================================
   А/Б тесты — общая таблица команды (app.ab_test, /api/ab-tests).

   Устроено как «Планирование промо»: строки живут на сервере, правка идёт по
   одной ячейке (клик → поле → ✓ / клик мимо), конкурентные правки разруливает
   оптимистическая блокировка — вместе с полем уходит версия строки (ver), и если
   её успел изменить кто-то ещё, сервер возвращает 409 и мы перечитываем таблицу.

   Права — раздел abtests: read/add/edit/delete. Кнопки прячем по CRM.can, но
   истина на сервере (AccessGuard), фронт лишь не показывает бесполезное.
   ========================================================================== */

var AB_API = '/api/ab-tests';
var AB_REFRESH_MS = 30000;      /* подтягиваем чужие правки, пока раздел открыт */

var AB_ROWS = [];
var AB_EDIT = null;             /* { i, k, v } — v это черновик правки */
var AB_NEW = null;              /* форма новой записи над таблицей */
var AB_COLS = 8;                /* колонок до колонки с кнопкой удаления */
var _abTimer = null;
var _abLoading = false;

/* Статус теста — проставляется вручную, три ступени жизненного цикла.
   «идёт» по умолчанию у новой записи (её же подсвечивает зелёная полоса и
   считает счётчик «Идут сейчас»). */
var AB_PLANNED = 'запланировано';
var AB_RUNNING = 'идёт';
var AB_DONE = 'завершён';
var AB_STATUSES = [AB_PLANNED, AB_RUNNING, AB_DONE];
var AB_STATUS_DEFAULT = AB_RUNNING;
function abStatusOf(r){ return r.status || AB_STATUS_DEFAULT; }
function abRunning(r){ return abStatusOf(r) === AB_RUNNING; }
function abStatusCls(s){
  if (s === AB_RUNNING) return 'run';
  if (s === AB_DONE) return 'done';
  return 'plan';                                   /* запланировано и всё прочее */
}
function abStatusBadge(s){
  s = s || AB_STATUS_DEFAULT;
  return '<span class="st ' + abStatusCls(s) + '">' + abEsc(s) + '</span>';
}

function abT(s){ return (typeof t === 'function') ? t(s) : s; }
function abEsc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
  });
}
function abCan(cap){ return !!(window.CRM && CRM.can && CRM.can(cap, 'abtests')); }

/* Почта текущей учётки — ею заполняется «Кто тестировал» у новой записи.
   Поле остаётся обычным текстом: вписать другого человека можно руками. */
function abMe(){ return (window.CRM && CRM.me && CRM.me.email) || ''; }

function abToday(){
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function abFmtDate(iso){
  var p = String(iso || '').split('-');
  return p.length === 3 ? (p[2] + '.' + p[1] + '.' + p[0]) : '';
}

/* ---------- обмен с сервером ---------- */
function abReq(method, path, body){
  var opts = { method: method, credentials: 'same-origin', headers: { 'Accept': 'application/json' } };
  if (body !== undefined){
    opts.headers['Content-Type'] = 'application/json; charset=utf-8';
    opts.body = JSON.stringify(body);
  }
  return fetch(AB_API + (path || ''), opts).then(function(r){
    if (r.status === 401){ location.href = 'login.html'; throw { status: 401 }; }
    if (!r.ok){
      return r.text().then(function(txt){
        var msg = txt;
        try { msg = JSON.parse(txt).message || txt; } catch(e){}
        throw { status: r.status, message: msg };
      });
    }
    return r.status === 204 ? null : r.text().then(function(txt){ return txt ? JSON.parse(txt) : null; });
  });
}

/* 409 — чужая правка, перечитываем; остальное показываем. */
function abFail(e){
  AB_EDIT = null;
  if (e && e.status === 409){
    alert(abT('Строку изменил другой пользователь. Показываю актуальные данные.'));
  } else if (e && e.status === 404){
    alert(abT('Строку уже удалили. Показываю актуальные данные.'));
  } else if (e && e.status === 403){
    alert(abT('Нет прав на изменение таблицы А/Б тестов.'));
  } else if (e && e.status !== 401){
    alert(abT('Не удалось сохранить: ') + ((e && e.message) || e));
  }
  return abLoad();
}

function abApplyRow(row){
  if (!row) return;
  for (var i = 0; i < AB_ROWS.length; i++){
    if (AB_ROWS[i].id === row.id){ AB_ROWS[i] = row; return; }
  }
  AB_ROWS.push(row);
}

function abLoad(){
  if (_abLoading) return Promise.resolve();
  _abLoading = true;
  return abReq('GET', '').then(function(rows){
    AB_ROWS = rows || [];
    abRender();
  }).catch(function(e){
    if (e && e.status === 403){
      var body = document.getElementById('abBody');
      if (body) body.innerHTML = '<tr><td colspan="' + (AB_COLS + 1) + '" class="empty">' +
        abT('Нет доступа к разделу') + '</td></tr>';
    }
  }).then(function(){ _abLoading = false; });
}

/* Пока раздел открыт — подтягиваем чужие правки. Во время правки ячейки и
   заведения записи не трогаем, чтобы не выдёргивать поле из-под рук. */
function abAutoRefresh(){
  if (_abTimer) return;
  _abTimer = setInterval(function(){
    var sec = document.getElementById('sec-abtests');
    if (!sec || sec.offsetParent === null) return;
    if (AB_EDIT || AB_NEW) return;
    abLoad();
  }, AB_REFRESH_MS);
}

/* ---------- фильтры ---------- */
function abFillSelects(){
  var yearSel = document.getElementById('abYear');
  var testerSel = document.getElementById('abTester');
  if (!yearSel || !testerSel) return;
  var years = [], testers = [];
  AB_ROWS.forEach(function(r){
    var y = String(r.d1 || '').slice(0, 4);
    if (y && years.indexOf(y) === -1) years.push(y);
    if (r.tester && testers.indexOf(r.tester) === -1) testers.push(r.tester);
  });
  years.sort().reverse(); testers.sort();
  function fill(sel, items, allLabel){
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + abT(allLabel) + '</option>' +
      items.map(function(x){ return '<option value="' + abEsc(x) + '">' + abEsc(x) + '</option>'; }).join('');
    if (cur && items.indexOf(cur) !== -1) sel.value = cur;
  }
  fill(yearSel, years, 'Все годы');
  fill(testerSel, testers, 'Все тестировщики');
}

function abFiltered(){
  var y = (document.getElementById('abYear') || {}).value || '';
  var who = (document.getElementById('abTester') || {}).value || '';
  var st = (document.getElementById('abStatus') || {}).value || '';
  var q = ((document.getElementById('abSearch') || {}).value || '').trim().toLowerCase();
  return AB_ROWS.map(function(r, i){ return { r: r, i: i }; }).filter(function(x){
    var r = x.r;
    if (y && String(r.d1 || '').slice(0, 4) !== y) return false;
    if (who && r.tester !== who) return false;
    if (st && abStatusOf(r) !== st) return false;   /* значение фильтра — сам статус */
    if (q){
      var hay = [r.subject, r.templates, r.owner, r.tester, r.result, r.status].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function abRenderKpis(rows){
  var host = document.getElementById('abKpis');
  if (!host) return;
  var by = function(s){ return rows.filter(function(x){ return abStatusOf(x.r) === s; }).length; };
  host.innerHTML =
    '<div class="kpi"><div class="l">' + abT('Тестов') + '</div><div class="v">' + rows.length + '</div></div>' +
    '<div class="kpi"><div class="l">' + abT('Запланировано') + '</div><div class="v amber">' + by(AB_PLANNED) + '</div></div>' +
    '<div class="kpi"><div class="l">' + abT('Идут сейчас') + '</div><div class="v green">' + by(AB_RUNNING) + '</div></div>' +
    '<div class="kpi"><div class="l">' + abT('Завершено') + '</div><div class="v blue">' + by(AB_DONE) + '</div></div>';
}

/* ---------- ячейка ---------- */
function abIsEditing(i, k){ return !!(AB_EDIT && AB_EDIT.i === i && AB_EDIT.k === k); }
function abActs(){
  return '<div class="cell-act">' +
    '<button class="cell-ok" type="button" title="' + abT('Сохранить') + '" onclick="abCommit()">✓</button>' +
    '<button class="cell-no" type="button" title="' + abT('Отмена') + '" onclick="abCancel()">✕</button></div>';
}
function abCell(x, k, html, editor){
  if (abIsEditing(x.i, k))
    return '<td class="c-' + k + ' cell-edit"><div class="ed">' + editor + abActs() + '</div></td>';
  /* без права edit ячейка не кликабельна: класс editable и data-* не ставим,
     значение остаётся видимым — только чтение */
  if (!abCan('edit')) return '<td class="c-' + k + '">' + html + '</td>';
  return '<td class="c-' + k + ' editable" data-i="' + x.i + '" data-k="' + k + '">' + html + '</td>';
}

function abDraft(v){ if (AB_EDIT) AB_EDIT.v = v; }
function abKey(e, multiline){
  if (e.key === 'Escape'){ e.preventDefault(); abCancel(); return; }
  if (e.key === 'Enter' && !(multiline && !e.ctrlKey)){ e.preventDefault(); abCommit(); }
}

/* ---------- отрисовка ---------- */
function abRender(){
  var body = document.getElementById('abBody');
  if (!body) return;
  abFillSelects();
  var rows = abFiltered();
  abRenderKpis(rows);

  var html = AB_NEW ? abNewFormHtml() : '';
  if (!rows.length && !AB_NEW){
    html += '<tr><td colspan="' + (AB_COLS + 1) + '" class="empty">' +
      abT('Пока ни одного теста не заведено') + '</td></tr>';
  }
  rows.forEach(function(x){
    var r = x.r;
    var val = function(v, cls){
      var s = String(v == null ? '' : v).trim();
      return s ? '<span class="' + (cls || 'multi') + '">' + abEsc(s) + '</span>'
               : '<span class="need">' + abT('не заполнено') + '</span>';
    };
    html += '<tr' + (abRunning(r) ? ' class="running"' : '') + '>' +
      abCell(x, 'd1', '<span class="dv">' + abEsc(abFmtDate(r.d1)) + '</span>',
        '<input type="date" class="cell-in" value="' + abEsc(r.d1) + '"' +
        ' oninput="abDraft(this.value)" onkeydown="abKey(event)">') +
      abCell(x, 'd2', r.d2 ? '<span class="dv">' + abEsc(abFmtDate(r.d2)) + '</span>'
                           : '<span class="dv none">—</span>',
        '<input type="date" class="cell-in" value="' + abEsc(r.d2) + '"' +
        ' oninput="abDraft(this.value)" onkeydown="abKey(event)">') +
      abCell(x, 'status', abStatusBadge(r.status),
        '<select class="cell-in" onchange="abDraft(this.value)">' +
        AB_STATUSES.map(function(s){
          return '<option value="' + abEsc(s) + '"' + (abStatusOf(r) === s ? ' selected' : '') +
                 '>' + abEsc(s) + '</option>';
        }).join('') + '</select>') +
      abCell(x, 'subject', val(r.subject),
        '<textarea class="cell-in ta" rows="3" oninput="abDraft(this.value)"' +
        ' onkeydown="abKey(event, true)">' + abEsc(r.subject) + '</textarea>') +
      abCell(x, 'templates', val(r.templates, 'tpl'),
        '<textarea class="cell-in ta mono" rows="3" oninput="abDraft(this.value)"' +
        ' onkeydown="abKey(event, true)">' + abEsc(r.templates) + '</textarea>') +
      abCell(x, 'owner', val(r.owner, 'who'),
        '<input class="cell-in" value="' + abEsc(r.owner) + '"' +
        ' oninput="abDraft(this.value)" onkeydown="abKey(event)">') +
      abCell(x, 'tester', val(r.tester, 'who'),
        '<input class="cell-in" value="' + abEsc(r.tester) + '"' +
        ' oninput="abDraft(this.value)" onkeydown="abKey(event)">') +
      abCell(x, 'result', val(r.result),
        '<textarea class="cell-in ta" rows="3" oninput="abDraft(this.value)"' +
        ' onkeydown="abKey(event, true)">' + abEsc(r.result) + '</textarea>') +
      '<td>' + (abCan('delete')
        ? '<button class="row-del" type="button" title="' + abT('Удалить') + '"' +
          ' onclick="abDelRow(' + x.i + ')">✕</button>'
        : '') + '</td>' +
      '</tr>';
  });
  body.innerHTML = html;

  var addBtn = document.getElementById('abAddBtn');
  if (addBtn) addBtn.style.display = abCan('add') ? '' : 'none';
}

/* ---------- заведение записи ---------- */
function abNewFormHtml(){
  var n = AB_NEW;
  return '<tr class="new-row">' +
    '<td><input type="date" class="cell-in" value="' + abEsc(n.d1) + '"' +
      ' oninput="abNewSet(\'d1\',this.value)"></td>' +
    '<td><input type="date" class="cell-in" value="' + abEsc(n.d2) + '"' +
      ' oninput="abNewSet(\'d2\',this.value)"></td>' +
    '<td><select class="cell-in" onchange="abNewSet(\'status\',this.value)">' +
      AB_STATUSES.map(function(s){
        return '<option value="' + abEsc(s) + '"' + (n.status === s ? ' selected' : '') + '>' + abEsc(s) + '</option>';
      }).join('') + '</select></td>' +
    '<td><textarea class="cell-in ta" rows="3" placeholder="' + abT('Что тестировали') +
      '" oninput="abNewSet(\'subject\',this.value)">' + abEsc(n.subject) + '</textarea></td>' +
    '<td><textarea class="cell-in ta mono" rows="3" placeholder="' + abT('Шаблоны') +
      '" oninput="abNewSet(\'templates\',this.value)">' + abEsc(n.templates) + '</textarea></td>' +
    '<td><input class="cell-in" placeholder="' + abT('Кто инициировал') + '" value="' + abEsc(n.owner) +
      '" oninput="abNewSet(\'owner\',this.value)"></td>' +
    '<td><input class="cell-in" placeholder="' + abT('Кто тестировал') + '" value="' + abEsc(n.tester) +
      '" oninput="abNewSet(\'tester\',this.value)"></td>' +
    '<td><textarea class="cell-in ta" rows="3" placeholder="' + abT('Результаты') +
      '" oninput="abNewSet(\'result\',this.value)">' + abEsc(n.result) + '</textarea></td>' +
    '<td></td>' +
  '</tr>' +
  '<tr class="new-foot"><td colspan="' + (AB_COLS + 1) + '">' +
    '<div class="nf">' +
      '<div class="np">' + abT('Статус ставится вручную (по умолчанию «идёт»). Дата окончания необязательна.') +
        (n.err ? '<div class="np-err">' + abEsc(n.err) + '</div>' : '') + '</div>' +
      '<div class="nf-btns">' +
        '<button class="btn accent" type="button" onclick="abNewSave()">' + abT('Создать') + '</button>' +
        '<button class="btn" type="button" onclick="abNewClose()">' + abT('Отмена') + '</button>' +
      '</div>' +
    '</div>' +
  '</td></tr>';
}
function abNewOpen(){
  if (!abCan('add')){ alert(abT('Нет прав на заведение записей.')); return; }
  AB_EDIT = null;
  /* «Кто тестировал» подставляем из учётки — обычно тест ведёт тот, кто его и заводит */
  AB_NEW = { d1: abToday(), d2: '', status: AB_STATUS_DEFAULT, subject: '', templates: '', owner: '', tester: abMe(), result: '', err: '' };
  abRender();
}
function abNewClose(){ AB_NEW = null; abRender(); }
function abNewSet(k, v){ if (AB_NEW) AB_NEW[k] = v; }
function abNewSave(){
  if (!AB_NEW) return;
  var n = AB_NEW;
  if (!String(n.d1 || '').trim()){ n.err = abT('Укажите дату начала'); abRender(); return; }
  if (n.d2 && n.d2 < n.d1){ n.err = abT('Дата окончания раньше даты начала'); abRender(); return; }
  abReq('POST', '', { d1: n.d1, d2: n.d2, status: n.status, subject: n.subject, templates: n.templates,
                      owner: n.owner, tester: n.tester, result: n.result })
    .then(function(row){
      AB_NEW = null;
      abApplyRow(row);
      /* сортировка на сервере — по дате начала вниз; проще перечитать, чем угадывать место */
      return abLoad();
    })
    .catch(abFail);
}

/* ---------- правка ячеек ---------- */
function abEditCell(i, k){
  if (!abCan('edit')) return;
  var r = AB_ROWS[i];
  if (!r) return;
  AB_EDIT = { i: i, k: k, v: r[k] == null ? '' : r[k] };
  abRender();
}
function abCommit(){
  if (!AB_EDIT) return;
  var e = AB_EDIT, r = AB_ROWS[e.i];
  if (!r){ AB_EDIT = null; abRender(); return; }
  var v = e.v;
  /* дату начала не очищаем: она обязательна и по ней строится порядок */
  if (e.k === 'd1' && !String(v || '').trim()){ AB_EDIT = null; abRender(); return; }
  if (typeof v === 'string' && e.k !== 'subject' && e.k !== 'result' && e.k !== 'templates') v = v.trim();

  var was = r[e.k] == null ? '' : r[e.k];
  AB_EDIT = null;
  if (String(was) === String(v == null ? '' : v)){ abRender(); return; }   /* не менялось — на сервер не ходим */
  abPatch(r, e.k, v);
}
function abCancel(){ AB_EDIT = null; abRender(); }

/* Правка одного поля. ver — версия, которую видел этот браузер: разошлась —
   сервер вернёт 409, и мы перечитаем таблицу (см. abFail). */
function abPatch(row, field, value){
  if (!abCan('edit')){ alert(abT('Нет прав на изменение таблицы А/Б тестов.')); return abLoad(); }
  var prev = row[field];
  row[field] = value;          /* оптимистично показываем сразу */
  abRender();
  return abReq('PATCH', '/' + row.id, { field: field, value: value, ver: row.ver })
    .then(function(updated){ abApplyRow(updated); abRender(); })
    .catch(function(err){ row[field] = prev; return abFail(err); });
}

function abDelRow(i){
  var r = AB_ROWS[i];
  if (!r) return;
  if (!abCan('delete')){ alert(abT('Нет прав на удаление записей.')); return; }
  if (!confirm(abT('Удалить запись о тесте?'))) return;
  AB_EDIT = null;
  abReq('DELETE', '/' + r.id)
    .then(function(){
      var at = AB_ROWS.indexOf(r);
      if (at > -1) AB_ROWS.splice(at, 1);
      abRender();
    })
    .catch(abFail);
}

/* ---------- выгрузка ---------- */
function abExportCsv(){
  var rows = abFiltered();
  var head = ['Начало', 'Окончание', 'Статус', 'Что тестировали', 'Шаблоны', 'Кто инициировал', 'Кто тестировал', 'Результаты'];
  var esc = function(v){ return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
  var lines = [head.map(esc).join(';')];
  rows.forEach(function(x){
    var r = x.r;
    lines.push([abFmtDate(r.d1), abFmtDate(r.d2), abStatusOf(r), r.subject, r.templates, r.owner, r.tester, r.result]
      .map(esc).join(';'));
  });
  var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ab-tests.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- клики ---------- */
/* клик мимо ячейки = сохранить; клик по другой ячейке сразу открывает её */
document.addEventListener('mousedown', function(e){
  var t0 = e.target;
  if (AB_NEW && t0.closest){
    var inForm = t0.closest('.new-row') || t0.closest('.new-foot');
    var reopen = t0.closest('#abAddBtn');
    if (!inForm && !reopen && t0.closest('#sec-abtests')) abNewClose();
  }
  if (!AB_EDIT) return;
  if (t0.closest && (t0.closest('.cell-edit') || t0.closest('.new-row') || t0.closest('.new-foot'))) return;
  var next = t0.closest ? t0.closest('#abBody td.editable') : null;
  abCommit();
  if (next && !AB_EDIT){
    var i = parseInt(next.getAttribute('data-i'), 10);
    var k = next.getAttribute('data-k');
    if (!isNaN(i) && k){ e.preventDefault(); abEditCell(i, k); }
  }
}, true);

/* открытие ячейки по клику */
document.addEventListener('click', function(e){
  var td = e.target.closest ? e.target.closest('#abBody td.editable') : null;
  if (!td) return;
  var i = parseInt(td.getAttribute('data-i'), 10);
  var k = td.getAttribute('data-k');
  if (!isNaN(i) && k) abEditCell(i, k);
});

/* ---------- старт ----------
   Права приезжают из /api/me — до них не рисуем, иначе таблица нарисовалась бы
   как для читателя и кнопки правки не появились бы до перезагрузки. */
function abInit(){
  if (window.CRM && CRM.meReady) CRM.meReady.then(function(){ abLoad(); abAutoRefresh(); });
  else { abLoad(); abAutoRefresh(); }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', abInit);
else abInit();
