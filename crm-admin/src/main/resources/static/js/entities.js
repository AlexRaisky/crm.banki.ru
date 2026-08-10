/* =========================================================
   СУЩНОСТИ — данные CRM по схеме из Scheme Builder.

   ОТКУДА БЕРУТСЯ ПОДРАЗДЕЛЫ. Источник истины — та же схема, что и у
   Scheme Builder, и лежит она на сервере: GET /api/schema (app.schema_model).
   Если сервера нет (страница открыта статикой), читается запасной путь —
   файл settings/schema/crm-schema.json плюс черновик в localStorage.
   Каждая сущность схемы
   автоматически становится подразделом раздела «Сущности»: список
   строится в entSyncNav() при загрузке и переcтраивается по событию
   storage — то есть заведённая в Scheme Builder сущность появляется
   в панели без перезагрузки страницы.

   ДОСТУП. Раздел и все его подразделы помечены adminOnly: их видит
   только роль ADMIN. Для выдачи доступа другим ролям заведён реестр
   crmpanel:entityAccess = { <entity>: [роли…] }; новая сущность
   попадает туда с пустым списком, то есть по умолчанию доступа нет
   ни у кого, кроме администраторов (см. entAllowed).

   ДАННЫЕ. Записи лежат в crmpanel:entityData = { <entity>: [записи…] };
   стартовый набор (по три записи на сущность с разными вариантами
   связок) заводит entSeed(). Правка поля сохраняется сразу. Когда
   появится бэкенд, заменяются только entLoadData/entStore — разметка
   и правка на это не завязаны.
   ========================================================= */

var ENT_FILE      = "settings/schema/crm-schema.json";
var ENT_DRAFT_KEY = "crmpanel:schemaDraft";
var ENT_DATA_KEY  = "crmpanel:entityData";
var ENT_SEED_KEY  = "crmpanel:entityDataSeed";
var ENT_ACL_KEY   = "crmpanel:entityAccess";
var ENT_SEED_VER  = 1;

var ENT_MODEL = { entities: [], relations: [] };
var ENT_DATA  = {};
/* какой подраздел был открыт в прошлый раз: boot.js восстанавливает раздел
   раньше, чем догрузится схема, и без этого «Сущности» открывались обзором */
var ENT_WANT = (function(){
  try { var v = JSON.parse(localStorage.getItem("crmpanel:lastSection"));
        return (v && v.sid === "entities" && v.cid) ? v.cid : null; } catch(e){ return null; }
})();
/* mode — список записей или карточка одной записи; tab — вкладка карточки;
   q / fv / sort — состояние списка (поиск, значения фильтров, сортировка по сущностям) */
/* id — открытая ТАБЛИЦА, schema — сущность, которой она принадлежит.
   mode: tables (список таблиц сущности) → list (записи таблицы) → card (запись). */
var ENT_CUR = { id:null, schema:null, rec:null, edit:null, closed:{},
                mode:"tables", tab:"details", q:"", fv:{}, sort:{}, gear:false };

var ENT_REL_UI = ["lookup","multilookup","related_list"];

function entEsc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(m){
    return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[m];
  });
}
function entT(s){ return (typeof t === "function") ? t(s) : s; }
function entEn(){ return typeof UI_LANG !== "undefined" && UI_LANG === "en"; }
/* «1 поле / 3 поля / 53 поля / 11 полей» — без склонения счётчики выглядят неряшливо */
var ENT_PLURAL = {
  field:  { en:["field","fields"],       ru:["поле","поля","полей"] },
  record: { en:["record","records"],     ru:["запись","записи","записей"] },
  rel:    { en:["relation","relations"], ru:["связь","связи","связей"] },
  table:  { en:["table","tables"],       ru:["таблица","таблицы","таблиц"] }
};
function entPlural(n, kind){
  var f = ENT_PLURAL[kind];
  if (entEn()) return n + " " + f.en[n === 1 ? 0 : 1];
  var d10 = n % 10, d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return n + " " + f.ru[0];
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return n + " " + f.ru[1];
  return n + " " + f.ru[2];
}

/* ---------- хранилище ---------- */
function entRead(key, def){
  try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch(e){ return def; }
}
function entWrite(key, val){
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch(e){ return false; }
}
function entStore(){ entWrite(ENT_DATA_KEY, ENT_DATA); }
function entRows(id){ return ENT_DATA[id] || (ENT_DATA[id] = []); }

/* ---------- доступ ----------
   Админ видит всё. Остальным роль должна быть явно выдана в реестре
   crmpanel:entityAccess — по умолчанию он пустой, то есть доступа нет.
   Пока бэкенда нет (/api/me недоступен на GitHub Pages), раздел работает
   в демо-режиме — так же ведёт себя applyNavAcl в api.js. */
function entAcl(){ return entRead(ENT_ACL_KEY, {}) || {}; }
function entAclSeed(){
  var acl = entAcl(), changed = false;
  ENT_MODEL.entities.forEach(function(e){
    if (!Array.isArray(acl[e.id])) { acl[e.id] = []; changed = true; }
  });
  if (changed) entWrite(ENT_ACL_KEY, acl);
}
/* Схема, которой принадлежит строка модели. Правило общее со Scheme Builder:
   поле schema, а у одноуровневых записей (заведённых до разделения) — сам id. */
function entSchemaOf(e){ return (e && e.schema) || (e && e.id) || ""; }

/* Строка модели представляет СУЩНОСТЬ, а не просто одну из её таблиц?
   <p>
   Модель двухуровневая: entities[] — это таблицы, а сущность это их схема. Раздел
   же показывает сущности, поэтому от каждой схемы берём ровно одну строку — ту,
   что схему и представляет: её имя совпадает с именем схемы. Без этого вторая
   таблица схемы становилась отдельным подразделом наравне с «Клиентами»: так
   пробная record_type.test и превратилась в раздел панели.
   <p>
   Если таблицы с именем схемы нет вовсе, представителем становится первая по
   порядку — иначе схема пропала бы из раздела целиком. */
function entSchemaHead(schemaId){
  var first = null;
  for (var i = 0; i < ENT_MODEL.entities.length; i++){
    var x = ENT_MODEL.entities[i];
    if (entSchemaOf(x) !== schemaId) continue;
    if (x.id === schemaId) return x;
    if (!first) first = x;
  }
  return first;
}
function entIsSchemaHead(e){ return entSchemaHead(entSchemaOf(e)) === e; }

/* Таблицы сущности — то, что показывает экран между карточкой сущности и данными.
   Технические не показываем и здесь: флаг ровно об этом и говорит. */
function entTables(schemaId){
  return ENT_MODEL.entities.filter(function(x){
    return entSchemaOf(x) === schemaId && !x.technical;
  });
}

/* Связующие таблицы many-to-many. В entities[] их нет и быть не должно: они
   рождаются из связи, а не заводятся руками, — но в базе они есть, и без них
   экран таблиц врал бы. Правило повторяет планировщик (DdlPlanner): имя берётся
   из through, иначе <таблица слева>_<таблица справа>_link, а лежит таблица в
   схеме ЛЕВОЙ сущности — «посередине» в Postgres не бывает.
   Записи в них не показываем: это пары идентификаторов, и смотреть их надо со
   стороны той сущности, чью связь они хранят. */
function entLinkTables(schemaId){
  var out = [];
  (ENT_MODEL.relations || []).forEach(function(r){
    if (r.relation_type !== "many_to_many") return;
    var fe = entEntity(r.from_entity), te = entEntity(r.to_entity);
    if (!fe || !te || entSchemaOf(fe) !== schemaId) return;
    out.push({
      table: r.through || ((fe.table || fe.id) + "_" + (te.table || te.id) + "_link"),
      from: fe, to: te
    });
  });
  return out;
}

function entAllowed(e){
  /* техническая сущность (флаг ставится в настройках) в панели не показывается
     вообще: это служебный справочник, работать с ним нужно в схеме, а не здесь */
  if (e.technical) return false;
  if (!entIsSchemaHead(e)) return false;
  /* сущность с готовым серверным экраном («Шаблоны и сегменты») гейтится обычным
     RBAC по своей секции — applyNavAcl сделает это по aclSection, реестр не при чём */
  if (e.source) return true;
  var me = window.CRM_ME;
  if (!me) return true;                       /* демо-режим без бэкенда */
  if (me.isAdmin) return true;
  var roles = entAcl()[e.id];
  return Array.isArray(roles) && roles.indexOf(me.role) >= 0;
}
/* точка выдачи доступа не-админам: entAccessSet('client', ['MARKETER']) */
function entAccessSet(entityId, roles){
  var acl = entAcl();
  acl[entityId] = Array.isArray(roles) ? roles : [];
  entWrite(ENT_ACL_KEY, acl);
  entSyncNav();
}

