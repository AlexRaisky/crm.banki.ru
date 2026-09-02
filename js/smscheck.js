/* =========================================================
   ЧЕК СМС траффик — выгрузка Excel.
   Панель заполняет сырые листы дней результатом SQL к DWH,
   а Excel досчитывает все листы-представления при открытии.
   Источник (внешнее подключение из «Диагностики») задаёт админ;
   остальные лишь выбирают месяц и канал и качают книгу.
   ========================================================= */
function scT(s){ return (typeof t === 'function') ? t(s) : s; }

var SC_CFG = null;   /* {connectionId, connectionName, canEdit, channels} */

/* Последний показанный отчёт держим в памяти вкладки: при возврате в раздел таблица
   появляется сразу, а свежие числа догружаются следом. Ждать запрос к DWH каждый раз,
   когда сюда заглянул, незачем — месяц закрыт, данные за него уже не меняются. */
var SC_LAST = null;   /* {key, data} — key это месяц+канал+продукт */
var SC_RETRY = false; /* повтор за списком продуктов уже назначен */

/* вызывается shell.js при открытии раздела */
function scInit(){
  /* месяц по умолчанию — текущий (если ещё не выбран) */
  var m = document.getElementById('scMonth');
  if (m && !m.value){
    var d = new Date();
    m.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  /* показываем, что было в прошлый раз, чтобы страница не встречала пустотой */
  if (SC_LAST) scRenderDaily(SC_LAST.data); else scPrompt();
  fetch('/api/reports/sms-check/config', { credentials:'same-origin' })
    .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(cfg){
      SC_CFG = cfg || {};
      scRenderSetup();
      /* Сам отчёт не считаем: запрос к DWH тяжёлый, и гонять его на каждое открытие
         раздела по всем продуктам незачем. Человек выбирает продукт и жмёт «Обновить». */
      if (SC_CFG.connectionId) scLoadProducts();
    })
    .catch(function(){ /* конфиг не критичен для показа формы — молча игнорируем */ });
}

/* Приглашение вместо таблицы: пока продукт не выбран, показывать нечего. */
function scPrompt(){
  scArea('<div class="rp-embed-stub"><b>' + scT('Отчёт не построен') + '</b>' +
    scT('Выберите продукт и нажмите «Обновить».') + '</div>');
}

/* Смена месяца или канала: список продуктов зависит от периода, поэтому обновляем его.
   Отчёт не пересчитываем — показанные числа относятся к прежнему периоду, поэтому
   убираем их: цифры за август под заголовком «сентябрь» хуже, чем их отсутствие. */
function scOnFilterChange(){
  SC_LAST = null;
  scPrompt();
  scLoadProducts();
}

function scLoadProducts(){
  var sel = document.getElementById('scProduct');
  var month = (document.getElementById('scMonth') || {}).value || '';
  var channel = (document.getElementById('scChannel') || {}).value || 'sms';
  if (!sel || !month) return Promise.resolve();
  var was = sel.value;
  return fetch('/api/reports/sms-check/products?month=' + encodeURIComponent(month) + '&channel=' + encodeURIComponent(channel),
               { credentials:'same-origin' })
    /* текст ошибки берём из тела: «HTTP 502» не говорит, что именно не понравилось источнику */
    .then(function(r){
      if (!r.ok) return r.text().then(function(txt){ throw new Error(scMsg(txt, r.status)); });
      return r.json();
    })
    .then(function(d){
      var list = (d && d.products) || [];
      var opts = '<option value="">' + scT('— выберите продукт —') + '</option>';
      list.forEach(function(p){
        opts += '<option value="' + scEsc(p) + '"' + (p === was ? ' selected' : '') + '>' + scEsc(p) + '</option>';
      });
      sel.innerHTML = opts;
      /* колонки продукта в витрине нет — фильтровать нечем, прячем список целиком:
         показывать выбор, который ни на что не влияет, хуже, чем не показывать */
      var wrap = sel.closest ? sel.closest('.f') : null;
      if (wrap) wrap.style.display = (d && d.column) ? '' : 'none';
      /* витрина не ответила — список показан по известным значениям, и об этом надо сказать */
      if (d && d.note) scStatus(d.note);
      /* pending: сервер отдал известные значения сразу, а витрину опрашивает в фоне.
         Перечитаем список через несколько секунд — к тому времени ответ уже в кэше.
         Один повтор, не цикл: если не успело, список всё равно рабочий. */
      if (d && d.pending && !SC_RETRY){
        SC_RETRY = true;
        setTimeout(function(){ SC_RETRY = false; scLoadProducts(); }, 6000);
      }
    })
    .catch(function(e){
      /* Молчать нельзя: пустой список ничем не отличается от сломанного запроса, и
         непонятно, то ли продуктов нет, то ли отчёт не смог их спросить. */
      scStatus(scT('Не удалось получить список продуктов') + ': ' + ((e && e.message) || ''), true);
    });
}

