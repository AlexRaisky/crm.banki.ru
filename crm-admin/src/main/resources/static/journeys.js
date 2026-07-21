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
  var DEFINITION_KEYS = ["", "smsChannelProcessV2", "pushChannelProcessV2", "smsChannelProccessV2",
                         "emailChannelProcessV2", "vkChannelProcessV2", "waChannelProcessV2"];
  var BUSINESS_KEY_PREFIXES = ["", "WaChannel", "VkChannel", "PushChannel", "webPushChannel",
                               "pushChannel", "emailChannel", "smsChannel"];
  var DATABASES = ["crmdb", "greenplum"];
  var NODE_TYPES = {
    startIncome: {
      label: "Income event", cls: "start", ins: 0, outs: 1,
      fields: [
        { k: "event_name",          l: "Имя события",        kind: "text" },
        { k: "system",              l: "Система",            kind: "text" },
        { k: "notify_channel",      l: "Канал (notify)",     kind: "select", opts: NOTIFY_CHANNELS },
        { k: "sub_channel",         l: "Sub channel",        kind: "text" },
        { k: "platform",            l: "Платформа",          kind: "text" },
        { k: "group_event_descr",   l: "Группа событий",     kind: "text" },
        { k: "send_delay",          l: "Задержка (send_delay)", kind: "number" },
        { k: "life_time",           l: "Life time",          kind: "number" },
        { k: "allow_ml",            l: "Allow ML",           kind: "bool", def: "false" },
        { k: "definition_key",      l: "Definition key",     kind: "select", opts: DEFINITION_KEYS },
        { k: "business_key_prefix", l: "Business key prefix", kind: "select", opts: BUSINESS_KEY_PREFIXES }
      ]
    },
    startTime: {
      label: "Time event", cls: "start", ins: 0, outs: 1,
      fields: [
        { k: "event_name",          l: "Имя события",        kind: "text" },
        { k: "system",              l: "Система",            kind: "text" },
        { k: "notify_channel",      l: "Канал (notify)",     kind: "select", opts: NOTIFY_CHANNELS },
        { k: "crontab",             l: "Crontab (текстом, напр. 0 9 * * *)", kind: "text" },
        { k: "database",            l: "База выборки",       kind: "select", opts: DATABASES, def: "crmdb" },
        { k: "process_name",        l: "Имя процесса (selection)", kind: "text" },
        { k: "sql_steps",           l: "SQL-шаги выборки",   kind: "steps" },
        { k: "definition_key",      l: "Definition key",     kind: "select", opts: DEFINITION_KEYS },
        { k: "business_key_prefix", l: "Business key prefix", kind: "select", opts: BUSINESS_KEY_PREFIXES }
      ]
    },
    comm: {
      label: "Communication Alert", cls: "comm", outs: 1,
      fields: [
        { k: "channel",  l: "Тип коммуникации", kind: "select", opts: ["sms", "push", "email", "cc"] },
        { k: "template", l: "Код шаблона",      kind: "template" },
        { k: "day",      l: "День (из шаблона)", kind: "number", ro: true },
        { k: "note",     l: "Что происходит",   kind: "textarea" },
        { k: "active",   l: "Активен",          kind: "bool" }
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
  function parseSteps(v) {
    try {
      var a = JSON.parse(v || "[]");
      return Array.isArray(a) ? a.map(function (s) { return String(s == null ? "" : s); }) : [];
    } catch (e) { return []; }
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
        var n = parseSteps(d.sql_steps).filter(function (s) { return s.trim(); }).length;
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
        return [top, warn].filter(Boolean).join("\n");
      }
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

  function nodeHtml(type, d) {
    var t = NODE_TYPES[type];
    var chCls = (type === "comm" && d && d.channel) ? " jrn-ch-" + d.channel : "";
    var html = '<div class="jrn jrn-' + t.cls + chCls + '">' +
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
    return editor.addNode(type, ins, t.outs, x, y, "jrnode-" + t.cls, d, nodeHtml(type, d));
  }

  // ------------------------------------------- мультивыделение нод
  // Ctrl+клик — добавить/убрать из выделения; Shift+рамка — выделить областью;
  // перетаскивание любой выделенной ноды двигает всю группу; Delete — удалить группу.
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

    // Shift+рамка по пустому месту (capture — чтобы Drawflow не начал панораму канвы)
    host.addEventListener("mousedown", function (e) {
      if (!canEdit() || !e.shiftKey || e.button !== 0) return;
      if (e.target.closest(".drawflow-node")) return;
      e.preventDefault();
      e.stopPropagation();
      var r = host.getBoundingClientRect();
      band = { x0: e.clientX - r.left, y0: e.clientY - r.top, rect: null };
      bandEl = document.createElement("div");
      bandEl.id = "jrBand";
      host.appendChild(bandEl);
    }, true);

    // групповое перетаскивание: mousedown по ноде из выделения
    host.addEventListener("mousedown", function (e) {
      if (!canEdit() || e.button !== 0 || band) return;
      var el = e.target.closest(".drawflow-node");
      if (!el) return;
      var id = parseInt(el.id.slice(5), 10);
      if (!groupSel.has(id) || groupSel.size < 2) return;
      gDrag = { grab: id, sx: e.clientX, sy: e.clientY, pos: {} };
      groupSel.forEach(function (nid) {
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
      groupSel.forEach(function (nid) {
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
      groupSel.forEach(function (nid) {
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
      if (!steps.length) steps = [""];
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
        arr.forEach(function (sqlText, i) {
          var l = document.createElement("label");
          l.textContent = "Шаг " + (i + 1) + " — SQL";
          var ta = document.createElement("textarea");
          ta.value = sqlText;
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
        box.querySelectorAll("textarea[data-step]").forEach(function (ta) { cur.push(ta.value); });
        while (cur.length < n) cur.push("");
        cur.length = n;
        renderSteps(cur);
      });
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
        body.querySelectorAll('[data-steps-box="' + f.k + '"] textarea[data-step]')
          .forEach(function (ta) { if (ta.value.trim()) arr.push(ta.value); });
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
  window.jrAddNode = function (type) {
    if (!editor || !canEdit() || !NODE_TYPES[type]) return;
    var host = document.getElementById("jrCanvas");
    var x = (host.clientWidth / 2 - editor.canvas_x) / editor.zoom - 115 + (Math.random() * 60 - 30);
    var y = (host.clientHeight / 2 - editor.canvas_y) / editor.zoom - 90 + (Math.random() * 60 - 30);
    addNodeAt(type, {}, Math.max(10, x), Math.max(10, y));
  };

  window.jrNew = function () {
    if (!editor) return;
    document.getElementById("jrSelect").value = "";
    renderJourney(null);
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
    inited = true;
    var host = document.getElementById("jrCanvas");
    editor = new Drawflow(host);
    editor.reroute = true;
    editor.start();
    // двойной клик по блоку — модалка настроек
    host.addEventListener("dblclick", function (e) {
      var el = e.target.closest(".drawflow-node");
      if (!el || !el.id || el.id.indexOf("node-") !== 0) return;
      openNodeEditor(parseInt(el.id.slice(5), 10));
    });
    wireCanvasUx(host);
    wireMultiSelect(host);
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