/* ---------- схема ---------- */
function entEntity(id){
  for (var i = 0; i < ENT_MODEL.entities.length; i++) if (ENT_MODEL.entities[i].id === id) return ENT_MODEL.entities[i];
  return null;
}
function entField(e, name){
  if (!e) return null;
  for (var i = 0; i < e.fields.length; i++) if (e.fields[i].name === name) return e.fields[i];
  return null;
}
function entLoadSchema(){
  /* Источник истины — сервер (app.schema_model): Scheme Builder сохраняет схему туда.
     Пока конструктор писал черновик в localStorage, раздел читал файл и накладывал
     черновик сверху; после переезда конструктора на сервер эта связь оборвалась —
     правки в конструкторе до раздела не доходили. Поэтому сначала спрашиваем сервер.

     Черновик при удачном ответе НЕ накладываем: он остался от прежней схемы работы,
     и наложение воскресило бы устаревшее поверх актуального.

     Раздел админский (adminOnly в NAV), а /api/schema под ADMIN — права совпадают. */
  return fetch("/api/schema", { credentials:"same-origin" })
    .then(function(r){ if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function(m){
      if (!m || !Array.isArray(m.entities)) throw new Error("пустой ответ");
      return m;
    })
    .catch(function(e){
      if (typeof console !== "undefined") console.warn("Сущности: схема с сервера недоступна, читаем файл —", e);
      return entLoadSchemaFromFile();
    });
}

/* Запасной путь: файл в репозитории плюс черновик конструктора — прежнее поведение.
   Нужен там, где сервера нет вовсе (страница открыта статикой, GitHub Pages). */
function entLoadSchemaFromFile(){
  /* Черновик накладывается НА файл, а не подменяет его: иначе сущность, добавленная
     в файл позже, не появилась бы ни у кого, кто хоть раз открывал конструктор.
     Правило общее с настроечной админкой — EntityLayout.mergeDraft. */
  var draft = entRead(ENT_DRAFT_KEY, null);
  return fetch(ENT_FILE + "?v=" + Date.now(), { cache:"no-store" })
    .then(function(r){ if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function(base){
      return (window.EntityLayout && EntityLayout.mergeDraft)
        ? EntityLayout.mergeDraft(base, draft) : (draft && draft.entities ? draft : base);
    })
    .catch(function(){
      /* файла тоже нет — работаем хотя бы по черновику */
      return (draft && draft.entities) ? draft : { version:"0", entities:[], relations:[] };
    });
}

/* ---------- блоки полей «по смыслу» ----------
   Раскладка (какие блоки, что в них, что в шапке, что скрыто) считается
   общим модулем js/entity-layout.js: по нему же строится редактор в
   настроечной админке («Сущности»), поэтому настройка и отображение
   не могут разъехаться. Поля, для которых настройки нет (в том числе
   добавленные позже в Scheme Builder), раскладываются автоматически —
   сущность не «теряет» новые поля. */
function entLayout(e){
  return (window.EntityLayout ? EntityLayout.resolve(e)
    : { blocks:[{ title:"Основное", fields:e.fields }], header:[], hidden:[], block:{}, titles:["Основное"] });
}

/* ---------- зависимые поля ----------
   Фактический адрес показываем только после того, как заполнен адрес
   регистрации: до этого поле бессмысленно. Если стоит «Адреса совпадают»,
   значение подтягивается из адреса регистрации и не редактируется —
   иначе поле обычное. */
var ENT_MIRROR = {
  client: { actual_address_of_residence: { flag:"address_is_equal", from:"registration_address" } }
};
/* Поля, осмысленные только при определённом значении другого поля. Условий может
   быть несколько — тогда они проверяются по И. Пустой блок не рисуется вовсе,
   поэтому «Тип токена» появляется целиком и только у токенов приложения, а
   «Токен платформы доставки» — ещё и только когда доставка идёт через платформу. */
var ENT_SHOW_IF = {
  client_contact_info: {
    token_type:        { field:"type", values:["mobile_token"] },
    delivery_platform: { field:"type", values:["mobile_token"] },
    platform_token:   [{ field:"type", values:["mobile_token"] },
                       { field:"delivery_platform", values:["appmetrica"] }],
    os:                { field:"type", values:["mobile_token"] },
    app_version:       { field:"type", values:["mobile_token"] }
  }
};
/* Условная обязательность: поле обязательно не всегда, а при определённом
   значении другого. Формат тот же, что у ENT_SHOW_IF, — одно условие или
   несколько по И. Токен платформы обязателен, когда доставка идёт через
   платформу: без него отправить в неё нечего. */
var ENT_REQUIRE_IF = {
  client_contact_info: {
    platform_token: [{ field:"type", values:["mobile_token"] },
                     { field:"delivery_platform", values:["appmetrica"] }]
  }
};
function entRequireIf(e, name){
  var v = (ENT_REQUIRE_IF[e.id] || {})[name];
  if (!v) return null;
  return Array.isArray(v) ? v : [v];
}
/* обязательно ли поле для ЭТОЙ записи: своя пометка в схеме плюс условие */
function entRequired(e, f, r){
  if (f.required) return true;
  var rule = entRequireIf(e, f.name);
  if (!rule || !r) return false;
  return rule.every(function(c){
    return c.values.indexOf(String(r[c.field] == null ? "" : r[c.field])) >= 0;
  });
}
function entIsEmpty(v){
  return v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
}
function entMirrorRule(e, name){ return (ENT_MIRROR[e.id] || {})[name] || null; }
function entShowIf(e, name){
  var v = (ENT_SHOW_IF[e.id] || {})[name];
  if (!v) return null;
  return Array.isArray(v) ? v : [v];
}
/* управляет ли поле показом других — от этого зависит перерисовка формы заведения */
function entControls(e, name){
  var rules = ENT_SHOW_IF[e.id] || {}, mir = ENT_MIRROR[e.id] || {};
  var hit = Object.keys(rules).some(function(k){
    var v = rules[k], list = Array.isArray(v) ? v : [v];
    return list.some(function(c){ return c.field === name; });
  });
  if (hit) return true;
  return Object.keys(mir).some(function(k){ return mir[k].flag === name || mir[k].from === name; });
}
/* состояние зависимого поля для текущей записи */
function entFieldState(e, f, r){
  var show = entShowIf(e, f.name);
  if (show && !show.every(function(c){
        return c.values.indexOf(String(r[c.field] == null ? "" : r[c.field])) >= 0;
      }))
    return { hidden:true, mirrored:false };
  var rule = entMirrorRule(e, f.name);
  if (!rule) return { hidden:false, mirrored:false };
  var src = r[rule.from];
  if (src === undefined || src === null || src === "") return { hidden:true, mirrored:false };
  return { hidden:false, mirrored: r[rule.flag] === true || r[rule.flag] === "true", rule:rule };
}
/* синхронизация значения: зовём после каждой правки и при заведении записи */
function entApplyMirror(e, r){
  var rules = ENT_MIRROR[e.id];
  if (!rules) return false;
  var changed = false;
  Object.keys(rules).forEach(function(name){
    var rule = rules[name];
    if (r[rule.flag] === true || r[rule.flag] === "true"){
      if (r[name] !== r[rule.from]) { r[name] = r[rule.from]; changed = true; }
    }
  });
  return changed;
}

/* ---------- отображение значений ---------- */
function entTitle(e, r){
  if (!r) return "";
  if (e.title_field && r[e.title_field] !== undefined && r[e.title_field] !== null && r[e.title_field] !== "")
    return String(r[e.title_field]);
  var prefer = ["name","organization_name","value","label","code"];
  for (var i = 0; i < prefer.length; i++) if (r[prefer[i]]) return String(r[prefer[i]]);
  var fio = [r.last_name, r.first_name, r.second_name].filter(Boolean).join(" ");
  if (fio) return fio;
  return "#" + (r.id != null ? r.id : "—");
}
function entRecById(entityId, id){
  var list = ENT_DATA[entityId] || [];
  for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
  return null;
}
function entFmtDate(v){
  var s = String(v || "");
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + "." + m[2] + "." + m[1] : s;
}
function entFmtDateTime(v){
  var s = String(v || "");
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  return m ? m[3] + "." + m[2] + "." + m[1] + " " + m[4] + ":" + m[5] : entFmtDate(s);
}
function entFmtNum(v){
  var n = Number(v);
  if (!isFinite(n)) return String(v);
  return n.toLocaleString(entEn() ? "en-GB" : "ru-RU", { maximumFractionDigits: 4 });
}
/* чип-ссылка на запись другой сущности */
function entChip(entityId, id){
  var e = entEntity(entityId), r = entRecById(entityId, id);
  if (!e) return '<span class="ent-link"><span class="k">' + entEsc(entityId) + "</span>" + entEsc(id) + "</span>";
  if (!r) return '<span class="ent-link"><span class="k">#' + entEsc(id) + "</span>" + entT("запись не найдена") + "</span>";
  return '<span class="ent-link" data-goe="' + entEsc(entityId) + '" data-gor="' + entEsc(r.id) + '">' +
    '<span class="k">#' + entEsc(r.id) + "</span>" + entEsc(entTitle(e, r)) + "</span>";
}
/* обратная сторона related_list: у какой сущности есть lookup на нас */
function entBackRefs(e, f){
  var tgt = entEntity(f.target_entity);
  if (!tgt) return { entity:null, field:null, rows:[] };
  var fk = null;
  for (var i = 0; i < tgt.fields.length; i++){
    var tf = tgt.fields[i];
    if (tf.ui_type === "lookup" && tf.target_entity === e.id) { fk = tf; break; }
  }
  if (!fk) return { entity:tgt, field:null, rows:[] };
  return { entity:tgt, field:fk, rows:(ENT_DATA[tgt.id] || []) };
}
function entValueHtml(e, f, r){
  var v = r[f.name];
  var empty = (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length));

  if (f.ui_type === "related_list"){
    var back = entBackRefs(e, f);
    if (!back.entity) return '<span class="v empty">—</span>';
    if (!back.field) return '<span class="v empty">' + entT("нет обратной ссылки в схеме") + "</span>";
    var kids = back.rows.filter(function(x){ return String(x[back.field.name]) === String(r.id); });
    if (!kids.length) return '<span class="v empty">' + entT("связанных записей нет") + "</span>";
    return '<span class="v"><span class="ent-links">' +
      kids.map(function(k){ return entChip(back.entity.id, k.id); }).join("") + "</span>" +
      '<span class="ent-rel-note">' + entEsc(back.entity.table || back.entity.id) + "." +
      entEsc(back.field.name) + " → " + entEsc(e.table || e.id) + ".id</span></span>";
  }
  if (empty) return '<span class="v empty">—</span>';
  if (f.ui_type === "multilookup"){
    var arr = Array.isArray(v) ? v : [v];
    return '<span class="v"><span class="ent-links">' +
      arr.map(function(id){ return entChip(f.target_entity, id); }).join("") + "</span></span>";
  }
  if (f.ui_type === "lookup"){
    if (!entEntity(f.target_entity)) return '<span class="v">' + entEsc(v) + "</span>";
    return '<span class="v">' + entChip(f.target_entity, v) + "</span>";
  }
  if (f.ui_type === "checkbox")
    return '<span class="v">' + (v === true || v === "true"
      ? '<span class="flag-on">' + entT("да") + "</span>"
      : '<span class="flag-off">' + entT("нет") + "</span>") + "</span>";
  if (f.ui_type === "currency")
    return '<span class="v"><span class="num">' + entFmtNum(v) + " ₽</span></span>";
  if (f.ui_type === "percent")
    return '<span class="v"><span class="num">' + entFmtNum(v) + " %</span></span>";
  if (f.ui_type === "number")
    return '<span class="v"><span class="num">' + entFmtNum(v) + "</span></span>";
  if (f.ui_type === "date")     return '<span class="v">' + entEsc(entFmtDate(v)) + "</span>";
  if (f.ui_type === "datetime") return '<span class="v">' + entEsc(entFmtDateTime(v)) + "</span>";
  if (f.ui_type === "url")
    return '<span class="v"><a href="' + entEsc(v) + '" target="_blank" rel="noopener">' + entEsc(v) + "</a></span>";
  return '<span class="v">' + entEsc(v) + "</span>";
}

/* ---------- редактор поля ---------- */
function entEditable(f){
  return !f.read_only && f.ui_type !== "related_list" && f.name !== "id";
}
function entToInput(f, v){
  if (f.ui_type === "datetime"){
    var m = String(v || "").match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    return m ? m[1] + "T" + m[2] : "";
  }
  return v == null ? "" : String(v);
}
function entEditorHtml(e, f, r){
  var v = r[f.name], html;
  if (f.ui_type === "checkbox"){
    html = '<input type="checkbox" class="ent-in-check"' + (v === true || v === "true" ? " checked" : "") + ">";
  } else if (f.ui_type === "picklist"){
    var opts = (f.options || []).slice();
    html = '<select class="ent-in"><option value="">—</option>' + opts.map(function(o){
      return '<option value="' + entEsc(o) + '"' + (String(v) === String(o) ? " selected" : "") + ">" + entEsc(o) + "</option>";
    }).join("") + "</select>";
  } else if (f.ui_type === "lookup"){
    var te = entEntity(f.target_entity);
    if (!te){
      html = '<input type="text" class="ent-in" value="' + entEsc(v == null ? "" : v) + '">';
    } else {
      html = '<select class="ent-in"><option value="">—</option>' + (ENT_DATA[te.id] || []).map(function(x){
        return '<option value="' + entEsc(x.id) + '"' + (String(v) === String(x.id) ? " selected" : "") + ">#" +
          entEsc(x.id) + " · " + entEsc(entTitle(te, x)) + "</option>";
      }).join("") + "</select>";
    }
  } else if (f.ui_type === "multilookup"){
    var me2 = entEntity(f.target_entity), cur = Array.isArray(v) ? v.map(String) : (v != null && v !== "" ? [String(v)] : []);
    var rows = me2 ? (ENT_DATA[me2.id] || []) : [];
    html = '<div class="ent-multi">' + (rows.length ? rows.map(function(x){
      return '<label><input type="checkbox" value="' + entEsc(x.id) + '"' +
        (cur.indexOf(String(x.id)) >= 0 ? " checked" : "") + "><span>#" + entEsc(x.id) + " · " +
        entEsc(entTitle(me2, x)) + "</span></label>";
    }).join("") : '<span class="none">' + entT("записей нет") + "</span>") + "</div>";
  } else if (f.ui_type === "textarea"){
    html = '<textarea class="ent-in">' + entEsc(v == null ? "" : v) + "</textarea>";
  } else if (f.ui_type === "date"){
    html = '<input type="date" class="ent-in" value="' + entEsc(entToInput(f, v)) + '">';
  } else if (f.ui_type === "datetime"){
    html = '<input type="datetime-local" class="ent-in" value="' + entEsc(entToInput(f, v)) + '">';
  } else if (f.ui_type === "time"){
    html = '<input type="time" class="ent-in" value="' + entEsc(entToInput(f, v)) + '">';
  } else if (f.ui_type === "number" || f.ui_type === "currency" || f.ui_type === "percent"){
    html = '<input type="text" inputmode="decimal" class="ent-in" value="' + entEsc(v == null ? "" : v) + '">';
  } else {
    html = '<input type="text" class="ent-in" value="' + entEsc(v == null ? "" : v) + '">';
  }
  return '<div class="ent-edit-wrap"><div class="fld">' + html + "</div>" +
    '<button type="button" class="ent-ok" title="' + entT("Сохранить") + '">✓</button>' +
    '<button type="button" class="ent-no" title="' + entT("Отмена") + '">✕</button></div>';
}
/* значение из редактора обратно в модель */
function entFromEditor(e, f, row){
  if (f.ui_type === "checkbox") return !!row.querySelector(".ent-in-check").checked;
  if (f.ui_type === "multilookup"){
    return [].slice.call(row.querySelectorAll(".ent-multi input:checked")).map(function(c){
      var n = Number(c.value); return isFinite(n) && String(n) === c.value ? n : c.value;
    });
  }
  var el = row.querySelector(".ent-in");
  var raw = el ? el.value : "";
  if (f.ui_type === "lookup"){
    if (raw === "") return null;
    var n2 = Number(raw); return isFinite(n2) && String(n2) === raw ? n2 : raw;
  }
  if (f.ui_type === "number" || f.ui_type === "currency" || f.ui_type === "percent"){
    if (raw === "") return "";
    var n3 = Number(String(raw).replace(",", ".").replace(/\s/g, ""));
    return isFinite(n3) ? n3 : raw;
  }
  if (f.ui_type === "datetime") return raw ? raw.replace("T", " ") : "";
  return raw;
}

/* ---------- рендер карточки ---------- */
var ENT_PEN = '<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

function entRowHtml(e, f, r){
  var st = entFieldState(e, f, r);
  if (st.hidden) return "";
  var editing = ENT_CUR.edit === f.name;
  var wide = ["textarea","related_list","multilookup"].indexOf(f.ui_type) >= 0;
  var req = entRequired(e, f, r);
  var label = '<div class="l"><span>' + entEsc(f.label || f.name) + "</span>" +
    (req ? '<span class="req" title="' + entT(f.required ? "Обязательное поле" : "Обязательное при текущих значениях") + '">*</span>' : "") +
    '<span class="api">' + entEsc(f.name) + "</span></div>";
  /* поле-зеркало: значение подтягивается из источника и не правится вручную */
  if (st.mirrored){
    var src = entField(e, st.rule.from);
    return '<div class="ent-row' + (wide ? " wide" : "") + ' mirrored" data-f="' + entEsc(f.name) + '">' + label +
      entValueHtml(e, f, r) +
      '<div class="ent-mirror-note">' + entT("подтягивается из поля") + " «" +
      entEsc(src ? (src.label || src.name) : st.rule.from) + "»</div></div>";
  }
  /* обязательное и незаполненное видно сразу: иначе условная обязательность
     молча появлялась бы после смены управляющего поля и оставалась незамеченной */
  var missing = !editing && req && entEditable(f) && entIsEmpty(r[f.name]);
  var body = editing ? entEditorHtml(e, f, r)
    : (missing ? '<span class="v missing">' + entT("не заполнено") + "</span>" : entValueHtml(e, f, r));
  var pen = (!editing && entEditable(f))
    ? '<button type="button" class="ent-pen" data-edit="' + entEsc(f.name) + '" title="' + entT("Редактировать") + '">' + ENT_PEN + "</button>"
    : "";
  return '<div class="ent-row' + (wide ? " wide" : "") + (editing ? " editing" : "") +
    (missing ? " missing" : "") + '" data-f="' + entEsc(f.name) + '">' + label + body + pen + "</div>";
}

/* ============================================================
   СПИСОК ЗАПИСЕЙ (list view, как «Список шаблонов»)
   Подраздел открывается списком; запись открывается по клику,
   из карточки можно вернуться назад.

   Набор колонок и фильтров — личная настройка пользователя: она лежит
   в его браузере (crmpanel:entityListCols / crmpanel:entityListFilters)
   и выбирается из полей, которые ему доступны, — сущности, закрытые
   ролью, в раздел вообще не попадают (entAllowed).
   ============================================================ */
var ENT_LIST_MAX  = 10;    /* не больше 10 колонок и 10 фильтров одновременно */
var ENT_COLS_KEY  = "crmpanel:entityListCols";
var ENT_FILT_KEY  = "crmpanel:entityListFilters";
var ENT_DEF_COLS  = 6;

/* related_list — таблица связанных записей, в ячейку списка её не поместить */
function entListable(f){ return f.ui_type !== "related_list"; }
/* по чему имеет смысл фильтровать */
function entFilterable(f){ return ["related_list","multilookup"].indexOf(f.ui_type) < 0; }

/* Колонки по умолчанию. Сначала то, чем запись называется (поле заголовка либо
   привычные name/value/ФИО — тем же набором пользуется entTitle), затем поля по
   «опознавательности»: список значений и связи полезнее в списке, чем флажки,
   а флажки и многострочный текст в узкую колонку не помещаются вовсе.
   Это только умолчание: набор всё равно правится шестерёнкой. */
var ENT_COL_PRIORITY = ["picklist","lookup","text","email","phone","url","currency","number","percent","date","datetime"];
function entDefaultCols(e){
  var L = entLayout(e), out = [], sys = {};
  var SYS = window.EntityLayout ? EntityLayout.SYSTEM_BLOCK : "Служебные";
  L.blocks.forEach(function(b){
    if (b.title === SYS) b.fields.forEach(function(f){ sys[f.name] = 1; });
  });
  var add = function(n){
    if (!n || out.indexOf(n) >= 0 || out.length >= ENT_DEF_COLS) return;
    var f = entField(e, n);
    if (f && entListable(f)) out.push(n);
  };
  if (e.title_field) add(e.title_field);
  if (!out.length) ["name","organization_name","value","label","code"].forEach(add);
  if (!out.length) ["last_name","first_name","second_name"].forEach(add);

  ENT_COL_PRIORITY.forEach(function(t){
    e.fields.forEach(function(f){
      if (sys[f.name] || f.ui_type !== t) return;
      add(f.name);
    });
  });
  /* если сущность состоит из одних флажков — берём что есть, лишь бы список не был пустым */
  e.fields.forEach(function(f){ if (!sys[f.name] && entListable(f)) add(f.name); });
  return out.length ? out : e.fields.slice(0, ENT_DEF_COLS).map(function(f){ return f.name; });
}
/* Фильтры по умолчанию — из тех же колонок: сначала списки значений, флажки и
   связи (по ним фильтруют чаще всего), потом остальное. */
function entDefaultFilters(e){
  var cols = entDefaultCols(e), out = [];
  var take = function(pred){
    cols.forEach(function(n){
      var f = entField(e, n);
      if (f && entFilterable(f) && out.indexOf(n) < 0 && pred(f) && out.length < 4) out.push(n);
    });
  };
  take(function(f){ return ["picklist","checkbox","lookup"].indexOf(f.ui_type) >= 0; });
  take(function(){ return true; });
  return out;
}
function entCols(e){
  var cfg = entRead(ENT_COLS_KEY, {}) || {};
  var ids = Array.isArray(cfg[e.id]) && cfg[e.id].length ? cfg[e.id] : entDefaultCols(e);
  return ids.map(function(n){ return entField(e, n); })
            .filter(function(f){ return f && entListable(f); })
            .slice(0, ENT_LIST_MAX);
}
function entFilterCols(e){
  var cfg = entRead(ENT_FILT_KEY, {}) || {};
  var ids = Array.isArray(cfg[e.id]) ? cfg[e.id] : entDefaultFilters(e);
  return ids.map(function(n){ return entField(e, n); })
            .filter(function(f){ return f && entFilterable(f); })
            .slice(0, ENT_LIST_MAX);
}
function entSetCfg(key, entityId, ids){
  var cfg = entRead(key, {}) || {};
  cfg[entityId] = ids;
  entWrite(key, cfg);
}

/* значение поля в виде строки — для поиска, сортировки и ячейки списка */
function entPlain(e, f, r){
  var v = r[f.name];
  if (v === undefined || v === null || v === "") return "";
  if (f.ui_type === "checkbox") return (v === true || v === "true") ? entT("да") : entT("нет");
  if (f.ui_type === "lookup"){
    var te = entEntity(f.target_entity), tr = te ? entRecById(te.id, v) : null;
    return tr ? entTitle(te, tr) : String(v);
  }
  if (f.ui_type === "multilookup"){
    var me = entEntity(f.target_entity), arr = Array.isArray(v) ? v : [v];
    return arr.map(function(id){
      var x = me ? entRecById(me.id, id) : null; return x ? entTitle(me, x) : id;
    }).join(", ");
  }
  if (f.ui_type === "date") return entFmtDate(v);
  if (f.ui_type === "datetime") return entFmtDateTime(v);
  return String(v);
}
function entListRows(e){
  var rows = entRows(e.id).slice();
  var q = (ENT_CUR.q || "").trim().toLowerCase();
  var cols = entCols(e), fv = ENT_CUR.fv[e.id] || {};

  rows = rows.filter(function(r){
    if (q){
      var hay = cols.map(function(f){ return entPlain(e, f, r); }).join(" ").toLowerCase() + " " + r.id;
      if (hay.indexOf(q) < 0) return false;
    }
    for (var name in fv){
      var val = fv[name];
      if (val === "" || val === undefined) continue;
      var f = entField(e, name);
      if (!f) continue;
      if (f.ui_type === "checkbox"){
        if (String(r[name] === true || r[name] === "true") !== val) return false;
      } else if (f.ui_type === "picklist" || f.ui_type === "lookup"){
        if (String(r[name] == null ? "" : r[name]) !== val) return false;
      } else {
        if (entPlain(e, f, r).toLowerCase().indexOf(String(val).toLowerCase()) < 0) return false;
      }
    }
    return true;
  });

  var s = ENT_CUR.sort[e.id];
  if (s){
    var sf = entField(e, s.k);
    if (sf) rows.sort(function(a, b){
      var x = entPlain(e, sf, a), y = entPlain(e, sf, b);
      var nx = Number(a[s.k]), ny = Number(b[s.k]);
      var c = (isFinite(nx) && isFinite(ny) && x !== "" && y !== "")
        ? nx - ny : x.localeCompare(y, entEn() ? "en" : "ru");
      return s.dir < 0 ? -c : c;
    });
  }
  return rows;
}

function entFilterCtlHtml(e, f, val){
  if (f.ui_type === "checkbox")
    return '<select data-fv="' + entEsc(f.name) + '"><option value="">' + entT("Все") + "</option>" +
      '<option value="true"' + (val === "true" ? " selected" : "") + ">" + entT("да") + "</option>" +
      '<option value="false"' + (val === "false" ? " selected" : "") + ">" + entT("нет") + "</option></select>";
  if (f.ui_type === "picklist")
    return '<select data-fv="' + entEsc(f.name) + '"><option value="">' + entT("Все") + "</option>" +
      (f.options || []).map(function(o){
        return '<option value="' + entEsc(o) + '"' + (String(val) === String(o) ? " selected" : "") + ">" + entEsc(o) + "</option>";
      }).join("") + "</select>";
  if (f.ui_type === "lookup"){
    var te = entEntity(f.target_entity);
    if (te) return '<select data-fv="' + entEsc(f.name) + '"><option value="">' + entT("Все") + "</option>" +
      (ENT_DATA[te.id] || []).map(function(x){
        return '<option value="' + entEsc(x.id) + '"' + (String(val) === String(x.id) ? " selected" : "") +
          ">" + entEsc(entTitle(te, x)) + "</option>";
      }).join("") + "</select>";
  }
  return '<input type="text" data-fv="' + entEsc(f.name) + '" value="' + entEsc(val || "") + '" placeholder="' + entT("любое") + '">';
}

function entGearHtml(e){
  var cols = entCols(e).map(function(f){ return f.name; });
  var filt = entFilterCols(e).map(function(f){ return f.name; });
  function box(list, attr, chosen){
    return list.map(function(f){
      var on = chosen.indexOf(f.name) >= 0;
      var full = !on && chosen.length >= ENT_LIST_MAX;
      return '<label' + (full ? ' class="off"' : "") + '><input type="checkbox" data-' + attr + '="' + entEsc(f.name) + '"' +
        (on ? " checked" : "") + (full ? " disabled" : "") + "><span>" + entEsc(f.label || f.name) + "</span></label>";
    }).join("");
  }
  return '<div class="ent-gear-panel' + (ENT_CUR.gear ? " open" : "") + '">' +
    "<h4>" + entT("Отображаемые поля") + '<span class="lim">' + cols.length + " / " + ENT_LIST_MAX + "</span></h4>" +
    '<div class="ent-gear-box">' + box(e.fields.filter(entListable), "col", cols) + "</div>" +
    "<h4>" + entT("Показывать фильтры") + '<span class="lim">' + filt.length + " / " + ENT_LIST_MAX + "</span></h4>" +
    '<div class="ent-gear-box">' + box(e.fields.filter(entFilterable), "filt", filt) + "</div>" +
    '<div class="ent-gear-foot"><span class="ent-gear-note">' +
      entT("Не больше 10 колонок и 10 фильтров одновременно. Настройка личная — хранится в вашем браузере.") + "</span>" +
      '<button type="button" class="ent-btn" data-gear-reset="1">' + entT("По умолчанию") + "</button>" +
      '<button type="button" class="ent-btn" data-gear-close="1">' + entT("Закрыть") + "</button></div></div>";
}

var ENT_GEAR_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></svg>';

function entListHtml(e){
  var cols = entCols(e), filters = entFilterCols(e), rows = entListRows(e);
  var total = entRows(e.id).length, s = ENT_CUR.sort[e.id], fv = ENT_CUR.fv[e.id] || {};

  var head = '<div class="ent-lv-head">' +
    '<div class="ent-lv-obj"><span class="ico">' + (ICONS.table || "") + "</span>" +
      "<div><div class=\"kind\">" + entEsc(e.label) + "</div>" +
      '<div class="title">' + entEsc(e.plural_label || e.label) + "</div></div></div>" +
    '<div class="ent-lv-acts">' +
      '<input class="ent-lv-search" id="entSearch" placeholder="' + entT("Поиск в списке…") + '" value="' + entEsc(ENT_CUR.q || "") + '">' +
      '<button type="button" class="ent-btn" data-lv-reset="1">' + entT("Сбросить фильтры") + "</button>" +
      '<button type="button" class="ent-btn accent" data-new="1">＋ ' + entT("Новая запись") + "</button>" +
      '<span class="ent-gear-wrap"><button type="button" class="ent-gear" data-gear="1" title="' +
        entT("Настройка полей и фильтров") + '">' + ENT_GEAR_ICO + "</button>" + entGearHtml(e) + "</span>" +
    "</div></div>";

  var filterRow = filters.length ? '<div class="ent-lv-filters">' + filters.map(function(f){
    return '<div class="f"><label>' + entEsc(f.label || f.name) + "</label>" +
      entFilterCtlHtml(e, f, fv[f.name]) + "</div>";
  }).join("") + "</div>" : "";

  var body = rows.length
    ? rows.map(function(r){
        return '<tr data-open="' + entEsc(r.id) + '">' + cols.map(function(f, i){
          var val = entPlain(e, f, r);
          var cell = i === 0
            ? '<a class="ent-lv-link">' + entEsc(val || ("#" + r.id)) + "</a>"
            : (f.ui_type === "checkbox"
                ? '<span class="' + (r[f.name] === true ? "flag-on" : "flag-off") + '">' + entEsc(val) + "</span>"
                : entEsc(val) || '<span class="empty">—</span>');
          return '<td data-label="' + entEsc(f.label || f.name) + '">' + cell + "</td>";
        }).join("") + "</tr>";
      }).join("")
    : '<tr class="ent-lv-none"><td colspan="' + cols.length + '">' + entT("Нет записей по заданным фильтрам") + "</td></tr>";

  return head + filterRow +
    '<div class="ent-lv-count">' + entPlural(rows.length, "record") +
      (rows.length !== total ? " " + entT("из") + " " + total : "") +
      (s ? " · " + entT("Отсортировано по") + " " + entEsc((entField(e, s.k) || {}).label || s.k) : "") + "</div>" +
    '<div class="ent-lv-wrap"><table class="ent-lv"><thead><tr>' +
      cols.map(function(f){
        var on = s && s.k === f.name;
        return '<th data-sort="' + entEsc(f.name) + '"' + (on ? ' class="on"' : "") + ">" +
          entEsc(f.label || f.name) + (on ? '<span class="ar">' + (s.dir > 0 ? "▲" : "▼") + "</span>" : "") + "</th>";
      }).join("") +
    "</tr></thead><tbody>" + body + "</tbody></table></div>";
}

/* ============================================================
   КАРТОЧКА ЗАПИСИ: шапка + вкладки «Детали» / «Коммуникации»
   ============================================================ */
/* Связанные списки уезжают в правую колонку (как в Salesforce), поэтому из
   блоков «Деталей» их убираем — иначе одно и то же показывалось бы дважды. */
function entRelatedFields(e){
  return e.fields.filter(function(f){ return f.ui_type === "related_list"; });
}
function entCard(e){
  return (window.EntityLayout && EntityLayout.cardConfig)
    ? EntityLayout.cardConfig(e)
    : { columns:2, rail:true, railItems:null, tabs:[{id:"details",label:"Детали"},{id:"comms",label:"Коммуникации"}], blocks:{} };
}
function entBlockCfg(e, title){
  return (window.EntityLayout && EntityLayout.blockConfig)
    ? EntityLayout.blockConfig(e, title) : { hidden:false, tab:"details", collapsed:false };
}
/* Блоки полей вкладки: что показывать и на какой вкладке — задаётся в
   настроечной админке («Настройки отображения карточки»). */
function entDetailsHtml(e, r, tabId){
  var L = entLayout(e), cfg = entCard(e), rail = entRailFields(e).length > 0;
  return L.blocks.map(function(g){
    var bc = entBlockCfg(e, g.title);
    if (bc.hidden || bc.tab !== tabId) return "";
    var fields = rail ? g.fields.filter(function(f){ return f.ui_type !== "related_list"; }) : g.fields;
    var rows = fields.map(function(f){ return entRowHtml(e, f, r); }).join("");
    if (!rows) return "";                       /* весь блок скрыт зависимостями */
    var shown = fields.filter(function(f){ return !entFieldState(e, f, r).hidden; }).length;
    var key = e.id + ":" + g.title;
    var closed = (ENT_CUR.closed[key] === undefined ? bc.collapsed : ENT_CUR.closed[key]) ? " closed" : "";
    return '<div class="ent-sec' + closed + '" data-sec="' + entEsc(g.title) + '">' +
      '<div class="ent-sec-title">' + entEsc(entT(g.title)) +
      '<span class="cnt">' + shown + "</span></div>" +
      '<div class="ent-grid cols-' + cfg.columns + '">' + rows + "</div></div>";
  }).join("");
}

/* какие связанные объекты выводить справа — настраивается в админке */
function entRailFields(e){
  var cfg = entCard(e);
  if (!cfg.rail) return [];
  var all = entRelatedFields(e);
  if (!cfg.railItems) return all;
  return all.filter(function(f){ return cfg.railItems.indexOf(f.name) >= 0; });
}

/* Правая колонка: блоки связанных объектов. Считаются по обратной ссылке из
   схемы — тот же расчёт, что раньше рисовал related_list внутри «Деталей». */
function entRailHtml(e, r){
  var rel = entRailFields(e);
  if (!rel.length) return "";
  return rel.map(function(f){
    var back = entBackRefs(e, f);
    var body, cnt = 0;
    if (!back.entity || !back.field){
      body = '<div class="ent-rl-empty">' + entT("нет обратной ссылки в схеме") + "</div>";
    } else {
      var kids = back.rows.filter(function(x){ return String(x[back.field.name]) === String(r.id); });
      cnt = kids.length;
      body = kids.length
        ? '<div class="ent-rl-body">' + kids.map(function(k){
            var sub = entRailSubtitle(back.entity, k);
            return '<div class="ent-rl-item" data-goe="' + entEsc(back.entity.id) + '" data-gor="' + entEsc(k.id) + '">' +
              '<div class="t">' + entEsc(entTitle(back.entity, k)) + "</div>" +
              (sub ? '<div class="s">' + entEsc(sub) + "</div>" : "") +
              '<div class="n">#' + entEsc(k.id) + "</div></div>";
          }).join("") + "</div>"
        : '<div class="ent-rl-empty">' + entT("связанных записей нет") + "</div>";
    }
    return '<section class="ent-rl">' +
      '<header class="ent-rl-head"><span class="ico">' + (ICONS.table || "") + "</span>" +
        "<b>" + entEsc(f.label || f.name) + '</b><span class="cnt">' + cnt + "</span></header>" +
      body +
      (back.entity && back.field
        ? '<div class="ent-rl-foot">' + entEsc(back.entity.table || back.entity.id) + "." +
          entEsc(back.field.name) + " → " + entEsc(e.table || e.id) + ".id</div>"
        : "") +
    "</section>";
  }).join("");
}
/* вторая строка в элементе связанного списка — что-то отличительное, кроме названия */
function entRailSubtitle(e, r){
  var pick = ["type","status","channel","position","code"];
  for (var i = 0; i < pick.length; i++){
    var f = entField(e, pick[i]);
    if (f && r[f.name]) return entPlain(e, f, r);
  }
  return "";
}

function entCardHtml(e, r){
  var L = entLayout(e);
  /* «подсвеченные» поля — сразу под названием записи; их набор настраивается
     в админке («Сущности» → В шапке) */
  var hi = L.header.map(function(f){
    return '<div class="hi"><span class="l">' + entEsc(f.label || f.name) + "</span>" +
      '<span class="v">' + (entPlain(e, f, r) ? entEsc(entPlain(e, f, r)) : "—") + "</span></div>";
  }).join("");

  var cfg = entCard(e);
  var tab = cfg.tabs.some(function(t){ return t.id === ENT_CUR.tab; }) ? ENT_CUR.tab : "details";
  var blocks = entDetailsHtml(e, r, tab);
  /* «Коммуникации» пока заглушка; своих блоков у неё нет, поэтому если на неё
     ничего не назначено — показываем пояснение, а не пустую карточку */
  var pane = blocks
    ? '<div class="ent-card">' + blocks + "</div>"
    : (tab === "comms"
        ? '<div class="ent-card"><div class="ent-comms-stub">' +
            "<b>" + entT("Коммуникации") + "</b>" +
            "<p>" + entT("Здесь появятся отправленные по этой записи коммуникации: канал, шаблон, дата отправки и статус доставки. Раздел в разработке.") + "</p>" +
          "</div></div>"
        : '<div class="ent-card"><div class="ent-comms-stub"><b>' + entT("Блоки не назначены") + "</b>" +
            "<p>" + entT("На эту вкладку не выведен ни один блок полей. Настроить можно в админке: «Сущности» → «Настройки отображения карточки».") + "</p></div></div>");

  /* колонка связанных объектов держится на всех вкладках: это контекст записи,
     а не содержимое конкретной вкладки (так же ведёт себя Salesforce) */
  var rail = entRailHtml(e, r);

  return '<div class="ent-rec-head">' +
      '<button type="button" class="ent-back" data-back="1">← ' + entT("К списку") + "</button>" +
      '<div class="ent-rec-top">' +
        '<div class="ent-rec-ident">' +
          '<div class="ent-rec-id"><span class="ch">' + entEsc(e.label) + "</span>" +
            '<span class="mono">' + entEsc(e.table || e.id) + " · id " + entEsc(r.id) + "</span></div>" +
          "<h2>" + entEsc(entTitle(e, r)) + "</h2>" +
        "</div>" +
        /* действия — отдельным блоком справа от названия, а не под ним */
        '<div class="ent-rec-acts">' +
          '<button type="button" class="ent-btn accent" data-new="1">＋ ' + entT("Новая запись") + "</button>" +
          '<button type="button" class="ent-btn danger" data-del="1">' + entT("Удалить запись") + "</button>" +
        "</div>" +
      "</div>" +
      (hi ? '<div class="ent-highlights">' + hi + "</div>" : "") +
    "</div>" +
    '<div class="ent-tabs">' + cfg.tabs.map(function(t){
      return '<button type="button" class="ent-tab' + (tab === t.id ? " on" : "") +
        '" data-tab="' + entEsc(t.id) + '">' + entEsc(entT(t.label)) + "</button>";
    }).join("") + "</div>" +
    '<div class="ent-body' + (rail ? "" : " no-rail") + '">' +
      '<div class="ent-main">' + pane + "</div>" +
      (rail ? '<aside class="ent-rail">' + rail + "</aside>" : "") +
    "</div>";
}

function entHeroHtml(e){
  var rows = (ENT_DATA[e.id] || []).length;
  var rels = ENT_MODEL.relations.filter(function(x){ return x.from_entity === e.id || x.to_entity === e.id; }).length;
  /* Крошка наверх: таблица открыта изнутри сущности, и вернуться к её списку
     таблиц должно быть можно, не уходя в меню. */
  var up = '<button type="button" class="ent-up" data-tables="1">← ' +
           entEsc(entT("Таблицы сущности")) + "</button>";
  return '<header class="ent-hero">' + up +
    '<div class="eyebrow">CRM · ' + entT("Данные") + " · " + entEsc(e.table || e.id) + "</div>" +
    "<h1>" + entEsc(e.plural_label || e.label) + "</h1>" +
    '<p class="sub">' + entEsc(e.description || entT("Список записей сущности: колонки и фильтры настраиваются шестерёнкой, запись открывается по клику.")) + "</p>" +
    '<div class="meta"><span>' + entPlural(e.fields.length, "field") + "</span>" +
      "<span>" + entPlural(rows, "record") + "</span>" +
      "<span>" + entPlural(rels, "rel") + "</span>" +
      "<span>" + entT("доступ") + ": ADMIN</span></div></header>";
}

/* Экран между сущностью и данными: её таблицы. Сущность — это схема, и таблиц
   в ней может быть несколько; раньше вторая вылезала отдельным подразделом, а
   первая подменяла собой всю сущность. Экран показываем всегда, даже когда
   таблица одна: иначе путь до данных зависел бы от состава схемы, и человек не
   знал бы заранее, куда попадёт по клику. */
function entTablesHtml(schemaId){
  var head = entSchemaHead(schemaId), tables = entTables(schemaId);
  var links = entLinkTables(schemaId);
  var title = head ? (head.plural_label || head.label || schemaId) : schemaId;
  var html = '<header class="ent-hero">' +
    '<div class="eyebrow">CRM · ' + entT("Сущность") + " · " + entEsc(schemaId) + "</div>" +
    "<h1>" + entEsc(title) + "</h1>" +
    '<p class="sub">' + entT("Таблицы сущности. Выберите таблицу, чтобы открыть её записи.") + "</p>" +
    '<div class="meta"><span>' + entPlural(tables.length + links.length, "table") + "</span>" +
      "<span>" + entT("доступ") + ": ADMIN</span></div></header>";
  if (!tables.length && !links.length){
    return html + '<div class="ent-empty">' +
      entT("У сущности нет таблиц. Заведите их в Scheme Builder (настроечная админка).") + "</div>";
  }
  html += '<div class="ov-grid">' + tables.map(function(x){
    var rows = (ENT_DATA[x.id] || []).length;
    return '<div class="ov-card" data-tbl="' + entEsc(x.id) + '">' +
      '<div class="ov-ico">' + (ICONS.table || ICONS.doc) + "</div>" +
      "<h3>" + entEsc(x.label || x.id) + "</h3>" +
      '<div class="ov-meta">' + entEsc(x.table || x.id) + " · " +
        entPlural(x.fields.length, "field") + " · " + entPlural(rows, "record") + "</div>" +
      "<p>" + entEsc(x.description || entT("Список записей и карточка: поля по смысловым блокам, переходы по связям.")) + "</p>" +
      '<span class="ov-go">' + entT("Открыть →") + "</span></div>";
  }).join("") + links.map(function(l){
    return '<div class="ov-card ent-linktbl">' +
      '<div class="ov-ico">' + (ICONS.link || ICONS.table || ICONS.doc) + "</div>" +
      "<h3>" + entEsc(l.table) + "</h3>" +
      '<div class="ov-meta">' + entT("связующая таблица") + " · 2 " + entT("колонки") + "</div>" +
      "<p>" + entT("Хранит пары «многие ко многим»") + ": " +
        entEsc(l.from.label || l.from.id) + " ↔ " + entEsc(l.to.label || l.to.id) + ". " +
        entT("Заводится связью в Scheme Builder; записи видны со стороны самих сущностей.") + "</p></div>";
  }).join("") + "</div>";
  return html;
}

function entRender(){
  var host = document.getElementById("entHost");
  if (!host) return;
  if (ENT_CUR.mode === "tables" || !ENT_CUR.id){
    host.innerHTML = entTablesHtml(ENT_CUR.schema);
    host.querySelectorAll("[data-tbl]").forEach(function(card){
      card.onclick = function(){
        ENT_CUR.id = card.dataset.tbl; ENT_CUR.mode = "list";
        ENT_CUR.rec = null; ENT_CUR.q = ""; ENT_CUR.edit = null;
        entRender();
        var v = document.getElementById("view-entity"); if (v) v.scrollTop = 0;
      };
    });
    return;
  }
  var e = entEntity(ENT_CUR.id);
  if (!e){
    host.innerHTML = '<div class="ent-empty">' + entT("Сущность не найдена в схеме. Проверьте Scheme Builder в настроечной админке.") + "</div>";
    return;
  }
  /* тост живёт в разметке страницы, вне entHost: перерисовка карточки его гасила */
  var toast = "";
  var list = entRows(e.id);

  if (ENT_CUR.mode === "card" && entRecById(e.id, ENT_CUR.rec)){
    host.innerHTML = entCardHtml(e, entRecById(e.id, ENT_CUR.rec)) + toast;
    entWire(host, e, entRecById(e.id, ENT_CUR.rec));
    return;
  }
  ENT_CUR.mode = "list";
  if (!list.length){
    host.innerHTML = entHeroHtml(e) +
      '<div class="ent-lv-head"><div class="ent-lv-acts">' +
        '<button type="button" class="ent-btn accent" data-new="1">＋ ' + entT("Новая запись") + "</button></div></div>" +
      '<div class="ent-empty">' + entT("Записей пока нет — заведите первую.") + "</div>" + toast;
    entWire(host, e, null);
    return;
  }
  host.innerHTML = entHeroHtml(e) + entListHtml(e) +
    '<div class="ent-note"><b>' + entT("Как это работает:") + "</b> " +
      entT("подраздел построен по сущности из Scheme Builder. Список открывается первым: колонки и фильтры настраиваются шестерёнкой (не больше 10 тех и других), запись открывается по клику и возвращает назад кнопкой «К списку». В карточке поля разложены по смысловым блокам, связи показаны ссылками на записи других сущностей. Правка поля подтверждается ✓ (Enter), отменяется ✕ или Esc; клик мимо поля сохраняет значение. Изменения хранятся в браузере.") +
    "</div>" + toast;
  entWire(host, e, null);
}

function entToast(msg){
  var el = document.getElementById("entToast");
  if (!el) return;
  el.textContent = msg; el.classList.add("show");
  clearTimeout(entToast._t); entToast._t = setTimeout(function(){ el.classList.remove("show"); }, 1800);
}

/* ---------- обработчики ---------- */
function entWire(host, e, r){
  host.querySelectorAll("[data-tables]").forEach(function(b){ b.onclick = entBackToTables; });
  /* --- список --- */
  host.querySelectorAll("tr[data-open]").forEach(function(tr){
    tr.onclick = function(){
      ENT_CUR.rec = tr.dataset.open; ENT_CUR.mode = "card"; ENT_CUR.tab = "details"; ENT_CUR.edit = null;
      entRender();
      var v = document.getElementById("view-entity"); if (v) v.scrollTop = 0;
    };
  });
  host.querySelectorAll("th[data-sort]").forEach(function(th){
    th.onclick = function(){
      var k = th.dataset.sort, s = ENT_CUR.sort[e.id];
      ENT_CUR.sort[e.id] = (s && s.k === k) ? { k:k, dir: -s.dir } : { k:k, dir: 1 };
      entRender();
    };
  });
  var search = host.querySelector("#entSearch");
  if (search) search.oninput = function(){
    ENT_CUR.q = search.value;
    var pos = search.selectionStart;
    entRender();
    var n = document.getElementById("entSearch");
    if (n){ n.focus(); try { n.setSelectionRange(pos, pos); } catch(e2){} }
  };
  host.querySelectorAll("[data-fv]").forEach(function(el){
    var apply = function(){
      if (!ENT_CUR.fv[e.id]) ENT_CUR.fv[e.id] = {};
      ENT_CUR.fv[e.id][el.dataset.fv] = el.value;
      var name = el.dataset.fv, isText = el.tagName === "INPUT", pos = isText ? el.selectionStart : 0;
      entRender();
      if (isText){
        var n = document.querySelector('#entHost [data-fv="' + name + '"]');
        if (n){ n.focus(); try { n.setSelectionRange(pos, pos); } catch(e2){} }
      }
    };
    if (el.tagName === "SELECT") el.onchange = apply; else el.oninput = apply;
  });
  host.querySelectorAll("[data-lv-reset]").forEach(function(el){
    el.onclick = function(){ ENT_CUR.fv[e.id] = {}; ENT_CUR.q = ""; entRender(); };
  });
  /* --- шестерёнка: колонки и фильтры --- */
  host.querySelectorAll("[data-gear]").forEach(function(el){
    el.onclick = function(ev){ ev.stopPropagation(); ENT_CUR.gear = !ENT_CUR.gear; entRender(); };
  });
  host.querySelectorAll("[data-gear-close]").forEach(function(el){
    el.onclick = function(ev){ ev.stopPropagation(); ENT_CUR.gear = false; entRender(); };
  });
  host.querySelectorAll("[data-gear-reset]").forEach(function(el){
    el.onclick = function(ev){
      ev.stopPropagation();
      entSetCfg(ENT_COLS_KEY, e.id, entDefaultCols(e));
      entSetCfg(ENT_FILT_KEY, e.id, entDefaultFilters(e));
      ENT_CUR.fv[e.id] = {};
      entRender();
    };
  });
  var pick = function(attr, key, limitMsg){
    host.querySelectorAll("[data-" + attr + "]").forEach(function(ch){
      ch.onchange = function(ev){
        ev.stopPropagation();
        var ids = [];
        host.querySelectorAll("[data-" + attr + "]").forEach(function(x){
          if (x.checked) ids.push(x.dataset[attr]);
        });
        if (attr === "col" && !ids.length){ ch.checked = true; return; }   /* хотя бы одна колонка */
        if (ids.length > ENT_LIST_MAX){ ch.checked = false; entToast(limitMsg); return; }
        entSetCfg(key, e.id, ids);
        entRender();
      };
    });
  };
  pick("col", ENT_COLS_KEY, entT("Не больше 10 колонок в списке"));
  pick("filt", ENT_FILT_KEY, entT("Не больше 10 фильтров в списке"));

  /* --- карточка --- */
  host.querySelectorAll("[data-back]").forEach(function(el){
    el.onclick = function(){ ENT_CUR.mode = "list"; ENT_CUR.edit = null; entRender(); };
  });
  host.querySelectorAll("[data-tab]").forEach(function(el){
    el.onclick = function(){ ENT_CUR.tab = el.dataset.tab; ENT_CUR.edit = null; entRender(); };
  });
  host.querySelectorAll("[data-new]").forEach(function(el){ el.onclick = function(){ entNewRecord(e); }; });
  host.querySelectorAll("[data-del]").forEach(function(el){ el.onclick = function(){ entDeleteRecord(e, r); }; });
  host.querySelectorAll(".ent-sec-title").forEach(function(el){
    el.onclick = function(){
      var sec = el.parentElement, key = e.id + ":" + sec.dataset.sec;
      ENT_CUR.closed[key] = !ENT_CUR.closed[key];
      sec.classList.toggle("closed", !!ENT_CUR.closed[key]);
    };
  });
  host.querySelectorAll("[data-edit]").forEach(function(el){
    el.onclick = function(ev){
      ev.stopPropagation();
      if (ENT_CUR.edit) entCommit(e, r);        /* открыта другая правка — сначала её сохраняем */
      ENT_CUR.edit = el.dataset.edit;
      entRender();
      var inp = host.querySelector(".ent-row.editing .ent-in, .ent-row.editing .ent-in-check");
      if (inp) { inp.focus(); if (inp.select) try { inp.select(); } catch(e2){} }
    };
  });
  /* переходы по связи: и чипы в полях, и элементы блоков справа */
  host.querySelectorAll("[data-goe]").forEach(function(el){
    el.onclick = function(ev){ ev.stopPropagation(); entGo(el.dataset.goe, el.dataset.gor); };
  });
  var row = host.querySelector(".ent-row.editing");
  if (row){
    row.querySelector(".ent-ok").onclick = function(ev){ ev.stopPropagation(); entCommit(e, r); entRender(); };
    row.querySelector(".ent-no").onclick = function(ev){ ev.stopPropagation(); ENT_CUR.edit = null; entRender(); };
    row.addEventListener("keydown", function(ev){
      if (ev.key === "Escape"){ ev.stopPropagation(); ENT_CUR.edit = null; entRender(); }
      if (ev.key === "Enter" && ev.target.tagName !== "TEXTAREA"){ ev.preventDefault(); entCommit(e, r); entRender(); }
    });
  }
}

/* клик мимо открытой правки — сохраняем (как в «Планировании промо») */
document.addEventListener("mousedown", function(ev){
  if (!ENT_CUR.edit) return;
  var view = document.getElementById("view-entity");
  if (!view || !view.classList.contains("active")) return;
  var row = view.querySelector(".ent-row.editing");
  if (!row || row.contains(ev.target)) return;
  var e = entEntity(ENT_CUR.id), r = e ? entRecById(e.id, ENT_CUR.rec) : null;
  if (e && r) { entCommit(e, r); entRender(); }
}, true);

function entCommit(e, r){
  if (!ENT_CUR.edit) return;
  var view = document.getElementById("view-entity");
  var row = view && view.querySelector(".ent-row.editing");
  var f = entField(e, ENT_CUR.edit);
  ENT_CUR.edit = null;
  if (!row || !f) return;
  var next = entFromEditor(e, f, row);
  var prev = r[f.name];
  if (JSON.stringify(prev === undefined ? null : prev) === JSON.stringify(next === undefined ? null : next)) return;
  /* обязательное поле нельзя очистить правкой: раньше значение просто стиралось,
     и запись молча становилась неполной */
  if (entIsEmpty(next) && !entIsEmpty(prev) && entRequired(e, f, r)){
    entToast(entT("Поле обязательно") + ": " + (f.label || f.name));
    return;
  }
  r[f.name] = next;
  /* правка могла включить «Адреса совпадают» или изменить адрес-источник —
     подтягиваем зависимые поля до сохранения */
  entApplyMirror(e, r);
  entTouch(e, r);
  entStore();
  entToast(entT("Сохранено") + ": " + (f.label || f.name));
}
/* служебные поля обновления — как это сделает бэкенд */
function entTouch(e, r){
  var now = new Date(), p = function(n){ return String(n).padStart(2, "0"); };
  var stamp = now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate()) +
    " " + p(now.getHours()) + ":" + p(now.getMinutes());
  var me = window.CRM_ME;
  if (entField(e, "update_ts")) r.update_ts = stamp;
  if (entField(e, "user_update")) r.user_update = (me && me.email) || r.user_update || "panel";
}

