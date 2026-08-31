/* ============================================================================
   АНАЛИТИКА КОММУНИКАЦИЙ — витрины sandbox.t_comm_* из Greenplum.

   Считает их отдельный SQL-скрипт, экран только показывает. Ничего не пересчитывает
   на клиенте: перцентили, доли и оконные функции уже посчитаны в базе, и повторять их
   в JS означало бы завести второй ответ на тот же вопрос.

   ПОРЯДОК БЛОКОВ НЕ СЛУЧАЕН. Первым идёт качество разметки — так велит комментарий в
   самом скрипте: «если доля конфликтов и NULL заметная, все цифры по рекламной нагрузке
   ниже недостоверны». Поэтому сверху стоит светофор по разметке, и только под ним —
   нагрузка и переспам. Показывать переспам над непроверенной разметкой значит выдавать
   ошибку классификации за поведение рассылок.

   ДВА ФЛАГА РЕКЛАМЫ. В данных их два: строгий (оба классификатора сказали adv) и широкий
   (хотя бы один). Три комбинации из семи противоречивы, поэтому одного числа мало:
   везде, где показывается доля рекламы, рядом стоит вторая — иначе экран молча принял бы
   спорное решение за человека.

   Графики — обычные div-полосы, как в остальной панели. Библиотеки для этого не нужны,
   а лишняя зависимость в офлайн-контуре стоит дороже красоты.
   ============================================================================ */