/* блок выбора источника — только админу */
function scRenderSetup(){
  var box = document.getElementById('scSetup');
  if (!box) return;
  if (!SC_CFG || !SC_CFG.canEdit){
    box.style.display = 'none';
    /* не-админу подсказываем, если источник ещё не настроен */
    if (SC_CFG && !SC_CFG.connectionId){
      scArea('<div class="rp-embed-stub"><b>' + scT('Источник данных ещё не настроен') + '</b>' +
        scT('Обратитесь к администратору панели — он выбирает подключение к DWH.') + '</div>');
    }
    return;
  }
  box.style.display = '';
  scLoadConns();
}

/* список подключений (админский эндпоинт) в селект */
function scLoadConns(){
  var sel = document.getElementById('scConn');
  if (!sel) return;
  fetch('/api/admin/db-connections', { credentials:'same-origin' })
    .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(list){
      var cur = SC_CFG && SC_CFG.connectionId != null ? String(SC_CFG.connectionId) : '';
      var opts = '<option value="">' + scT('— не выбрано —') + '</option>';
      (list || []).forEach(function(c){
        /* встроенные (our-db с строковым id) в источник отчёта не годятся — только реальные внешние */
        if (c.builtin) return;
        var id = String(c.id);
        opts += '<option value="' + id + '"' + (id === cur ? ' selected' : '') + '>' +
          scEsc(c.name) + (c.jdbcUrl ? ' — ' + scEsc(String(c.jdbcUrl).replace(/^jdbc:postgresql:\/\//, '')) : '') + '</option>';
      });
      sel.innerHTML = opts;
    })
    .catch(function(){
      sel.innerHTML = '<option value="">' + scT('не удалось загрузить список подключений') + '</option>';
    });
}

function scSaveConn(){
  var sel = document.getElementById('scConn');
  var st = document.getElementById('scConnStatus');
  var id = sel ? sel.value : '';
  if (st) st.textContent = scT('Сохраняем…');
  fetch('/api/reports/sms-check/config', {
    method:'PUT', credentials:'same-origin',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ connectionId: id === '' ? null : id })
  }).then(function(r){
    if (!r.ok) return r.text().then(function(txt){ throw new Error(scMsg(txt, r.status)); });
    return r.json();
  }).then(function(cfg){
    SC_CFG = cfg || SC_CFG;
    if (st) st.textContent = scT('Сохранено для всех пользователей.');
  }).catch(function(e){
    if (st) st.textContent = (e && e.message) || scT('Не удалось сохранить источник.');
  });
}

function scDownload(){
  var month = (document.getElementById('scMonth') || {}).value || '';
  var channel = (document.getElementById('scChannel') || {}).value || 'sms';
  var product = (document.getElementById('scProduct') || {}).value || '';
  if (!month){ scStatus(scT('Выберите месяц'), true); return; }
  var btn = document.getElementById('scDownload');
  if (btn) btn.disabled = true;
  /* Ход выгрузки — в строку состояния, а не в область отчёта: таблица на странице
     остаётся на месте, её ради этого и показывали. */
  scStatus(scT('Формируем книгу — запрос к DWH и заполнение листов, это может занять до минуты…'));
  var url = '/api/reports/sms-check/download?month=' + encodeURIComponent(month) +
            '&channel=' + encodeURIComponent(channel) +
            (product ? '&product=' + encodeURIComponent(product) : '');
  fetch(url, { credentials:'same-origin' })
    .then(function(r){
      if (!r.ok) return r.text().then(function(txt){ throw new Error(scMsg(txt, r.status)); });
      return r.blob();
    })
    .then(function(blob){
      var a = document.createElement('a');
      var href = URL.createObjectURL(blob);
      a.href = href;
      a.download = 'check-sms-' + channel + '-' + month + '.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(href); }, 4000);
      scStatus(scT('Файл скачан. Откройте его в Excel — листы-представления пересчитаются при открытии.'));
      /* сообщение об успехе само уходит: оно уже не нужно, а место занимает */
      setTimeout(function(){ scStatus(''); }, 8000);
    })
    .catch(function(e){
      scStatus(scT('Не удалось сформировать книгу') + ': ' + ((e && e.message) || ''), true);
    })
    .finally(function(){ if (btn) btn.disabled = false; });
}

