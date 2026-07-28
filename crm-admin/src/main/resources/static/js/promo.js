/* =========================================================
   ПЛАНИРОВАНИЕ ПРОМО — календарь промо-коммуникаций.

   Логика раздела:
   · даты — строки-разделители, «+» в конце добавляет запись на эту дату;
   · «Запланировать промо-рассылку» открывает форму новой записи прямо
     под шапкой таблицы (дата, каналы, статус «К планированию» и т.д.);
   · одна запись = один канал: при сохранении нескольких каналов
     создаётся столько записей, сколько выбрано каналов;
   · «Название коммуникации» собирается автоматически по правилам
     Конструктора source из канала, продукта, партнёра, уникального
     имени и даты;
   · вкладки «Актуальные» / «Архивные» (дата отправки уже прошла);
   · правила планирования (тоталы по неделям, лимиты промо на день
     и т.д.) подсвечивают проблемные строки.

   План общий для всей команды: строки лежат в app.promo_plan и правятся
   через /api/promo/plan. Правка идёт по одному полю вместе с версией строки —
   если её успел изменить кто-то ещё, сервер отвечает 409 и раздел перечитывает
   план, а не затирает чужое. Раз в 30 секунд подтягиваются чужие правки.
   ========================================================= */

/* ---------- справочники ---------- */

/* порядок фиксирован: в этом порядке каналы и отображаются */
var PROMO_CHANNELS = ['callcenter', 'sms', 'e-mail', 'vk', 'mobile-push', 'fin-assistent'];
var PROMO_CHAN_ALIAS = {
  'push':'mobile-push', 'mobile push':'mobile-push', 'mobile-push':'mobile-push',
  'email':'e-mail', 'e-mail':'e-mail', 'mail':'e-mail',
  'sms':'sms', 'vk':'vk',
  'callcenter':'callcenter', 'call-center':'callcenter', 'cc':'callcenter', 'кц':'callcenter',
  'fin-assistent':'fin-assistent', 'fin-assistant':'fin-assistent', 'финассистент':'fin-assistent'
};
/* канал коммуникации → часть source (см. Конструктор source).
   vk и fin-assistent в конструкторе не описаны — подставляем как есть. */
var PROMO_CHAN_SRC = { 'callcenter':'contact', 'sms':'sms', 'e-mail':'email', 'mobile-push':'mobile-push',
                       'vk':'vk', 'fin-assistent':'fin-assistent' };
/* каналы, по которым считаются лимиты промо на продукт */
var PROMO_MAIN_CHAN = ['e-mail', 'mobile-push', 'sms'];

/* продукты: crm_product_segment (код + описание) */
var PROMO_PRODUCTS = [
  { code:'cash_register',       name:'Онлайн-кассы' },
  { code:'kpk',                 name:'Кредитование потребительского кооператива (КПК)' },
  { code:'business_credits',    name:'Кредиты для бизнеса' },
  { code:'insurance_vzr',       name:'Выезд за рубеж (ВЗР)' },
  { code:'insurance_health',    name:'Ипотечное страхование жизни и здоровья' },
  { code:'insurance_combo',     name:'Ипотечное страхование комбо' },
  { code:'insurance_estate',    name:'Ипотечное страхование недвижимости' },
  { code:'insurance_mrtgg',     name:'Ипотечное страхование (объединённое)' },
  { code:'kasko',               name:'Каско' },
  { code:'general',             name:'Общие' },
  { code:'insurance_etc',       name:'Страхование другое' },
  { code:'acquiring',           name:'Эквайринг' },
  { code:'autocredits',         name:'Автокредиты' },
  { code:'bank_guarantees',     name:'Банковские гарантии' },
  { code:'business_microloans', name:'Займы для бизнеса' },
  { code:'creditcards',         name:'Кредитные карты' },
  { code:'credits',             name:'Потребительские кредиты' },
  { code:'cryptocurrency',      name:'Криптовалюта' },
  { code:'debitcards',          name:'Дебетовые карты' },
  { code:'deposits',            name:'Вклады' },
  { code:'estate',              name:'Недвижимость' },
  { code:'exchange_rate',       name:'Курсы валют (КВ)' },
  { code:'factoring',           name:'Факторинг' },
  { code:'investments',         name:'Инвестиции' },
  { code:'leasing',             name:'Лизинг' },
  { code:'lsre',                name:'Кредит под залог недвижимости (КПЗН)' },
  { code:'microloans',          name:'Микрозаймы' },
  { code:'mortgage_broker',     name:'Ипотечный брокер' },
  { code:'mortgages',           name:'Ипотека' },
  { code:'rvk',                 name:'РВК Страхование' },
  { code:'savings_account',     name:'Накопительные счета' },
  { code:'osago',               name:'ОСАГО' },
  { code:'rko',                 name:'Расчётно-кассовое обслуживание (РКО)' }
];
/* сокращения из прежней таблицы → продукт справочника */
var PROMO_PROD_ALIAS = {
  'КК':'Кредитные карты', 'ДК':'Дебетовые карты', 'ПК':'Потребительские кредиты',
  'КВ':'Курсы валют (КВ)', 'НС':'Накопительные счета', 'ИС':'Ипотечное страхование (объединённое)',
  'КПЗН':'Кредит под залог недвижимости (КПЗН)', 'МФО':'Микрозаймы',
  'Ипотека':'Ипотека', 'ОСАГО':'ОСАГО', 'Вклады':'Вклады',
  'РКО':'Расчётно-кассовое обслуживание (РКО)', 'general':'Общие',
  'Кредит для бизнеса':'Кредиты для бизнеса', 'Бизнес':'Кредиты для бизнеса',
  'Каско':'Каско', 'Инвестиции':'Инвестиции'
};