function entNextId(list){
  var max = 0;
  list.forEach(function(x){ var n = Number(x.id); if (isFinite(n) && n > max) max = n; });
  return max + 1;
}
function entStamp(){
  var now = new Date(), p = function(n){ return String(n).padStart(2, "0"); };
  return now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate()) +
    " " + p(now.getHours()) + ":" + p(now.getMinutes());
}
/* заготовка записи: значения по умолчанию из схемы + служебные поля */
function entBlankRecord(e){
  var r = { id: entNextId(entRows(e.id)) }, me = window.CRM_ME, stamp = entStamp();
  e.fields.forEach(function(f){
    if (f.name === "id" || f.ui_type === "related_list") return;
    if (f.ui_type === "checkbox") r[f.name] = f.default_value === "true" || f.default_value === true;
    else if (f.ui_type === "multilookup") r[f.name] = [];
    else r[f.name] = f.default_value || "";
  });
  if (entField(e, "create_ts")) r.create_ts = stamp;
  if (entField(e, "update_ts")) r.update_ts = stamp;
  if (entField(e, "user_create")) r.user_create = (me && me.email) || "panel";
  if (entField(e, "user_update")) r.user_update = (me && me.email) || "panel";
  return r;
}

/* ============================================================
   МОДАЛЬНЫЕ ОКНА: заведение записи и подтверждение удаления.
   Запись создаётся только по «Сохранить» — раньше пустая строка
   появлялась в списке сразу по клику и оставалась там, если
   заполнять её передумали.
   ============================================================ */
