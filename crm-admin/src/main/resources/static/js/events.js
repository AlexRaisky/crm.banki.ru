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

  /* Что именно создалось. Показываем таблицами слоя B с их id: по ним человек найдёт
     строку в базе, если понадобится проверить руками. */
  function renderResult(boxId, res) {
    var box = el(boxId);
    if (!box) return;
    if (!res) { box.innerHTML = ""; return; }
    var rows = (res.rows || []).map(function (r) {
      return "<tr><td class=\"tbl\">" + esc(r.table) + "</td><td>" + esc(r.id) + "</td></tr>";
    }).join("");
    var warn = (res.warnings || []).map(function (w) {
      return '<div class="ev-warn">' + esc(w) + "</div>";
    }).join("");
    box.innerHTML =
      '<div class="ev-rows"><table><thead><tr><th>Таблица</th><th>id</th></tr></thead>' +
      "<tbody>" + rows + "</tbody></table></div>" + warn;
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
    if (!can("add", "ev-online")) {
      el("evoSubmit").disabled = true;
      el("evoSubmit").title = "Нет права на заведение событий в этом разделе";
    }

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

    /* Окно с планом закрывается всеми привычными способами: крестиком, кнопкой, кликом
       по фону и Escape. Слушатель на документ висит один и проверяет класс — вешать его
       на карточку нельзя, фокус после открытия уходит на крестик. */
    el("evfPlanClose").onclick = closePlan;
    el("evfPlanOk").onclick = closePlan;
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
    if (!can("add", "ev-offline")) {
      el("evfSubmit").title = "Показывает план записи. На заведение событий права нет";
    }
    renderSteps();
    renderFormTemplates([]);
    stampNow("evfDateStart");
    renderCron();
    wzGo(1);

    dictionaries().then(function (d) {
      /* Узкие списки — это форма единичного метода: четыре пары ключ/префикс, как в
         старой админке. Откат на общие оставлен на случай пустого ответа старого
         сервера: форма без выпадашек хуже формы с длинными. */
      evfLists = methodLists(d);
      applyMethod();
      fillSelect(el("evfSystem"), d.systems);
      /* Базы — из справочника flow.d_database: на колонке database висит внешний ключ,
         и значение вне справочника упало бы уже на вставке. */
      fillSelect(el("evfDatabase"), d.databases, "Select option");
      if (el("evfDatabase") && (d.databases || []).indexOf("crmdb") >= 0) {
        el("evfDatabase").value = "crmdb";
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
        ? { keys: mine.map(function (r) { return r.definitionKey; }),
            prefs: mine.map(function (r) { return r.businessKeyPrefix; }),
            channels: m === "batch" ? uniq(mine.map(function (r) { return r.notifyChannel; }))
                                    : d.notifyChannels }
        : { keys: d.definitionKeys, prefs: d.businessKeyPrefixes, channels: d.notifyChannels };
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
    if (n === 1) {
      if (!str("evfName")) return wzFail("Не заполнено имя события (event_name)");
      if (!str("evfChannel")) return wzFail("Не выбран канал (notify_channel)");
      if (!str("evfDatabase")) return wzFail("Не выбрана база выборки (database)");
      if (!str("evfCrontab")) return wzFail("Пустое выражение расписания");
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
      if (!str("evfFinalTable")) {
        return wzFail("Не указана итоговая таблица — из неё читает итоговый скрипт");
      }
      return true;
    }
    if (n === 3) {
      var tpl = collectFormTemplates();
      if (!tpl.length) return wzFail("Не задано ни одного шаблона");
      var days = {};
      for (var i = 0; i < tpl.length; i++) {
        var d = tpl[i].stepNo;
        if (tpl.length > 1 && d == null) {
          return wzFail("Шаблонов несколько — у каждого должен быть свой день");
        }
        if (d != null && days[d]) return wzFail("День " + d + " указан дважды");
        if (d != null) days[d] = true;
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

  /* Лишние поля прячем, а не выключаем: «N» при «каждый день» ничего не значит, и
     видимое неактивное поле человек всё равно пробует заполнить. */
  function renderCron() {
    var freq = str("evfFreq");
    var unit = EVERY_UNITS[freq];
    var needN = !!unit;
    if (el("evfEveryBox")) el("evfEveryBox").hidden = !needN;
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
    if (el("evfDomBox")) el("evfDomBox").hidden = freq !== "monthly";
    if (el("evfDowBox")) el("evfDowBox").hidden = freq !== "dow";
    if (el("evfCronManual") && el("evfCronManual").checked) { renderCronWords(); return; }
    el("evfCrontab").value = buildCron().expr;
    renderCronWords();
  }

  function renderCronWords() {
    var box = el("evfCronWords");
    if (!box) return;
    if (el("evfCronManual") && el("evfCronManual").checked) {
      box.textContent = "Вручную: секунды минуты часы день-месяца месяц день-недели." +
        " В двух последних полях ровно одно должно быть «?».";
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
    steps.push({
      sql: String(el("evfScript").value || "").trim(),
      orderNum: maxOrd + 10,
      returnsResultSet: true
    });
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
      steps: steps
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
    var rrs = nSteps > 1 ? "false у шагов отбора, true у итогового" : "true";
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
          { name: "flow.d_event_step", rows: nSteps, note: "шаги отбора + итоговый скрипт", cols: [
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
            col("allow_ml", false)
          ] },
          { name: "scheduler.t_launch_settings", rows: 1, note: "прод-расписание", cols: [
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
            colAuto("get_event_id", "id из scheduler.t_get_event"),
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

  function openPlan(body) {
    var groups = planGroups(body);
    var tables = 0, rows = 0;
    groups.forEach(function (g) {
      g.tables.forEach(function (t) { tables++; rows += t.rows; });
    });
    el("evfPlanSum").textContent = tables + " таблиц · " + nRow(rows);
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

  /* ОТЛАДОЧНЫЙ РЕЖИМ: собираем запрос, показываем план записи окном и тело запроса на
     экране — на сервер не уходит ничего. Пока идёт сверка, реальная вставка запрещена:
     она пишет и в нашу модель, и в боевые таблицы, а откатывать ошибочно заведённое
     событие приходится руками в psql.

     Чтобы включить отправку обратно — раскомментировать блок ниже ВМЕСТЕ с проверкой
     права: предпросмотр безобиден и открыт всем, кто видит форму, а заведение события
     требует add в ev-offline. */
  function submitOffline() {
    var i;
    for (i = 1; i < WZ_LAST; i++) {
      if (!wzValidate(i)) { wzGo(i); return; }
    }
    var body = offlineBody();
    el("evfPayload").textContent = JSON.stringify(body, null, 2);
    say("evfMsg", "Запрос собран и показан в окне. На сервер ничего не отправлено — режим отладки.", "warn");
    renderResult("evfResult", null);
    openPlan(body);

    /* Боевая отправка (включать вместе со строкой про право):
    if (!can("add", "ev-offline")) { say("evfMsg", "Нет права на заведение событий", "err"); return; }
    evReq("POST", "/offline", body).then(function (res) {
      say("evfMsg", startedText(res), startedKind(res));
      renderResult("evfResult", res);
      if (el("evfName")) el("evfName").value = "";
      stampNow("evfDateStart");
    }).catch(function (e) { fail("evfMsg", e); });
    */
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
    /* Enter в поиске — то же, что «Показать»: набрал и нажал, без похода к кнопке. */
    el("evlQ").onkeydown = function (e) {
      if (e.key === "Enter") { evl.offset = 0; loadList(); }
    };
    evReq("GET", "/list/facets").then(function (f) {
      fillSelect(el("evlChannel"), f.channels, "любой");
    }).catch(function () { /* фильтр по каналу останется пустым, список от этого не зависит */ });
    loadList();
  }

  function listQuery() {
    var p = [];
    function add(k, v) { if (v) p.push(k + "=" + encodeURIComponent(v)); }
    add("q", str("evlQ"));
    add("kind", str("evlKind"));
    add("channel", str("evlChannel"));
    add("active", str("evlActive"));
    add("exported", str("evlExported"));
    p.push("limit=" + evl.limit);
    p.push("offset=" + evl.offset);
    return "?" + p.join("&");
  }

  function loadList() {
    say("evlMsg", "Загружаем…");
    evReq("GET", "/list" + listQuery()).then(function (d) {
      evl.total = Number(d.total || 0);
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
    var html = '<div class="ev-rows"><table><thead><tr>' +
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
        "<td>" + esc(r.event_name) + "</td>" +
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
        '<td><button type="button" class="ev-mini" data-ev-btn="' + esc(r.id) +
          '">Настройки</button></td>' +
        "</tr>" +
        '<tr data-card="' + esc(r.id) + '" style="display:none"><td colspan="11"></td></tr>';
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

  /* Карточка грузится по клику, а не вместе со списком: полная обвязка это ещё шесть
     запросов на строку, и на странице в пятьдесят строк вышло бы триста запросов. */
  function toggleCard(id) {
    var row = el("evlBox").querySelector('[data-card="' + id + '"]');
    if (!row) return;
    if (row.style.display !== "none") { row.style.display = "none"; return; }
    var cell = row.firstChild;
    cell.innerHTML = '<div class="ev-card">Загружаем…</div>';
    row.style.display = "";
    evReq("GET", "/list/" + encodeURIComponent(id)).then(function (d) {
      cell.innerHTML = renderCard(d);
      /* Состояние задания спрашиваем отдельным запросом, а не вместе с карточкой: он
         ходит в чужой сервис, и карточка не должна ждать его или падать вместе с ним. */
      loadCron(id);
    }).catch(function (e) {
      cell.innerHTML = '<div class="ev-card" style="color:var(--red,#e5484d)">' +
        esc((e && e.message) || "Не удалось загрузить карточку") + "</div>";
    });
  }

  function dlist(pairs) {
    var out = "";
    pairs.forEach(function (p) {
      if (p[1] === null || p[1] === undefined || p[1] === "") return;
      out += "<dt>" + esc(p[0]) + "</dt><dd>" + esc(p[1]) + "</dd>";
    });
    return out ? "<dl>" + out + "</dl>" : '<div style="color:var(--faint)">пусто</div>';
  }

  function renderCard(d) {
    var e = d.event || {}, dv = d.delivery || {}, s = d.schedule || {}, st = d.state || {};
    var html = '<div class="ev-card"><h4>Событие</h4>' + dlist([
      ["source", e.source], ["группа", e.group_event_descr], ["описание", e.description],
      ["заведено", String(e.timestamp_cr || "").slice(0, 19).replace("T", " ")]
    ]) + "</div>";

    html += '<div class="ev-card"><h4>Доставка</h4>' + dlist([
      ["канал", dv.notify_channel], ["sub_channel", dv.sub_channel], ["платформа", dv.platform],
      ["задержка", dv.send_delay], ["время жизни", dv.life_time], ["ML", dv.allow_ml ? "да" : null]
    ]) + "</div>";

    if (e.kind === "time") {
      html += '<div class="ev-card"><h4>Расписание</h4>' + dlist([
        ["кронтаб", s.crontab], ["база выборки", s.database],
        ["массовая отправка", s.is_batch ? "да" : "нет"],
        ["попыток", s.max_retry_attempts], ["группа заданий", s.job_group],
        ["фаза", st.phase], ["крон", st.cron_state], ["прошлый прогон", st.last_result],
        ["следующий запуск", st.date_next]
      ]) + "</div>";

      /* Планировщик — отдельным блоком: он про то, знает ли Quartz об этом событии, а
         не про то, что мы записали в расписание. Эти две вещи расходятся, и ровно из-за
         этого заведённое панелью событие могло не сработать ни разу. */
      html += '<div class="ev-card" id="evCron-' + esc(e.id) + '"><h4>Планировщик</h4>' +
        '<div style="color:var(--faint)">читаю…</div></div>';

      var steps = d.steps || [];
      html += '<div class="ev-card" id="evEditSteps-' + esc(e.id) + '"><h4>Шаги выборки (' + steps.length + ")" +
        (canEditEvent() ? ' <button type="button" class="ev-mini" onclick="evEditSteps(' + esc(e.id) + ')">Править</button>' : "") +
        "</h4>";
      html += steps.length ? steps.map(function (x) {
        return '<div style="margin-bottom:8px"><b>' + esc(x.order_num) + ". " + esc(x.process_name || "") + "</b>" +
          (x.returns_result_set ? " · возвращает результат" : "") +
          (x.is_active ? "" : " · выключен") +
          "<pre>" + esc(x.sql_text || "") + "</pre></div>";
      }).join("") : '<div style="color:var(--faint)">нет</div>';
      html += "</div>";
    }

    var tpl = d.templates || [];
    html += '<div class="ev-card" id="evEditTpl-' + esc(e.id) + '"><h4>Шаблоны (' + tpl.length + ")" +
      (canEditEvent() ? ' <button type="button" class="ev-mini" onclick="evEditTemplates(' + esc(e.id) + ')">Править</button>' : "") +
      "</h4>";
    html += tpl.length ? '<div class="ev-rows"><table><tbody>' + tpl.map(function (x) {
      return "<tr><td>" + (x.step_no == null ? "одиночный" : "шаг " + esc(x.step_no)) + "</td>" +
        "<td>" + (x.code ? esc(x.channel) + ":" + esc(x.code) : "не найден у нас") + "</td>" +
        "<td>" + esc(x.communication_name || "") + "</td></tr>";
    }).join("") + "</tbody></table></div>" : '<div style="color:var(--faint)">нет</div>';
    html += "</div>";

    var links = d.links || [];
    if (links.length) {
      html += '<div class="ev-card"><h4>Связи с crmdb (' + links.length + ")</h4>" +
        '<div class="ev-rows"><table><thead><tr><th>Таблица</th><th>наш id</th>' +
        "<th>id в crmdb</th><th>Направление</th></tr></thead><tbody>" +
        links.map(function (x) {
          return '<tr><td class="tbl">' + esc(x.our_table) + "</td><td>" + esc(x.our_id) +
            "</td><td>" + esc(x.prod_id) + "</td><td>" +
            (x.direction === "IMPORT" ? "затянуто из crmdb" : "отправлено в crmdb") + "</td></tr>";
        }).join("") + "</tbody></table></div></div>";
    }
    return html;
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

  function evReloadCard(id) {
    var row = el("evlBox").querySelector('[data-card="' + id + '"]');
    if (!row) return;
    evReq("GET", "/list/" + encodeURIComponent(id)).then(function (d) {
      row.firstChild.innerHTML = renderCard(d);
    });
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