(function () {
  "use strict";

  var data = null;
  var loading = false;

  function el(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }
  /** Большие числа читаются группами: 1 234 567, а не 1234567. */
  function fmt(v) {
    if (v == null || v === "") return "—";
    var n = Number(v);
    if (!isFinite(n)) return esc(v);
    return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  }
  function pct(v) {
    return v == null || v === "" ? "—" : fmt(v) + "%";
  }
  function rows(block) {
    return (data && data.blocks && data.blocks[block] && data.blocks[block].rows) || [];
  }
  function blockError(block) {
    return data && data.blocks && data.blocks[block] && data.blocks[block].error;
  }

  // ------------------------------------------------------------------ кирпичи

  function tile(label, value, note, tone) {
    return '<div class="ca-tile' + (tone ? " " + tone : "") + '">' +
      '<div class="ca-tile-v">' + value + "</div>" +
      '<div class="ca-tile-l">' + esc(label) + "</div>" +
      (note ? '<div class="ca-tile-n">' + note + "</div>" : "") +
      "</div>";
  }

  /**
   * Горизонтальные полосы. Доля считается от максимума в наборе, а не от суммы:
   * вопрос почти всегда «кто больше», а не «какая часть целого», и полоса на 2% от суммы
   * не читается вовсе.
   */
  function bars(list, opts) {
    opts = opts || {};
    if (!list.length) return '<div class="ca-empty">нет данных</div>';
    var max = 0;
    list.forEach(function (r) { max = Math.max(max, num(r.value)); });
    return '<div class="ca-bars">' + list.map(function (r) {
      var w = max > 0 ? Math.max(1, Math.round(100 * num(r.value) / max)) : 0;
      return '<div class="ca-bar-row"' + (r.title ? ' title="' + esc(r.title) + '"' : "") + ">" +
        '<div class="ca-bar-l">' + esc(r.label) + "</div>" +
        '<div class="ca-bar-t"><div class="ca-bar' + (r.tone ? " " + r.tone : "") +
          '" style="width:' + w + '%"></div></div>' +
        '<div class="ca-bar-v">' + (r.text || fmt(r.value)) + "</div>" +
      "</div>";
    }).join("") + "</div>";
  }

  function table(cols, list, empty) {
    if (!list.length) return '<div class="ca-empty">' + (empty || "нет данных") + "</div>";
    return '<div class="ca-tbl-wrap"><table class="ca-tbl"><thead><tr>' +
      cols.map(function (c) { return "<th>" + esc(c.t) + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      list.map(function (r) {
        return "<tr>" + cols.map(function (c) {
          return "<td" + (c.mono ? ' class="mono"' : "") + ">" + (c.f ? c.f(r) : esc(r[c.k])) + "</td>";
        }).join("") + "</tr>";
      }).join("") +
      "</tbody></table></div>";
  }

  function card(title, note, body, id) {
    return '<section class="ca-card"' + (id ? ' id="' + id + '"' : "") + ">" +
      "<h2>" + esc(title) + "</h2>" +
      (note ? '<p class="ca-note">' + note + "</p>" : "") + body + "</section>";
  }

  /** Блок не прочитался — говорим, какой именно и почему, а не прячем карточку. */
  function errBox(block) {
    var e = blockError(block);
    return e ? '<div class="ca-err">Витрина не прочитана: ' + esc(e) + "</div>" : "";
  }

  function pick(list, dim) {
    return list.filter(function (r) { return r.dim_name === dim; });
  }

  // ------------------------------------------------------------------ блоки

  /* 1. Качество разметки. Светофор наверху: пока конфликтов много, всё ниже — оценка
     сверху, а не факт. */
  function renderQuality() {
    var q = rows("quality");
    var total = 0, conflict = 0, notSet = 0;
    q.forEach(function (r) {
      total += num(r.comm_cnt);
      if (num(r.is_conflict)) conflict += num(r.comm_cnt);
      if (num(r.is_not_set)) notSet += num(r.comm_cnt);
    });
    var cShare = total ? 100 * conflict / total : 0;
    var nShare = total ? 100 * notSet / total : 0;
    var bad = cShare + nShare;
    var tone = bad >= 10 ? "bad" : bad >= 2 ? "warn" : "ok";
    var verdict = bad >= 10
      ? "Разметка расходится заметно — цифры ниже читайте как оценку сверху, а не как факт."
      : bad >= 2
        ? "Расхождения есть, но небольшие: на выводы ниже влияют слабо."
        : "Классификаторы согласны почти везде — нагрузке ниже можно верить.";

    var tiles =
      tile("всего коммуникаций", fmt(total)) +
      tile("противоречивая разметка", pct(cShare.toFixed(2)),
           fmt(conflict) + " шт.", cShare >= 5 ? "bad" : cShare > 0 ? "warn" : "ok") +
      tile("не доразмечено", pct(nShare.toFixed(2)),
           fmt(notSet) + " шт.", nShare >= 5 ? "bad" : nShare > 0 ? "warn" : "ok");

    var list = q.map(function (r) {
      return {
        label: r.comm_class,
        value: num(r.comm_cnt),
        text: fmt(r.comm_cnt) + " · " + pct(r.comm_share_pct),
        tone: num(r.is_conflict) ? "bad" : num(r.is_not_set) ? "warn" : "",
        title: r.communication_type + " / " + r.business_communication_type +
               " · людей: " + fmt(r.users_cnt)
      };
    });

    return card("Качество разметки", verdict,
      '<div class="ca-tiles ' + tone + '">' + tiles + "</div>" + errBox("quality") + bars(list));
  }

  /* 2. Что вообще происходит: итоги и разрезы из t_comm_summary. */
  function renderSummary() {
    var s = rows("summary");
    var all = pick(s, "total")[0] || {};
    var tiles =
      tile("людей в базе", fmt(all.users_cnt)) +
      tile("на человека", fmt(all.avg_per_user), "коммуникаций всего") +
      tile("реклама, широкий флаг", pct(all.ad_any_share_pct),
           "строгий: " + pct(all.ad_strict_share_pct)) +
      tile("конфликтная разметка", pct(all.conflict_share_pct));

    var byChannel = pick(s, "channel").map(function (r) {
      /* В длинном формате значение разреза лежит в dim_value, а не в колонке с именем
         разреза: таблица одна на все срезы, и колонки channel в ней нет. */
      return {
        label: r.dim_value || "—",
        value: num(r.comm_cnt),
        text: fmt(r.comm_cnt) + " · реклама " + pct(r.ad_any_share_pct),
        title: "людей: " + fmt(r.users_cnt) + ", на человека: " + fmt(r.avg_per_user)
      };
    });

    var bySource = pick(s, "source_crm").slice(0, 15).map(function (r) {
      return {
        label: r.dim_value || "—",
        value: num(r.comm_cnt),
        text: fmt(r.comm_cnt) + " · реклама " + pct(r.ad_any_share_pct)
      };
    });

    return card("Сводка", "Доля рекламы дана двумя флагами: широкий — хотя бы один"
        + " классификатор сказал adv, строгий — оба. Между ними и лежит спорная часть.",
      '<div class="ca-tiles">' + tiles + "</div>" + errBox("summary") +
      '<h3>По каналам</h3>' + bars(byChannel) +
      '<h3>По источникам — первые 15</h3>' + bars(bySource));
  }

  /* 3. Переспам. Порог из скрипта: больше трёх рекламных за календарный месяц. */
  function renderOverspam() {
    var o = rows("overspam");
    var last = null;
    o.forEach(function (r) { if (!last || r.dt_month > last) last = r.dt_month; });
    var lastRows = o.filter(function (r) { return r.dt_month === last; });

    var byChannel = lastRows.map(function (r) {
      return {
        label: r.channel || "—",
        value: num(r.overspam_share_pct),
        text: pct(r.overspam_share_pct) + " · " + fmt(r.users_overspam) + " чел.",
        tone: num(r.overspam_share_pct) >= 20 ? "bad" : num(r.overspam_share_pct) >= 5 ? "warn" : "",
        title: "строгий флаг: " + fmt(r.users_overspam_strict) + " чел."
      };
    });

    var a = rows("overspamAll");
    var lastAll = a.length ? a[a.length - 1] : {};
    var tiles =
      tile("месяц", esc(last || "—"), "последний в данных") +
      tile("больше 3 реклам", fmt(lastAll.users_over_3), "человек за месяц, все каналы",
           num(lastAll.users_over_3) ? "warn" : "") +
      tile("больше 5", fmt(lastAll.users_over_5)) +
      tile("больше 10", fmt(lastAll.users_over_10), null,
           num(lastAll.users_over_10) ? "bad" : "") +
      tile("получают в двух и более каналах", fmt(lastAll.users_multichannel));

    var months = a.map(function (r) {
      return {
        label: r.dt_month,
        value: num(r.users_over_3),
        text: fmt(r.users_over_3) + " чел. · в среднем " + fmt(r.avg_ad_per_user),
        title: "рекламных всего: " + fmt(r.ad_comm_cnt) + ", p95 на человека: " + fmt(r.p95_ad_per_user)
      };
    });

    return card("Переспам — только по рекламным",
      "Сервисное сообщение человек получает в ответ на своё действие, ограничивать его"
      + " нельзя, и в этот счёт оно не входит. Порог — больше трёх рекламных за месяц."
      + " Отдельно считается сумма по всем каналам: человек бывает чистым в каждом канале"
      + " по отдельности и переспамлен в сумме, потому что каналы друг о друге не знают.",
      '<div class="ca-tiles">' + tiles + "</div>" + errBox("overspamAll") +
      "<h3>Доля переспамленных по каналам — " + esc(last || "последний месяц") + "</h3>" +
      errBox("overspam") + bars(byChannel) +
      "<h3>Сколько людей получают больше трёх реклам в месяц</h3>" + bars(months));
  }

  /* 4. Нагрузка: перцентили важнее среднего, распределение перекошено. */
  function renderLoad() {
    var l = rows("load");
    return card("Нагрузка на человека",
      "Среднее тянут вверх немногочисленные тяжёлые пользователи, поэтому смотреть надо"
      + " на p50 (типичный человек) и p95/p99 (самые загруженные).",
      errBox("load") + table([
        { t: "Канал", k: "channel" },
        { t: "Класс", k: "comm_class", mono: true },
        { t: "Людей", f: function (r) { return fmt(r.users_cnt); } },
        { t: "Всего", f: function (r) { return fmt(r.comm_cnt); } },
        { t: "Среднее", f: function (r) { return fmt(r.avg_per_user); } },
        { t: "p50", f: function (r) { return fmt(r.p50_per_user); } },
        { t: "p90", f: function (r) { return fmt(r.p90_per_user); } },
        { t: "p95", f: function (r) { return fmt(r.p95_per_user); } },
        { t: "p99", f: function (r) { return fmt(r.p99_per_user); } },
        { t: "макс", f: function (r) { return fmt(r.max_per_user); } }
      ], l));
  }

  /* 5. Концентрация: на кого уходит рекламный трафик. */
  function renderConcentration() {
    var ORDER = ["top_1_pct", "top_5_pct", "top_10_pct", "top_50_pct", "bottom_50_pct"];
    var c = rows("concentration").slice().sort(function (a, b) {
      return ORDER.indexOf(a.user_group) - ORDER.indexOf(b.user_group);
    });
    var list = c.map(function (r) {
      return {
        label: r.user_group,
        value: num(r.ad_share_pct),
        text: pct(r.ad_share_pct) + " · " + fmt(r.users_cnt) + " чел.",
        title: "рекламных: " + fmt(r.ad_comm_cnt) + ", от " + fmt(r.min_ad) + " до " + fmt(r.max_ad)
      };
    });
    return card("Концентрация рекламного трафика",
      "Какая доля рекламных отправок уходит на верхнюю часть базы. Если верхний процент"
      + " забирает заметную долю — нагрузка распределена неравномерно, и работать надо"
      + " с ним, а не со средним по базе.",
      errBox("concentration") + bars(list));
  }

  /* 6. Частота касаний. */
  function renderFrequency() {
    var f = rows("frequency");
    return card("Частота касаний",
      "Разрыв в днях между соседними сообщениями внутри канала. Отдельно для рекламы и"
      + " для остального: сравнивать их в одной строке бессмысленно.",
      errBox("frequency") + table([
        { t: "Канал", k: "channel" },
        { t: "Тип", f: function (r) { return num(r.is_ad_any) ? "реклама" : "не реклама"; } },
        { t: "Людей", f: function (r) { return fmt(r.users_with_2plus); } },
        { t: "Средний разрыв", f: function (r) { return fmt(r.avg_gap_days) + " дн."; } },
        { t: "p50", f: function (r) { return fmt(r.p50_gap_days); } },
        { t: "p10", f: function (r) { return fmt(r.p10_gap_days); } },
        { t: "мин", f: function (r) { return fmt(r.min_gap_days); } },
        { t: "в 30 дней", f: function (r) { return fmt(r.avg_comm_per_30d); } },
        { t: "дважды за день", f: function (r) { return fmt(r.users_same_day_hits); } }
      ], f));
  }

  /* 7. Динамика: за счёт чего растёт объём. */
  function renderDynamics() {
    var d = rows("dynamics");
    var byMonth = {};
    d.forEach(function (r) {
      var m = byMonth[r.dt_month] || (byMonth[r.dt_month] = { comm: 0, nw: 0, ret: 0 });
      m.comm += num(r.comm_cnt);
      m.nw += num(r.users_new);
      m.ret += num(r.users_returning);
    });
    var list = Object.keys(byMonth).sort().map(function (k) {
      var m = byMonth[k];
      return {
        label: k,
        value: m.comm,
        text: fmt(m.comm) + " · новых " + fmt(m.nw),
        title: "вернувшихся: " + fmt(m.ret)
      };
    });
    return card("Динамика по месяцам",
      "Видно, за счёт чего растёт объём: расширения базы (новые люди) или роста частоты"
      + " на тех же. Числа новых и вернувшихся сложены по каналам и классам, поэтому"
      + " человек, получивший письмо и пуш, посчитан в обоих.",
      errBox("dynamics") + bars(list));
  }

  /* 8. День недели. */
  function renderWeekday() {
    var w = rows("weekday");
    var byDay = {};
    w.forEach(function (r) {
      var k = r.weekday_num + " " + (r.weekday_name || "");
      byDay[k] = (byDay[k] || 0) + num(r.comm_cnt);
    });
    var list = Object.keys(byDay).sort().map(function (k) {
      return { label: k.split(" ").slice(1).join(" ") || k, value: byDay[k] };
    });
    return card("По дням недели", null, errBox("weekday") + bars(list));
  }

  /* 9. Давление за день. */
  function renderPressure() {
    var p = rows("dailyPressure");
    var byCnt = {};
    p.forEach(function (r) {
      var k = num(r.comm_in_day);
      byCnt[k] = (byCnt[k] || 0) + num(r.user_days);
    });
    var list = Object.keys(byCnt).sort(function (a, b) { return a - b; }).map(function (k) {
      return { label: k + " за день", value: byCnt[k], text: fmt(byCnt[k]) + " чел.-дней" };
    });
    return card("Давление за день",
      "Сколько сообщений прилетает человеку в один день. Показаны дни до двадцати"
      + " сообщений — дальше хвост, который на картинке всё равно не читается.",
      errBox("dailyPressure") + bars(list));
  }

  /* 10. Дубли — почти всегда баг сценария. */
  function renderDuplicates() {
    return card("Дубли",
      "Один продукт, канал, класс и источник одному человеку в один день дважды."
      + " Почти всегда это ошибка сценария, а не задумка.",
      errBox("duplicates") + table([
        { t: "Канал", k: "channel" },
        { t: "Источник", k: "source_crm", mono: true },
        { t: "Продукт", k: "product_type" },
        { t: "Класс", k: "comm_class", mono: true },
        { t: "Групп", f: function (r) { return fmt(r.dup_groups); } },
        { t: "Людей", f: function (r) { return fmt(r.users_affected); } },
        { t: "Лишних", f: function (r) { return fmt(r.extra_comm_cnt); } },
        { t: "Макс в группе", f: function (r) { return fmt(r.max_in_group); } }
      ], rows("duplicates"), "дублей не нашлось"));
  }

  /* 11. Кто порождает спорную разметку — рабочий список. */
  function renderConflicts() {
    return card("Спорная разметка — к разбору",
      "Список для владельцев сценариев: где именно классификаторы расходятся или"
      + " разметка не проставлена.",
      errBox("conflicts") + table([
        { t: "Класс", k: "comm_class", mono: true },
        { t: "Источник", k: "source_crm", mono: true },
        { t: "Канал", k: "channel" },
        { t: "Продукт", k: "product_type" },
        { t: "Разметка source", k: "source_flag" },
        { t: "Коммуникаций", f: function (r) { return fmt(r.comm_cnt); } },
        { t: "Людей", f: function (r) { return fmt(r.users_cnt); } },
        { t: "Период", f: function (r) { return esc(r.first_dt) + " — " + esc(r.last_dt); } }
      ], rows("conflicts"), "расхождений не нашлось"));
  }

  // ------------------------------------------------------------------ страница

  function render() {
    var host = el("caHost");
    if (!host) return;
    host.innerHTML =
      renderQuality() +
      renderSummary() +
      renderOverspam() +
      renderLoad() +
      renderConcentration() +
      renderFrequency() +
      renderDynamics() +
      renderWeekday() +
      renderPressure() +
      renderDuplicates() +
      renderConflicts();
    var f = el("caFoot");
    if (f) {
      f.textContent = "Источник: " + (data.connectionName || "—") +
        " · витрины прочитаны за " + fmt(data.tookMs) + " мс";
    }
  }

  function load() {
    if (loading) return;
    loading = true;
    var host = el("caHost");
    if (host) host.innerHTML = '<div class="ca-empty">Читаю витрины…</div>';
    fetch("/api/comm-analytics/overview", {
      credentials: "same-origin", headers: { Accept: "application/json" }
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = t ? JSON.parse(t) : null; } catch (e) { /* не json — покажем как есть */ }
        if (!r.ok) throw new Error((j && j.message) || t || ("HTTP " + r.status));
        return j;
      });
    }).then(function (d) {
      data = d;
      render();
    }).catch(function (e) {
      if (host) {
        host.innerHTML = '<div class="ca-err">' + esc(e.message) + "</div>";
      }
    }).then(function () { loading = false; });
  }

  // ------------------------------------------------------------------ подключение

  /**
   * Строка выбора источника.
   * <p>
   * Стоит на самом экране, а не в настройках: витрины могут лежать не там, где витрина
   * отчёта, и «источник задаётся в Отчётах» было допущением, а не фактом. Менять может
   * администратор — в строке подключения адрес и учётка боевой базы; остальные видят,
   * откуда числа, и это ровно то, что им нужно знать.
   */
  function renderConn(c) {
    var sel = el("caConn");
    var note = el("caConnNote");
    if (!sel) return;
    var list = c.connections || [];
    sel.disabled = !c.canEdit;
    sel.title = c.canEdit ? "" : "Менять источник может только администратор";
    sel.innerHTML = '<option value="">— не выбран —</option>' +
      list.map(function (x) {
        return '<option value="' + esc(x.id) + '"' +
          (String(x.id) === String(c.connectionId) ? " selected" : "") + ">" +
          esc(x.name) + "</option>";
      }).join("");
    if (note) {
      note.textContent = !c.connectionId
        ? "Источник не выбран: витрины читать неоткуда."
        : (c.inherited
            ? "Подключение унаследовано от отчёта «ЧЕК СМС траффик». Выберите своё, если"
              + " витрины лежат в другой базе."
            : "");
    }
  }

  function loadConfig() {
    return fetch("/api/comm-analytics/config", {
      credentials: "same-origin", headers: { Accept: "application/json" }
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) { if (c) renderConn(c); return c; })
      .catch(function () { return null; });
  }

  function saveConn(id) {
    var note = el("caConnNote");
    if (note) note.textContent = "Сохраняю…";
    fetch("/api/comm-analytics/config", {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ connectionId: id || null })
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = t ? JSON.parse(t) : null; } catch (e) { /* не json — покажем как есть */ }
        if (!r.ok) throw new Error((j && j.message) || t || ("HTTP " + r.status));
        return j;
      });
    }).then(function (c) {
      renderConn(c);
      /* Источник сменили — старые числа с экрана убираем сразу, а не оставляем висеть
         под новым именем базы. */
      data = null;
      load();
    }).catch(function (e) {
      if (note) note.textContent = e.message;
    });
  }

  window.initCommAnalyticsSection = function () {
    var b = el("caReload");
    if (b) b.onclick = function () { data = null; load(); };
    var sel = el("caConn");
    if (sel) sel.onchange = function () { saveConn(sel.value); };
    /* Витрины пересобирают скриптом, и вчерашние числа ничем не лучше пустого экрана —
       читаем при каждом открытии раздела. */
    loadConfig();
    load();
  };
})();
