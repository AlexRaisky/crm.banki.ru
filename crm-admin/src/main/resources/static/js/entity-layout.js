/* =========================================================
   РАСКЛАДКА КАРТОЧКИ СУЩНОСТИ — общий модуль.

   Один и тот же расчёт нужен в двух местах: пользовательская панель
   рисует по нему карточку записи (js/entities.js), настроечная админка
   по нему же строит редактор («Сущности» → настройка полей,
   settings/object-manager.js). Поэтому логика вынесена сюда, а не
   продублирована — иначе настройка и отображение разъезжаются.

   ЧТО ХРАНИТСЯ В СХЕМЕ. Пользовательские настройки лежат внутри самой
   сущности (schema/crm-schema.json → entity.layout) и потому едут вместе
   со схемой в Git, а позже — в БД:

     entity.technical = true            — служебная сущность, в панели не показывается
     entity.layout = {
       blocks: ["Основное", …],         — порядок и состав блоков карточки
       block:  { <поле>: "<блок>" },    — в каком блоке показывать поле
       header: [ <поле>, … ],           — поля в верхней строке карточки
       hidden: [ <поле>, … ]            — поля, скрытые из карточки
     }

   Всё, что не настроено явно, раскладывается по умолчанию (DEFAULTS для
   известных сущностей плюс автоправило autoBlock) — поэтому сущность,
   заведённая в Scheme Builder, сразу выглядит осмысленно, а поле,
   добавленное позже, не теряется.
   ========================================================= */