/* партнёры: partner_name, только латиница (регистровые дубли схлопнуты) */
var PROMO_PARTNERS = [
  'A7','A7-Veksel','Absolut','ADengi','Agroros','Ak-Bars','Alfa','AlphaStrahovanie','BankKazan',
  'Belkacredit','Beregovoy','Bistrodengi','BJF','BKS','Blanc','Caranga','CarMoney','Cash-to-you',
  'Cenniy','Credit7','CreditClub','CreditEuropeBank','Cuban','Dengi-Srazu','Dengi.ru','Dialog',
  'Digest','Dobrozaym','Dom','Domclick','DomRF','Dozarplaty','DRPhone','Ekapusta','Expobank',
  'Facebook','Finam','FinMedia','Finters','Fora-Bank','Gazprombank','General','GPB','Halva',
  'Home-Credit','Ingobank','Ingosstrakh','Insurance','JoyMoney','Kamkom','Kazanbank','Keb',
  'Kuban Credit','laymzaym','Levoberezhniy','Loko','Megafon','Metallinvestbank','Migcredit','MIR',
  'MKB','Moedelo','MoneyMan','Morskoy','MTS','MTSbank','multipartner','MyFinance','Nado-Deneg',
  'nbki','NDFLka','NewYear','none','Noosphera','Norbvik','Norvik','NSJ','NSPK','OcenkaRF','OKB',
  'OneClick','onefactor','Otkrytie','OTP','OZON','PapaFinance','PayPS','PIK','Plants','Plati-po-miru',
  'Platiza','Pochta-Bank','Povoljsky','Premier','PrivetSosed','ProfiCredit','PSB','PSKB','RealistBank',
  'Renessans','RESO','Rosbank','Rosgosstrakh','Rosneft','RSHB','RSHB-Insurance','Rusbank',
  'Russian-Standart','Sber','ScoringBureau','SDM','SellPlus','Sinara','SKB','Sogaz','Sovkom',
  'SovkomBank','Svoy','SvoyBank','T-Bank','TKB','Tochka-Bank','Turbozaym','UBRiR','Ukki','UKOne',
  'Uralsib','vk','VTB','Wanttopay','Webbankir','WebZaym','Wildberries','Yandex','Yandex-Bank',
  'YKKY','YKPervaya','Zaymer','Zaymigo'
];

var PROMO_JIRA_BASE = 'https://jira.banki.ru/browse/';

/* Демо-данных больше нет: план общий и живёт в app.promo_plan.
   Пустая таблица — нормальное стартовое состояние. */

var PROMO_DOW = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
var PROMO_MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
var PROMO_STATUS_NEW = 'К планированию';
var PROMO_STATUS_ASK = 'Нужен статус по рассылке';
var PROMO_STATUSES = ['', PROMO_STATUS_NEW, 'запланировано', 'в работе', 'отправлено', 'отменено'];
var PROMO_COLS = 12;          /* колонок до кнопки «+» в строке-дате */
/* иконка календаря в колонке «Дата»: по клику дату можно переназначить */
var PROMO_CAL_ICO = '<svg class="cal-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>';
var PROMO_ROWS = [];
var PROMO_EDIT = null;        /* { i, k, v } — v это черновик правки */
var PROMO_NEW = null;         /* форма новой записи над таблицей */
var PROMO_TAB = 'active';     /* active | archive */
var PROMO_FLAGS = {};         /* индекс строки → { bad:[…], warn:[…] } */

function pmT(s){ return (typeof t === 'function') ? t(s) : s; }
function pmEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
function pmAttr(s){ return pmEsc(s); }

