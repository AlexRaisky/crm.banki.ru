/* =========================================================
   ПЛАНИРОВАНИЕ ПРОМО — календарь промо-коммуникаций.
   Даты вынесены в строки-разделители (в конце строки «+»
   добавляет запись на эту дату). Каналы — множественный выбор,
   партнёры и продукты — из справочников CRM, «Название
   коммуникации» проверяется по правилам Конструктора source,
   «Задача» принимает ссылку или номер и показывается ссылкой.
   Правка ячейки подтверждается ✓ (или кликом мимо), Esc — отмена.
   Данные хранятся в localStorage.
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
/* канал коммуникации → часть source (см. Конструктор source) */
var PROMO_CHAN_SRC = { 'callcenter':'contact', 'sms':'sms', 'e-mail':'email', 'mobile-push':'mobile-push' };

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

/* ---------- исходные данные (июль–август 2026) ---------- */
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
var PROMO_COLS = 10;          /* колонок до кнопки «+» в строке-дате */
var PROMO_VER = 2;            /* версия схемы строк */
var PROMO_ROWS = [];
var PROMO_EDIT = null;        /* { i, k, v } — v это черновик правки */

function pmT(s){ return (typeof t === 'function') ? t(s) : s; }
function pmEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
function pmAttr(s){ return pmEsc(s); }

/* ---------- нормализация и миграция ---------- */

