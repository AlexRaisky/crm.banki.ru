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

/* Продукты — ровно тот список, который принимает поле «Тип продукта» в Jira: значение
   уходит в задачу как есть, и всё, чего в этом списке нет, Jira отвергает с ошибкой.
   Порядок тоже её — чтобы глаз искал пункт там же, где на форме Jira.

   Код рядом — наш сегмент (crm_product_segment), из него собирается source-имя
   коммуникации. С написанием Jira он совпадает не всегда: у нас factoring, у них
   Faktoring, — поэтому пара «код + имя», а не одно поле на оба смысла. */
var PROMO_PRODUCTS = [
  { code:'autocredits',         name:'Autocredits' },
  { code:'acquiring',           name:'Acquiring' },
  { code:'business_credits',    name:'Business_credits' },
  { code:'business_microloans', name:'Business_microloans' },
  { code:'creditcards',         name:'Creditcards' },
  { code:'credits',             name:'Credits' },
  { code:'debitcards',          name:'Debitcards' },
  { code:'deposits',            name:'Deposits' },
  { code:'exchange_rate',       name:'Exchange_rate' },
  { code:'factoring',           name:'Faktoring' },
  { code:'general',             name:'General' },
  { code:'leasing',             name:'Leasing' },
  { code:'insurance_estate',    name:'Insurance_estate' },
  { code:'insurance_etc',       name:'Insurance_etc' },
  { code:'investments',         name:'Investments' },
  { code:'kasko',               name:'Kasko' },
  { code:'lsre',                name:'LSRE' },
  { code:'microloans',          name:'Microloans' },
  { code:'mortgages',           name:'Mortgages' },
  { code:'osago',               name:'OSAGO' },
  { code:'rko',                 name:'RKO' },
  { code:'savings_account',     name:'Savings_account' }
];
/* Продукты, которых в списке Jira нет, а в накопленном плане они встречаются.
   В выпадашку не попадают: предложить их значило бы пообещать задачу, которую Jira не
   примет. Но код по ним по-прежнему находится — старые строки не теряют source-имя и
   не начинают считаться «продукт не указан». */
var PROMO_PRODUCTS_LEGACY = [
  { code:'cash_register',    name:'Онлайн-кассы' },
  { code:'kpk',              name:'Кредитование потребительского кооператива (КПК)' },
  { code:'insurance_vzr',    name:'Выезд за рубеж (ВЗР)' },
  { code:'insurance_health', name:'Ипотечное страхование жизни и здоровья' },
  { code:'insurance_combo',  name:'Ипотечное страхование комбо' },
  { code:'insurance_mrtgg',  name:'Ипотечное страхование (объединённое)' },
  { code:'bank_guarantees',  name:'Банковские гарантии' },
  { code:'cryptocurrency',   name:'Криптовалюта' },
  { code:'estate',           name:'Недвижимость' },
  { code:'mortgage_broker',  name:'Ипотечный брокер' },
  { code:'rvk',              name:'РВК Страхование' }
];
/* Прежние написания продукта → нынешнее. Сокращения из старой таблицы и русские
   названия, стоявшие в плане до перехода на список Jira: строка, заведённая вчера,
   не должна сегодня оказаться без продукта. */
var PROMO_PROD_ALIAS = {
  'КК':'Creditcards', 'ДК':'Debitcards', 'ПК':'Credits', 'КВ':'Exchange_rate',
  'НС':'Savings_account', 'КПЗН':'LSRE', 'МФО':'Microloans', 'РКО':'RKO',
  'Бизнес':'Business_credits', 'Кредит для бизнеса':'Business_credits',
  'Ипотека':'Mortgages', 'ОСАГО':'OSAGO', 'Вклады':'Deposits', 'Каско':'Kasko',
  'Инвестиции':'Investments', 'general':'General', 'Общие':'General',
  'Кредитные карты':'Creditcards', 'Дебетовые карты':'Debitcards',
  'Потребительские кредиты':'Credits', 'Автокредиты':'Autocredits',
  'Накопительные счета':'Savings_account', 'Курсы валют (КВ)':'Exchange_rate',
  'Микрозаймы':'Microloans', 'Эквайринг':'Acquiring', 'Лизинг':'Leasing',
  'Факторинг':'Faktoring', 'Кредиты для бизнеса':'Business_credits',
  'Займы для бизнеса':'Business_microloans', 'Инвестиции ':'Investments',
  'Кредит под залог недвижимости (КПЗН)':'LSRE',
  'Ипотечное страхование недвижимости':'Insurance_estate',
  'Страхование другое':'Insurance_etc',
  'Расчётно-кассовое обслуживание (РКО)':'RKO'
};

/* Партнёры: фолбэк на случай недоступного справочника. Основной источник —
   dictionary.d_partner (GET /api/dictionaries/partners), куда этот список и залит
   миграцией V25; см. promoFillPartnerList. Здесь он больше не правится. */
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
/* Базы рассылки. Список закрытый — по нему строки сравниваются между собой (подсветка
   пересечений в один день), а свободный текст этому мешает. Но вписать своё всё же можно:
   в плане встречается «Вся база Москва+МО» и подобное, и отсекать это значило бы терять
   уже накопленное. Своё значение просто не участвует в сравнении как элемент списка —
   оно сравнивается целиком, как есть. */
var PROMO_BASES = ['Вклады', 'ОСАГО', 'Каско', 'НС', 'Инвестиции', 'КК', 'ДК', 'ПК',
                   'КПЗН', 'Ипотека', 'КВ', 'Бизнес', 'Диалог', 'ИС', 'МФО', 'Тотал'];
var PROMO_OWNERS = [];        /* имена для выпадашки ответственных, приезжают с сервера */
var PROMO_COLS = 17;          /* колонок до кнопки «+» в строке-дате */
/* Заказчик — вертикаль. Список тот же, что в поле «Заказчик» в Jira, и в том же
   порядке: значение уходит в задачу как есть, а всё, чего в этом списке нет, Jira
   отвергает. Пустой пункт («None» на её форме) подставляет promoCustomerOpts.
   Зашит здесь, а не читается справочником: направления (chain.chain,
   gorizontal.gorizontal) заведены не на всех контурах, и там, где их нет, поле
   оставалось свободным вводом — а значит и опечатками, по которым потом не
   сгруппировать план.
   Значение, заведённое до появления списка, из строки не пропадает: оно добавляется
   в выпадашку отдельным пунктом (см. promoCustomerOpts). */
var PROMO_VERTICALS = ['Бизнес', 'Ипотека', 'Карты', 'Кредиты', 'Сбережения',
                       'Страхование', 'Маркетплейс', 'Мобильное приложение',
                       'Лояльность', 'Диалог', 'Народный Рейтинг', 'Новости'];

