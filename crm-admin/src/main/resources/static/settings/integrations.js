/* ============================================================
   КАРТА ИНТЕГРАЦИЙ — с кем панель разговаривает и в каком это состоянии.

   Схема рисуется из ответа GET /api/admin/integrations: узлы (внешние системы) и
   потоки между ними. Координат сервер не присылает — раскладка тут, чтобы перекладка
   картинки не требовала правки бэкенда.

   Цвет значит одно и то же везде: зелёный — работает, жёлтый — работает, но есть на что
   посмотреть, красный — не отвечает, серый — выключено человеком или не настроено.
   Остановленный процесс красным не красим: это решение, а не поломка.
   ============================================================ */
window.Integrations = (function(){
  "use strict";

  var bound = false, data = null, loading = false;

  function T(s){ return (typeof window.t2 === "function") ? window.t2(s) : s; }
  function esc(v){ return String(v == null ? "" : v)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  var STATUS_LABEL = { ok:"работает", warn:"есть замечания", down:"не отвечает", off:"выключено" };

  /* Раскладка: панель в центре, слева — базы, с которыми идёт обмен в обе стороны,
     справа — те, куда мы только пишем или откуда только читаем. */
  var W = 1040, H = 520, NW = 210, NH = 88;
  var CENTER = { x: (W - 240) / 2, y: (H - 96) / 2, w: 240, h: 96 };
  var SLOTS = {
    prod:     { x: 30,      y: 60,  side:"left"  },
    crmdb:    { x: 30,      y: 330, side:"left"  },
    jira:     { x: W - NW - 30, y: 40,  side:"right" },
    reportdb: { x: W - NW - 30, y: 200, side:"right" },
    tableau:  { x: W - NW - 30, y: 360, side:"right" }
  };

  function req(url){
    return fetch(url, { credentials:"same-origin", headers:{ Accept:"application/json" } })
      .then(function(r){
        if (r.ok) return r.json();
        return r.text().then(function(t){
          var m = ""; try { m = JSON.parse(t).message || ""; } catch(e){}
          throw new Error(m || ("HTTP " + r.status));
        });
      });
  }

  function nodeById(id){
    for (var i = 0; i < (data.nodes || []).length; i++) if (data.nodes[i].id === id) return data.nodes[i];
    return null;
  }

  /* Точка стыковки линии: у центральной карточки — её левый или правый край,
     у бокового узла — край, обращённый к центру. */
  function anchorCenter(side, shift){
    return { x: side === "left" ? CENTER.x : CENTER.x + CENTER.w, y: CENTER.y + CENTER.h / 2 + (shift || 0) };
  }
  function anchorNode(slot, shift){
    return { x: slot.side === "left" ? slot.x + NW : slot.x, y: slot.y + NH / 2 + (shift || 0) };
  }

  function svg(){
    var nodes = data.nodes || [], flows = data.flows || [];
    var parts = [];

    /* Линии рисуем первыми: узлы должны лежать поверх, иначе стрелка упирается в текст. */
    var used = {};
    flows.forEach(function(f, i){
      var otherId = f.from === "panel" ? f.to : f.from;
      var slot = SLOTS[otherId];
      if (!slot) return;
      var k = used[otherId] = (used[otherId] || 0) + 1;
      /* Два потока к одному узлу разводим по вертикали, иначе они лягут друг на друга. */
      var shift = (k - 1) * 26 - (countFlows(otherId) - 1) * 13;
      var a = anchorCenter(slot.side, shift), b = anchorNode(slot, shift);
      var toPanel = f.to === "panel";
      var from = toPanel ? b : a, to = toPanel ? a : b;
      var mid = (from.x + to.x) / 2;
      parts.push('<path class="ig-line ' + esc(f.status) + '" d="M' + from.x + ' ' + from.y +
        " C" + mid + " " + from.y + " " + mid + " " + to.y + " " + to.x + " " + to.y +
        '" marker-end="url(#ig-arrow-' + esc(f.status) + ')"/>');
      var lx = (a.x + b.x) / 2, ly = (a.y + b.y) / 2 - 7;
      parts.push('<text class="ig-line-label" x="' + lx + '" y="' + ly + '" text-anchor="middle">' +
        esc(T(f.title)) + "</text>");
      if (f.detail){
        parts.push('<text class="ig-line-sub" x="' + lx + '" y="' + (ly + 14) + '" text-anchor="middle">' +
          esc(cut(f.detail, 52)) + "</text>");
      }
    });

    parts.push(box(CENTER.x, CENTER.y, CENTER.w, CENTER.h, nodeById("panel") || { title:"Панель CRM" }, true));
    nodes.forEach(function(n){
      var slot = SLOTS[n.id];
      if (!slot) return;
      parts.push(box(slot.x, slot.y, NW, NH, n, false));
    });

    var defs = ["ok","warn","down","off"].map(function(s){
      return '<marker id="ig-arrow-' + s + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7"' +
        ' markerHeight="7" orient="auto-start-reverse">' +
        '<path class="ig-arrow ' + s + '" d="M0 0 L10 5 L0 10 z"/></marker>';
    }).join("");

    return '<svg class="ig-svg" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet">' +
      "<defs>" + defs + "</defs>" + parts.join("") + "</svg>";
  }

  function countFlows(otherId){
    var n = 0;
    (data.flows || []).forEach(function(f){ if (f.from === otherId || f.to === otherId) n++; });
    return n;
  }

  function box(x, y, w, h, n, center){
    var st = n.status || "ok";
    return '<g class="ig-node ' + esc(st) + (center ? " center" : "") + '"' +
        (n.pane ? ' data-pane="' + esc(n.pane) + '"' : "") + '>' +
      '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="12"/>' +
      '<circle class="ig-dot" cx="' + (x + 16) + '" cy="' + (y + 20) + '" r="5"/>' +
      '<text class="ig-node-title" x="' + (x + 30) + '" y="' + (y + 25) + '">' + esc(T(n.title || n.id)) + "</text>" +
      '<text class="ig-node-sub" x="' + (x + 16) + '" y="' + (y + 46) + '">' + esc(cut(n.detail, w > 220 ? 46 : 34)) + "</text>" +
      '<text class="ig-node-st" x="' + (x + 16) + '" y="' + (y + 68) + '">' +
        esc(T(STATUS_LABEL[st] || st)) + "</text>" +
    "</g>";
  }

  function cut(s, n){
    s = String(s == null ? "" : s);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function cards(){
    var flows = data.flows || [];
    if (!flows.length) return '<div class="empty">' + T("Интеграций не найдено") + "</div>";
    return '<div class="ig-cards">' + flows.map(function(f){
      var fromN = nodeById(f.from), toN = nodeById(f.to);
      return '<div class="ig-card ' + esc(f.status) + '">' +
        '<div class="ig-card-head"><span class="ig-dot-s"></span>' + esc(T(f.title)) +
          '<span class="ig-card-st">' + esc(T(STATUS_LABEL[f.status] || f.status)) + "</span></div>" +
        '<div class="ig-card-path mono">' +
          esc((fromN && fromN.title) || f.from) + " → " + esc((toN && toN.title) || f.to) + "</div>" +
        '<div class="ig-card-about">' + esc(T(f.about || "")) + "</div>" +
        (f.detail ? '<div class="ig-card-detail">' + esc(f.detail) + "</div>" : "") +
        (f.process ? '<div class="ig-card-proc mono">' + T("процесс") + ": " + esc(f.process) +
            " · " + (f.processEnabled === false ? T("остановлен") : T("работает")) + "</div>" : "") +
        (f.pane ? '<button type="button" class="btn ig-go" data-pane="' + esc(f.pane) + '">' +
            T("Открыть раздел") + "</button>" : "") +
      "</div>";
    }).join("") + "</div>";
  }

  function render(){
    var host = document.getElementById("igHost");
    if (!host) return;
    if (loading){ host.className = "empty"; host.textContent = T("Опрашиваем интеграции…"); return; }
    if (!data){ host.className = "empty"; host.textContent = T("Не удалось прочитать состояние интеграций"); return; }
    host.className = "";
    host.innerHTML = svg() + cards();

    /* Клик по узлу и по кнопке ведёт в тот раздел, где это настраивается: карта
       отвечает на вопрос «что не так», а чинят всё равно там. */
    Array.prototype.forEach.call(host.querySelectorAll("[data-pane]"), function(el){
      el.style.cursor = "pointer";
      el.onclick = function(){
        var id = el.dataset.pane;
        if (typeof window.openPane === "function") window.openPane(id);
      };
    });

    var ts = document.getElementById("igStamp");
    if (ts) ts.textContent = data.generatedAt
      ? T("состояние на") + " " + String(data.generatedAt).slice(11, 16) : "";
  }

  function load(){
    loading = true; render();
    return req("../api/admin/integrations")
      .then(function(j){ data = j; loading = false; render(); })
      .catch(function(e){
        loading = false; data = null; render();
        var host = document.getElementById("igHost");
        if (host) host.textContent = T("Не удалось прочитать состояние интеграций") + ": " + (e && e.message);
      });
  }

  function bind(){
    if (bound) return;
    var b = document.getElementById("igReload");
    if (!b) return;
    bound = true;
    b.onclick = load;
  }

  return {
    open: function(){ bind(); load(); },
    reload: load
  };
})();