var ENT_MODAL = null;   /* { kind:'create'|'delete', entity, draft, rec, err } */

function entModalFieldHtml(e, f, draft){
  /* редактор тот же, что в карточке, но всегда открытый: карточка правит по
     одному полю, а здесь заполняется вся запись сразу */
  var v = draft[f.name], html;
  if (f.ui_type === "checkbox"){
    return '<label class="ent-m-check"><input type="checkbox" data-mf="' + entEsc(f.name) + '"' +
      (v === true ? " checked" : "") + "><span>" + entEsc(f.label || f.name) + "</span></label>";
  }
  if (f.ui_type === "picklist"){
    html = '<select class="ent-in" data-mf="' + entEsc(f.name) + '"><option value="">—</option>' +
      (f.options || []).map(function(o){
        return '<option value="' + entEsc(o) + '"' + (String(v) === String(o) ? " selected" : "") + ">" + entEsc(o) + "</option>";
      }).join("") + "</select>";
  } else if (f.ui_type === "lookup"){
    var te = entEntity(f.target_entity);
    html = te
      ? '<select class="ent-in" data-mf="' + entEsc(f.name) + '"><option value="">—</option>' +
        (ENT_DATA[te.id] || []).map(function(x){
          return '<option value="' + entEsc(x.id) + '"' + (String(v) === String(x.id) ? " selected" : "") +
            ">#" + entEsc(x.id) + " · " + entEsc(entTitle(te, x)) + "</option>";
        }).join("") + "</select>"
      : '<input type="text" class="ent-in" data-mf="' + entEsc(f.name) + '" value="' + entEsc(v || "") + '">';
  } else if (f.ui_type === "multilookup"){
    var me2 = entEntity(f.target_entity), cur = Array.isArray(v) ? v.map(String) : [];
    var rows = me2 ? (ENT_DATA[me2.id] || []) : [];
    html = '<div class="ent-multi" data-mf="' + entEsc(f.name) + '">' + (rows.length ? rows.map(function(x){
      return '<label><input type="checkbox" value="' + entEsc(x.id) + '"' +
        (cur.indexOf(String(x.id)) >= 0 ? " checked" : "") + "><span>#" + entEsc(x.id) + " · " +
        entEsc(entTitle(me2, x)) + "</span></label>";
    }).join("") : '<span class="none">' + entT("записей нет") + "</span>") + "</div>";
  } else if (f.ui_type === "textarea"){
    html = '<textarea class="ent-in" data-mf="' + entEsc(f.name) + '">' + entEsc(v || "") + "</textarea>";
  } else if (f.ui_type === "date" || f.ui_type === "time"){
    html = '<input type="' + f.ui_type + '" class="ent-in" data-mf="' + entEsc(f.name) + '" value="' + entEsc(v || "") + '">';
  } else if (f.ui_type === "datetime"){
    html = '<input type="datetime-local" class="ent-in" data-mf="' + entEsc(f.name) + '" value="' + entEsc(entToInput(f, v)) + '">';
  } else if (f.ui_type === "number" || f.ui_type === "currency" || f.ui_type === "percent"){
    html = '<input type="text" inputmode="decimal" class="ent-in" data-mf="' + entEsc(f.name) + '" value="' + entEsc(v === "" ? "" : v) + '">';
  } else {
    html = '<input type="text" class="ent-in" data-mf="' + entEsc(f.name) + '" value="' + entEsc(v || "") + '">';
  }
  var wide = ["textarea","multilookup"].indexOf(f.ui_type) >= 0;
  /* звёздочка считается по черновику: поле могло стать обязательным только что,
     когда выбрали значение управляющего поля */
  return '<div class="ent-m-fg' + (wide ? " wide" : "") + '"><label>' + entEsc(f.label || f.name) +
    (entRequired(e, f, draft) ? '<span class="req">*</span>' : "") + "</label>" + html + "</div>";
}