/* Строка баз → список. Разделители — запятая, точка с запятой и перевод строки:
   в накопленных данных встречаются все три. */
function promoBaseList(v){
  return String(v == null ? '' : v).split(/[,;\n]+/)
    .map(function(s){ return s.trim(); })
    .filter(function(s){ return s.length > 0; });
}
/* Список → строка в том виде, в каком база хранилась и раньше: через запятую. */
function promoBaseText(list){ return (list || []).join(', '); }
/* иконка календаря в колонке «Дата»: по клику дату можно переназначить */
var PROMO_CAL_ICO = '<svg class="cal-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>';
var PROMO_ROWS = [];
var PROMO_EDIT = null;        /* { i, k, v } — v это черновик правки */
var PROMO_NEW = null;         /* форма новой записи над таблицей */
var PROMO_TAB = 'active';     /* active | archive */
var PROMO_FLAGS = {};         /* индекс строки → { bad:[…], warn:[…] } */
var PROMO_CLASH = {};         /* индекс строки → базы, пересекающиеся с другим промо того же дня */

function pmT(s){ return (typeof t === 'function') ? t(s) : s; }
function pmEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
function pmAttr(s){ return pmEsc(s); }

/* Длинные поля («доп. условия», комментарий) люди заполняют прозой и вставляют туда
   ссылки на страницы banki.ru. Голый адрес в узкой ячейке разъезжается на три строки и
   превращает строку таблицы в стену текста, а кликнуть по нему всё равно нельзя.
   Поэтому адреса показываем короткой ссылкой: домен, многоточие и последний кусок пути,
   полный адрес — в подсказке. Открытие ссылки редактор ячейки не запускает: обработчик
   клика пропускает клики по <a> (см. ниже). */
function pmLink(u){
  var clean = u.replace(/[),.;:!?»]+$/, '');    // хвостовая пунктуация в адрес не входит
  var tail = u.slice(clean.length);
  var label = clean.replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (label.length > 44){
    var parts = label.split('/').filter(Boolean);
    var host = parts.shift() || label;
    var lastSeg = parts.pop() || '';
    if (lastSeg.length > 34) lastSeg = lastSeg.slice(0, 32) + '…';
    label = parts.length ? host + '/…/' + lastSeg : host + '/' + lastSeg;
  }
  return '<a class="ext" href="' + pmAttr(clean) + '" target="_blank" rel="noopener noreferrer"' +
         ' title="' + pmAttr(clean) + '">' + pmEsc(label) + '</a>' + pmEsc(tail);
}
function pmRich(s){
  var str = String(s == null ? '' : s), out = '', re = /https?:\/\/[^\s<>"']+/g, last = 0, m;
  while ((m = re.exec(str)) !== null){
    out += pmEsc(str.slice(last, m.index)) + pmLink(m[0]);
    last = m.index + m[0].length;
  }
  return out + pmEsc(str.slice(last));
}

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
    var byCode = PROMO_PRODUCTS.concat(PROMO_PRODUCTS_LEGACY)
      .filter(function(x){ return x.code === p; })[0];
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

/* ---------- задача в Jira из строки плана ----------
   Всё, что нужно задаче, в строке уже есть — канал, заказчик, продукт, дата, сегмент,
   ссылка. Кроме source: его собирает Конструктор source здесь же, на клиенте, поэтому
   отправляем готовым, а не просим сервер повторить ту же сборку.

   Заводит задачу сервер: у браузера нет ни адреса Jira, ни токена, и хорошо, что нет. */
function promoCreateJira(i){
  var r = PROMO_ROWS[i];
  if (!r || !r.id) return;
  if (promoTaskKey(r.task)){
    alert(pmT('По этой строке уже есть задача') + ' ' + r.task);
    return;
  }
  /* Тип продукта в Jira выбирают кодом — General, Debitcards, — а в плане он назван
     по-русски: «Общие», «Дебетовые карты». Код лежит в том же справочнике, из которого
     собирается source, поэтому шлём его отсюда, а не заставляем сервер искать заново. */
  var nm = promoBuildName(r);
  PM_JIRA = { row: r, source: nm.ok ? nm.value : '', miss: nm.ok ? [] : nm.miss,
              productCode: promoProdCode(r.product) };
  pmJiraOpen();
}

/* ---------- окно заведения задачи ----------

   Задача в трекере — след, который остаётся у всей команды: её видят, на неё ссылаются,
   отменить кнопкой её нельзя. Поэтому между нажатием и созданием стоит окно, где
   показано, что именно уедет: заголовок и все поля. Раньше вместо него был confirm с
   одной строкой про source — и то лишь когда source не собрался.

   Заголовок и поля считает сервер той же сборкой, что и заведение: превью, посчитанное
   отдельно, разошлось бы с настоящим запросом на первой же правке формулы. */
var PM_JIRA = null;

function pmJiraOpen(){
  var m = document.getElementById('pmJiraModal');
  if (!m || !PM_JIRA) return;
  pmJiraWire();
  document.getElementById('pmJiraSum').textContent = '';
  document.getElementById('pmJiraNote').textContent = '';
  document.getElementById('pmJiraGo').disabled = true;
  document.getElementById('pmJiraBody').innerHTML =
    '<div class="pm-jira-wait">' + pmT('Собираем задачу…') + '</div>';
  m.classList.add('open');

  var q = '?source=' + encodeURIComponent(PM_JIRA.source) +
          '&productCode=' + encodeURIComponent(PM_JIRA.productCode);
  promoReq('GET', '/' + PM_JIRA.row.id + '/jira/preview' + q)
    .then(function(d){ pmJiraRender(d); })
    .catch(function(e){
      document.getElementById('pmJiraBody').innerHTML =
        '<div class="pm-jira-err">' + pmEsc((e && e.message) || pmT('Не удалось собрать задачу')) + '</div>';
    });
}

/* Подписи полей — те же, что в самой Jira: человек сверяет окно с карточкой задачи. */
var PM_JIRA_LABELS = {
  channel: 'Канал', customer: 'Заказчик', product: 'Тип продукта', kind: 'Вид рассылки',
  name: 'Название рассылки', sendDate: 'Дата отправки', meaning: 'Бизнес-смысл',
  link: 'Ссылка', content: 'Контент', segment: 'Сегмент', analyst: 'Ответственный аналитик',
  source: 'Source', summary: 'Заголовок задачи (задан руками)'
};

function pmJiraRender(d){
  d = d || {};
  var f = d.fields || {};
  var rows = Object.keys(PM_JIRA_LABELS).map(function(k){
    var v = f[k];
    var empty = v === null || v === undefined || String(v).trim() === '';
    if (empty && k === 'summary') return '';
    return '<div class="pm-jira-row"><div class="l">' + pmEsc(PM_JIRA_LABELS[k]) + '</div>' +
      '<div class="v' + (empty ? ' empty' : '') + '">' + (empty ? '—' : pmEsc(v)) + '</div></div>';
  }).join('');

  document.getElementById('pmJiraSum').textContent = d.summary || '';
  document.getElementById('pmJiraBody').innerHTML =
    '<div class="pm-jira-title"><div class="l">' + pmT('Заголовок задачи') + '</div>' +
      '<div class="v">' + pmEsc(d.summary || '') + '</div></div>' +
    '<div class="pm-jira-grid">' + rows + '</div>';

  /* Про пустой source говорим здесь, а не отдельным окном поверх окна: без него задача
     заведётся, но останется без главного поля — а дозаполнять его руками ровно то,
     ради чего кнопку и делали. */
  var note = document.getElementById('pmJiraNote');
  if (PM_JIRA.miss.length){
    note.textContent = pmT('Не хватает данных для source: ') + PM_JIRA.miss.join(', ') +
      '. ' + pmT('Задача заведётся без него.');
    note.classList.add('warn');
  } else {
    note.textContent = pmT('Проверьте поля: после создания задача останется в трекере.');
    note.classList.remove('warn');
  }
  document.getElementById('pmJiraGo').disabled = false;
}

function pmJiraClose(){
  var m = document.getElementById('pmJiraModal');
  if (m) m.classList.remove('open');
  PM_JIRA = null;
}

function pmJiraWire(){
  if (pmJiraWire.done) return;
  pmJiraWire.done = true;
  var m = document.getElementById('pmJiraModal');
  document.getElementById('pmJiraClose').onclick = pmJiraClose;
  document.getElementById('pmJiraCancel').onclick = pmJiraClose;
  document.getElementById('pmJiraGo').onclick = pmJiraSend;
  m.onclick = function(e){ if (e.target === m) pmJiraClose(); };
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && m.classList.contains('open')) pmJiraClose();
  });
}

