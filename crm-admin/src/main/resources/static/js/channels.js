/* ============================================================================
   КАНАЛЫ (#sec-channels): во что обходится канал и в каком он состоянии.

   Экран один на все каналы: тарификация у них устроена одинаково, различается
   только обзор — у почты к нему добавляются данные Google и Mail.ru Postmaster.
   Канал берётся из подраздела меню (openSection → chOpen).

   Считает цену сервер (/api/channels/{id}/pricing): затраты и объём хранятся
   строками с периодом действия, и приводить их к месяцам в двух местах —
   верный способ получить два разных числа на одном экране.
   ============================================================================ */
(function () {
  var API = "/api/channels";
  var CUR = { id: null, label: "", free: false, tab: "overview" };
  var DATA = { costs: [], volumes: [], pricing: null, postmaster: null };
  var PERIOD = { from: null, to: null };
  var CHART = {};
  var LOADING = false;

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m];
    });
  }
  function t2(s) { return (typeof t === "function") ? t(s) : s; }
  function money(v) {
    if (v == null || v === "") return "—";
    var n = Number(v);
    if (!isFinite(n)) return "—";
    return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
  }
  function price(v) {
    if (v == null) return "—";
    var n = Number(v);
    if (!isFinite(n)) return "—";
    /* Копейки за письмо — обычное дело, поэтому знаков больше, чем у сумм:
       округление до копейки превратило бы 0,004 ₽ в ноль. */
    return n.toLocaleString("ru-RU", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + " ₽";
  }
  function num(v) { return v == null || v === "" ? "" : String(v); }
  function iso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
           "-" + String(d.getDate()).padStart(2, "0");
  }

  function navLabel(id) {
    if (typeof NAV === "undefined") return null;
    var grp = NAV.filter(function (n) { return n.id === "channels"; })[0];
    var item = grp && (grp.children || []).filter(function (c) { return c.id === id; })[0];
    return item ? t2(item.label) : null;
  }

  function req(method, url, body) {
    var opt = { method: method, credentials: "same-origin",
                headers: { Accept: "application/json" } };
    if (body !== undefined) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(body);
    }
    return fetch(url, opt).then(function (r) {
      if (r.status === 403) throw new Error("Нет прав на изменение");
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.status === 204 ? null : r.json().catch(function () { return null; });
    });
  }

  /* ------------------------------------------------------------- открытие */

  /** Вызывается оболочкой при переходе в подраздел канала. */
  window.chOpen = function (channelId) {
    if (!channelId) return;
    var changed = CUR.id !== channelId;
    CUR.id = channelId;
    /* Подпись берём из меню сразу, не дожидаясь ответа сервера: иначе в шапке на
       полсекунды повисает «Канал», а при недоступном API — навсегда. */
    CUR.label = navLabel(channelId) || CUR.label || channelId;
    if (changed) { CUR.tab = "overview"; DATA = { costs: [], volumes: [], pricing: null, postmaster: null }; }
    if (!PERIOD.from) {
      var now = new Date();
      PERIOD.to = iso(now);
      PERIOD.from = iso(new Date(now.getFullYear() - 1, now.getMonth(), 1));
    }
    load();
  };

  function load() {
    if (!CUR.id) return;
    /* Сброс ошибки обязателен: без него первая же неудача остаётся на экране
       навсегда — повторная загрузка проходит, а раздел продолжает показывать
       старое сообщение вместо данных. */
    DATA.error = null;
    LOADING = true; render();
    var q = "?from=" + PERIOD.from + "&to=" + PERIOD.to;
    var jobs = [
      req("GET", API).then(function (list) {
        var me = (list || []).filter(function (c) { return c.id === CUR.id; })[0] || {};
        CUR.label = me.label || CUR.id;
        CUR.free = !!me.is_free;
      }),
      req("GET", API + "/" + CUR.id + "/costs").then(function (r) { DATA.costs = r || []; }),
      req("GET", API + "/" + CUR.id + "/volumes").then(function (r) { DATA.volumes = r || []; }),
      req("GET", API + "/" + CUR.id + "/pricing" + q).then(function (r) { DATA.pricing = r; })
    ];
    if (CUR.id === "email") {
      jobs.push(req("GET", API + "/email/postmaster" + q)
        .then(function (r) { DATA.postmaster = r; })
        .catch(function () { DATA.postmaster = null; }));
    }
    Promise.all(jobs).catch(function (e) {
      /* Раздел новый, и первым делом ломается доступ: показать это прямо на
         экране полезнее, чем оставить пустые карточки. */
      DATA.error = (e && e.message) || String(e);
    }).then(function () { LOADING = false; render(); });
  }

  /* -------------------------------------------------------------- отрисовка */

  function render() {
    var host = el("chHost");
    if (!host) return;
    var title = el("chTitle"), sub = el("chSub");
    if (title) title.textContent = CUR.label || t2("Канал");
    if (sub) {
      sub.textContent = CUR.free
        ? t2("Канал бесплатный: тарификация отключена.")
        : t2("Стоимость канала, модель тарификации и расчёт цены одной коммуникации.");
    }
    renderTabs();

    if (LOADING && !DATA.pricing) { host.innerHTML = '<div class="empty">' + t2("Загружаю…") + "</div>"; return; }
    if (DATA.error) { host.innerHTML = '<div class="err">' + esc(DATA.error) + "</div>"; return; }

    host.innerHTML = CUR.tab === "pricing" ? pricingHtml() : overviewHtml();
    wire(host);
    if (CUR.tab === "overview") drawCharts();
  }

  function renderTabs() {
    var box = el("chTabs");
    if (!box) return;
    var tabs = [["overview", "Обзор"], ["pricing", "Тарификация"]];
    box.innerHTML = tabs.map(function (x) {
      return '<button type="button" class="ch-tab' + (CUR.tab === x[0] ? " on" : "") +
             '" data-tab="' + x[0] + '">' + t2(x[1]) + "</button>";
    }).join("");
    box.querySelectorAll("[data-tab]").forEach(function (b) {
      b.onclick = function () { CUR.tab = b.dataset.tab; render(); if (window.Router) Router.touch(); };
    });
  }

  /* ----------------------------------------------------------------- обзор */

  function overviewHtml() {
    var p = DATA.pricing || {};
    var html =
      '<div class="card"><h2>' + t2("Стоимость одной коммуникации сейчас") + "</h2>" +
      '<div class="note">' + t2("Расчёт по текущему месяцу: затраты месяца, делённые на объём месяца.") + "</div>" +
      '<div class="price-now">' +
        (CUR.free
          ? '<span class="free-badge">' + t2("Канал бесплатный") + "</span>"
          : '<div><span class="price-lbl">' + t2("за одну коммуникацию") + "</span>" +
            '<span class="price-big">' + price(p.currentPrice) + "</span></div>") +
        '<div><span class="price-lbl">' + t2("затраты за месяц") + "</span>" +
          '<span class="price-sub">' + money(p.currentCost) + "</span></div>" +
        '<div><span class="price-lbl">' + t2("объём за месяц") + "</span>" +
          '<span class="price-sub">' + (p.currentVolume ? Number(p.currentVolume).toLocaleString("ru-RU") : "—") + "</span></div>" +
      "</div></div>";

    html +=
      '<div class="card">' +
      '<div class="chart-head"><h2>' + t2("Динамика") + "</h2>" +
        '<span class="spacer"></span>' +
        '<div class="period"><input type="date" id="chFrom" value="' + esc(PERIOD.from) + '">' +
        '<span>—</span><input type="date" id="chTo" value="' + esc(PERIOD.to) + '">' +
        '<button type="button" class="btn" id="chApply">' + t2("Показать") + "</button></div></div>" +
      '<div class="grid2">' +
        '<div><div class="price-lbl">' + t2("стоимость одной коммуникации") + "</div>" +
          '<div class="chart-box"><canvas id="chPriceChart"></canvas></div></div>' +
        '<div><div class="price-lbl">' + t2("расходы на канал") + "</div>" +
          '<div class="chart-box"><canvas id="chCostChart"></canvas></div></div>' +
      "</div></div>";

    if (CUR.id === "email") html += postmasterHtml();
    return html;
  }

  function postmasterHtml() {
    var pm = DATA.postmaster || {}, rows = pm.stats || [], st = pm.settings || {};
    var last = {};
    rows.forEach(function (r) { last[r.source] = r; });     /* строки отсортированы по дате */

    function repClass(v) {
      if (!v) return "";
      var s = String(v).toUpperCase();
      if (s === "HIGH" || s === "GOOD") return "good";
      if (s === "BAD" || s === "LOW") return "bad";
      return "warn";
    }
    function pct(v) { return v == null ? "—" : (Number(v) * 100).toFixed(2).replace(".", ",") + "%"; }
    function cnt(v) { return v == null ? "—" : Number(v).toLocaleString("ru-RU"); }

    var g = last.google, m = last.mailru;
    var html = '<div class="card"><div class="chart-head"><h2>' + t2("Состояние домена") + "</h2>" +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn" id="chPmRefresh">' + t2("Обновить из постмастеров") + "</button></div>" +
      '<div class="pm-src">' + t2("Домен") + ": <b>" + esc(st.domain || "—") + "</b>" +
        (st.google_checked_at ? " · Google: " + esc(String(st.google_checked_at).slice(0, 16).replace("T", " ")) : "") +
        (st.mailru_checked_at ? " · Mail.ru: " + esc(String(st.mailru_checked_at).slice(0, 16).replace("T", " ")) : "") +
      "</div>";

    if (!rows.length) {
      html += '<div class="empty">' +
        t2("Данных пока нет. Впишите токены в настройках → Интеграции → Postmaster и нажмите «Обновить».") +
        "</div>";
    } else {
      html += '<div class="pm-grid">' +
        tile("Google · репутация домена", g && g.domain_reputation, repClass(g && g.domain_reputation)) +
        tile("Google · репутация IP", g && g.ip_reputation, repClass(g && g.ip_reputation)) +
        tile("Google · жалобы на спам", g ? pct(g.spam_rate) : null, g && g.spam_rate > 0.003 ? "bad" : "good") +
        tile("Google · SPF", g ? pct(g.spf_ratio) : null, "") +
        tile("Google · DKIM", g ? pct(g.dkim_ratio) : null, "") +
        tile("Google · DMARC", g ? pct(g.dmarc_ratio) : null, "") +
        tile("Mail.ru · отправлено", m ? cnt(m.sent) : null, "") +
        tile("Mail.ru · доставлено", m ? cnt(m.delivered) : null, "") +
        tile("Mail.ru · прочитано", m ? cnt(m.read_count) : null, "") +
        tile("Mail.ru · жалобы", m ? cnt(m.complaints) : null, m && m.complaints > 0 ? "warn" : "") +
        tile("Mail.ru · спам", m ? pct(m.spam_rate) : null, m && m.spam_rate > 0.003 ? "bad" : "good") +
        tile("Mail.ru · репутация", m && m.domain_reputation, repClass(m && m.domain_reputation)) +
      "</div>";
    }
    if (st.google_status === "error") html += '<div class="err">Google: ' + esc(st.google_error || "") + "</div>";
    if (st.mailru_status === "error") html += '<div class="err">Mail.ru: ' + esc(st.mailru_error || "") + "</div>";
    return html + "</div>";
  }

  function tile(label, value, cls) {
    return '<div class="pm-card"><div class="k">' + esc(t2(label)) + "</div>" +
           '<div class="v ' + (cls || "") + '">' + esc(value == null || value === "" ? "—" : value) + "</div></div>";
  }

  /* ----------------------------------------------------------- тарификация */

  function pricingHtml() {
    var dis = CUR.free ? " disabled" : "";
    var html =
      '<div class="card"><label class="check"><input type="checkbox" id="chFree"' +
        (CUR.free ? " checked" : "") + ">" +
        "<span>" + t2("Бесплатный") + "</span></label>" +
      '<div class="free-hint">' +
        t2("Канал не тарифицируется: блоки ниже блокируются, стоимость коммуникации — ноль. Введённые строки сохраняются.") +
      "</div></div>";

    html += '<div class="card"><h2>' + t2("Стоимость") + "</h2>" +
      '<div class="note">' + t2("Строка на каждую статью: за что платим, сколько и за какой период.") + "</div>" +
      "<table><thead><tr>" +
        "<th>" + t2("Сумма") + "</th><th>" + t2("Период суммы") + "</th>" +
        "<th>" + t2("Период оплаты") + "</th><th>" + t2("Подрядчик") + "</th>" +
        "<th>" + t2("За что платим") + "</th><th></th>" +
      "</tr></thead><tbody>" +
      (DATA.costs.length ? DATA.costs.map(costRow).join("")
        : '<tr><td colspan="6" class="empty">' + t2("Статей пока нет.") + "</td></tr>") +
      "</tbody></table>" +
      '<div class="card-foot"><button type="button" class="btn" id="chAddCost"' + dis + ">＋ " +
        t2("Добавить строку") + "</button></div></div>";

    html += '<div class="card"><h2>' + t2("Модель тарификации") + "</h2>" +
      '<div class="note">' + t2("Объём поштучных отправок за период. Период по умолчанию — год.") + "</div>" +
      "<table><thead><tr>" +
        "<th>" + t2("Объём") + "</th><th>" + t2("Период объёма") + "</th>" +
        "<th>" + t2("Период действия") + "</th><th>" + t2("Комментарий") + "</th><th></th>" +
      "</tr></thead><tbody>" +
      (DATA.volumes.length ? DATA.volumes.map(volumeRow).join("")
        : '<tr><td colspan="5" class="empty">' + t2("Объём не задан.") + "</td></tr>") +
      "</tbody></table>" +
      '<div class="card-foot"><button type="button" class="btn" id="chAddVolume"' + dis + ">＋ " +
        t2("Добавить строку") + "</button></div></div>";

    var p = DATA.pricing || {};
    html += '<div class="card"><h2>' + t2("Стоимость одной коммуникации") + "</h2>" +
      '<div class="note">' +
        t2("Затраты за месяц делятся на объём за тот же месяц; годовые суммы приводятся к месячным делением на 12.") +
      "</div>" +
      '<div class="price-now">' +
        (CUR.free ? '<span class="free-badge">' + t2("Канал бесплатный") + "</span>"
          : '<div><span class="price-lbl">' + t2("сейчас") + '</span><span class="price-big">' +
            price(p.currentPrice) + "</span></div>") +
        '<div><span class="price-lbl">' + t2("затраты за месяц") + '</span><span class="price-sub">' +
          money(p.currentCost) + "</span></div>" +
        '<div><span class="price-lbl">' + t2("объём за месяц") + '</span><span class="price-sub">' +
          (p.currentVolume ? Number(p.currentVolume).toLocaleString("ru-RU") : "—") + "</span></div>" +
      "</div></div>";
    return html;
  }

  function costRow(c) {
    var dis = CUR.free ? " disabled" : "";
    return '<tr data-cost="' + c.id + '">' +
      '<td><input type="text" data-f="amount" value="' + esc(num(c.amount)) + '"' + dis + "></td>" +
      '<td><select data-f="amountPeriod"' + dis + ">" +
        '<option value="month"' + (c.amount_period === "month" ? " selected" : "") + ">" + t2("в месяц") + "</option>" +
        '<option value="year"' + (c.amount_period !== "month" ? " selected" : "") + ">" + t2("в год") + "</option>" +
      "</select></td>" +
      '<td><input type="date" data-f="dateFrom" value="' + esc(dateVal(c.date_from)) + '"' + dis + ">" +
        '<input type="date" data-f="dateTo" value="' + esc(dateVal(c.date_to)) + '"' + dis + "></td>" +
      '<td><input type="text" data-f="vendor" value="' + esc(c.vendor || "") + '"' + dis + "></td>" +
      '<td><input type="text" data-f="note" value="' + esc(c.note || "") + '"' + dis + "></td>" +
      '<td><div class="row-actions">' +
        '<button type="button" class="btn" data-save="cost"' + dis + ">" + t2("Сохранить") + "</button>" +
        '<button type="button" class="btn danger" data-del="cost"' + dis + ">✕</button>" +
      "</div></td></tr>";
  }

  function volumeRow(v) {
    var dis = CUR.free ? " disabled" : "";
    return '<tr data-volume="' + v.id + '">' +
      '<td><input type="text" data-f="volume" value="' + esc(num(v.volume)) + '"' + dis + "></td>" +
      '<td><select data-f="volumePeriod"' + dis + ">" +
        '<option value="month"' + (v.volume_period === "month" ? " selected" : "") + ">" + t2("в месяц") + "</option>" +
        '<option value="year"' + (v.volume_period !== "month" ? " selected" : "") + ">" + t2("в год") + "</option>" +
      "</select></td>" +
      '<td><input type="date" data-f="dateFrom" value="' + esc(dateVal(v.date_from)) + '"' + dis + ">" +
        '<input type="date" data-f="dateTo" value="' + esc(dateVal(v.date_to)) + '"' + dis + "></td>" +
      '<td><input type="text" data-f="note" value="' + esc(v.note || "") + '"' + dis + "></td>" +
      '<td><div class="row-actions">' +
        '<button type="button" class="btn" data-save="volume"' + dis + ">" + t2("Сохранить") + "</button>" +
        '<button type="button" class="btn danger" data-del="volume"' + dis + ">✕</button>" +
      "</div></td></tr>";
  }

  function dateVal(v) { return v == null ? "" : String(v).slice(0, 10); }

  /* --------------------------------------------------------------- события */

  function wire(host) {
    var free = el("chFree");
    if (free) free.onchange = function () {
      req("PUT", API + "/" + CUR.id + "/free", { free: free.checked })
        .then(function () { CUR.free = free.checked; load(); })
        .catch(fail);
    };

    var apply = el("chApply");
    if (apply) apply.onclick = function () {
      PERIOD.from = el("chFrom").value || PERIOD.from;
      PERIOD.to = el("chTo").value || PERIOD.to;
      load();
    };

    var addCost = el("chAddCost");
    if (addCost) addCost.onclick = function () {
      req("POST", API + "/" + CUR.id + "/costs", { amount: 0, amountPeriod: "year" })
        .then(load).catch(fail);
    };
    var addVol = el("chAddVolume");
    if (addVol) addVol.onclick = function () {
      req("POST", API + "/" + CUR.id + "/volumes", { volume: 0, volumePeriod: "year" })
        .then(load).catch(fail);
    };

    host.querySelectorAll("[data-save]").forEach(function (b) {
      b.onclick = function () {
        var kind = b.dataset.save;
        var tr = b.closest("tr");
        var body = {};
        tr.querySelectorAll("[data-f]").forEach(function (f) { body[f.dataset.f] = f.value; });
        body.id = kind === "cost" ? tr.dataset.cost : tr.dataset.volume;
        req("POST", API + "/" + CUR.id + (kind === "cost" ? "/costs" : "/volumes"), body)
          .then(load).catch(fail);
      };
    });
    host.querySelectorAll("[data-del]").forEach(function (b) {
      b.onclick = function () {
        var kind = b.dataset.del, tr = b.closest("tr");
        var id = kind === "cost" ? tr.dataset.cost : tr.dataset.volume;
        if (!confirm(t2("Удалить строку?"))) return;
        req("DELETE", API + "/" + CUR.id + (kind === "cost" ? "/costs/" : "/volumes/") + id)
          .then(load).catch(fail);
      };
    });

    var pm = el("chPmRefresh");
    if (pm) pm.onclick = function () {
      pm.disabled = true;
      pm.textContent = t2("Обновляю…");
      req("POST", API + "/email/postmaster/refresh", { days: 30 })
        .then(function (res) {
          var bad = [];
          if (res && res.google && !res.google.ok) bad.push("Google: " + res.google.error);
          if (res && res.mailru && !res.mailru.ok) bad.push("Mail.ru: " + res.mailru.error);
          if (bad.length) alert(bad.join("\n"));
          load();
        })
        .catch(function (e) { fail(e); pm.disabled = false; pm.textContent = t2("Обновить из постмастеров"); });
    };
  }

  function fail(e) { alert((e && e.message) || String(e)); }

  /* --------------------------------------------------------------- графики */

  function drawCharts() {
    if (typeof Chart === "undefined" || !DATA.pricing) return;
    var series = DATA.pricing.series || [];
    var labels = series.map(function (r) { return String(r.month).slice(0, 7); });

    draw("price", "chPriceChart", labels,
         series.map(function (r) { return r.price == null ? null : Number(r.price); }),
         "#3CFAB4", t2("стоимость одной коммуникации, ₽"));
    draw("cost", "chCostChart", labels,
         series.map(function (r) { return Number(r.cost || 0); }),
         "#50C3FF", t2("расходы, ₽"));
  }

  function draw(key, canvasId, labels, data, color, title) {
    var node = el(canvasId);
    if (!node) return;
    if (CHART[key]) { CHART[key].destroy(); delete CHART[key]; }
    CHART[key] = new Chart(node.getContext("2d"), {
      type: "line",
      data: { labels: labels, datasets: [{ label: title, data: data, borderColor: color,
        backgroundColor: color + "22", borderWidth: 2, tension: .25, fill: true,
        pointRadius: 2, spanGaps: true }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { color: "rgba(80,195,255,.10)" } },
                  y: { grid: { color: "rgba(80,195,255,.10)" }, beginAtZero: true } } }
    });
  }

  /* ------------------------------------------------------------- маршруты */

  if (window.Router) Router.register("sec-channels", {
    serialize: function () { return CUR.tab === "pricing" ? ["pricing"] : []; },
    apply: function (rest) {
      var want = rest[0] === "pricing" ? "pricing" : "overview";
      if (want !== CUR.tab) { CUR.tab = want; render(); }
    }
  });
})();