function entModalHtml(){
  if (!ENT_MODAL) return "";
  var e = ENT_MODAL.entity;
  if (ENT_MODAL.kind === "delete"){
    var r = ENT_MODAL.rec;
    return '<div class="ent-modal open"><div class="ent-modal-card sm" role="dialog" aria-modal="true">' +
      '<div class="ent-modal-head"><h3>' + entT("Удалить запись?") + "</h3></div>" +
      '<div class="ent-modal-body"><p class="ent-m-ask">' +
        entT("Запись будет удалена без возможности отменить.") + "</p>" +
        '<div class="ent-m-target"><span class="ch">' + entEsc(e.label) + "</span>" +
          "<b>" + entEsc(entTitle(e, r)) + '</b><span class="mono">id ' + entEsc(r.id) + "</span></div></div>" +
      '<div class="ent-modal-foot">' +
        '<button type="button" class="ent-btn" data-m-cancel="1">' + entT("Отмена") + "</button>" +
        '<button type="button" class="ent-btn danger solid" data-m-del="1">' + entT("Удалить") + "</button>" +
      "</div></div></div>";
  }
  /* создание: поля разложены теми же смысловыми блоками, что и карточка */
  var L = entLayout(e), draft = ENT_MODAL.draft;
  var blocks = L.blocks.map(function(g){
    /* зависимые поля прячем и в форме: при смене управляющего поля форма
       перерисовывается, и блок появляется сразу (см. entModalRender) */
    var fields = g.fields.filter(function(f){
      return entEditable(f) && !entFieldState(e, f, draft).hidden;
    });
    if (!fields.length) return "";
    return '<div class="ent-m-sec"><div class="ent-m-sec-t">' + entEsc(entT(g.title)) + "</div>" +
      '<div class="ent-m-grid">' + fields.map(function(f){ return entModalFieldHtml(e, f, draft); }).join("") + "</div></div>";
  }).join("");
  return '<div class="ent-modal open"><div class="ent-modal-card" role="dialog" aria-modal="true">' +
    '<div class="ent-modal-head"><h3>' + entT("Новая запись") + ": " + entEsc(e.label) + "</h3>" +
      '<button type="button" class="ent-modal-x" data-m-cancel="1" title="' + entT("Отмена") + '">✕</button></div>' +
    '<div class="ent-modal-body">' + blocks + "</div>" +
    '<div class="ent-modal-foot">' +
      (ENT_MODAL.err ? '<span class="ent-m-err">' + entEsc(ENT_MODAL.err) + "</span>" : "") +
      '<button type="button" class="ent-btn" data-m-cancel="1">' + entT("Отмена") + "</button>" +
      '<button type="button" class="ent-btn accent" data-m-save="1">' + entT("Сохранить") + "</button>" +
    "</div></div></div>";
}

