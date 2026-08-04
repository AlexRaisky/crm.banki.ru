/* ============================================================
   SCHEME BUILDER — конструктор схемы данных CRM (настроечная админка).

   ХРАНЕНИЕ. Сейчас источник истины — файл в репозитории:
   settings/schema/crm-schema.json (то есть версионируется Git).
   Правки копятся черновиком в localStorage, кнопка «Сохранить в Git»
   отдаёт готовый файл для коммита.

   ПОДГОТОВКА К БД. Весь доступ к данным идёт через SchemaStore, а любая
   мутация модели — через commit(), который пишет журнал изменений
   (SchemaStore.journal). Когда появятся таблицы и REST, достаточно
   переключить SchemaStore.mode на 'api': load/save уйдут на эндпоинты
   (см. API_CONTRACT), а журнал станет источником дельт для сервера —
   логика редактора при этом не меняется.
   ============================================================ */
(function(){
"use strict";

/* ---- перевод: словарь настроечной админки (t2 объявлен в settings/index.html) ---- */
function T(s){ return (typeof window.t2 === "function") ? window.t2(s) : s; }
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

/* транслит для системных имён */
const RU_MAP = {"а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"e","ж":"zh","з":"z","и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"c","ч":"ch","ш":"sh","щ":"sch","ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya"};
const slug = s => String(s || "").trim().toLowerCase()
  .replace(/[а-яё]/g, ch => RU_MAP[ch] ?? ch).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/* ============================================================
   Типы данных: UI-тип определяет, как поле выглядит пользователю,
   тип БД — как оно хранится. db — рекомендуемый тип БД для UI-типа.
   ============================================================ */
const UI_TYPES = [
  { v:"text",         label:"Текст (строка)",             db:"varchar(255)" },
  { v:"textarea",     label:"Многострочный текст",        db:"text" },
  { v:"number",       label:"Число",                      db:"integer" },
  { v:"currency",     label:"Деньги (₽)",                 db:"numeric(15,2)" },
  { v:"percent",      label:"Процент (%)",                db:"numeric(5,2)" },
  { v:"email",        label:"E-mail",                     db:"varchar(255)" },
  { v:"phone",        label:"Телефон",                    db:"varchar(32)" },
  { v:"url",          label:"Ссылка (URL)",               db:"varchar(255)" },
  { v:"date",         label:"Дата",                       db:"date" },
  { v:"datetime",     label:"Дата и время",               db:"timestamp" },
  { v:"time",         label:"Время",                      db:"time" },
  { v:"checkbox",     label:"Флажок (да/нет)",            db:"boolean" },
  { v:"picklist",     label:"Список значений",            db:"varchar(32)" },
  { v:"lookup",       label:"Связь: один объект",         db:"bigint" },
  { v:"multilookup",  label:"Связь: несколько объектов",  db:"relation" },
  { v:"related_list", label:"Связанный список",           db:"relation" }
];
const DB_TYPES = ["bigserial","serial","bigint","integer","smallint","numeric(15,2)","numeric(8,2)","numeric(5,2)",
  "real","double precision","money","boolean","uuid","varchar(32)","varchar(60)","varchar(128)","varchar(255)",
  "char(1)","text","jsonb","json","date","time","timestamp","timestamptz","inet","relation"];
const REL_UI = ["lookup","multilookup","related_list"];
const REL_TYPES = ["one_to_one","many_to_one","one_to_many","many_to_many"];
const ON_DELETE = ["RESTRICT","CASCADE","SET NULL","NO ACTION"];
const uiMeta = v => UI_TYPES.find(x => x.v === v) || UI_TYPES[0];

/* семейство типа БД — чтобы не ругаться на разные UI одного семейства (число/деньги/процент) */
function dbFamily(db){
  const b = String(db || "").toLowerCase().trim().replace(/\(.*/, "").replace(/\s+/g, " ");
  if (!b) return "";
  if (b === "boolean" || b === "bool") return "bool";
  if (/serial$/.test(b) || ["bigint","int8","integer","int","int4","smallint","int2","numeric","decimal",
      "real","double precision","double","float","float8","float4","money"].includes(b)) return "numeric";
  if (b === "date") return "date";
  if (b.indexOf("timestamp") === 0) return "datetime";
  if (b.indexOf("time") === 0) return "time";
  if (b === "relation") return "relation";
  return "string";
}
function dbToUi(db){
  const fam = dbFamily(db), b = String(db || "").toLowerCase().replace(/\(.*/, "");
  if (fam === "bool") return "checkbox";
  if (fam === "numeric") return b === "money" ? "currency" : "number";
  if (fam === "date") return "date";
  if (fam === "datetime") return "datetime";
  if (fam === "time") return "time";
  if (fam === "relation") return "multilookup";
  if (b === "text" || b === "json" || b === "jsonb") return "textarea";
  return "text";
}
const UI_DB_OK = { text:["string"], textarea:["string"], email:["string"], phone:["string"], url:["string"],
  number:["numeric"], currency:["numeric"], percent:["numeric"], checkbox:["bool"],
  date:["date"], datetime:["datetime","date"], time:["time"], picklist:["string","numeric"] };

/* ============================================================
   SchemaStore — единая точка доступа к данным.
   mode:'git'  — файл settings/schema/crm-schema.json + черновик в localStorage
   mode:'api'  — REST поверх БД (см. API_CONTRACT), включается позже
   ============================================================ */
const API_CONTRACT = {
  /* GET  → {version, entities:[…], relations:[…]}         — текущая схема */
  load:    "/api/schema",
  /* PUT  ← вся модель                                     — полное сохранение */
  save:    "/api/schema",
  /* POST ← {changes:[{op,target,id,payload,ts}…]}         — дельты из journal */
  changes: "/api/schema/changes",
  /* GET  → [{id,ts,author,comment}]                       — история версий */
  history: "/api/schema/versions"
};
const SchemaStore = {
  /* 'api' — модель хранится на сервере (app.schema_model), это основной режим.
     'git' — прежнее поведение: файл в репозитории + черновик в localStorage.
     Режим НЕ жёсткий: если сервер недоступен или отказал, load() сам откатывается
     на 'git', и редактор продолжает работать. Молча ломаться он не должен. */
  mode: "api",
  file: "schema/crm-schema.json",
  draftKey: "crmpanel:schemaDraft",
  baseline: null,              /* сохранённая версия — с ней сравниваем «есть правки» */
  journal: [],                 /* дельты, уезжают на сервер вместе с сохранением */
  offline: false,              /* true — сервер отвалился, работаем от файла */

  async load(){
    if (this.mode === "api"){
      try {
        const r = await fetch(API_CONTRACT.load, { credentials:"same-origin" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const m = await r.json();
        this.baseline = JSON.parse(JSON.stringify(m));
        this.offline = false;
        return m;
      } catch (e){
        /* Откат к файлу: лучше редактор в режиме черновика, чем пустой экран. */
        this.mode = "git";
        this.offline = true;
        if (typeof console !== "undefined") console.warn("Scheme Builder: сервер недоступен, работаем от файла —", e);
      }
    }
    const r = await fetch(this.file + "?v=" + Date.now(), { cache:"no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status + " · " + this.file);
    const base = await r.json();
    this.baseline = JSON.parse(JSON.stringify(base));
    const draft = this.readDraft();
    /* Черновик накладываем НА файл, а не подменяем им файл: иначе сущность,
       добавленная в схему позже, не появилась бы ни у кого с готовым черновиком
       (так пропадали «Шаблоны и сегменты»). Удалённые вручную не возвращаются —
       их id лежат в model.deleted. Правило общее с панелью: ../js/entity-layout.js. */
    if (!draft) return base;
    return (window.EntityLayout && EntityLayout.mergeDraft)
      ? EntityLayout.mergeDraft(base, draft) : draft;
  },
  /* Никогда не бросает: save() зовут из commit() без await, и необработанное
     отклонение промиса пользователь бы не увидел, а правку потерял. */
  async save(model){
    if (this.mode === "api"){
      try {
        const r = await fetch(API_CONTRACT.save, {
          method:"PUT", credentials:"same-origin",
          headers:{ "Content-Type":"application/json" },
          /* модель и дельты одним запросом: сервер и сохранит, и запишет в журнал,
             кто что сделал — иначе журнал разъехался бы с состоянием */
          body: JSON.stringify({ model: model, changes: this.journal }) });
        if (!r.ok) throw new Error("HTTP " + r.status);
        this.baseline = JSON.parse(JSON.stringify(model));
        this.journal = [];
        this.offline = false;
        return true;
      } catch (e){
        /* Страховка: правку кладём в черновик браузера, журнал НЕ чистим —
           уедет со следующим удачным сохранением. */
        this.offline = true;
        this.writeDraft(model);
        toast(T("Не удалось сохранить на сервер — правка сохранена локально"));
        return false;
      }
    }
    this.writeDraft(model);      /* режим Git: черновик в браузере, файл — кнопкой */
    return true;
  },
  readDraft(){ try { const v = localStorage.getItem(this.draftKey); return v ? JSON.parse(v) : null; } catch(e){ return null; } },
  writeDraft(m){ try { localStorage.setItem(this.draftKey, JSON.stringify(m)); } catch(e){} },
  dropDraft(){ try { localStorage.removeItem(this.draftKey); } catch(e){} this.journal = []; },
  /* журнал мутаций — основа для POST /api/schema/changes */
  log(op, target, id, payload){
    this.journal.push({ op, target, id, payload, ts: new Date().toISOString() });
    if (this.journal.length > 500) this.journal.shift();
  },
  isDirty(model){
    if (!this.baseline) return false;
    return JSON.stringify(model) !== JSON.stringify(this.baseline);
  }
};

/* ---- состояние раздела ---- */
let model = { version:"2.0", entities:[], relations:[] };
/* expanded — какие сущности показывают все поля; это состояние интерфейса,
   в модель (и, значит, в Git) оно не попадает */
/* Навигация в панели — три уровня: сущность (схема) → таблица → колонка.
   schema выбран, entity нет  — показываем сущность и список её таблиц;
   entity выбран, field нет   — таблицу и список её колонок;
   field выбран               — саму колонку.
   Возврат наверх — по хлебным крошкам. */
const state = { scale:1, tx:20, ty:20, schema:null, entity:null, field:null, relation:null, tab:"entity",
                drag:null, pan:null, q:"", expanded:{} };
let booted = false;

const entityById = id => model.entities.find(e => e.id === id);
const relationById = id => model.relations.find(r => r.id === id);

/* ============================================================
   Уровень схемы. Сущность это схема, её таблицы лежат внутри.
   Хранение нормализованное: schemas[] — сами схемы, а у таблицы
   поле schema указывает, в какой она живёт. Вложенным деревом
   не делаем: плоский entities[] читают раздел «Сущности» и
   Object Manager, вложенность сломала бы обоих.
   ============================================================ */
/* Схема таблицы; пусто (старая модель) — таблица сама себе схема. */
function schemaOf(e){ return (e && e.schema) || (e && e.id) || ""; }

/* Все схемы: описанные явно плюс те, что упомянуты таблицами. */
function allSchemas(){
  if (!Array.isArray(model.schemas)) model.schemas = [];
  const seen = new Set(model.schemas.map(s => s.id));
  model.entities.forEach(e => {
    const id = schemaOf(e);
    if (id && !seen.has(id)){ seen.add(id); model.schemas.push({ id, label:id, description:"" }); }
  });
  return model.schemas;
}

/* Завести схему, если её ещё нет. Отдельной кнопки «создать схему» нет намеренно:
   вписал имя в поле «Схема» — схема появилась, это короче на два клика. */
function ensureSchema(id){
  if (!id) return null;
  if (!Array.isArray(model.schemas)) model.schemas = [];
  let s = model.schemas.find(x => x.id === id);
  if (!s){ s = { id, label:id, description:"" }; model.schemas.push(s); }
  return s;
}

/* Схема без единой таблицы смысла не имеет и в SQL не попадёт — убираем из списка,
   чтобы он не зарастал следами переименований. */
function pruneSchemas(){
  if (!Array.isArray(model.schemas)) return;
  const used = new Set(model.entities.map(schemaOf));
  model.schemas = model.schemas.filter(s => used.has(s.id));
}

/* любая правка модели идёт сюда: сохранение + журнал + перерисовка */
function commit(op, target, id, payload){
  SchemaStore.log(op, target, id, payload);
  SchemaStore.save(model);
  render();
}
function toast(msg){
  if (typeof window.sbToast === "function") return window.sbToast(msg);
  const el = document.getElementById("sbToast");
  if (!el) return;
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove("show"), 2000);
}

/* ============================================================
   Рендер
   ============================================================ */
function render(){ renderLists(); renderNodes(); renderEdges(); renderInspector(); renderStatus(); }

function renderStatus(){
  const st = $("#sbStatus"), dirty = $("#sbDirty");
  if (st) st.textContent = `${model.entities.length} ${T("сущн.")} · ${model.relations.length} ${T("связей")} · ${Math.round(state.scale*100)}%`;
  if (dirty) dirty.classList.toggle("on", SchemaStore.isDirty(model));
}

function matches(e){
  const q = state.q.trim().toLowerCase();
  if (!q) return true;
  return e.label.toLowerCase().includes(q) || e.id.includes(q) ||
    e.fields.some(f => f.name.toLowerCase().includes(q) || (f.label||"").toLowerCase().includes(q));
}
function renderLists(){
  const el = $("#sbEntityList");
  if (!el) return;
  /* В списке — только СУЩНОСТИ. Таблицы и колонки раскрываются в боковой панели:
     на схеме из сотни таблиц плоский список нечитаем, а сущностей всегда единицы. */
  const list = model.entities.filter(matches);
  const groups = allSchemas().filter(s => list.some(e => schemaOf(e) === s.id));
  el.innerHTML = groups.length ? groups.map(s => {
    const tables = list.filter(e => schemaOf(e) === s.id);
    const cols = tables.reduce((n, e) => n + e.fields.length, 0);
    return `<div class="sb-item sb-ent ${state.schema === s.id ? "active" : ""}" data-s="${esc(s.id)}">
      <span class="dot"></span>
      <span class="lbl">${esc(s.label || s.id)}<i class="sb-ent-sub mono">${esc(s.id)}</i></span>
      <span class="cnt" title="${T("таблиц / колонок")}">${tables.length} / ${cols}</span>
    </div>`;
  }).join("") : `<div class="sb-empty">${T("Ничего не найдено")}</div>`;
  $$("#sbEntityList .sb-ent").forEach(x => x.onclick = () => {
    state.schema = x.dataset.s; state.entity = null; state.field = null;
    setTab("entity"); render();
  });
  $("#sbEntityCount").textContent = model.entities.length;

  const rel = $("#sbRelationList");
  rel.innerHTML = model.relations.length ? model.relations.map(r =>
    `<div class="sb-item ${state.relation === r.id ? "active" : ""}" data-r="${esc(r.id)}">
      <span class="dot rel"></span><span class="lbl">${esc(r.from_entity)} → ${esc(r.to_entity)}</span></div>`).join("")
    : `<div class="sb-empty">${T("Связей пока нет")}</div>`;
  $$("#sbRelationList .sb-item").forEach(x => x.onclick = () => {
    state.relation = x.dataset.r; setTab("relation"); render();
  });
  $("#sbRelationCount").textContent = model.relations.length;
}

/* В свёрнутом узле показываем первые поля — иначе крупные сущности
   (у «Клиента» их 53) занимают весь экран. Остальные раскрываются по клику. */
const MAX_ROWS = 12;
/* «41 поле / 42 поля / 45 полей» — без склонения счётчик выглядит неряшливо */
function pluralField(n){
  if (UI_LANG_EN()) return n + (n === 1 ? " field" : " fields");
  const d10 = n % 10, d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return n + " поле";
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return n + " поля";
  return n + " полей";
}
function UI_LANG_EN(){ try { return JSON.parse(localStorage.getItem("crmpanel:lang")) === "en"; } catch(e){ return false; } }

function toggleFields(id){
  state.expanded[id] = !state.expanded[id];
  renderNodes(); renderEdges();      /* высота узла изменилась — пересчитываем связи */
}
/* переключатель «развернуть/свернуть все» в тулбаре */
function toggleAllFields(){
  const anyCollapsed = model.entities.some(e => e.fields.length > MAX_ROWS && !state.expanded[e.id]);
  model.entities.forEach(e => { state.expanded[e.id] = anyCollapsed; });
  renderNodes(); renderEdges(); syncExpandBtn();
}
function syncExpandBtn(){
  const btn = $("#sbExpand");
  if (!btn) return;
  const anyCollapsed = model.entities.some(e => e.fields.length > MAX_ROWS && !state.expanded[e.id]);
  btn.textContent = anyCollapsed ? T("Развернуть все") : T("Свернуть все");
}

/* ============================================================
   Холст. Узел = СУЩНОСТЬ, внутри плашки её таблиц с колонками.

   Координаты живут у сущности: двигается узел целиком, таблицы внутри
   не позиционируются, а идут потоком. Связи при этом соединяют не узлы,
   а конкретные таблицы, поэтому якорь считается от плашки — иначе стрелка
   от user.car к lead.leads упиралась бы в общий угол сущности и врала.
   ============================================================ */

/* Координаты сущности. Старая модель хранила их у таблиц — переносим с первой,
   чтобы схема не схлопнулась в угол при первом открытии после обновления. */
function schemaXY(s){
  if (s.x == null || s.y == null){
    const first = model.entities.find(e => schemaOf(e) === s.id);
    s.x = first && first.x != null ? first.x : 40;
    s.y = first && first.y != null ? first.y : 40;
  }
  return s;
}

/* Настройки вида — в localStorage, а не в модели: модель общая для всех,
   а «что мне показывать на холсте» дело каждого. */
const SB_VIEW_KEY = "crmpanel:schemeView";
const SB_VIEW_DEF = { external:true, internal:false, columns:true, types:true };
let sbView = (function(){
  try { return Object.assign({}, SB_VIEW_DEF, JSON.parse(localStorage.getItem(SB_VIEW_KEY)) || {}); }
  catch(e){ return Object.assign({}, SB_VIEW_DEF); }
})();
function saveView(){ try { localStorage.setItem(SB_VIEW_KEY, JSON.stringify(sbView)); } catch(e){} }

function renderNodes(){
  const host = $("#sbNodes");
  if (!host) return;
  host.innerHTML = allSchemas().map(s => {
    schemaXY(s);
    const tables = model.entities.filter(e => schemaOf(e) === s.id);
    const cols = tables.reduce((n, e) => n + e.fields.length, 0);
    const plates = tables.map(e => {
      const expanded = !!state.expanded[e.id];
      const shown = (!sbView.columns) ? [] : (expanded ? e.fields : e.fields.slice(0, MAX_ROWS));
      const rest = e.fields.length - shown.length;
      const rows = shown.map((f, i) => {
        const isPk = f.name === "id";
        const type = f.target_entity ? `${f.ui_type} → ${f.target_entity}` : (f.ui_type || f.db_type);
        return `<div class="sb-field ${state.entity === e.id && state.field === i ? "active" : ""}" data-e="${esc(e.id)}" data-i="${i}">
          <div class="sb-fname"><span class="sb-req ${f.required ? "" : "no"}"></span>
            ${isPk ? '<span class="sb-pk">PK</span>' : ""}<code>${esc(f.name)}</code></div>
          ${sbView.types ? `<div class="sb-ftype">${esc(type)}</div>` : ""}</div>`;
      }).join("");
      let toggle = "";
      if (sbView.columns && rest > 0)
        toggle = `<div class="sb-more" data-toggle="${esc(e.id)}">▾ ${T("Показать ещё")} ${pluralField(rest)}</div>`;
      else if (sbView.columns && expanded && e.fields.length > MAX_ROWS)
        toggle = `<div class="sb-more" data-toggle="${esc(e.id)}">▴ ${T("Свернуть")}</div>`;
      return `<div class="sb-plate ${state.entity === e.id ? "selected" : ""}" data-e="${esc(e.id)}">
        <div class="sb-plate-head">
          <span class="sb-plate-name mono">${esc(e.table || e.id)}</span>
          <span class="sb-plate-cnt">${pluralField(e.fields.length)}</span>
          <button class="sb-plate-add" data-e="${esc(e.id)}" title="${T("Добавить колонку")}">+</button>
        </div>
        <div class="sb-node-fields">${rows}</div>${toggle}
      </div>`;
    }).join("");
    return `<div class="sb-node ${state.schema === s.id ? "selected" : ""}"
        data-s="${esc(s.id)}" style="left:${s.x|0}px;top:${s.y|0}px">
      <div class="sb-node-head">
        <div><div class="sb-node-title">${esc(s.label || s.id)}</div>
          <div class="sb-node-sub mono">${esc(s.id)} · ${tables.length} ${T("табл.")} · ${cols}</div></div>
        <button class="sb-node-add" title="${T("Добавить таблицу")}">+</button>
      </div>
      <div class="sb-node-body">${plates || `<div class="sb-plate-empty">${T("нет таблиц")}</div>`}</div>
    </div>`;
  }).join("");

  $$(".sb-node").forEach(n => {
    const sid = n.dataset.s;
    n.onclick = ev => {
      if (ev.target.closest(".sb-field") || ev.target.closest("button") || ev.target.closest("[data-toggle]")) return;
      const plate = ev.target.closest(".sb-plate");
      state.schema = sid;
      state.entity = plate ? plate.dataset.e : null;
      state.field = null; setTab("entity"); render();
    };
    /* Тянем за шапку сущности: плашки внутри не двигаются самостоятельно,
       иначе таблицы одной сущности расползлись бы по холсту. */
    n.querySelector(".sb-node-head").onmousedown = ev => {
      if (ev.target.closest("button")) return;
      const p = toWorld(ev), s = model.schemas.find(x => x.id === sid);
      if (!s) return;
      schemaXY(s);
      state.drag = { id: sid, dx: p.x - s.x, dy: p.y - s.y }; ev.preventDefault();
    };
    n.querySelector(".sb-node-add").onclick = ev => { ev.stopPropagation(); openEntityModal(sid); };
    $$(".sb-plate-add", n).forEach(b => b.onclick = ev => {
      ev.stopPropagation(); state.schema = sid; state.entity = b.dataset.e; openFieldModal();
    });
    $$("[data-toggle]", n).forEach(tg => tg.onclick = ev => {
      ev.stopPropagation(); toggleFields(tg.dataset.toggle); syncExpandBtn();
    });
    $$(".sb-field", n).forEach(row => row.onclick = ev => {
      ev.stopPropagation();
      state.schema = sid; state.entity = row.dataset.e; state.field = Number(row.dataset.i);
      setTab("field"); render();
    });
  });
  syncExpandBtn();
}

/* Прямоугольник ПЛАШКИ таблицы в координатах холста. Меряем по факту, а не
   по вёрстке: высота плашки зависит от числа колонок и того, свёрнута ли она,
   а масштаб холста надо снять, иначе связи поедут при зуме. */
function tableRect(tableId){
  const plate = document.querySelector(`.sb-plate[data-e="${CSS.escape(tableId)}"]`);
  if (!plate) return null;
  const node = plate.closest(".sb-node");
  const e = entityById(tableId);
  const s = e && model.schemas.find(x => x.id === schemaOf(e));
  if (!node || !s) return null;
  schemaXY(s);
  const nr = node.getBoundingClientRect(), pr = plate.getBoundingClientRect();
  const k = state.scale || 1;
  return { x: (s.x|0) + (pr.left - nr.left) / k, y: (s.y|0) + (pr.top - nr.top) / k,
           w: pr.width / k, h: pr.height / k };
}
function nodeRect(schemaId){
  const n = document.querySelector(`.sb-node[data-s="${CSS.escape(schemaId)}"]`);
  const s = model.schemas && model.schemas.find(x => x.id === schemaId);
  if (!n || !s) return null;
  schemaXY(s);
  const k = state.scale || 1;
  return { x: s.x|0, y: s.y|0, w: n.getBoundingClientRect().width / k, h: n.getBoundingClientRect().height / k };
}
function edgePath(a, b){
  const ax = a.x + a.w, ay = a.y + a.h/2, bx = b.x, by = b.y + b.h/2;
  const dx = Math.max(60, Math.abs(bx - ax) * .4);
  if (bx >= ax) return `M${ax},${ay} C${ax+dx},${ay} ${bx-dx},${by} ${bx},${by}`;
  return `M${a.x + a.w/2},${a.y + a.h} C${a.x + a.w/2},${a.y + a.h + 80} ${b.x + b.w/2},${b.y - 80} ${b.x + b.w/2},${b.y}`;
}
/* Связь внутри одной сущности: обе плашки в одном узле, обычная кривая слева
   направо выродилась бы в петлю. Ведём дугу сбоку от узла. */
function innerPath(a, b){
  const x = Math.min(a.x, b.x) - 16;
  const ay = a.y + a.h/2, by = b.y + b.h/2;
  return `M${a.x},${ay} C${x - 26},${ay} ${x - 26},${by} ${b.x},${by}`;
}
function renderEdges(){
  const svg = $("#sbEdges");
  if (!svg) return;
  const css = getComputedStyle(document.documentElement);
  const blue = (css.getPropertyValue("--blue") || "#50C3FF").trim();
  const violet = "#9aa6ff";
  const grey = (css.getPropertyValue("--faint") || "#8b97a8").trim();
  let out = `<defs>
    <marker id="sbArr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8z" fill="${blue}"/></marker>
    <marker id="sbArrM" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8z" fill="${violet}"/></marker>
    <marker id="sbArrI" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8z" fill="${grey}"/></marker></defs>`;
  model.relations.forEach(r => {
    const fe = entityById(r.from_entity), te = entityById(r.to_entity);
    if (!fe || !te) return;
    const inner = schemaOf(fe) === schemaOf(te);
    /* Видимость — только про глаза: связь есть в модели, значит внешний ключ
       создастся, показана она на холсте или нет. */
    if (inner && !sbView.internal) return;
    if (!inner && !sbView.external) return;
    const a = tableRect(r.from_entity), b = tableRect(r.to_entity);
    if (!a || !b) return;
    const many = r.relation_type === "many_to_many";
    const color = inner ? grey : (many ? violet : blue);
    const marker = inner ? "sbArrI" : (many ? "sbArrM" : "sbArr");
    out += `<path d="${inner ? innerPath(a,b) : edgePath(a,b)}" fill="none" stroke="${color}" stroke-width="${inner ? 1.6 : 2.2}"
      stroke-dasharray="${many ? "8 5" : (inner ? "4 4" : "none")}" marker-end="url(#${marker})" opacity="${inner ? ".7" : ".85"}"/>`;
  });
  svg.innerHTML = out;
}

/* ============================================================
   Инспектор: сущность / поле / связь
   ============================================================ */
function setTab(t){
  state.tab = t;
  $$("#sbTabs .sb-tab").forEach(x => x.classList.toggle("on", x.dataset.tab === t));
}
/* Хлебные крошки вместо вкладок: панель раскрывается вглубь, и вернуться
   на уровень выше нужно уметь из любого места. Рисуем в контейнер вкладок —
   так разметка остаётся прежней, а поведение меняется. */
function renderCrumbs(){
  const bar = $("#sbTabs");
  if (!bar) return;
  const s = model.schemas && model.schemas.find(x => x.id === state.schema);
  const e = state.entity ? entityById(state.entity) : null;
  const f = (e && state.field != null) ? e.fields[state.field] : null;
  const parts = [];
  if (state.tab === "relation"){
    parts.push(`<span class="sb-crumb on">${T("Связь")}</span>`);
  } else if (!s && !e){
    parts.push(`<span class="sb-crumb on">${T("Сущность")}</span>`);
  } else {
    parts.push(`<button class="sb-crumb ${!e ? "on" : ""}" data-go="schema">${esc((s && (s.label || s.id)) || T("Сущность"))}</button>`);
    if (e) parts.push(`<span class="sb-crumb-sep">›</span>` +
      `<button class="sb-crumb ${f ? "" : "on"}" data-go="table">${esc(e.table || e.id)}</button>`);
    if (f) parts.push(`<span class="sb-crumb-sep">›</span>` +
      `<span class="sb-crumb on">${esc(f.name)}</span>`);
  }
  bar.innerHTML = parts.join("");
  bar.className = "sb-crumbs";
  $$("#sbTabs .sb-crumb[data-go]").forEach(b => b.onclick = () => {
    if (b.dataset.go === "schema"){ state.entity = null; state.field = null; }
    if (b.dataset.go === "table"){ state.field = null; }
    setTab("entity"); render();
  });
}

function renderInspector(){
  const out = $("#sbInspector");
  if (!out) return;
  /* Таблицу могли выбрать не из панели, а кликом по узлу на холсте — тогда
     сущность в крошках не совпала бы с показанным. Подтягиваем. */
  if (state.entity){
    const e = entityById(state.entity);
    if (e) state.schema = schemaOf(e);
  }
  renderCrumbs();
  if (state.tab === "relation") return renderRelationForm(out);
  /* Уровень определяем по выбранному, а не по вкладке: панель раскрывается вглубь. */
  if (state.entity && state.field != null) return renderFieldForm(out);
  if (state.entity) return renderEntityForm(out);
  if (state.schema) return renderSchemaForm(out);
  out.innerHTML = `<div class="sb-form"><div class="sb-empty">${
    T("Выберите сущность слева или создайте новую.")}</div></div>`;
}

/* ---------- уровень 1: сущность и её таблицы ---------- */
function renderSchemaForm(out){
  const s = ensureSchema(state.schema);
  if (!s){ out.innerHTML = `<div class="sb-form"><div class="sb-empty">${T("Выберите сущность слева или создайте новую.")}</div></div>`; return; }
  const tables = model.entities.filter(e => schemaOf(e) === s.id);
  out.innerHTML = `<div class="sb-form">
    <div class="sb-fg"><label>${T("Системное имя")}</label>
      <input class="mono" id="sbS_id" value="${esc(s.id)}">
      <i class="sb-hint">${T("Это имя схемы в базе")}</i></div>
    <div class="sb-fg"><label>${T("Название")}</label><input id="sbS_label" value="${esc(s.label || "")}"></div>
    <div class="sb-fg"><label>${T("Описание")}</label><textarea id="sbS_desc">${esc(s.description || "")}</textarea></div>
    <div class="sb-acts">
      <button class="btn accent" id="sbS_save">${T("Сохранить")}</button>
      <button class="btn" id="sbS_addTable">+ ${T("Таблица")}</button>
    </div>
    <div class="sb-sub-head">${T("Таблицы")} <span class="n">${tables.length}</span></div>
    ${tables.length ? tables.map(e => `<div class="sb-item sb-tbl" data-e="${esc(e.id)}">
        <span class="dot"></span>
        <span class="lbl">${esc(e.label || e.id)}<i class="sb-ent-sub mono">${esc(s.id)}.${esc(e.table || e.id)}</i></span>
        <span class="cnt">${e.fields.length}</span></div>`).join("")
      : `<div class="sb-empty">${T("В сущности пока нет таблиц")}</div>`}
  </div>`;
  $("#sbS_save").onclick = () => {
    const id = slug($("#sbS_id").value);
    if (!id) return toast(T("Нужно системное имя"));
    const old = s.id;
    if (id !== old && model.schemas.some(x => x.id === id)) return toast(T("Такое системное имя уже есть"));
    /* Переименование схемы тянет за собой все её таблицы — иначе они осиротеют
       и разъедутся по разным схемам. */
    if (id !== old) model.entities.forEach(e => { if (schemaOf(e) === old) e.schema = id; });
    s.id = id; s.label = $("#sbS_label").value || id; s.description = $("#sbS_desc").value;
    state.schema = id;
    commit("update", "schema", id, s); toast(T("Сущность сохранена"));
  };
  $("#sbS_addTable").onclick = () => openEntityModal(s.id);
  $$("#sbInspector .sb-tbl").forEach(x => x.onclick = () => {
    state.entity = x.dataset.e; state.field = null; setTab("entity"); render();
  });
}

function renderEntityForm(out){
  const e = entityById(state.entity);
  if (!e){ out.innerHTML = `<div class="sb-form"><div class="sb-empty">${T("Выберите таблицу на схеме или создайте новую.")}</div></div>`; return; }
  out.innerHTML = `<div class="sb-form">
    <div class="sb-grid2">
      <div class="sb-fg"><label>${T("Системное имя")}</label><input class="mono" id="sbE_id" value="${esc(e.id)}"></div>
      <div class="sb-fg"><label>${T("Таблица")}</label><input class="mono" id="sbE_table" value="${esc(e.table)}"></div>
    </div>
    <!-- Схема: сущность это схема, таблицы лежат внутри неё. Список подсказывает
         существующие, но поле открытое — вписал новое имя, схема заводится сама. -->
    <div class="sb-fg"><label>${T("Схема")}</label>
      <input class="mono" id="sbE_schema" list="sbSchemaList" value="${esc(schemaOf(e))}">
      <datalist id="sbSchemaList">${allSchemas().map(s =>
        `<option value="${esc(s.id)}">${esc(s.label || s.id)}</option>`).join("")}</datalist>
      <i class="sb-hint">${T("В базе получится")} <b class="mono">${esc(schemaOf(e))}.${esc(e.table || e.id)}</b></i>
    </div>
    <div class="sb-fg"><label>${T("Название")}</label><input id="sbE_label" value="${esc(e.label)}"></div>
    <div class="sb-fg"><label>${T("Название во множественном числе")}</label><input id="sbE_plural" value="${esc(e.plural_label||"")}"></div>
    <div class="sb-fg"><label>${T("Поле заголовка записи")}</label><select id="sbE_title">
      <option value="">—</option>${e.fields.map(f => `<option value="${esc(f.name)}" ${e.title_field===f.name?"selected":""}>${esc(f.name)}</option>`).join("")}</select></div>
    <div class="sb-fg"><label>${T("Описание")}</label><textarea id="sbE_desc">${esc(e.description||"")}</textarea></div>
    <label class="sb-check"><input type="checkbox" id="sbE_tech" ${e.technical ? "checked" : ""}>
      <span>${T("Техническая")}<i>${T("служебная таблица: в пользовательской панели не показывается")}</i></span></label>
    <div class="sb-acts">
      <button class="btn accent" id="sbE_save">${T("Сохранить")}</button>
      <button class="btn" id="sbE_addField">+ ${T("Колонка")}</button>
      <button class="btn ghost-danger" id="sbE_del">${T("Удалить")}</button>
    </div>
    <div class="sb-sub-head">${T("Колонки")} <span class="n">${e.fields.length}</span></div>
    ${e.fields.length ? e.fields.map((f, i) => `<div class="sb-item sb-col" data-i="${i}">
        <span class="dot ${f.required ? "" : "opt"}"></span>
        <span class="lbl">${esc(f.name)}<i class="sb-ent-sub mono">${esc(f.db_type || "text")}</i></span>
        ${f.name === "id" ? `<span class="cnt">PK</span>`
          : `<button class="sb-col-del" data-i="${i}" title="${T("Удалить колонку")}">×</button>`}
      </div>`).join("")
      : `<div class="sb-empty">${T("В таблице пока нет колонок")}</div>`}
  </div>`;
  $$("#sbInspector .sb-col").forEach(x => x.onclick = () => {
    state.field = Number(x.dataset.i); setTab("field"); render();
  });
  /* Удаление колонки прямо из списка. id не даём убрать: это первичный ключ,
     на него ссылаются внешние ключи, и таблица без него нам не нужна. */
  $$("#sbInspector .sb-col-del").forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const i = Number(b.dataset.i), f = e.fields[i];
    if (!f || !confirm(T("Удалить колонку") + " «" + f.name + "»?")) return;
    e.fields.splice(i, 1);
    if (state.field === i) state.field = null;
    commit("delete", "field", `${e.id}.${f.name}`, null); toast(T("Колонка удалена"));
  });
  $("#sbE_save").onclick = () => {
    const old = e.id, id = slug($("#sbE_id").value);
    if (!id) return toast(T("Нужно системное имя"));
    if (id !== old && entityById(id)) return toast(T("Такое системное имя уже есть"));
    e.id = id; e.table = slug($("#sbE_table").value) || id;
    /* Схема: пусто — таблица становится сама себе схемой (прежнее поведение).
       Имени нет в списке — заводим схему на лету, отдельной кнопки для этого не нужно. */
    e.schema = slug($("#sbE_schema").value) || id;
    ensureSchema(e.schema);
    e.label = $("#sbE_label").value || id; e.plural_label = $("#sbE_plural").value;
    e.title_field = $("#sbE_title").value; e.description = $("#sbE_desc").value;
    e.technical = $("#sbE_tech").checked;
    if (id !== old) model.relations.forEach(r => {
      if (r.from_entity === old) r.from_entity = id;
      if (r.to_entity === old) r.to_entity = id;
    });
    state.entity = id;
    commit("update", "entity", id, e); toast(T("Таблица сохранена"));
  };
  $("#sbE_addField").onclick = openFieldModal;
  $("#sbE_del").onclick = () => {
    if (!confirm(T("Удалить таблицу и все её связи?"))) return;
    model.entities = model.entities.filter(x => x.id !== e.id);
    model.relations = model.relations.filter(r => r.from_entity !== e.id && r.to_entity !== e.id);
    pruneSchemas();
    /* помечаем удаление: иначе наложение черновика на файл (EntityLayout.mergeDraft)
       вернуло бы сущность обратно при следующей загрузке */
    if (!Array.isArray(model.deleted)) model.deleted = [];
    if (model.deleted.indexOf(e.id) < 0) model.deleted.push(e.id);
    state.entity = null; state.field = null;
    commit("delete", "entity", e.id, null); toast(T("Таблица удалена"));
  };
}

/* --- поле: форма + живой предпросмотр + подсказки --- */
function fieldFormHtml(f, isNew){
  return `<div class="sb-form">
    <div class="sb-grid2">
      <div class="sb-fg"><label>${T("Системное имя")}</label><input class="mono" id="sbF_name" value="${esc(f.name||"")}"></div>
      <div class="sb-fg"><label>${T("Название")}</label><input id="sbF_label" value="${esc(f.label||"")}"></div>
    </div>
    <div class="sb-grid2">
      <div class="sb-fg"><label>${T("Тип в БД")}</label><input class="mono" id="sbF_db" list="sbDbTypes" value="${esc(f.db_type||"")}">
        <datalist id="sbDbTypes">${DB_TYPES.map(t => `<option>${t}</option>`).join("")}</datalist></div>
      <div class="sb-fg"><label>${T("UI-тип (как показывается)")}</label><select id="sbF_ui">
        ${UI_TYPES.map(t => `<option value="${t.v}" ${f.ui_type===t.v?"selected":""}>${esc(T(t.label))}</option>`).join("")}</select></div>
    </div>
    <div class="sb-grid2">
      <div class="sb-fg"><label>${T("Связанная таблица")}</label><select id="sbF_target"><option value="">—</option>
        ${model.entities.map(e => `<option value="${esc(e.id)}" ${f.target_entity===e.id?"selected":""}>${esc(e.label)}</option>`).join("")}</select></div>
      <div class="sb-fg"><label>${T("Тип связи поля")}</label><select id="sbF_rel"><option value="">—</option>
        ${["lookup","related_list"].map(x => `<option ${f.relation_kind===x?"selected":""}>${x}</option>`).join("")}</select></div>
    </div>
    <div class="sb-fg"><label>${T("Значение по умолчанию")}</label><input id="sbF_default" value="${esc(f.default_value ?? "")}"></div>
    <div class="sb-fg"><label>${T("Значения списка через запятую")}</label><input id="sbF_options" value="${esc((f.options||[]).join(", "))}"></div>
    <label class="sb-check"><input type="checkbox" id="sbF_req" ${f.required?"checked":""}> ${T("Обязательное")}</label>
    <label class="sb-check"><input type="checkbox" id="sbF_ro" ${f.read_only?"checked":""}> ${T("Только чтение")}</label>
    <div class="sb-fg"><label>${T("Описание")}</label><textarea id="sbF_desc">${esc(f.description||"")}</textarea></div>
    <div class="sb-fg"><label>${T("Как это увидит пользователь")}</label><div class="sb-preview sb-pv" id="sbF_preview"></div></div>
    <div id="sbF_hint"></div>
    <div class="sb-acts">
      <button class="btn accent" id="sbF_save">${isNew ? T("Добавить") : T("Сохранить")}</button>
      ${isNew ? `<button class="btn" id="sbF_cancel">${T("Отмена")}</button>`
              : `<button class="btn" id="sbF_up">↑</button><button class="btn" id="sbF_down">↓</button>
                 <button class="btn ghost-danger" id="sbF_del">${T("Удалить")}</button>`}
    </div></div>`;
}
function readFieldForm(){
  return { name: slug($("#sbF_name").value), label: $("#sbF_label").value || $("#sbF_name").value,
    db_type: $("#sbF_db").value, ui_type: $("#sbF_ui").value,
    required: $("#sbF_req").checked, read_only: $("#sbF_ro").checked,
    description: $("#sbF_desc").value, target_entity: $("#sbF_target").value,
    relation_kind: $("#sbF_rel").value, default_value: $("#sbF_default").value,
    options: $("#sbF_options").value.split(",").map(x => x.trim()).filter(Boolean) };
}
function fieldPreviewHtml(f){
  const ro = f.read_only ? "disabled" : "", dv = esc(f.default_value ?? "");
  const tgt = entityById(f.target_entity);
  const lab = `<div class="sb-pv-label">${esc(f.label || f.name || T("Поле"))}${f.required ? ' <span class="req">*</span>' : ""}</div>`;
  let w;
  switch (f.ui_type){
    case "textarea": w = `<textarea ${ro}>${dv}</textarea>`; break;
    case "number":   w = `<input type="number" value="${dv}" ${ro}>`; break;
    case "currency": w = `<div class="sb-pv-row"><span class="sb-pv-unit">₽</span><input type="number" value="${dv}" ${ro}></div>`; break;
    case "percent":  w = `<div class="sb-pv-row"><input type="number" value="${dv}" ${ro}><span class="sb-pv-unit">%</span></div>`; break;
    case "email":    w = `<input type="email" placeholder="user@banki.ru" value="${dv}" ${ro}>`; break;
    case "phone":    w = `<input placeholder="+7 (___) ___-__-__" value="${dv}" ${ro}>`; break;
    case "url":      w = `<input type="url" placeholder="https://" value="${dv}" ${ro}>`; break;
    case "date":     w = `<input type="date" value="${dv}" ${ro}>`; break;
    case "datetime": w = `<input type="datetime-local" value="${dv}" ${ro}>`; break;
    case "time":     w = `<input type="time" value="${dv}" ${ro}>`; break;
    case "checkbox": w = `<label class="sb-pv-check"><input type="checkbox" ${(f.default_value===true||f.default_value==="true")?"checked":""} ${ro}> ${esc(f.label||T("Да/нет"))}</label>`; break;
    case "picklist": w = (f.options && f.options.length)
        ? `<select ${ro}>${f.options.map(o => `<option>${esc(o)}</option>`).join("")}</select>`
        : `<select disabled><option>— ${T("добавьте значения списка")} —</option></select>`; break;
    case "lookup":   w = `<div class="sb-pv-lookup">🔍 ${tgt ? esc(tgt.label) : T("выберите связанную таблицу")} …</div>`; break;
    case "multilookup": w = `<div class="sb-pv-chips"><span>${tgt ? esc(tgt.label) : T("запись")} 1 ×</span>
        <span>${tgt ? esc(tgt.label) : T("запись")} 2 ×</span><span class="add">+ ${T("добавить")}</span></div>`; break;
    case "related_list": w = `<div class="sb-pv-list"><div class="sb-pv-list-head">
        <b>${tgt ? esc(tgt.plural_label || tgt.label) : T("Связанные записи")}</b><span class="go">+ ${T("Создать")}</span></div>
        <div class="sb-pv-list-body">${T("Таблица связанных записей с колонками и действиями.")}</div></div>`; break;
    default: w = `<input value="${dv}" ${ro}>`;
  }
  return lab + w;
}
function fieldHintHtml(f){
  const parts = [];
  if (REL_UI.includes(f.ui_type) && !f.target_entity) parts.push("⚠ " + T("Укажите связанную таблицу — без неё связь не построится."));
  if (f.ui_type === "picklist" && !(f.options||[]).length) parts.push("⚠ " + T("Для списка добавьте значения через запятую."));
  const fam = dbFamily(f.db_type), ok = UI_DB_OK[f.ui_type];
  if (fam && ok && !ok.includes(fam))
    parts.push(`${T("Тип БД")} <code>${esc(f.db_type)}</code> ${T("необычен для этого UI-типа. Обычно берут")}
      <b>${esc(T(uiMeta(dbToUi(f.db_type)).label))}</b>. <a href="#" id="sbF_applyUi">${T("применить")}</a>`);
  return parts.length ? `<div class="sb-hint ${parts.some(p => p.startsWith("⚠")) ? "bad" : ""}">${parts.join("<br>")}</div>` : "";
}
function refreshFieldAux(){
  if (!$("#sbF_preview")) return;
  const f = readFieldForm();
  $("#sbF_preview").innerHTML = fieldPreviewHtml(f);
  $("#sbF_hint").innerHTML = fieldHintHtml(f);
  const a = $("#sbF_applyUi");
  if (a) a.onclick = ev => { ev.preventDefault(); $("#sbF_ui").value = dbToUi($("#sbF_db").value); refreshFieldAux(); };
}
/* isNew: у нового поля тип БД следует за UI-типом, пока его не правили руками.
   У существующего поля тип БД не трогаем автоматически — это данные в проде,
   для смены есть явная ссылка «применить» в подсказке. */
function wireFieldAux(isNew){
  ["sbF_name","sbF_label","sbF_default","sbF_options","sbF_desc"].forEach(id => { const el = $("#"+id); if (el) el.oninput = refreshFieldAux; });
  ["sbF_target","sbF_rel","sbF_req","sbF_ro"].forEach(id => { const el = $("#"+id); if (el) el.onchange = refreshFieldAux; });
  const db = $("#sbF_db");
  if (db) db.oninput = () => { db.dataset.touched = "1"; refreshFieldAux(); };
  const ui = $("#sbF_ui");
  if (ui) ui.onchange = () => {
    if (db && (isNew ? !db.dataset.touched : !db.value.trim())) db.value = uiMeta(ui.value).db;
    refreshFieldAux();
  };
  refreshFieldAux();
}
function renderFieldForm(out){
  const e = entityById(state.entity), f = e && e.fields[state.field];
  if (!f){ out.innerHTML = `<div class="sb-form"><div class="sb-empty">${T("Выберите поле внутри таблицы на схеме.")}</div></div>`; return; }
  out.innerHTML = fieldFormHtml(f, false);
  wireFieldAux();
  $("#sbF_save").onclick = () => {
    const v = readFieldForm();
    if (!v.name) return toast(T("Нужно системное имя"));
    if (e.fields.some((x, j) => j !== state.field && x.name === v.name)) return toast(T("Поле с таким именем уже есть"));
    Object.assign(f, v);
    commit("update", "field", `${e.id}.${v.name}`, v); toast(T("Поле сохранено"));
  };
  $("#sbF_up").onclick = () => moveField(e, state.field, -1);
  $("#sbF_down").onclick = () => moveField(e, state.field, 1);
  $("#sbF_del").onclick = () => {
    if (!confirm(T("Удалить поле?"))) return;
    const name = f.name;
    e.fields.splice(state.field, 1);
    model.relations = model.relations.filter(r => !(r.from_entity === e.id && r.from_field === name));
    state.field = null;
    commit("delete", "field", `${e.id}.${name}`, null); toast(T("Поле удалено"));
  };
}
function moveField(e, i, dir){
  const j = i + dir;
  if (j < 0 || j >= e.fields.length) return;
  const [f] = e.fields.splice(i, 1); e.fields.splice(j, 0, f);
  state.field = j;
  commit("reorder", "field", `${e.id}.${f.name}`, { from:i, to:j });
}

/* --- связь --- */
function renderRelationForm(out){
  const r = relationById(state.relation);
  if (!r){ out.innerHTML = `<div class="sb-form"><div class="sb-empty">${T("Выберите связь в списке слева или создайте новую.")}</div></div>`; return; }
  out.innerHTML = relationFormHtml(r, false);
  wireRelationForm(r);
  $("#sbR_save").onclick = () => { Object.assign(r, readRelationForm()); commit("update", "relation", r.id, r); toast(T("Связь сохранена")); };
  $("#sbR_del").onclick = () => {
    if (!confirm(T("Удалить связь?"))) return;
    model.relations = model.relations.filter(x => x.id !== r.id);
    state.relation = null;
    commit("delete", "relation", r.id, null); toast(T("Связь удалена"));
  };
}
function relationFormHtml(r, isNew){
  const entOpts = (sel) => model.entities.map(e => `<option value="${esc(e.id)}" ${sel===e.id?"selected":""}>${esc(e.label)}</option>`).join("");
  return `<div class="sb-form">
    <div class="sb-grid2">
      <div class="sb-fg"><label>${T("Из таблицы")}</label><select id="sbR_fromE">${entOpts(r.from_entity)}</select></div>
      <div class="sb-fg"><label>${T("Поле FK")}</label><select class="mono" id="sbR_fromF"></select></div>
    </div>
    <div class="sb-grid2">
      <div class="sb-fg"><label>${T("В таблицу")}</label><select id="sbR_toE">${entOpts(r.to_entity)}</select></div>
      <div class="sb-fg"><label>${T("Целевое поле")}</label><select class="mono" id="sbR_toF"></select></div>
    </div>
    <div class="sb-grid2">
      <div class="sb-fg"><label>${T("Тип связи")}</label><select class="mono" id="sbR_type">
        ${REL_TYPES.map(x => `<option ${r.relation_type===x?"selected":""}>${x}</option>`).join("")}</select></div>
      <div class="sb-fg"><label>ON DELETE</label><select class="mono" id="sbR_del_rule">
        ${ON_DELETE.map(x => `<option ${r.on_delete===x?"selected":""}>${x}</option>`).join("")}</select></div>
    </div>
    <label class="sb-check"><input type="checkbox" id="sbR_null" ${r.nullable?"checked":""}> ${T("FK может быть NULL")}</label>
    <div class="sb-fg"><label>${T("Связующая таблица (для many-to-many)")}</label><input class="mono" id="sbR_through" value="${esc(r.through||"")}"></div>
    <div class="sb-fg"><label>${T("Описание")}</label><textarea id="sbR_desc">${esc(r.description||"")}</textarea></div>
    <div class="sb-acts">
      <button class="btn accent" id="sbR_save">${isNew ? T("Добавить") : T("Сохранить")}</button>
      ${isNew ? `<button class="btn" id="sbR_cancel">${T("Отмена")}</button>` : `<button class="btn ghost-danger" id="sbR_del">${T("Удалить")}</button>`}
    </div></div>`;
}
function fillRelationFields(r){
  const fe = entityById($("#sbR_fromE").value), te = entityById($("#sbR_toE").value);
  $("#sbR_fromF").innerHTML = ((fe && fe.fields) || []).map(f => `<option ${r.from_field===f.name?"selected":""}>${esc(f.name)}</option>`).join("");
  $("#sbR_toF").innerHTML = ((te && te.fields) || []).map(f => `<option ${r.to_field===f.name?"selected":""}>${esc(f.name)}</option>`).join("");
}
function wireRelationForm(r){
  fillRelationFields(r);
  $("#sbR_fromE").onchange = () => fillRelationFields(r);
  $("#sbR_toE").onchange = () => fillRelationFields(r);
}
function readRelationForm(){
  return { from_entity:$("#sbR_fromE").value, from_field:$("#sbR_fromF").value,
    to_entity:$("#sbR_toE").value, to_field:$("#sbR_toF").value,
    relation_type:$("#sbR_type").value, nullable:$("#sbR_null").checked,
    on_delete:$("#sbR_del_rule").value, through:$("#sbR_through").value, description:$("#sbR_desc").value };
}

/* ============================================================
   Модалки: новая сущность / поле / связь / экспорт
   ============================================================ */
/* ============================================================
   ПРИМЕНЕНИЕ К БАЗЕ. Схемы и таблицы создаёт сервер: только он знает,
   что уже есть, что защищено и что заведено не нами.

   Предпросмотр обязателен и отдельной кнопкой — не на сохранении:
   сохранение идёт при любой правке, и лить DDL на каждый чих нельзя.
   Показываем ровно то, что уйдёт в базу, и только потом применяем.
   ============================================================ */
function ddlRow(st){
  const where = st.table ? `${st.schema}.${st.table}` : st.schema;
  return `<tr class="${st.skip ? "skip" : ""}"><td class="mono">${esc(st.kind)}</td>
    <td class="mono">${esc(where)}</td>
    <td>${st.skip ? T("пропуск") : ""}</td></tr>`;
}

/* Схему в модели занимает сущность — по имени схемы человек её не узнает.
   Показываем, о какой именно сущности речь. */
function entitiesOfSchema(schema){
  return (model.entities || []).filter(e => schemaOf(e) === schema)
    .map(e => e.label || e.id);
}

async function applyToDb(){
  openModal(`<h3>${T("Применить к базе")}</h3>
    <div class="sb-modal-note">${T("Считаем, что нужно сделать в базе…")}</div>`);
  let plan;
  try {
    const r = await fetch("/api/schema/ddl/preview", {
      method:"POST", credentials:"same-origin",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ model }) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    plan = await r.json();
  } catch (e){
    openModal(`<h3>${T("Применить к базе")}</h3>
      <div class="sb-modal-note">${T("Не удалось получить план изменений")}: ${esc(e.message)}</div>
      <div class="sb-acts"><button class="btn" id="sbAp_close">${T("Закрыть")}</button></div>`);
    $("#sbAp_close").onclick = closeModal;
    return;
  }

  const skipped = plan.skipped || [], problems = plan.problems || [];
  const stmts = plan.statements || [];
  const warn = (list, cls) => list.length
    ? `<div class="sb-modal-note ${cls}">${list.map(x => "• " + esc(x)).join("<br>")}</div>` : "";
  /* Пропуск — не ошибка: такое в базе уже есть, и мы его не трогаем. Говорим об этом
     обычным текстом, а не красным, иначе выглядит как поломка. */
  const skipNote = skipped.length ? `<div class="sb-modal-note">
      ${T("Уже есть в базе — создаваться не будет")}:<br>
      ${skipped.map(s => { const ents = entitiesOfSchema(s.schema);
        return "• <b>" + esc(s.schema) + "</b> — " + esc(s.reason)
          + (ents.length ? " · " + T("сущность") + " «" + esc(ents.join("», «")) + "»" : ""); })
        .join("<br>")}</div>` : "";
  const skipCount = stmts.filter(s => s.skip).length;
  /* Расхождение с сохранённым видно сразу: применяем то, что на экране. */
  const dirty = SchemaStore.isDirty(model)
    ? `<div class="sb-modal-note">${T("Внимание: в модели есть несохранённые правки — применится то, что на экране.")}</div>` : "";

  openModal(`<h3>${T("Применить к базе")}</h3>
    ${skipNote}
    ${warn(problems, "")}
    ${dirty}
    <div class="sb-modal-note">${T("Будет выполнено операций")}: <b>${plan.applicable != null ? plan.applicable : stmts.length}</b>${
      skipCount ? " · " + T("пропущено") + ": <b>" + skipCount + "</b>" : ""} · ${T("схем")}: <b>${(plan.schemas||[]).length}</b>.
      ${T("Только создание: DROP, RENAME и смена типа не выполняются.")}</div>
    <div class="sb-acts" style="margin:0 0 12px">
      <button class="btn accent" id="sbAp_go" ${plan.canApply ? "" : "disabled"}>${T("Применить")}</button>
      <button class="btn" id="sbAp_close">${T("Закрыть")}</button></div>
    ${stmts.length ? `<table class="sb-ddl"><thead><tr><th>${T("Операция")}</th><th>${T("Объект")}</th><th></th></tr></thead>
      <tbody>${stmts.map(ddlRow).join("")}</tbody></table>` : ""}
    <pre>${esc(plan.sql || "")}</pre>`);
  $("#sbAp_close").onclick = closeModal;
  const go = $("#sbAp_go");
  if (go) go.onclick = async () => {
    go.disabled = true; go.textContent = T("Применяем…");
    try {
      const r = await fetch("/api/schema/ddl/apply", {
        method:"POST", credentials:"same-origin",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ model }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message || body.error || ("HTTP " + r.status));
      closeModal();
      toast(T("Применено к базе") + ": " + (body.applied || 0) + " " + T("операц.")
            + (body.skipped ? " · " + T("пропущено") + ": " + body.skipped : ""));
    } catch (e){
      go.disabled = false; go.textContent = T("Применить");
      openModal(`<h3>${T("Применить к базе")}</h3>
        <div class="sb-modal-note bad">${T("Не применилось")}: ${esc(e.message)}</div>
        <div class="sb-modal-note">${T("База осталась в прежнем состоянии: применение идёт одной транзакцией. Отказ записан в журнал.")}</div>
        <div class="sb-acts"><button class="btn" id="sbAp_close2">${T("Закрыть")}</button></div>`);
      $("#sbAp_close2").onclick = closeModal;
    }
  };
}

/* Настройки вида холста. Живут в localStorage у каждого свои — модель общая,
   и подменять коллеге картинку своим выбором нельзя. На базу не влияют вовсе:
   скрытая связь всё равно превращается во внешний ключ при применении. */
function openViewModal(){
  const row = (k, title, note) => `<label class="sb-check"><input type="checkbox" data-v="${k}" ${sbView[k] ? "checked" : ""}>
    <span>${title}<i>${note}</i></span></label>`;
  openModal(`<h3>${T("Вид схемы")}</h3>
    <div class="sb-modal-note">${T("Только отображение. На то, что уедет в базу, эти настройки не влияют.")}</div>
    <div class="sb-form" style="padding:0">
      ${row("external", T("Связи между сущностями"), T("внешние ключи между разными схемами"))}
      ${row("internal", T("Связи внутри сущности"), T("между таблицами одной схемы; по умолчанию скрыты, чтобы не засорять холст"))}
      ${row("columns",  T("Показывать колонки"), T("иначе только плашки таблиц — так крупная схема читается целиком"))}
      ${row("types",    T("Показывать типы"), T("тип колонки справа от имени"))}
      <div class="sb-acts"><button class="btn" id="sbView_close">${T("Готово")}</button></div>
    </div>`);
  $$("#sbModalCard input[data-v]").forEach(i => i.onchange = () => {
    sbView[i.dataset.v] = i.checked; saveView(); render();
  });
  $("#sbView_close").onclick = closeModal;
}

function openModal(html){
  const m = $("#sbModal");
  $("#sbModalCard").innerHTML = html;
  m.classList.add("open");
}
function closeModal(){ $("#sbModal").classList.remove("open"); }

/* Новая СУЩНОСТЬ: заводим схему и сразу таблицу с тем же именем.
   Пустая сущность бесполезна — в базе схема без таблиц ничего не значит,
   и заставлять человека делать второй шаг незачем. */
function openSchemaModal(){
  openModal(`<h3>${T("Новая сущность")}</h3><div class="sb-form" style="padding:0">
    <div class="sb-grid2">
      <div class="sb-fg"><label>${T("Название")}</label><input id="sbNS_label" placeholder="${T("Например, Пользователь")}"></div>
      <div class="sb-fg"><label>${T("Системное имя")}</label><input class="mono" id="sbNS_id" placeholder="user"></div>
    </div>
    <div class="sb-fg"><label>${T("Описание")}</label><textarea id="sbNS_desc"></textarea></div>
    <div class="sb-modal-note" id="sbNS_hint"></div>
    <div class="sb-acts"><button class="btn accent" id="sbNS_create">${T("Создать")}</button>
      <button class="btn" id="sbNS_cancel">${T("Отмена")}</button></div></div>`);
  const hint = () => {
    const id = slug($("#sbNS_id").value || $("#sbNS_label").value) || "user";
    $("#sbNS_hint").innerHTML = T("В базе получится") + " <b class=\"mono\">" + esc(id) + "." + esc(id) + "</b>";
  };
  $("#sbNS_label").oninput = () => {
    if (!$("#sbNS_id").dataset.edited) $("#sbNS_id").value = slug($("#sbNS_label").value);
    hint();
  };
  $("#sbNS_id").oninput = () => { $("#sbNS_id").dataset.edited = "1"; hint(); };
  hint();
  $("#sbNS_cancel").onclick = closeModal;
  $("#sbNS_create").onclick = () => {
    const id = slug($("#sbNS_id").value || $("#sbNS_label").value);
    if (!id) return toast(T("Введите название"));
    if ((model.schemas || []).some(x => x.id === id)) return toast(T("Такое системное имя уже есть"));
    if (entityById(id)) return toast(T("Такое системное имя уже есть"));
    const label = $("#sbNS_label").value || id;
    const sch = ensureSchema(id);
    sch.label = label; sch.description = $("#sbNS_desc").value;
    const n = model.entities.length;
    const e = { id, schema: id, table: id, label, plural_label: label,
      description: "", title_field: "",
      fields: [{ name:"id", label:"ID", db_type:"bigserial", ui_type:"number", required:true, read_only:true,
        description: T("Первичный ключ"), target_entity:"", relation_kind:"", default_value:"", options:[] }],
      x: 40 + (n % 3) * 330, y: 40 + Math.floor(n / 3) * 300 };
    model.entities.push(e);
    state.schema = id; state.entity = e.id; state.field = null;
    closeModal(); commit("create", "schema", id, sch); toast(T("Сущность создана"));
  };
}

/* preset — схема, в которую сразу кладём таблицу (кнопка «+» у группы схемы). */
function openEntityModal(preset){
  openModal(`<h3>${T("Новая таблица")}</h3><div class="sb-form" style="padding:0">
    <div class="sb-grid2">
      <div class="sb-fg"><label>${T("Название")}</label><input id="sbNE_label" placeholder="${T("Например, Заявка")}"></div>
      <div class="sb-fg"><label>${T("Системное имя")}</label><input class="mono" id="sbNE_id" placeholder="application"></div>
    </div>
    <div class="sb-grid2">
      <div class="sb-fg"><label>${T("Таблица")}</label><input class="mono" id="sbNE_table" placeholder="applications"></div>
      <div class="sb-fg"><label>${T("Схема")}</label>
        <input class="mono" id="sbNE_schema" list="sbSchemaListNew" value="${esc(preset || "")}" placeholder="${T("новая или существующая")}">
        <datalist id="sbSchemaListNew">${allSchemas().map(x =>
          `<option value="${esc(x.id)}">${esc(x.label || x.id)}</option>`).join("")}</datalist></div>
    </div>
    <div class="sb-fg"><label>${T("Описание")}</label><textarea id="sbNE_desc"></textarea></div>
    <div class="sb-acts"><button class="btn accent" id="sbNE_create">${T("Создать")}</button>
      <button class="btn" id="sbNE_cancel">${T("Отмена")}</button></div></div>`);
  $("#sbNE_label").oninput = () => {
    if ($("#sbNE_id").dataset.edited) return;
    $("#sbNE_id").value = slug($("#sbNE_label").value);
    $("#sbNE_table").value = slug($("#sbNE_label").value);
  };
  $("#sbNE_id").oninput = () => $("#sbNE_id").dataset.edited = "1";
  $("#sbNE_cancel").onclick = closeModal;
  $("#sbNE_create").onclick = () => {
    const id = slug($("#sbNE_id").value || $("#sbNE_label").value);
    if (!id) return toast(T("Введите название"));
    if (entityById(id)) return toast(T("Такое системное имя уже есть"));
    ensureSchema(slug($("#sbNE_schema").value) || id);
    const n = model.entities.length;
    const e = { id, label: $("#sbNE_label").value || id, plural_label: $("#sbNE_label").value || id,
      table: slug($("#sbNE_table").value) || id, schema: slug($("#sbNE_schema").value) || id,
      description: $("#sbNE_desc").value, title_field:"",
      fields:[{ name:"id", label:"ID", db_type:"bigserial", ui_type:"number", required:true, read_only:true,
        description:T("Первичный ключ"), target_entity:"", relation_kind:"", default_value:"", options:[] }],
      x: 40 + (n % 3) * 330, y: 40 + Math.floor(n / 3) * 300 };
    model.entities.push(e);
    /* сущность с таким id могли раньше удалить — снимаем пометку, иначе наложение
       черновика на файл считало бы её удалённой */
    if (Array.isArray(model.deleted)) model.deleted = model.deleted.filter(x => x !== id);
    state.entity = id; state.field = null; setTab("entity");
    /* commit() сохраняет модель черновиком в crmpanel:schemaDraft — по этому же
       ключу пользовательская панель (js/entities.js) строит подразделы раздела
       «Сущности»: новая сущность появляется там сама, доступ по умолчанию только
       у администраторов (реестр crmpanel:entityAccess). */
    closeModal(); commit("create", "entity", id, e); toast(T("Таблица создана"));
  };
}
function openFieldModal(){
  const e = entityById(state.entity);
  if (!e) return toast(T("Сначала выберите таблицу"));
  const f = { name:"", label:"", db_type:"varchar(255)", ui_type:"text", required:false, read_only:false,
    description:"", target_entity:"", relation_kind:"", default_value:"", options:[] };
  openModal(`<h3>${T("Новое поле")} · ${esc(e.label)}</h3>` + fieldFormHtml(f, true));
  wireFieldAux(true);
  $("#sbF_cancel").onclick = closeModal;
  $("#sbF_save").onclick = () => {
    const v = readFieldForm();
    if (!v.name) return toast(T("Нужно системное имя"));
    if (e.fields.some(x => x.name === v.name)) return toast(T("Поле с таким именем уже есть"));
    e.fields.push(v);
    state.field = e.fields.length - 1; setTab("field");
    closeModal(); commit("create", "field", `${e.id}.${v.name}`, v); toast(T("Поле добавлено"));
  };
}
function openRelationModal(){
  if (model.entities.length < 2) return toast(T("Нужно хотя бы две таблицы"));
  const a = model.entities[0], b = model.entities[1];
  const r = { id:"rel_" + Date.now(), from_entity:a.id, from_field:(a.fields[0]||{}).name || "",
    to_entity:b.id, to_field:"id", relation_type:"many_to_one", nullable:true,
    on_delete:"RESTRICT", through:"", description:"" };
  openModal(`<h3>${T("Новая связь")}</h3>` + relationFormHtml(r, true));
  wireRelationForm(r);
  $("#sbR_cancel").onclick = closeModal;
  $("#sbR_save").onclick = () => {
    Object.assign(r, readRelationForm());
    model.relations.push(r);
    state.relation = r.id; setTab("relation");
    closeModal(); commit("create", "relation", r.id, r); toast(T("Связь добавлена"));
  };
}

/* ============================================================
   Экспорт: JSON для Git и SQL DDL
   ============================================================ */
function download(name, content, type){
  const url = URL.createObjectURL(new Blob([content], { type: type || "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a);
  try { a.click(); } catch(e){}
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 30000);
}
function saveToGit(){
  /* deleted — служебная пометка черновика (что не возвращать при наложении на файл).
     В сам файл она не едет: там сущности просто нет, и это уже вся правда. */
  const forFile = JSON.parse(JSON.stringify(model));
  delete forFile.deleted;
  const json = JSON.stringify(forFile, null, 2);
  openModal(`<h3>${T("Сохранить в Git")}</h3>
    <div class="sb-modal-note">${T("Схема версионируется в репозитории. Скачайте файл и положите его по пути")}
      <code>crm-admin/src/main/resources/static/settings/schema/crm-schema.json</code>,
      ${T("затем закоммитьте — это и будет новая версия схемы.")}<br>
      ${T("Когда появятся таблицы, сохранение переключится на прямую запись в БД без выгрузки файла.")}</div>
    <div class="sb-acts" style="margin:0 0 12px">
      <button class="btn accent" id="sbGit_dl">⬇ ${T("Скачать crm-schema.json")}</button>
      <button class="btn" id="sbGit_copy">${T("Копировать")}</button>
      <button class="btn" id="sbGit_applied">${T("Файл обновлён — снять пометку")}</button>
      <button class="btn" id="sbGit_close">${T("Закрыть")}</button>
    </div>
    <pre id="sbGit_text">${esc(json)}</pre>`);
  $("#sbGit_dl").onclick = () => download("crm-schema.json", json, "application/json");
  $("#sbGit_copy").onclick = async () => {
    try { await navigator.clipboard.writeText(json); } catch(e){
      const r = document.createRange(); r.selectNode($("#sbGit_text"));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      try { document.execCommand("copy"); } catch(_){}
      s.removeAllRanges();
    }
    toast(T("Скопировано"));
  };
  /* пользователь положил файл в репозиторий — черновик больше не «расходится» с Git */
  $("#sbGit_applied").onclick = () => {
    SchemaStore.baseline = JSON.parse(JSON.stringify(model));
    SchemaStore.dropDraft(); SchemaStore.writeDraft(model);
    closeModal(); renderStatus(); toast(T("Отмечено как сохранённое"));
  };
  $("#sbGit_close").onclick = closeModal;
}
function exportSql(){
  const skip = ["relation"];
  const parts = ["-- CRM Schema Builder · " + new Date().toISOString().slice(0, 10), ""];
  /* Сущность = схема: без CREATE SCHEMA выгрузку нельзя применить как есть. */
  allSchemas().forEach(s => parts.push(`CREATE SCHEMA IF NOT EXISTS ${s.id};`));
  parts.push("");
  model.entities.forEach(e => {
    const cols = e.fields.filter(f => !skip.includes(f.db_type)).map(f => {
      const pk = f.name === "id" && /serial/.test(f.db_type || "") ? " PRIMARY KEY" : "";
      const nn = f.required && f.name !== "id" ? " NOT NULL" : "";
      const def = f.default_value !== "" && f.default_value != null ? ` DEFAULT ${f.default_value}` : "";
      return `    ${f.name} ${f.db_type || "text"}${pk}${nn}${def}`;
    });
    parts.push(`CREATE TABLE ${schemaOf(e)}.${e.table} (`, cols.join(",\n"), ");", "");
  });
  model.relations.filter(r => r.relation_type !== "many_to_many").forEach(r => {
    const fe = entityById(r.from_entity), te = entityById(r.to_entity);
    if (fe && te && r.from_field) parts.push(
      `ALTER TABLE ${schemaOf(fe)}.${fe.table} ADD CONSTRAINT fk_${schemaOf(fe)}_${fe.table}_${r.from_field} ` +
      `FOREIGN KEY (${r.from_field}) REFERENCES ${schemaOf(te)}.${te.table} (${r.to_field}) ON DELETE ${r.on_delete};`);
  });
  model.relations.filter(r => r.relation_type === "many_to_many").forEach(r => {
    const fe = entityById(r.from_entity), te = entityById(r.to_entity);
    if (!fe || !te) return;
    const tn = r.through || `${fe.table}_${te.table}_link`;
    parts.push("", `CREATE TABLE ${schemaOf(fe)}.${tn} (`,
      `    ${r.from_entity}_id bigint NOT NULL REFERENCES ${schemaOf(fe)}.${fe.table}(id) ON DELETE CASCADE,`,
      `    ${r.to_entity}_id bigint NOT NULL REFERENCES ${schemaOf(te)}.${te.table}(id) ON DELETE CASCADE,`,
      `    PRIMARY KEY (${r.from_entity}_id, ${r.to_entity}_id)`, ");");
  });
  const sql = parts.join("\n");
  openModal(`<h3>SQL DDL</h3>
    <div class="sb-modal-note">${T("Схема в виде SQL: таблицы, внешние ключи и связующие таблицы many-to-many.")}</div>
    <div class="sb-acts" style="margin:0 0 12px">
      <button class="btn accent" id="sbSql_dl">⬇ ${T("Скачать .sql")}</button>
      <button class="btn" id="sbSql_close">${T("Закрыть")}</button></div>
    <pre>${esc(sql)}</pre>`);
  $("#sbSql_dl").onclick = () => download("crm_schema.sql", sql, "text/plain");
  $("#sbSql_close").onclick = closeModal;
}

/* ============================================================
   Раскладка под размер экрана: рабочая область занимает всё, что
   осталось от вьюпорта под тулбаром. Считаем в JS, потому что высота
   шапки раздела и тулбара «плавает» — тулбар переносится на узких
   экранах, а описание раздела занимает разное число строк.
   ============================================================ */
const NARROW = 1180;      /* ниже этой ширины раскладка становится вертикальной */
function layoutShell(){
  const shell = $(".sb-shell");
  if (!shell) return;
  if (window.innerWidth < NARROW){ shell.style.height = ""; return; }   /* на узких — по контенту */
  const top = shell.getBoundingClientRect().top;
  const pad = 26;                                    /* нижний отступ .content настроек */
  const h = Math.max(420, Math.round(window.innerHeight - top - pad));
  shell.style.height = h + "px";
}
let resizeTimer = null;
function relayout(){
  if (!booted) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { layoutShell(); fit(); }, 120);
}
window.addEventListener("resize", relayout);
/* Наблюдаем и за самим контейнером: высота шапки с тулбаром меняется не только
   при resize окна (перенос кнопок на узком экране, смена языка на длинные
   подписи), а событие resize в таких случаях не приходит. */
function watchLayout(){
  if (typeof ResizeObserver !== "function") return;
  const ro = new ResizeObserver(relayout);
  const content = document.querySelector(".content"), bar = $(".sb-toolbar");
  if (content) ro.observe(content);
  if (bar) ro.observe(bar);
}

/* ============================================================
   Канвас: перетаскивание, панорама, зум, авто-раскладка
   ============================================================ */
function transform(){
  const vp = $("#sbViewport");
  if (vp) vp.style.transform = `translate(${state.tx}px,${state.ty}px) scale(${state.scale})`;
  renderStatus();
}
function toWorld(ev){
  const r = $("#sbCanvas").getBoundingClientRect();
  return { x:(ev.clientX - r.left - state.tx) / state.scale, y:(ev.clientY - r.top - state.ty) / state.scale };
}
function autoLayout(){
  /* Раскладываем СУЩНОСТИ: таблицы внутри идут потоком и своих координат не имеют.
     Шаг по вертикали крупнее — узел сущности выше, чем была одиночная таблица. */
  const list = allSchemas();
  const cols = Math.max(1, Math.ceil(Math.sqrt(list.length)));
  list.forEach((s, i) => { s.x = 30 + (i % cols) * 380; s.y = 30 + Math.floor(i / cols) * 420; });
  commit("layout", "schema", null, null);
  setTimeout(fit, 30);
}
function fit(){
  if (!model.entities.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  allSchemas().forEach(s => {
    const r = nodeRect(s.id); if (!r) return;
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
  });
  if (minX === Infinity) return;
  const c = $("#sbCanvas").getBoundingClientRect(), m = 26;
  if (!c.width || !c.height) return;
  /* нижняя граница 45%: втиснуть всю схему в узкую колонку можно, но читать её
     будет нельзя — лучше показать крупнее, а остальное досмотреть панорамой */
  const raw = Math.min((c.width - m*2) / (maxX - minX), (c.height - m*2) / (maxY - minY));
  state.scale = Math.max(.45, Math.min(1, raw));
  /* центрируем содержимое в видимой области */
  state.tx = (c.width - (maxX - minX) * state.scale) / 2 - minX * state.scale;
  state.ty = Math.max(m, (c.height - (maxY - minY) * state.scale) / 2) - minY * state.scale;
  transform();
}

/* ============================================================
   Инициализация раздела (вызывается при открытии pane)
   ============================================================ */
async function boot(){
  if (booted) return;
  const canvas = $("#sbCanvas");
  if (!canvas) return;
  booted = true;

  /* тулбар */
  $("#sbAddEntity").onclick = openSchemaModal;
  $("#sbAddRelation").onclick = openRelationModal;
  $("#sbAuto").onclick = autoLayout;
  $("#sbFit").onclick = fit;
  $("#sbExpand").onclick = toggleAllFields;
  $("#sbSql").onclick = exportSql;
  $("#sbApply").onclick = applyToDb;
  $("#sbView").onclick = openViewModal;
  $("#sbGit").onclick = saveToGit;
  $("#sbReload").onclick = async () => {
    if (SchemaStore.isDirty(model) && !confirm(T("Черновик будет потерян. Загрузить версию из Git?"))) return;
    SchemaStore.dropDraft();
    await load(); toast(T("Загружено из Git"));
  };
  $("#sbSearch").oninput = ev => { state.q = ev.target.value; renderLists(); };
  $$("#sbTabs .sb-tab").forEach(t => t.onclick = () => { setTab(t.dataset.tab); renderInspector(); });
  $("#sbZin").onclick = () => { state.scale = Math.min(2, state.scale * 1.15); transform(); };
  $("#sbZout").onclick = () => { state.scale = Math.max(.25, state.scale / 1.15); transform(); };
  $("#sbZreset").onclick = () => { state.scale = 1; state.tx = 20; state.ty = 20; transform(); };
  $("#sbModal").onclick = ev => { if (ev.target.id === "sbModal") closeModal(); };

  /* панорама и зум канваса */
  canvas.onmousedown = ev => {
    if (ev.target.closest(".sb-node") || ev.target.closest("button")) return;
    state.pan = { x:ev.clientX, y:ev.clientY, tx:state.tx, ty:state.ty };
  };
  canvas.onwheel = ev => {
    ev.preventDefault();
    const r = canvas.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const wx = (mx - state.tx) / state.scale, wy = (my - state.ty) / state.scale;
    const n = Math.max(.25, Math.min(2, state.scale * (ev.deltaY < 0 ? 1.1 : .9)));
    state.tx = mx - wx * n; state.ty = my - wy * n; state.scale = n; transform();
  };
  document.addEventListener("mousemove", ev => {
    if (state.drag){
      const p = toWorld(ev), e = model.schemas.find(x => x.id === state.drag.id);
      if (!e) return;
      e.x = Math.round(p.x - state.drag.dx); e.y = Math.round(p.y - state.drag.dy);
      const n = document.querySelector(`.sb-node[data-id="${CSS.escape(e.id)}"]`);
      if (n){ n.style.left = e.x + "px"; n.style.top = e.y + "px"; }
      renderEdges();
    } else if (state.pan){
      state.tx = state.pan.tx + ev.clientX - state.pan.x;
      state.ty = state.pan.ty + ev.clientY - state.pan.y;
      transform();
    }
  });
  document.addEventListener("mouseup", () => {
    if (state.drag){ const id = state.drag.id; state.drag = null; commit("move", "schema", id, null); }
    state.pan = null;
  });
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && $("#sbModal").classList.contains("open")) closeModal();
  });
  watchLayout();

  await load();
}
async function load(){
  try {
    model = await SchemaStore.load();
    model.entities.forEach((e, i) => {   /* координаты могли не сохраниться — раскладываем */
      if (typeof e.x !== "number") e.x = 40 + (i % 3) * 330;
      if (typeof e.y !== "number") e.y = 40 + Math.floor(i / 3) * 300;
    });
    state.entity = model.entities[0] ? model.entities[0].id : null;
    render(); layoutShell(); transform(); setTimeout(fit, 40);
  } catch(err){
    const host = $("#sbInspector");
    if (host) host.innerHTML = `<div class="sb-form"><div class="sb-hint bad">${T("Не удалось загрузить схему")}: ${esc(err.message)}</div></div>`;
    toast(T("Не удалось загрузить схему"));
  }
}

/* публичный вход: settings/index.html зовёт при открытии раздела.
   Пока раздел скрыт, канвас имеет нулевой размер и подгонка невозможна,
   поэтому при каждом открытии перерисовываем и вписываем схему заново. */
function openSection(){
  if (!booted) return boot();
  /* Схему правит не только этот раздел: «Сущности» (object-manager.js) пишет в
     то же хранилище настройки отображения. Если черновик разошёлся с моделью в
     памяти — перечитываем, иначе следующий commit() затрёт чужие правки. */
  const draft = SchemaStore.readDraft();
  if (draft && JSON.stringify(draft) !== JSON.stringify(model)) return load();
  render(); layoutShell(); setTimeout(fit, 40);
}
/* принять модель, сохранённую соседним разделом настроек (без перезагрузки схемы) */
function adopt(m){
  if (!booted || !m) return;
  model = m;
  if (state.entity && !entityById(state.entity)) state.entity = null;
  render();
}
window.SchemeBuilder = { open: openSection, render, adopt, store: SchemaStore, API_CONTRACT, UI_TYPES };
})();