/* Заводит задачу сервер: у браузера нет ни адреса Jira, ни токена, и хорошо, что нет. */
function pmJiraSend(){
  if (!PM_JIRA) return;
  var go = document.getElementById('pmJiraGo');
  var note = document.getElementById('pmJiraNote');
  go.disabled = true;
  note.textContent = pmT('Заводим…');
  note.classList.remove('warn');
  promoReq('POST', '/' + PM_JIRA.row.id + '/jira', {
    source: PM_JIRA.source,
    productCode: PM_JIRA.productCode
  })
    .then(function(res){
      pmJiraClose();
      if (res && res.warning) alert(res.warning);
      return promoLoad();
    })
    .catch(function(e){
      if (e && e.status === 401) return;
      /* Окно не закрываем: ошибку читают рядом с полями, по которым её и объясняют. */
      note.textContent = (e && e.message) || pmT('Не удалось завести задачу');
      note.classList.add('warn');
      go.disabled = false;
    });
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
  promoLoadOwners();
  return promoReq('GET', '').then(function(rows){
    PROMO_ROWS = (rows || []).map(function(r){ r.chan = promoNormChan(r.chan); return r; });
    promoRender();
  }).catch(function(e){
    if (e && e.status === 403){
      var body = document.getElementById('promoBody');
      if (body) body.innerHTML = '<tr><td colspan="14" class="empty">' + pmT('Нет доступа к разделу') + '</td></tr>';
    }
  }).then(function(){ _promoLoading = false; });
}

/* Кого можно назначить ответственным. Спрашиваем один раз за загрузку страницы:
   список меняется не чаще, чем заводят сотрудников. Не приехал — беда небольшая,
   в выпадашке останется только то имя, что уже стоит в строке. */
var _promoOwnersAsked = false;
function promoLoadOwners(){
  if (_promoOwnersAsked) return;
  _promoOwnersAsked = true;
  promoReq('GET', '/owners').then(function(list){
    PROMO_OWNERS = list || [];
    promoRender();
  }).catch(function(){ PROMO_OWNERS = []; });
}

/* Опции выпадашки заказчика. Кроме зашитых вертикалей показываем то, что уже стоит
   в строке: список закрытый, но обнулять задним числом записи, заведённые до него,
   он не должен — иначе первое же открытие ячейки стёрло бы заказчика. */