/* ---------- даты ---------- */
function promoToday(){
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
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
/* начало недели (понедельник) — ключ для правила по тоталам */
function promoWeekKey(iso){
  var d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return '';
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function promoIsPast(iso){ return !!iso && iso < promoToday(); }

/* ---------- нормализация и миграция ---------- */
function promoNormChan(v){
  var list = Array.isArray(v) ? v.slice() : String(v || '').split(/[,;/]/);
  var out = [];
  list.map(function(c){ return String(c).trim().toLowerCase(); }).filter(Boolean).forEach(function(c){
    var mapped = PROMO_CHAN_ALIAS[c] || (PROMO_CHANNELS.indexOf(c) > -1 ? c : '');
    if (mapped && out.indexOf(mapped) === -1) out.push(mapped);
  });
  return PROMO_CHANNELS.filter(function(c){ return out.indexOf(c) > -1; });
}
function promoNormProduct(v){
  var parts = String(v || '').split(',').map(function(p){ return p.trim(); }).filter(Boolean);
  var out = [];
  parts.forEach(function(p){
    var name = PROMO_PROD_ALIAS[p] || p;
    var byCode = PROMO_PRODUCTS.filter(function(x){ return x.code === p; })[0];
    if (byCode) name = byCode.name;
    if (out.indexOf(name) === -1) out.push(name);
  });
  return out.join(', ');
}
function promoTaskKey(v){
  var m = String(v || '').match(/([A-Za-z][A-Za-z0-9]*-\d+)/);
  return m ? m[1].toUpperCase() : '';
}
/* уникальное имя: латиница, цифры, разделитель — только дефис */
function promoUniqOk(v){ return /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(String(v || '').trim()); }
function promoUniqSlug(v){
  return String(v || '').trim().toLowerCase()
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function promoStatusShown(r){
  if (!promoIsPast(r.d)) return r.status || '';
  if (r.status === 'отправлено' || r.status === 'отменено') return r.status;
  return PROMO_STATUS_ASK;
}

/* ============================================================
   ОБМЕН С СЕРВЕРОМ

   План общий для команды и лежит в app.promo_plan. У строки есть id и ver
   (timestamp_upd, каким его видел этот браузер). Правку шлём по одному полю
   вместе с ver: если в базе версия уже другая — сервер отвечает 409, значит
   строку успел поменять кто-то ещё, и мы перечитываем план вместо того,
   чтобы затереть чужую правку.

   Перевод прошедших «запланировано» → «отправлено» теперь делает сервер при
   чтении списка: раньше это делал каждый клиент у себя и тут же сохранял,
   то есть на общей таблице запись шла бы с каждого открытия страницы.
   ============================================================ */
var PROMO_API = '/api/promo/plan';
var PROMO_REFRESH_MS = 30000;   /* подтягиваем чужие правки */
var _promoTimer = null;
var _promoLoading = false;

/* Права промо по глаголам — зеркало серверной матрицы (CRM.can, раздел promo).
   Кнопки по ним прячем; истина на сервере (AccessGuard.requireCapability). */
function promoCan(cap){ return !!(window.CRM && CRM.can && CRM.can(cap, 'promo')); }

/* fetch с разбором ошибки: нужен код статуса (409 обрабатываем отдельно). */
function promoReq(method, path, body){
  var opts = { method: method, credentials: 'same-origin', headers: { 'Accept': 'application/json' } };
  if (body !== undefined){
    opts.headers['Content-Type'] = 'application/json; charset=utf-8';
    opts.body = JSON.stringify(body);
  }
  return fetch(PROMO_API + (path || ''), opts).then(function(r){
    if (r.status === 401){ location.href = 'login.html'; throw { status: 401 }; }
    if (!r.ok){
      return r.text().then(function(t){
        var msg = t;
        try { msg = JSON.parse(t).message || t; } catch(e){}
        throw { status: r.status, message: msg };
      });
    }
    return r.status === 204 ? null : r.text().then(function(t){ return t ? JSON.parse(t) : null; });
  });
}

/* Ошибка операции: 409 — чужая правка, перечитываем; остальное показываем. */
function promoFail(e){
  PROMO_EDIT = null;
  if (e && e.status === 409){
    alert(pmT('Строку изменил другой пользователь. Показываю актуальные данные.'));
  } else if (e && e.status === 404){
    alert(pmT('Строку уже удалили. Показываю актуальные данные.'));
  } else if (e && e.status === 403){
    alert(pmT('Нет прав на изменение плана.'));
  } else if (e && e.status !== 401){
    alert(pmT('Не удалось сохранить: ') + ((e && e.message) || e));
  }
  return promoLoad();
}

/* Заменить строку в наборе на пришедшую с сервера (по id). */
function promoApplyRow(row){
  if (!row) return;
  for (var i = 0; i < PROMO_ROWS.length; i++){
    if (PROMO_ROWS[i].id === row.id){ PROMO_ROWS[i] = row; return; }
  }
  PROMO_ROWS.push(row);
}

function promoLoad(){
  if (_promoLoading) return Promise.resolve();
  _promoLoading = true;
  return promoReq('GET', '').then(function(rows){
    PROMO_ROWS = (rows || []).map(function(r){ r.chan = promoNormChan(r.chan); return r; });
    promoRender();
  }).catch(function(e){
    if (e && e.status === 403){
      var body = document.getElementById('promoBody');
      if (body) body.innerHTML = '<tr><td colspan="13" class="empty">' + pmT('Нет доступа к разделу') + '</td></tr>';
    }
  }).then(function(){ _promoLoading = false; });
}

/* Пока раздел открыт — подтягиваем чужие правки. Во время правки ячейки
   и заведения записи не трогаем, чтобы не выдёргивать поле из-под рук. */
function promoAutoRefresh(){
  if (_promoTimer) return;
  _promoTimer = setInterval(function(){
    var sec = document.getElementById('sec-promo');
    if (!sec || sec.offsetParent === null) return;   /* раздел не открыт */
    if (PROMO_EDIT || PROMO_NEW) return;
    promoLoad();
  }, PROMO_REFRESH_MS);
}

/* ---------- название коммуникации (формат Конструктора source) ---------- */
function promoProdCode(product){
  var first = String(product || '').split(',')[0].trim();
  var p = PROMO_PRODUCTS.filter(function(x){ return x.name === first; })[0];
  return p ? p.code : '';
}
function promoDatePart(iso, chan){
  var p = (iso || '').split('-');
  if (p.length !== 3) return '';
  var v = p[2] + p[1] + p[0].slice(2);
  return (chan === 'callcenter') ? v + 'day' : v;
}
/* собирает source-имя; при нехватке частей возвращает список недостающих */
function promoBuildName(r, chan){
  var c = chan || (r.chan || [])[0] || '';
  var miss = [];
  if (!c) miss.push(pmT('канал'));
  if (!promoProdCode(r.product)) miss.push(pmT('продукт'));
  if (!String(r.partner || '').trim()) miss.push(pmT('партнёр'));
  if (!promoUniqOk(r.uniq)) miss.push(pmT('уникальное имя'));
  if (!r.d) miss.push(pmT('дата'));
  if (miss.length) return { ok:false, miss: miss, value:'' };
  return { ok:true, miss: [], value: [
    PROMO_CHAN_SRC[c] || c, 'promo', promoProdCode(r.product),
    String(r.partner).trim().replace(/\s+/g, '-'), String(r.uniq).trim(), promoDatePart(r.d, c)
  ].join('_') };
}

/* ---------- правила планирования ---------- */
/* ключ «одного промо»: одна акция может идти в нескольких каналах */
function promoGroupKey(r){ return [r.d, r.product, r.partner, r.uniq || r.base].join('|'); }

function promoAnalyze(){
  var flags = {};
  function add(i, kind, msg){
    if (!flags[i]) flags[i] = { bad: [], warn: [] };
    if (flags[i][kind].indexOf(msg) === -1) flags[i][kind].push(msg);
  }

  /* — тоталы: 1 в неделю, 2 если в уникальном имени есть -cb (ставка ЦБ) — */
  var weeks = {};
  PROMO_ROWS.forEach(function(r, i){
    if (!r.total) return;
    var wk = promoWeekKey(r.d);
    (weeks[wk] = weeks[wk] || []).push(i);
  });
  Object.keys(weeks).forEach(function(wk){
    var idx = weeks[wk].slice().sort(function(a, b){
      return PROMO_ROWS[a].d === PROMO_ROWS[b].d ? a - b : (PROMO_ROWS[a].d < PROMO_ROWS[b].d ? -1 : 1);
    });
    var groups = [], seen = {};
    idx.forEach(function(i){
      var k = promoGroupKey(PROMO_ROWS[i]);
      if (!(k in seen)){ seen[k] = groups.length; groups.push([]); }
      groups[seen[k]].push(i);
    });
    var hasCb = groups.some(function(g){ return /-cb/i.test(PROMO_ROWS[g[0]].uniq || ''); });
    var limit = hasCb ? 2 : 1;
    groups.slice(limit).forEach(function(g){
      g.forEach(function(i){
        add(i, 'warn', pmT('Лимит тоталов на неделю') + ': ' + limit +
          (hasCb ? ' (' + pmT('есть рассылка по ставке ЦБ') + ')' : '') + ' — ' + pmT('эта рассылка сверх лимита'));
      });
    });
  });

  /* — по одному продукту не больше 3 промо в день (в разных каналах) — */
  var byDayProd = {};
  PROMO_ROWS.forEach(function(r, i){
    if (!r.product) return;
    var k = r.d + '|' + r.product;
    (byDayProd[k] = byDayProd[k] || []).push(i);
  });
  Object.keys(byDayProd).forEach(function(k){
    var groups = [], seen = {};
    byDayProd[k].forEach(function(i){
      var gk = promoGroupKey(PROMO_ROWS[i]);
      if (!(gk in seen)){ seen[gk] = groups.length; groups.push([]); }
      groups[seen[gk]].push(i);
    });
    groups.slice(3).forEach(function(g){
      g.forEach(function(i){ add(i, 'bad', pmT('По одному продукту допускается не больше 3 промо в день')); });
    });
    /* один и тот же канал у нескольких промо одного продукта */
    var chanUse = {};
    groups.forEach(function(g){
      g.forEach(function(i){
        (PROMO_ROWS[i].chan || []).forEach(function(c){
          if (PROMO_MAIN_CHAN.indexOf(c) === -1) return;
          (chanUse[c] = chanUse[c] || []).push(i);
        });
      });
    });
    Object.keys(chanUse).forEach(function(c){
      var uniqGroups = {};
      chanUse[c].forEach(function(i){ uniqGroups[promoGroupKey(PROMO_ROWS[i])] = 1; });
      if (Object.keys(uniqGroups).length > 1)
        chanUse[c].forEach(function(i){ add(i, 'bad', pmT('Промо одного продукта должны идти в разных каналах') + ' (' + c + ')'); });
    });
  });

  /* — не больше 4 промо в день (разные каналы одной акции = одно промо) — */
  var byDay = {};
  PROMO_ROWS.forEach(function(r, i){ (byDay[r.d] = byDay[r.d] || []).push(i); });
  Object.keys(byDay).forEach(function(d){
    var groups = [], seen = {};
    byDay[d].forEach(function(i){
      var gk = promoGroupKey(PROMO_ROWS[i]);
      if (!(gk in seen)){ seen[gk] = groups.length; groups.push([]); }
      groups[seen[gk]].push(i);
    });
    groups.slice(4).forEach(function(g){
      g.forEach(function(i){ add(i, 'bad', pmT('В день допускается не больше 4 промо') + ' (' + groups.length + ')'); });
    });
    /* — в день с тоталом остальные промо в том же канале подсвечиваются — */
    var totalChans = {};
    byDay[d].forEach(function(i){ if (PROMO_ROWS[i].total) (PROMO_ROWS[i].chan || []).forEach(function(c){ totalChans[c] = 1; }); });
    if (Object.keys(totalChans).length){
      byDay[d].forEach(function(i){
        var r = PROMO_ROWS[i];
        if (r.total) return;
        (r.chan || []).forEach(function(c){
          if (totalChans[c]) add(i, 'bad', pmT('В этот день в этом канале уже запланирован тотал') + ' (' + c + ')');
        });
      });
    }
  });

  PROMO_FLAGS = flags;
  return flags;
}

/* ---------- фильтры и вкладки ---------- */
function promoSetTab(tab){
  PROMO_TAB = tab === 'archive' ? 'archive' : 'active';
  PROMO_EDIT = null;
  promoRender();
}
function promoTabRows(){
  return PROMO_ROWS.map(function(r, i){ return { r: r, i: i }; })
    .filter(function(x){ return PROMO_TAB === 'archive' ? promoIsPast(x.r.d) : !promoIsPast(x.r.d); });
}

function promoFillSelects(){
  var monthSel = document.getElementById('promoMonth');
  if (!monthSel) return;
  var prodSel = document.getElementById('promoProduct');
  var partSel = document.getElementById('promoPartner');
  var chanSel = document.getElementById('promoChannel');
  var ownSel = document.getElementById('promoOwner');

  var months = [], prods = [], partners = [], owners = [];
  promoTabRows().forEach(function(x){
    var r = x.r;
    var mk = promoMonthKey(r.d);
    if (mk && months.indexOf(mk) === -1) months.push(mk);
    (r.product || '').split(',').map(function(p){ return p.trim(); }).filter(Boolean)
      .forEach(function(p){ if (prods.indexOf(p) === -1) prods.push(p); });
    if (r.partner && partners.indexOf(r.partner) === -1) partners.push(r.partner);
    if (r.owner && owners.indexOf(r.owner) === -1) owners.push(r.owner);
  });
  months.sort(); prods.sort(); partners.sort(); owners.sort();

  function fill(sel, items, allLabel, fmt){
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + pmT(allLabel) + '</option>' +
      items.map(function(x){ return '<option value="' + pmAttr(x) + '">' + pmEsc(fmt ? fmt(x) : x) + '</option>'; }).join('');
    if (cur && items.indexOf(cur) !== -1) sel.value = cur;
  }
  fill(monthSel, months, 'Все месяцы', function(mk){
    var p = mk.split('-');
    return pmT(PROMO_MONTHS[parseInt(p[1], 10) - 1]) + ' ' + p[0];
  });
  fill(prodSel, prods, 'Все продукты');
  fill(partSel, partners, 'Все партнёры');
  fill(chanSel, PROMO_CHANNELS, 'Все каналы');
  fill(ownSel, owners, 'Все ответственные');
}

function promoFiltered(){
  var mv = (document.getElementById('promoMonth') || {}).value || '';
  var pv = (document.getElementById('promoProduct') || {}).value || '';
  var rv = (document.getElementById('promoPartner') || {}).value || '';
  var cv = (document.getElementById('promoChannel') || {}).value || '';
  var ov = (document.getElementById('promoOwner') || {}).value || '';
  var tv = (document.getElementById('promoTotal') || {}).value || '';
  var q = ((document.getElementById('promoSearch') || {}).value || '').trim().toLowerCase();
  return promoTabRows().filter(function(x){
    var r = x.r;
    if (mv && promoMonthKey(r.d) !== mv) return false;
    if (pv && (r.product || '').indexOf(pv) === -1) return false;
    if (rv && r.partner !== rv) return false;
    if (cv && (r.chan || []).indexOf(cv) === -1) return false;
    if (ov && r.owner !== ov) return false;
    if (tv === 'yes' && !r.total) return false;
    if (tv === 'no' && r.total) return false;
    if (q){
      var nm = promoBuildName(r);
      var hay = [nm.value, r.base, r.product, r.partner, r.uniq, r.task, r.note].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }).sort(function(a, b){
    if (a.r.d === b.r.d) return a.i - b.i;
    return a.r.d < b.r.d ? -1 : 1;
  });
}

/* ---------- сводка ---------- */
function promoRenderKpis(rows){
  var box = document.getElementById('promoKpis');
  if (!box) return;
  var groups = {};
  rows.forEach(function(x){ if (x.r.total) groups[promoGroupKey(x.r)] = 1; });
  var totals = Object.keys(groups).length;
  var planned = rows.filter(function(x){ return (x.r.status || '') === 'запланировано'; }).length;
  var issues = rows.filter(function(x){ return PROMO_FLAGS[x.i] && (PROMO_FLAGS[x.i].bad.length || PROMO_FLAGS[x.i].warn.length); }).length;
  var chans = {};
  rows.forEach(function(x){ (x.r.chan || []).forEach(function(c){ chans[c] = (chans[c] || 0) + 1; }); });
  var chanStr = PROMO_CHANNELS.filter(function(c){ return chans[c]; })
    .map(function(c){ return c + ' · ' + chans[c]; }).join(', ') || '—';
  box.innerHTML =
    '<div class="kpi"><div class="l">' + pmT('Коммуникаций') + '</div><div class="v">' + rows.length + '</div>' +
      '<div class="s">' + pmT('по текущему фильтру') + '</div></div>' +
    '<div class="kpi"><div class="l">' + pmT('Тотал-рассылок') + '</div><div class="v amber">' + totals + '</div>' +
      '<div class="s">' + pmT('акций с признаком «Тотал»') + '</div></div>' +
    '<div class="kpi"><div class="l">' + pmT('Запланировано') + '</div><div class="v green">' + planned + '</div>' +
      '<div class="s">' + (rows.length ? Math.round(planned / rows.length * 100) : 0) + '% ' + pmT('от строк') + '</div></div>' +
    '<div class="kpi"><div class="l">' + pmT('Требуют внимания') + '</div><div class="v' + (issues ? ' coral' : '') + '">' + issues + '</div>' +
      '<div class="s">' + pmT('нарушают правила планирования') + '</div></div>' +
    '<div class="kpi"><div class="l">' + pmT('Каналы') + '</div><div class="v blue">' + Object.keys(chans).length + '</div>' +
      '<div class="s">' + pmEsc(chanStr) + '</div></div>';
}

/* ---------- ячейки ---------- */
function promoIsEditing(i, k){ return !!(PROMO_EDIT && PROMO_EDIT.i === i && PROMO_EDIT.k === k); }
function promoActs(disabled){
  return '<div class="cell-act">' +
    '<button class="cell-ok" type="button" title="' + pmT('Сохранить') + '"' + (disabled ? ' disabled' : '') +
      ' onclick="promoCommit()">✓</button>' +
    '<button class="cell-no" type="button" title="' + pmT('Отмена') + '" onclick="promoCancel()">✕</button></div>';
}
function promoCell(x, k, html, editor){
  if (promoIsEditing(x.i, k))
    return '<td class="c-' + k + ' cell-edit"><div class="ed">' + editor + promoActs(false) + '</div></td>';
  /* без права edit ячейка не кликабельна: убираем класс editable (курсор/ховер) и data-*,
     на которые вешается открытие редактора. Значение остаётся видимым — только чтение. */
  if (!promoCan('edit')) return '<td class="c-' + k + '">' + html + '</td>';
  return '<td class="c-' + k + ' editable" data-i="' + x.i + '" data-k="' + k + '">' + html + '</td>';
}
function promoChanCls(c){
  if (c === 'mobile-push') return 'push';
  if (c === 'callcenter') return 'cc';
  if (c === 'vk') return 'vk';
  if (c === 'fin-assistent') return 'fa';
  return '';
}
function promoChanBadges(list){
  return (list || []).map(function(c){
    return '<span class="chan ' + promoChanCls(c) + '">' + pmEsc(c) + '</span>';
  }).join('') || '—';
}

/* ---------- отрисовка ---------- */
function promoRender(){
  var body = document.getElementById('promoBody');
  if (!body) return;
  promoAnalyze();
  promoFillSelects();
  var rows = promoFiltered();
  promoRenderKpis(rows);
  promoRenderTabs();

  var html = PROMO_NEW ? promoNewRowHtml() : '';

  if (!rows.length){
    html += '<tr><td colspan="' + (PROMO_COLS + 1) + '" style="text-align:center;padding:26px;color:var(--faint)">' +
      pmT('Нет строк по заданным фильтрам') + '</td></tr>';
  } else {
    var curDate = null;
    rows.forEach(function(x){
      var r = x.r;
      if (r.d !== curDate){
        curDate = r.d;
        html += '<tr class="date-row' + (promoIsWeekend(r.d) ? ' weekend' : '') + '">' +
          '<td class="date-cell" colspan="' + PROMO_COLS + '">' +
            '<span class="d-num">' + pmEsc(promoFmtDate(r.d)) + '</span>' +
            '<span class="d-dow">' + pmT(promoDow(r.d)) + '</span>' +
          '</td>' +
          '<td class="date-add">' + (promoCan('add')
            ? '<button class="row-add" type="button" title="' + pmT('Добавить запись на эту дату') +
              '" onclick="promoNewOpen(\'' + r.d + '\')">+</button>'
            : '') + '</td></tr>';
      }
      html += promoRowHtml(x);
    });
  }
  body.innerHTML = html;

  var focusEl = body.querySelector('.cell-edit .cell-in');
  if (focusEl && PROMO_EDIT){
    focusEl.focus();
    if (focusEl.setSelectionRange && focusEl.type !== 'date'){
      try { focusEl.setSelectionRange(focusEl.value.length, focusEl.value.length); } catch(e){}
    }
  }
  promoNewPreview();
}

function promoRenderTabs(){
  var box = document.getElementById('promoTabs');
  if (!box) return;
  var act = PROMO_ROWS.filter(function(r){ return !promoIsPast(r.d); }).length;
  var arc = PROMO_ROWS.length - act;
  box.innerHTML =
    '<button type="button" class="tab' + (PROMO_TAB === 'active' ? ' on' : '') + '" onclick="promoSetTab(\'active\')">' +
      pmT('Актуальные') + '<span class="n">' + act + '</span></button>' +
    '<button type="button" class="tab' + (PROMO_TAB === 'archive' ? ' on' : '') + '" onclick="promoSetTab(\'archive\')">' +
      pmT('Архивные') + '<span class="n">' + arc + '</span></button>';
}

function promoRowHtml(x){
  var r = x.r, i = x.i;
  var draft = PROMO_EDIT && PROMO_EDIT.i === i ? PROMO_EDIT.v : null;
  var f = PROMO_FLAGS[i] || { bad: [], warn: [] };

  var prodOpts = PROMO_PRODUCTS.map(function(p){ return p.name; });
  if (r.product && prodOpts.indexOf(r.product) === -1) prodOpts = [r.product].concat(prodOpts);
  var prodEd = '<select class="cell-in" onchange="promoDraft(this.value)">' +
    '<option value="">—</option>' +
    prodOpts.map(function(n){
      return '<option value="' + pmAttr(n) + '"' + (n === (draft != null ? draft : r.product) ? ' selected' : '') + '>' + pmEsc(n) + '</option>';
    }).join('') + '</select>';

  var partEd = '<input class="cell-in" list="promoPartnerList" value="' + pmAttr(draft != null ? draft : r.partner) +
    '" placeholder="General" oninput="promoDraft(this.value)" onkeydown="promoKey(event)">';

  var baseEd = '<textarea class="cell-in ta" rows="3" placeholder="' + pmT('Словесное описание базы') +
    '" oninput="promoDraft(this.value)" onkeydown="promoKey(event,true)">' + pmEsc(draft != null ? draft : r.base) + '</textarea>';

  var chanSel = (draft != null ? draft : r.chan) || [];
  var chanEd = '<div class="ms">' + PROMO_CHANNELS.map(function(c){
      return '<label class="ms-i"><input type="checkbox"' + (chanSel.indexOf(c) > -1 ? ' checked' : '') +
        ' onchange="promoDraftChan(\'' + c + '\',this.checked)"><span class="chan ' + promoChanCls(c) + '">' + c + '</span></label>';
    }).join('') +
    '<div class="ms-note">' + pmT('Несколько каналов — будет создано по записи на каждый') + '</div></div>';

  var uniqVal = draft != null ? draft : r.uniq;
  var uniqEd = '<div class="uniq-ed">' +
    '<input class="cell-in mono' + (uniqVal && !promoUniqOk(uniqVal) ? ' bad' : '') + '" id="promoUniqIn" value="' + pmAttr(uniqVal) +
      '" placeholder="spring-sale-2026" oninput="promoDraftUniq(this.value)" onkeydown="promoKey(event)">' +
    '<div class="hint-s" id="promoUniqHint">' + pmT('Латиница, цифры и дефис') + '</div></div>';

  var nm = promoBuildName(r);
  /* Приоритет — авто-собранное имя (правила Конструктора source). Если частей не хватает
     (например, строка пришла импортом без партнёра/уник.имени), показываем сохранённое
     «Название коммуникации» из БД (r.commName), и только если и его нет — подсказку. */
  var nameHtml = nm.ok
    ? '<span class="src-name">' + pmEsc(nm.value) + '</span>'
    : (r.commName
        ? '<span class="src-name" title="' + pmT('Название из импорта') + '">' + pmEsc(r.commName) + '</span>'
        : '<span class="need" title="' + pmT('Название собирается автоматически') + '">' + pmT('нужно заполнить') + ': ' + pmEsc(nm.miss.join(', ')) + '</span>');

  var taskEd = '<input class="cell-in" value="' + pmAttr(draft != null ? draft : r.task) +
    '" placeholder="CRM-8748" oninput="promoDraft(this.value)" onkeydown="promoKey(event)">';
  var taskKey = promoTaskKey(r.task);
  var taskHtml = taskKey
    ? '<a class="jira" href="' + PROMO_JIRA_BASE + pmAttr(taskKey) + '" target="_blank" rel="noopener">' + pmEsc(taskKey) + '</a>'
    : '—';

  var ownerEd = '<input class="cell-in" value="' + pmAttr(draft != null ? draft : r.owner) +
    '" oninput="promoDraft(this.value)" onkeydown="promoKey(event)">';
  var statusEd = '<select class="cell-in" onchange="promoDraft(this.value)">' +
    PROMO_STATUSES.map(function(s){
      return '<option value="' + pmAttr(s) + '"' + (s === (draft != null ? draft : (r.status || '')) ? ' selected' : '') + '>' + (pmEsc(s) || '—') + '</option>';
    }).join('') + '</select>';
  var noteEd = '<textarea class="cell-in ta" rows="3" oninput="promoDraft(this.value)" onkeydown="promoKey(event,true)">' +
    pmEsc(draft != null ? draft : r.note) + '</textarea>';

  var shown = promoStatusShown(r);
  var stCls = shown === 'запланировано' ? 'plan' : (shown === PROMO_STATUS_ASK ? 'ask' : (shown === 'отправлено' ? 'sent' : 'none'));
  var badIcon = f.bad.length
    ? '<span class="flag bad" title="' + pmAttr(f.bad.join('\n')) + '">▲</span>' : '';
  var warnIcon = f.warn.length
    ? '<span class="flag warn" title="' + pmAttr(f.warn.join('\n')) + '">⚠</span>' : '';

  /* дата: иконка календаря — перенос записи в другой день без перезаведения */
  var dateEd = '<input type="date" class="cell-in" value="' + pmAttr(draft != null ? draft : r.d) +
    '" onchange="promoDraft(this.value)" onkeydown="promoKey(event)">';
  var dateHtml = '<span class="date-pick" title="' + pmT('Перенести на другую дату') + '">' +
    PROMO_CAL_ICO + '<span class="dv">' + pmEsc(promoFmtDate(r.d)) + '</span></span>';

  return '<tr class="' + (r.total ? 'total-row ' : '') + (f.bad.length ? 'rule-bad' : '') + '">' +
    promoCell(x, 'd', dateHtml, dateEd) +
    promoCell(x, 'product', badIcon + (pmEsc(r.product) || '—'), prodEd) +
    promoCell(x, 'partner', pmEsc(r.partner) || '—', partEd) +
    promoCell(x, 'base', r.base ? '<span class="multi">' + pmEsc(r.base) + '</span>' : '—', baseEd) +
    promoCell(x, 'chan', promoChanBadges(r.chan), chanEd) +
    '<td class="c-total"><input type="checkbox" ' + (r.total ? 'checked' : '') +
      (promoCan('edit') ? '' : ' disabled') +
      ' onchange="promoSetTotal(' + i + ',this.checked)">' + warnIcon + '</td>' +
    promoCell(x, 'uniq', r.uniq ? '<span class="src-name">' + pmEsc(r.uniq) + '</span>' : '—', uniqEd) +
    '<td class="c-name">' + nameHtml + '</td>' +
    promoCell(x, 'task', taskHtml, taskEd) +
    promoCell(x, 'owner', pmEsc(r.owner) || '—', ownerEd) +
    promoCell(x, 'status', '<span class="st ' + stCls + '">' + (pmEsc(shown) || '—') + '</span>', statusEd) +
    promoCell(x, 'note', r.note ? '<span class="multi">' + pmEsc(r.note) + '</span>' : '—', noteEd) +
    '<td>' + (promoCan('delete')
      ? '<button class="row-del" type="button" title="' + pmT('Удалить строку') + '" onclick="promoDelRow(' + i + ')">×</button>'
      : '') + '</td>' +
  '</tr>';
}

/* ---------- форма новой записи ---------- */
function promoNewOpen(iso){
  if (!promoCan('add')) return;
  PROMO_EDIT = null;
  PROMO_NEW = { d: iso || promoToday(), product:'', partner:'', base:'', chan: [], total:false,
                uniq:'', task:'', owner:'', status: PROMO_STATUS_NEW, note:'', err:'' };
  promoRender();
  var el = document.getElementById('promoNewDate');
  if (el) el.focus();
  var wrap = document.querySelector('#sec-promo .tbl-wrap');
  if (wrap) wrap.scrollTop = 0;
}
function promoNewClose(){ PROMO_NEW = null; promoRender(); }
function promoNewSet(k, v){ if (PROMO_NEW){ PROMO_NEW[k] = v; promoNewPreview(); } }
function promoNewChan(c, on){
  if (!PROMO_NEW) return;
  var list = PROMO_NEW.chan.slice();
  var at = list.indexOf(c);
  if (on && at === -1) list.push(c);
  if (!on && at > -1) list.splice(at, 1);
  PROMO_NEW.chan = PROMO_CHANNELS.filter(function(x){ return list.indexOf(x) > -1; });
  promoNewPreview();
}
/* живой предпросмотр: какие записи будут созданы */
function promoNewPreview(){
  var box = document.getElementById('promoNewPreview');
  if (!box || !PROMO_NEW) return;
  var n = PROMO_NEW;
  var probs = [];
  if (!n.d) probs.push(pmT('укажите дату'));
  if (!n.chan.length) probs.push(pmT('выберите хотя бы один канал'));
  if (n.uniq && !promoUniqOk(n.uniq)) probs.push(pmT('уникальное имя: латиница, цифры и дефис'));
  var names = n.chan.map(function(c){
    var nm = promoBuildName(n, c);
    return nm.ok ? nm.value : (c + ' — ' + pmT('нужно заполнить') + ': ' + nm.miss.join(', '));
  });
  box.innerHTML =
    '<b>' + pmT('Будет создано записей') + ': ' + (n.chan.length || 0) + '</b>' +
    (names.length ? '<div class="np-list">' + names.map(function(s){ return '<span class="np-i">' + pmEsc(s) + '</span>'; }).join('') + '</div>' : '') +
    (probs.length ? '<div class="np-err">' + pmEsc(probs.join('; ')) + '</div>' : '');
  var btn = document.getElementById('promoNewSave');
  if (btn) btn.disabled = !!probs.length;
}
function promoNewSave(){
  if (!PROMO_NEW) return;
  var n = PROMO_NEW;
  if (!n.d || !n.chan.length) return;
  if (n.uniq && !promoUniqOk(n.uniq)) return;
  if (!promoCan('add')){ alert(pmT('Нет прав на добавление записей.')); return; }
  /* каналы уходят одним запросом — сервер сам создаст по строке на канал */
  var body = { d:n.d, product:n.product, partner:n.partner, base:n.base, chan:n.chan,
               total:!!n.total, uniq:n.uniq, task: promoTaskKey(n.task) || n.task,
               owner:n.owner, status:n.status || PROMO_STATUS_NEW, note:n.note };
  PROMO_NEW = null;
  promoReq('POST', '', body)
    .then(function(created){
      (created || []).forEach(promoApplyRow);
      promoRender();
    })
    .catch(promoFail);
}
function promoNewRowHtml(){
  var n = PROMO_NEW;
  var prodOpts = PROMO_PRODUCTS.map(function(p){ return p.name; });
  return '<tr class="new-row">' +
    '<td class="c-d"><input type="date" id="promoNewDate" class="cell-in" value="' + pmAttr(n.d) +
      '" onchange="promoNewSet(\'d\',this.value)"></td>' +
    '<td><select class="cell-in" onchange="promoNewSet(\'product\',this.value)">' +
      '<option value="">' + pmT('Продукт') + '…</option>' +
      prodOpts.map(function(p){ return '<option value="' + pmAttr(p) + '"' + (p === n.product ? ' selected' : '') + '>' + pmEsc(p) + '</option>'; }).join('') +
      '</select></td>' +
    '<td><input class="cell-in" list="promoPartnerList" placeholder="' + pmT('Партнёр') + '" value="' + pmAttr(n.partner) +
      '" oninput="promoNewSet(\'partner\',this.value)"></td>' +
    '<td><textarea class="cell-in ta" rows="3" placeholder="' + pmT('Словесное описание базы') +
      '" oninput="promoNewSet(\'base\',this.value)">' + pmEsc(n.base) + '</textarea></td>' +
    '<td><div class="ms">' + PROMO_CHANNELS.map(function(c){
        return '<label class="ms-i"><input type="checkbox"' + (n.chan.indexOf(c) > -1 ? ' checked' : '') +
          ' onchange="promoNewChan(\'' + c + '\',this.checked)"><span class="chan ' + promoChanCls(c) + '">' + c + '</span></label>';
      }).join('') + '</div></td>' +
    '<td class="c-total"><input type="checkbox"' + (n.total ? ' checked' : '') +
      ' onchange="promoNewSet(\'total\',this.checked)"></td>' +
    '<td><input class="cell-in mono" placeholder="spring-sale-2026" value="' + pmAttr(n.uniq) +
      '" oninput="promoNewSet(\'uniq\',this.value)"></td>' +
    '<td class="c-name"><span class="need">' + pmT('соберётся автоматически') + '</span></td>' +
    '<td><input class="cell-in" placeholder="CRM-8748" value="' + pmAttr(n.task) +
      '" oninput="promoNewSet(\'task\',this.value)"></td>' +
    '<td><input class="cell-in" placeholder="' + pmT('Ответственный') + '" value="' + pmAttr(n.owner) +
      '" oninput="promoNewSet(\'owner\',this.value)"></td>' +
    '<td><select class="cell-in" onchange="promoNewSet(\'status\',this.value)">' +
      PROMO_STATUSES.map(function(s){
        return '<option value="' + pmAttr(s) + '"' + (s === n.status ? ' selected' : '') + '>' + (pmEsc(s) || '—') + '</option>';
      }).join('') + '</select></td>' +
    '<td><textarea class="cell-in ta" rows="3" placeholder="' + pmT('Комментарий') +
      '" oninput="promoNewSet(\'note\',this.value)">' + pmEsc(n.note) + '</textarea></td>' +
    '<td></td>' +
  '</tr>' +
  '<tr class="new-foot"><td colspan="' + (PROMO_COLS + 1) + '">' +
    '<div class="nf">' +
      '<div class="np" id="promoNewPreview"></div>' +
      '<div class="nf-btns">' +
        '<button class="btn accent" type="button" id="promoNewSave" onclick="promoNewSave()">' + pmT('Создать') + '</button>' +
        '<button class="btn" type="button" onclick="promoNewClose()">' + pmT('Отмена') + '</button>' +
      '</div>' +
    '</div>' +
  '</td></tr>';
}

/* ---------- правка ячеек ---------- */
function promoEdit(i, k){
  if (!promoCan('edit')) return;
  var r = PROMO_ROWS[i];
  if (!r) return;
  var v = r[k];
  PROMO_EDIT = { i: i, k: k, v: (k === 'chan') ? (v || []).slice() : (v == null ? '' : v) };
  promoRender();
}
function promoDraft(v){ if (PROMO_EDIT) PROMO_EDIT.v = v; }
function promoDraftChan(c, on){
  if (!PROMO_EDIT) return;
  var list = Array.isArray(PROMO_EDIT.v) ? PROMO_EDIT.v.slice() : [];
  var at = list.indexOf(c);
  if (on && at === -1) list.push(c);
  if (!on && at > -1) list.splice(at, 1);
  PROMO_EDIT.v = PROMO_CHANNELS.filter(function(x){ return list.indexOf(x) > -1; });
}
function promoDraftUniq(v){
  if (PROMO_EDIT) PROMO_EDIT.v = v;
  var inp = document.getElementById('promoUniqIn');
  var hint = document.getElementById('promoUniqHint');
  if (!inp) return;
  var ok = !v || promoUniqOk(v);
  inp.classList.toggle('bad', !ok);
  if (hint){
    hint.classList.toggle('bad', !ok);
    hint.textContent = ok ? pmT('Латиница, цифры и дефис') : pmT('Только латиница, цифры и дефис');
  }
  var okBtn = inp.closest('.ed') ? inp.closest('.ed').querySelector('.cell-ok') : null;
  if (okBtn) okBtn.disabled = !ok;
}
function promoKey(e, multiline){
  if (e.key === 'Escape'){ e.preventDefault(); promoCancel(); return; }
  if (e.key === 'Enter' && !(multiline && !e.ctrlKey)){ e.preventDefault(); promoCommit(); }
}
function promoCommit(){
  if (!PROMO_EDIT) return;
  var e = PROMO_EDIT, r = PROMO_ROWS[e.i];
  if (!r){ PROMO_EDIT = null; promoRender(); return; }

  var v = e.v;
  if (e.k === 'uniq'){
    v = String(v || '').trim();
    if (v && !promoUniqOk(v)){ promoDraftUniq(v); return; }
  }
  if (e.k === 'd' && !String(v || '').trim()){ PROMO_EDIT = null; promoRender(); return; }  /* дату не очищаем */
  if (e.k === 'task') v = promoTaskKey(v) || String(v || '').trim();
  if (e.k === 'chan') v = promoNormChan(v);   /* несколько каналов сервер развернёт в копии строк */
  if (typeof v === 'string' && e.k !== 'base' && e.k !== 'note') v = v.trim();

  /* значение не изменилось — на сервер не ходим */
  var was = r[e.k];
  var same = Array.isArray(v) ? String(was) === String(v) : String(was == null ? '' : was) === String(v == null ? '' : v);
  PROMO_EDIT = null;
  if (same){ promoRender(); return; }

  promoPatch(r, e.k, v);
}
function promoCancel(){ PROMO_EDIT = null; promoRender(); }

/* Правка одного поля строки. ver — версия, которую видел этот браузер:
   разошлась — сервер вернёт 409, и мы перечитаем план (см. promoFail). */
function promoPatch(row, field, value){
  if (!promoCan('edit')){ alert(pmT('Нет прав на изменение плана.')); return promoLoad(); }
  var prev = row[field];
  row[field] = value;          /* оптимистично показываем сразу */
  promoRender();
  return promoReq('PATCH', '/' + row.id, { field: field, value: value, ver: row.ver })
    .then(function(updated){
      if (field === 'chan' && Array.isArray(value) && value.length > 1){
        return promoLoad();    /* сервер создал копии строк — проще перечитать */
      }
      promoApplyRow(updated);
      promoRender();
    })
    .catch(function(err){ row[field] = prev; return promoFail(err); });
}

function promoSetTotal(i, on){
  var r = PROMO_ROWS[i];
  if (!r) return;
  promoPatch(r, 'total', !!on);
}
function promoAddRow(iso){ promoNewOpen(iso); }
function promoDelRow(i){
  var r = PROMO_ROWS[i];
  if (!r) return;
  if (!promoCan('delete')){ alert(pmT('Нет прав на удаление записей.')); return; }
  if (!confirm(pmT('Удалить строку?'))) return;
  PROMO_EDIT = null;
  promoReq('DELETE', '/' + r.id)
    .then(function(){
      var at = PROMO_ROWS.indexOf(r);
      if (at > -1) PROMO_ROWS.splice(at, 1);
      promoRender();
    })
    .catch(promoFail);
}

/* клик мимо ячейки = сохранить; клик по другой ячейке сразу открывает её */
document.addEventListener('mousedown', function(e){
  var t0 = e.target;
  /* режим заведения промо: клик по пустой части страницы (не по форме и
     не по кнопке, которая её открывает) — выходим без сохранения */
  if (PROMO_NEW && t0.closest){
    var inForm = t0.closest('.new-row') || t0.closest('.new-foot');
    var reopen = t0.closest('[onclick^="promoNewOpen"]');   /* «+» и кнопка сами переоткроют */
    if (!inForm && !reopen) promoNewClose();
  }
  if (!PROMO_EDIT) return;
  if (t0.closest && (t0.closest('.cell-edit') || t0.closest('.new-row') || t0.closest('.new-foot'))) return;
  var next = t0.closest ? t0.closest('#promoBody td.editable') : null;
  promoCommit();
  if (next && !PROMO_EDIT){
    var i = parseInt(next.getAttribute('data-i'), 10);
    var k = next.getAttribute('data-k');
    if (!isNaN(i) && k){ e.preventDefault(); promoEdit(i, k); }
  }
}, true);

/* открытие ячейки по клику */
document.addEventListener('click', function(e){
  var td = e.target.closest ? e.target.closest('#promoBody td.editable') : null;
  if (!td) return;
  if (e.target.closest('a')) return;   /* ссылка на задачу открывается как ссылка */
  var i = parseInt(td.getAttribute('data-i'), 10);
  var k = td.getAttribute('data-k');
  if (!isNaN(i) && k) promoEdit(i, k);
});

function promoExportCsv(){
  var head = ['Дата','День недели','Продукт','Партнёр','База','Канал','Тотал','Уникальное имя',
              'Название коммуникации','Задача','Ответственный','Статус','Комментарий','Замечания'];
  var rows = promoFiltered().map(function(x){
    var r = x.r, f = PROMO_FLAGS[x.i] || { bad: [], warn: [] };
    var key = promoTaskKey(r.task);
    var nm = promoBuildName(r);
    return [promoFmtDate(r.d), promoDow(r.d), r.product, r.partner, r.base,
            (r.chan || []).join(', '), r.total ? 'TRUE' : 'FALSE', r.uniq,
            nm.ok ? nm.value : (r.commName || ''), key ? PROMO_JIRA_BASE + key : '', r.owner,
            promoStatusShown(r), r.note, f.bad.concat(f.warn).join(' | ')];
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

/* справочник партнёров для ввода с подсказкой */
function promoFillPartnerList(){
  var dl = document.getElementById('promoPartnerList');
  if (!dl || dl.childElementCount) return;
  dl.innerHTML = PROMO_PARTNERS.map(function(p){ return '<option value="' + pmAttr(p) + '">'; }).join('');
}

/* Первая загрузка плана с сервера; дальше раздел сам подтягивает чужие правки. */
promoFillPartnerList();
promoRender();
promoLoad();
promoAutoRefresh();