(function(global){
"use strict";

/* Списки полей ниже задают ТОЛЬКО принадлежность блоку. Порядок полей внутри
   блока берётся из самой сущности (entity.fields) — так его можно менять
   стрелками в настройке и в Scheme Builder, не правя этот файл. Пример, где
   порядок значим: у клиента «Адреса совпадают» стоит в схеме перед фактическим
   адресом, потому что фактический адрес показывается по результату галочки. */

/* Полный список блоков — из него собирается выпадающий список в настройке.
   Порядок важен: в этом же порядке блоки идут в карточке. */
var BLOCKS = [
  "Основное", "Персональные данные", "Профиль клиента", "Документы", "Адреса",
  "Согласия", "Стоп-листы каналов", "Доход и скоринг", "Самозапрет на кредиты",
  "Реквизиты", "Доступность", "Тип токена", "Конфигурация", "Источник и сегментация",
  "Контент и ссылки", "Финансовый ассистент", "VK", "Live Activity",
  "Связи", "Флаги", "Показатели", "Служебные"
];
var SYSTEM_BLOCK = "Служебные";

/* Раскладка по умолчанию для сущностей исходной схемы. Идентификаторы
   намеренно уведены в «Служебные»: в шапке карточки достаточно одного
   рабочего ID (у клиента — ID личного кабинета, см. HEADER). */
var DEFAULTS = {
  record_type: [
    ["Основное",     ["name","code","entity_name","is_active"]],
    ["Конфигурация", ["fields_config"]],
    ["Служебные",    ["id"]]
  ],
  lead: [
    ["Основное",            ["status"]],
    ["Персональные данные", ["first_name","second_name","last_name"]],
    ["Профиль клиента",     ["has_children","has_real_estate","has_pets","has_car"]],
    ["Связи",               ["client_id","work_ids","contact_info"]],
    ["Служебные",           ["id","myb_id","create_ts","update_ts","user_create","user_update"]]
  ],
  client: [
    ["Персональные данные", ["first_name","second_name","last_name"]],
    ["Профиль клиента",     ["has_children","has_real_estate","has_pets","has_car"]],
    ["Документы",           ["passport_series","passport_number","passport_issued_by","passport_issue_date",
                             "passport_department_code","inn","snils","driver_license_series",
                             "driver_license_number","driver_license_issue_date"]],
    ["Адреса",              ["registration_address","address_is_equal","actual_address_of_residence"]],
    ["Согласия",            ["personal_data","advertisement","bank_credit_history","esia","marketplace"]],
    ["Стоп-листы каналов",  ["blacklist_callcenter","blacklist_sms","blacklist_email",
                             "blacklist_mobile_push","blacklist_vk","blacklist_finassistant"]],
    ["Доход и скоринг",     ["monthly_income","credit_score_banki","mfo_credit_score_banki","credit_score_okb",
                             "mfo_credit_score_okb","credit_score_scoring_bureau",
                             "mfo_credit_score_scoring_bureau","credit_score_nbki","application_score"]],
    ["Самозапрет на кредиты",["has_credit_self_ban","credit_self_ban_start_date","credit_self_ban_condition"]],
    ["Связи",               ["work_ids","contact_info"]],
    ["Служебные",           ["id","main_myb_id","user_id","person_id",
                             "create_ts","update_ts","user_create","user_update"]]
  ],
  client_contact_info: [
    ["Основное",    ["type","value"]],
    /* блок показывается только у токенов мобильного приложения — правило в
       ENT_SHOW_IF (js/entities.js); для остальных типов контакта он не имеет смысла */
    ["Тип токена",  ["token_type","delivery_platform","platform_token","os","app_version"]],
    ["Доступность", ["status","double_opt_in","score"]],
    ["Связи",       ["client_id","lead_id"]],
    ["Служебные",   ["id","create_ts","update_ts","user_create","user_update"]]
  ],
  work: [
    ["Основное",  ["record_type_id","organization_name","position","start_date"]],
    ["Реквизиты", ["inn","ogrn"]],
    ["Адреса",    ["legal_address","actual_address"]],
    ["Служебные", ["id","create_ts","update_ts","user_create","user_update"]]
  ],
  /* «Шаблоны и сегменты» показываются готовым экраном (список шаблонов), поэтому
     раскладка нужна не для карточки, а чтобы объект читался в настройках */
  template: [
    ["Основное",          ["communication_name","channel","code","active","trigger_type",
                           "product_type","partner_name","touch_point"]],
    ["Источник и сегментация", ["source_type","letteros_id","communication_type",
                           "business_communication_type","source_system","aff_sub3",
                           "segment","segment_descr","sending_day","host_id","kvint_campaign_id"]],
    ["Контент и ссылки",  ["title","msg_text","subject","sender_name","email_from",
                           "deep_link","webview_url"]],
    ["Флаги",             ["service_flag","info_flag","marketplace","dialog","loyalty",
                           "national_rating","news","mobile_app","night_send"]],
    ["Финансовый ассистент", ["fa_id","channel_id","need_push","c2d_transport","c2d_account",
                           "ch2d_operator_id","web_url","link_title","action_buttons"]],
    ["VK",                ["vk_template_name","ttl","ab_group","buttons"]],
    ["Live Activity",     ["activity_name","la_event","la_visualization",
                           "la_visualization_attributes","la_status","current_step"]]
  ]
};
/* Поля, которые показываются под названием записи («подсвеченные», как highlights
   panel в Salesforce). Набор настраивается в админке; здесь — умолчания, чтобы
   блок не пустовал у сущностей, которых ещё не настраивали. */
var HEADER = {
  client:              ["user_id"],
  lead:                ["status", "client_id"],
  client_contact_info: ["type", "status"],
  work:                ["record_type_id", "start_date"],
  record_type:         ["entity_name", "is_active"]
};

var REL_UI = ["lookup","multilookup","related_list"];
function isRelation(f){ return REL_UI.indexOf(f.ui_type) >= 0; }
/* идентификатор — «id» или «*_id», который НЕ является связью (иначе это lookup) */
function isIdField(f){ return f.name === "id" || (/_id$/.test(f.name) && !isRelation(f)); }

/* куда положить поле, про которое настройки нет */
function autoBlock(f){
  if (isIdField(f) || /_ts$/.test(f.name) || f.name === "user_create" || f.name === "user_update") return SYSTEM_BLOCK;
  if (isRelation(f)) return "Связи";
  if (f.ui_type === "checkbox") return "Флаги";
  if (f.ui_type === "currency" || f.ui_type === "percent") return "Показатели";
  return "Основное";
}

/* раскладка по умолчанию: { blocks:[…], block:{поле:блок}, header:[…], hidden:[] } */
function defaults(e){
  var spec = DEFAULTS[e.id] || [], blocks = [], block = {}, known = {};
  (e.fields || []).forEach(function(f){ known[f.name] = 1; });
  spec.forEach(function(g){
    var used = g[1].filter(function(n){ return known[n]; });
    if (!used.length) return;
    if (blocks.indexOf(g[0]) < 0) blocks.push(g[0]);
    used.forEach(function(n){ block[n] = g[0]; });
  });
  (e.fields || []).forEach(function(f){
    if (block[f.name]) return;
    var t = autoBlock(f);
    block[f.name] = t;
    if (blocks.indexOf(t) < 0) blocks.push(t);
  });
  return { blocks: blocks, block: block, header: (HEADER[e.id] || []).filter(function(n){ return known[n]; }), hidden: [] };
}

/* Итоговая раскладка: настройки сущности поверх умолчаний.
   Возвращает готовые к отрисовке блоки (пустые отброшены), поля шапки
   и служебную часть — её использует редактор в настройках. */
function resolve(e){
  var d = defaults(e), L = (e && e.layout) || {};
  var block  = Object.assign({}, d.block, L.block || {});
  var titles = (Array.isArray(L.blocks) && L.blocks.length) ? L.blocks.slice() : d.blocks.slice();
  var hidden = Array.isArray(L.hidden) ? L.hidden.slice() : d.hidden.slice();
  var header = Array.isArray(L.header) ? L.header.slice() : d.header.slice();

  var bag = {};
  titles.forEach(function(t){ bag[t] = []; });
  (e.fields || []).forEach(function(f){
    if (hidden.indexOf(f.name) >= 0) return;
    var t = block[f.name] || autoBlock(f);
    if (!bag[t]) { bag[t] = []; titles.push(t); }
    bag[t].push(f);
  });
  var blocks = titles.map(function(t){ return { title:t, fields: bag[t] || [] }; })
                     .filter(function(b){ return b.fields.length; });
  /* «Служебные» — всегда последним блоком, как ни настраивай порядок */
  blocks = blocks.filter(function(b){ return b.title !== SYSTEM_BLOCK; })
          .concat(blocks.filter(function(b){ return b.title === SYSTEM_BLOCK; }));

  var byName = {};
  (e.fields || []).forEach(function(f){ byName[f.name] = f; });
  return {
    blocks: blocks,
    header: header.map(function(n){ return byName[n]; }).filter(Boolean),
    hidden: hidden,
    block: block,
    titles: titles
  };
}

/* ============================================================
   Отображение карточки записи: вкладки, распределение блоков по ним,
   число колонок и правая колонка связанных объектов.

   Хранится там же, в сущности: entity.layout.card = {
     columns: 1 | 2 | 3,                   — колонок в блоке полей
     rail: true | false,                   — показывать колонку связанных объектов
     railItems: [<поле related_list>, …],  — какие именно (отсутствует = все)
     tabs: [ {id, label} … ],              — вкладки карточки
     blocks: { "<блок>": { hidden, tab, collapsed } }
   }

   Шапка записи (тип объекта, название, «подсвеченные» поля) настройке не
   подлежит: без неё карточка теряет опознавательность, поэтому она есть
   всегда и выключателя у неё нет.
   ============================================================ */
var CARD_TABS = [ { id:"details", label:"Детали" }, { id:"comms", label:"Коммуникации" } ];
function cardConfig(e){
  var c = ((e && e.layout) || {}).card || {};
  var cols = Number(c.columns);
  var tabs = (Array.isArray(c.tabs) && c.tabs.length) ? c.tabs.slice() : CARD_TABS.map(function(t){ return { id:t.id, label:t.label }; });
  /* «Детали» — вкладка по умолчанию: на неё падают блоки без явной привязки,
     поэтому убрать её из списка нельзя */
  if (!tabs.some(function(t){ return t.id === "details"; })) tabs.unshift({ id:"details", label:"Детали" });
  return {
    columns: (cols === 1 || cols === 2 || cols === 3) ? cols : 2,
    rail: c.rail === undefined ? true : !!c.rail,
    railItems: Array.isArray(c.railItems) ? c.railItems.slice() : null,   /* null = все */
    tabs: tabs,
    blocks: c.blocks || {}
  };
}
/* настройки конкретного блока карточки */
function blockConfig(e, title){
  var b = cardConfig(e).blocks[title] || {};
  return { hidden: !!b.hidden, tab: b.tab || "details", collapsed: !!b.collapsed };
}

/* список блоков для выпадающего списка в настройке: стандартные + уже использованные */
function blockChoices(e){
  var r = resolve(e), out = BLOCKS.slice();
  r.titles.concat(Object.keys(r.block).map(function(k){ return r.block[k]; }))
    .forEach(function(t){ if (t && out.indexOf(t) < 0) out.push(t); });
  return out;
}

/* ============================================================
   Черновик поверх файла схемы.

   Правки Scheme Builder копятся черновиком в localStorage, а сама схема
   едет в репозитории. Если черновик просто подменять файлом, сущность,
   добавленная в файл позже, не увидит никто, кто хоть раз открывал
   конструктор: его черновик снят раньше и про неё не знает. Именно так
   пропали «Шаблоны и сегменты».

   Поэтому черновик накладывается НА файл: всё, что пользователь правил,
   выигрывает, а сущности и связи, появившиеся в файле после снятия
   черновика, доливаются. Удалённые вручную не возвращаются — Scheme
   Builder помечает их в model.deleted.

   Правило должно быть одинаковым в панели и в админке, иначе они
   разойдутся в том, какие сущности вообще существуют, — поэтому оно
   лежит здесь, в общем модуле, а не продублировано в двух местах.
   ============================================================ */
function clone(x){ return JSON.parse(JSON.stringify(x)); }
function mergeDraft(base, draft){
  if (!draft || !Array.isArray(draft.entities)) return base || draft || null;
  if (!base  || !Array.isArray(base.entities))  return draft;

  var out = clone(draft);
  if (!Array.isArray(out.relations)) out.relations = [];
  var dropped = Array.isArray(out.deleted) ? out.deleted : [];
  var have = {};
  out.entities.forEach(function(e){ have[e.id] = 1; });

  base.entities.forEach(function(e){
    if (have[e.id] || dropped.indexOf(e.id) >= 0) return;
    out.entities.push(clone(e));
    have[e.id] = 1;
  });

  /* связи новой сущности: добавляем только те, у которых оба конца на месте */
  var relHave = {};
  out.relations.forEach(function(r){ relHave[r.id] = 1; });
  base.relations && base.relations.forEach(function(r){
    if (relHave[r.id]) return;
    if (!have[r.from_entity] || !have[r.to_entity]) return;
    out.relations.push(clone(r));
  });

  out.version = base.version || out.version;
  return out;
}

global.EntityLayout = {
  BLOCKS: BLOCKS, SYSTEM_BLOCK: SYSTEM_BLOCK,
  defaults: defaults, resolve: resolve, autoBlock: autoBlock,
  blockChoices: blockChoices, isIdField: isIdField, isRelation: isRelation,
  mergeDraft: mergeDraft, cardConfig: cardConfig, blockConfig: blockConfig,
  CARD_TABS: CARD_TABS
};
})(window);