function entModalRender(){
  var host = document.getElementById("entModalHost");
  if (!host) return;
  host.innerHTML = entModalHtml();
  if (!ENT_MODAL) return;
  var e = ENT_MODAL.entity;
  host.querySelectorAll("[data-m-cancel]").forEach(function(b){ b.onclick = entModalClose; });
  var overlay = host.querySelector(".ent-modal");
  if (overlay) overlay.onmousedown = function(ev){ if (ev.target === overlay) entModalClose(); };
  var del = host.querySelector("[data-m-del]");
  if (del) del.onclick = function(){ entDeleteConfirmed(e, ENT_MODAL.rec); };
  var save = host.querySelector("[data-m-save]");
  if (save) save.onclick = function(){ entCreateSave(e); };
  /* черновик держим в состоянии, а не только в DOM: перерисовка по ошибке
     не должна терять уже введённое */
  host.querySelectorAll("[data-mf]").forEach(function(el){
    if (el.classList.contains("ent-multi")){
      el.querySelectorAll("input").forEach(function(cb){
        cb.onchange = function(){
          ENT_MODAL.draft[el.dataset.mf] = [].slice.call(el.querySelectorAll("input:checked")).map(function(c){
            var n = Number(c.value); return isFinite(n) && String(n) === c.value ? n : c.value;
          });
        };
      });
      return;
    }
    var read = function(){
      var f = entField(e, el.dataset.mf);
      if (!f) return;
      if (f.ui_type === "checkbox") ENT_MODAL.draft[f.name] = !!el.checked;
      else if (f.ui_type === "datetime") ENT_MODAL.draft[f.name] = el.value ? el.value.replace("T", " ") : "";
      else if (["number","currency","percent"].indexOf(f.ui_type) >= 0){
        var n = Number(String(el.value).replace(",", ".").replace(/\s/g, ""));
        ENT_MODAL.draft[f.name] = el.value === "" ? "" : (isFinite(n) ? n : el.value);
      } else if (f.ui_type === "lookup"){
        var v = el.value; var n2 = Number(v);
        ENT_MODAL.draft[f.name] = v === "" ? null : (isFinite(n2) && String(n2) === v ? n2 : v);
      } else ENT_MODAL.draft[f.name] = el.value;
      /* поле управляет показом других — перерисовываем форму, чтобы зависимый
         блок появился (или исчез) сразу, а не после сохранения */
      if (entControls(e, f.name)) entModalRender();
    };
    if (el.tagName === "SELECT" || el.type === "checkbox") el.onchange = read; else el.oninput = read;
  });
  var first = host.querySelector(".ent-modal-body .ent-in, .ent-modal-body input");
  if (first) setTimeout(function(){ try { first.focus(); } catch(err){} }, 30);
}
function entModalOpen(state){ ENT_MODAL = state; entModalRender(); }
function entModalClose(){ ENT_MODAL = null; entModalRender(); }
document.addEventListener("keydown", function(ev){
  if (ev.key === "Escape" && ENT_MODAL) { ev.stopPropagation(); entModalClose(); }
});

