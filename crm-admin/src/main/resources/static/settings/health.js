/* ============================================================
   СОСТОЯНИЕ СИСТЕМЫ — одна страница на вопрос «всё ли в порядке».

   Читают её в двух случаях: утром перед работой и когда что-то сломалось. Поэтому
   сверху итог одним словом и список проверок с подсказкой «что делать», а числа —
   ниже: таблицы, очередь, переливы, подключения.

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

  function renderTables(){
    var host = document.getElementById("hlTables");
    if (!host) return;
    var list = data.tables || [];
    host.innerHTML = '<table class="hl-tbl"><thead><tr>' +
        "<th>" + T("Таблица") + "</th><th>" + T("Что это") + "</th>" +
        '<th class="num">' + T("Строк") + '</th><th class="num">' + T("Размер") + "</th>" +
      "</tr></thead><tbody>" + list.map(function(t){
        return "<tr" + (t.exists ? "" : ' class="hl-missing"') + ">" +
          '<td class="mono">' + esc(t.table) + "</td>" +
          "<td>" + esc(T(t.title)) + "</td>" +
          '<td class="num">' + (t.exists ? num(t.rows) + (t.exact ? "" : " <span class=\"hl-approx\">" + T("≈") + "</span>") : "—") + "</td>" +
          '<td class="num">' + esc(t.size || "—") + "</td></tr>";
      }).join("") + "</tbody></table>" +
      '<div class="hl-note">' + T("Знак ≈ значит оценку планировщика: точный подсчёт по большой таблице — это полное сканирование, и ради страницы состояния оно того не стоит.") + "</div>";
  }

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
    renderTop(); renderChecks(); renderTables(); renderProcesses(); renderConnections();
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