/* ---------- лист «по дням» прямо на странице ----------
   Тот же лист, что в книге, но без скачивания. Считает его сервер по тем же данным,
   что уезжают в Excel (/daily), поэтому цифры сходятся. Строки приходят готовыми —
   здесь только вёрстка и форматирование чисел по признаку unit. */
function scShowDaily(){
  var month = (document.getElementById('scMonth') || {}).value || '';
  var channel = (document.getElementById('scChannel') || {}).value || 'sms';
  var product = (document.getElementById('scProduct') || {}).value || '';
  if (!month){ scArea('<div class="rp-embed-stub"><b>' + scT('Выберите месяц') + '</b></div>'); return Promise.resolve(); }
  /* Без продукта отчёт не строим: запрос по всем продуктам сразу — самый тяжёлый,
     а смотрят всегда конкретный. Кнопка при этом остаётся нажимаемой, чтобы было
     видно, чего не хватает. */
  if (!product){ scPrompt(); return Promise.resolve(); }
  var btn = document.getElementById('scShow');
  if (btn) btn.disabled = true;
  /* Пока считаем, старую таблицу не стираем — если она есть, показываем строку
     состояния над ней. Пустая область с надписью «считаем» вместо готовых чисел
     раздражает больше, чем ожидание. */
  if (SC_LAST) scStatus(scT('Обновляем…'));
  else scArea('<div class="rp-embed-stub">' + scT('Считаем — запрос к DWH…') + '</div>');
  var url = '/api/reports/sms-check/daily?month=' + encodeURIComponent(month) +
            '&channel=' + encodeURIComponent(channel) +
            (product ? '&product=' + encodeURIComponent(product) : '');
  return fetch(url, { credentials:'same-origin' })
    .then(function(r){
      if (!r.ok) return r.text().then(function(txt){ throw new Error(scMsg(txt, r.status)); });
      return r.json();
    })
    .then(function(d){
      SC_LAST = { key: month + '|' + channel + '|' + product, data: d };
      scRenderDaily(d);
      scStatus('');
    })
    .catch(function(e){
      scStatus('');
      scArea('<div class="rp-embed-stub bad"><b>' + scT('Не удалось посчитать отчёт') + '</b>' +
        scEsc((e && e.message) || '') + '</div>');
    })
    .finally(function(){ if (btn) btn.disabled = false; });
}

function scRenderDaily(d){
  if (!d || !d.rows || !d.rows.length){ scArea('<div class="rp-embed-stub"><b>' + scT('Данных за этот месяц нет') + '</b></div>'); return; }
  var days = d.days || 31;
  var head = '<tr><th class="sc-h">' + scEsc(d.month) + ' · ' + scEsc(d.channel) + '</th>';
  for (var i = 1; i <= days; i++) head += '<th>' + i + '</th>';
  head += '<th class="sc-total">' + scT('месяц') + '</th></tr>';

  var body = d.rows.map(function(r){
    var cells = (r.values || []).map(function(v){
      return '<td class="' + scNeg(v) + '">' + scNum(v, r.unit) + '</td>';
    }).join('');
    return '<tr><th class="sc-h">' + scEsc(r.label) + '</th>' + cells +
           '<td class="sc-total ' + scNeg(r.total) + '">' + scNum(r.total, r.unit) + '</td></tr>';
  }).join('');

  scArea('<div class="sc-daily"><table>' +
    '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
    '<div class="rp-embed-hint">' +
    scT('Лист «по дням» из книги, посчитанный на тех же данных. Пустая ячейка — делить не на что (нет отправок или выдач).') +
    '</div>');
}

/* отрицательные значения подсвечиваем — в GM и динамике это главное, что ищут глазами */
function scNeg(v){ return (typeof v === 'number' && v < 0) ? 'neg' : ''; }
function scNum(v, unit){
  if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return '<span class="sc-dash">—</span>';
  var n = Number(v);
  if (unit === 'percent') return (n * 100).toFixed(0) + '%';
  if (unit === 'ratio')   return n.toFixed(2);
  if (unit === 'money')   return Math.round(n).toLocaleString('ru-RU');
  if (unit === 'int')     return Math.round(n).toLocaleString('ru-RU');
  return String(n);
}

/* ---------- утилиты ---------- */
function scArea(html){ var a = document.getElementById('scArea'); if (a) a.innerHTML = html; }
/* строка состояния над таблицей: пустая строка её прячет */
function scStatus(text, bad){
  var el = document.getElementById('scStatus');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'rp-embed-wait' + (bad ? ' bad' : '');
  el.style.display = text ? '' : 'none';
}
function scEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
function scMsg(txt, status){
  var msg = '';
  try { msg = (JSON.parse(txt) || {}).message || ''; } catch(e){}
  return msg || ('HTTP ' + status);
}