/* «＋ Новая запись» — форма, а не сразу пустая строка в списке */
function entNewRecord(e){
  entModalOpen({ kind:"create", entity:e, draft: entBlankRecord(e), err:"" });
}
function entCreateSave(e){
  var r = ENT_MODAL.draft;
  entApplyMirror(e, r);
  /* Обязательные поля: флажок и ноль — законные значения, поэтому проверяем
     только пустую строку/отсутствие. Скрытые условием не проверяем: их и
     заполнить было негде. Обязательность считается по самой записи —
     поле могло стать обязательным из-за выбранных значений. */
  var miss = e.fields.filter(function(f){
    if (!entEditable(f) || !entRequired(e, f, r)) return false;
    if (entFieldState(e, f, r).hidden) return false;
    return entIsEmpty(r[f.name]);
  }).map(function(f){ return f.label || f.name; });
  if (miss.length){
    ENT_MODAL.err = entT("Заполните") + ": " + miss.join(", ");
    entModalRender();
    return;
  }
  r.id = entNextId(entRows(e.id));
  entRows(e.id).push(r);
  ENT_CUR.rec = r.id; ENT_CUR.edit = null; ENT_CUR.mode = "card"; ENT_CUR.tab = "details";
  entStore(); entModalClose(); entRender();
  entToast(entT("Запись создана"));
}

/* удаление — только через подтверждение */
function entDeleteRecord(e, r){
  if (!r) return;
  entModalOpen({ kind:"delete", entity:e, rec:r });
}
function entDeleteConfirmed(e, r){
  ENT_DATA[e.id] = entRows(e.id).filter(function(x){ return String(x.id) !== String(r.id); });
  ENT_CUR.rec = null; ENT_CUR.edit = null; ENT_CUR.mode = "list";
  entStore(); entModalClose(); entRender();
  entToast(entT("Запись удалена"));
}
/* переход по связи: открыть другую сущность на нужной записи */
/* Переход по связи ведёт в КОНКРЕТНУЮ таблицу, а подраздел в меню заведён на
   сущность — поэтому открываем подраздел её схемы, а таблицу выставляем сами,
   минуя промежуточный экран: человек шёл к записи, а не выбирать таблицу. */
function entGo(entityId, recId){
  var e = entEntity(entityId);
  if (!e) return;
  var schema = entSchemaOf(e), head = entSchemaHead(schema);
  if (typeof openSection === "function") openSection("entities", "ent-" + (head ? head.id : entityId));
  ENT_CUR.schema = schema; ENT_CUR.id = entityId;
  ENT_CUR.rec = recId; ENT_CUR.edit = null; ENT_CUR.mode = "card"; ENT_CUR.tab = "details";
  entRender();
  var v = document.getElementById("view-entity"); if (v) v.scrollTop = 0;
}
/* вызывается из openSection при открытии подраздела: id подраздела — сущность,
   и начинаем всегда с её таблиц */
function entOpen(headId){
  var head = entEntity(headId);
  ENT_CUR.schema = head ? entSchemaOf(head) : headId;
  ENT_CUR.id = null; ENT_CUR.rec = null; ENT_CUR.mode = "tables";
  ENT_CUR.q = ""; ENT_CUR.edit = null; ENT_CUR.gear = false;
  entRender();
}
/* возврат с записей к таблицам сущности */
function entBackToTables(){
  ENT_CUR.id = null; ENT_CUR.rec = null; ENT_CUR.mode = "tables"; ENT_CUR.edit = null;
  entRender();
  var v = document.getElementById("view-entity"); if (v) v.scrollTop = 0;
}
/* клик мимо панели шестерёнки — закрываем её */
document.addEventListener("mousedown", function(ev){
  if (!ENT_CUR.gear) return;
  if (ev.target.closest && ev.target.closest(".ent-gear-wrap")) return;
  ENT_CUR.gear = false;
  if (ENT_CUR.id) entRender();
});

/* ---------- обзорная страница раздела ---------- */
function entRenderOverview(){
  var grid = document.getElementById("entOvGrid");
  if (!grid) return;
  var items = ENT_MODEL.entities.filter(entAllowed);
  if (!items.length){
    grid.innerHTML = '<div class="ent-empty">' +
      entT("В схеме пока нет сущностей. Заведите первую в Scheme Builder (настроечная админка).") + "</div>";
    return;
  }
  grid.innerHTML = items.map(function(e){
    var rows = (ENT_DATA[e.id] || []).length;
    var api = e.source === "templates";
    return '<div class="ov-card" data-nav-ref="ent-' + entEsc(e.id) + '"' +
      (api ? ' data-acl-section="templates"' : ' data-no-acl="1"') + ' data-ent="' + entEsc(e.id) + '">' +
      '<div class="ov-ico">' + (api ? (ICONS.list || ICONS.doc) : (ICONS.table || ICONS.doc)) + "</div>" +
      "<h3>" + entEsc(e.plural_label || e.label) + "</h3>" +
      '<div class="ov-meta">' + entEsc(e.table || e.id) + " · " + entPlural(e.fields.length, "field") +
        (api ? " · " + entT("данные из API") : " · " + entPlural(rows, "record")) + "</div>" +
      "<p>" + entEsc(e.description || entT("Список записей и карточка: поля по смысловым блокам, переходы по связям.")) + "</p>" +
      '<span class="ov-go">' + entT("Открыть →") + "</span></div>";
  }).join("");
  grid.querySelectorAll("[data-ent]").forEach(function(card){
    card.onclick = function(){ openSection("entities", "ent-" + card.dataset.ent); };
  });
}

/* ---------- навигация: подраздел на каждую сущность ---------- */
function entSyncNav(){
  var grp = (typeof NAV !== "undefined") && NAV.filter(function(n){ return n.id === "entities"; })[0];
  if (!grp) return;
  grp.children = ENT_MODEL.entities.filter(entAllowed).map(function(e){
    /* Сущность с source живёт не в браузере, а в БД приложения, и у неё есть свой
       готовый экран. «Шаблоны и сегменты» (source:"templates") — это список шаблонов
       из раздела «Управление коммуникациями»: подраздел ведёт на него, а доступ
       следует серверной секции templates, а не клиентскому реестру. */
    if (e.source === "templates") return {
      id: "ent-" + e.id, label: e.plural_label || e.label, icon: "list",
      view: "sec-admin", adminMode: "list", aclSection: "templates"
    };
    return {
      id: "ent-" + e.id, label: e.plural_label || e.label, icon: "table",
      view: "view-entity", entity: e.id,
      /* сюда попадают только разрешённые сущности (фильтр entAllowed выше), поэтому
         отдельный adminOnly у пункта не нужен. noAcl обязателен: серверной секции
         у сущностей нет, и без него пункт срезался бы фильтром me.sections даже
         у администратора. */
      noAcl: true
    };
  });
  /* Раздел прячем как админский, только если доступной сущности нет ни одной.
     Иначе роль, которой доступ выдали явно (entAccessSet), видела бы карточку
     на обзорной странице, но не сам пункт в сайдбаре. */
  grp.adminOnly = !grp.children.length;
  if (typeof renderNav === "function") renderNav();
  entRenderOverview();
  /* открытая сущность исчезла из схемы — уходим на обзор */
  if (ENT_CUR.id && !entEntity(ENT_CUR.id) && typeof cur !== "undefined" && cur.sid === "entities")
    openSection("entities");
}

/* ---------- стартовые данные: по три записи на сущность ----------
   Связки специально разные: лид с клиентом и без, клиент с двумя местами
   работы, с одним и без них, контактный канал клиента, канал лида и канал,
   привязанный сразу к обоим. */
