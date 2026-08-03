/* =========================================================
   СУЩНОСТИ — данные CRM по схеме из Scheme Builder.

   ОТКУДА БЕРУТСЯ ПОДРАЗДЕЛЫ. Источник истины — та же схема, что и у
   Scheme Builder: файл settings/schema/crm-schema.json плюс черновик
   правок в localStorage (crmpanel:schemaDraft). Каждая сущность схемы
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
var ENT_CUR = { id:null, rec:null, edit:null, closed:{} };

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
  rel:    { en:["relation","relations"], ru:["связь","связи","связей"] }
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
function entAllowed(e){
  /* техническая сущность (флаг ставится в настройках) в панели не показывается
     вообще: это служебный справочник, работать с ним нужно в схеме, а не здесь */
  if (e.technical) return false;
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
  /* черновик Scheme Builder перекрывает файл — ровно как в SchemaStore.load */
  var draft = entRead(ENT_DRAFT_KEY, null);
  if (draft && draft.entities) return Promise.resolve(draft);
  return fetch(ENT_FILE + "?v=" + Date.now(), { cache:"no-store" })
    .then(function(r){ if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .catch(function(){ return { version:"0", entities:[], relations:[] }; });
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
function entMirrorRule(e, name){ return (ENT_MIRROR[e.id] || {})[name] || null; }
/* состояние зависимого поля для текущей записи */
function entFieldState(e, f, r){
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
  var label = '<div class="l"><span>' + entEsc(f.label || f.name) + "</span>" +
    (f.required ? '<span class="req" title="' + entT("Обязательное поле") + '">*</span>' : "") +
    '<span class="api">' + entEsc(f.name) + "</span></div>";
  /* поле-зеркало: значение подтягивается из источника и не правится вручную */
  if (st.mirrored){
    var src = entField(e, st.rule.from);
    return '<div class="ent-row' + (wide ? " wide" : "") + ' mirrored" data-f="' + entEsc(f.name) + '">' + label +
      entValueHtml(e, f, r) +
      '<div class="ent-mirror-note">' + entT("подтягивается из поля") + " «" +
      entEsc(src ? (src.label || src.name) : st.rule.from) + "»</div></div>";
  }
  var body = editing ? entEditorHtml(e, f, r) : entValueHtml(e, f, r);
  var pen = (!editing && entEditable(f))
    ? '<button type="button" class="ent-pen" data-edit="' + entEsc(f.name) + '" title="' + entT("Редактировать") + '">' + ENT_PEN + "</button>"
    : "";
  return '<div class="ent-row' + (wide ? " wide" : "") + (editing ? " editing" : "") +
    '" data-f="' + entEsc(f.name) + '">' + label + body + pen + "</div>";
}

function entCardHtml(e, r){
  var L = entLayout(e);
  var secs = L.blocks.map(function(g){
    var rows = g.fields.map(function(f){ return entRowHtml(e, f, r); }).join("");
    if (!rows) return "";                       /* весь блок скрыт зависимостями */
    var shown = g.fields.filter(function(f){ return !entFieldState(e, f, r).hidden; }).length;
    var closed = ENT_CUR.closed[e.id + ":" + g.title] ? " closed" : "";
    return '<div class="ent-sec' + closed + '" data-sec="' + entEsc(g.title) + '">' +
      '<div class="ent-sec-title">' + entEsc(entT(g.title)) +
      '<span class="cnt">' + shown + "</span></div>" +
      '<div class="ent-grid">' + rows + "</div></div>";
  }).join("");
  /* верхняя строка карточки: поля настраиваются в админке («Сущности» → В шапке) */
  var head = L.header.map(function(f){
    var v = r[f.name];
    if (v === undefined || v === null || v === "") return "";
    return '<span class="hf"><i>' + entEsc(f.label || f.name) + "</i>" + entEsc(v) + "</span>";
  }).join("");
  return '<div class="ent-card">' +
    '<div class="ent-card-head"><span class="ch">' + entEsc(e.label) + "</span>" +
      "<b>" + entEsc(entTitle(e, r)) + "</b>" + head +
      '<span class="id">' + entEsc(e.table || e.id) + " · id " + entEsc(r.id) + "</span>" +
      '<span class="acts">' +
        '<button type="button" class="ent-btn danger" data-del="1">' + entT("Удалить запись") + "</button>" +
      "</span></div>" + secs + "</div>";
}

function entHeroHtml(e){
  var rows = (ENT_DATA[e.id] || []).length;
  var rels = ENT_MODEL.relations.filter(function(x){ return x.from_entity === e.id || x.to_entity === e.id; }).length;
  return '<header class="ent-hero">' +
    '<div class="eyebrow">CRM · ' + entT("Данные") + " · " + entEsc(e.table || e.id) + "</div>" +
    "<h1>" + entEsc(e.plural_label || e.label) + "</h1>" +
    '<p class="sub">' + entEsc(e.description || entT("Карточка записи по схеме Scheme Builder: поля разложены по смысловым блокам, каждое правится по карандашу. Правки сохраняются сразу.")) + "</p>" +
    '<div class="meta"><span>' + entPlural(e.fields.length, "field") + "</span>" +
      "<span>" + entPlural(rows, "record") + "</span>" +
      "<span>" + entPlural(rels, "rel") + "</span>" +
      "<span>" + entT("доступ") + ": ADMIN</span></div></header>";
}

function entRender(){
  var host = document.getElementById("entHost");
  if (!host) return;
  var e = entEntity(ENT_CUR.id);
  if (!e){
    host.innerHTML = '<div class="ent-empty">' + entT("Сущность не найдена в схеме. Проверьте Scheme Builder в настроечной админке.") + "</div>";
    return;
  }
  var list = entRows(e.id);
  if (!list.length){
    host.innerHTML = entHeroHtml(e) +
      '<div class="ent-recs"><button type="button" class="ent-add" data-new="1">＋ ' + entT("Новая запись") + "</button></div>" +
      '<div class="ent-empty">' + entT("Записей пока нет — заведите первую.") + "</div>" +
      '<div class="ent-toast" id="entToast"></div>';
    entWire(host, e, null);
    return;
  }
  if (!entRecById(e.id, ENT_CUR.rec)) ENT_CUR.rec = list[0].id;
  var r = entRecById(e.id, ENT_CUR.rec);

  var chips = list.map(function(x){
    return '<div class="ent-rec' + (String(x.id) === String(r.id) ? " active" : "") + '" data-rec="' + entEsc(x.id) + '">' +
      '<span class="n">#' + entEsc(x.id) + '</span><span class="t">' + entEsc(entTitle(e, x)) + "</span></div>";
  }).join("");

  host.innerHTML = entHeroHtml(e) +
    '<div class="ent-recs">' + chips +
      '<button type="button" class="ent-add" data-new="1">＋ ' + entT("Новая запись") + "</button></div>" +
    entCardHtml(e, r) +
    '<div class="ent-note"><b>' + entT("Как это работает:") + "</b> " +
      entT("подраздел построен по сущности из Scheme Builder: блоки полей собраны по смыслу, связи показаны ссылками на записи других сущностей — по ним можно перейти. Правка поля подтверждается ✓ (Enter), отменяется ✕ или Esc; клик мимо поля сохраняет значение. Изменения хранятся в браузере.") +
    "</div><div class=\"ent-toast\" id=\"entToast\"></div>";
  entWire(host, e, r);
}

function entToast(msg){
  var el = document.getElementById("entToast");
  if (!el) return;
  el.textContent = msg; el.classList.add("show");
  clearTimeout(entToast._t); entToast._t = setTimeout(function(){ el.classList.remove("show"); }, 1800);
}

/* ---------- обработчики ---------- */
function entWire(host, e, r){
  host.querySelectorAll(".ent-rec").forEach(function(el){
    el.onclick = function(){ ENT_CUR.rec = el.dataset.rec; ENT_CUR.edit = null; entRender(); };
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
  host.querySelectorAll(".ent-link[data-goe]").forEach(function(el){
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
function entNewRecord(e){
  var list = entRows(e.id), r = { id: entNextId(list) };
  e.fields.forEach(function(f){
    if (f.name === "id") return;
    if (f.ui_type === "checkbox") r[f.name] = false;
    else if (f.ui_type === "multilookup") r[f.name] = [];
    else if (f.ui_type === "related_list") return;
    else if (f.default_value) r[f.name] = f.default_value;
    else r[f.name] = "";
  });
  var now = new Date(), p = function(n){ return String(n).padStart(2, "0"); };
  var stamp = now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate()) +
    " " + p(now.getHours()) + ":" + p(now.getMinutes());
  var me = window.CRM_ME;
  if (entField(e, "create_ts")) r.create_ts = stamp;
  if (entField(e, "update_ts")) r.update_ts = stamp;
  if (entField(e, "user_create")) r.user_create = (me && me.email) || "panel";
  if (entField(e, "user_update")) r.user_update = (me && me.email) || "panel";
  list.push(r);
  ENT_CUR.rec = r.id; ENT_CUR.edit = null;
  entStore(); entRender();
  entToast(entT("Запись создана"));
}
function entDeleteRecord(e, r){
  if (!r || !confirm(entT("Удалить запись?") + " #" + r.id)) return;
  ENT_DATA[e.id] = entRows(e.id).filter(function(x){ return String(x.id) !== String(r.id); });
  ENT_CUR.rec = null; ENT_CUR.edit = null;
  entStore(); entRender();
  entToast(entT("Запись удалена"));
}
/* переход по связи: открыть другую сущность на нужной записи */
function entGo(entityId, recId){
  if (!entEntity(entityId)) return;
  ENT_CUR.rec = recId; ENT_CUR.edit = null;
  if (typeof openSection === "function") openSection("entities", "ent-" + entityId);
  ENT_CUR.rec = recId;
  entRender();
}
/* вызывается из openSection при открытии подраздела */
function entOpen(entityId){
  if (ENT_CUR.id !== entityId) { ENT_CUR.rec = null; }
  ENT_CUR.id = entityId; ENT_CUR.edit = null;
  entRender();
}

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
    return '<div class="ov-card" data-nav-ref="ent-' + entEsc(e.id) + '" data-no-acl="1" data-ent="' + entEsc(e.id) + '">' +
      '<div class="ov-ico">' + (ICONS.table || ICONS.doc) + "</div>" +
      "<h3>" + entEsc(e.plural_label || e.label) + "</h3>" +
      '<div class="ov-meta">' + entEsc(e.table || e.id) + " · " + entPlural(e.fields.length, "field") +
        " · " + entPlural(rows, "record") + "</div>" +
      "<p>" + entEsc(e.description || entT("Карточка записи с полями по смысловым блокам и переходами по связям.")) + "</p>" +
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