function promoCustomerOpts(sel, emptyLabel){
  var list = PROMO_VERTICALS.slice();
  if (sel && list.indexOf(sel) === -1) list = [sel].concat(list);
  return '<option value="">' + pmEsc(emptyLabel || '—') + '</option>' + list.map(function(c){
    return '<option value="' + pmAttr(c) + '"' + (c === sel ? ' selected' : '') + '>' + pmEsc(c) + '</option>';
  }).join('');
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
/* Код сегмента по названию продукта. Ищем и среди отменённых названий: строку,
   заведённую до перехода на список Jira, source-имя терять не должно — она уже
   отправлена, и «продукт не указан» на ней означало бы поломку на ровном месте. */
function promoProdCode(product){
  var first = String(product || '').split(',')[0].trim();
  var p = PROMO_PRODUCTS.concat(PROMO_PRODUCTS_LEGACY)
    .filter(function(x){ return x.name === first; })[0];
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
  promoComputeClash();
  return flags;
}

/**
 * Опознавательный признак кампании — то, что общее у её строк и различает разные
 * кампании между собой: продукт, партнёр и уникальное имя. Канала здесь нет намеренно:
 * строки одной кампании как раз им и отличаются (промо на sms, e-mail и push — одна
 * кампания, три строки).
 *
 * Уникального имени может не быть (строки из импорта) — тогда опознаём по сохранённому
 * названию коммуникации, а если и его нет, по паре «продукт + партнёр». Последнее грубее,
 * но лучше, чем свалить все безымянные строки дня в одну кампанию.
 */
function promoCampaignKey(r){
  var norm = function(v){ return String(v == null ? '' : v).trim().toLowerCase(); };
  var uniq = norm(r.uniq);
  if (uniq) return 'u:' + norm(r.product) + '|' + norm(r.partner) + '|' + uniq;
  var nm = norm(r.commName);
  if (nm) return 'n:' + nm;
  return 'p:' + norm(r.product) + '|' + norm(r.partner);
}

/**
 * Пересечения баз внутри одного дня: индекс строки → список баз, которые встречаются
 * ещё у кого-то в этот же день.
 *
 * Конфликт — когда по одной базе в один день бьют РАЗНЫЕ кампании: человек получит
 * промо от двух не связанных между собой рассылок. Внутри одной кампании повтор
 * нормален и не подсвечивается — это её же строки на разных каналах (e-mail и push
 * одного промо по одной базе делаются намеренно).
 * Сравниваем по отдельным базам, а не по строке целиком: «Вклады, НС» и «НС, ДК» —
 * это пересечение по НС, и именно НС надо показать.
 */
function promoComputeClash(){
  /* Сравниваем без учёта регистра: галки из справочника всегда пишутся одинаково, а вот
     вписанное руками расходится («Вся база Москва+МО» против «вся база москва+МО») — и
     пересечение молча не находилось бы. Ключ приводим к нижнему регистру, а показываем
     значение так, как его написали: подсвечиваем по совпадению ключа, а не текста. */
  /* Группируем по «день + база» и запоминаем, какие кампании в эту базу метят.
     В корзине держим и саму базу: выковыривать её обратно из составного ключа
     значило бы гадать, где кончается день и начинается база. */
  var byDay = {};
  PROMO_ROWS.forEach(function(r, i){
    var bases = promoBaseList(r.base);
    if (!bases.length) return;
    var camp = promoCampaignKey(r);
    /* Строки сравниваются внутри «день + продукт + канал + база»; кампанию внутри
       этой корзины опознаёт уникальное имя. То есть акция — это продукт, канал,
       база и имя вместе, и конфликт возникает, когда всё совпало, а имя разное.

       Продукт в ключе: одна база под разными продуктами — разные срезы аудитории,
       планируют их независимо («Инвестиции» и «Курсы валют» мешать друг другу не
       могут). Канал в ключе: e-mail и push одного дня — разные касания, и человек
       не получает два одинаковых сообщения; заодно строки одной акции в разных
       каналах теперь просто не встречаются между собой. */
    var prod = String(r.product == null ? '' : r.product).trim().toLowerCase();
    /* Каналов у строки может быть несколько — считаем по каждому отдельно.
       Канала нет вовсе — такие строки сравниваем между собой в общей корзине. */
    var chans = (r.chan && r.chan.length ? r.chan : ['']).map(function(c){
      return String(c == null ? '' : c).trim().toLowerCase();
    });
    bases.forEach(function(b){
      var low = b.toLowerCase();
      chans.forEach(function(ch){
        var k = r.d + '||' + prod + '||' + ch + '||' + low;
        var slot = byDay[k] = byDay[k] || { base: low, rows: [], camps: {} };
        slot.rows.push(i);
        slot.camps[camp] = true;
      });
    });
  });
  var keys = {};                                 /* индекс строки → базы, что конфликтуют */
  Object.keys(byDay).forEach(function(k){
    var slot = byDay[k];
    /* Кампания одна — сколько бы строк в ней ни было, это её собственные каналы.
       Конфликт начинается со второй кампании на ту же базу. */
    if (Object.keys(slot.camps).length < 2) return;
    slot.rows.forEach(function(i){
      (keys[i] = keys[i] || []).push(slot.base);
    });
  });
  /* Обратно к тому, что написано в строке: иначе в подсказке и подсветке оказался бы
     нижний регистр вместо настоящего написания. */
  var clash = {};
  Object.keys(keys).forEach(function(i){
    clash[i] = promoBaseList(PROMO_ROWS[i].base).filter(function(b){
      return keys[i].indexOf(b.toLowerCase()) > -1;
    });
  });
  PROMO_CLASH = clash;
  return clash;
}

/* ---------- фильтры и вкладки ---------- */
function promoSetTab(tab){
  PROMO_TAB = tab === 'archive' ? 'archive' : 'active';
  PROMO_EDIT = null;
  promoRender();
  /* вкладка стоит в адресе — ссылка на архив открывает архив */
  if (window.Router) Router.touch();
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
      var hay = [nm.value, r.base, r.baseExtra, r.product, r.partner, r.uniq, r.task, r.note,
                 r.customer, r.link, r.content].join(' ').toLowerCase();
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
  promoBindCombos(body);

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

  var partEd = promoPartnerEd(pmAttr(draft != null ? draft : r.partner),
                              'promoDraft(this.value)', 'General');

  /* База: чекбоксы справочника + строка для своего значения. Черновик держим строкой
     (как поле в БД), а не списком: так правка уходит на сервер тем же путём, что и
     раньше, и ничего не надо разворачивать в копии строк, как у каналов. */
  var baseSel = promoBaseList(draft != null ? draft : r.base);
  var baseOwn = baseSel.filter(function(b){ return PROMO_BASES.indexOf(b) === -1; });
  var baseEd = '<div class="ms ms-base">' + PROMO_BASES.map(function(b){
      return '<label class="ms-i"><input type="checkbox"' + (baseSel.indexOf(b) > -1 ? ' checked' : '') +
        ' onchange="promoDraftBase(\'' + b + '\',this.checked)"><span>' + pmEsc(b) + '</span></label>';
    }).join('') +
    '<input class="cell-in ms-own" value="' + pmAttr(promoBaseText(baseOwn)) +
      '" placeholder="' + pmT('своё значение') + '" oninput="promoDraftBaseOwn(this.value)"' +
      ' onkeydown="promoKey(event)">' +
    '</div>';

  var extraEd = '<textarea class="cell-in ta" rows="3" placeholder="' + pmT('Уточнение выборки словами') +
    '" oninput="promoDraft(this.value)" onkeydown="promoKey(event,true)">' +
    pmEsc(draft != null ? draft : r.baseExtra) + '</textarea>';

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
    '<div class="hint-s" id="promoUniqHint">' + pmT('Латиница, цифры и дефис. Если имени нет — NoComName') + '</div></div>';

  var nm = promoBuildName(r);
  /* Приоритет — авто-собранное имя (правила Конструктора source). Если частей не хватает
     (например, строка пришла импортом без партнёра/уник.имени), показываем сохранённое
     «Название коммуникации» из БД (r.commName), и только если и его нет — подсказку. */
  var nameHtml = nm.ok
    ? '<span class="src-name">' + pmEsc(nm.value) + '</span>'
    : (r.commName
        ? '<span class="src-name" title="' + pmT('Название из импорта') + '">' + pmEsc(r.commName) + '</span>'
        : '<span class="need" title="' + pmT('Название собирается автоматически') + '">' + pmT('нужно заполнить') + ': ' + pmEsc(nm.miss.join(', ')) + '</span>');

  /* Название задачи — то, что человек прочтёт в шапке Jira. Пишет его маркетолог или
     постановщик, поэтому это свободный текст, а не сборка из полей. Пустое поле не
     ошибка: тогда заголовок соберётся автоматически, как было до появления колонки. */
  var titleEd = '<input class="cell-in" placeholder="' + pmT('О чём задача') + '" value="' +
    pmAttr(draft != null ? draft : (r.title || '')) +
    '" oninput="promoDraft(this.value)" onkeydown="promoKey(event)">';
  var titleHtml = r.title
    ? '<span class="multi" title="' + pmAttr(r.title) + '">' + pmEsc(r.title) + '</span>'
    : '<span class="need" title="' + pmT('Без него заголовок задачи соберётся из полей строки') + '">' +
      pmT('соберётся из полей') + '</span>';

  /* Заказчик — вертикаль из закрытого списка. Прежде было свободным вводом, и одна и та
     же вертикаль писалась по-разному. Значение, заведённое до списка, остаётся выбранным
     и не теряется при первом же открытии ячейки. */
  var custVal = draft != null ? draft : (r.customer || '');
  var custEd = '<select class="cell-in" onchange="promoDraft(this.value)">' +
    promoCustomerOpts(custVal) + '</select>';
  var custHtml = r.customer ? pmEsc(r.customer) : '—';

  /* Ссылка и описание — их заполняет постановщик, и они же уезжают в задачу Jira
     («Ссылка» и «Контент»). Ссылку показываем короткой — как в доп. условиях. */
  var linkEd = '<input class="cell-in" value="' + pmAttr(draft != null ? draft : (r.link || '')) +
    '" placeholder="https://www.banki.ru/…" oninput="promoDraft(this.value)" onkeydown="promoKey(event)">';
  var linkHtml = r.link ? '<span class="multi" title="' + pmAttr(r.link) + '">' + pmRich(r.link) + '</span>' : '—';

  var contentEd = '<textarea class="cell-in ta" rows="4" placeholder="' +
    pmT('Что учесть в тексте или визуале') + '" oninput="promoDraft(this.value)"' +
    ' onkeydown="promoKey(event,true)">' + pmEsc(draft != null ? draft : (r.content || '')) + '</textarea>';
  var contentHtml = r.content
    ? '<span class="multi" title="' + pmAttr(r.content) + '">' + pmRich(r.content) + '</span>' : '—';

  var taskEd = '<input class="cell-in" value="' + pmAttr(draft != null ? draft : r.task) +
    '" placeholder="CRM-8748" oninput="promoDraft(this.value)" onkeydown="promoKey(event)">';
  var taskKey = promoTaskKey(r.task);
  /* Пустая ячейка задачи — это не «нечего показать», а «задачу ещё не завели». Кнопка
     стоит прямо здесь: заводить задачу из строки плана и есть смысл кнопки, а ключ
     после заведения встанет на её место. */
  var taskHtml = taskKey
    ? '<a class="jira" href="' + PROMO_JIRA_BASE + pmAttr(taskKey) + '" target="_blank" rel="noopener">' + pmEsc(taskKey) + '</a>'
    : (promoCan('edit')
        ? '<button type="button" class="jira-new" onclick="event.stopPropagation();promoCreateJira(' + x.i + ')">' +
            pmT('Завести') + '</button>'
        : '—');

  /* Ответственный — из пользователей панели. Текущее значение строки всегда есть в
     списке, даже если такого пользователя уже нет: иначе открытие редактора молча
     подменяло бы его первым пунктом. */
  var ownerVal = draft != null ? draft : (r.owner || '');
  var ownerOpts = PROMO_OWNERS.slice();
  if (ownerVal && ownerOpts.indexOf(ownerVal) === -1) ownerOpts.unshift(ownerVal);
  var ownerEd = '<select class="cell-in" onchange="promoDraft(this.value)">' +
    '<option value="">—</option>' +
    ownerOpts.map(function(n){
      return '<option value="' + pmAttr(n) + '"' + (n === ownerVal ? ' selected' : '') + '>' + pmEsc(n) + '</option>';
    }).join('') + '</select>';
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

  /* Пересечение баз с другим промо того же дня — показываем на самих базах:
     подсвечиваем только совпавшие, чтобы было видно, из-за какой именно. */
  var clash = PROMO_CLASH[i] || [];
  var baseHtml = r.base
    ? promoBaseList(r.base).map(function(b){
        return '<span class="base-tag' + (clash.indexOf(b) > -1 ? ' clash' : '') + '">' + pmEsc(b) + '</span>';
      }).join(' ')
    : '—';

  return '<tr class="' + (r.total ? 'total-row ' : '') + (clash.length ? 'base-clash ' : '') +
      (f.bad.length ? 'rule-bad' : '') + '">' +
    promoCell(x, 'd', dateHtml, dateEd) +
    promoCell(x, 'title', titleHtml, titleEd) +
    promoCell(x, 'customer', custHtml, custEd) +
    promoCell(x, 'product', badIcon + (pmEsc(r.product) || '—'), prodEd) +
    promoCell(x, 'partner', pmEsc(r.partner) || '—', partEd) +
    promoCell(x, 'base', baseHtml, baseEd) +
    promoCell(x, 'baseExtra', r.baseExtra
      ? '<span class="multi" title="' + pmAttr(r.baseExtra) + '">' + pmRich(r.baseExtra) + '</span>' : '—', extraEd) +
    promoCell(x, 'chan', promoChanBadges(r.chan), chanEd) +
    '<td class="c-total"><input type="checkbox" ' + (r.total ? 'checked' : '') +
      (promoCan('edit') ? '' : ' disabled') +
      ' onchange="promoSetTotal(' + i + ',this.checked)">' + warnIcon + '</td>' +
    promoCell(x, 'uniq', r.uniq ? '<span class="src-name">' + pmEsc(r.uniq) + '</span>' : '—', uniqEd) +
    '<td class="c-name">' + nameHtml + '</td>' +
    promoCell(x, 'link', linkHtml, linkEd) +
    promoCell(x, 'content', contentHtml, contentEd) +
    promoCell(x, 'task', taskHtml, taskEd) +
    promoCell(x, 'owner', pmEsc(r.owner) || '—', ownerEd) +
    promoCell(x, 'status', '<span class="st ' + stCls + '">' + (pmEsc(shown) || '—') + '</span>', statusEd) +
    promoCell(x, 'note', r.note
      ? '<span class="multi" title="' + pmAttr(r.note) + '">' + pmRich(r.note) + '</span>' : '—', noteEd) +
    '<td>' + (promoCan('delete')
      ? '<button class="row-del" type="button" title="' + pmT('Удалить строку') + '" onclick="promoDelRow(' + i + ')">×</button>'
      : '') + '</td>' +
  '</tr>';
}

/* ---------- форма новой записи ---------- */
function promoNewOpen(iso){
  if (!promoCan('add')) return;
  PROMO_EDIT = null;
  PROMO_NEW = { d: iso || promoToday(), title:'', customer:'', product:'', partner:'', base:'', baseExtra:'', chan: [],
                total:false, uniq:'', link:'', content:'', task:'', taskByChan:{}, owner:'',
                status: PROMO_STATUS_NEW, note:'', err:'' };
  promoRender();
  var el = document.getElementById('promoNewDate');
  if (el) el.focus();
  var wrap = document.querySelector('#sec-promo .tbl-wrap');
  if (wrap) wrap.scrollTop = 0;
}
function promoNewClose(){ PROMO_NEW = null; promoRender(); }
/* Заполнена ли форма хоть чем-нибудь. Дата не в счёт: она проставляется сама при
   открытии, и терять в ней нечего. */
function promoNewDirty(){
  var n = PROMO_NEW;
  if (!n) return false;
  if (n.title || n.customer || n.product || n.partner || n.base || n.baseExtra) return true;
  if (n.uniq || n.link || n.content || n.task || n.note || n.owner) return true;
  if (n.total || (n.chan && n.chan.length)) return true;
  if (n.status && n.status !== PROMO_STATUS_NEW) return true;
  var byChan = n.taskByChan || {};
  return Object.keys(byChan).some(function(c){ return !!byChan[c]; });
}
function promoNewSet(k, v){ if (PROMO_NEW){ PROMO_NEW[k] = v; promoNewPreview(); } }
/* База в форме новой записи — та же механика, что и в редакторе ячейки. */
function promoNewBase(b, on){
  if (!PROMO_NEW) return;
  var list = promoBaseList(PROMO_NEW.base);
  var own = list.filter(function(x){ return PROMO_BASES.indexOf(x) === -1; });
  var std = list.filter(function(x){ return PROMO_BASES.indexOf(x) > -1; });
  var at = std.indexOf(b);
  if (on && at === -1) std.push(b);
  if (!on && at > -1) std.splice(at, 1);
  std = PROMO_BASES.filter(function(x){ return std.indexOf(x) > -1; });
  PROMO_NEW.base = promoBaseText(std.concat(own));
  promoNewPreview();
}
function promoNewBaseOwn(v){
  if (!PROMO_NEW) return;
  var std = promoBaseList(PROMO_NEW.base).filter(function(x){ return PROMO_BASES.indexOf(x) > -1; });
  PROMO_NEW.base = promoBaseText(std.concat(promoBaseList(v)));
  promoNewPreview();
}
function promoNewChan(c, on){
  if (!PROMO_NEW) return;
  var list = PROMO_NEW.chan.slice();
  var at = list.indexOf(c);
  if (on && at === -1) list.push(c);
  if (!on && at > -1) list.splice(at, 1);
  PROMO_NEW.chan = PROMO_CHANNELS.filter(function(x){ return list.indexOf(x) > -1; });
  /* Перерисовываем строку целиком, а не только предпросмотр: от набора каналов зависит
     колонка задач — одно поле или по полю на канал. Фокус при этом не теряется:
     переключали галку, а не набирали текст. */
  promoRender();
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
/* Задача выбранного канала. Одна на всех (поле task) — когда канал один; при нескольких
   у каждого своя, они лежат в taskByChan. Так задачу можно завести на канал, а не на всё
   промо разом: в Jira это и есть разные тикеты. */
function promoNewTask(chan){
  var n = PROMO_NEW;
  if (!n) return '';
  if (n.chan.length < 2) return n.task || '';
  return (n.taskByChan && n.taskByChan[chan]) || '';
}
function promoNewSetTask(chan, v){
  if (!PROMO_NEW) return;
  if (PROMO_NEW.chan.length < 2){ PROMO_NEW.task = v; }
  else {
    PROMO_NEW.taskByChan = PROMO_NEW.taskByChan || {};
    PROMO_NEW.taskByChan[chan] = v;
  }
  promoNewPreview();
}

function promoNewSave(){
  if (!PROMO_NEW) return;
  var n = PROMO_NEW;
  if (!n.d || !n.chan.length) return;
  if (n.uniq && !promoUniqOk(n.uniq)) return;
  if (!promoCan('add')){ alert(pmT('Нет прав на добавление записей.')); return; }
  var common = { d:n.d, title:n.title, customer:n.customer, product:n.product, partner:n.partner, base:n.base,
                 baseExtra:n.baseExtra, total:!!n.total, uniq:n.uniq, link:n.link, content:n.content,
                 owner:n.owner, status:n.status || PROMO_STATUS_NEW, note:n.note };
  var chans = n.chan.slice();
  PROMO_NEW = null;

  /* Один канал — один запрос, как и было. Несколько — по запросу на канал: задача у
     каждого своя, а одним телом сервер разложил бы одну и ту же во все строки. */
  var reqs = chans.map(function(c){
    var raw = (chans.length < 2) ? (n.task || '') : ((n.taskByChan || {})[c] || '');
    return Object.assign({}, common, { chan: [c], task: promoTaskKey(raw) || raw });
  });
  var seq = reqs.reduce(function(p, body){
    return p.then(function(acc){
      return promoReq('POST', '', body).then(function(created){
        (created || []).forEach(function(r){ acc.push(r); });
        return acc;
      });
    });
  }, Promise.resolve([]));

  seq.then(function(created){
    created.forEach(promoApplyRow);
    promoRender();
  }).catch(promoFail);
}
function promoNewRowHtml(){
  var n = PROMO_NEW;
  var prodOpts = PROMO_PRODUCTS.map(function(p){ return p.name; });
  return '<tr class="new-row">' +
    '<td class="c-d"><input type="date" id="promoNewDate" class="cell-in" value="' + pmAttr(n.d) +
      '" onchange="promoNewSet(\'d\',this.value)"></td>' +
    '<td><input class="cell-in" placeholder="' + pmT('О чём задача') + '" value="' + pmAttr(n.title) +
      '" oninput="promoNewSet(\'title\',this.value)">' +
      '<div class="hint-s">' + pmT('Заголовок задачи в Jira. Пусто — соберётся из полей строки') + '</div></td>' +
    '<td><select class="cell-in" onchange="promoNewSet(\'customer\',this.value)">' +
      promoCustomerOpts(n.customer, pmT('Заказчик') + '…') + '</select></td>' +
    '<td><select class="cell-in" onchange="promoNewSet(\'product\',this.value)">' +
      '<option value="">' + pmT('Продукт') + '…</option>' +
      prodOpts.map(function(p){ return '<option value="' + pmAttr(p) + '"' + (p === n.product ? ' selected' : '') + '>' + pmEsc(p) + '</option>'; }).join('') +
      '</select></td>' +
    '<td>' + promoPartnerEd(pmAttr(n.partner), 'promoNewSet(\'partner\',this.value)', pmT('Партнёр')) + '</td>' +
    '<td><div class="ms ms-base">' + PROMO_BASES.map(function(b){
        return '<label class="ms-i"><input type="checkbox"' + (promoBaseList(n.base).indexOf(b) > -1 ? ' checked' : '') +
          ' onchange="promoNewBase(\'' + b + '\',this.checked)"><span>' + pmEsc(b) + '</span></label>';
      }).join('') +
      '<input class="cell-in ms-own" placeholder="' + pmT('своё значение') + '" value="' +
        pmAttr(promoBaseText(promoBaseList(n.base).filter(function(b){ return PROMO_BASES.indexOf(b) === -1; }))) +
        '" oninput="promoNewBaseOwn(this.value)"></div></td>' +
    '<td><textarea class="cell-in ta" rows="3" placeholder="' + pmT('Уточнение выборки словами') +
      '" oninput="promoNewSet(\'baseExtra\',this.value)">' + pmEsc(n.baseExtra) + '</textarea></td>' +
    '<td><div class="ms">' + PROMO_CHANNELS.map(function(c){
        return '<label class="ms-i"><input type="checkbox"' + (n.chan.indexOf(c) > -1 ? ' checked' : '') +
          ' onchange="promoNewChan(\'' + c + '\',this.checked)"><span class="chan ' + promoChanCls(c) + '">' + c + '</span></label>';
      }).join('') + '</div></td>' +
    '<td class="c-total"><input type="checkbox"' + (n.total ? ' checked' : '') +
      ' onchange="promoNewSet(\'total\',this.checked)"></td>' +
    '<td><div class="uniq-ed"><input class="cell-in mono" placeholder="spring-sale-2026" value="' +
      pmAttr(n.uniq) + '" oninput="promoNewSet(\'uniq\',this.value)">' +
      '<div class="hint-s">' + pmT('Латиница, цифры и дефис. Если имени нет — NoComName') + '</div></div></td>' +
    '<td class="c-name"><span class="need">' + pmT('соберётся автоматически') + '</span></td>' +
    /* Ссылка и описание уезжают в задачу Jira как «Ссылка» и «Контент». Заполняет их
       постановщик — здесь, а не потом в самой задаче: иначе план и задача расходятся
       с первой минуты. */
    '<td><input class="cell-in" placeholder="https://www.banki.ru/…" value="' + pmAttr(n.link) +
      '" oninput="promoNewSet(\'link\',this.value)">' +
      '<div class="hint-s">' + pmT('Основная ссылка, куда ведём получателя') + '</div></td>' +
    '<td><textarea class="cell-in ta" rows="4" placeholder="' + pmT('Что учесть в тексте или визуале') +
      '" oninput="promoNewSet(\'content\',this.value)">' + pmEsc(n.content) + '</textarea></td>' +
    /* Задача: одно поле на один канал, по полю на каждый — когда каналов несколько.
       Подпись канала обязательна: без неё три одинаковых поля подряд не различить. */
    '<td>' + (n.chan.length > 1
      ? '<div class="task-multi">' + n.chan.map(function(c){
          return '<label class="task-row"><span class="chan ' + promoChanCls(c) + '">' + c + '</span>' +
            '<input class="cell-in" placeholder="CRM-8748" value="' + pmAttr(promoNewTask(c)) +
            '" oninput="promoNewSetTask(\'' + c + '\',this.value)"></label>';
        }).join('') + '</div>'
      : '<input class="cell-in" placeholder="CRM-8748" value="' + pmAttr(n.task) +
        '" oninput="promoNewSetTask(\'\',this.value)">') + '</td>' +
    '<td><select class="cell-in" onchange="promoNewSet(\'owner\',this.value)">' +
      '<option value="">' + pmT('Ответственный') + '…</option>' +
      PROMO_OWNERS.map(function(o){
        return '<option value="' + pmAttr(o) + '"' + (o === n.owner ? ' selected' : '') + '>' + pmEsc(o) + '</option>';
      }).join('') + '</select></td>' +
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
/* Отметили/сняли базу из справочника. Порядок держим по справочнику, а вписанное
   руками (его в справочнике нет) остаётся в хвосте — иначе оно прыгало бы при каждой
   отметке чекбокса. */
function promoDraftBase(b, on){
  if (!PROMO_EDIT) return;
  var list = promoBaseList(PROMO_EDIT.v);
  var own = list.filter(function(x){ return PROMO_BASES.indexOf(x) === -1; });
  var std = list.filter(function(x){ return PROMO_BASES.indexOf(x) > -1; });
  var at = std.indexOf(b);
  if (on && at === -1) std.push(b);
  if (!on && at > -1) std.splice(at, 1);
  std = PROMO_BASES.filter(function(x){ return std.indexOf(x) > -1; });
  PROMO_EDIT.v = promoBaseText(std.concat(own));
}
/* Своё значение: заменяет всё, чего нет в справочнике, отмеченные галки не трогает. */
function promoDraftBaseOwn(v){
  if (!PROMO_EDIT) return;
  var std = promoBaseList(PROMO_EDIT.v).filter(function(x){ return PROMO_BASES.indexOf(x) > -1; });
  PROMO_EDIT.v = promoBaseText(std.concat(promoBaseList(v)));
}
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
  /* Открытый список партнёров забирает Enter и Escape себе: там ими выбирают пункт и
     закрывают список. Этот обработчик висит атрибутом и срабатывает раньше, чем
     combobox, — не уступи мы, Enter закрывал бы ячейку вместо выбора из списка. */
  if ((e.key === 'Enter' || e.key === 'Escape') &&
      document.querySelector('#sec-promo .combo-pop.open')) return;
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
  /* Многострочные поля не трогаем: переносы в них — часть значения. */
  if (typeof v === 'string' && ['base','baseExtra','note','content'].indexOf(e.k) === -1) v = v.trim();

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
  /* Режим заведения промо. Пустую форму клик по странице закрывает — терять нечего.
     Заполненную не трогаем: раньше промах мимо формы сворачивал её вместе со всем
     введённым, и полтора десятка полей приходилось набивать заново. Закрыть начатое
     можно кнопкой «Отмена» — это осознанное действие, а не случайный клик. */
  if (PROMO_NEW && t0.closest){
    var inForm = t0.closest('.new-row') || t0.closest('.new-foot');
    var reopen = t0.closest('[onclick^="promoNewOpen"]');   /* «+» и кнопка сами переоткроют */
    if (!inForm && !reopen && !promoNewDirty()) promoNewClose();
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
  var head = ['Дата','День недели','Название','Заказчик','Продукт','Партнёр','База','Доп. условия','Канал','Тотал',
              'Уникальное имя','Название коммуникации','Ссылка','Описание','Задача','Ответственный','Статус',
              'Комментарий','Замечания'];
  var rows = promoFiltered().map(function(x){
    var r = x.r, f = PROMO_FLAGS[x.i] || { bad: [], warn: [] };
    var key = promoTaskKey(r.task);
    var nm = promoBuildName(r);
    return [promoFmtDate(r.d), promoDow(r.d), r.title || '', r.customer || '', r.product, r.partner, r.base, r.baseExtra,
            (r.chan || []).join(', '), r.total ? 'TRUE' : 'FALSE', r.uniq,
            nm.ok ? nm.value : (r.commName || ''), r.link || '', r.content || '',
            key ? PROMO_JIRA_BASE + key : '', r.owner,
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

/* Справочник партнёров для ввода с подсказкой — dictionary.d_partner (тот же
   источник, что у поля «Partner name» в карточке шаблона). Пока список не приехал,
   подставляем зашитый PROMO_PARTNERS: он же остаётся фолбэком, если справочник
   недоступен, — поле в любом случае свободное для ввода. */
/**
 * Поле партнёра: ввод с подсказкой из справочника плюс кнопка «+».
 * <p>
 * Список закрытым быть не может — новый партнёр появляется в плане раньше, чем его
 * заводят в справочник. Поэтому поле свободное, а кнопка переносит набранное в
 * dictionary.d_partner, чтобы в следующий раз оно подсказывалось само и писалось
 * у всех одинаково. Без права add кнопки нет: справочник общий, и пополнять его
 * должен тот, кому вообще позволено заводить записи.
 */
/* Ввод партнёра: наш combobox, а не нативный datalist. Список у datalist рисует сам
   браузер — страница до него не дотягивается ни шрифтом, ни отступами, — и в Chrome он
   выходил во всю высоту строки текста страницы: четыре пункта на пол-экрана. Свой
   список выглядит как остальная панель и заодно фильтрует по подстроке.
   Сам <datalist> остаётся: по нему promoAddPartner сверяет, есть ли уже такой
   партнёр в справочнике. */
function promoPartnerEd(value, oninput, placeholder){
  var inp = '<input class="cell-in combo-input js-partner" value="' + value +
    '" placeholder="' + pmEsc(placeholder) + '" oninput="' + oninput + '" onkeydown="promoKey(event)">';
  var pop = '<div class="combo-pop"></div>';
  if (!promoCan('add')) return '<div class="combo">' + inp + pop + '</div>';
  return '<div class="combo combo-add">' + inp +
    '<button type="button" class="dict-add" title="' + pmT('Добавить партнёра в справочник') +
    '" aria-label="' + pmT('Добавить партнёра в справочник') + '" onclick="promoAddPartner(this)">+</button>' +
    pop + '</div>';
}

/* Короткое уведомление. Своего тоста в разделе нет, а alert на удачное действие —
   перебор: человек и так видит, что поле заполнилось и значение появилось в списке.
   Пишем в подвал формы заведения, когда она открыта; иначе молчим. */
function pmNote(msg){
  var box = document.querySelector('#promoNewPreview');
  if (!box) return;
  var el = document.createElement('div');
  el.className = 'np-ok';
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(function(){ if (el.parentElement) el.parentElement.removeChild(el); }, 2500);
}

/** Занести набранного партнёра в справочник и подставить обратно то, что вернул сервер. */
function promoAddPartner(btn){
  var inp = btn.parentElement.querySelector('input');
  var value = inp ? String(inp.value || '').trim() : '';
  if (!value){ alert(pmT('Сначала впишите партнёра.')); return; }
  var have = [...document.querySelectorAll('#promoPartnerList option')].map(function(o){ return o.value; });
  var same = have.filter(function(p){ return p.toLowerCase() === value.toLowerCase(); })[0];
  if (same){
    /* уже в справочнике — запрос не нужен, просто выравниваем написание */
    inp.value = same;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    pmNote(pmT('Партнёр уже в справочнике'));
    return;
  }
  if (!window.CRM || !CRM.dictAddPartner){ alert(pmT('Справочник недоступен.')); return; }
  btn.disabled = true;
  CRM.dictAddPartner(value).then(function(res){
    var saved = (res && res.name) || value;
    inp.value = saved;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    promoFillPartnerList();
    pmNote(pmT('Партнёр добавлен в справочник') + ': ' + saved);
  }).catch(function(e){
    alert(pmT('Не удалось добавить партнёра') + ': ' + ((e && e.message) || e));
  }).then(function(){ btn.disabled = false; });
}

/* Текущий справочник партнёров — то, чем наполняются combobox'ы в строках.
   Отдельной переменной, а не чтением <option> из datalist: список перерисовывается
   при каждой правке ячейки, и разбирать ради этого разметку незачем. */
var PROMO_PARTNER_OPTS = PROMO_PARTNERS.slice();

/* Привязать combobox'ы в только что вставленной разметке и раздать им справочник.
   Компонент сам ничего не находит: он цепляется к инпутам в момент вызова attach,
   а строки таблицы появляются позже — после каждой перерисовки. */
function promoBindCombos(root){
  if (!window.Combobox) return;
  Combobox.attach(root || document);
  Combobox.setOptionsFor('#sec-promo input.js-partner', PROMO_PARTNER_OPTS);
}

function promoRenderPartnerList(list){
  PROMO_PARTNER_OPTS = (list || []).slice();
  if (window.Combobox) Combobox.setOptionsFor('#sec-promo input.js-partner', PROMO_PARTNER_OPTS);
  var dl = document.getElementById('promoPartnerList');
  if (!dl) return;
  dl.innerHTML = (list || []).map(function(p){ return '<option value="' + pmAttr(p) + '">'; }).join('');
}
function promoFillPartnerList(){
  promoRenderPartnerList(PROMO_PARTNERS);
  if (!window.CRM || !CRM.dictPartners) return;
  CRM.dictPartners().then(function(list){
    if (Array.isArray(list) && list.length) promoRenderPartnerList(list);
  }).catch(function(){ /* справочник недоступен — остаётся зашитый список */ });
}

/* Первая загрузка плана с сервера; дальше раздел сам подтягивает чужие правки. */
promoFillPartnerList();
promoRender();
promoLoad();
promoAutoRefresh();

/* ---------- маршрут: /comms/promo и /comms/promo/archive ----------
   Архив — не фильтр, а вторая половина раздела: в нём другие строки и другие
   действия. Поэтому он в адресе, а поиск и фильтры — нет. */
if (window.Router) Router.register("sec-promo", {
  serialize: function(){ return PROMO_TAB === "archive" ? ["archive"] : []; },
  apply: function(rest){
    var tab = rest[0] === "archive" ? "archive" : "active";
    if (tab !== PROMO_TAB) promoSetTab(tab);
  }
});