function entSeedData(){
  return {
    record_type: [
      { id:1, entity_name:"work", name:"Основное место работы", code:"work_primary",
        fields_config:'{"required":["organization_name","position"],"visible":["start_date","inn"]}', is_active:true,
        create_ts:"2026-01-12 10:15", update_ts:"2026-01-12 10:15", user_create:"system", user_update:"system" },
      { id:2, entity_name:"work", name:"Подработка", code:"work_secondary",
        fields_config:'{"required":["organization_name"],"visible":["position"]}', is_active:true,
        create_ts:"2026-01-12 10:16", update_ts:"2026-02-03 14:02", user_create:"system", user_update:"a.korobskii" },
      { id:3, entity_name:"work", name:"Собственный бизнес", code:"work_business",
        fields_config:'{"required":["organization_name","inn","ogrn"],"visible":["legal_address"]}', is_active:false,
        create_ts:"2026-01-12 10:17", update_ts:"2026-04-21 09:30", user_create:"system", user_update:"a.korobskii" }
    ],
    work: [
      { id:1, record_type_id:1, organization_name:"ПАО «Банки.ру»", position:"Ведущий аналитик",
        legal_address:"г. Москва, ул. Тимура Фрунзе, д. 11, стр. 2",
        actual_address:"г. Москва, ул. Тимура Фрунзе, д. 11, стр. 2",
        start_date:"2021-03-15", inn:"7723456789", ogrn:"1157746000011",
        create_ts:"2026-01-15 11:00", update_ts:"2026-01-15 11:00", user_create:"system", user_update:"system" },
      { id:2, record_type_id:2, organization_name:"ООО «Финтех Лаб»", position:"Внешний консультант",
        legal_address:"г. Санкт-Петербург, наб. реки Мойки, д. 58, лит. А", actual_address:"",
        start_date:"2023-09-01", inn:"7801234567", ogrn:"1207800000022",
        create_ts:"2026-01-15 11:05", update_ts:"2026-03-02 16:40", user_create:"system", user_update:"a.korobskii" },
      { id:3, record_type_id:3, organization_name:"ИП Соколова А. В.", position:"Владелец",
        legal_address:"г. Казань, ул. Баумана, д. 44, кв. 12",
        actual_address:"г. Казань, ул. Баумана, д. 44, кв. 12",
        start_date:"2019-06-10", inn:"166012345678", ogrn:"319169000000033",
        create_ts:"2026-01-15 11:09", update_ts:"2026-01-15 11:09", user_create:"system", user_update:"system" }
    ],
    /* client: две работы / одна работа / без работ */
    client: [
      { id:1, main_myb_id:48201933, user_id:9910233, person_id:5512088,
        first_name:"Иван", second_name:"Петрович", last_name:"Смирнов",
        has_children:true, has_real_estate:true, has_pets:false, has_car:true,
        work_ids:[1,2],
        passport_series:"4519", passport_number:"772341", passport_issued_by:"ГУ МВД России по г. Москве",
        passport_issue_date:"2019-04-22", passport_department_code:"770-053",
        registration_address:"г. Москва, ул. Профсоюзная, д. 104, кв. 51",
        actual_address_of_residence:"г. Москва, ул. Профсоюзная, д. 104, кв. 51", address_is_equal:true,
        inn:"773301122334", snils:"112-233-445 95",
        driver_license_series:"7722", driver_license_number:"445566", driver_license_issue_date:"2020-08-14",
        personal_data:true, advertisement:true, bank_credit_history:true, esia:true, marketplace:true,
        blacklist_callcenter:false, blacklist_sms:false, blacklist_email:false,
        blacklist_mobile_push:false, blacklist_vk:false, blacklist_finassistant:false,
        monthly_income:185000, credit_score_banki:842, mfo_credit_score_banki:790, credit_score_okb:815,
        mfo_credit_score_okb:770, credit_score_scoring_bureau:801, mfo_credit_score_scoring_bureau:764,
        credit_score_nbki:828, application_score:0.8431,
        has_credit_self_ban:false, credit_self_ban_start_date:"", credit_self_ban_condition:"",
        create_ts:"2026-02-01 09:12", update_ts:"2026-05-18 12:44", user_create:"system", user_update:"a.korobskii" },
      { id:2, main_myb_id:48213077, user_id:9911044, person_id:5512199,
        first_name:"Анна", second_name:"Викторовна", last_name:"Соколова",
        has_children:true, has_real_estate:false, has_pets:true, has_car:false,
        work_ids:[3],
        passport_series:"9218", passport_number:"330145", passport_issued_by:"МВД по Республике Татарстан",
        passport_issue_date:"2018-11-30", passport_department_code:"160-004",
        registration_address:"г. Казань, ул. Баумана, д. 44, кв. 12",
        actual_address_of_residence:"г. Москва, Ленинградский пр-т, д. 78, кв. 210", address_is_equal:false,
        inn:"166012345678", snils:"223-344-556 07",
        driver_license_series:"", driver_license_number:"", driver_license_issue_date:"",
        personal_data:true, advertisement:false, bank_credit_history:true, esia:false, marketplace:true,
        blacklist_callcenter:true, blacklist_sms:false, blacklist_email:false,
        blacklist_mobile_push:false, blacklist_vk:true, blacklist_finassistant:false,
        monthly_income:240000, credit_score_banki:769, mfo_credit_score_banki:712, credit_score_okb:744,
        mfo_credit_score_okb:701, credit_score_scoring_bureau:738, mfo_credit_score_scoring_bureau:695,
        credit_score_nbki:751, application_score:0.6127,
        has_credit_self_ban:true, credit_self_ban_start_date:"2026-03-04",
        credit_self_ban_condition:"Все виды кредитов, дистанционно",
        create_ts:"2026-02-04 15:31", update_ts:"2026-06-02 10:05", user_create:"system", user_update:"a.korobskii" },
      { id:3, main_myb_id:48298110, user_id:9913377, person_id:"",
        first_name:"Дмитрий", second_name:"Сергеевич", last_name:"Ковалёв",
        has_children:false, has_real_estate:false, has_pets:false, has_car:false,
        work_ids:[],
        passport_series:"", passport_number:"", passport_issued_by:"", passport_issue_date:"",
        passport_department_code:"",
        registration_address:"г. Новосибирск, ул. Кирова, д. 27, кв. 3",
        actual_address_of_residence:"", address_is_equal:false,
        inn:"", snils:"",
        driver_license_series:"", driver_license_number:"", driver_license_issue_date:"",
        personal_data:true, advertisement:false, bank_credit_history:false, esia:false, marketplace:false,
        blacklist_callcenter:true, blacklist_sms:true, blacklist_email:false,
        blacklist_mobile_push:true, blacklist_vk:false, blacklist_finassistant:true,
        monthly_income:"", credit_score_banki:"", mfo_credit_score_banki:"", credit_score_okb:"",
        mfo_credit_score_okb:"", credit_score_scoring_bureau:"", mfo_credit_score_scoring_bureau:"",
        credit_score_nbki:"", application_score:"",
        has_credit_self_ban:false, credit_self_ban_start_date:"", credit_self_ban_condition:"",
        create_ts:"2026-06-20 18:22", update_ts:"2026-06-20 18:22", user_create:"system", user_update:"system" }
    ],
    /* lead: сконвертированный в клиента / без клиента / клиент + работа */
    lead: [
      { id:1, myb_id:48201933, client_id:1,
        first_name:"Иван", second_name:"Петрович", last_name:"Смирнов",
        has_children:true, has_real_estate:true, has_pets:false, has_car:true,
        work_ids:[1], status:"completed",
        create_ts:"2026-01-28 08:40", update_ts:"2026-02-01 09:12", user_create:"system", user_update:"system" },
      { id:2, myb_id:48350021, client_id:null,
        first_name:"Ольга", second_name:"", last_name:"Мельникова",
        has_children:false, has_real_estate:false, has_pets:true, has_car:false,
        work_ids:[], status:"new",
        create_ts:"2026-07-14 12:05", update_ts:"2026-07-14 12:05", user_create:"system", user_update:"system" },
      { id:3, myb_id:48213077, client_id:2,
        first_name:"Анна", second_name:"Викторовна", last_name:"Соколова",
        has_children:true, has_real_estate:false, has_pets:true, has_car:false,
        work_ids:[3], status:"active",
        create_ts:"2026-02-02 19:47", update_ts:"2026-06-02 10:05", user_create:"system", user_update:"a.korobskii" }
    ],
    /* client_contact_info: канал клиента / канал лида без клиента / канал сразу обоих */
    client_contact_info: [
      { id:1, client_id:1, lead_id:null, value:"i.smirnov@example.com", type:"email",
        double_opt_in:true, status:"valid", score:96,
        create_ts:"2026-02-01 09:12", update_ts:"2026-05-18 12:44", user_create:"system", user_update:"a.korobskii" },
      { id:2, client_id:null, lead_id:2, value:"+7 916 500-11-22", type:"mobile",
        double_opt_in:false, status:"unknown", score:35,
        create_ts:"2026-07-14 12:05", update_ts:"2026-07-14 12:05", user_create:"system", user_update:"system" },
      { id:3, client_id:2, lead_id:3, value:"fcm:APA91bH7q2Zx…", type:"mobile_token",
        /* демонстрирует пару «платформа + транспорт»: токен выдан AppMetrica,
           физически уходит через FCM на Android */
        token_type:"fcm", delivery_platform:"appmetrica",
        platform_token:"am:9f3c1d2e-77b4-4a10-8ce1-5b2d0f6a1c33",
        os:"android", app_version:"5.24.1",
        double_opt_in:true, status:"temporarily_unavailable", score:58,
        create_ts:"2026-02-04 15:31", update_ts:"2026-06-02 10:05", user_create:"system", user_update:"a.korobskii" }
    ]
  };
}
/* тестовые записи заводятся один раз на сущность: правки пользователя не трогаем,
   но сущность, у которой данных ещё нет, получает свой стартовый набор */
function entSeed(){
  var seeded = entRead(ENT_SEED_KEY, null);
  if (!seeded || seeded.v !== ENT_SEED_VER) seeded = { v: ENT_SEED_VER, done: [] };
  var seed = entSeedData(), changed = false;
  ENT_MODEL.entities.forEach(function(e){
    if (seeded.done.indexOf(e.id) >= 0) return;
    if (!seed[e.id]) return;
    if (!ENT_DATA[e.id] || !ENT_DATA[e.id].length){ ENT_DATA[e.id] = seed[e.id]; changed = true; }
    seeded.done.push(e.id);
    changed = true;
  });
  if (changed){ entWrite(ENT_SEED_KEY, seeded); entStore(); }
}

/* ---------- старт ---------- */
function entBoot(){
  return entLoadSchema().then(function(m){
    ENT_MODEL = { entities: (m && m.entities) || [], relations: (m && m.relations) || [] };
    ENT_DATA = entRead(ENT_DATA_KEY, {}) || {};
    entAclSeed();
    entSeed();
    /* приводим зависимые поля в согласованное состояние: данные могли быть
       записаны до появления правила либо изменены в другой вкладке */
    var fixed = false;
    ENT_MODEL.entities.forEach(function(e){
      (ENT_DATA[e.id] || []).forEach(function(r){ if (entApplyMirror(e, r)) fixed = true; });
    });
    if (fixed) entStore();
    entSyncNav();
    if (ENT_WANT && ENT_MODEL.entities.some(function(e){ return "ent-" + e.id === ENT_WANT; })){
      if (typeof cur !== "undefined" && cur.sid === "entities" && !cur.cid) openSection("entities", ENT_WANT);
      ENT_WANT = null;
    }
  });
}
/* сущность завели/удалили в Scheme Builder (другая вкладка) — пересобираем подразделы */
window.addEventListener("storage", function(ev){
  if (ev.key !== ENT_DRAFT_KEY && ev.key !== ENT_ACL_KEY) return;
  entBoot().then(function(){ if (ENT_CUR.id) entRender(); });
});

(function(){
  var go = function(){ entBoot(); };
  if (window.CRM && CRM.meReady) CRM.meReady.then(go, go); else go();
})();
