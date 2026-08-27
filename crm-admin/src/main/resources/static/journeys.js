/* Раздел «Цепочки»: конструктор блок-схем по образцу Salesforce Flow Builder (Drawflow).
   Типы узлов: Communication Alert, Subflow (Actions), Assignment/Decision/Pause/Loop (Logic),
   Create/Update/Get/Delete Records (Data). Данные ходят через /api/journeys.
   Узел на канве — компактный блок; настройки открываются модалкой по двойному клику. */
(function () {
  "use strict";

  var editor = null;        // экземпляр Drawflow
  var currentId = null;     // id открытой цепочки (null = новая)
  var inited = false;
  var listCache = [];       // кэш списка цепочек (для options у Subflow)

  // ---------------------------------------------------------------- реестр типов узлов
  // kind: text | number | textarea | select(opts) | bool | template (код шаблона + ⚙)
  //       | subflow (выбор цепочки + ↗) | steps (кол-во SQL-шагов + текст каждого)
  // Справочники значений — из прода (source подтягивается из шаблона первой comm-ноды)
  var NOTIFY_CHANNELS = ["", "SMS", "EMAIL", "PUSH", "CC", "FA", "VK", "WA", "WEBPUSH", "ROBOT"];
  /* Суффикс V2 есть не у всех: КЦ, ФА, робот и группа *ChannelProcess живут в проде без
     него, «дописать для единообразия» тут значит сломать. У vk и wa существуют ОБА
     варианта — оставлены оба. Префикс robotChannelProcess не опечатка: у робота он
     совпадает с именем процесса и пишется со строчной. */
  var DEFINITION_KEYS = ["", "smsChannelProcessV2", "pushChannelProcessV2", "smsChannelProccessV2",
                         "emailChannelProcessV2", "vkChannelProcessV2", "waChannelProcessV2",
                         "callCenterChannelProcess", "faChannelProcess", "vkChannelProcess",
                         "waChannelProcess", "webPushChannelProcess", "robotChannelProcess"];
  var BUSINESS_KEY_PREFIXES = ["", "WaChannel", "VkChannel", "PushChannel", "webPushChannel",
                               "pushChannel", "emailChannel", "smsChannel", "CallCenterChannel",
                               "FaChannel", "WebPushChannel", "robotChannelProcess"];
  var DATABASES = ["crmdb", "greenplum"];
  var NODE_TYPES = {
    startIncome: {
      label: "Income event", cls: "start", ins: 0, outs: 1,
      fields: [
        /* Событие не набирается руками, а выбирается из tracker.t_event_comm: его id
           и есть t_event_comm_id, по которому лежит цепочка в commapi.events_chain.
           Набранное руками имя разошлось бы с тем, что уже заведено в трекере, —
           и цепочка повисла бы ни на чём. */
        { k: "t_event_comm_id",     l: "Событие",            kind: "eventPick" },
        { k: "event_name",          l: "Имя события",        kind: "text", ro: true },
        { k: "system",              l: "Система",            kind: "text", ro: true },
        /* Условие выхода задаётся блоком Flow exit, а не полем: одна колонка не должна
           заполняться из двух мест. */
        /* Полей, описывающих КАК завести событие, здесь больше нет: канал, sub channel,
           платформа, группа, send_delay, life time, allow ML, definition key, business
           key prefix. Событие теперь не заводится узлом, а выбирается из уже заведённых
           в tracker.t_event_comm — и все эти параметры у него свои. Оставить их значило
           бы показывать поля, которые ни на что не влияют, а заполненные ещё и врут:
           человек правит канал, а у события в трекере остаётся прежний. */
      ]
    },
    startTime: {
      label: "Time event", cls: "start", ins: 0, outs: 1,
      fields: [
        { k: "event_name",          l: "Имя события",        kind: "text" },
        { k: "system",              l: "Система",            kind: "text" },
        { k: "notify_channel",      l: "Канал (notify)",     kind: "select", opts: NOTIFY_CHANNELS },
        /* is_batch: массовый метод отправки (true) против единичного (false).
           Раньше в прод всегда уезжало true. */
        { k: "is_batch",            l: "Массовый метод отправки", kind: "bool", def: "true" },
        { k: "crontab",             l: "Crontab (текстом, напр. 0 9 * * *)", kind: "text" },
        { k: "database",            l: "База выборки",       kind: "select", opts: DATABASES, def: "crmdb" },
        { k: "process_name",        l: "Имя процесса (selection)", kind: "text" },
        { k: "sql_steps",           l: "SQL-шаги выборки",   kind: "steps" },
        { k: "definition_key",      l: "Definition key",     kind: "select", opts: DEFINITION_KEYS },
        { k: "business_key_prefix", l: "Business key prefix", kind: "select", opts: BUSINESS_KEY_PREFIXES },
        { k: "is_active",           l: "Событие активно",    kind: "bool", def: "true" }
      ]
    },
    comm: {
      label: "Communication Alert", cls: "comm", outs: 1,
      fields: [
        { k: "channel",   l: "Тип коммуникации", kind: "select", opts: ["sms", "push", "email", "cc"] },
        { k: "template",  l: "Код шаблона",      kind: "template" },
        /* Задержку и снятие шага задают блоки Таймер и Step exit, стоящие перед этим
           шагом. Полями их не дублируем: одну колонку нельзя заполнять из двух мест —
           однажды они разойдутся, и какое значение уехало в базу, будет не понять. */
        { k: "day",       l: "День (из шаблона)", kind: "number", ro: true },
        { k: "note",      l: "Что происходит",   kind: "textarea" },
        { k: "active",    l: "Активен",          kind: "bool" }
      ]
    },
    /* ---- Блоки цепочки онлайн-события (commapi.events_chain) ----
       Все три — накопители: сами строк не создают, а задают колонки того шага,
       который идёт за ними по стрелке. Порядок на холсте и есть порядок применения.

       Почему не Decision: у него два выхода, и «да» обязано куда-то вести. Здесь
       «да» всегда означает стоп, вести оттуда некуда, и нарисованную стрелку было
       бы не во что скомпилировать. Эти блоки выходов не имеют вовсе — обещать
       нечего. */
    timer: {
      label: "Таймер", cls: "logic", outs: 1,
      fields: [
        /* Отсчёт от прихода события, а не от предыдущей отправки: так расписание всей
           цепочки известно в момент старта и не плывёт, если один шаг задержался. */
        { k: "wait_time", l: "Задержка от события, мин", kind: "number", def: "0" }
      ]
    },
    /* Flow exit один на всю цепочку и задаётся один раз — в модалке заведения или
       вот этим блоком. В таблице он лежит у каждой строки, кроме первой, но это
       одна и та же строка условия: движок обрывает поток целиком, а не шаг.
       Второй такой блок добавить нельзя — jrAddNode откроет уже стоящий. */
    flowExit: {
      label: "Flow exit", cls: "logic", outs: 1,
      fields: [
        { k: "event_name", l: "Отменяющее событие — SQL (одно на всю цепочку)", kind: "textarea" }
      ]
    },
    stepExit: {
      label: "Step exit", cls: "logic", outs: 1,
      fields: [
        { k: "event_name", l: "Событие, снимающее следующий шаг — SQL", kind: "textarea" }
      ]
    },
    ifCheck: {
      label: "Проверка (if)", cls: "logic", outs: 1,
      fields: [
        { k: "expr", l: "Условие", kind: "text" },
        { k: "note", l: "Что проверяем", kind: "textarea" }
      ]
    },
    /* Рамка группировки. Ни входов, ни выходов: она ничего не исполняет и в
       commapi.events_chain не уезжает — это подпись на холсте, объединяющая блоки
       одного шага. Принадлежность блока группе нигде не хранится и считается по
       геометрии в момент перетаскивания: блок внутри рамки — значит её. Хранить
       список детей значило бы держать вторую правду о том, что и так видно
       глазами, и расходиться она начала бы с первого же перетаскивания. */
    group: {
      label: "Группа", cls: "group", ins: 0, outs: 0,
      fields: [
        { k: "title", l: "Название группы", kind: "text" },
        { k: "note",  l: "Подпись",         kind: "text" },
        { k: "w",     l: "Ширина, px",      kind: "number", def: "760" },
        { k: "h",     l: "Высота, px",      kind: "number", def: "170" }
      ]
    },
    subflow: {
      label: "Subflow", cls: "subflow", outs: 1,
      fields: [
        { k: "journey", l: "Вложенная цепочка", kind: "subflow" },
        { k: "note",    l: "Комментарий",       kind: "textarea" }
      ]
    },
    assignment: {
      label: "Assignment", cls: "logic", outs: 1,
      fields: [
        { k: "title",    l: "Название",    kind: "text" },
        { k: "variable", l: "Переменная",  kind: "text" },
        { k: "value",    l: "Значение",    kind: "text" },
        { k: "note",     l: "Комментарий", kind: "textarea" }
      ]
    },
    decision: {
      label: "Decision", cls: "logic", outs: 2, outLabels: ["Да", "Нет"],
      fields: [
        { k: "title", l: "Название", kind: "text" },
        { k: "sql",   l: "SQL-условие (SELECT → Да/Нет)", kind: "textarea" }
      ]
    },
    pause: {
      label: "Pause", cls: "logic", outs: 1,
      fields: [
        { k: "title",    l: "Название",        kind: "text" },
        { k: "duration", l: "Ждать (дней)",    kind: "number" },
        { k: "until",    l: "Или до события",  kind: "text" }
      ]
    },
    loop: {
      label: "Loop", cls: "logic", outs: 2, outLabels: ["Для каждого", "После последнего"],
      fields: [
        { k: "title",      l: "Название",  kind: "text" },
        { k: "collection", l: "Коллекция", kind: "text" }
      ]
    },
    createRecords: {
      label: "Create Records", cls: "data", outs: 1,
      fields: [
        { k: "title",     l: "Название",           kind: "text" },
        { k: "object",    l: "Таблица / объект",   kind: "text" },
        { k: "fieldsMap", l: "Поля (поле=значение)", kind: "textarea" }
      ]
    },
    updateRecords: {
      label: "Update Records", cls: "data", outs: 1,
      fields: [
        { k: "title",     l: "Название",           kind: "text" },
        { k: "object",    l: "Таблица / объект",   kind: "text" },
        { k: "filter",    l: "Условие отбора",     kind: "text" },
        { k: "fieldsMap", l: "Поля (поле=значение)", kind: "textarea" }
      ]
    },
    getRecords: {
      label: "Get Records", cls: "data", outs: 1,
      fields: [
        { k: "title",  l: "Название",         kind: "text" },
        { k: "object", l: "Таблица / объект", kind: "text" },
        { k: "filter", l: "Условие отбора",   kind: "text" },
        { k: "into",   l: "В переменную",     kind: "text" }
      ]
    },
    deleteRecords: {
      label: "Delete Records", cls: "data", outs: 1,
      fields: [
        { k: "title",  l: "Название",         kind: "text" },
        { k: "object", l: "Таблица / объект", kind: "text" },
        { k: "filter", l: "Условие отбора",   kind: "text" }
      ]
    }
  };
  // поля, которые лежат в DTO первым классом (не в props)
  var CORE_KEYS = { channel: 1, day: 1, template: 1, title: 1, note: 1, active: 1 };

  function canEdit() {
    return !!(window.CRM && CRM.me && CRM.me.canEdit);
  }
  function newJid() {
    return "n" + Math.random().toString(36).slice(2, 8);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }
  /* Шаги выборки. Исторически хранились массивом строк, теперь — массивом
     { sql, active } (активность шага уезжает в scheduler.t_execution_steps.is_active).
     Старый формат читаем как есть: строка = активный шаг. */
  function parseSteps(v) {
    try {
      var a = JSON.parse(v || "[]");
      if (!Array.isArray(a)) return [];
      return a.map(function (s) {
        if (s && typeof s === "object")
          return { sql: String(s.sql == null ? "" : s.sql), active: s.active !== false };
        return { sql: String(s == null ? "" : s), active: true };
      });
    } catch (e) { return []; }
  }

  // -------------------------------------------------------- подписи на блоках
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    return b === 1 ? one : many;
  }

  /* Минуты словами. «через 1440 мин» человек в уме не переводит, а решение «слать
     через сутки или через час» принимается именно по этому числу. */
  function waitWords(min) {
    var m = Number(min);
    if (!isFinite(m) || m <= 0) return "сразу после события";
    if (m < 60) return "через " + m + " " + plural(m, "минуту", "минуты", "минут");
    if (m % 1440 === 0) return "через " + (m / 1440) + " " + plural(m / 1440, "день", "дня", "дней");
    if (m % 60 === 0) return "через " + (m / 60) + " " + plural(m / 60, "час", "часа", "часов");
    return "через " + Math.floor(m / 60) + " ч " + (m % 60) + " мин";
  }

  /* Условие выхода на блоке — одной строкой. В таблице оно лежит целым SQL на
     полтора экрана: показать его как есть значило бы вместо схемы получить простыню,
     а спрятать совсем — соврать, что условия нет. Поэтому вытаскиваем имена событий,
     ради которых запрос и написан, а полный текст оставляем в подсказке при наведении. */
  function condWords(v) {
    var s = String(v == null ? "" : v).trim();
    if (!s) return "";
    var names = (s.match(/'[A-Za-z_][A-Za-z0-9_.]*'/g) || [])
      .map(function (x) { return x.slice(1, -1); })
      .filter(function (x, i, a) { return a.indexOf(x) === i; });
    if (!names.length) return s.length > 64 ? s.slice(0, 61) + "…" : s;
    if (names.length === 1) return names[0];
    return names[0] + " и ещё " + (names.length - 1) + " " +
      plural(names.length - 1, "событие", "события", "событий");
  }

  // -------------------------------------------- проверка существования шаблона
  var tplCache = {}; // "sms:1" -> true|false (есть ли шаблон в справочнике)

  function checkTemplate(channel, code) {
    if (!channel || !code) return Promise.resolve(false);
    var key = channel + ":" + code;
    if (tplCache[key] != null) {
      return Promise.resolve(tplCache[key] ? tplCache[key] : false);
    }
    return CRM.getTemplate(channel, code).then(function (dto) {
      tplCache[key] = dto || true;
      return tplCache[key];
    }).catch(function () {
      tplCache[key] = false;
      return false;
    });
  }

  /** Список проблем по шаблонам comm-узлов ("шаблон sms:5 не найден", "узел без кода шаблона"). */
  function missingTemplates(j) {
    var checks = j.nodes.filter(function (n) { return n.type === "comm"; }).map(function (n) {
      if (!n.channel || !n.templateCode) {
        return Promise.resolve("у Communication Alert не указан канал или код шаблона");
      }
      return checkTemplate(n.channel, n.templateCode).then(function (dto) {
        return dto ? null : "шаблон " + n.channel + ":" + n.templateCode +
          " не найден — заведи его в «Мастере коммуникаций»";
      });
    });
    return Promise.all(checks).then(function (arr) {
      return arr.filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; });
    });
  }

  // ---------------------------------------------------------------- карточка узла (компактная)
  function nodeSummary(type, d) {
    d = d || {};
    switch (type) {
      case "startIncome":
        return [d.event_name || "событие не задано", d.system].filter(Boolean).join(" · ");
      case "startTime": {
        var n = parseSteps(d.sql_steps).filter(function (s) { return s.sql.trim(); }).length;
        return [d.event_name || "событие не задано",
                d.crontab ? "cron: " + d.crontab : null,
                "SQL-шагов: " + n].filter(Boolean).join("\n");
      }
      case "comm": {
        var top = (d.channel ? d.channel.toUpperCase() : "канал не выбран") +
          (d.template ? " · шаблон " + d.template : " · шаблон не указан") +
          (d.day && d.day !== "0" ? " · день " + d.day : "");
        var key = d.channel && d.template ? d.channel + ":" + d.template : null;
        var warn = (!d.template || (key && tplCache[key] === false)) ? "⚠ шаблона нет" : null;
        var note = (d.note || "").trim();
        if (note.length > 72) note = note.slice(0, 69) + "…";
        return [top, note || null, warn].filter(Boolean).join("\n");
      }
      /* Блоки цепочки раньше не подписывались вовсе: на холсте стояли пустые
         прямоугольники «Таймер» и «Flow exit», и что именно в них задано, было
         видно только по двойному клику. Схема без подписей не схема. */
      case "timer":
        return waitWords(d.wait_time) + "\nотсчёт от прихода события";
      case "flowExit":
        return d.event_name
          ? "обрывает всю цепочку:\n" + condWords(d.event_name)
          : "условие не задано";
      case "stepExit":
        return d.event_name
          ? "снимает следующий шаг:\n" + condWords(d.event_name)
          : "условие не задано";
      case "ifCheck":
        return [condWords(d.expr) || "условие не задано", d.note].filter(Boolean).join("\n");
      case "subflow": {
        var j = listCache.filter(function (x) { return x.id === d.journey; })[0];
        return j ? "→ " + j.name : "цепочка не выбрана";
      }
      case "decision":
        return [d.title, (d.sql || "").trim() ? "SQL задан" : "SQL не задан"].filter(Boolean).join("\n");
      case "assignment":
        return d.variable ? d.variable + " = " + (d.value || "") : (d.title || "");
      case "pause":
        return (d.duration && d.duration !== "0") ? "Ждать " + d.duration + " дн."
             : (d.until ? "До события " + d.until : "");
      case "loop":
        return d.collection ? "По " + d.collection : (d.title || "");
      default:
        return [d.title, d.object].filter(Boolean).join("\n");
    }
  }

  /* Полный текст условия — в подсказке при наведении. На карточке он не помещается,
     но проверить, какой именно SQL стоит в блоке, надо уметь не открывая модалку. */
  function nodeTip(type, d) {
    d = d || {};
    if (type === "flowExit" || type === "stepExit") return d.event_name || "";
    if (type === "ifCheck") return d.expr || "";
    if (type === "comm") return d.note || "";
    return "";
  }

  function nodeHtml(type, d) {
    var t = NODE_TYPES[type];
    if (type === "group") {
      return '<div class="jrn jrn-group">' +
        '<div class="jrn-gtitle">' + esc(d.title || "Группа") + "</div>" +
        (d.note ? '<div class="jrn-gnote">' + esc(d.note) + "</div>" : "") +
        "</div>";
    }
    var chCls = (type === "comm" && d && d.channel) ? " jrn-ch-" + d.channel : "";
    var tip = nodeTip(type, d);
    var html = '<div class="jrn jrn-' + t.cls + chCls + '"' +
      (tip ? ' title="' + esc(tip) + '"' : "") + ">" +
      '<div class="jrn-head">' + t.label + "</div>" +
      '<div class="jrn-sum">' + esc(nodeSummary(type, d)) + "</div>";
    if (t.outLabels) {
      html += '<div class="jrn-outs">' +
        t.outLabels.map(function (l, i) { return "выход " + (i + 1) + " — " + l; }).join(" · ") +
        "</div>";
    }
    return html + "</div>";
  }

  function updateNodeCard(dfId) {
    var n = editor.getNodeFromId(dfId);
    if (!n || !NODE_TYPES[n.name]) return;
    var el = document.querySelector("#jrCanvas #node-" + dfId + " .drawflow_content_node");
    if (el) el.innerHTML = nodeHtml(n.name, n.data);
    if (n.name === "group") applyGroupSize(dfId, n.data);
  }

  /* Размер рамки — инлайном: у всех остальных блоков ширина одна и задана в CSS,
     а группа обязана быть ровно такой, чтобы накрыть свои блоки. */
  function applyGroupSize(dfId, d) {
    var el = nodeElById(dfId);
    if (!el) return;
    el.style.width = Math.max(200, parseInt(d.w, 10) || 760) + "px";
    el.style.height = Math.max(90, parseInt(d.h, 10) || 170) + "px";
  }

  function addNodeAt(type, data, x, y) {
    var t = NODE_TYPES[type] || NODE_TYPES.comm;
    // миграция старых схем Time event: одно поле sql → массив шагов; selection → process_name
    if (type === "startTime") {
      if (!data.sql_steps && data.sql) data.sql_steps = JSON.stringify([String(data.sql)]);
      if (!data.process_name && data.selection) data.process_name = data.selection;
    }
    // старые схемы: notify_channel был текстом в нижнем регистре, справочник — капсом
    if ((type === "startTime" || type === "startIncome") && data.notify_channel) {
      data.notify_channel = String(data.notify_channel).toUpperCase();
    }
    var d = { jid: data.jid || newJid() };
    t.fields.forEach(function (f) {
      var v = data[f.k];
      if (f.kind === "bool") {
        if (v == null) d[f.k] = f.def != null ? f.def : "true";
        else d[f.k] = (v === false || v === "false") ? "false" : "true";
      } else if (v != null) {
        d[f.k] = String(v);
      } else {
        d[f.k] = f.def != null ? f.def : (f.kind === "number" ? "0" : "");
      }
    });
    var ins = t.ins != null ? t.ins : 1; // у стартовых узлов входов нет
    var id = editor.addNode(type, ins, t.outs, x, y, "jrnode-" + t.cls, d, nodeHtml(type, d));
    if (type === "group") applyGroupSize(id, d);
    return id;
  }

  // ------------------------------------------- мультивыделение нод
  /* Рамка по пустому месту выделяет блоки, Ctrl+клик добавляет и убирает по одному,
     перетаскивание любого выделенного двигает всю пачку, Delete удаляет её целиком.
     Рамка повешена на обычное протягивание, а не на Shift: выделять несколько блоков
     приходится постоянно, а двигать холст — редко, и модификатор достался тому, что
     чаще. Панорама переехала на Shift+протягивание, о чём написано в подсказке. */
  var groupSel = new Set(); // df-id выделенных нод
  var gDrag = null;         // групповое перетаскивание
  var band = null, bandEl = null; // рамка выделения

  function nodeElById(id) {
    return document.querySelector("#jrCanvas #node-" + id);
  }
  function setSel(id, on) {
    var el = nodeElById(id);
    if (on) {
      groupSel.add(id);
      if (el) el.classList.add("jr-msel");
    } else {
      groupSel.delete(id);
      if (el) el.classList.remove("jr-msel");
    }
  }
  function clearSel() {
    Array.from(groupSel).forEach(function (id) { setSel(id, false); });
  }
  function nodeType(id) {
    var n = editor.drawflow.drawflow[editor.module].data[id];
    return n ? n.name : null;
  }
  /** df-id первого узла такого типа на холсте (или null). */
  function findNodeByType(type) {
    var data = editor.drawflow.drawflow[editor.module].data;
    var hit = Object.keys(data).filter(function (k) { return data[k].name === type; })[0];
    return hit == null ? null : parseInt(hit, 10);
  }

  /* Что лежит на рамке группировки. Принадлежность считается по геометрии — центр
     блока внутри рамки, — а не хранится списком: список пришлось бы поддерживать при
     каждом перетаскивании, и первое же расхождение с картинкой на экране стало бы
     необъяснимым. Здесь же «положил на рамку» и «принадлежит рамке» — одно и то же. */
  function nodesOnGroup(groupId) {
    var g = nodeElById(groupId);
    if (!g) return [];
    var gx = g.offsetLeft, gy = g.offsetTop, gw = g.offsetWidth, gh = g.offsetHeight;
    var out = [];
    document.querySelectorAll("#jrCanvas .drawflow-node").forEach(function (el) {
      var id = parseInt(el.id.slice(5), 10);
      if (id === groupId) return;
      var cx = el.offsetLeft + el.offsetWidth / 2, cy = el.offsetTop + el.offsetHeight / 2;
      if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) out.push(id);
    });
    return out;
  }

  function wireMultiSelect(host) {
    // Ctrl/Cmd+клик по ноде — переключить выделение
    host.addEventListener("click", function (e) {
      if (!canEdit()) return;
      if (!e.ctrlKey && !e.metaKey) return;
      var el = e.target.closest(".drawflow-node");
      if (!el) return;
      var id = parseInt(el.id.slice(5), 10);
      setSel(id, !groupSel.has(id));
    });
    // клик по пустой канве без модификаторов — сброс выделения
    host.addEventListener("mousedown", function (e) {
      if (e.target.closest(".drawflow-node")) return;
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) clearSel();
    });

    // рамка по пустому месту (capture — чтобы Drawflow не начал панораму канвы)
    host.addEventListener("mousedown", function (e) {
      if (!canEdit() || e.button !== 0) return;
      if (e.shiftKey) return;                       // Shift — панорама холста, её ведёт Drawflow
      if (e.target.closest(".drawflow-node")) return;
      e.preventDefault();
      e.stopPropagation();
      var r = host.getBoundingClientRect();
      band = { x0: e.clientX - r.left, y0: e.clientY - r.top, rect: null };
      bandEl = document.createElement("div");
      bandEl.id = "jrBand";
      host.appendChild(bandEl);
    }, true);

    /* Групповое перетаскивание. Два повода тащить пачку: взяли один из выделенных
       блоков — едет всё выделение; взяли рамку группировки — едет всё, что на ней
       лежит. Второе и есть смысл рамки: шаг двигают целиком, а не по блоку. */
    host.addEventListener("mousedown", function (e) {
      if (!canEdit() || e.button !== 0 || band) return;
      var el = e.target.closest(".drawflow-node");
      if (!el) return;
      var id = parseInt(el.id.slice(5), 10);
      var ids = null;
      if (nodeType(id) === "group") {
        ids = [id].concat(nodesOnGroup(id));
      } else if (groupSel.has(id) && groupSel.size > 1) {
        ids = Array.from(groupSel);
      }
      if (!ids || ids.length < 2) return;
      gDrag = { grab: id, ids: ids, sx: e.clientX, sy: e.clientY, pos: {} };
      ids.forEach(function (nid) {
        var ne = nodeElById(nid);
        if (ne) gDrag.pos[nid] = { x: ne.offsetLeft, y: ne.offsetTop };
      });
    });

    document.addEventListener("mousemove", function (e) {
      if (band && bandEl) {
        var r = host.getBoundingClientRect();
        var x1 = e.clientX - r.left, y1 = e.clientY - r.top;
        var x = Math.min(band.x0, x1), y = Math.min(band.y0, y1);
        var w = Math.abs(x1 - band.x0), h = Math.abs(y1 - band.y0);
        bandEl.style.left = x + "px"; bandEl.style.top = y + "px";
        bandEl.style.width = w + "px"; bandEl.style.height = h + "px";
        band.rect = { x: x, y: y, w: w, h: h };
        return;
      }
      if (!gDrag) return;
      // сам «схваченный» узел двигает Drawflow — остальным даём то же смещение
      var dx = (e.clientX - gDrag.sx) / editor.zoom;
      var dy = (e.clientY - gDrag.sy) / editor.zoom;
      gDrag.ids.forEach(function (nid) {
        if (nid === gDrag.grab || !gDrag.pos[nid]) return;
        var ne = nodeElById(nid);
        if (!ne) return;
        ne.style.left = (gDrag.pos[nid].x + dx) + "px";
        ne.style.top = (gDrag.pos[nid].y + dy) + "px";
        editor.updateConnectionNodes("node-" + nid);
      });
    });

    document.addEventListener("mouseup", function () {
      if (band) {
        var rect = band.rect;
        if (rect && rect.w > 4 && rect.h > 4) {
          var hr = host.getBoundingClientRect();
          document.querySelectorAll("#jrCanvas .drawflow-node").forEach(function (el) {
            var nr = el.getBoundingClientRect();
            var nx = nr.left - hr.left, ny = nr.top - hr.top;
            var hit = nx < rect.x + rect.w && nx + nr.width > rect.x &&
                      ny < rect.y + rect.h && ny + nr.height > rect.y;
            if (hit) setSel(parseInt(el.id.slice(5), 10), true);
          });
        }
        if (bandEl) bandEl.remove();
        band = null; bandEl = null;
        return;
      }
      if (!gDrag) return;
      // финальные координаты остальных нод — в данные Drawflow (для сохранения)
      gDrag.ids.forEach(function (nid) {
        if (nid === gDrag.grab) return;
        var ne = nodeElById(nid);
        var d = editor.drawflow.drawflow[editor.module].data[nid];
        if (ne && d) { d.pos_x = ne.offsetLeft; d.pos_y = ne.offsetTop; }
      });
      gDrag = null;
    });

    // Delete — удалить всю группу (когда фокус не в поле ввода)
    host.addEventListener("keydown", function (e) {
      if (e.key !== "Delete" || !groupSel.size || !canEdit()) return;
      var a = document.activeElement;
      if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
      e.preventDefault();
      e.stopPropagation();
      Array.from(groupSel).forEach(function (id) {
        try { editor.removeNodeId("node-" + id); } catch (err) { /* уже удалена */ }
      });
      clearSel();
    }, true);

    editor.on("nodeRemoved", function (id) { groupSel.delete(parseInt(id, 10)); });
  }

  // ------------------------------------------- стрелка «в никуда» и удаление связи
  var lastMouse = { x: 0, y: 0 };   // позиция мыши относительно канвы
  var pendingFrom = null;            // источник тянущейся связи {nodeId, output}
  var pickCtx = null;                // контекст открытого меню выбора ноды
  var pickShownAt = 0;
  var selConn = null;                // выделенная связь (для иконки удаления)

  function hidePopups() {
    var m = document.getElementById("jrPick");
    var b = document.getElementById("jrConnDel");
    if (m) m.style.display = "none";
    if (b) b.style.display = "none";
    pickCtx = null;
    selConn = null;
  }

  function showPickMenu(from) {
    var host = document.getElementById("jrCanvas");
    var menu = document.getElementById("jrPick");
    if (!menu) return;
    pickCtx = { from: from, x: lastMouse.x, y: lastMouse.y };
    pickShownAt = Date.now();
    menu.style.left = Math.max(4, Math.min(lastMouse.x, host.clientWidth - 200)) + "px";
    menu.style.top = Math.max(4, Math.min(lastMouse.y, host.clientHeight - 320)) + "px";
    menu.style.display = "";
  }

  // клик по пункту меню: создать ноду в точке обрыва стрелки и сразу соединить
  window.jrPickNode = function (type) {
    var ctx = pickCtx;
    hidePopups();
    if (!ctx || !canEdit() || !NODE_TYPES[type]) return;
    var x = (ctx.x - editor.canvas_x) / editor.zoom;
    var y = (ctx.y - editor.canvas_y) / editor.zoom;
    var newId = addNodeAt(type, {}, Math.max(10, x), Math.max(10, y));
    try { editor.addConnection(ctx.from.nodeId, newId, ctx.from.output, "input_1"); }
    catch (e) { /* не соединилось — нода всё равно создана */ }
  };

  window.jrConnDelete = function () {
    if (selConn) {
      try {
        editor.removeSingleConnection(selConn.output_id, selConn.input_id,
          selConn.output_class, selConn.input_class);
      } catch (e) { /* связь уже снята */ }
    }
    hidePopups();
  };

  function wireCanvasUx(host) {
    host.addEventListener("mousemove", function (e) {
      var r = host.getBoundingClientRect();
      lastMouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    // клик мимо меню — закрыть (первые 250мс игнорируем: это mouseup/click от броска стрелки)
    host.addEventListener("click", function (e) {
      if (Date.now() - pickShownAt < 250) return;
      var m = document.getElementById("jrPick");
      if (m && m.style.display !== "none" && !m.contains(e.target)) hidePopups();
    });
    editor.on("connectionStart", function (info) {
      pendingFrom = { nodeId: info.output_id, output: info.output_class };
    });
    editor.on("connectionCreated", function () { pendingFrom = null; });
    editor.on("connectionCancel", function () {
      if (pendingFrom && canEdit()) showPickMenu(pendingFrom);
      pendingFrom = null;
    });
    // клик по связи — иконка удаления рядом с курсором (двойной клик по-прежнему ставит точку излома)
    editor.on("connectionSelected", function (c) {
      if (!canEdit()) return;
      selConn = c;
      var b = document.getElementById("jrConnDel");
      if (!b) return;
      b.style.left = Math.max(4, lastMouse.x + 10) + "px";
      b.style.top = Math.max(4, lastMouse.y - 30) + "px";
      b.style.display = "";
    });
    editor.on("connectionUnselected", function () {
      var b = document.getElementById("jrConnDel");
      if (b) b.style.display = "none";
      selConn = null;
    });
    editor.on("connectionRemoved", hidePopups);
    editor.on("translate", hidePopups);
    editor.on("zoom", hidePopups);
  }

  // ---------------------------------------------------------------- загрузка схемы
  function renderJourney(j) {
    hidePopups();
    clearSel();
    editor.clear();
    currentId = j ? j.id : null;
    document.getElementById("jrName").value = j ? j.name : "";
    document.getElementById("jrKind").value = (j && j.kind === "offline") ? "offline" : "online";
    refreshContinuesOptions(j ? j.continuesJourneyId : null);
    if (!j) return;
    var jid2df = {};
    (j.nodes || []).forEach(function (n) {
      var type = NODE_TYPES[n.type] ? n.type : "comm";
      var data = {
        jid: n.id, channel: n.channel, day: n.day, template: n.templateCode,
        title: n.title, note: n.note, active: n.active
      };
      var props = n.props || {};
      Object.keys(props).forEach(function (k) { data[k] = props[k]; });
      jid2df[n.id] = addNodeAt(type, data, n.posX || 60, n.posY || 60);
    });
    (j.edges || []).forEach(function (e) {
      var a = jid2df[e.from], b = jid2df[e.to];
      if (a != null && b != null) {
        try { editor.addConnection(a, b, e.fromPort || "output_1", "input_1"); }
        catch (err) { /* битое ребро — пропускаем */ }
      }
    });
    applyReadonly();
  }

  // ---------------------------------------------------------------- выгрузка схемы
  function collectJourney() {
    var name = (document.getElementById("jrName").value || "").trim();
    var raw = editor.export().drawflow.Home.data;
    var nodes = [], edges = [];
    Object.keys(raw).forEach(function (k) {
      var n = raw[k];
      var d = n.data || {};
      var type = NODE_TYPES[n.name] ? n.name : "comm";
      var props = {};
      (NODE_TYPES[type].fields || []).forEach(function (f) {
        if (!CORE_KEYS[f.k] && d[f.k] != null && d[f.k] !== "") props[f.k] = String(d[f.k]);
      });
      nodes.push({
        id: d.jid || ("n" + k),
        type: type,
        day: parseInt(d.day, 10) || 0,
        channel: d.channel || null,
        templateCode: d.template || null,
        title: d.title || "",
        note: d.note || "",
        active: d.active !== "false",
        posX: n.pos_x, posY: n.pos_y,
        props: props
      });
    });
    Object.keys(raw).forEach(function (k) {
      var n = raw[k];
      var outs = n.outputs || {};
      Object.keys(outs).forEach(function (port) {
        (outs[port].connections || []).forEach(function (c) {
          var to = raw[c.node];
          if (to) {
            edges.push({
              from: (n.data || {}).jid || ("n" + k),
              to: (to.data || {}).jid || ("n" + c.node),
              fromPort: port
            });
          }
        });
      });
    });
    var kind = document.getElementById("jrKind").value === "offline" ? "offline" : "online";
    var cont = kind === "offline" ? (document.getElementById("jrContinues").value || null) : null;
    return { id: currentId, name: name, kind: kind, continuesJourneyId: cont, nodes: nodes, edges: edges };
  }

  // Тип цепочки: у offline показываем метку «продолжение online-цепочки»
  window.jrKindChanged = function () {
    var offline = document.getElementById("jrKind").value === "offline";
    document.getElementById("jrContinues").style.display = offline ? "" : "none";
  };

  function refreshContinuesOptions(selectedId) {
    var sel = document.getElementById("jrContinues");
    sel.innerHTML = '<option value="">— продолжение (метка) —</option>';
    listCache.filter(function (j) { return j.kind !== "offline" && j.id !== currentId; })
      .forEach(function (j) {
        var o = document.createElement("option");
        o.value = j.id; o.textContent = "→ " + j.name;
        sel.appendChild(o);
      });
    if (selectedId) sel.value = selectedId;
    window.jrKindChanged();
  }

  // ---------------------------------------------------------------- readonly для READER
  function applyReadonly() {
    if (canEdit()) return;
    editor.editor_mode = "fixed"; // канву двигать можно, редактировать нельзя
    /* Кнопки тулбокса гасим сразу: кликабельная кнопка, которая ничего не делает,
       читается как поломка, а не как «вам сюда нельзя». */
    document.querySelectorAll("#sec-journeys .jr-tb-item").forEach(function (b) {
      b.disabled = true;
      b.title = "Раздел открыт только на просмотр";
    });
  }

  // ---------------------------------------------------------------- список цепочек
  function refreshList(selectId) {
    return CRM.journeysList().then(function (list) {
      listCache = list || [];
      var sel = document.getElementById("jrSelect");
      sel.innerHTML = '<option value="">— Новая цепочка —</option>';
      listCache.forEach(function (item) {
        var o = document.createElement("option");
        o.value = item.id;
        o.textContent = (item.kind === "offline" ? "[off] " : "") + item.name + " (" + item.nodeCount + ")";
        sel.appendChild(o);
      });
      if (selectId) sel.value = selectId;
      return listCache;
    });
  }

  function loadSelected() {
    var id = document.getElementById("jrSelect").value;
    if (!id) { renderJourney(null); return; }
    CRM.journeyGet(id).then(renderJourney)
      .catch(function (e) { alert("Не удалось загрузить цепочку: " + e.message); });
  }

  // ------------------------------------------- модалка настроек блока (двойной клик)
  var editingId = null; // df-id редактируемого узла

  /* Онлайн-события из tracker.t_event_comm. Их id и есть t_event_comm_id, по которому
     лежит цепочка в commapi.events_chain. Тянем один раз: список меняется редко,
     а запрос идёт в чужую базу (crmdb). */
  var trackerEvents = null, trackerEventsP = null;
  function loadTrackerEvents() {
    if (trackerEventsP) return trackerEventsP;
    trackerEventsP = fetch("api/events/chains", {
        credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) { trackerEvents = list || []; return trackerEvents; })
      .catch(function () { trackerEvents = []; return trackerEvents; });
    return trackerEventsP;
  }

  /* Один путь на все кнопки: поднять холст, если он ещё не поднят, и сказать
     внятно, если не вышло. Раньше каждая кнопка жаловалась по-своему, а «Пример»
     вообще не пробовал повторить — и «Холст не готов» было тупиком. */
  function ensureEditor() {
    if (editor) return true;
    if (typeof window.initJourneysSection === "function") window.initJourneysSection();
    if (editor) return true;
    var host = document.getElementById("jrCanvas");
    var why = host && host.textContent && host.textContent.trim();
    alert(why
      ? "Холст не готов, конструктор не запустился. Причина: " + why
      : "Холст не готов: конструктор не запустился, и причина на холсте не написана."
        + " Похоже, initJourneysSection вообще не вызывался — откройте раздел из меню,"
        + " а не по прямой ссылке, и обновите страницу с Ctrl+F5.");
    return false;
  }

  function editControl(f, value) {
    var el;
    switch (f.kind) {
      case "textarea":
        el = document.createElement("textarea"); el.value = value; break;
      case "number":
        el = document.createElement("input"); el.type = "number"; el.value = value; break;
      case "select":
        el = document.createElement("select");
        f.opts.forEach(function (o) {
          var op = document.createElement("option"); op.value = o; op.textContent = o || "—";
          el.appendChild(op);
        });
        el.value = value; break;
      case "bool":
        el = document.createElement("select");
        [["true", "да"], ["false", "нет"]].forEach(function (p) {
          var op = document.createElement("option"); op.value = p[0]; op.textContent = p[1];
          el.appendChild(op);
        });
        el.value = value === "false" ? "false" : "true"; break;
      default:
        el = document.createElement("input"); el.type = "text"; el.value = value;
    }
    el.dataset.k = f.k;
    if (f.ro) { el.disabled = true; el.title = "Подставляется автоматически"; }
    return el;
  }

  function editFieldEl(f, data) {
    var wrap = document.createElement("div");
    wrap.className = "jre-field";
    var lbl = document.createElement("label");
    lbl.textContent = f.l;
    wrap.appendChild(lbl);
    var v = data[f.k] != null ? String(data[f.k]) : "";

    if (f.kind === "steps") {
      // кол-во SQL-шагов + textarea на каждый шаг (flow.d_event_step / scheduler.t_execution_steps)
      var steps = parseSteps(v);
      if (!steps.length) steps = [{ sql: "", active: true }];
      var cnt = document.createElement("input");
      cnt.type = "number"; cnt.min = "1"; cnt.value = String(steps.length);
      cnt.className = "jre-steps-count";
      cnt.title = "Сколько SQL-шагов выборки у события";
      wrap.appendChild(cnt);
      var box = document.createElement("div");
      box.className = "jre-steps";
      box.dataset.stepsBox = f.k;
      wrap.appendChild(box);
      var renderSteps = function (arr) {
        box.innerHTML = "";
        arr.forEach(function (st, i) {
          var l = document.createElement("label");
          l.className = "jre-step-head";
          l.textContent = "Шаг " + (i + 1) + " — SQL";
          /* активность шага → scheduler.t_execution_steps.is_active */
          var act = document.createElement("label");
          act.className = "jre-step-act";
          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = st.active !== false;
          cb.dataset.stepAct = String(i);
          act.appendChild(cb);
          act.appendChild(document.createTextNode(" активен"));
          l.appendChild(act);
          var ta = document.createElement("textarea");
          ta.value = st.sql;
          ta.dataset.step = String(i);
          box.appendChild(l);
          box.appendChild(ta);
        });
      };
      renderSteps(steps);
      cnt.addEventListener("change", function () {
        var n = Math.max(1, parseInt(cnt.value, 10) || 1);
        cnt.value = String(n);
        var cur = [];
        box.querySelectorAll("textarea[data-step]").forEach(function (ta) {
          var i = ta.dataset.step;
          var cb = box.querySelector('[data-step-act="' + i + '"]');
          cur.push({ sql: ta.value, active: !cb || cb.checked });
        });
        while (cur.length < n) cur.push({ sql: "", active: true });
        cur.length = n;
        renderSteps(cur);
      });
      return wrap;
    }

    if (f.kind === "eventPick") {
      var esel = document.createElement("select");
      esel.dataset.k = f.k;
      var fill = function (list) {
        esel.innerHTML = "";
        var o0 = document.createElement("option");
        o0.value = "";
        o0.textContent = (list && list.length) ? "— выберите событие —"
                       : (list ? "— событий не найдено —" : "— загружаем… —");
        esel.appendChild(o0);
        (list || []).forEach(function (ev) {
          var op = document.createElement("option");
          op.value = String(ev.id);
          op.textContent = (ev.eventName || ("#" + ev.id)) + (ev.system ? " · " + ev.system : "") +
            (ev.steps ? " · шагов: " + ev.steps : " · цепочки нет");
          esel.appendChild(op);
        });
        esel.value = v;
      };
      fill(trackerEvents);
      if (!trackerEvents) loadTrackerEvents().then(fill);
      /* Выбор подставляет имя и систему в соседние поля: они уезжают в прод при
         материализации, а руками их набирать нельзя — разойдутся с трекером. */
      esel.onchange = function () {
        var hit = (trackerEvents || []).filter(function (x) { return String(x.id) === esel.value; })[0];
        /* jrEditBody — настройки узла; jrModalBody рядом, но это предпросмотр
           материализации, и промах между ними ничего бы не подставил. */
        var body = document.getElementById("jrEditBody");
        if (!body) return;
        var n = body.querySelector('[data-k="event_name"]');
        var s = body.querySelector('[data-k="system"]');
        if (n) n.value = hit ? (hit.eventName || "") : "";
        if (s) s.value = hit ? (hit.system || "") : "";
      };
      wrap.appendChild(esel);
      var hint = document.createElement("div");
      hint.style.cssText = "color:var(--faint);font-size:11.5px;margin-top:4px";
      hint.textContent = "Из tracker.t_event_comm. Его id и есть t_event_comm_id, по которому лежит цепочка.";
      wrap.appendChild(hint);
      return wrap;
    }

    var el = editControl(f, v);
    if (f.kind === "template") {
      var row = document.createElement("div");
      row.className = "jrn-row";
      row.appendChild(el);
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "jrn-mini"; btn.textContent = "⚙";
      btn.title = "Открыть настройки шаблона";
      btn.onclick = window.jrOpenTemplate;
      row.appendChild(btn);
      wrap.appendChild(row);
    } else if (f.kind === "subflow") {
      var sel = document.createElement("select");
      sel.dataset.k = f.k;
      var op0 = document.createElement("option");
      op0.value = ""; op0.textContent = "— цепочка —";
      sel.appendChild(op0);
      listCache.forEach(function (j) {
        var op = document.createElement("option");
        op.value = j.id; op.textContent = j.name;
        sel.appendChild(op);
      });
      sel.value = v;
      var row2 = document.createElement("div");
      row2.className = "jrn-row";
      row2.appendChild(sel);
      var btn2 = document.createElement("button");
      btn2.type = "button"; btn2.className = "jrn-mini"; btn2.textContent = "↗";
      btn2.title = "Открыть цепочку";
      btn2.onclick = window.jrOpenSubflow;
      row2.appendChild(btn2);
      wrap.appendChild(row2);
    } else {
      wrap.appendChild(el);
    }
    return wrap;
  }

  function openNodeEditor(dfId) {
    var n = editor.getNodeFromId(dfId);
    if (!n || !NODE_TYPES[n.name]) return;
    editingId = dfId;
    var t = NODE_TYPES[n.name];
    document.getElementById("jrEditTitle").textContent = "Настройки: " + t.label;
    var body = document.getElementById("jrEditBody");
    body.innerHTML = "";
    t.fields.forEach(function (f) { body.appendChild(editFieldEl(f, n.data || {})); });
    if (n.name === "comm") wireCommAutofill(body);
    var editable = canEdit();
    document.getElementById("jrEditApplyBtn").style.display = editable ? "" : "none";
    if (!editable) {
      body.querySelectorAll("input,textarea,select").forEach(function (i) { i.disabled = true; });
    }
    document.getElementById("jrEdit").style.display = "";
  }

  /* Communication Alert: при вводе кода шаблона день подставляется из справочника
     (sending_day); если шаблона нет — предупреждение, сохранить цепочку нельзя. */
  function wireCommAutofill(body) {
    var chEl = body.querySelector('[data-k="channel"]');
    var tplEl = body.querySelector('[data-k="template"]');
    var dayEl = body.querySelector('[data-k="day"]');
    if (!chEl || !tplEl || !dayEl) return;
    var warn = document.createElement("div");
    warn.className = "jre-warn";
    warn.style.display = "none";
    warn.textContent = "⚠ Такого шаблона нет. Заведи его в «Мастере коммуникаций» — без шаблона цепочку не сохранить.";
    tplEl.closest(".jre-field").appendChild(warn);
    var run = function () {
      var ch = chEl.value, code = (tplEl.value || "").trim();
      if (!ch || !code) { warn.style.display = "none"; return; }
      checkTemplate(ch, code).then(function (dto) {
        if (tplEl.value.trim() !== code || chEl.value !== ch) return; // ввод уже поменялся
        if (dto) {
          warn.style.display = "none";
          dayEl.value = (dto.sendingDay != null && dto.sendingDay !== "") ? String(dto.sendingDay) : "0";
        } else {
          warn.style.display = "";
          dayEl.value = "0";
        }
      });
    };
    chEl.addEventListener("change", run);
    tplEl.addEventListener("change", run);
    tplEl.addEventListener("input", run);
    run(); // проверить сразу при открытии
  }

  window.jrEditClose = function () {
    editingId = null;
    document.getElementById("jrEdit").style.display = "none";
  };

  window.jrEditApply = function () {
    if (editingId == null || !canEdit()) return;
    var n = editor.getNodeFromId(editingId);
    if (!n || !NODE_TYPES[n.name]) { window.jrEditClose(); return; }
    var body = document.getElementById("jrEditBody");
    var data = {};
    Object.keys(n.data || {}).forEach(function (k) { data[k] = n.data[k]; });
    NODE_TYPES[n.name].fields.forEach(function (f) {
      if (f.kind === "steps") {
        var arr = [];
        var stepsBox = body.querySelector('[data-steps-box="' + f.k + '"]');
        body.querySelectorAll('[data-steps-box="' + f.k + '"] textarea[data-step]')
          .forEach(function (ta) {
            if (!ta.value.trim()) return;
            var cb = stepsBox ? stepsBox.querySelector('[data-step-act="' + ta.dataset.step + '"]') : null;
            arr.push({ sql: ta.value, active: !cb || cb.checked });
          });
        data[f.k] = JSON.stringify(arr);
      } else {
        var el = body.querySelector('[data-k="' + f.k + '"]');
        if (el) data[f.k] = el.value;
      }
    });
    editor.updateNodeDataFromId(editingId, data);
    updateNodeCard(editingId);
    window.jrEditClose();
  };

  // ---------------------------------------------------------------- кнопки в модалке настроек
  // ⚙ у Communication Alert: открыть «Просмотр настроек» шаблона по каналу+коду из модалки.
  window.jrOpenTemplate = function (ev) {
    ev.stopPropagation();
    var body = document.getElementById("jrEditBody");
    var chSel = body.querySelector('[data-k="channel"]');
    var channel = chSel ? chSel.value : null;
    var inp = body.querySelector('[data-k="template"]');
    var code = inp ? (inp.value || "").trim() : "";
    if (!channel || !code) { alert("В блоке не указан канал или код шаблона."); return; }

    // Проверяем наличие шаблона запросом к бэку (список в браузере теперь постраничный, всего не держим).
    var id = channel + ":" + code;
    CRM.getTemplate(channel, code)
      .then(function () {
        window.jrEditClose();
        if (typeof openSection === "function") openSection("admin");
        if (typeof viewFromList === "function") viewFromList(id); // сам переключит вкладку «Просмотр настроек»
      })
      .catch(function () {
        alert("Шаблон " + channel.toUpperCase() + " с кодом " + code + " не найден. Заведи его в «Мастере коммуникаций».");
      });
  };

  // ↗ у Subflow: открыть выбранную вложенную цепочку в этом же редакторе.
  window.jrOpenSubflow = function (ev) {
    ev.stopPropagation();
    var body = document.getElementById("jrEditBody");
    var sel = body.querySelector('[data-k="journey"]');
    var id = sel ? sel.value : "";
    if (!id) { alert("В блоке не выбрана цепочка."); return; }
    if (id === currentId) { alert("Эта цепочка уже открыта."); return; }
    window.jrEditClose();
    document.getElementById("jrSelect").value = id;
    loadSelected();
  };

  // ------------------------------------------- предпросмотр и материализация
  var previewRows = null; // строки из /api/flow/preview (редактируются в модалке)

  window.jrPreview = function () {
    if (!editor) return;
    var j = collectJourney();
    if (!j.name) { alert("Укажи название цепочки."); return; }
    if (!j.nodes.length) { alert("Схема пуста."); return; }
    missingTemplates(j).then(function (probs) {
      if (probs.length) { alert("Нельзя материализовать:\n— " + probs.join("\n— ")); return; }
      doPreview(j);
    });
  };

  function doPreview(j) {
    CRM.flowPreview(j).then(function (res) {
      if (res.problems && res.problems.length) {
        alert("Нельзя материализовать:\n— " + res.problems.join("\n— "));
        return;
      }
      previewRows = res.rows || [];
      renderModal(previewRows);
      document.getElementById("jrModal").style.display = "";
    }).catch(function (e) { alert("Ошибка предпросмотра: " + e.message); });
  }

  function renderModal(rows) {
    var body = document.getElementById("jrModalBody");
    body.innerHTML = "";
    rows.forEach(function (r, idx) {
      var sec = document.createElement("div");
      var title = document.createElement("div");
      title.className = "jrm-table-title";
      title.textContent = "→ " + r.table;
      sec.appendChild(title);
      var grid = document.createElement("div");
      grid.className = "jrm-grid";
      Object.keys(r.values).forEach(function (col) {
        var v = r.values[col];
        var lbl = document.createElement("label");
        lbl.textContent = col;
        var inp = document.createElement("input");
        inp.value = v == null ? "" : String(v);
        inp.dataset.row = idx;
        inp.dataset.col = col;
        if (v === "(auto)") { inp.disabled = true; inp.title = "id подставится автоматически"; }
        grid.appendChild(lbl);
        grid.appendChild(inp);
      });
      sec.appendChild(grid);
      body.appendChild(sec);
    });
  }

  window.jrModalClose = function () {
    document.getElementById("jrModal").style.display = "none";
  };

  /* Правка в модалке возвращается строкой — восстанавливаем тип по исходному значению. */
  function coerce(orig, str) {
    if (str === "") return null;
    if (typeof orig === "boolean" || str === "true" || str === "false") return str === "true";
    if (typeof orig === "number" && /^-?\d+(\.\d+)?$/.test(str)) return Number(str);
    if (orig == null && /^-?\d+$/.test(str)) return parseInt(str, 10);
    return str;
  }

  window.jrMaterialize = function () {
    if (!canEdit() || !previewRows) return;
    document.querySelectorAll("#jrModalBody input").forEach(function (inp) {
      if (inp.disabled) return;
      var r = previewRows[parseInt(inp.dataset.row, 10)];
      if (r) r.values[inp.dataset.col] = coerce(r.values[inp.dataset.col], inp.value);
    });
    var j = collectJourney();
    CRM.flowMaterialize(j, previewRows).then(function (res) {
      currentId = res.journeyId;
      window.jrModalClose();
      var lines = (res.created || []).map(function (c) { return c.table + "  #" + c.id; });
      alert("Материализовано. Записано строк: " + lines.length + "\n" + lines.join("\n"));
      previewRows = null;
      return refreshList(currentId);
    }).catch(function (e) { alert("Ошибка сохранения: " + e.message); });
  };

  // ---------------------------------------------------------------- действия тулбокса/тулбара
  /* Раньше кнопка молча ничего не делала при трёх разных причинах — и понять, что
     именно не так, было нельзя ни по экрану, ни по консоли. Молчание в ответ на
     нажатие хуже любой ошибки: человек жмёт ещё раз и решает, что сломан весь раздел. */
  window.jrAddNode = function (type) {
    if (!NODE_TYPES[type]) { alert("Неизвестный тип узла: " + type); return; }
    if (!ensureEditor()) return;
    if (!canEdit()) {
      alert("Раздел открыт только на просмотр: нет права на правку.");
      return;
    }
    /* Стартовое событие и условие выхода — по одному на цепочку. Второй такой блок
       не «ещё одно условие», а вторая правда о том же: в таблице под них по одной
       колонке, и при заведении пришлось бы выбирать между ними молча. Поэтому не
       добавляем второй, а открываем тот, что уже стоит. */
    if (type === "flowExit" || type === "startIncome") {
      var ex = findNodeByType(type);
      if (ex != null) {
        alert(type === "flowExit"
          ? "Условие выхода одно на всю цепочку и уже задано — открываю его."
          : "Стартовое событие в цепочке одно и уже выбрано — открываю его.");
        openNodeEditor(ex);
        return;
      }
    }
    var host = document.getElementById("jrCanvas");
    var x = (host.clientWidth / 2 - editor.canvas_x) / editor.zoom - 115 + (Math.random() * 60 - 30);
    var y = (host.clientHeight / 2 - editor.canvas_y) / editor.zoom - 90 + (Math.random() * 60 - 30);
    addNodeAt(type, {}, Math.max(10, x), Math.max(10, y));
  };

  /* Заведение цепочки в commapi.events_chain — строка на шаг.
     Отдельная кнопка, а не часть «Сохранить»: то пишет нашу схему (app.journeys),
     это боевую таблицу в crmdb, и смешивать их в одном действии нельзя.

     Проверки отдельными строками не становятся: exit_condition и exit_step —
     колонки той же строки, что и шаблон. Один шаг = одна строка. */
  window.jrChainCreate = function () {
    if (!ensureEditor()) return;
    if (!canEdit()) { alert("Раздел открыт только на просмотр."); return; }
    var raw = editor.export().drawflow.Home.data;
    var startKey = null;
    Object.keys(raw).forEach(function (k) { if (raw[k].name === "startIncome") startKey = k; });
    if (!startKey) { alert("В цепочке нет узла Income event."); return; }
    var start = raw[startKey].data || {};
    if (!start.t_event_comm_id) {
      alert("У Income event не выбрано событие: оно берётся из tracker.t_event_comm.");
      return;
    }

    /* Идём ПО СТРЕЛКАМ от старта, а не по порядку создания узлов. Таймер и Step exit —
       накопители: они задают колонки того шага, который идёт за ними. По порядку
       создания накопитель лёг бы не на тот шаг, стоило человеку переставить блок. */
    var seq = [], seen = {}, cur = startKey;
    while (cur && !seen[cur]) {
      seen[cur] = true;
      seq.push(cur);
      var outs = (raw[cur].outputs || {}).output_1;
      var link = outs && outs.connections && outs.connections[0];
      cur = link ? String(link.node) : null;
    }

    var steps = [], exitCondition = "", pendingWait = "", pendingExit = "", ignored = {};
    seq.forEach(function (k) {
      var n = raw[k], d = n.data || {};
      switch (n.name) {
        case "startIncome": break;
        case "timer":    pendingWait = d.wait_time || "0"; break;
        case "stepExit": pendingExit = d.event_name || ""; break;
        case "flowExit":
          /* Условие выхода одно на цепочку. Второй Flow exit — почти наверняка
             ошибка, и молча взять последний хуже, чем сказать. */
          if (exitCondition && d.event_name && d.event_name !== exitCondition) {
            alert("Flow exit встречается дважды с разными событиями: «" + exitCondition +
                  "» и «" + d.event_name + "». Условие выхода одно на всю цепочку.");
            exitCondition = null;
            return;
          }
          exitCondition = d.event_name || exitCondition;
          break;
        case "comm":
          steps.push({
            waitTime: pendingWait || "0",
            templateId: d.template || "",
            exitStep: pendingExit || "",
            active: d.active !== "false"
          });
          pendingWait = ""; pendingExit = "";
          break;
        default:
          if (n.name !== "startTime") ignored[NODE_TYPES[n.name] ? NODE_TYPES[n.name].label : n.name] = true;
      }
    });
    if (exitCondition === null) return;   // разные Flow exit — уже сказали, дальше не идём
    if (!steps.length) { alert("В цепочке нет ни одного Communication Alert."); return; }

    /* Блоки, которые движок пока не исполняет, в таблицу не уедут. Молча их проглотить
       значило бы отдать в бой не то, что нарисовано. */
    var lost = Object.keys(ignored);
    if (lost.length && !confirm("Эти блоки пока не исполняются и в таблицу не уедут: " +
        lost.join(", ") + ".\nЗавести цепочку без них?")) return;
    if (pendingWait || pendingExit) {
      alert("После последнего Communication Alert стоят Таймер или Step exit — им нечего задавать."
            + " Поставьте их перед шагом.");
      return;
    }
    var noTpl = steps.filter(function (s) { return !s.templateId; }).length;
    if (noTpl && !confirm("Шагов без шаблона: " + noTpl + ". Такой шаг ничего не отправит. Всё равно завести?")) return;

    fetch("api/events/chains", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        eventId: start.t_event_comm_id,
        exitCondition: exitCondition || "",
        steps: steps
      })
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) {}
        if (!r.ok) throw new Error((j && j.message) || t || ("HTTP " + r.status));
        return j;
      });
    }).then(function (res) {
      alert("Цепочка заведена: событие «" + (res.eventName || res.id) + "», шагов " + res.steps + ".");
    }).catch(function (e) {
      alert("Не удалось завести цепочку:\n" + e.message);
    });
  };

  /* ---------------------------------------------- раскладка цепочки на холсте
     Дорожка на шаг: слева то, что шаг задаёт (таймер, снятие шага), справа сама
     коммуникация. Следующий шаг начинается ниже и правее предыдущего, а не с левого
     края: стрелка между шагами уходит по диагонали вниз, и порядок читается сверху
     вниз, не заставляя каждый раз возвращаться глазами к началу строки.

     Условие выхода стоит одним блоком сразу за событием, хотя в таблице лежит у
     каждой строки: оно обрывает весь поток, а не отдельный шаг, и рисовать его у
     каждого шага значило бы показывать три разных условия там, где оно одно.

     Рамок вокруг шагов нет. Шаг и так читается дорожкой, а рамка добавляла второй
     уровень карточек ровно с той же границей — обводить очевидное значит мешать.
     Сам блок «Группа» из тулбокса никуда не делся: если человек захочет обвести
     что-то своё, он это сделает руками. */
  var LAY = { x0: 60, y0: 100, pitch: 300, row: 230, node: 230, indent: 190, maxX: 2400 };

  function chainToJourney(ch, name, opts) {
    opts = opts || {};
    var steps = (ch.steps || []).slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });
    var exit = ch.exitCondition || "";
    var nodes = [], edges = [], prev = null, seq = 0;

    function block(type, x, y, props, extra) {
      var id = "c" + (++seq);
      nodes.push(Object.assign({ id: id, type: type, posX: x, posY: y, props: props || {} }, extra || {}));
      if (prev) edges.push({ from: prev, to: id });
      prev = id;
    }
    var x = LAY.x0, y = LAY.y0;
    block("startIncome", x, y, {
      /* id события подставляем только когда цепочку открыли из этого же контура.
         В примере он остаётся пустым: чужой id предложил бы завести цепочку не тому. */
      t_event_comm_id: opts.bindEvent && ch.id != null ? String(ch.id) : "",
      event_name: ch.eventName || "",
      system: ch.system || ""
    });
    x += LAY.pitch;
    if (exit) {
      block("flowExit", x, y, { event_name: exit });
      x += LAY.pitch;
    }

    steps.forEach(function (s, i) {
      var blocks = [];
      var w = Number(s.waitTime);
      if (isFinite(w) && w > 0) blocks.push({ t: "timer", props: { wait_time: String(w) } });
      if (s.exitStep) blocks.push({ t: "stepExit", props: { event_name: s.exitStep } });
      blocks.push({ t: "comm", props: {}, extra: {
        channel: "sms",   // канала в commapi.events_chain пока нет — колонку обещали позже
        templateCode: s.templateId == null ? "" : String(s.templateId),
        active: s.active !== false,
        /* Номер шага — на самой коммуникации: рамок вокруг шагов больше нет, а
           понимать, какая это по счёту строка в таблице, всё равно надо. */
        note: "Шаг " + (s.order || (i + 1)) + " · " + waitWords(s.waitTime)
              + (s.active === false ? " · выключен" : "")
      } });
      // дорожка не влезла по ширине — начинаем её с левого края
      if (x + blocks.length * LAY.pitch > LAY.maxX) x = LAY.x0;
      blocks.forEach(function (b) {
        block(b.t, x, y, b.props, b.extra);
        x += LAY.pitch;
      });
      if (i < steps.length - 1) {
        y += LAY.row;
        x = x - LAY.pitch + LAY.indent;   // ниже и правее последней коммуникации
      }
    });

    return { id: null, name: name, kind: "online", nodes: nodes, edges: edges };
  }

  /* Уместить всё на экран. Раскладка уходит вправо по диагонали, и у цепочки из
     трёх шагов правый край уже за пределами холста: без этой кнопки человек ищет
     свои же блоки колесом мыши. */
  window.jrFit = function () {
    if (!editor || !editor.precanvas) return;
    var els = document.querySelectorAll("#jrCanvas .drawflow-node");
    if (!els.length) return;
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    els.forEach(function (el) {
      x1 = Math.min(x1, el.offsetLeft);
      y1 = Math.min(y1, el.offsetTop);
      x2 = Math.max(x2, el.offsetLeft + el.offsetWidth);
      y2 = Math.max(y2, el.offsetTop + el.offsetHeight);
    });
    var host = document.getElementById("jrCanvas");
    var pad = 30;
    var z = Math.min((host.clientWidth - pad * 2) / Math.max(1, x2 - x1),
                     (host.clientHeight - pad * 2) / Math.max(1, y2 - y1), 1);
    z = Math.max(0.25, z);
    editor.zoom = z;
    editor.zoom_last_value = z;
    editor.canvas_x = pad - x1 * z;
    editor.canvas_y = pad - y1 * z;
    editor.precanvas.style.transform =
      "translate(" + editor.canvas_x + "px, " + editor.canvas_y + "px) scale(" + z + ")";
  };

  /* Открыть на холсте цепочку, которая реально лежит в commapi.events_chain.
     Только чтение: правку существующих не делаем — по этим строкам движок прямо
     сейчас ведёт живых людей. Поэтому и currentId сбрасываем: «Сохранить» после
     этого создаст НАШУ схему, а боевой таблицы не тронет. */
  window.jrChainOpen = function () {
    if (!ensureEditor()) return;
    var sel = document.getElementById("jrChainPick");
    var id = sel && sel.value;
    if (!id) { alert("Выберите событие: цепочка открывается по событию из tracker.t_event_comm."); return; }
    fetch("api/events/chains/" + encodeURIComponent(id), {
        credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (ch) {
        if (ch.available === false) {
          alert("База событий недоступна" + (ch.error ? ": " + ch.error : "."));
          return;
        }
        if (!(ch.steps || []).length) {
          alert("У события «" + (ch.eventName || id) + "» цепочка не заведена: в "
                + "commapi.events_chain нет ни одной строки.");
          return;
        }
        renderJourney(chainToJourney(ch, "Цепочка: " + (ch.eventName || id), { bindEvent: true }));
        currentId = null;
        document.getElementById("jrSelect").value = "";
        window.jrFit();
      })
      .catch(function (e) { alert("Не удалось прочитать цепочку:\n" + e.message); });
  };

  /* Пример — реальная цепочка оплаты ОСАГО: сразу ссылка на оплату, через 15 минут
     напоминание, через 45 минут ещё одно. Всю цепочку обрывает оплата полиса (любым
     из десяти событий), второй шаг снимается отдельно — звонком телеконтакта.

     Кладём на холст как черновик и ничего не сохраняем: пример нужен, чтобы понять,
     как складываются блоки. Событие намеренно НЕ привязано — его выбирают из
     tracker.t_event_comm того контура, где открыли панель. */
  window.jrExample = function () {
    if (!ensureEditor()) return;
    if (!canEdit()) { alert("Раздел открыт только на просмотр."); return; }
    /* В таблице это цепочка из десяти OR по event_name. Здесь тот же смысл через IN:
       на схеме важно, КАКИЕ события обрывают поток, а не как они перечислены. */
    function paidSql(list) {
      return '{"SELECT 1 FROM tracker.t_event t3 WHERE t3.event_name IN ('
        + list.map(function (n) { return "'" + n + "'"; }).join(", ")
        + ') AND t3.user_id = :userId AND t3.timestamp_cr >= current_date"}';
    }
    var PAID = ["SendPaymentLinkOsagoTelecontact", "gpnPolicyPaidEvent", "ladderPolicyPaidEvent",
                "policyPaidEvent", "policyPaidGPNEvent", "policyPaidNSPKEvent",
                "policyPaidOzon2500Event", "policyPaidOzonNewEvent", "policyPaidRosneftEvent",
                "rosneftPolicyPaidEvent"];
    renderJourney(chainToJourney({
      id: 3264, eventName: "SendPaymentLinkOsago_1", system: "insurance",
      exitCondition: paidSql(PAID),
      steps: [
        { order: 1, active: true, waitTime: 0,  templateId: 438, exitStep: null },
        { order: 2, active: true, waitTime: 15, templateId: 440,
          exitStep: paidSql(["SendPaymentLinkOsagoTelecontact"]) },
        { order: 3, active: true, waitTime: 45, templateId: 487, exitStep: null }
      ]
    }, "Пример: оплата ОСАГО (событие 3264)", { bindEvent: false }));
    /* currentId сбрасываем: «Сохранить» должен создать новую цепочку, а не перезаписать
       ту, что была открыта до нажатия «Пример». */
    currentId = null;
    document.getElementById("jrSelect").value = "";
    window.jrFit();
  };

  /* ---------------------------------------------- модалка заведения новой цепочки
     Цепочку нельзя начать с пустого холста: у неё есть то, что задаётся один раз и
     на весь поток — стартовое событие, название, система и отменяющее событие. Пока
     они не заданы, добавлять шаги некуда: шаг существует только внутри цепочки.
     Поэтому спрашиваем их сразу, как Salesforce спрашивает тип потока, а не оставляем
     человека наедине с холстом, на котором он всё равно первым делом поставит старт.

     Отменяющее событие пишется SQL-скриптом: в commapi.events_chain лежит именно
     запрос, и подставлять вместо него имя события значило бы обещать разбор, которого
     нет. Появится справочник — заменим поле, запрос останется тем же. */
  var newPick = null;   // выбранное в модалке событие из tracker.t_event_comm

  window.jrNew = function () {
    if (!ensureEditor()) return;
    if (!canEdit()) { alert("Раздел открыт только на просмотр."); return; }
    newPick = null;
    ["jrNewName", "jrNewSystem", "jrNewExit", "jrNewFilter"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = "";
    });
    document.getElementById("jrNewChain").style.display = "";
    renderNewList("");
    loadTrackerEvents().then(function () { renderNewList(document.getElementById("jrNewFilter").value); });
    var f = document.getElementById("jrNewFilter");
    if (f) f.focus();
  };

  window.jrNewClose = function () {
    document.getElementById("jrNewChain").style.display = "none";
  };

  /* Пустой холст — для оффлайн-цепочки: она начинается с Time event, и ни стартового
     события, ни условия выхода у неё нет. Модалка спрашивает ровно то, чего у оффлайна
     не бывает, — значит, для него нужен выход мимо неё. */
  window.jrNewBlank = function () {
    window.jrNewClose();
    document.getElementById("jrSelect").value = "";
    renderJourney(null);
  };

  window.jrNewFilterChanged = function () {
    renderNewList(document.getElementById("jrNewFilter").value);
  };

  /* Список событий карточками, а не выпадающим списком: у события есть что показать
     кроме имени — система и заведена ли уже цепочка, — и в одну строку <option> это
     не помещается. Фильтр обязателен: событий в трекере сотни. */
  function renderNewList(filter) {
    var box = document.getElementById("jrNewList");
    if (!box) return;
    if (trackerEvents == null) { box.innerHTML = '<div class="jr-hint">Загружаю события…</div>'; return; }
    var q = String(filter || "").trim().toLowerCase();
    var list = trackerEvents.filter(function (e) {
      if (!q) return true;
      return String(e.eventName || "").toLowerCase().indexOf(q) >= 0 ||
             String(e.system || "").toLowerCase().indexOf(q) >= 0 ||
             String(e.id) === q;
    });
    if (!list.length) {
      box.innerHTML = '<div class="jr-hint">' + (trackerEvents.length
        ? "Ничего не нашлось. Событие берётся из tracker.t_event_comm — если его там нет, сначала заведите событие."
        : "Событий не видно: база событий (crmdb) не подключена на этом контуре.") + "</div>";
      return;
    }
    box.innerHTML = list.slice(0, 200).map(function (e) {
      var tail = e.steps
        ? "цепочка уже заведена · шагов: " + e.steps
        : "цепочки нет";
      return '<button type="button" class="jr-card' + (newPick && newPick.id === e.id ? " sel" : "") +
        '" onclick="jrNewSelect(' + e.id + ')">' +
        '<div class="jr-card-t">' + esc(e.eventName || ("#" + e.id)) + "</div>" +
        '<div class="jr-card-d">' + esc([e.system, "id " + e.id, tail].filter(Boolean).join(" · ")) + "</div>" +
        "</button>";
    }).join("") + (list.length > 200
      ? '<div class="jr-hint">Показаны первые 200 из ' + list.length + " — уточните поиск.</div>" : "");
  }

  window.jrNewSelect = function (id) {
    newPick = (trackerEvents || []).filter(function (e) { return e.id === id; })[0] || null;
    if (!newPick) return;
    /* Название и систему подставляем из события, но не запираем: имя цепочки — наше,
       для списка в панели, и совпадать с именем события оно не обязано. */
    var name = document.getElementById("jrNewName");
    var sys = document.getElementById("jrNewSystem");
    if (name && !name.value.trim()) name.value = newPick.eventName || "";
    if (sys) sys.value = newPick.system || "";
    renderNewList(document.getElementById("jrNewFilter").value);
  };

  window.jrNewCreate = function () {
    if (!newPick) { alert("Выберите стартовое событие: цепочка начинается с него."); return; }
    var name = (document.getElementById("jrNewName").value || "").trim() || (newPick.eventName || "");
    var system = (document.getElementById("jrNewSystem").value || "").trim();
    var exit = (document.getElementById("jrNewExit").value || "").trim();
    if (newPick.steps && !confirm("У события «" + (newPick.eventName || newPick.id) +
        "» уже заведена цепочка (шагов " + newPick.steps + ").\nЗавести поверх неё не выйдет:" +
        " правку существующих не делаем, по этим строкам движок ведёт людей прямо сейчас.\n" +
        "Открыть холст всё равно — как черновик?")) return;

    var nodes = [{
      id: "s1", type: "startIncome", posX: LAY.x0, posY: LAY.y0,
      props: { t_event_comm_id: String(newPick.id), event_name: newPick.eventName || "", system: system }
    }];
    var edges = [];
    if (exit) {
      nodes.push({ id: "s2", type: "flowExit", posX: LAY.x0 + LAY.pitch, posY: LAY.y0,
                   props: { event_name: exit } });
      edges.push({ from: "s1", to: "s2" });
    }
    renderJourney({ id: null, name: name, kind: "online", nodes: nodes, edges: edges });
    currentId = null;
    document.getElementById("jrSelect").value = "";
    window.jrNewClose();
  };

  window.jrSave = function () {
    if (!editor || !canEdit()) return;
    var j = collectJourney();
    if (!j.name) { alert("Укажи название цепочки."); return; }
    if (!j.nodes.length) { alert("Добавь хотя бы один узел."); return; }
    missingTemplates(j).then(function (probs) {
      if (probs.length) {
        alert("Нельзя сохранить цепочку:\n— " + probs.join("\n— "));
        return;
      }
      var p = currentId ? CRM.journeyUpdate(currentId, j) : CRM.journeyCreate(j);
      p.then(function (saved) {
        currentId = saved.id;
        return refreshList(saved.id);
      }).then(function () {
        alert("Цепочка сохранена.");
      }).catch(function (e) { alert("Ошибка сохранения: " + e.message); });
    });
  };

  window.jrDelete = function () {
    if (!editor || !canEdit() || !currentId) return;
    if (!confirm("Удалить цепочку целиком?")) return;
    CRM.journeyDelete(currentId).then(function () {
      currentId = null;
      renderJourney(null);
      return refreshList(null);
    }).catch(function (e) { alert("Ошибка удаления: " + e.message); });
  };

  // ---------------------------------------------------------------- инициализация раздела
  window.initJourneysSection = function () {
    if (inited) return;
    if (typeof Drawflow === "undefined") {
      document.getElementById("jrCanvas").innerHTML =
        '<div style="padding:30px;color:#FF6B8A">Drawflow не загрузился.</div>';
      return;
    }
    var host = document.getElementById("jrCanvas");
    if (!host) return;   // разметки раздела нет — пробовать будем при следующем открытии
    /* Флаг «инициализировано» ставится ТОЛЬКО после успешного запуска. Раньше он
       взводился раньше времени: любое падение конструктора оставляло editor пустым,
       а все следующие заходы выходили по этому флагу сразу — раздел умирал до
       перезагрузки страницы и молчал о причине. */
    try {
      editor = new Drawflow(host);
      editor.reroute = true;
      editor.start();
    } catch (e) {
      editor = null;
      host.innerHTML = '<div style="padding:30px;color:#FF6B8A">Конструктор не запустился: ' +
        esc(e && e.message ? e.message : e) + "</div>";
      return;
    }
    inited = true;
    // двойной клик по блоку — модалка настроек
    host.addEventListener("dblclick", function (e) {
      var el = e.target.closest(".drawflow-node");
      if (!el || !el.id || el.id.indexOf("node-") !== 0) return;
      openNodeEditor(parseInt(el.id.slice(5), 10));
    });
    wireCanvasUx(host);
    wireMultiSelect(host);
    /* Список событий для «Открыть цепочку»: те же, что в блоке Income event. Сколько
       шагов заведено, пишем прямо в строке — иначе выбор превращается в перебор. */
    loadTrackerEvents().then(function (list) {
      var pick = document.getElementById("jrChainPick");
      if (!pick) return;
      var withChain = (list || []).filter(function (e) { return e.steps > 0; });
      if (!withChain.length) {
        pick.innerHTML = '<option value="">— заведённых цепочек нет —</option>';
        pick.disabled = true;
        return;
      }
      pick.innerHTML = '<option value="">— цепочка события —</option>' +
        withChain.map(function (e) {
          return '<option value="' + esc(e.id) + '">' + esc(e.eventName || ("#" + e.id)) +
            " · шагов: " + e.steps + "</option>";
        }).join("");
    });
    var ready = (window.CRM && CRM.meReady) ? CRM.meReady : Promise.resolve();
    ready.then(function () {
      applyReadonly();
      return refreshList(null);
    }).then(function (list) {
      if (list && list.length) {
        document.getElementById("jrSelect").value = list[0].id;
        loadSelected();
      }
    });
    document.getElementById("jrSelect").addEventListener("change", loadSelected);
  };
})();