function promoNormChan(v){
  var list = Array.isArray(v) ? v.slice() : String(v || '').split(/[,;/]/);
  var out = [];
  list.map(function(c){ return String(c).trim().toLowerCase(); }).filter(Boolean).forEach(function(c){
    var mapped = PROMO_CHAN_ALIAS[c] || (PROMO_CHANNELS.indexOf(c) > -1 ? c : '');
    if (mapped && out.indexOf(mapped) === -1) out.push(mapped);
  });
  /* порядок всегда как в справочнике */
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
function promoMigrateRow(r){
  var o = {
    d: r.d || '',
    product: promoNormProduct(r.product),
    partner: r.partner || '',
    base: r.base || '',
    chan: promoNormChan(r.chan),
    total: !!r.total,
    name: '',
    task: r.task || '',
    owner: r.owner || '',
    status: r.status || '',
    note: r.note || ''
  };
  /* номер задачи вытаскиваем из комментария */
  if (!o.task){
    var key = promoTaskKey(o.note);
    if (key){
      o.task = key;
      /* если в комментарии была только ссылка — она больше не нужна */
      if (/^https?:\/\/\S+$/.test(o.note.trim())) o.note = '';
    }
  }
  /* прежнее «Название коммуникации» переезжает в комментарий:
     теперь название обязано соответствовать формату Конструктора source */
  var old = (r.name || '').trim();
  if (old) o.note = o.note ? (o.note + '; ' + old) : old;
  return o;
}
function promoSeedRows(){ return PROMO_SEED.map(promoMigrateRow); }

function promoLoad(){
  var raw = null, ver = 0;
  try {
    raw = localStorage.getItem('crmpanel:promoPlan');
    ver = parseInt(localStorage.getItem('crmpanel:promoPlanVer') || '0', 10) || 0;
  } catch(e){}
  if (!raw){ PROMO_ROWS = promoSeedRows(); promoSave(); return; }
  try {
    var rows = JSON.parse(raw);
    PROMO_ROWS = (ver >= PROMO_VER)
      ? rows.map(function(r){ r.chan = promoNormChan(r.chan); return r; })
      : rows.map(promoMigrateRow);
    if (ver < PROMO_VER) promoSave();
  } catch(e){ PROMO_ROWS = promoSeedRows(); promoSave(); }
}
function promoSave(){
  try {
    localStorage.setItem('crmpanel:promoPlan', JSON.stringify(PROMO_ROWS));
    localStorage.setItem('crmpanel:promoPlanVer', String(PROMO_VER));
  } catch(e){}
}
function promoReset(){
  if (!confirm(pmT('Сбросить таблицу к исходным данным?'))) return;
  PROMO_ROWS = promoSeedRows();
  PROMO_EDIT = null;
  promoSave(); promoRender();
}

/* ---------- формулы даты ---------- */
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

/* ---------- название коммуникации: правила Конструктора source ---------- */
var PROMO_NAME_HINT = 'канал_promo_продукт_партнёр_имя_ддммгг · канал_trigger_продукт_имя_Nday';

function promoNameCheck(v){
  v = String(v || '').trim();
  if (!v) return { ok: true, empty: true, msg: PROMO_NAME_HINT };
  var p = v.split('_');
  var codes = PROMO_PRODUCTS.map(function(x){ return x.code; });
  var chans = ['sms','mobile-push','email','contact'];
  if (chans.indexOf(p[0]) === -1)
    return { ok:false, msg: pmT('1-я часть — канал: sms, mobile-push, email или contact (для callcenter).') };
  if (p[1] !== 'promo' && p[1] !== 'trigger')
    return { ok:false, msg: pmT('2-я часть — тип кампании: promo или trigger.') };
  if (codes.indexOf(p[2]) === -1)
    return { ok:false, msg: pmT('3-я часть — код продукта из справочника, напр. creditcards.') };
  if (p[1] === 'promo'){
    if (p.length !== 6)
      return { ok:false, msg: pmT('Формат promo: канал_promo_продукт_партнёр_имя_ддммгг') };
    if (!p[3]) return { ok:false, msg: pmT('4-я часть — партнёр (или General / Digest).') };
    if (!p[4]) return { ok:false, msg: pmT('5-я часть — уникальное имя кампании.') };
    if (!/^\d{6}(day)?$/.test(p[5]))
      return { ok:false, msg: pmT('Последняя часть — дата ддммгг (для callcenter — ддммггday).') };
    if (p[0] === 'contact' && !/day$/.test(p[5]))
      return { ok:false, msg: pmT('Для contact дата заканчивается на day, напр. 180326day.') };
  } else {
    var need = (p[0] === 'contact') ? 6 : 5;
    if (p.length !== need)
      return { ok:false, msg: (p[0] === 'contact')
        ? pmT('Формат trigger для contact: contact_trigger_продукт_имя_сегмент_Nday')
        : pmT('Формат trigger: канал_trigger_продукт_имя_Nday') };
    if (!p[3]) return { ok:false, msg: pmT('4-я часть — уникальное имя кампании.') };
    if (need === 6 && !p[4]) return { ok:false, msg: pmT('5-я часть — сегмент.') };
    if (!/^\d+day$/.test(p[need - 1]))
      return { ok:false, msg: pmT('Последняя часть — Nday, напр. 3day.') };
  }
  return { ok:true, msg: pmT('Формат соответствует Конструктору source.') };
}
/* черновик названия из данных строки */
function promoNameSuggest(){
  if (!PROMO_EDIT || PROMO_EDIT.k !== 'name') return;
  var r = PROMO_ROWS[PROMO_EDIT.i];
  if (!r) return;
  var chan = '';
  (r.chan || []).some(function(c){ if (PROMO_CHAN_SRC[c]){ chan = PROMO_CHAN_SRC[c]; return true; } return false; });
  var first = (r.product || '').split(',')[0].trim();
  var prod = PROMO_PRODUCTS.filter(function(x){ return x.name === first; })[0];
  var p = (r.d || '').split('-');
  var date = p.length === 3 ? (p[2] + p[1] + p[0].slice(2)) : '';
  if (chan === 'contact' && date) date += 'day';
  var partner = (r.partner || 'General').trim().replace(/\s+/g, '-');
  var val = [chan || 'email', 'promo', prod ? prod.code : 'general', partner, 'nazvanie', date].join('_');
  PROMO_EDIT.v = val;
  promoRender();
}

/* ---------- фильтры ---------- */
function promoFillSelects(){
  var monthSel = document.getElementById('promoMonth');
  if (!monthSel) return;
  var prodSel = document.getElementById('promoProduct');
  var partSel = document.getElementById('promoPartner');
  var chanSel = document.getElementById('promoChannel');
  var ownSel = document.getElementById('promoOwner');

  var months = [], prods = [], partners = [], owners = [];
  PROMO_ROWS.forEach(function(r){
    var mk = promoMonthKey(r.d);
    if (mk && months.indexOf(mk) === -1) months.push(mk);
    (r.product || '').split(',').map(function(x){ return x.trim(); }).filter(Boolean)
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
  var q = ((document.getElementById('promoSearch') || {}).value || '').trim().toLowerCase();
  return PROMO_ROWS.map(function(r, i){ return { r: r, i: i }; }).filter(function(x){
    var r = x.r;
    if (mv && promoMonthKey(r.d) !== mv) return false;
    if (pv && (r.product || '').indexOf(pv) === -1) return false;
    if (rv && r.partner !== rv) return false;
    if (cv && (r.chan || []).indexOf(cv) === -1) return false;
    if (ov && r.owner !== ov) return false;
    if (q && [r.name, r.base, r.product, r.partner, r.task, r.note].join(' ').toLowerCase().indexOf(q) === -1) return false;
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
  var totals = rows.filter(function(x){ return x.r.total; }).length;
  var planned = rows.filter(function(x){ return (x.r.status || '') === 'запланировано'; }).length;
  var chans = {};
  rows.forEach(function(x){ (x.r.chan || []).forEach(function(c){ chans[c] = (chans[c] || 0) + 1; }); });
  var chanStr = PROMO_CHANNELS.filter(function(c){ return chans[c]; })
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

/* ---------- ячейки ---------- */
function promoIsEditing(i, k){ return !!(PROMO_EDIT && PROMO_EDIT.i === i && PROMO_EDIT.k === k); }
function promoActs(disabled){
  return '<div class="cell-act">' +
    '<button class="cell-ok" type="button" title="' + pmT('Сохранить') + '"' + (disabled ? ' disabled' : '') +
      ' onclick="promoCommit()">✓</button>' +
    '<button class="cell-no" type="button" title="' + pmT('Отмена') + '" onclick="promoCancel()">✕</button></div>';
}
function promoCell(x, k, html, editor, acts){
  if (promoIsEditing(x.i, k))
    return '<td class="c-' + k + ' cell-edit"><div class="ed">' + editor + (acts === false ? '' : promoActs(false)) + '</div></td>';
  return '<td class="c-' + k + ' editable" data-i="' + x.i + '" data-k="' + k + '">' + html + '</td>';
}
function promoChanCls(c){
  if (c === 'mobile-push') return 'push';
  if (c === 'callcenter') return 'cc';
  if (c === 'vk') return 'vk';
  if (c === 'fin-assistent') return 'fa';
  return '';
}

/* ---------- отрисовка ---------- */
function promoRender(){
  var body = document.getElementById('promoBody');
  if (!body) return;
  promoFillSelects();
  var rows = promoFiltered();
  promoRenderKpis(rows);

  if (!rows.length){
    body.innerHTML = '<tr><td colspan="' + (PROMO_COLS + 1) + '" style="text-align:center;padding:26px;color:var(--faint)">' +
      pmT('Нет строк по заданным фильтрам') + '</td></tr>';
    return;
  }

  var html = '', curDate = null;
  rows.forEach(function(x){
    var r = x.r;
    if (r.d !== curDate){
      curDate = r.d;
      html += '<tr class="date-row' + (promoIsWeekend(r.d) ? ' weekend' : '') + '">' +
        '<td class="date-cell" colspan="' + PROMO_COLS + '">' +
          '<span class="d-num">' + pmEsc(promoFmtDate(r.d)) + '</span>' +
          '<span class="d-dow">' + pmT(promoDow(r.d)) + '</span>' +
        '</td>' +
        '<td class="date-add"><button class="row-add" type="button" title="' + pmT('Добавить запись на эту дату') +
          '" onclick="promoAddRow(\'' + r.d + '\')">+</button></td></tr>';
    }
    html += promoRowHtml(x);
  });
  body.innerHTML = html;

  var focusEl = body.querySelector('.cell-in');
  if (focusEl && PROMO_EDIT){
    focusEl.focus();
    if (focusEl.setSelectionRange && focusEl.type !== 'date'){
      try { focusEl.setSelectionRange(focusEl.value.length, focusEl.value.length); } catch(e){}
    }
  }
  promoSyncName();
}

function promoRowHtml(x){
  var r = x.r, i = x.i;
  var draft = PROMO_EDIT && PROMO_EDIT.i === i ? PROMO_EDIT.v : null;

  /* продукт */
  var prodOpts = PROMO_PRODUCTS.map(function(p){ return p.name; });
  if (r.product && prodOpts.indexOf(r.product) === -1) prodOpts = [r.product].concat(prodOpts);
  var prodEd = '<select class="cell-in" onchange="promoDraft(this.value)">' +
    '<option value="">—</option>' +
    prodOpts.map(function(n){
      return '<option value="' + pmAttr(n) + '"' + (n === (draft != null ? draft : r.product) ? ' selected' : '') + '>' + pmEsc(n) + '</option>';
    }).join('') + '</select>';

  /* партнёр */
  var partEd = '<input class="cell-in" list="promoPartnerList" value="' + pmAttr(draft != null ? draft : r.partner) +
    '" placeholder="General" oninput="promoDraft(this.value)" onkeydown="promoKey(event)">';

  /* база — расширенный текст */
  var baseEd = '<textarea class="cell-in ta" rows="3" placeholder="' + pmT('Словесное описание базы') +
    '" oninput="promoDraft(this.value)" onkeydown="promoKey(event,true)">' + pmEsc(draft != null ? draft : r.base) + '</textarea>';

  /* каналы — множественный выбор */
  var chanSel = (draft != null ? draft : r.chan) || [];
  var chanEd = '<div class="ms">' + PROMO_CHANNELS.map(function(c){
    return '<label class="ms-i"><input type="checkbox"' + (chanSel.indexOf(c) > -1 ? ' checked' : '') +
      ' onchange="promoDraftChan(\'' + c + '\',this.checked)"><span class="chan ' + promoChanCls(c) + '">' + c + '</span></label>';
  }).join('') + '</div>';
  var chanHtml = (r.chan || []).map(function(c){
    return '<span class="chan ' + promoChanCls(c) + '">' + pmEsc(c) + '</span>';
  }).join('') || '—';

  /* название — формат Конструктора source */
  var nameVal = draft != null ? draft : r.name;
  var chk = promoNameCheck(nameVal);
  var nameEd = '<div class="name-ed">' +
    '<input class="cell-in mono' + (chk.ok ? '' : ' bad') + '" id="promoNameIn" value="' + pmAttr(nameVal) +
      '" placeholder="email_promo_creditcards_Alfa_nazvanie_160726" oninput="promoDraftName(this.value)" onkeydown="promoKey(event)">' +
    '<div class="name-hint' + (chk.ok ? '' : ' bad') + '" id="promoNameHint">' + pmEsc(chk.msg) + '</div>' +
    '<button class="mini" type="button" onclick="promoNameSuggest()">' + pmT('Собрать из строки') + '</button>' +
    '</div>';
  var nameHtml = r.name
    ? '<span class="src-name' + (promoNameCheck(r.name).ok ? '' : ' bad') + '">' + pmEsc(r.name) + '</span>'
    : '<span class="need">' + pmT('по формату source') + '</span>';

  /* задача */
  var taskEd = '<input class="cell-in" value="' + pmAttr(draft != null ? draft : r.task) +
    '" placeholder="CRM-8748 · ' + PROMO_JIRA_BASE + 'CRM-8748" oninput="promoDraft(this.value)" onkeydown="promoKey(event)">';
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

  return '<tr class="' + (r.total ? 'total-row' : '') + '">' +
    promoCell(x, 'product', pmEsc(r.product) || '—', prodEd) +
    promoCell(x, 'partner', pmEsc(r.partner) || '—', partEd) +
    promoCell(x, 'base', r.base ? '<span class="multi">' + pmEsc(r.base) + '</span>' : '—', baseEd) +
    promoCell(x, 'chan', chanHtml, chanEd) +
    '<td class="c-total"><input type="checkbox" ' + (r.total ? 'checked' : '') +
      ' onchange="promoSetTotal(' + i + ',this.checked)"></td>' +
    promoCell(x, 'name', nameHtml, nameEd) +
    promoCell(x, 'task', taskHtml, taskEd) +
    promoCell(x, 'owner', pmEsc(r.owner) || '—', ownerEd) +
    promoCell(x, 'status', '<span class="st ' + (r.status === 'запланировано' ? 'plan' : 'none') + '">' + (pmEsc(r.status) || '—') + '</span>', statusEd) +
    promoCell(x, 'note', r.note ? '<span class="multi">' + pmEsc(r.note) + '</span>' : '—', noteEd) +
    '<td><button class="row-del" type="button" title="' + pmT('Удалить строку') + '" onclick="promoDelRow(' + i + ')">×</button></td>' +
  '</tr>';
}

/* ---------- правка ---------- */
function promoEdit(i, k){
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
function promoDraftName(v){
  if (PROMO_EDIT) PROMO_EDIT.v = v;
  promoSyncName();
}
/* подсказка и доступность ✓ для названия — без перерисовки, чтобы не терять фокус */
function promoSyncName(){
  if (!PROMO_EDIT || PROMO_EDIT.k !== 'name') return;
  var inp = document.getElementById('promoNameIn');
  var hint = document.getElementById('promoNameHint');
  if (!inp || !hint) return;
  var chk = promoNameCheck(PROMO_EDIT.v);
  inp.classList.toggle('bad', !chk.ok);
  hint.classList.toggle('bad', !chk.ok);
  hint.textContent = chk.msg;
  var ok = inp.closest('.ed') ? inp.closest('.ed').querySelector('.cell-ok') : null;
  if (ok) ok.disabled = !chk.ok;
}
function promoKey(e, multiline){
  if (e.key === 'Escape'){ e.preventDefault(); promoCancel(); return; }
  if (e.key === 'Enter' && !(multiline && !e.ctrlKey)){ e.preventDefault(); promoCommit(); }
}
function promoCommit(){
  if (!PROMO_EDIT){ return; }
  var e = PROMO_EDIT, r = PROMO_ROWS[e.i];
  if (r){
    var v = e.v;
    if (e.k === 'name'){
      v = String(v || '').trim();
      if (!promoNameCheck(v).ok){ promoSyncName(); return; }   /* формат обязателен */
    }
    if (e.k === 'task') v = promoTaskKey(v) || String(v || '').trim();
    if (e.k === 'chan') v = promoNormChan(v);
    if (typeof v === 'string' && e.k !== 'base' && e.k !== 'note') v = v.trim();
    r[e.k] = v;
  }
  PROMO_EDIT = null;
  promoSave(); promoRender();
}
function promoCancel(){ PROMO_EDIT = null; promoRender(); }
function promoSetTotal(i, on){
  if (!PROMO_ROWS[i]) return;
  PROMO_ROWS[i].total = !!on;
  promoSave(); promoRender();
}
function promoAddRow(iso){
  var d = iso || new Date().toISOString().slice(0, 10);
  PROMO_ROWS.push({ d: d, product:'', partner:'', base:'', chan:[], total:false,
                    name:'', task:'', owner:'', status:'', note:'' });
  PROMO_EDIT = null;
  promoSave(); promoRender();
}
function promoDelRow(i){
  if (!confirm(pmT('Удалить строку?'))) return;
  PROMO_ROWS.splice(i, 1);
  PROMO_EDIT = null;
  promoSave(); promoRender();
}

/* клик мимо ячейки = сохранить; клик по другой ячейке сразу открывает её */
document.addEventListener('mousedown', function(e){
  if (!PROMO_EDIT) return;
  var t0 = e.target;
  if (t0.closest && t0.closest('.cell-edit')) return;
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
  var head = ['Дата','День недели','Продукт','Партнёр','База','Канал','Тотал',
              'Название коммуникации','Задача','Ответственный','Статус','Комментарий'];
  var rows = promoFiltered().map(function(x){
    var r = x.r;
    var key = promoTaskKey(r.task);
    return [promoFmtDate(r.d), promoDow(r.d), r.product, r.partner, r.base,
            (r.chan || []).join(', '), r.total ? 'TRUE' : 'FALSE', r.name,
            key ? PROMO_JIRA_BASE + key : '', r.owner, r.status, r.note];
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

promoLoad();
promoFillPartnerList();
promoRender();
