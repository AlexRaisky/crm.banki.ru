/* =========================================================
   ПЛАНИРОВАНИЕ ПРОМО — календарь промо-коммуникаций.
   Данные перенесены из рабочей таблицы (июль–август 2026).
   Формулы: день недели из даты, признак выходного, сводка
   по текущему фильтру. Правки хранятся в localStorage.
   ========================================================= */
var PROMO_SEED = [
  { d:'2026-07-07', product:'КК', base:'КК, ПК', chan:'push', total:false, name:'Альфа-Карта', owner:'Саша', status:'запланировано', note:'' },
  { d:'2026-07-08', product:'Ипотека', base:'Вся база Москва+МО', chan:'email, push', total:false, name:'Береговой 8% (премиум ипотека) (гео)', owner:'Саша', status:'запланировано', note:'' },
  { d:'2026-07-08', product:'РКО', base:'Бизнес', chan:'email', total:false, name:'ВТБ РКО', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-08', product:'КВ', base:'КВ, Инвестиции', chan:'email, push', total:false, name:'Альфа Банк', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-09', product:'general', base:'Диалог', chan:'push, email', total:false, name:'Диалог', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-09', product:'КК', base:'КК, ПК', chan:'email', total:false, name:'Т-Банк Карта', owner:'', status:'', note:'' },
  { d:'2026-07-09', product:'general', base:'клики и открытия из 1-го промо', chan:'email, push', total:false, name:'Розыгрыш Steam', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-10', product:'ДК', base:'ДК, ОСАГО, Вклады', chan:'push, email', total:false, name:'Плати по миру', owner:'Саша', status:'', note:'' },
  { d:'2026-07-10', product:'general', base:'КВ, Инвестиции', chan:'email, push', total:false, name:'Розыгрыш Ozon', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-10', product:'general', base:'КК, ПК, Ипотека, КПЗН', chan:'email, push', total:false, name:'Розыгрыш Ozon', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-11', product:'КК', base:'КК, ПК', chan:'push', total:false, name:'Т-Банк Карта', owner:'', status:'запланировано', note:'' },
  { d:'2026-07-11', product:'general', base:'Диалог', chan:'push, email', total:false, name:'Диалог', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-11', product:'ОСАГО', base:'ОСАГО', chan:'email', total:false, name:'ОСАГО от Ренессанс', owner:'Таня', status:'запланировано', note:'' },
  { d:'2026-07-13', product:'КПЗН', base:'КПЗН, Ипотека', chan:'email', total:false, name:'Кредит-Клаб', owner:'', status:'', note:'' },
  { d:'2026-07-13', product:'КК', base:'', chan:'email', total:false, name:'Уралсиб', owner:'', status:'', note:'' },
  { d:'2026-07-13', product:'general, ИС', base:'Диалог', chan:'push', total:false, name:'Диалог', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-13', product:'Вклады', base:'Вклады, НС, ДК, КВ, Инвестиции', chan:'email, push', total:false, name:'БЖФ', owner:'Таня', status:'запланировано', note:'' },
  { d:'2026-07-14', product:'general', base:'ИС, ОСАГО, Каско', chan:'email', total:false, name:'НР: Бонус за отзыв в НРСК (Альфа страхование)', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-14', product:'general', base:'Диалог', chan:'push', total:false, name:'Диалог', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-15', product:'ДК', base:'Тотал', chan:'push', total:true, name:'ВТБ', owner:'Саша', status:'запланировано', note:'' },
  { d:'2026-07-15', product:'РКО', base:'Бизнес', chan:'email', total:false, name:'Инго Банк РКО', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-15', product:'ОСАГО', base:'ОСАГО', chan:'email', total:false, name:'Новости: Выплаты по ОСАГО выросли на 10%: что изменилось и почему это важно', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-16', product:'КК', base:'КК, ПК', chan:'email', total:false, name:'Уралсиб', owner:'Саша', status:'запланировано', note:'https://jira.banki.ru/browse/CRM-8742' },
  { d:'2026-07-16', product:'КПЗН', base:'', chan:'', total:false, name:'Норвик', owner:'', status:'', note:'' },
  { d:'2026-07-16', product:'general', base:'Диалог', chan:'email, push', total:false, name:'Диалог', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-16', product:'general', base:'Инвестиции, КВ', chan:'email, push', total:false, name:'Розыгрыш Ozon (напоминание)', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-17', product:'КВ', base:'КВ', chan:'email', total:false, name:'Новости: Порвал/испортил доллар, что с ним делать', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-17', product:'ОСАГО', base:'ОСАГО', chan:'email', total:false, name:'Новости: Реальная история: ездил без полиса, попал в ДТП, заплатил 700 000 ₽ и не смог списать долг', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-17', product:'ДК', base:'ДК, МФО', chan:'push', total:false, name:'Плати по миру', owner:'', status:'запланировано', note:'https://jira.banki.ru/browse/CRM-8745' },
  { d:'2026-07-18', product:'ОСАГО', base:'ОСАГО', chan:'email, push', total:false, name:'ОСАГО Авто (3 письмо)', owner:'Таня', status:'', note:'' },
  { d:'2026-07-18', product:'ДК', base:'ДК, ОСАГО, ПК', chan:'push', total:false, name:'ПСБ 1000 Б', owner:'', status:'запланировано', note:'https://jira.banki.ru/browse/CRM-8759' },
  { d:'2026-07-20', product:'ОСАГО', base:'ОСАГО', chan:'email', total:false, name:'Новости: Где найти ОСАГО дешевле: сравнение цен от 23 страховых на Банки.ру', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-20', product:'general, ИС', base:'Диалог', chan:'email, push', total:false, name:'Диалог', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-20', product:'РКО', base:'Бизнес', chan:'email', total:false, name:'ПСБ РКО', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-20', product:'Вклады', base:'Вклады, НС, ДК, КВ, Инвестиции', chan:'email, push', total:false, name:'Банк Свой', owner:'Таня', status:'запланировано', note:'https://jira.banki.ru/browse/CRM-8650' },
  { d:'2026-07-21', product:'Вклады', base:'Тотал', chan:'email, push', total:true, name:'', owner:'Таня', status:'', note:'' },
  { d:'2026-07-22', product:'general', base:'Диалог', chan:'push', total:false, name:'Диалог', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-22', product:'ДК', base:'ДК, Инвестиции, Вклады', chan:'email, push', total:false, name:'Уралсиб', owner:'', status:'запланировано', note:'CRM-8748 и CRM-8749; меняем на КК уралсиб' },
  { d:'2026-07-22', product:'ОСАГО', base:'ОСАГО', chan:'email', total:false, name:'Новости: Где найти ОСАГО дешевле: сравнение цен от 23 страховых на Банки.ру', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-22', product:'ПК', base:'ПК', chan:'email, push', total:false, name:'Лояльность Экстра-бонус по кредиту за 1 Б', owner:'Таня', status:'', note:'кредитование' },
  { d:'2026-07-23', product:'ОСАГО', base:'', chan:'email, push', total:false, name:'ОСАГО Авто (4 письмо)', owner:'Таня', status:'', note:'' },
  { d:'2026-07-23', product:'КВ', base:'КВ', chan:'email', total:false, name:'Новости: Прогноз по юаню до конца лета', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-23', product:'ДК', base:'КК, ПК, МФО', chan:'push', total:false, name:'Займер', owner:'Саша', status:'запланировано', note:'https://jira.banki.ru/browse/CRM-8746' },
  { d:'2026-07-24', product:'Вклады', base:'Тотал', chan:'email', total:true, name:'ЦБ (решение)', owner:'Таня', status:'', note:'' },
  { d:'2026-07-25', product:'КВ', base:'КВ', chan:'email', total:false, name:'Новости: Заседание ЦБ — что будет с рублем', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-25', product:'ДК', base:'ПК, ДК', chan:'email', total:false, name:'ПСБ 1000 Б', owner:'', status:'запланировано', note:'https://jira.banki.ru/browse/CRM-8760' },
  { d:'2026-07-25', product:'general', base:'Диалог', chan:'email, push', total:false, name:'Диалог', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-26', product:'ОСАГО', base:'ОСАГО, ИС', chan:'email, push', total:false, name:'Промо для наших клиентов / Кэшбэк начисляем быстрее', owner:'Таня', status:'', note:'https://jira.banki.ru/browse/CRM-8774' },
  { d:'2026-07-27', product:'КВ', base:'КВ', chan:'email, push', total:false, name:'Камкомбанк', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-27', product:'РКО', base:'Бизнес', chan:'email', total:false, name:'РКО Ozon', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-07-27', product:'ОСАГО', base:'ОСАГО', chan:'email, push', total:false, name:'для ОСАГО мото', owner:'Таня', status:'', note:'' },
  { d:'2026-07-28', product:'КК', base:'Тотал', chan:'email', total:true, name:'Альфа', owner:'', status:'запланировано', note:'CRM-8734; если что, меняем на Т-Банк' },
  { d:'2026-07-29', product:'ПК', base:'ПК', chan:'email, push', total:false, name:'Лояльность Экстра-бонус по кредиту за 1 Б', owner:'Таня', status:'', note:'Среда, кредитование' },
  { d:'2026-07-29', product:'НС', base:'Вклады, НС, Инвестиции, ДК, КВ', chan:'', total:false, name:'НС Морской банк с повышенной ставкой', owner:'Таня', status:'', note:'https://jira.banki.ru/browse/CRM-8650' },
  { d:'2026-07-30', product:'КПЗН', base:'ИС, Ипотека, КПЗН', chan:'email', total:false, name:'Рефинансирование', owner:'', status:'запланировано', note:'https://jira.banki.ru/browse/CRM-8748' },
  { d:'2026-07-31', product:'КВ', base:'КВ', chan:'email', total:false, name:'Новости: Прогноз евро и доллара на август', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-08-01', product:'Кредит для бизнеса', base:'Бизнес', chan:'email', total:false, name:'Займы для бизнеса Доброзайм', owner:'Юля', status:'запланировано', note:'' },
  { d:'2026-08-01', product:'ПК', base:'ПК', chan:'push, email', total:false, name:'Лояльность Экстра-бонус по кредиту за 1 Б', owner:'Таня', status:'', note:'кредитование' },
];

var PROMO_DOW = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
var PROMO_MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
var PROMO_STATUSES = ['', 'запланировано', 'в работе', 'отправлено', 'отменено'];
var PROMO_ROWS = [];
var PROMO_EDIT = null;   /* { i, k } */

function pmT(s){ return (typeof t === 'function') ? t(s) : s; }
function pmEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

function promoLoad(){
  try {
    var raw = localStorage.getItem('crmpanel:promoPlan');
    PROMO_ROWS = raw ? JSON.parse(raw) : PROMO_SEED.map(function(r){ return Object.assign({}, r); });
  } catch(e){ PROMO_ROWS = PROMO_SEED.map(function(r){ return Object.assign({}, r); }); }
}
function promoSave(){
  try { localStorage.setItem('crmpanel:promoPlan', JSON.stringify(PROMO_ROWS)); } catch(e){}
}
function promoReset(){
  if (!confirm(pmT('Сбросить таблицу к исходным данным?'))) return;
  PROMO_ROWS = PROMO_SEED.map(function(r){ return Object.assign({}, r); });
  promoSave(); promoRender();
}

/* формулы: день недели и выходной из даты */
function promoDow(iso){
  var d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? '' : PROMO_DOW[d.getDay()];
}
function promoIsWeekend(iso){
  var d = new Date(iso + 'T00:00:00');
  return !isNaN(d) && (d.getDay() === 0 || d.getDay() === 6);
}
function promoFmtDate(iso){
  var p = (iso || '').split('-');
  return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : iso;
}
function promoMonthKey(iso){ return (iso || '').slice(0, 7); }

function promoFillSelects(){
  var monthSel = document.getElementById('promoMonth');
  var prodSel = document.getElementById('promoProduct');
  var chanSel = document.getElementById('promoChannel');
  var ownSel = document.getElementById('promoOwner');
  if (!monthSel) return;

  var months = [], prods = [], chans = [], owners = [];
  PROMO_ROWS.forEach(function(r){
    var mk = promoMonthKey(r.d);
    if (mk && months.indexOf(mk) === -1) months.push(mk);
    (r.product || '').split(',').map(function(x){ return x.trim(); }).filter(Boolean)
      .forEach(function(p){ if (prods.indexOf(p) === -1) prods.push(p); });
    (r.chan || '').split(',').map(function(x){ return x.trim(); }).filter(Boolean)
      .forEach(function(c){ if (chans.indexOf(c) === -1) chans.push(c); });
    if (r.owner && owners.indexOf(r.owner) === -1) owners.push(r.owner);
  });
  months.sort(); prods.sort(); chans.sort(); owners.sort();

  function fill(sel, items, allLabel, fmt){
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + pmT(allLabel) + '</option>' +
      items.map(function(x){ return '<option value="' + pmEsc(x) + '">' + pmEsc(fmt ? fmt(x) : x) + '</option>'; }).join('');
    if (cur && items.indexOf(cur) !== -1) sel.value = cur;
  }
  fill(monthSel, months, 'Все месяцы', function(mk){
    var p = mk.split('-');
    return pmT(PROMO_MONTHS[parseInt(p[1], 10) - 1]) + ' ' + p[0];
  });
  fill(prodSel, prods, 'Все продукты');
  fill(chanSel, chans, 'Все каналы');
  fill(ownSel, owners, 'Все ответственные');
}

function promoFiltered(){
  var mv = (document.getElementById('promoMonth') || {}).value || '';
  var pv = (document.getElementById('promoProduct') || {}).value || '';
  var cv = (document.getElementById('promoChannel') || {}).value || '';
  var ov = (document.getElementById('promoOwner') || {}).value || '';
  var q = ((document.getElementById('promoSearch') || {}).value || '').trim().toLowerCase();
  return PROMO_ROWS.map(function(r, i){ return { r: r, i: i }; }).filter(function(x){
    var r = x.r;
    if (mv && promoMonthKey(r.d) !== mv) return false;
    if (pv && (r.product || '').indexOf(pv) === -1) return false;
    if (cv && (r.chan || '').indexOf(cv) === -1) return false;
    if (ov && r.owner !== ov) return false;
    if (q && [r.name, r.base, r.product, r.note].join(' ').toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
}

/* сводка — считается по отфильтрованным строкам */
function promoRenderKpis(rows){
  var box = document.getElementById('promoKpis');
  if (!box) return;
  var totals = rows.filter(function(x){ return x.r.total; }).length;
  var planned = rows.filter(function(x){ return (x.r.status || '') === 'запланировано'; }).length;
  var chans = {};
  rows.forEach(function(x){
    (x.r.chan || '').split(',').map(function(c){ return c.trim(); }).filter(Boolean)
      .forEach(function(c){ chans[c] = (chans[c] || 0) + 1; });
  });
  var chanStr = Object.keys(chans).sort(function(a, b){ return chans[b] - chans[a]; })
    .map(function(c){ return c + ' · ' + chans[c]; }).join(', ') || '—';
  var pct = rows.length ? Math.round(planned / rows.length * 100) : 0;
  box.innerHTML =
    '<div class="kpi"><div class="l">' + pmT('Коммуникаций') + '</div><div class="v">' + rows.length + '</div>' +
      '<div class="s">' + pmT('по текущему фильтру') + '</div></div>' +
    '<div class="kpi"><div class="l">' + pmT('Тотал-рассылок') + '</div><div class="v amber">' + totals + '</div>' +
      '<div class="s">' + pmT('признак «Тотал»') + '</div></div>' +
    '<div class="kpi"><div class="l">' + pmT('Запланировано') + '</div><div class="v green">' + planned + '</div>' +
      '<div class="s">' + pct + '% ' + pmT('от строк') + '</div></div>' +
    '<div class="kpi"><div class="l">' + pmT('Каналы') + '</div><div class="v blue">' + Object.keys(chans).length + '</div>' +
      '<div class="s">' + pmEsc(chanStr) + '</div></div>';
}

function promoCell(x, k, html, editor){
  var editing = PROMO_EDIT && PROMO_EDIT.i === x.i && PROMO_EDIT.k === k;
  if (editing) return '<td class="c-' + k + '">' + editor + '</td>';
  return '<td class="c-' + k + ' editable" onclick="promoEdit(' + x.i + ',\'' + k + '\')">' + html + '</td>';
}

function promoRender(){
  var body = document.getElementById('promoBody');
  if (!body) return;
  promoFillSelects();
  var rows = promoFiltered();
  promoRenderKpis(rows);

  if (!rows.length){
    body.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:26px;color:var(--faint)">' +
      pmT('Нет строк по заданным фильтрам') + '</td></tr>';
    return;
  }

  body.innerHTML = rows.map(function(x){
    var r = x.r;
    var chanHtml = (r.chan || '').split(',').map(function(c){ return c.trim(); }).filter(Boolean)
      .map(function(c){ return '<span class="chan ' + (c === 'push' ? 'push' : '') + '">' + pmEsc(c) + '</span>'; }).join('') || '—';
    var noteHtml = /^https?:\/\//.test(r.note || '')
      ? '<a class="jira" href="' + pmEsc(r.note) + '" target="_blank" rel="noopener">' + pmEsc(r.note.replace(/^https?:\/\/[^/]+\//, '')) + '</a>'
      : pmEsc(r.note || '');
    return '<tr class="' + (r.total ? 'total-row ' : '') + (promoIsWeekend(r.d) ? 'weekend' : '') + '">' +
      promoCell(x, 'date', pmEsc(promoFmtDate(r.d)), '<input type="date" class="cell-in" value="' + pmEsc(r.d) + '" onchange="promoSet(' + x.i + ',\'d\',this.value)" onblur="promoCommit()">') +
      '<td class="c-dow">' + pmT(promoDow(r.d)) + '</td>' +
      promoCell(x, 'product', pmEsc(r.product) || '—', '<input class="cell-in" value="' + pmEsc(r.product) + '" onchange="promoSet(' + x.i + ',\'product\',this.value)" onblur="promoCommit()">') +
      promoCell(x, 'base', pmEsc(r.base) || '—', '<input class="cell-in" value="' + pmEsc(r.base) + '" onchange="promoSet(' + x.i + ',\'base\',this.value)" onblur="promoCommit()">') +
      promoCell(x, 'chan', chanHtml, '<input class="cell-in" value="' + pmEsc(r.chan) + '" placeholder="email, push" onchange="promoSet(' + x.i + ',\'chan\',this.value)" onblur="promoCommit()">') +
      '<td class="c-total"><input type="checkbox" ' + (r.total ? 'checked' : '') + ' onchange="promoSet(' + x.i + ',\'total\',this.checked);promoCommit()"></td>' +
      promoCell(x, 'name', pmEsc(r.name) || '—', '<input class="cell-in" value="' + pmEsc(r.name) + '" onchange="promoSet(' + x.i + ',\'name\',this.value)" onblur="promoCommit()">') +
      promoCell(x, 'owner', pmEsc(r.owner) || '—', '<input class="cell-in" value="' + pmEsc(r.owner) + '" onchange="promoSet(' + x.i + ',\'owner\',this.value)" onblur="promoCommit()">') +
      promoCell(x, 'status',
        '<span class="st ' + (r.status === 'запланировано' ? 'plan' : 'none') + '">' + (pmEsc(r.status) || '—') + '</span>',
        '<select class="cell-in" onchange="promoSet(' + x.i + ',\'status\',this.value);promoCommit()">' +
          PROMO_STATUSES.map(function(s){ return '<option value="' + s + '"' + (s === (r.status || '') ? ' selected' : '') + '>' + (s || '—') + '</option>'; }).join('') +
        '</select>') +
      promoCell(x, 'note', noteHtml || '—', '<input class="cell-in" value="' + pmEsc(r.note) + '" onchange="promoSet(' + x.i + ',\'note\',this.value)" onblur="promoCommit()">') +
      '<td><button class="row-del" title="' + pmT('Удалить строку') + '" onclick="promoDelRow(' + x.i + ')">×</button></td>' +
    '</tr>';
  }).join('');

  var inp = body.querySelector('.cell-in');
  if (inp && PROMO_EDIT) inp.focus();
}

function promoEdit(i, k){ PROMO_EDIT = { i: i, k: k }; promoRender(); }
function promoCommit(){ PROMO_EDIT = null; promoSave(); promoRender(); }
function promoSet(i, k, v){
  if (!PROMO_ROWS[i]) return;
  PROMO_ROWS[i][k] = v;
  promoSave();
}
function promoAddRow(){
  var today = new Date();
  var iso = today.toISOString().slice(0, 10);
  PROMO_ROWS.push({ d: iso, product:'', base:'', chan:'', total:false, name:'', owner:'', status:'', note:'' });
  promoSave(); promoRender();
}
function promoDelRow(i){
  if (!confirm(pmT('Удалить строку?'))) return;
  PROMO_ROWS.splice(i, 1);
  promoSave(); promoRender();
}
function promoExportCsv(){
  var head = ['Дата','День недели','Продукт','База','Канал','Тотал','Название коммуникации','Ответственный','Статус','Комментарий'];
  var rows = promoFiltered().map(function(x){
    var r = x.r;
    return [promoFmtDate(r.d), promoDow(r.d), r.product, r.base, r.chan, r.total ? 'TRUE' : 'FALSE', r.name, r.owner, r.status, r.note];
  });
  var csv = [head].concat(rows).map(function(line){
    return line.map(function(c){ return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');
  var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'promo-plan.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

promoLoad();
promoRender();
