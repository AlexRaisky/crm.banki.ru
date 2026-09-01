/* Раздел «События»: две пошаговые формы завода события — «Онлайн-событие»
   (#sec-event-online) и «Событие по расписанию» (#sec-event-offline).

   Повторяют формы старой Appsmith-админки. Отличие от «Цепочек»: там событие рисуется
   на канве и материализуется из схемы, здесь задаётся напрямую. Пишут обе дороги в одно
   и то же — слой A (flow.*) и слой B (tracker/scheduler/template/commapi), поэтому
   событие, заведённое формой, видно так же, как заведённое цепочкой.

   Справочники общие для обеих форм и тянутся один раз (GET /api/events/dictionaries).
   Права: read открывает форму, add разрешает кнопку — секции ev-online и ev-offline. */
(function () {
  "use strict";

  var dict = null;          // кэш справочников
  var dictPromise = null;   // защита от параллельных загрузок при быстром переключении
  var inited = { online: false, offline: false, list: false };

  var API = "/api/events";

  function el(id) { return document.getElementById(id); }
  function can(cap, section) { return !!(window.CRM && CRM.can && CRM.can(cap, section)); }

  /**
   * Состояние кнопки заведения по праву add в разделе.
   * <p>
   * Спрашиваем дважды: сразу и ещё раз после ответа {@code /api/me}. Профиль приезжает
   * асинхронно, и раздел, открытый раньше ответа, видел пустой — can() честно отвечал
   * «нет», кнопка гасла и оставалась такой навсегда: инициализация раздела выполняется
   * один раз и второй проверки не делала. Внешне это выглядело как «панель не даёт
   * завести событие», причём у пользователя с полными правами.
   */
  function gateSubmit(btnId, section) {
    var apply = function () {
      var b = el(btnId);
      if (!b) return;
      var may = can("add", section);
      b.disabled = !may;
      b.title = may ? "" : "Нет права на заведение событий в этом разделе";
    };
    apply();
    if (window.CRM && CRM.meReady && CRM.meReady.then) CRM.meReady.then(apply, apply);
  }

  /* Свой транспорт, как в abtests.js: в api.js методы именованные, и ради двух ручек
     раздела туда не лезем. Текст ошибки достаём из message — его кладёт
     ValidationErrorHandler, иначе пользователь видел бы «400 Bad Request». */
  function evReq(method, path, body) {
    var opts = { method: method, headers: { Accept: "application/json" }, credentials: "same-origin" };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(API + path, opts).then(function (r) {
      if (r.ok) return r.status === 204 ? null : r.json();
      return r.text().then(function (t) {
        var msg = t;
        try { msg = JSON.parse(t).message || t; } catch (e) { /* не JSON — покажем как есть */ }
        throw new Error(msg || (r.status + " " + r.statusText));
      });
    });
  }

  /* Список значений в <select>. Пустая опция первой: в старой форме поля стартовали
     с «Select option», и незаполненное поле должно оставаться незаполненным, а не
     молча принимать первое значение справочника. */
  function fillSelect(node, values, placeholder) {
    if (!node) return;
    var html = '<option value="">' + (placeholder || "Select option") + "</option>";
    (values || []).forEach(function (v) {
      html += '<option value="' + esc(v) + '">' + esc(v) + "</option>";
    });
    node.innerHTML = html;
  }

  function fillOptions(node, rows, valueKey, labelFn, placeholder) {
    if (!node) return;
    var html = '<option value="">' + (placeholder || "Select option") + "</option>";
    (rows || []).forEach(function (r) {
      html += '<option value="' + esc(r[valueKey]) + '">' + esc(labelFn(r)) + "</option>";
    });
    node.innerHTML = html;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function dictionaries() {
    if (dict) return Promise.resolve(dict);
    if (!dictPromise) {
      dictPromise = evReq("GET", "/dictionaries").then(function (d) {
        dict = d || {};
        return dict;
      }).catch(function (e) {
        dictPromise = null;                 // дать следующему открытию раздела повторить
        throw e;
      });
    }
    return dictPromise;
  }

  // --------------------------------------------------------------- общий вывод

  function say(msgId, text, cls) {
    var m = el(msgId);
    if (!m) return;
    m.textContent = text || "";
    m.className = "ev-msg" + (cls ? " " + cls : "");
  }

  /* Что именно создалось.
     <p>
     Колонок с id две, и это не украшение. Строка живёт в двух местах: в НАШЕЙ копии
     слоя B и в боевой crmdb, и id у неё там разные — в проде их выдаёт перелив (max+1),
     наши identity к нему отношения не имеют. Одна колонка «id» читалась как «идите в
     crmdb и смотрите строку 3003», а такой строки там нет.
     <p>
     Продовый id берём из ответа перелива (export.sent), сопоставляя по паре
     «таблица + наш id»: в одной таблице строк бывает несколько (шаги выборки), и по
     имени таблицы их не различить. */
  function renderResult(boxId, res) {
    var box = el(boxId);
    if (!box) return;
    if (!res) { box.innerHTML = ""; return; }

    var ex = res.export || {};
    var prod = {};
    (ex.sent || []).forEach(function (r) { prod[r.table + "#" + r.ourId] = r.prodId; });
    (ex.skipped || []).forEach(function (r) { prod[r.table + "#" + r.ourId] = r.prodId; });
    var exported = ex.status === "ok";

    var rows = (res.rows || []).map(function (r) {
      var p = prod[r.table + "#" + r.id];
      return "<tr><td class=\"tbl\">" + esc(r.table) + "</td><td>" + esc(r.id) + "</td>" +
        "<td>" + (p == null ? '<span style="color:var(--faint)">—</span>' : esc(p)) + "</td></tr>";
    }).join("");
    var warn = (res.warnings || []).map(function (w) {
      return '<div class="ev-warn">' + esc(w) + "</div>";
    }).join("");
    box.innerHTML =
      '<div class="ev-rows"><table><thead><tr><th>Таблица</th>' +
      "<th>id у нас</th><th>id в crmdb</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table></div>" +
      '<div class="ev-edit-msg" style="margin-top:8px">' +
        (exported
          ? "Слева — id в нашей копии слоя B, справа — id той же строки в боевой crmdb."
            + " Они разные: id в проде выдаёт сама база, наши identity к нему отношения не имеют."
          : "Справа показано то, что на самом деле есть в crmdb сейчас. Прочерк — строка"
            + " туда не уехала; строка расписания при этом может быть заполнена: её создаёт"
            + " планировщик до нашей транзакции, и откат её не убирает."
            + " Дописать остальное — «Настройки» → «Перелив событий».") +
      "</div>" + warn;
  }

  function fail(msgId, e) {
    var text = (e && (e.message || e.error)) || "Не удалось завести событие";
    say(msgId, text, "err");
  }

  function num(id) {
    var v = el(id) ? String(el(id).value).trim() : "";
    if (v === "") return null;
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : null;
  }

  function str(id) { return el(id) ? String(el(id).value).trim() : ""; }

  /* date_start в форме только показывается: поле недоступно для правки, а реальную
     метку ставит сервер в момент вставки. Держать здесь значение, набранное при
     открытии раздела, нельзя — форму заполняют и по десять минут, и в t_launch_settings
     уехало бы время открытия страницы, а не время заведения события. */
  function stampNow(id) {
    var node = el(id);
    if (!node) return;
    var d = new Date();
    function p2(n) { return (n < 10 ? "0" : "") + n; }
    node.value = d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) +
                 "T" + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds());
  }
  function chk(id) { return !!(el(id) && el(id).checked); }

  // ============================================================ ОНЛАЙН-СОБЫТИЕ

  function initOnline() {
    if (inited.online) return;
    inited.online = true;

    el("evoSubmit").onclick = submitOnline;
    el("evoReset").onclick = function () { resetOnline(); };
    gateSubmit("evoSubmit", "ev-online");

    dictionaries().then(function (d) {
      fillSelect(el("evoChannel"), d.notifyChannels);
      fillSelect(el("evoDefKey"), d.definitionKeys);
      fillSelect(el("evoPrefix"), d.businessKeyPrefixes);
      fillSelect(el("evoSystem"), d.systems);
      fillOptions(el("evoComm"), d.commCreations, "id", function (c) {
        /* подпись собираем из параметров: по одному id набор не опознать */
        return "#" + c.id + " · " + (c.notify_channel || "—") +
               " · delay " + (c.send_delay == null ? "—" : c.send_delay) +
               " · lifetime " + (c.lifetime == null ? "—" : c.lifetime);
      });
    }).catch(function (e) { fail("evoMsg", e); });
  }

  function resetOnline() {
    ["evoName", "evoSource", "evoTemplate"].forEach(function (id) {
      if (el(id)) el(id).value = id === "evoTemplate" ? "0" : "";
    });
    ["evoChannel", "evoDefKey", "evoPrefix", "evoSystem", "evoComm"].forEach(function (id) {
      if (el(id)) el(id).value = "";
    });
    if (el("evoActive")) el("evoActive").checked = false;
    say("evoMsg", "");
    renderResult("evoResult", null);
  }

  /* Кнопка называется «Запустить коммуникацию», и запуск — это две вещи: событие
     заведено у нас И уехало в crmdb. Первая всегда состоялась, вторая может не
     состояться, поэтому в строке ответа они разделены: «заведено и переливается» против
     «заведено, но в прод не уехало — вот почему». Молчаливое «заведено» после неудачного
     перелива читалось бы как «всё готово», а коммуникации в боевой базе не было бы. */
  function startedText(res) {
    var head = "Событие «" + res.eventName + "» заведено (id " + res.eventId + ")";
    var ex = res && res.export;
    if (!ex) return head;
    if (ex.status === "ok") return head + " и перелито в прод-БД";
    if (ex.status === "skipped") return head + ", но в прод не уехало: " + (ex.reason || "перелив не выполнен");
    return head + ", но перелив не удался: " + (ex.reason || "неизвестная ошибка") +
      ". Повторить можно в разделе «Перелив событий».";
  }
  function startedKind(res) {
    var ex = res && res.export;
    if (!ex || ex.status === "ok") return "ok";
    return ex.status === "error" ? "err" : "warn";
  }

  function submitOnline() {
    say("evoMsg", "Сохраняем…");
    renderResult("evoResult", null);
    var body = {
      eventName: str("evoName"),
      source: str("evoSource"),
      notifyChannel: str("evoChannel"),
      definitionKey: str("evoDefKey"),
      businessKeyPrefix: str("evoPrefix"),
      templateId: num("evoTemplate"),
      system: str("evoSystem"),
      isActive: chk("evoActive"),
      isBatch: false,
      idCommCreation: num("evoComm")
    };
    evReq("POST", "/online", body).then(function (res) {
      say("evoMsg", startedText(res), startedKind(res));
      renderResult("evoResult", res);
      /* Имя события уникально вместе с системой — очищаем поле, чтобы повторное
         нажатие не упёрлось в «уже заведено». Остальное оставляем: соседнее событие
         обычно отличается одним-двумя полями. */
      if (el("evoName")) el("evoName").value = "";
    }).catch(function (e) { fail("evoMsg", e); });
  }

  // =================================================== СОБЫТИЕ ПО РАСПИСАНИЮ

  /* Мастер из пяти экранов вместо одной длинной формы.
     Одностраничная версия повторяла Appsmith: девять полей, кронтаб строкой и блоки SQL
     сразу все — и человек, заводящий событие впервые, не понимал, что из этого во что
     превращается. Экраны идут в том порядке, в каком строится сама выборка: настройки →
     отбор общей базы → дни и шаблоны → итоговый скрипт → отправка.

     Между экранами нельзя пройти вперёд с незаполненным обязательным полем, но НАЗАД и
     по вкладкам — можно всегда: запирать человека на экране, пока он не угадает, чего от
     него хотят, хуже, чем показать ошибку.

     Пятый экран отладочный: собирает тело запроса и показывает его целиком, НЕ ОТПРАВЛЯЯ
     (см. submitOffline — там одна строка с пометкой, как включить отправку обратно). */

  var WZ_LAST = 5;
  var wzStep = 1;

  /* Метод отправки. По умолчанию массовый — так стояла старая форма (галка is_batch
     приходила включённой), и событие по расписанию массовым чаще и бывает.
     Списки приезжают вместе со справочниками; до этого момента переключатель работает,
     но выпадашки пусты — заполнить их нечем, и подставлять «известные» значения из
     кода значило бы разойтись с сервером. */
  var evfMethod = "batch";
  var evfLists = null;

  var METHOD_NOTE = {
    batch: "Массовая отправка: одним запуском уходит вся выборка.",
    single: "Единичная отправка: на каждого человека свой вызов. Флаг is_batch не" +
            " спрашивается — у этого метода он всегда выключен."
  };

  /* Дни недели: код для Quartz и слово для подписи. Порядок — с понедельника, как в
     календаре, а не с воскресенья, как в самом Quartz. */
  var DOWS = [
    ["MON", "пн", "понедельникам"], ["TUE", "вт", "вторникам"], ["WED", "ср", "средам"],
    ["THU", "чт", "четвергам"], ["FRI", "пт", "пятницам"], ["SAT", "сб", "субботам"],
    ["SUN", "вс", "воскресеньям"]
  ];

  function initOffline() {
    if (inited.offline) return;
    inited.offline = true;

    el("evfSubmit").onclick = submitOffline;
    el("evfReset").onclick = function () { resetOffline(); };
    el("evfNext").onclick = function () { if (wzValidate(wzStep)) wzGo(wzStep + 1); };
    el("evfBack").onclick = function () { wzGo(wzStep - 1); };
    el("evfStepCount").oninput = renderSteps;
    el("evfScriptGen").onclick = function () {
      el("evfScript").value = buildScript();
      /* Пересобрали по просьбе человека — значит правки он отдал сам, и метку
         «правлено руками» снимаем: иначе скрипт больше никогда не обновился бы. */
      el("evfScript").removeAttribute("data-touched");
      say("evfMsg", "Скрипт собран заново");
    };
    el("evfScript").oninput = function () { this.setAttribute("data-touched", "1"); };
    document.querySelectorAll("#evfTabs .wz-tab").forEach(function (b) {
      b.onclick = function () { wzGo(parseInt(b.getAttribute("data-wz"), 10)); };
    });
    document.querySelectorAll("#evfMode .wz-mode-btn").forEach(function (b) {
      b.onclick = function () {
        evfMethod = b.getAttribute("data-method");
        applyMethod();
      };
    });

    /* Расписание пересобирается на любое изменение своих полей: выражение под ними —
       не «результат нажатия кнопки», а отражение того, что сейчас выбрано. */
    ["evfTime", "evfFreq", "evfEvery", "evfDom"].forEach(function (id) {
      if (el(id)) el(id).oninput = el(id).onchange = renderCron;
    });
    document.querySelectorAll("#evfDowBox [data-dow]").forEach(function (c) {
      c.onchange = renderCron;
    });
    el("evfCronManual").onchange = function () {
      var manual = el("evfCronManual").checked;
      el("evfCrontab").readOnly = !manual;
      if (manual) { el("evfCrontab").focus(); } else { renderCron(); }
      renderCronWords();
    };
    el("evfCrontab").oninput = renderCronWords;
    /* Третий экран показывает одно из двух, и решает это флаг с первого. Перерисовываем
       сразу по переключению, а не при переходе на экран: человек ставит галку и тут же
       хочет видеть, что изменилось. */
    if (el("evfChain")) el("evfChain").onchange = applyChainMode;
    if (el("evfPromo")) el("evfPromo").onchange = applyPromoMode;

    /* Окно с планом закрывается всеми привычными способами: крестиком, кнопкой, кликом
       по фону и Escape. Слушатель на документ висит один и проверяет класс — вешать его
       на карточку нельзя, фокус после открытия уходит на крестик. */
    el("evfPlanClose").onclick = closePlan;
    el("evfPlanOk").onclick = closePlan;
    el("evfPlanGo").onclick = function () { sendOffline(); };
    el("evfPlanModal").onclick = function (e) {
      if (e.target === el("evfPlanModal")) closePlan();
    };
    document.addEventListener("keydown", function (e) {
      var m = el("evfPlanModal");
      if (e.key === "Escape" && m && m.classList.contains("open")) closePlan();
    });

    /* Кнопка сейчас только собирает план и показывает его — на сервер не уходит ничего,
       и права на заведение для предпросмотра не нужны. Проверку не снимаем, а переносим
       в submitOffline, к закомментированной боевой отправке: включат её — вернётся и
       запрет. Подпись остаётся, чтобы человек не ждал от кнопки заведения события. */
    renderSteps();
    renderFormTemplates([]);
    applyChainMode();
    stampNow("evfDateStart");
    renderCron();
    wzGo(1);

    dictionaries().then(function (d) {
      /* Узкие списки — это форма единичного метода: четыре пары ключ/префикс, как в
         старой админке. Откат на общие оставлен на случай пустого ответа старого
         сервера: форма без выпадашек хуже формы с длинными. */
      evfLists = methodLists(d);
      applyMethod();
      /* Умолчания — то, что стоит почти в каждом событии: система MPK, выборка из
         greenplum. Списки остаются полными, менять никто не мешает; смысл только в том,
         чтобы не выбирать одно и то же руками по десятому разу. Если значения в
         справочнике вдруг нет, поле просто остаётся пустым — дописывать его в список
         неоткуда, на database в базе висит внешний ключ. */
      fillSelect(el("evfSystem"), d.systems);
      if (el("evfSystem") && (d.systems || []).indexOf("MPK") >= 0) {
        el("evfSystem").value = "MPK";
      }
      /* Базы — из справочника flow.d_database: на колонке database висит внешний ключ,
         и значение вне справочника упало бы уже на вставке. */
      fillSelect(el("evfDatabase"), d.databases, "Select option");
      if (el("evfDatabase") && (d.databases || []).indexOf("greenplum") >= 0) {
        el("evfDatabase").value = "greenplum";
      }
    }).catch(function (e) { fail("evfMsg", e); });
  }

  /* Раскладка строк справочника reference.d_channel_process по методам.

     Канал берём из тех же строк только для массового метода: массовая отправка есть
     у email, push и sms, а vk, кц и робот массовыми не бывают — предлагать их значило бы
     показывать заведомо нерабочее. У единичного метода канал остаётся полным списком:
     пара ключ/префикс заведена не для всех каналов, но событие в них заводят.

     Пустой справочник — не повод остаться без формы: откатываемся на общие списки
     сервера, только без парности (связать их между собой нечем). */
  function methodLists(d) {
    var rows = d.channelProcesses || [];
    var out = {};
    ["batch", "single"].forEach(function (m) {
      var mine = rows.filter(function (r) { return r.method === m; });
      out[m] = mine.length
        ? { rows: mine,
            keys: mine.map(function (r) { return r.definitionKey; }),
            prefs: mine.map(function (r) { return r.businessKeyPrefix; }),
            channels: m === "batch" ? uniq(mine.map(function (r) { return r.notifyChannel; }))
                                    : d.notifyChannels }
        /* Откат на общие списки: строк нет, значит и связи «канал → пара» нет —
           поля остаются на ручной выбор. */
        : { rows: [], keys: d.definitionKeys, prefs: d.businessKeyPrefixes,
            channels: d.notifyChannels };
    });
    return out;
  }

  function uniq(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (v) {
      if (v != null && !seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out;
  }

  /* Переключение метода. Сбрасываются ровно два поля — ключ и префикс: их значения у
     методов разные, и оставленный от массового batchSmsChannelProcess2024 в единичной
     форме прошёл бы все проверки и не отправил ничего. Остальное заполненное трогать
     незачем, метод часто уточняют уже по ходу. */
  function applyMethod() {
    document.querySelectorAll("#evfMode .wz-mode-btn").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-method") === evfMethod);
    });
    if (el("evfModeNote")) el("evfModeNote").textContent = METHOD_NOTE[evfMethod] || "";
    /* is_batch не спрашиваем, а показываем: он и есть выбранный метод — включён у
       массового, выключен у единичного. Редактируемым он был лишним поводом собрать
       событие, которое противоречит само себе: массовый метод со снятой галкой уезжал
       в прод как единичный, а форма при этом продолжала предлагать батчевые ключи. */
    var batch = evfMethod === "batch";
    if (el("evfBatch")) {
      el("evfBatch").checked = batch;
      el("evfBatch").disabled = true;
    }
    if (el("evfBatchHint")) {
      el("evfBatchHint").textContent = batch
        ? "включён: массовый метод отправки"
        : "выключен: единичный метод отправки";
    }
    /* Промо — свойство массовой рассылки. Уходя на единичный метод, галку снимаем, а не
       просто прячем: невидимый флаг, продолжающий выкидывать итоговый скрипт, — ровно
       та ошибка, которую потом ищут по пустой выборке. */
    if (el("evfPromoBox")) el("evfPromoBox").hidden = !batch;
    if (!batch && el("evfPromo")) el("evfPromo").checked = false;
    applyPromoMode();
    if (!evfLists) return;
    var L = evfLists[evfMethod];
    /* Канал перезаполняем вместе с парами: у массового метода их всего три, и
       оставленный от единичного VK висел бы выбранным в списке, где его больше нет. */
    var channel = str("evfChannel");
    fillSelect(el("evfChannel"), L.channels);
    if (channel && (L.channels || []).indexOf(channel) >= 0) el("evfChannel").value = channel;
    fillSelect(el("evfDefKey"), L.keys);
    fillSelect(el("evfPrefix"), L.prefs);
    bindKeyPrefixPair(L.keys, L.prefs);
    /* Смена метода меняет и набор пар: выбранный канал переносится, а ключ с префиксом
       подставляются заново — от прежнего метода они не годятся. */
    if (el("evfChannel")) el("evfChannel").onchange = applyChannelPair;
    applyChannelPair();
  }

  /* Канал ведёт за собой пару ключ/префикс.

     В reference.d_channel_process канал, ключ и префикс лежат одной строкой, и после
     выбора канала выбирать из чего-то ещё уже нечего: у метода на канал приходится
     ровно одна пара. Раньше их выбирали руками двумя списками подряд, хотя первый же
     выбор их и определял.

     Строки для канала может не быть: у единичного метода список каналов полный
     (событие заводят и в те, для которых пара ещё не заведена). Тогда не трогаем
     ничего — подставленная от другого канала пара заведётся без ошибки и молча не
     отправит ни одной коммуникации. Оба поля остаются доступными для правки руками. */
  function applyChannelPair() {
    var rows = (evfLists && evfLists[evfMethod] && evfLists[evfMethod].rows) || [];
    var ch = str("evfChannel");
    if (!ch) return;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].notifyChannel === ch) {
        pickOption(el("evfDefKey"), rows[i].definitionKey);
        pickOption(el("evfPrefix"), rows[i].businessKeyPrefix);
        return;
      }
    }
  }

  /* Выбрать значение в списке, дописав его, если такого пункта нет. Списки собираются
     из тех же строк справочника, так что обычно пункт на месте; страховка — на случай
     общих списков в откате, где префикса из справочника может не оказаться. */
  function pickOption(node, value) {
    if (!node || value == null || value === "") return;
    var has = false;
    for (var i = 0; i < node.options.length; i++) {
      if (node.options[i].value === value) { has = true; break; }
    }
    if (!has) {
      var o = document.createElement("option");
      o.value = value;
      o.textContent = value;
      node.appendChild(o);
    }
    node.value = value;
  }

  /* Ключ и префикс — пара: smsChannelProcessV2 живёт только вместе с SmsChannel.
     Раньше их выбирали двумя независимыми списками, и промах во втором давал событие,
     которое заводится без ошибки, а коммуникации не порождает — искать такое приходится
     по факту молчания рассылки.

     Связь позиционная: сервер отдаёт оба списка одной длины и в одном порядке. Если
     они почему-то разошлись, парность просто не включаем — молча подставлять чужой
     префикс хуже, чем не подставлять ничего. Поле остаётся доступным: пара для канала,
     которого ещё нет в списках, задаётся руками. */
  function bindKeyPrefixPair(keys, prefs) {
    var k = el("evfDefKey"), p = el("evfPrefix");
    if (!k || !p || !keys || !prefs || keys.length !== prefs.length) return;
    k.onchange = function () {
      var i = keys.indexOf(k.value);
      p.value = i >= 0 ? prefs[i] : "";
    };
  }

  // ------------------------------------------------------------ переключение экранов

  function wzGo(n) {
    n = Math.max(1, Math.min(WZ_LAST, n));
    /* Четвёртого экрана у промо-события нет: перешагиваем его в ту сторону, в которую
       шли, — иначе «Далее» с третьего упиралось бы в пустую страницу, а «Назад» с
       пятого возвращало бы на неё же. */
    if (n === 4 && isPromo()) n = wzStep >= 4 ? 3 : 5;
    wzStep = n;
    for (var i = 1; i <= WZ_LAST; i++) {
      var pane = el("evfPane" + i);
      if (pane) pane.hidden = i !== n;
    }
    document.querySelectorAll("#evfTabs .wz-tab").forEach(function (b) {
      b.classList.toggle("on", parseInt(b.getAttribute("data-wz"), 10) === n);
    });
    el("evfBack").hidden = n === 1;
    el("evfNext").hidden = n === WZ_LAST;
    el("evfSubmit").hidden = n !== WZ_LAST;
    /* Итоговый скрипт пересобираем при входе на четвёртый экран, но только пока его не
       трогали руками: иначе поправленный запрос затирался бы каждым «Назад — Далее». */
    if (n === 4 && !el("evfScript").getAttribute("data-touched")) {
      el("evfScript").value = buildScript();
    }
    say("evfMsg", "");
  }

  /* Что обязано быть заполнено, чтобы идти дальше. Проверяем ровно то, без чего
     следующий экран бессмыслен, а не всё подряд: имя события нужно серверу, но на
     втором экране оно ни на что не влияет. */
  function wzValidate(n) {
    /* У промо четвёртый экран выключен — проверять на нём нечего. */
    if (n === 4 && isPromo()) return true;
    if (n === 1) {
      if (!str("evfName")) return wzFail("Не заполнено имя события (event_name)");
      if (!str("evfChannel")) return wzFail("Не выбран канал (notify_channel)");
      if (!str("evfDatabase")) return wzFail("Не выбрана база выборки (database)");
      var cron = validateCron(str("evfCrontab"));
      if (!cron.ok) return wzFail("Расписание: " + cron.error);
      if (str("evfFreq") === "dow" && !selectedDows().length) {
        return wzFail("Выбраны дни недели, но ни один день не отмечен");
      }
      return true;
    }
    if (n === 2) {
      var steps = collectSteps();
      if (!steps.length || steps.some(function (s) { return !s.sql; })) {
        return wzFail("У каждого шага отбора должен быть SQL");
      }
      if (!isPromo() && !str("evfFinalTable")) {
        return wzFail("Не указана итоговая таблица — из неё читает итоговый скрипт");
      }
      return true;
    }
    if (n === 3) {
      var tpl = collectFormTemplates();
      if (!tpl.length) {
        return wzFail(isChain() ? "Не задано ни одного шаблона" : "Не указан код шаблона");
      }
      if (!isChain()) {
        if (!isFinite(tpl[0].code)) return wzFail("Код шаблона — не число");
        return true;
      }
      var days = {};
      for (var i = 0; i < tpl.length; i++) {
        var d = tpl[i].stepNo;
        if (d == null) return wzFail("У цепочки каждому шаблону нужен свой день");
        if (days[d]) return wzFail("День " + d + " указан дважды");
        days[d] = true;
      }
      return true;
    }
    if (n === 4) {
      if (!String(el("evfScript").value || "").trim()) return wzFail("Итоговый скрипт пуст");
      return true;
    }
    return true;
  }

  function wzFail(text) {
    say("evfMsg", text, "err");
    return false;
  }

  // ------------------------------------------------------------------- расписание

  function pad2(v) {
    var n = parseInt(v, 10);
    if (!isFinite(n) || n < 0) n = 0;
    return (n < 10 ? "0" : "") + n;
  }

  /* Время из <input type=time>. Секунды браузер отдаёт не всегда — при пустом поле
     считаем нулём, иначе в выражение уехало бы NaN. */
  function cronTime() {
    var parts = String((el("evfTime") && el("evfTime").value) || "09:00:00").split(":");
    /* Два написания одного и того же: в выражение уходит число без ведущего нуля
       («0 0 9 * * ?» — как в прод-скриптах), в подпись — с нулём, как на часах. */
    return {
      h: n0(parts[0]), m: n0(parts[1]), s: n0(parts[2] || "0"),
      hh: pad2(parts[0]), mm: pad2(parts[1]), ss: pad2(parts[2] || "0")
    };
  }

  function n0(v) {
    var n = parseInt(v, 10);
    return String(isFinite(n) && n > 0 ? n : 0);
  }

  function selectedDows() {
    var out = [];
    document.querySelectorAll("#evfDowBox [data-dow]").forEach(function (c) {
      if (c.checked) out.push(c.getAttribute("data-dow"));
    });
    return out;
  }

  function everyN() {
    var n = parseInt(el("evfEvery") && el("evfEvery").value, 10);
    return isFinite(n) && n > 0 ? n : 1;
  }

  /* Выражение шестипольное: секунды минуты часы день-месяца месяц день-недели.
     В последних двух полях ровно одно должно быть «?» — Quartz не даёт задать оба
     сразу, и именно на этом чаще всего спотыкаются, когда пишут выражение руками. */
  function buildCron() {
    var t = cronTime();
    var freq = str("evfFreq");
    var n = everyN();
    var dows = selectedDows();
    var dom = parseInt(el("evfDom") && el("evfDom").value, 10) || 1;
    var hm = t.hh + ":" + t.mm + (t.ss === "00" ? "" : ":" + t.ss);

    if (freq === "everyNDays") {
      return { expr: [t.s, t.m, t.h, "1/" + n, "*", "?"].join(" "),
               words: "каждые " + n + " " + plural(n, "день", "дня", "дней") + " в " + hm };
    }
    if (freq === "weekdays") {
      return { expr: [t.s, t.m, t.h, "?", "*", "MON-FRI"].join(" "),
               words: "по будням в " + hm };
    }
    if (freq === "dow") {
      if (!dows.length) return { expr: "", words: "не отмечен ни один день недели" };
      var names = dows.map(function (d) {
        for (var i = 0; i < DOWS.length; i++) { if (DOWS[i][0] === d) return DOWS[i][2]; }
        return d;
      });
      return { expr: [t.s, t.m, t.h, "?", "*", dows.join(",")].join(" "),
               words: "по " + names.join(", ") + " в " + hm };
    }
    if (freq === "monthly") {
      return { expr: [t.s, t.m, t.h, String(dom), "*", "?"].join(" "),
               words: dom + "-го числа каждого месяца в " + hm };
    }
    if (freq === "everyNHours") {
      return { expr: [t.s, t.m, t.h + "/" + n, "*", "*", "?"].join(" "),
               words: "каждые " + n + " " + plural(n, "час", "часа", "часов") +
                      ", начиная с " + t.hh + ":" + t.mm };
    }
    if (freq === "everyNMinutes") {
      return { expr: [t.s, t.m + "/" + n, "*", "*", "*", "?"].join(" "),
               words: "каждые " + n + " " + plural(n, "минуту", "минуты", "минут") +
                      ", начиная с :" + t.mm };
    }
    return { expr: [t.s, t.m, t.h, "*", "*", "?"].join(" "), words: "каждый день в " + hm };
  }

  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  /* Единица измерения и потолок для поля «повторять каждые». Одна подпись на три
     случая («через сколько повторять») не говорила, в чём считать, а общая граница в
     59 пропускала «каждые 31 час» — такого расписания не бывает. */
  var EVERY_UNITS = {
    everyNDays:    { word: "дней",  max: 31 },
    everyNHours:   { word: "часов", max: 23 },
    everyNMinutes: { word: "минут", max: 59 }
  };

  // ------------------------------------------------------- проверка и разбор выражения

  /* Месяцы и дни недели планировщик принимает и числами, и словами. Держим оба списка:
     собственный построитель пишет словами, а руками вписывают как придётся. */
  var MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                     "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  var DOW_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

  /** Позиции полей — чтобы в сообщениях называть поле человеческим словом. */
  var CRON_FIELDS = [
    { name: "секунды", min: 0, max: 59 },
    { name: "минуты", min: 0, max: 59 },
    { name: "часы", min: 0, max: 23 },
    { name: "день месяца", min: 1, max: 31 },
    { name: "месяц", min: 1, max: 12, names: MONTH_NAMES },
    { name: "день недели", min: 1, max: 7, names: DOW_NAMES }
  ];

  function tokenOk(t, f) {
    if (t === "") return false;
    if (/^\d+$/.test(t)) {
      var n = parseInt(t, 10);
      return n >= f.min && n <= f.max;
    }
    return !!(f.names && f.names.indexOf(t.toUpperCase()) >= 0);
  }

  /** Одно поле: `*`, `?`, число, список `a,b`, диапазон `a-b`, шаг `a/b` — и их сочетания. */
  function fieldOk(v, f) {
    if (v === "*" || v === "?") return true;
    return v.split(",").every(function (part) {
      var step = part.split("/");
      if (step.length > 2) return false;
      if (step.length === 2 && !/^\d+$/.test(step[1])) return false;
      var base = step[0];
      if (base === "*") return true;
      var range = base.split("-");
      if (range.length > 2) return false;
      return range.every(function (x) { return tokenOk(x, f); });
    });
  }

  /**
   * Проверка выражения.
   * <p>
   * Проверяем ровно то, на чём спотыкаются: число полей, диапазоны и правило «в дне
   * месяца и дне недели ровно одно из двух — знак вопроса». Последнее в Quartz
   * обязательно, и именно его чаще всего нарушают, переписывая пятипольный кронтаб.
   * <p>
   * Расширенный синтаксис (L, W, #, LW) не разбираем, но и не запрещаем: он законный, а
   * панель его просто не умеет показать полями. Говорим об этом словами и пропускаем —
   * запрещать то, что планировщик примет, мы не вправе.
   */
  function validateCron(expr) {
    var v = String(expr == null ? "" : expr).trim().replace(/\s+/g, " ");
    if (!v) return { ok: false, error: "Выражение пустое" };
    var p = v.split(" ");
    if (p.length !== 6 && p.length !== 7) {
      return { ok: false, error: "Полей должно быть шесть (секунды минуты часы день-месяца"
             + " месяц день-недели), а их " + p.length };
    }
    /* Имена месяцев и дней вырезаем перед проверкой: в WED есть W, в JUL — L, и без
       этого «по средам» объявлялось расширенным синтаксисом. Ищем именно спецсимволы
       Quartz, а не буквы, которые на них похожи. */
    var stripped = v.replace(
        /(SUN|MON|TUE|WED|THU|FRI|SAT|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/gi, "");
    if (/[LW#]/i.test(stripped)) {
      return { ok: true, loose: true, parts: p,
               note: "расширенный синтаксис (L, W, #) — проверить полями не могу" };
    }
    for (var i = 0; i < 6; i++) {
      if (!fieldOk(p[i], CRON_FIELDS[i])) {
        return { ok: false, error: "Поле «" + CRON_FIELDS[i].name + "»: «" + p[i]
                 + "» не подходит (допустимо " + CRON_FIELDS[i].min + "–" + CRON_FIELDS[i].max
                 + (CRON_FIELDS[i].names ? ", либо " + CRON_FIELDS[i].names.join("/") : "")
                 + ", а также *, ?, списки, диапазоны и шаг)" };
      }
    }
    var dom = p[3], dow = p[5];
    var q = (dom === "?" ? 1 : 0) + (dow === "?" ? 1 : 0);
    if (q === 0) {
      return { ok: false, error: "В полях «день месяца» и «день недели» ровно одно должно"
             + " быть «?» — планировщик не даёт задать оба сразу" };
    }
    if (q === 2) {
      return { ok: false, error: "«?» стоит и в дне месяца, и в дне недели — какой-то из"
             + " них должен быть задан" };
    }
    return { ok: true, parts: p };
  }

  /* Месяцы словами: родительный — для «1 сентября», предложный — для «в сентябре».
     Два падежа, потому что одной формой обе фразы не собрать. */
  var MONTHS = [
    ["JAN", "января", "январе"], ["FEB", "февраля", "феврале"], ["MAR", "марта", "марте"],
    ["APR", "апреля", "апреле"], ["MAY", "мая", "мае"], ["JUN", "июня", "июне"],
    ["JUL", "июля", "июле"], ["AUG", "августа", "августе"], ["SEP", "сентября", "сентябре"],
    ["OCT", "октября", "октябре"], ["NOV", "ноября", "ноябре"], ["DEC", "декабря", "декабре"]
  ];

  /**
   * Выражение → человеческая подпись, независимо от полей построителя.
   * <p>
   * Полей наверху меньше, чем умеет Quartz: месяца среди них нет вовсе, списки чисел и
   * диапазоны они тоже не изображают. Раньше на всём таком подпись пропадала целиком —
   * «полями не изобразить» и молчание, хотя прочитать выражение и сказать, что оно
   * значит, ничто не мешало. Поля и подпись — про разное: первое про то, чем это
   * набрать, второе про то, что получится.
   * <p>
   * Разбираем обычный синтаксис: числа, имена, списки, диапазоны и шаг. На расширенном
   * (L, W, #) и на всём, чего не поняли, возвращаем null — соврать в подписи хуже, чем
   * её не дать.
   *
   * @return строка или null
   */
  function describeCron(p) {
    var time = describeCronTime(p[0], p[1], p[2]);
    if (!time) return null;
    var days = describeCronDays(p[3], p[5], p[4]);
    if (!days) return null;
    var text = time.every
      ? time.text + (days.every ? "" : ", " + days.text)
      : days.text + " " + time.text;
    /* Седьмое поле (год) необязательное, построитель его не ставит. Если оно есть и
       чем-то ограничено — говорим, но отдельным хвостом: в основную фразу оно не
       вписывается ни в одном падеже. */
    if (p.length === 7 && p[6] !== "*" && p[6] !== "?") text += " (год: " + p[6] + ")";
    return text;
  }

  /** Время суток. {text, every}: every — повторяется внутри суток. */
  function describeCronTime(sec, min, hour) {
    var plain = function (x) { return /^[0-9]+$/.test(x); };
    var num = function (x) { return parseInt(x, 10); };
    var mStep = min.match(/^([0-9]+)\/([0-9]+)$/);
    if (mStep && hour === "*" && plain(sec)) {
      return { every: true, text: "каждые " + num(mStep[2]) + " "
        + plural(num(mStep[2]), "минуту", "минуты", "минут")
        + ", начиная с :" + pad2(mStep[1]) };
    }
    var hStep = hour.match(/^([0-9]+)\/([0-9]+)$/);
    if (hStep && plain(min) && plain(sec)) {
      return { every: true, text: "каждые " + num(hStep[2]) + " "
        + plural(num(hStep[2]), "час", "часа", "часов")
        + ", начиная с " + pad2(hStep[1]) + ":" + pad2(min) };
    }
    if (!plain(min) || !plain(sec)) return null;
    if (hour === "*") {
      return { every: true, text: "каждый час в :" + pad2(min)
        + (num(sec) ? ":" + pad2(sec) : "") };
    }
    if (!plain(hour)) return null;
    return { every: false, text: "в " + pad2(hour) + ":" + pad2(min)
      + (num(sec) ? ":" + pad2(sec) : "") };
  }

  /**
   * Дни месяца, дни недели и месяцы одной фразой.
   *
   * @return {text, every} либо null; every — «без ограничения по дням»
   */
  function describeCronDays(dom, dow, mon) {
    var months = mon === "*" || mon === "?" ? [] : cronValues(mon, MONTH_NAMES, 1);
    if (months === null || months.length > 12) return null;
    if (months.some(function (m) { return m < 1 || m > 12; })) return null;
    var inMonths = months.length
      ? " в " + months.map(function (m) { return MONTHS[m - 1][2]; }).join(" и ")
      : "";

    /* Одно число одного месяца — привычная дата: «1 сентября», а не «1-го числа в
       сентябре». Ровно тот случай, на котором подпись и пропадала. */
    if (/^[0-9]+$/.test(dom) && dow === "?" && months.length === 1) {
      return { every: false, text: parseInt(dom, 10) + " " + MONTHS[months[0] - 1][1] };
    }

    var dStep = dom.match(/^([0-9]+)\/([0-9]+)$/);
    if (dStep && dow === "?") {
      var n = parseInt(dStep[2], 10);
      var from = parseInt(dStep[1], 10);
      return { every: false, text: "каждые " + n + " " + plural(n, "день", "дня", "дней")
        + (from > 1 ? ", начиная с " + from + "-го" : "") + inMonths };
    }
    if (dom === "*" && dow === "?") {
      return { every: !inMonths, text: "каждый день" + inMonths };
    }
    if (dow === "?") {
      var days = cronValues(dom, null, 0);
      if (!days || !days.length || days.length > 8) return null;
      if (days.some(function (d) { return d < 1 || d > 31; })) return null;
      return { every: false, text: days.map(function (d) { return d + "-го"; }).join(", ")
        + " числа" + inMonths };
    }
    if (dom === "?") {
      if (dow.toUpperCase() === "MON-FRI") {
        return { every: false, text: "по будням" + inMonths };
      }
      /* В Quartz неделя начинается с воскресенья: 1 — SUN, 7 — SAT. */
      var nums = cronValues(dow, DOW_NAMES, 1);
      if (!nums || !nums.length || nums.some(function (d) { return d < 1 || d > 7; })) {
        return null;
      }
      var words = nums.map(function (d) {
        var code = DOW_NAMES[d - 1];
        for (var i = 0; i < DOWS.length; i++) { if (DOWS[i][0] === code) return DOWS[i][2]; }
        return code;
      });
      return { every: false, text: "по " + words.join(", ") + inMonths };
    }
    return null;
  }

  /**
   * Поле в список чисел: «9», «1,15», «1-5», «MON,WED». Шаг и звёздочку сюда не
   * отдаём — они описываются отдельно; не разобрали — null.
   *
   * @param names имена, если поле их допускает
   * @param base  какое число соответствует первому имени
   */
  function cronValues(v, names, base) {
    var out = [];
    var parts = String(v).split(",");
    for (var i = 0; i < parts.length; i++) {
      var r = parts[i].split("-");
      if (r.length > 2) return null;
      var a = cronValue(r[0], names, base);
      if (a === null) return null;
      if (r.length === 1) { out.push(a); continue; }
      var b = cronValue(r[1], names, base);
      if (b === null || b < a || b - a > 31) return null;
      for (var x = a; x <= b; x++) out.push(x);
    }
    return out;
  }

  function cronValue(t, names, base) {
    if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
    if (!names) return null;
    var i = names.indexOf(String(t).toUpperCase());
    return i < 0 ? null : i + base;
  }

  /**
   * Обратный разбор: выражение → поля построителя.
   * <p>
   * Узнаём только те формы, которые построитель сам и умеет собрать. Всё остальное —
   * законное выражение, которое полями не изобразить; тогда поля не трогаем и говорим об
   * этом. Подогнать их «примерно» значило бы показать расписание, которого нет.
   *
   * @return true, если форму узнали и поля обновлены
   */
  function syncFieldsFromCron(p) {
    var sec = p[0], min = p[1], hour = p[2], dom = p[3], mon = p[4], dow = p[5];
    if (mon !== "*") return false;                 // помесячных ограничений построитель не умеет
    var plain = function (x) { return /^\d+$/.test(x); };
    var setTime = function (h, m, sc) {
      if (el("evfTime")) el("evfTime").value = pad2(h) + ":" + pad2(m) + ":" + pad2(sc);
    };

    /* каждые N минут: M/N * * * ? */
    var mStep = min.match(/^(\d+)\/(\d+)$/);
    if (mStep && hour === "*" && dom === "*" && dow === "?" && plain(sec)) {
      setTime(0, mStep[1], sec);
      el("evfFreq").value = "everyNMinutes";
      el("evfEvery").value = mStep[2];
      return true;
    }
    /* каждые N часов: H/N * * ? */
    var hStep = hour.match(/^(\d+)\/(\d+)$/);
    if (hStep && plain(min) && dom === "*" && dow === "?" && plain(sec)) {
      setTime(hStep[1], min, sec);
      el("evfFreq").value = "everyNHours";
      el("evfEvery").value = hStep[2];
      return true;
    }
    if (!plain(sec) || !plain(min) || !plain(hour)) return false;
    setTime(hour, min, sec);

    /* каждые N дней: 1/N * ? */
    var dStep = dom.match(/^(\d+)\/(\d+)$/);
    if (dStep && dow === "?") {
      el("evfFreq").value = "everyNDays";
      el("evfEvery").value = dStep[2];
      return true;
    }
    /* каждый день */
    if (dom === "*" && dow === "?") {
      el("evfFreq").value = "daily";
      return true;
    }
    /* N-го числа */
    if (plain(dom) && dow === "?") {
      el("evfFreq").value = "monthly";
      el("evfDom").value = dom;
      return true;
    }
    /* по будням и по дням недели */
    if (dom === "?") {
      var want = dow.toUpperCase() === "MON-FRI"
        ? ["MON", "TUE", "WED", "THU", "FRI"]
        : (/^[A-Z,]+$/i.test(dow) ? dow.toUpperCase().split(",") : null);
      if (!want || want.some(function (d) { return DOW_NAMES.indexOf(d) < 0; })) return false;
      el("evfFreq").value = dow.toUpperCase() === "MON-FRI" ? "weekdays" : "dow";
      document.querySelectorAll("#evfDowBox [data-dow]").forEach(function (c) {
        c.checked = want.indexOf(c.getAttribute("data-dow")) >= 0;
      });
      return true;
    }
    return false;
  }

  /* Лишние поля прячем, а не выключаем: «N» при «каждый день» ничего не значит, и
     видимое неактивное поле человек всё равно пробует заполнить. */
  /* Подписи и границы полей частоты. Вынесено из renderCron отдельно: после ручной
     правки выражения поля переставляются, а само выражение перезаписывать нельзя —
     человек его только что набрал. */
  function applyEveryUnits() {
    var freq = str("evfFreq");
    var unit = EVERY_UNITS[freq];
    var needN = !!unit;
    if (el("evfEveryBox")) el("evfEveryBox").hidden = !needN;
    if (el("evfDomBox")) el("evfDomBox").hidden = freq !== "monthly";
    if (el("evfDowBox")) el("evfDowBox").hidden = freq !== "dow";
    if (needN && el("evfEvery")) {
      /* Подпись через проверку: при закешированном браузером index.html элемента с этим
         id ещё нет, и обращение к нему напрямую роняло бы весь renderCron — вместе с
         потолком поля и сборкой выражения. Внешне это выглядело бы как «правка не
         приехала», хотя приехала половина. */
      if (el("evfEveryLab")) el("evfEveryLab").textContent = "Повторять каждые … " + unit.word;
      el("evfEvery").max = unit.max;
      /* Значение, набранное для другой единицы, подрезаем: иначе после «каждые 31 день»
         переключение на часы оставило бы 31 в поле с потолком 23, и выражение ушло бы
         заведомо неисполнимое. */
      if ((parseInt(el("evfEvery").value, 10) || 1) > unit.max) el("evfEvery").value = unit.max;
    }
  }

  function renderCron() {
    applyEveryUnits();
    if (el("evfCronManual") && el("evfCronManual").checked) { renderCronWords(); return; }
    el("evfCrontab").value = buildCron().expr;
    renderCronWords();
  }

  function renderCronWords() {
    var box = el("evfCronWords");
    if (!box) return;
    if (el("evfCronManual") && el("evfCronManual").checked) {
      var v = validateCron(el("evfCrontab").value);
      box.classList.remove("bad", "ok");
      if (!v.ok) {
        box.textContent = v.error;
        box.classList.add("bad");
        return;
      }
      /* Разобрали форму — поля наверху перестраиваются под неё: человек правит строку и
         тут же видит, что он на самом деле задал. Не разобрали — поля не трогаем и
         говорим об этом: подогнать их «примерно» значило бы показать расписание,
         которого нет. */
      var known = !v.loose && syncFieldsFromCron(v.parts);
      if (known) {
        applyEveryUnits();
        box.textContent = "Понято как: " + buildCron().words;
        box.classList.add("ok");
      } else {
        /* Формы построитель не знает, но прочитать выражение это не мешает: подпись
           берём у описателя, а про поля говорим отдельно — они действительно остались
           от прежнего расписания, и человек должен видеть, что они уже не про это. */
        var words = v.loose ? null : describeCron(v.parts);
        if (words) {
          box.textContent = "Понято как: " + words
            + ". Полями наверху такое не набрать — они остались как были.";
          box.classList.add("ok");
        } else {
          box.textContent = "Выражение принимается" + (v.note ? ": " + v.note : "")
            + ". Полями наверху такое расписание не изобразить — они остались как были.";
        }
      }
      return;
    }
    box.textContent = buildCron().words + " · поля: секунды минуты часы день-месяца месяц день-недели";
  }

  // ------------------------------------------------------------- шаги отбора базы

  /* Блоки SQL-шагов по числу из счётчика. Уже введённый текст сохраняем: человек мог
     набрать три запроса и опечататься в счётчике.

     Галки «вернуть результат» здесь больше нет. Раньше её ставили руками, и результат
     мог возвращать любой шаг или сразу все. Теперь роль разделена жёстко: шаги отбора
     готовят общую базу и не возвращают ничего, а выборку отдаёт итоговый скрипт с
     четвёртого экрана — он и уходит последним шагом с returnsResultSet. */
  function renderSteps() {
    var box = el("evfSteps");
    if (!box) return;
    var want = Math.max(1, Math.min(20, parseInt(el("evfStepCount").value, 10) || 1));
    var kept = [], keptOrd = [];
    box.querySelectorAll("[data-step-sql]").forEach(function (t) { kept.push(t.value); });
    box.querySelectorAll("[data-step-ord]").forEach(function (t) { keptOrd.push(t.value); });

    var html = "";
    for (var i = 0; i < want; i++) {
      var n = i + 1;
      html +=
        '<div class="ev-sql">' +
          '<div class="h"><b>Шаг ' + n + " — отбор</b>" +
            (want > 1 ? '<button type="button" class="ev-mini" data-step-del="' + i + '">убрать</button>' : "") +
          "</div>" +
          '<div class="ev-fields">' +
            '<div class="ev-f wide"><label>SQL</label>' +
              '<textarea data-step-sql="' + i + '" spellcheck="false">' + esc(kept[i] || "") + "</textarea></div>" +
            '<div class="ev-f"><label>Порядковый номер</label>' +
              '<input type="number" data-step-ord="' + i + '" value="' +
                esc(keptOrd[i] || (n * 10)) + '" min="1" step="1"></div>' +
          "</div>" +
        "</div>";
    }
    box.innerHTML = html +
      '<div class="ev-edit-row"><button type="button" class="ev-mini" onclick="evfStepAdd()">+ шаг</button>' +
      '<span class="ev-edit-msg">шагов отбора: ' + want + "</span></div>";
    box.querySelectorAll("[data-step-del]").forEach(function (b) {
      b.onclick = function () { evfStepDrop(parseInt(b.getAttribute("data-step-del"), 10)); };
    });
  }

  /* Счётчик остаётся источником правды о числе блоков — кнопки просто крутят его и
     перерисовывают. Держать второе состояние рядом с ним значило бы однажды получить
     «в поле 3, на экране 4». */
  window.evfStepAdd = function () {
    var c = el("evfStepCount");
    c.value = Math.min(20, (parseInt(c.value, 10) || 1) + 1);
    renderSteps();
  };

  /** Убрать шаг: текст остальных сохраняем, сдвигая их на место удалённого. */
  window.evfStepDrop = function (idx) {
    var box = el("evfSteps");
    var c = el("evfStepCount");
    var count = parseInt(c.value, 10) || 1;
    if (count <= 1) { return; }   // последний шаг не убираем: выборка без шагов бессмысленна
    var sql = [], ord = [];
    box.querySelectorAll("[data-step-sql]").forEach(function (t) { sql.push(t.value); });
    box.querySelectorAll("[data-step-ord]").forEach(function (x) { ord.push(x.value); });
    sql.splice(idx, 1); ord.splice(idx, 1);
    c.value = count - 1;
    renderSteps();
    box.querySelectorAll("[data-step-sql]").forEach(function (t, i) { t.value = sql[i] || ""; });
    box.querySelectorAll("[data-step-ord]").forEach(function (x, i) { if (ord[i]) x.value = ord[i]; });
  }

  function collectSteps() {
    var box = el("evfSteps");
    var out = [];
    if (!box) return out;
    box.querySelectorAll("[data-step-sql]").forEach(function (t) {
      var i = t.getAttribute("data-step-sql");
      var ord = box.querySelector('[data-step-ord="' + i + '"]');
      out.push({
        sql: String(t.value || "").trim(),
        orderNum: ord ? (parseInt(ord.value, 10) || null) : null,
        returnsResultSet: false
      });
    });
    return out;
  }

  // ------------------------------------------------------------- дни и шаблоны

  /* Пара «день — шаблон». День идёт первым: список читают как расписание воронки
     («первый день — такой шаблон, третий — такой»), а не как перечень кодов. */
  function formTplRow(x) {
    x = x || {};
    return '<div class="ev-edit-tpl form" data-ftpl>' +
      '<input data-ftpl-step placeholder="день" value="' + esc(x.stepNo == null ? "" : x.stepNo) + '">' +
      '<input data-ftpl-code placeholder="код шаблона" value="' + esc(x.code == null ? "" : x.code) + '">' +
      '<span class="ev-edit-name"></span>' +
      '<button type="button" class="ev-mini" onclick="this.parentNode.remove()">✕</button>' +
      "</div>";
  }

  /** Цепочка это набор пар «день — шаблон», одиночная отправка — один шаблон. */
  function isChain() {
    return chk("evfChain");
  }

  /**
   * Промо-событие: выборку целиком делают шаги отбора, итогового скрипта нет.
   * <p>
   * Флаг только у массового метода. У единичного итоговый скрипт и есть вся выборка —
   * пропускать там нечего, и галка, оставшаяся от массового, молча выкинула бы из
   * события его единственный запрос. Поэтому смотрим и на метод, а не только на галку:
   * скрытое поле не должно ни на что влиять.
   */
  function isPromo() {
    return evfMethod === "batch" && chk("evfPromo");
  }

  /**
   * Показать форму такой, какая она при этом флаге.
   * <p>
   * Четвёртый экран не прячем «на всякий случай», а именно выключаем: при промо он не
   * участвует ни в переходах, ни в проверках, ни в теле запроса. Оставленная вкладка
   * приглашала бы заполнить поле, которое никуда не уедет.
   */
  function applyPromoMode() {
    var promo = isPromo();
    var tab = document.querySelector('#evfTabs .wz-tab[data-wz="4"]');
    if (tab) tab.hidden = promo;
    if (el("evfStepsNote")) {
      el("evfStepsNote").textContent = promo
        ? "Промо: в шаги события уедут только эти запросы, итогового скрипта не будет."
          + " Выборку отдаёт последний из них — у него returns_result_set = true."
        : "Выполняются планировщиком по порядку и готовят общую базу — тех, кто вообще"
          + " попадает в рассылку. Результат движку отдают не они, а итоговый скрипт с"
          + " четвёртого экрана: он уйдёт последним шагом и вернёт готовую выборку.";
    }
    /* Итоговая таблица нужна ровно затем, чтобы собрать из неё итоговый скрипт. Его
       нет — и спрашивать её незачем. */
    if (el("evfFinalBox")) el("evfFinalBox").hidden = promo;
    /* Стоим на выключенном экране — уходим с него, иначе человек остался бы на
       странице, которой в этом режиме нет. */
    if (promo && wzStep === 4) wzGo(3);
  }

  /**
   * Показать нужную половину третьего экрана.
   * <p>
   * Скрытую половину не очищаем: человек может переключить флаг туда-обратно, и терять
   * набранное из-за этого незачем. В запрос уходит только то, что относится к текущему
   * режиму — за это отвечает collectFormTemplates.
   */
  function applyChainMode() {
    var chain = isChain();
    if (el("evfChainBox")) el("evfChainBox").hidden = !chain;
    if (el("evfSingleBox")) el("evfSingleBox").hidden = chain;
    if (el("evfTplTitle")) el("evfTplTitle").textContent = chain ? "Дни и шаблоны" : "Шаблон";
    if (el("evfTplNote")) {
      el("evfTplNote").innerHTML = chain
        ? "Цепочка: на каждый день воронки свой шаблон. Из этих пар собирается <code>CASE</code>"
          + " в итоговом скрипте, они же уезжают в <code>template.d_template_mapping_mass</code>."
        : "Одиночная отправка: один шаблон на событие, дни не нужны. Маппинг уедет в"
          + " <code>template.d_template_mapping</code>. Нужны разные шаблоны по дням —"
          + " поставьте <b>is chain</b> на первом экране.";
    }
    /* Вкладку тоже переименовываем: по ней ориентируются, не открывая экран. */
    var tab = document.querySelector('#evfTabs [data-wz="3"]');
    if (tab) tab.innerHTML = "<b>3</b> " + (chain ? "Дни и шаблоны" : "Шаблон");
  }

  function renderFormTemplates(list) {
    var box = el("evfTemplates");
    if (!box) return;
    list = (list && list.length) ? list : [{}];
    box.innerHTML = list.map(formTplRow).join("");
  }

  window.evfTplAdd = function () {
    var box = el("evfTemplates");
    if (!box) return;
    var holder = document.createElement("div");
    holder.innerHTML = formTplRow({});
    box.appendChild(holder.firstChild);
  };

  /* Пустые строки не отправляем: одна такая всегда висит на экране как приглашение
     заполнить, и слать её как шаблон с пустым кодом значило бы ловить ошибку на сервере
     из-за того, что человек ничего не вписал. */
  function collectFormTemplates() {
    /* Одиночная отправка: один код, дня нет. stepNo = null — именно это отличает строку
       d_template_mapping от строки цепочки. */
    if (!isChain()) {
      var code = el("evfTplCode") ? String(el("evfTplCode").value || "").trim() : "";
      return code ? [{ code: parseInt(code, 10), stepNo: null }] : [];
    }
    var box = el("evfTemplates"), out = [];
    if (!box) return out;
    box.querySelectorAll("[data-ftpl]").forEach(function (d) {
      var code = String(d.querySelector("[data-ftpl-code]").value || "").trim();
      var step = String(d.querySelector("[data-ftpl-step]").value || "").trim();
      if (!code) return;
      out.push({ code: parseInt(code, 10), stepNo: step === "" ? null : parseInt(step, 10) });
    });
    return out;
  }

  // ------------------------------------------------------------- итоговый скрипт

  /* Тот самый запрос, результат которого читает движок: user_id, myb_id и template_id.
     Первые две колонки — обязательные, по ним движок находит человека; третья говорит,
     каким шаблоном ему писать. Раскладываем её из пар «день — шаблон»: в общей базе
     день уже проставлен, и CASE переводит его в код.

     Имя колонки template_id берём в кавычки намеренно — так оно записано в прод-скриптах,
     и выборка, скопированная отсюда в psql, ведёт себя ровно так же. */
  function buildScript() {
    var table = str("evfFinalTable") || "<итоговая таблица>";
    var dayCol = str("evfDayCol") || "day_num";
    var list = collectFormTemplates();
    var withDay = list.filter(function (t) { return t.stepNo != null; });

    if (!list.length) {
      return "SELECT user_id,\n" +
             "       myb_id,\n" +
             "       NULL::int AS \"template_id\"   -- шаблоны не заданы на третьем экране\n" +
             "  FROM " + table;
    }
    if (!withDay.length) {
      return "SELECT user_id,\n" +
             "       myb_id,\n" +
             "       " + list[0].code + " AS \"template_id\"\n" +
             "  FROM " + table;
    }
    var pad = 0;
    withDay.forEach(function (t) { pad = Math.max(pad, String(t.stepNo).length); });
    var whens = withDay.map(function (t) {
      var d = String(t.stepNo);
      while (d.length < pad) d = " " + d;
      return "            WHEN " + d + " THEN " + t.code;
    }).join("\n");
    var days = withDay.map(function (t) { return t.stepNo; }).join(", ");
    return "SELECT user_id,\n" +
           "       myb_id,\n" +
           "       CASE " + dayCol + "\n" +
           whens + "\n" +
           "       END AS \"template_id\"\n" +
           "  FROM " + table + "\n" +
           " WHERE " + dayCol + " IN (" + days + ")";
  }

  // ------------------------------------------------------------- сборка и отправка

  /* Тело запроса ровно в том виде, в каком его ждёт OfflineEventForm. Шаги отбора идут
     первыми и ничего не возвращают, последним добавляется итоговый скрипт с
     returnsResultSet — порядковый номер ему даём на десятку больше последнего, чтобы
     он оставался последним и после правки номеров руками. */
  function offlineBody() {
    var steps = collectSteps();
    var maxOrd = 0;
    steps.forEach(function (s) { maxOrd = Math.max(maxOrd, s.orderNum || 0); });
    if (isPromo()) {
      /* Промо: итогового скрипта нет вовсе, в шаги уходят только запросы второго
         экрана. Выборку тогда отдаёт последний из них — иначе ни один шаг не вернёт
         результат и рассылке нечего будет отправлять. */
      if (steps.length) steps[steps.length - 1].returnsResultSet = true;
      return offlineFields(steps);
    }
    /* Сервисное событие ничего не возвращает: движок не ждёт от него выборки, и
       returns_result_set у последнего шага должен стоять false. У обычной рассылки
       наоборот — именно последний шаг и отдаёт выборку. Шаги отбора не трогаем, они
       не возвращают ничего ни в том, ни в другом случае. */
    steps.push({
      sql: String(el("evfScript").value || "").trim(),
      orderNum: maxOrd + 10,
      returnsResultSet: !chk("evfService")
    });
    return offlineFields(steps);
  }

  /* Поля события; шаги приходят готовыми — их состав зависит от режима (см. offlineBody).
     is_promo серверу не отправляется: колонки такой нет ни у нас, ни в проде, а весь его
     смысл уже выражен составом шагов. В окне плана он показан отдельной строкой, чтобы
     человек видел, почему шагов на один меньше. */
  function offlineFields(steps) {
    return {
      /* selection не передаём: он равен имени события, и сервер подставит его сам —
         иначе форма несла бы два поля с одним и тем же значением. */
      eventName: str("evfName"),
      source: str("evfSource"),
      notifyChannel: str("evfChannel"),
      definitionKey: str("evfDefKey"),
      businessKeyPrefix: str("evfPrefix"),
      templates: collectFormTemplates(),
      system: str("evfSystem"),
      isActive: chk("evfActive"),
      /* Берём метод, а не галку: она теперь только его отражение, и читать состояние
         поля вместо источника значило бы однажды разойтись с ним. */
      isBatch: evfMethod === "batch",
      isChain: chk("evfChain"),
      database: str("evfDatabase"),
      crontab: str("evfCrontab"),
      steps: steps,
      /* Не для сервера, а для окна плана: оно строится из этого же тела. Поле уходит из
         запроса перед отправкой (sendOffline). */
      isPromo: isPromo()
    };
  }

  // ------------------------------------------------------------- план записи

  /* План считаем по форме, а не спрашиваем у сервера: запроса-то ещё не было. Поэтому он
     и подписан как ожидание — совпадение с реальными вставками проверяется ответом, когда
     отправку включат.

     Раскладка повторяет EventFormService.createOffline построчно и в том же порядке.
     Три вещи, ради которых план стоит читать целиком, а не считать строки:
     — слой B пишется через insertB, а он не перечисляет колонки со значением null: такие
       помечены как «колонки не будет». Пустая строка при этом остаётся значением —
       definition_key и business_key_prefix объявлены NOT NULL без DEFAULT;
     — колонка template_id в слое A и в прод-таблицах хранит РАЗНЫЕ числа: у нас
       суррогатный id единого справочника, в проде — тот код, что введён в форме;
     — selection форма не шлёт вовсе, сервер подставляет имя события; показываем уже
       подставленным, иначе в плане стояло бы «—» там, где в базу уедет имя. */

  var PLAN_AUTO = "auto";   // значение присвоит база или сервер, в форме его нет
  var PLAN_SKIP = "skip";   // insertB не перечислит колонку — уйдёт NULL или DEFAULT

  function pv(v) {
    if (v === true) return "true";
    if (v === false) return "false";
    if (v === null || v === undefined || String(v) === "") return "«пусто»";
    return String(v);
  }
  function col(c, v, note) { return { c: c, v: pv(v), n: note || "" }; }
  function colAuto(c, v, note) { return { c: c, v: v, k: PLAN_AUTO, n: note || "" }; }
  /* nn() на сервере превращает пустую строку в null, и колонка выпадает из запроса;
     соседний nz() пустую строку оставляет. Разница видна только здесь, в плане. */
  function colNn(c, v, note) {
    var s = String(v == null ? "" : v).trim();
    return s === "" ? { c: c, v: "колонки не будет", k: PLAN_SKIP, n: note || "" }
                    : { c: c, v: s, n: note || "" };
  }
  function nRow(n) {
    var t = n % 100, o = n % 10;
    if (t >= 11 && t <= 14) return n + " строк";
    if (o === 1) return n + " строка";
    if (o >= 2 && o <= 4) return n + " строки";
    return n + " строк";
  }

  function planGroups(body) {
    var steps = body.steps || [];
    var tpls = body.templates || [];
    var nSteps = steps.length;
    var nTpl = tpls.length;
    var sel = body.eventName;
    var mapping = body.isChain ? "template.d_template_mapping_mass" : "template.d_template_mapping";
    /* Номера шагов считаем ровно как orderNum() на сервере: свой, если задан, иначе
       (индекс + 1) * 10 — ORDER_STEP. */
    var ords = steps.map(function (s, i) {
      return (s.orderNum && s.orderNum > 0) ? s.orderNum : (i + 1) * 10;
    }).join(", ");
    var days = tpls.map(function (t) { return t.stepNo == null ? "—" : t.stepNo; }).join(", ");
    var codes = tpls.map(function (t) { return t.code; }).join(", ");
    /* Не общее правило, а то, что реально уходит: у сервисного события последний шаг
       тоже false, и «true у итогового» было бы неправдой в плане, который для того и
       читают, чтобы свериться. */
    var lastRrs = nSteps ? String(!!steps[nSteps - 1].returnsResultSet) : "true";
    var rrs = body.isPromo
      ? (nSteps > 1 ? "false у всех, кроме последнего шага отбора — у него true" : lastRrs)
      : (nSteps > 1 ? "false у шагов отбора, " + lastRrs + " у итогового" : lastRrs);
    var stepNote = body.isPromo
      ? "только шаги отбора: у промо итогового скрипта нет"
      : "шаги отбора + итоговый скрипт";
    // строки слоя B: событие + расписание + шаги + маппинги шаблонов + маппинг определения
    var bRows = 2 + nSteps + nTpl + 1;

    return [
      {
        title: "Слой A — наша модель",
        note: "Колонки перечисляются явно, пустая строка так и пишется пустой строкой.",
        tables: [
          { name: "flow.d_event", rows: 1, note: "само событие", cols: [
            colAuto("id", "RETURNING — станет event_id во всех строках ниже"),
            col("kind", "time", "у события по расписанию всегда time"),
            col("event_name", body.eventName),
            col("system", body.system),
            col("source", body.source),
            col("description", sel, "сюда уезжает selection")
          ].concat([col("is_active", body.isActive)]) },
          { name: "flow.d_event_delivery", rows: 1, note: "канал доставки", cols: [
            colAuto("event_id", "id события"),
            col("notify_channel", body.notifyChannel)
          ] },
          { name: "flow.d_event_schedule", rows: 1, note: "расписание", cols: [
            colAuto("event_id", "id события"),
            col("crontab", body.crontab),
            col("database", body.database, "внешний ключ на flow.d_database"),
            col("is_batch", body.isBatch)
          ] },
          { name: "flow.d_event_step", rows: nSteps, note: stepNote, cols: [
            colAuto("event_id", "id события"),
            col("order_num", ords, "по шагам, в порядке экрана «Шаги отбора»"),
            col("process_name", sel),
            colAuto("sql_text", "SQL каждого шага"),
            col("returns_result_set", rrs),
            col("is_active", true)
          ] },
          { name: "flow.d_event_template", rows: nTpl, note: "пары «день — шаблон»", cols: [
            colAuto("event_id", "id события"),
            colAuto("template_id", "id из template.d_template по паре (канал, код)",
              "не найдётся — запишется NULL и придёт предупреждение"),
            col("step_no", nTpl ? days : "", "день ретеншена")
          ] },
          { name: "flow.d_event_definition", rows: 1, note: "ключи определения", cols: [
            colAuto("event_id", "id события"),
            col("notify_channel", body.notifyChannel),
            col("definition_key", body.definitionKey),
            col("business_key_prefix", body.businessKeyPrefix)
          ] }
        ]
      },
      {
        title: "Слой B — боевые прод-таблицы",
        note: "Пишутся через insertB: колонку со значением null он в запрос не включает — " +
              "она получит NULL или свой DEFAULT.",
        tables: [
          { name: "scheduler.t_get_event", rows: 1, note: "прод-копия события", cols: [
            colAuto("id", "RETURNING — станет get_event_id ниже"),
            col("selection", sel),
            col("event_name", body.eventName),
            colNn("system", body.system),
            colNn("source", body.source),
            col("notify_channel", body.notifyChannel),
            col("is_active", body.isActive),
            col("is_deferred", false),
            col("allow_ml", false),
            col("send_delay", 2, "форма его не спрашивает — ставится сервером")
          ] },
          { name: "scheduler.t_launch_settings", rows: 1,
            note: "создаёт ПЛАНИРОВЩИК (POST /api/v1/event), не мы — его id уходит в шаги", cols: [
            colAuto("id", "RETURNING — станет t_launch_settings_id ниже"),
            col("selection", sel),
            colAuto("time_start", "момент вставки на сервере",
              "поле date_start на первом экране показано, но в запросе не уезжает"),
            col("database", body.database),
            col("description", body.eventName, "сюда уезжает имя события"),
            col("is_active", body.isActive),
            col("status", "NEW"),
            col("is_batch", body.isBatch),
            col("max_retry_attempts", 1),
            colNn("crontab", body.crontab),
            col("job_group", "CRM")
          ] },
          { name: "scheduler.t_execution_steps", rows: nSteps, note: "прод-копия шагов", cols: [
            colAuto("t_launch_settings_id", "id строки расписания выше"),
            col("process_name", sel),
            col("order_num", ords),
            col("is_active", true),
            col("returns_result_set", rrs),
            colAuto("sql_text", "SQL каждого шага")
          ] },
          { name: mapping, rows: nTpl,
            note: body.isChain ? "цепочка — отдельная прод-таблица" : "маппинг шаблонов события",
            cols: body.isChain ? [
              colAuto("event_id", "id из scheduler.t_get_event"),
              col("event_name", body.eventName),
              col("template_id", nTpl ? codes : "", "код из формы, НЕ id справочника"),
              col("channel", body.notifyChannel)
            ] : [
              colAuto("get_event_id", "id из scheduler.t_get_event"),
              col("event_name", body.eventName),
              colNn("system", body.system),
              col("notify_channel", body.notifyChannel),
              col("template_id", nTpl ? codes : "", "код из формы, НЕ id справочника")
            ] },
          { name: "commapi.d_definition_mapping", rows: 1, note: "ключи определения в проде", cols: [
            (body.isBatch
              /* У массового метода строка определения не привязана к событию:
                 связь идёт парой event_name + system. Колонки в запросе не будет. */
              ? colNn("get_event_id", "", "у массового метода не заполняется")
              : colAuto("get_event_id", "id из scheduler.t_get_event")),
            col("event_name", body.eventName),
            colNn("system", body.system),
            col("notify_channel", body.notifyChannel),
            col("definition_key", body.definitionKey),
            col("business_key_prefix", body.businessKeyPrefix),
            col("is_correlation", false)
          ] }
        ]
      },
      {
        title: "Служебное — пишется само",
        note: "Отдельно указывать не нужно, но откатывать событие руками придётся и здесь.",
        tables: [
          { name: "flow.t_materialization", rows: bRows,
            note: "по строке на каждую строку слоя B", cols: [
            col("our_entity", "flow.d_event"),
            colAuto("our_id", "id события"),
            colAuto("prod_table", "таблица вставленной строки"),
            colAuto("prod_id", "id вставленной строки"),
            colAuto("materialized_by", "ваш e-mail")
          ] },
          { name: "arch.t_admin_log", rows: 1 + bRows,
            note: "запись на flow.d_event и на каждую строку слоя B", cols: [
            colAuto("что записывается", '{"id": N}, у flow.d_event ещё event_name',
              "снимок строки не сохраняется, восстановить событие по журналу нельзя")
          ] }
        ]
      }
    ];
  }

  function planTableHtml(t) {
    return '<div class="ev-plan-t"><div class="ev-plan-th">' +
      '<span class="tbl">' + esc(t.name) + '</span>' +
      '<span class="ev-plan-cnt">' + esc(nRow(t.rows)) + '</span>' +
      (t.note ? '<span class="ev-plan-tn">' + esc(t.note) + '</span>' : '') +
      '</div><table><tbody>' +
      t.cols.map(function (c) {
        return '<tr' + (c.k ? ' class="k-' + c.k + '"' : '') + '>' +
          '<td class="c">' + esc(c.c) + '</td>' +
          '<td class="v">' + esc(c.v) + '</td>' +
          '<td class="n">' + esc(c.n || "") + '</td></tr>';
      }).join("") +
      '</tbody></table></div>';
  }

  /* Тело запроса, показанное в окне. Его же отправляет кнопка «Завести событие»: пере-
     собирать форму на отправке нельзя — между показом плана и нажатием человек мог
     что-то поменять, и уехало бы не то, на что он смотрел. */
  var planBody = null;

  function openPlan(body) {
    planBody = body;
    /* Право спрашиваем ЗДЕСЬ, а не при инициализации раздела: CRM.me приезжает
       асинхронно (/api/me), и раздел, открытый раньше ответа, видел пустой профиль.
       can() честно отвечал «нет», кнопка гасла навсегда — повторно init не выполняется.
       К моменту открытия окна профиль давно на месте. */
    var go = el("evfPlanGo");
    var may = can("add", "ev-offline");
    go.disabled = !may;
    go.title = may ? "" : "Нет права на заведение событий в этом разделе";
    var groups = planGroups(body);
    var tables = 0, rows = 0;
    groups.forEach(function (g) {
      g.tables.forEach(function (t) { tables++; rows += t.rows; });
    });
    el("evfPlanSum").textContent = tables + " таблиц · " + nRow(rows)
      + (body.isPromo ? " · is promo: без итогового скрипта" : "");
    el("evfPlanBody").innerHTML = groups.map(function (g) {
      return '<div class="ev-plan-g"><div class="ev-plan-gt">' + esc(g.title) + '</div>' +
        (g.note ? '<p class="ev-plan-gn">' + esc(g.note) + '</p>' : '') +
        g.tables.map(planTableHtml).join("") + '</div>';
    }).join("");
    el("evfPlanModal").classList.add("open");
    el("evfPlanClose").focus();
  }

  function closePlan() {
    var m = el("evfPlanModal");
    if (m) m.classList.remove("open");
  }

  /**
   * Завести событие: POST /api/events/offline тем телом, что показано в окне.
   * <p>
   * Кнопка гасится на время запроса. Повторное нажатие завело бы второе событие с тем же
   * именем — сервер это поймает (имя уникально вместе с системой), но ловить такое
   * ответом об ошибке хуже, чем не дать нажать.
   */
  function sendOffline() {
    if (!planBody) return;
    var go = el("evfPlanGo");
    go.disabled = true;
    if (el("evfPlanNote")) el("evfPlanNote").textContent = "Заводим…";
    evReq("POST", "/offline", requestBody(planBody)).then(function (res) {
      closePlan();
      /* Событие заведено — окно заведения больше не нужно, а отчёт лежит в форме,
         которая вернётся в свою секцию. */
      if (evWiz.kind) evWizClose();
      /* wzGo первым: он гасит строку состояния при переходе между экранами, и
         поставленное до него сообщение об успехе исчезло бы, не успев показаться. */
      wzGo(WZ_LAST);
      say("evfMsg", startedText(res), startedKind(res));
      renderResult("evfResult", res);
      /* Имя события уникально вместе с системой — очищаем поле, чтобы повторное
         нажатие не упёрлось в «уже заведено». Остальное оставляем: соседнее событие
         обычно отличается одним-двумя полями. */
      if (el("evfName")) el("evfName").value = "";
      stampNow("evfDateStart");
      planBody = null;
    }).catch(function (e) {
      /* Окно не закрываем: ошибку читают рядом с планом, по которому её и объясняют. */
      if (el("evfPlanNote")) {
        el("evfPlanNote").textContent = (e && e.message) || "Не удалось завести событие";
        el("evfPlanNote").style.color = "var(--coral)";
      }
      fail("evfMsg", e);
    }).then(function () {
      if (can("add", "ev-offline")) go.disabled = false;
    });
  }

  function resetOffline() {
    ["evfName", "evfSource", "evfFinalTable", "evfScript"]
      .forEach(function (id) { if (el(id)) el(id).value = ""; });
    if (el("evfScript")) el("evfScript").removeAttribute("data-touched");
    if (el("evfDayCol")) el("evfDayCol").value = "day_num";
    stampNow("evfDateStart");
    renderFormTemplates([]);
    ["evfChannel", "evfDefKey", "evfPrefix", "evfSystem"].forEach(function (id) {
      if (el(id)) el(id).value = "";
    });
    if (el("evfActive")) el("evfActive").checked = false;
    if (el("evfChain")) el("evfChain").checked = false;
    if (el("evfService")) el("evfService").checked = false;
    if (el("evfPromo")) el("evfPromo").checked = false;
    if (el("evfTplCode")) el("evfTplCode").value = "";
    applyChainMode();
    applyMethod();          // метод человек выбрал сам — сбрасываем не его, а поля под ним
    if (el("evfCronManual")) el("evfCronManual").checked = false;
    if (el("evfCrontab")) el("evfCrontab").readOnly = true;
    if (el("evfFreq")) el("evfFreq").value = "daily";
    if (el("evfTime")) el("evfTime").value = "09:00:00";
    if (el("evfStepCount")) el("evfStepCount").value = "1";
    document.querySelectorAll("#evfDowBox [data-dow]").forEach(function (c) { c.checked = false; });
    renderCron();
    renderSteps();
    if (el("evfPayload")) {
      el("evfPayload").textContent = "Нажмите «Запустить коммуникацию» — здесь появится тело запроса.";
    }
    closePlan();
    say("evfMsg", "");
    renderResult("evfResult", null);
    wzGo(1);
  }

  /* Собираем запрос, показываем план окном и тело запроса на экране. Сама отправка — за
     кнопкой в окне (sendOffline): событие пишется и в нашу модель, и в боевые таблицы, а
     откатывается руками в psql, поэтому между «нажал» и «записалось» стоит экран, где
     видно, во что именно это превратится. */
  /* Тело в том виде, в каком оно уходит на сервер. isPromo — поле формы, а не запроса:
     колонки такой нет ни у нас, ни в проде, и весь его смысл уже выражен составом шагов.
     В окне плана он показан, в запросе его быть не должно — и на экране «Отправка» тоже,
     иначе там стояло бы поле, которого сервер никогда не увидит. */
  function requestBody(body) {
    var out = {};
    Object.keys(body || {}).forEach(function (k) {
      if (k !== "isPromo") out[k] = body[k];
    });
    return out;
  }

  function submitOffline() {
    var i;
    for (i = 1; i < WZ_LAST; i++) {
      if (!wzValidate(i)) { wzGo(i); return; }
    }
    var body = offlineBody();
    el("evfPayload").textContent = JSON.stringify(requestBody(body), null, 2);
    say("evfMsg", "Проверьте план и подтвердите заведение в окне.");
    renderResult("evfResult", null);
    if (el("evfPlanNote")) {
      el("evfPlanNote").textContent = "Проверьте план: это ожидание по форме, а не ответ базы.";
      el("evfPlanNote").style.color = "";
    }
    openPlan(body);
  }

  /* ============================================================ ОКНО ЗАВЕДЕНИЯ

     Одно окно на оба рода событий. Первый шаг — выбор рода: онлайн-событие или
     событие по расписанию; дальше показывается уже сама форма, и её собственные шаги
     идут внутри окна (у события по расписанию там ещё и выбор метода отправки).

     Форму окно НЕ дублирует, а забирает: узел #evoForm или #evfWizard переносится в
     тело окна и возвращается на место при закрытии. Копия разметки означала бы два
     одинаковых id на странице — правится одно поле, отправляется другое, и найти это
     можно только по расхождению того, что видно, с тем, что уехало. */

  var evWiz = { kind: null, host: null, node: null };

  function evWizInit() {
    if (evWiz.inited) return;
    evWiz.inited = true;
    var m = el("evWizModal");
    if (!m) return;
    el("evWizClose").onclick = evWizClose;
    el("evWizBack").onclick = function () { evWizPick(); };
    m.onclick = function (e) { if (e.target === m) evWizClose(); };
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && m.classList.contains("open")) evWizClose();
    });
    document.querySelectorAll("#evWizPick .ev-kind").forEach(function (b) {
      b.onclick = function () { evWizUse(b.getAttribute("data-kind")); };
    });
  }

  /** Открыть окно на первом шаге. */
  function evWizOpen() {
    evWizInit();
    evWizPick();
    var m = el("evWizModal");
    if (m) m.classList.add("open");
  }

  /** Вернуться к выбору рода: форму отдаём назад в её секцию. */
  function evWizPick() {
    evWizRelease();
    evWiz.kind = null;
    if (el("evWizPick")) el("evWizPick").hidden = false;
    if (el("evWizBack")) el("evWizBack").hidden = true;
    if (el("evWizTitle")) el("evWizTitle").textContent = "Новое событие";
    if (el("evWizSub")) el("evWizSub").textContent = "Выберите, какое событие заводим";
    if (el("evWizNote")) el("evWizNote").textContent = "";
  }

  /** Показать форму выбранного рода внутри окна. */
  function evWizUse(kind) {
    var id = kind === "online" ? "evoForm" : "evfWizard";
    var node = el(id);
    if (!node) return;
    /* Инициализация раздела ленивая (по первому открытию), а окно может открыться
       раньше — тогда у формы не было бы ни справочников, ни обработчиков. */
    if (kind === "online") { initOnline(); } else { initOffline(); }
    evWiz.kind = kind;
    evWiz.host = node.parentNode;
    evWiz.next = node.nextSibling;
    evWiz.node = node;
    el("evWizBody").appendChild(node);
    if (el("evWizPick")) el("evWizPick").hidden = true;
    if (el("evWizBack")) el("evWizBack").hidden = false;
    el("evWizTitle").textContent = kind === "online" ? "Онлайн-событие" : "Событие по расписанию";
    el("evWizSub").textContent = kind === "online"
      ? "Приходит извне: расписания нет, шаги заполняются подряд"
      : "Мастер по шагам: настройки, выборка, шаблон, проверка";
    el("evWizNote").textContent = "";
  }

  /** Вернуть форму в её секцию — ровно на то место, откуда взяли. */
  function evWizRelease() {
    if (!evWiz.node || !evWiz.host) return;
    evWiz.host.insertBefore(evWiz.node, evWiz.next || null);
    evWiz.node = null;
    evWiz.host = null;
    evWiz.next = null;
  }

  function evWizClose() {
    evWizRelease();
    var m = el("evWizModal");
    if (m) m.classList.remove("open");
    evWiz.kind = null;
    if (el("evWizPick")) el("evWizPick").hidden = false;
    if (el("evWizBack")) el("evWizBack").hidden = true;
  }

  // ============================================================ СПИСОК СОБЫТИЙ

  var evl = { offset: 0, limit: 50, total: 0 };

  function initList() {
    if (inited.list) return;
    inited.list = true;
    el("evlApply").onclick = function () { evl.offset = 0; loadList(); };
    el("evlReset").onclick = function () {
      ["evlQ", "evlKind", "evlChannel", "evlActive", "evlExported"].forEach(function (id) {
        if (el(id)) el(id).value = "";
      });
      evl.offset = 0;
      loadList();
    };
    el("evlPrev").onclick = function () {
      evl.offset = Math.max(0, evl.offset - evl.limit);
      loadList();
    };
    el("evlNext").onclick = function () {
      if (evl.offset + evl.limit < evl.total) { evl.offset += evl.limit; loadList(); }
    };
    if (el("evlExport")) el("evlExport").onclick = exportEventList;
    if (el("evlNew")) {
      el("evlNew").onclick = evWizOpen;
      /* Право спрашиваем после ответа /api/me — см. gateSubmit: раздел открывается
         раньше, чем приезжает профиль, и проверка «сразу» гасила бы кнопку навсегда.
         Права два, потому что и рода событий два: хватает любого. */
      var gate = function () {
        var may = can("add", "ev-online") || can("add", "ev-offline");
        el("evlNew").disabled = !may;
        el("evlNew").title = may ? "" : "Нет права на заведение событий";
      };
      gate();
      if (window.CRM && CRM.meReady && CRM.meReady.then) CRM.meReady.then(gate, gate);
    }
    /* Enter в поиске — то же, что «Показать»: набрал и нажал, без похода к кнопке. */
    el("evlQ").onkeydown = function (e) {
      if (e.key === "Enter") { evl.offset = 0; loadList(); }
    };
    evReq("GET", "/list/facets").then(function (f) {
      fillSelect(el("evlChannel"), f.channels, "любой");
    }).catch(function () { /* фильтр по каналу останется пустым, список от этого не зависит */ });
    loadList();
  }

  /**
   * Условия отбора строкой запроса.
   *
   * @param over переопределение окна выборки: {limit, offset}. Нужно выгрузке — она
   *             идёт по тем же фильтрам, но большими кусками и до конца, а не по
   *             странице, которую человек сейчас видит.
   */
  function listQuery(over) {
    var p = [];
    function add(k, v) { if (v) p.push(k + "=" + encodeURIComponent(v)); }
    add("q", str("evlQ"));
    add("kind", str("evlKind"));
    add("channel", str("evlChannel"));
    add("active", str("evlActive"));
    add("exported", str("evlExported"));
    p.push("limit=" + ((over && over.limit) || evl.limit));
    p.push("offset=" + ((over && over.offset != null) ? over.offset : evl.offset));
    return "?" + p.join("&");
  }

  function loadList() {
    /* Список перерисовывается — карточка, открытая поверх него, уже не про то, что
       на экране: возвращаемся к списку сами, а не оставляем её висеть. */
    if (el("evCardHost") && !el("evCardHost").hidden) showListPart(true);
    say("evlMsg", "Загружаем…");
    evReq("GET", "/list" + listQuery()).then(function (d) {
      evl.total = Number(d.total || 0);
      /* Строки держим у себя: их же выгружает «Экспорт» — иначе пришлось бы собирать
         файл из разметки таблицы, а это чтение того, что сами и нарисовали. */
      evl.rows = d.rows || [];
      say("evlMsg", evl.total ? "Найдено событий: " + evl.total : "Ничего не нашлось", "");
      renderList(d.rows || []);
      var pager = el("evlPager");
      pager.style.display = evl.total > evl.limit ? "" : "none";
      el("evlPrev").disabled = evl.offset === 0;
      el("evlNext").disabled = evl.offset + evl.limit >= evl.total;
      el("evlPage").textContent = evl.total
        ? (evl.offset + 1) + "-" + Math.min(evl.offset + evl.limit, evl.total) + " из " + evl.total
        : "";
    }).catch(function (e) { fail("evlMsg", e); });
  }

  function kindLabel(k) { return k === "time" ? "по расписанию" : "онлайновое"; }

  /* Состояние планировщика словами: три колонки прода со словом status разложены по
     трём с честными именами, и показывать их сырыми значениями незачем. */
  function stateLabel(r) {
    if (!r.phase && !r.cron_state && !r.last_result) return "—";
    var parts = [];
    if (r.phase) parts.push({ NEW: "новое", WAITING: "ждёт", PROCESSING: "идёт" }[r.phase] || r.phase);
    if (r.cron_state) parts.push(r.cron_state === "STARTED" ? "крон знает" : "крон не знает");
    if (r.last_result) parts.push(r.last_result === "SUCCESS" ? "прошлый успешно" : "прошлый с ошибкой");
    return parts.join(" · ");
  }

  function renderList(rows) {
    var box = el("evlBox");
    if (!box) return;
    if (!rows.length) { box.innerHTML = ""; return; }
    /* Разметка реестра — общая с «Шаблонами и сегментами» (css/registry.css): та же
       шапка, та же липкая строка заголовков, тот же вид строк. Своей таблицы у списка
       событий больше нет: два похожих, но разных списка расходились бы при каждой
       правке одного из них. */
    var html = '<div class="sf-table-wrap"><table class="sf-table"><thead><tr>' +
      "<th>id</th><th>Событие</th><th>Система</th><th>Род</th><th>Канал</th>" +
      "<th>Расписание</th><th>Шаблоны</th><th>Состояние</th><th>Активно</th><th>В проде</th>" +
      "<th></th>" +
      "</tr></thead><tbody>";
    rows.forEach(function (r) {
      var tplCell = r.templates
        ? esc(r.templates)
        : (Number(r.templates_total || 0) ? "не опознаны (" + r.templates_total + ")" : "—");
      html += '<tr class="clickable" data-ev="' + esc(r.id) + '">' +
        "<td>" + esc(r.id) + "</td>" +
        '<td><span class="sf-link">' + esc(r.event_name) + "</span></td>" +
        "<td>" + esc(r.system || "—") + "</td>" +
        "<td>" + kindLabel(r.kind) + "</td>" +
        "<td>" + esc(r.notify_channel || "—") + "</td>" +
        "<td>" + esc(r.crontab || "—") + "</td>" +
        "<td>" + tplCell + "</td>" +
        "<td>" + esc(stateLabel(r)) + "</td>" +
        "<td>" + (r.is_active ? "да" : "нет") + "</td>" +
        "<td>" + (Number(r.exported || 0) ? "да" : "нет") + "</td>" +
        /* Кнопка делает то же, что клик по строке, и стоит здесь не ради нового
           действия, а ради видимого: настройки события — шаги, шаблоны, планировщик —
           открывались только по клику куда-то в строку, и про них не знали. */
        '<td><button type="button" class="sf-row-menu" data-ev-btn="' + esc(r.id) +
          '">Настройки</button></td>' +
        "</tr>";
    });
    box.innerHTML = html + "</tbody></table></div>";
    box.querySelectorAll("[data-ev]").forEach(function (tr) {
      tr.onclick = function () { toggleCard(tr.getAttribute("data-ev")); };
    });
    /* Кнопка внутри строки: гасим всплытие, иначе клик по ней сначала откроет карточку
       обработчиком строки, а потом закроет своим — и на глаз ничего не произойдёт. */
    box.querySelectorAll("[data-ev-btn]").forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        toggleCard(b.getAttribute("data-ev-btn"));
      };
    });
  }

  /* Выгрузка всего, что подходит под фильтр, — а не той страницы, что на экране.
     Список постраничный, поэтому идём за остальным на сервер: теми же условиями,
     кусками по 500 строк, пока не кончится. Потолок стоит от бесконечного цикла и
     от файла, который никто не откроет; упёрлись — говорим прямо. */
  var EXPORT_CHUNK = 500, EXPORT_MAX = 20000;

  function exportEventList() {
    var btn = el("evlExport");
    if (btn) btn.disabled = true;
    say("evlMsg", "Собираем выгрузку…");
    var all = [];
    function step(offset) {
      return evReq("GET", "/list" + listQuery({ limit: EXPORT_CHUNK, offset: offset }))
        .then(function (d) {
          var got = d.rows || [];
          all = all.concat(got);
          say("evlMsg", "Собираем выгрузку… " + all.length);
          if (got.length === EXPORT_CHUNK && all.length < EXPORT_MAX) return step(offset + EXPORT_CHUNK);
        });
    }
    step(0).then(function () {
      var capped = all.length >= EXPORT_MAX;
      writeEventCsv(all);
      say("evlMsg", capped
        ? "Выгружено строк: " + all.length + " — это потолок выгрузки, сузьте фильтр"
        : "Выгружено строк: " + all.length, capped ? "warn" : "");
    }).catch(function (e) {
      fail("evlMsg", e);
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function writeEventCsv(rows) {
    var cols = [
      ["id", function (r) { return r.id; }],
      ["Событие", function (r) { return r.event_name; }],
      ["Система", function (r) { return r.system; }],
      ["Род", function (r) { return r.kind === "income" ? "онлайновое" : "по расписанию"; }],
      ["Канал", function (r) { return r.notify_channel; }],
      ["Расписание", function (r) { return r.crontab; }],
      ["Шаблоны", function (r) { return r.templates; }],
      ["Активно", function (r) { return r.is_active ? "да" : "нет"; }],
      ["В проде", function (r) { return Number(r.exported || 0) ? "да" : "нет"; }]
    ];
    var cell = function (v) {
      var s = v == null ? "" : String(v);
      /* Кавычки, точки с запятой и переносы ломают строку CSV (RFC 4180). */
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var lines = [cols.map(function (c) { return cell(c[0]); }).join(";")];
    rows.forEach(function (r) {
      lines.push(cols.map(function (c) { return cell(c[1](r)); }).join(";"));
    });
    /* Точка с запятой и BOM — иначе Excel с русской локалью складывает строку в одну
       ячейку и показывает кириллицу кракозябрами. */
    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "events-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* Карточка грузится по клику, а не вместе со списком: полная обвязка это ещё шесть
     запросов на строку, и на странице в пятьдесят строк вышло бы триста запросов.

     Показывается вместо списка, а не под строкой: читают её целиком — расписание, шаги,
     шаблоны, связи с продом, — а раскрытая внутри таблицы она была зажата колонками и
     пропадала при первом же обновлении списка. Возврат — кнопкой «К списку», как в
     карточке шаблона. */
  function toggleCard(id) {
    showListPart(false);
    var host = el("evCardHost");
    host.hidden = false;
    host.innerHTML = '<div class="sfd"><div class="sfd-head"><b>Загружаем…</b></div></div>';
    evReq("GET", "/list/" + encodeURIComponent(id)).then(function (d) {
      evCard = d;
      host.innerHTML = renderEventCard(d);
      wireEventCard(id);
      /* Состояние задания спрашиваем отдельным запросом, а не вместе с карточкой: он
         ходит в чужой сервис, и карточка не должна ждать его или падать вместе с ним. */
      loadCron(id);
    }).catch(function (e) {
      host.innerHTML = '<div class="sfd"><div class="sfd-head"><b style="color:var(--red,#e5484d)">' +
        esc((e && e.message) || "Не удалось загрузить карточку") + "</b></div></div>";
    });
    var v = el("sec-event-list");
    if (v) v.scrollTop = 0;
  }

  /** Показать список (шапка, фильтры, таблица) или спрятать его под карточкой. */
  function showListPart(on) {
    ["sf-head", "filters-row", "sf-count"].forEach(function (cls) {
      var n = document.querySelector("#sec-event-list ." + cls);
      if (n) n.hidden = !on;
    });
    if (el("evlBox")) el("evlBox").hidden = !on;
    var pager = el("evlPager");
    if (pager) pager.style.display = on && evl.total > evl.limit ? "" : "none";
    if (!on) return;
    var host = el("evCardHost");
    if (host) { host.hidden = true; host.innerHTML = ""; }
  }

  /** Открытая карточка — для перерисовки после правки поля. */
  var evCard = null;

  /* Карточка события тем же видом, что карточка шаблона: шапка с состоянием, секции со
     свёрткой, поля в две колонки, правка на месте по карандашу. Стили общие
     (css/registry.css) — читаются они одинаково, и человек, научившийся одной карточке,
     умеет обе. */
  function renderEventCard(d) {
    var e = d.event || {}, dv = d.delivery || {}, s = d.schedule || {}, st = d.state || {};
    var time = e.kind === "time";
    var may = canEditEvent();

    var head = '<div class="sfd-top">' +
        '<button type="button" class="sf-btn" data-ev-back="1">← К списку событий</button>' +
      "</div>" +
      '<div class="sfd"><div class="sfd-head">' +
        '<span class="sfd-ch">' + (time ? "ПО РАСПИСАНИЮ" : "ОНЛАЙН") + "</span>" +
        "<b>" + esc(e.id) + " — " + esc(e.event_name || "") + "</b>" +
        '<span class="sfd-status ' + (e.is_active ? "on" : "off") + '">' +
          (e.is_active ? "АКТИВНО" : "ВЫКЛЮЧЕНО") + "</span>" +
      "</div>";

    var body = sec("Событие", [
      row("Имя события", e.event_name, null, "имя же уходит в selection: по нему в проде связаны три таблицы, поэтому здесь оно только показывается"),
      row("Система", e.system, may && "system"),
      row("Source", e.source, may && "source"),
      row("Описание", e.description, may && "description"),
      row("Род", time ? "по расписанию" : "онлайновое"),
      flagRow("Активно", e.is_active, may && "is_active"),
      row("Заведено", String(e.timestamp_cr || "").slice(0, 19).replace("T", " "))
    ]);

    body += sec("Доставка", [
      row("Канал", dv.notify_channel),
      row("Sub channel", dv.sub_channel),
      row("Платформа", dv.platform),
      row("Задержка", dv.send_delay),
      row("Время жизни", dv.life_time),
      row("ML", dv.allow_ml ? "да" : "нет")
    ]);

    if (time) {
      body += sec("Расписание", [
        row("Кронтаб", s.crontab, may && "crontab", cronWords(s.crontab)),
        row("База выборки", s.database, may && "database"),
        flagRow("Массовая отправка", s.is_batch, may && "is_batch"),
        row("Попыток", s.max_retry_attempts),
        row("Группа заданий", s.job_group),
        row("Фаза", st.phase),
        row("Крон", st.cron_state),
        row("Прошлый прогон", st.last_result),
        row("Следующий запуск", st.date_next)
      ]);
      /* Планировщик — про то, знает ли Quartz об этом событии, а не про то, что мы
         записали в расписание. Эти две вещи расходятся, и ровно из-за этого заведённое
         панелью событие могло не сработать ни разу. */
      body += '<div class="sfd-sec"><div class="sfd-sec-title">Планировщик</div>' +
        '<div class="sfd-chain" id="evCron-' + esc(e.id) + '">' +
        '<span style="color:var(--faint)">читаю…</span></div></div>';
      body += stepsSec(d.steps || [], e.id, may);
    }

    body += tplSec(d.templates || [], e.id, may);
    body += linksSec(d.links || []);

    return head + body + "</div>";
  }

  /** Секция карточки: заголовок и поля в две колонки. */
  function sec(title, rows) {
    var inner = rows.filter(Boolean).join("");
    return '<div class="sfd-sec"><div class="sfd-sec-title">' + esc(title) + "</div>" +
      '<div class="sfd-grid">' + inner + "</div></div>";
  }

  /**
   * Строка поля.
   *
   * @param field имя поля для правки; пусто — поле только показывается
   * @param note  подпись под значением: чем поле является и почему его нельзя трогать
   */
  function row(label, value, field, note) {
    var empty = value === null || value === undefined || value === "";
    return '<div class="sfd-row"' + (field ? ' data-field="' + esc(field) + '"' : "") + ">" +
      '<div class="l">' + esc(label) + "</div>" +
      '<div class="v' + (empty ? " empty" : "") + '">' + (empty ? "—" : esc(value)) + "</div>" +
      (note ? '<div class="l" style="margin-top:4px">' + esc(note) + "</div>" : "") +
      (field ? penHtml() : "") + "</div>";
  }

  function flagRow(label, on, field) {
    return '<div class="sfd-row"' + (field ? ' data-field="' + esc(field) + '" data-bool="1"' : "") + ">" +
      '<div class="l">' + esc(label) + "</div>" +
      '<div class="v"><span class="' + (on ? "flag-on" : "flag-off") + '">' +
        (on ? "да" : "нет") + "</span></div>" +
      (field ? penHtml() : "") + "</div>";
  }

  function penHtml() {
    return '<button type="button" class="sfd-pen" title="Править">' +
      '<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>';
  }

  /** Расписание словами — тем же описателем, что и в мастере. */
  function cronWords(expr) {
    if (!expr) return "";
    var v = validateCron(expr);
    if (!v.ok) return v.error;
    return v.loose ? "" : (describeCron(v.parts) || "");
  }

  function stepsSec(steps, id, may) {
    var head = '<div class="sfd-sec"><div class="sfd-sec-title">Шаги выборки (' + steps.length + ")" +
      (may ? ' <button type="button" class="ev-mini" onclick="evEditSteps(' + esc(id) + ')">Править</button>' : "") +
      "</div>";
    var body = steps.length ? steps.map(function (x) {
      return '<div style="margin-bottom:8px"><b>' + esc(x.order_num) + ". " + esc(x.process_name || "") + "</b>" +
        (x.returns_result_set ? " · возвращает результат" : "") +
        (x.is_active ? "" : " · выключен") +
        "<pre>" + esc(x.sql_text || "") + "</pre></div>";
    }).join("") : '<span style="color:var(--faint)">нет</span>';
    return head + '<div class="sfd-chain" id="evEditSteps-' + esc(id) + '">' + body + "</div></div>";
  }

  function tplSec(tpl, id, may) {
    var head = '<div class="sfd-sec"><div class="sfd-sec-title">Шаблоны (' + tpl.length + ")" +
      (may ? ' <button type="button" class="ev-mini" onclick="evEditTemplates(' + esc(id) + ')">Править</button>' : "") +
      "</div>";
    var body = tpl.length
      ? '<div class="ev-rows"><table><tbody>' + tpl.map(function (x) {
          return "<tr><td>" + (x.step_no == null ? "одиночный" : "шаг " + esc(x.step_no)) + "</td>" +
            "<td>" + (x.code ? esc(x.channel) + ":" + esc(x.code) : "не найден у нас") + "</td>" +
            "<td>" + esc(x.communication_name || "") + "</td></tr>";
        }).join("") + "</tbody></table></div>"
      : '<span style="color:var(--faint)">нет</span>';
    return head + '<div class="sfd-chain" id="evEditTpl-' + esc(id) + '">' + body + "</div></div>";
  }

  function linksSec(links) {
    if (!links.length) return "";
    return '<div class="sfd-sec"><div class="sfd-sec-title">Связи с crmdb (' + links.length + ")</div>" +
      '<div class="sfd-chain"><div class="ev-rows"><table><thead><tr><th>Таблица</th>' +
      "<th>наш id</th><th>id в crmdb</th><th>Направление</th></tr></thead><tbody>" +
      links.map(function (x) {
        return '<tr><td class="tbl">' + esc(x.our_table) + "</td><td>" + esc(x.our_id) +
          "</td><td>" + esc(x.prod_id) + "</td><td>" +
          (x.direction === "IMPORT" ? "затянуто из crmdb" : "отправлено в crmdb") + "</td></tr>";
      }).join("") + "</tbody></table></div></div></div>";
  }

  /* Обработчики карточки: возврат к списку, свёртка секций, правка полей. */
  function wireEventCard(id) {
    var host = el("evCardHost");
    host.querySelectorAll("[data-ev-back]").forEach(function (b) {
      b.onclick = function () { showListPart(true); };
    });
    host.querySelectorAll(".sfd-sec-title").forEach(function (t) {
      t.onclick = function (e) {
        /* Кнопки внутри заголовка («Править») сворачивать секцию не должны. */
        if (e.target.closest("button")) return;
        t.parentNode.classList.toggle("closed");
      };
    });
    host.querySelectorAll(".sfd-row[data-field] .sfd-pen").forEach(function (pen) {
      pen.onclick = function () { editField(id, pen.closest(".sfd-row")); };
    });
  }

  /**
   * Правка поля на месте: значение заменяется полем ввода, ✓ сохраняет, ✕ отменяет.
   * <p>
   * Одним полем за раз и отдельным запросом: карточка не форма, и «сохранить всё»
   * перезаписало бы то, чего человек не касался, — вместе с чужими правками из соседней
   * вкладки.
   */
  function editField(id, rowEl) {
    if (!rowEl || rowEl.classList.contains("editing")) return;
    var field = rowEl.getAttribute("data-field");
    var isBool = rowEl.getAttribute("data-bool") === "1";
    var vEl = rowEl.querySelector(".v");
    var old = vEl.textContent.trim();
    rowEl.classList.add("editing");

    var input = isBool
      ? '<input type="checkbox" class="sfd-edit-check"' + (old === "да" ? " checked" : "") + ">"
      : '<input type="text" class="sfd-edit" value="' + esc(old === "—" ? "" : old) + '">';
    vEl.innerHTML = input +
      ' <button type="button" class="ev-mini" data-ok="1">✓</button>' +
      ' <button type="button" class="ev-mini" data-no="1">✕</button>';

    var ctl = vEl.querySelector(".sfd-edit, .sfd-edit-check");
    if (ctl && !isBool) { ctl.focus(); ctl.select(); }

    var close = function () { rowEl.classList.remove("editing"); toggleCard(id); };
    vEl.querySelector("[data-no]").onclick = close;
    vEl.querySelector("[data-ok]").onclick = function () {
      var value = isBool ? ctl.checked : ctl.value;
      vEl.textContent = "Сохраняем…";
      evReq("PATCH", "/" + encodeURIComponent(id), { field: field, value: value })
        .then(function (res) {
          /* Правится наша модель. У перелитого события в crmdb лежит своя копия, и
             сама она не обновится — говорим об этом прямо, а не оставляем человека
             в уверенности, что рассылка уже читает новое значение. */
          say("evlMsg", res && res.exported
            ? "Сохранено. Событие уже в crmdb — правка туда не уехала: перелейте его заново"
            : "Сохранено", res && res.exported ? "warn" : "");
          close();
        })
        .catch(function (e) {
          fail("evlMsg", e);
          close();
        });
    };
    if (!isBool) {
      ctl.onkeydown = function (ev) {
        if (ev.key === "Enter") vEl.querySelector("[data-ok]").click();
        if (ev.key === "Escape") close();
      };
    }
  }

  /* Прежняя карточка-аккордеон (renderCard) удалена: карточка теперь одна и
     показывается экраном — см. renderEventCard. Два способа показать одно и то же
     расходятся на первой же правке, и человек видит разное в зависимости от того,
     откуда открыл. Список пар остался: им пользуется блок планировщика. */
  function dlist(pairs) {
    var out = "";
    pairs.forEach(function (p) {
      if (p[1] === null || p[1] === undefined || p[1] === "") return;
      out += "<dt>" + esc(p[0]) + "</dt><dd>" + esc(p[1]) + "</dd>";
    });
    return out ? "<dl>" + out + "</dl>" : '<div style="color:var(--faint)">пусто</div>';
  }

  /* ---------------------------------------------------------- правка события
     Карточка события до сих пор только показывала. Добавить шаблон на двадцать девятый
     день или поправить опечатку в SQL было нельзя — люди шли в psql, и панель переставала
     знать, что исполняется на самом деле.

     Правится НАША модель (flow.*), а не боевые таблицы: у перелитого события в crmdb
     лежит своя копия. Сервер это видит и возвращает предупреждение — показываем его как
     есть, потому что там названо, что делать дальше (перелить заново).

     Кнопки видны только тем, у кого есть право edit хотя бы на одну из секций завода
     событий: показывать кнопку, которая упрётся в 403, хуже, чем не показывать её. */
  function canEditEvent() {
    return can("edit", "ev-offline") || can("edit", "ev-online");
  }

  /** Карточка перерисовывается целиком — то же, что делает повторный клик по строке. */
  /* ============================================================ ПЛАНИРОВЩИК (Quartz)

     Событие по расписанию исполняет не наша строка в расписании, а задание Quartz. Их
     связывает id, который выдаёт планировщик при регистрации; без него события можно
     только заводить и никогда — останавливать.

     Четыре действия и ни одного автоматического. Регистрация создаёт задание
     ОСТАНОВЛЕННЫМ, каким бы активным ни было событие у нас: между «зарегистрировано» и
     «человек проверил» проходит время, а Quartz тикает по расписанию и ждать не станет.
     Запуск — отдельная кнопка, и это единственный момент, когда рассылка может уйти. */

  var CRON_ACTS = {
    register: { label: "Зарегистрировать", ask: null },
    update:   { label: "Обновить расписание",
                ask: "Планировщик пересоздаёт задание: на время правки оно остановится.\nПродолжить?" },
    stop:     { label: "Остановить", ask: "Остановить задание? Рассылка перестанет уходить по расписанию." },
    start:    { label: "Запустить",
                ask: "Запустить задание? С этого момента рассылка пойдёт по расписанию." }
  };

  function cronBox(id) { return el("evCron-" + id); }

  /* Имя с суффиксом Block намеренно: рядом, в мастере расписания, живёт renderCron()
     без аргументов — сборщик кронтаба. Объявления функций поднимаются, побеждает
     последнее, и одноимённый отрисовщик молча подменил сборщик: поле «Выражение
     расписания» перестало заполняться, а ошибки не было ни одной. */
  function renderCronBlock(id, c) {
    var box = cronBox(id);
    if (!box) return;
    var head = "<h4>Планировщик</h4>";
    if (!c.enabled) {
      box.innerHTML = head + '<div style="color:var(--faint)">Интеграция выключена.' +
        " Включается в «Настройки» → «Планировщик (Quartz)».</div>";
      return;
    }
    var may = canEditEvent();
    function btn(act) {
      return '<button type="button" class="ev-mini"' + (may ? "" : " disabled") +
        ' onclick="evCron(' + id + ",'" + act + "')\">" + CRON_ACTS[act].label + "</button>";
    }
    if (!c.registered) {
      box.innerHTML = head +
        '<div style="color:var(--faint);margin-bottom:8px">Задание не заведено: Quartz про это' +
        " событие не знает, по расписанию оно не сработает.</div>" +
        '<div class="ev-edit-row">' + btn("register") + "</div>" +
        '<div class="ev-edit-msg" id="evCronMsg-' + id + '"></div>';
      return;
    }
    box.innerHTML = head + dlist([
      ["id задания", c.cronEventId],
      ["состояние", c.lastStatus || "неизвестно"],
      ["последнее действие", c.lastAction],
      ["кто", c.lastActor],
      ["когда", c.syncedAt]
    ]) +
      (c.lastError ? '<div class="ev-warn">' + esc(c.lastError) + "</div>" : "") +
      '<div class="ev-edit-row" style="margin-top:8px">' +
        btn("start") + btn("stop") + btn("update") + "</div>" +
      '<div class="ev-edit-msg" id="evCronMsg-' + id + '"></div>';
  }

  function loadCron(id) {
    if (!cronBox(id)) return;
    fetch("/api/cron/event/" + id, { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : { enabled: false }; })
      .then(function (c) { renderCronBlock(id, c); })
      /* Раздел событий не должен падать из-за того, что планировщик не настроен:
         блок просто скажет, что интеграции нет. */
      .catch(function () { renderCronBlock(id, { enabled: false }); });
  }

  window.evCron = function (id, act) {
    var a = CRON_ACTS[act];
    if (!a || (a.ask && !confirm(a.ask))) return;
    var msg = el("evCronMsg-" + id);
    if (msg) { msg.textContent = "Отправляю…"; msg.style.color = "var(--dim)"; }
    fetch("/api/cron/event/" + id + "/" + act, {
      method: "POST", credentials: "same-origin", headers: { Accept: "application/json" }
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = t ? JSON.parse(t) : null; } catch (e) { /* не json — покажем как есть */ }
        if (!r.ok) throw new Error((j && j.message) || t || ("HTTP " + r.status));
        return j;
      });
    }).then(function (res) {
      renderCronBlock(id, res);
      var m = el("evCronMsg-" + id);
      if (m) { m.textContent = res.message || "Готово"; m.style.color = "var(--green)"; }
    }).catch(function (e) {
      var m = el("evCronMsg-" + id);
      if (m) { m.textContent = e.message; m.style.color = "var(--coral)"; }
    });
  };

  /* Перерисовка после правки шагов или шаблонов — тем же путём, что и открытие:
     карточка одна, и второй способ её собрать разошёлся бы с первым. */
  function evReloadCard(id) {
    var host = el("evCardHost");
    if (!host || host.hidden) return;
    toggleCard(id);
  }

  function evEditMsg(box, text, bad) {
    var m = box.querySelector(".ev-edit-msg");
    if (!m) return;
    m.textContent = text || "";
    m.style.color = bad ? "var(--coral)" : "var(--dim)";
  }

  window.evEditSteps = function (id) {
    var box = el("evEditSteps-" + id);
    if (!box) return;
    evReq("GET", "/list/" + encodeURIComponent(id)).then(function (d) {
      var steps = d.steps || [];
      box.innerHTML = "<h4>Шаги выборки — правка</h4>" +
        '<div class="ev-edit" data-ev="' + id + '">' +
        steps.map(function (x, i) { return stepEditor(i + 1, x); }).join("") +
        '<div class="ev-edit-row">' +
          '<button type="button" class="ev-mini" onclick="evStepAdd(' + id + ')">+ шаг</button>' +
          '<span class="ev-edit-msg"></span>' +
        "</div>" +
        '<div class="ev-edit-row">' +
          '<button type="button" class="ev-btn" onclick="evStepsSave(' + id + ')">Сохранить шаги</button>' +
          '<button type="button" class="ev-btn ghost" onclick="evReloadCard(' + id + ')">Отмена</button>' +
        "</div></div>";
    });
  };

  /* Отдельная функция, а не шаблон в строке: тот же блок нужен кнопке «+ шаг». */
  function stepEditor(num, x) {
    x = x || {};
    return '<div class="ev-edit-step" data-step>' +
      "<label><b>Шаг " + num + "</b> " +
        '<input type="checkbox" data-step-active' + (x.is_active === false ? "" : " checked") + "> активен" +
      "</label>" +
      '<textarea data-step-sql rows="6" spellcheck="false">' + esc(x.sql_text || "") + "</textarea>" +
      '<button type="button" class="ev-mini" onclick="this.parentNode.remove()">Убрать шаг</button>' +
      "</div>";
  }

  window.evStepAdd = function (id) {
    var box = el("evEditSteps-" + id);
    var rows = box.querySelectorAll("[data-step]");
    var holder = document.createElement("div");
    holder.innerHTML = stepEditor(rows.length + 1, null);
    /* Вставляем перед строкой кнопок, а не после последнего шага: шагов может не быть
       вовсе — у события, которое завели без выборки, — и «последний» тогда undefined. */
    var anchor = box.querySelector(".ev-edit-row");
    anchor.parentNode.insertBefore(holder.firstChild, anchor);
  };

  window.evStepsSave = function (id) {
    var box = el("evEditSteps-" + id);
    var steps = [];
    box.querySelectorAll("[data-step]").forEach(function (d) {
      steps.push({
        sql: d.querySelector("[data-step-sql]").value,
        active: d.querySelector("[data-step-active]").checked
      });
    });
    evEditMsg(box, "Сохраняю…");
    evReq("PUT", "/" + id + "/steps", { steps: steps }).then(function (res) {
      /* Предупреждение о расхождении с продом показываем модально: это не «сохранено»,
         а «сохранено, но в бою пока старое», и проскочить мимо этого нельзя. */
      if (res && res.warning) alert(res.warning);
      evReloadCard(id);
    }).catch(function (e) { evEditMsg(box, (e && e.message) || "Не сохранилось", true); });
  };

  window.evEditTemplates = function (id) {
    var box = el("evEditTpl-" + id);
    if (!box) return;
    evReq("GET", "/list/" + encodeURIComponent(id)).then(function (d) {
      var tpl = d.templates || [];
      box.innerHTML = "<h4>Шаблоны — правка</h4>" +
        '<div class="ev-edit" data-ev="' + id + '">' +
        '<div class="ev-edit-hint">Канал и код — как в справочнике шаблонов. День/шаг —' +
        " номер в цепочке, пусто — одиночный шаблон.</div>" +
        '<div data-tpl-rows>' + (tpl.length ? tpl.map(tplEditor).join("") : tplEditor({})) + "</div>" +
        '<div class="ev-edit-row">' +
          '<button type="button" class="ev-mini" onclick="evTplAdd(' + id + ')">+ шаблон</button>' +
          '<span class="ev-edit-msg"></span>' +
        "</div>" +
        '<div class="ev-edit-row">' +
          '<button type="button" class="ev-btn" onclick="evTplSave(' + id + ')">Сохранить шаблоны</button>' +
          '<button type="button" class="ev-btn ghost" onclick="evReloadCard(' + id + ')">Отмена</button>' +
        "</div></div>";
    });
  };

  function tplEditor(x) {
    x = x || {};
    return '<div class="ev-edit-tpl" data-tpl>' +
      '<input data-tpl-ch placeholder="канал" value="' + esc(x.channel || "") + '">' +
      '<input data-tpl-code placeholder="код" value="' + esc(x.code || "") + '">' +
      '<input data-tpl-step placeholder="день/шаг" value="' +
        esc(x.step_no == null ? "" : x.step_no) + '">' +
      '<span class="ev-edit-name">' + esc(x.communication_name || "") + "</span>" +
      '<button type="button" class="ev-mini" onclick="this.parentNode.remove()">✕</button>' +
      "</div>";
  }

  window.evTplAdd = function (id) {
    var box = el("evEditTpl-" + id).querySelector("[data-tpl-rows]");
    var holder = document.createElement("div");
    holder.innerHTML = tplEditor({});
    box.appendChild(holder.firstChild);
  };

  window.evTplSave = function (id) {
    var box = el("evEditTpl-" + id);
    var items = [];
    box.querySelectorAll("[data-tpl]").forEach(function (d) {
      items.push({
        channel: d.querySelector("[data-tpl-ch]").value,
        code: d.querySelector("[data-tpl-code]").value,
        stepNo: d.querySelector("[data-tpl-step]").value
      });
    });
    evEditMsg(box, "Сохраняю…");
    evReq("PUT", "/" + id + "/templates", { templates: items }).then(function (res) {
      if (res && res.warning) alert(res.warning);
      evReloadCard(id);
    }).catch(function (e) { evEditMsg(box, (e && e.message) || "Не сохранилось", true); });
  };

  /* Перелив события в боевую базу уехал в настройки (/settings → «Переливы» →
     «Перелив событий в прод»). Раздел «События» остался про заведение и просмотр:
     доставка наружу — процесс того же рода, что синхронизация шаблонов, и место
     ему рядом с ней. Ручки не менялись, секция ev-export тоже. */

  // Инициализация ленивая, по первому открытию раздела (см. openSection в shell.js).
  window.initEventOnlineSection = initOnline;
  window.initEventOfflineSection = initOffline;
  window.initEventListSection = initList;
})();
