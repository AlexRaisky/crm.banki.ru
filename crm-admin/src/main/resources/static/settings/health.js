/* ============================================================
   СОСТОЯНИЕ СИСТЕМЫ — одна страница на вопрос «всё ли в порядке».

   Читают её в двух случаях: утром перед работой и когда что-то сломалось. Поэтому
   сверху итог одним словом и список проверок с подсказкой «что делать», а ниже — то,
   чего числом не скажешь: сутки очереди по часам, возраст последней удачной доставки,
   объём данных, работа в панели за две недели.

   Графики рисуются здесь же, как SVG: библиотеки ради дюжины столбиков тянуть незачем,
   а панель обязана открываться без сети. Цвет берётся из переменных темы — та же
   картинка должна читаться и в тёмной, и в светлой.

   Цвет значит то же, что и везде в панели: зелёный работает, жёлтый работает с
   замечаниями, красный не отвечает, серый выключено человеком. Остановленный перелив
   красным не красим — это решение, а не поломка.
   ============================================================ */
window.Health = (function(){
  "use strict";

  var bound = false, data = null, loading = false, timer = null;

  function T(s){ return (typeof window.t2 === "function") ? window.t2(s) : s; }
  function esc(v){ return String(v == null ? "" : v)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  var STATUS = { ok:"всё в порядке", warn:"есть замечания", down:"не работает", off:"выключено" };
  var CHANNEL = { sms:"SMS", push:"Push", email:"E-mail", cc:"Контакт-центр" };
  var EVENT_KIND = { income:"Онлайн-события", time:"По расписанию" };

  /* Числа разделяем пробелами: «1 284 706» читается с одного взгляда, «1284706» — нет. */
  function num(n){
    if (n == null) return "—";
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }
  function uptime(ms){
    var s = Math.floor((ms || 0) / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600),
        m = Math.floor(s % 3600 / 60);
    if (d) return d + " " + T("дн") + " " + h + " " + T("ч");
    if (h) return h + " " + T("ч") + " " + m + " " + T("мин");
    return m + " " + T("мин");
  }
  /* Возраст словами. Считает его сервер — у контуров и браузера разные часовые пояса,
     и «два часа назад» из-за этого легко превращается в «через три часа». */
  function ago(sec){
    if (sec == null) return T("не было");
    sec = Math.max(0, Math.round(sec));
    if (sec < 90) return sec + " " + T("сек назад");
    var m = Math.round(sec / 60);
    if (m < 90) return m + " " + T("мин назад");
    var h = Math.round(sec / 3600);
    if (h < 36) return h + " " + T("ч назад");
    return Math.round(sec / 86400) + " " + T("дн назад");
  }
  function mb(bytes){
    if (!bytes) return "0";
    var mbv = bytes / 1048576;
    return mbv >= 1024 ? (mbv / 1024).toFixed(1) + " " + T("ГБ") : Math.round(mbv) + " " + T("МБ");
  }

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

  /* ---------------------------------------------------------------- заготовки графиков */

  function chart(w, h, inner){
    return '<svg class="hl-chart" viewBox="0 0 ' + w + " " + h + '">' + inner + "</svg>";
  }
  function panel(title, right, body){
    return '<div class="hl-panel"><div class="hl-panel-t">' + esc(title) +
      (right ? "<b>" + esc(right) + "</b>" : "") + "</div>" + body + "</div>";
  }

  /* Кольцо: долю показывает длина дуги, число стоит в центре. У четырёх карточек подряд
     глаз сравнивает круги быстрее, чем полосы. */
  function ring(pct, status){
    var r = 26, c = 2 * Math.PI * r, on = c * Math.max(0, Math.min(100, pct || 0)) / 100;
    return '<svg class="hl-ring ' + esc(status) + '" viewBox="0 0 64 64">' +
      '<circle class="track" cx="32" cy="32" r="' + r + '"/>' +
      '<circle class="arc" cx="32" cy="32" r="' + r + '" stroke-dasharray="' + on.toFixed(1) +
        " " + (c - on).toFixed(1) + '"/>' +
      '<text class="val" x="32" y="37">' + Math.round(pct || 0) + "</text></svg>";
  }
  function gauge(label, value, sub, ringHtml){
    return '<div class="hl-gauge">' + (ringHtml || "") +
      '<div class="hl-gauge-main"><div class="hl-gauge-l">' + esc(label) + "</div>" +
      '<div class="hl-gauge-v">' + esc(value) + "</div>" +
      (sub ? '<div class="hl-gauge-s">' + esc(sub) + "</div>" : "") + "</div></div>";
  }

  /* Горизонтальные полосы: длина под текстом, подпись поверх. Числа сравниваются глазом
     плохо, длина — хорошо. */
  function rowsBar(list, nameOf, valueOf, textOf){
    if (!list || !list.length) return '<div class="hl-note">' + T("нет данных") + "</div>";
    var max = 1;
    list.forEach(function(x){ max = Math.max(max, valueOf(x) || 0); });
    return '<div class="hl-rows">' + list.map(function(x){
      var v = valueOf(x) || 0;
      return '<div class="hl-row"><span class="bar" style="width:' + (v * 100 / max).toFixed(1) + '%"></span>' +
        '<span class="nm mono">' + esc(nameOf(x)) + "</span>" +
        '<span class="vv">' + textOf(x) + "</span></div>";
    }).join("") + "</div>";
  }

  /* ---------------------------------------------------------------- верх страницы */

  function renderTop(){
    var host = document.getElementById("hlTop");
    if (!host) return;
    var b = data.build || {};
    host.innerHTML =
      '<div class="hl-verdict ' + esc(data.status) + '">' +
        '<span class="hl-dot"></span>' +
        '<span class="hl-verdict-text">' + esc(T(STATUS[data.status] || data.status)) + "</span>" +
        '<span class="hl-verdict-env mono">' + esc(data.env) + "</span>" +
      "</div>" +
      '<div class="hl-facts">' +
        fact(T("Версия"), b.shortCommit ? esc(b.shortCommit) : T("неизвестна"),
             b.subject ? esc(b.subject) : T("образ собран мимо scripts/build.sh")) +
        fact(T("Приложение работает"), uptime(data.uptimeMs), b.builtAt ? T("сборка") + " " + esc(String(b.builtAt).slice(0,16).replace("T"," ")) : "") +
        fact(T("База"), esc((data.database || {}).size || "—"),
             esc((data.database || {}).name || "") + " · " + esc((data.database || {}).version || "")) +
        fact(T("Миграции"), esc((data.database || {}).migration || "—"),
             (data.database || {}).failedMigrations
               ? T("неудачных: ") + (data.database || {}).failedMigrations
               : T("накачено ") + esc((data.database || {}).migratedAt || "")) +
      "</div>";
  }

  function fact(label, value, sub){
    return '<div class="hl-fact"><div class="hl-fact-l">' + esc(label) + "</div>" +
      '<div class="hl-fact-v">' + value + "</div>" +
      (sub ? '<div class="hl-fact-s">' + sub + "</div>" : "") + "</div>";
  }

  function renderChecks(){
    var host = document.getElementById("hlChecks");
    if (!host) return;
    var list = data.checks || [];
    if (!list.length){ host.innerHTML = ""; return; }
    /* Сначала то, что требует внимания: страницу открывают именно ради этих строк.
       Ранг берём через hasOwnProperty, а не через ||: у «down» он равен нулю, и привычное
       (order[s] || 9) отправляло бы самое важное в самый низ. */
    var ORDER = { down:0, warn:1, off:2, ok:3 };
    function rank(s){ return Object.prototype.hasOwnProperty.call(ORDER, s) ? ORDER[s] : 9; }
    list = list.slice().sort(function(a, b){ return rank(a.status) - rank(b.status); });
    host.innerHTML = list.map(function(c){
      return '<div class="hl-check ' + esc(c.status) + '">' +
        '<span class="hl-dot"></span>' +
        '<span class="hl-check-main"><span class="hl-check-title">' + esc(T(c.title)) + "</span>" +
          (c.hint ? '<span class="hl-check-hint">' + esc(T(c.hint)) + "</span>" : "") + "</span>" +
      "</div>";
    }).join("");
  }

  /* ---------------------------------------------------------------- нагрузка */

  function renderRuntime(){
    var host = document.getElementById("hlRuntime");
    if (!host) return;
    var r = data.runtime || {}, db = data.database || {};
    var heapPct = r.heapPct || 0, connPct = r.dbConnPct || 0;
    host.innerHTML =
      gauge(T("Память"), mb(r.heapUsed) + " " + T("из") + " " + mb(r.heapMax),
            T("занято") + " " + heapPct + "%",
            ring(heapPct, heapPct > 90 ? "warn" : "ok")) +
      gauge(T("Соединения к базе"), num(r.dbConnections) + " " + T("из") + " " + num(r.dbMaxConnections),
            T("работают прямо сейчас") + ": " + num(r.dbActive),
            ring(connPct, connPct > 80 ? "warn" : "ok")) +
      gauge(T("Потоки"), num(r.threads), T("ядер") + ": " + num(r.cpus) +
            (r.load != null ? " · " + T("нагрузка") + " " + r.load : "")) +
      gauge(T("Размер базы"), db.size || "—", db.name || "") +
      gauge(T("Аптайм"), uptime(data.uptimeMs), T("с последнего перезапуска")) +
      gauge(T("Контур"), String(data.env || "—").toUpperCase(),
            (data.build || {}).shortCommit || T("версия неизвестна"));
  }

  /* ---------------------------------------------------------------- сутки очереди */

  function renderPulse(){
    var host = document.getElementById("hlPulse");
    if (!host) return;
    var list = data.pulse || [];
    if (!list.length){
      host.innerHTML = '<div class="hl-note">' + T("Очередь синка на этом контуре не заведена") + "</div>";
      return;
    }
    var W = 980, H = 210, L = 40, R = 12, TP = 12, B = 26;
    var ph = H - TP - B, pw = W - L - R, max = 1, sum = { q:0, ok:0, err:0 };
    list.forEach(function(x){
      var q = +x.queued || 0, ok = +x.ok || 0, er = +x.err || 0;
      sum.q += q; sum.ok += ok; sum.err += er;
      max = Math.max(max, ok + er, q);
    });
    var step = pw / list.length, bw = Math.min(24, step * 0.66), inner = bw * 0.54, parts = [];

    [0, 0.5, 1].forEach(function(f){
      var y = TP + ph - ph * f;
      parts.push('<line class="grid" x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/>');
      parts.push('<text class="axis" x="' + (L - 7) + '" y="' + (y + 3.5) + '" text-anchor="end">' +
        Math.round(max * f) + "</text>");
    });

    list.forEach(function(x, i){
      var cx = L + step * i + step / 2;
      var q = +x.queued || 0, ok = +x.ok || 0, er = +x.err || 0;
      if (q){
        var hq = ph * q / max;
        parts.push('<rect class="b-queued" x="' + (cx - bw / 2).toFixed(1) + '" y="' + (TP + ph - hq).toFixed(1) +
          '" width="' + bw.toFixed(1) + '" height="' + hq.toFixed(1) + '" rx="2"/>');
      }
      var y = TP + ph;
      if (ok){
        var hok = ph * ok / max; y -= hok;
        parts.push('<rect class="b-ok" x="' + (cx - inner / 2).toFixed(1) + '" y="' + y.toFixed(1) +
          '" width="' + inner.toFixed(1) + '" height="' + hok.toFixed(1) + '" rx="2"/>');
      }
      if (er){
        var her = ph * er / max; y -= her;
        parts.push('<rect class="b-err" x="' + (cx - inner / 2).toFixed(1) + '" y="' + y.toFixed(1) +
          '" width="' + inner.toFixed(1) + '" height="' + her.toFixed(1) + '" rx="2"/>');
      }
      /* Час, в котором вообще ничего не происходило, оставляем засечкой, а не пустотой:
         иначе не отличить «ничего не было» от «график не дорисовался». */
      if (!q && !ok && !er){
        parts.push('<rect class="b-zero" x="' + (cx - bw / 2).toFixed(1) + '" y="' + (TP + ph - 2) +
          '" width="' + bw.toFixed(1) + '" height="2" rx="1"/>');
      }
      if (i % 3 === 0){
        parts.push('<text class="axis" x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' +
          esc(x.label) + "</text>");
      }
      parts.push('<rect class="hover" x="' + (L + step * i).toFixed(1) + '" y="' + TP + '" width="' +
        step.toFixed(1) + '" height="' + ph + '"><title>' + esc(x.at) + " — " +
        T("поставлено") + ": " + q + ", " + T("доставлено") + ": " + ok + ", " + T("ошибок") + ": " + er +
        "</title></rect>");
    });

    host.innerHTML = chart(W, H, parts.join("")) +
      '<div class="hl-legend">' +
        "<span><i class=\"ok\"></i>" + T("доставлено в прод") + ": " + num(sum.ok) + "</span>" +
        "<span><i class=\"err\"></i>" + T("отказано") + ": " + num(sum.err) + "</span>" +
        "<span><i class=\"queued\"></i>" + T("поставлено в очередь") + ": " + num(sum.q) + "</span>" +
      "</div>";
  }

  /* ---------------------------------------------------------------- когда последний раз */

  function renderFresh(){
    var host = document.getElementById("hlFresh");
    if (!host) return;
    var list = data.freshness || [];
    if (!list.length){ host.innerHTML = ""; return; }
    host.innerHTML = list.map(function(f){
      /* Красим только то, за чем следим непрерывно: у заведения шаблона или выката
         «два дня назад» — норма, и порог по возрасту красил бы страницу на выходных. */
      var cls = "";
      if (f.warnAfter > 0){
        if (f.ago == null || f.ago > f.warnAfter * 4) cls = "old";
        else if (f.ago > f.warnAfter) cls = "warn";
        else cls = "ok";
      }
      return '<div class="hl-fresh-i ' + cls + '">' +
        '<div class="hl-fresh-t">' + esc(T(f.title)) + "</div>" +
        '<div class="hl-fresh-v">' + esc(ago(f.ago)) + "</div>" +
        '<div class="hl-fresh-s">' + esc(f.at || "—") + "</div>" +
        (f.hint ? '<div class="hl-fresh-h">' + esc(T(f.hint)) + "</div>" : "") +
      "</div>";
    }).join("");
  }

  /* ---------------------------------------------------------------- данные */

  function donut(items){
    var total = 0;
    items.forEach(function(x){ total += x.n || 0; });
    var r = 50, c = 2 * Math.PI * r, off = 0, segs = [];
    items.forEach(function(x, i){
      var len = total ? c * (x.n || 0) / total : 0;
      if (len <= 0) return;
      segs.push('<circle class="seg c' + (i % 5) + '" cx="66" cy="66" r="' + r +
        '" stroke-dasharray="' + len.toFixed(2) + " " + (c - len).toFixed(2) +
        '" stroke-dashoffset="' + (-off).toFixed(2) + '"><title>' + esc(x.label) + ": " +
        num(x.n) + "</title></circle>");
      off += len;
    });
    if (!segs.length){
      segs.push('<circle class="seg c4" cx="66" cy="66" r="' + r + '" stroke-dasharray="' + c + ' 0"/>');
    }
    return '<div class="hl-donut"><svg viewBox="0 0 132 132">' + segs.join("") +
        '<text class="mid" x="66" y="68">' + num(total) + "</text>" +
        '<text class="midsub" x="66" y="82">' + T("всего") + "</text></svg>" +
      '<div class="hl-keys">' + items.map(function(x, i){
        return '<div class="hl-key"><i class="k' + (i % 5) + '"></i>' + esc(x.label) +
          (x.sub ? " <span>" + esc(x.sub) + "</span>" : "") + "<b>" + num(x.n) + "</b></div>";
      }).join("") + "</div></div>";
  }

  /* Линия за месяц: всплеск или тишина в заведении шаблонов должны быть видны без
     выгрузки в Excel. Заливка под линией — чтобы ноль читался как ноль, а не как обрыв. */
  function lineChart(list){
    var W = 460, H = 150, L = 28, R = 8, TP = 12, B = 20;
    var ph = H - TP - B, pw = W - L - R, max = 1;
    list.forEach(function(x){ max = Math.max(max, +x.n || 0); });
    var step = list.length > 1 ? pw / (list.length - 1) : pw;
    var pts = list.map(function(x, i){
      return [L + step * i, TP + ph - ph * (+x.n || 0) / max];
    });
    var d = pts.map(function(p, i){ return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    var area = d + " L" + pts[pts.length - 1][0].toFixed(1) + " " + (TP + ph) +
               " L" + pts[0][0].toFixed(1) + " " + (TP + ph) + " Z";
    var parts = ['<defs><linearGradient id="hlFade" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" style="stop-color:var(--blue);stop-opacity:.32"/>' +
      '<stop offset="100%" style="stop-color:var(--blue);stop-opacity:0"/></linearGradient></defs>'];
    [0, 1].forEach(function(f){
      var y = TP + ph - ph * f;
      parts.push('<line class="grid" x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/>');
      parts.push('<text class="axis" x="' + (L - 6) + '" y="' + (y + 3.5) + '" text-anchor="end">' +
        Math.round(max * f) + "</text>");
    });
    parts.push('<path class="area" d="' + area + '"/>');
    parts.push('<path class="line" d="' + d + '"/>');
    list.forEach(function(x, i){
      if (!(+x.n)) return;
      parts.push('<circle class="dot" cx="' + pts[i][0].toFixed(1) + '" cy="' + pts[i][1].toFixed(1) +
        '" r="2.4"><title>' + esc(x.label) + ": " + num(x.n) + "</title></circle>");
    });
    [0, Math.floor(list.length / 2), list.length - 1].forEach(function(i){
      if (!list[i]) return;
      parts.push('<text class="axis" x="' + pts[i][0].toFixed(1) + '" y="' + (H - 6) +
        '" text-anchor="' + (i === 0 ? "start" : (i === list.length - 1 ? "end" : "middle")) + '">' +
        esc(list[i].label) + "</text>");
    });
    return chart(W, H, parts.join(""));
  }

  function renderContent(){
    var host = document.getElementById("hlContent");
    if (!host) return;
    var c = data.content || {}, out = [];

    var tpl = (c.templates || []).map(function(x){
      return { label: T(CHANNEL[x.channel] || x.channel), n: +x.n || 0,
               sub: T("активных") + " " + (+x.active || 0) };
    });
    if (tpl.length) out.push(panel(T("Шаблоны по каналам"), "", donut(tpl)));

    if ((c.trend || []).length){
      var made = 0;
      c.trend.forEach(function(x){ made += +x.n || 0; });
      out.push(panel(T("Заведение шаблонов за месяц"), T("за 30 дней") + ": " + num(made),
        lineChart(c.trend)));
    }

    var ev = c.events || [];
    if (ev.length){
      out.push(panel(T("События"), "", rowsBar(ev,
        function(x){ return T(EVENT_KIND[x.kind] || x.kind); },
        function(x){ return +x.n || 0; },
        function(x){ return "<b>" + num(x.n) + "</b> · " + T("активных") + " " + num(x.active); })));
    }

    var q = c.queue || [];
    if (q.length){
      out.push(panel(T("Очередь синка по статусам"), "", rowsBar(q,
        function(x){ return x.status; },
        function(x){ return +x.n || 0; },
        function(x){ return "<b>" + num(x.n) + "</b>"; })));
    }

    host.innerHTML = out.join("");
  }

  function renderTables(){
    var host = document.getElementById("hlTables");
    if (!host) return;
    var list = data.tables || [];
    var max = 1;
    list.forEach(function(t){ if (t.exists) max = Math.max(max, +t.rows || 0); });
    host.innerHTML = '<table class="hl-tbl"><thead><tr>' +
        "<th>" + T("Таблица") + "</th><th>" + T("Что это") + "</th>" +
        '<th class="num">' + T("Строк") + '</th><th class="num">' + T("Размер") + "</th>" +
      "</tr></thead><tbody>" + list.map(function(t){
        var w = t.exists ? Math.max(1, (+t.rows || 0) * 100 / max) : 0;
        return "<tr" + (t.exists ? "" : ' class="hl-missing"') + ">" +
          '<td class="mono">' + esc(t.table) +
            (t.exists ? '<div class="hl-inbar"><i style="width:' + w.toFixed(1) + '%"></i></div>' : "") + "</td>" +
          "<td>" + esc(T(t.title)) + "</td>" +
          '<td class="num">' + (t.exists ? num(t.rows) + (t.exact ? "" : " <span class=\"hl-approx\">" + T("≈") + "</span>") : "—") + "</td>" +
          '<td class="num">' + esc(t.size || "—") + "</td></tr>";
      }).join("") + "</tbody></table>" +
      '<div class="hl-note">' + T("Знак ≈ значит оценку планировщика: точный подсчёт по большой таблице — это полное сканирование, и ради страницы состояния оно того не стоит.") + "</div>";
  }

  /* ---------------------------------------------------------------- место в базе */

  function renderStorage(){
    var host = document.getElementById("hlStorage");
    if (!host) return;
    var s = data.storage || {};
    var schemas = s.schemas || [], tables = s.tables || [];
    if (!schemas.length && !tables.length){ host.innerHTML = ""; return; }
    var total = 0;
    schemas.forEach(function(x){ total += +x.bytes || 0; });
    host.innerHTML =
      panel(T("По схемам"), T("всего") + " " + mb(total), rowsBar(schemas,
        function(x){ return x.schema_name; },
        function(x){ return +x.bytes || 0; },
        function(x){ return "<b>" + esc(x.size) + "</b> · " + num(x.tables) + " " + T("табл."); })) +
      panel(T("Крупнейшие таблицы"), "", rowsBar(tables,
        function(x){ return x.table_name; },
        function(x){ return +x.bytes || 0; },
        function(x){ return "<b>" + esc(x.size) + "</b>"; }));
  }

  /* ---------------------------------------------------------------- активность */

  function renderActivity(){
    var host = document.getElementById("hlActivity");
    if (!host) return;
    var a = data.activity || {}, days = a.days || [];
    if (!days.length){
      host.innerHTML = '<div class="hl-note">' + T("Журнал действий пуст") + "</div>";
      return;
    }
    var W = 980, H = 170, L = 40, R = 12, TP = 12, B = 24;
    var ph = H - TP - B, pw = W - L - R, max = 1, sum = 0;
    days.forEach(function(x){ max = Math.max(max, +x.n || 0); sum += +x.n || 0; });
    var step = pw / days.length, bw = Math.min(38, step * 0.6), parts = [];

    [0, 0.5, 1].forEach(function(f){
      var y = TP + ph - ph * f;
      parts.push('<line class="grid" x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/>');
      parts.push('<text class="axis" x="' + (L - 7) + '" y="' + (y + 3.5) + '" text-anchor="end">' +
        Math.round(max * f) + "</text>");
    });
    days.forEach(function(x, i){
      var cx = L + step * i + step / 2, n = +x.n || 0, hh = ph * n / max;
      if (n){
        parts.push('<rect class="b-plain" x="' + (cx - bw / 2).toFixed(1) + '" y="' + (TP + ph - hh).toFixed(1) +
          '" width="' + bw.toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="3"/>');
      } else {
        parts.push('<rect class="b-zero" x="' + (cx - bw / 2).toFixed(1) + '" y="' + (TP + ph - 2) +
          '" width="' + bw.toFixed(1) + '" height="2" rx="1"/>');
      }
      parts.push('<text class="axis" x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' +
        esc(x.label) + "</text>");
      parts.push('<rect class="hover" x="' + (L + step * i).toFixed(1) + '" y="' + TP + '" width="' +
        step.toFixed(1) + '" height="' + ph + '"><title>' + esc(x.day) + " — " + T("правок") + ": " + n +
        ", " + T("людей") + ": " + (+x.users || 0) + "</title></rect>");
    });

    host.innerHTML = chart(W, H, parts.join("")) +
      '<div class="hl-legend"><span>' + T("всего правок за две недели") + ": " + num(sum) + "</span></div>" +
      '<div class="hl-two" style="margin-top:14px">' +
        panel(T("Над чем работали"), "", rowsBar(a.tables || [],
          function(x){ return x.table_name; },
          function(x){ return +x.n || 0; },
          function(x){ return "<b>" + num(x.n) + "</b>"; })) +
        panel(T("Кто работал"), "", rowsBar(a.people || [],
          function(x){ return x.who; },
          function(x){ return +x.n || 0; },
          function(x){ return "<b>" + num(x.n) + "</b>"; })) +
      "</div>";
  }

  /* ---------------------------------------------------------------- переливы и связи */

  function renderProcesses(){
    var host = document.getElementById("hlProcs");
    if (!host) return;
    var list = data.processes || [];
    var q = data.queue || {};
    var etl = data.etl || {};
    host.innerHTML =
      '<div class="hl-cards">' +
        card(T("Очередь синка"), num(q.pending || 0) + " " + T("ждут"),
             [T("отправляется") + ": " + num(q.sending || 0),
              T("с ошибкой") + ": " + num(q.error || 0),
              T("доставлено") + ": " + num(q.ok || 0)].join(" · "),
             (q.error ? "down" : ((q.pending || 0) > 50 ? "warn" : "ok"))) +
        /* У ETL два выключателя: переменная окружения и кнопка в «Процессах переливов».
           Карточка показывает тот, который сейчас решает, — иначе она спорит с разделом,
           где человек только что остановил перелив. */
        card(T("Обратный ETL"),
             etl.stopped ? T("остановлен") : (etl.enabled ? T("включён") : T("выключен")),
             etl.stopped ? T("остановлен в «Процессах переливов»") : watermark(etl),
             etl.stopped ? "off" : (etl.enabled ? (etl.configured ? "ok" : "warn") : "off")) +
      "</div>" +
      '<div class="hl-procs">' + list.map(function(p){
        var st = p.enabled ? "ok" : "off";
        return '<div class="hl-proc ' + st + '">' +
          '<span class="hl-dot"></span>' +
          '<span class="hl-proc-main"><span class="hl-proc-title">' + esc(p.title || p.code) + "</span>" +
            '<span class="hl-proc-sub mono">' + esc(p.code) + " · " +
              (p.enabled ? T("работает") : T("остановлен")) +
              (p.lastResult ? " · " + esc(p.lastResult) : "") +
              (p.lastRunAt ? " · " + esc(String(p.lastRunAt).slice(0, 16)) : "") +
            "</span></span>" +
        "</div>";
      }).join("") + "</div>";
  }

  function watermark(etl){
    var w = etl.watermarks || [];
    if (!w.length) return T("водяных знаков ещё нет");
    var newest = "";
    w.forEach(function(x){ if (String(x.lastProdTs) > newest) newest = String(x.lastProdTs); });
    return T("прочитано до") + " " + esc(newest.slice(0, 16));
  }

  function card(title, value, sub, status){
    return '<div class="hl-card ' + esc(status) + '">' +
      '<div class="hl-card-t">' + esc(title) + "</div>" +
      '<div class="hl-card-v">' + value + "</div>" +
      '<div class="hl-card-s">' + sub + "</div></div>";
  }

  function renderConnections(){
    var host = document.getElementById("hlConns");
    if (!host) return;
    var list = data.connections || [];
    if (!list.length){ host.className = "empty"; host.textContent = T("Подключений нет"); return; }
    host.className = "";
    host.innerHTML = list.map(function(c){
      var st = !c.configured ? "off" : (c.ok ? "ok" : "down");
      return '<div class="hl-conn ' + st + '">' +
        '<span class="hl-dot"></span>' +
        '<span class="hl-conn-main"><span class="hl-conn-title">' + esc(c.title) +
          (c.live ? "" : ' <span class="hl-stale">' + T("по последней проверке") + "</span>") + "</span>" +
          '<span class="hl-conn-sub mono">' + esc(c.detail || "") + "</span></span>" +
      "</div>";
    }).join("");
  }

  /* Плейсхолдер отдельным элементом, а не текстом контейнера: внутри контейнера живут
     блоки страницы, и стирать их ради строки «загружаем» пришлось бы вместе с разметкой. */
  function placeholder(text){
    var el = document.getElementById("hlLoading");
    if (!el) return;
    el.hidden = !text;
    if (text) el.textContent = text;
  }

  function render(){
    var host = document.getElementById("hlHost");
    if (!host) return;
    if (!data){ placeholder(loading ? T("Опрашиваем систему…") : T("Не удалось прочитать состояние")); return; }
    placeholder("");
    renderTop(); renderChecks(); renderRuntime(); renderPulse(); renderFresh();
    renderContent(); renderTables(); renderStorage(); renderActivity();
    renderProcesses(); renderConnections();
    var st = document.getElementById("hlStamp");
    if (st) st.textContent = T("состояние на") + " " + String(data.generatedAt || "").slice(11, 16);
  }

  function load(){
    loading = true;
    if (!data) render();
    return req("../api/admin/health")
      .then(function(j){ data = j; loading = false; render(); })
      .catch(function(e){
        loading = false;
        if (!data) placeholder(T("Не удалось прочитать состояние") + ": " + ((e && e.message) || ""));
      });
  }

  function bind(){
    if (bound) return;
    var b = document.getElementById("hlReload");
    if (!b) return;
    bound = true;
    b.onclick = load;
  }

  return {
    open: function(){
      bind();
      load();
      /* Пока раздел открыт, обновляемся сами: страницу состояния часто оставляют
         открытой во время разбора, и устаревшие цифры на ней — худшее, что может быть. */
      clearInterval(timer);
      timer = setInterval(function(){
        var pane = document.getElementById("pane-health");
        if (pane && pane.classList.contains("active")) load(); else clearInterval(timer);
      }, 60000);
    },
    reload: load
  };
})();
