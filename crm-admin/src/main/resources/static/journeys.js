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
        /* Условие выхода живёт здесь, а не отдельным блоком. Блок в цепочке означает
           «случилось на этом месте», а условие выхода действует всё время, от прихода
           события до последнего шага: поставить его в ряд со ступенями значило бы
           соврать про момент, когда оно работает. Здесь же оно ровно там, где начинается
           поток, и одно на весь поток. На холсте его область показана подсветкой вокруг
           всей цепочки — сам блок её не рисует. */
        { k: "exit_condition",      l: "Отменяющее событие — SQL (обрывает всю цепочку)",
          kind: "textarea" },
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
    /* Старые блоки. Из тулбокса убраны: задержку теперь задаёт Pause, условие —
       Decision, а условие выхода лежит полем в Income event. Описания остаются, чтобы
       схемы, нарисованные до этой правки, открывались как были, а не рассыпались в непонятное. */
    timer: {
      label: "Таймер (старый блок)", cls: "logic", outs: 1,
      fields: [
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
      label: "Step exit (старый блок)", cls: "logic", outs: 1,
      fields: [
        { k: "event_name", l: "Событие, отменяющее шаг — SQL", kind: "textarea" }
      ]
    },
    ifCheck: {
      label: "Проверка (if) — старый блок", cls: "logic", outs: 1,
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
    /* Своих блоков под оффлайн-процесс нет и не будет: он раскладывается тем же
       набором, что и всё остальное. Внешняя таблица — это Get Records, шаг, который
       создаёт таблицу, — Create Records, ветка матрицы шаблонов — Decision, отправка —
       Communication Alert. Заводить «Внешнюю таблицу» и «Шаг выборки» значило бы
       завести второе имя тому, что уже есть. */
    /* Карточка-примечание: ни входов, ни выходов. Нужна для того, что к схеме
       относится, но данных не даёт, — расписание, база, оговорки по процессу.
       Вести к такому стрелку значило бы соврать: стрелка на схеме — поток данных. */
    noteCard: {
      label: "Примечание", cls: "note", ins: 0, outs: 0,
      fields: [
        { k: "title", l: "Заголовок", kind: "text" },
        { k: "note",  l: "Текст",     kind: "textarea" }
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
    /* Decision — проверка перед шагом. Да — условие выполнилось, ЭТОТ шаг отменяется
       и цепочка идёт к следующему; нет — шаг отрабатывает как обычно. В таблице это
       exit_step той самой строки, чью коммуникацию проверка и отменяет: она снимает
       текущий шаг, а не следующий, и поток на этом не заканчивается. */
    decision: {
      label: "Decision", cls: "logic", outs: 2, outLabels: ["Да", "Нет"],
      fields: [
        { k: "title", l: "Название", kind: "text" },
        { k: "sql",   l: "Условие — SQL (SELECT 1 → да)", kind: "textarea" },
        /* Метка, а не тип блока: движок умеет ровно одну проверку — снятие шага
           (колонка exit_step), но проверок на схеме рисуют больше, чем он исполняет.
           Отдельный тип блока под step exit мы уже убирали: два блока под одну колонку
           означали два способа сказать одно. Метка же говорит про ту же самую
           проверку, исполняется она или пока только нарисована. */
        { k: "step_exit", l: "Это step exit — отменяет этот шаг, цепочка идёт к следующему",
          kind: "bool", def: "false" }
      ]
    },
    /* Pause — задержка перед шагом. Отсчёт от прихода события, а не от предыдущей
       отправки: так расписание всей цепочки известно в момент старта и не плывёт,
       если один шаг задержался. Раньше здесь были дни и «до события» — ни того, ни
       другого в commapi.events_chain нет, там одна колонка wait_time в минутах. */
    pause: {
      label: "Pause", cls: "logic", outs: 1,
      fields: [
        { k: "wait_time", l: "Задержка от события, мин", kind: "number", def: "0" },
        { k: "note",      l: "Комментарий",                 kind: "textarea" }
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
        /* Здесь же живёт тело шага оффлайн-процесса: он не перечисляет поля, а целиком
           задаётся запросом. Обвязка (drop / create / distributed by / GRANT) сюда не
           входит — она одинакова у всех шагов и пишется не руками. */
        { k: "fieldsMap", l: "Поля (поле=значение) или SQL шага", kind: "textarea" }
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

  /* Дни расписания сжатым списком: «1–5, 12–14, 26–28». Двадцать шесть чисел подряд
     на карточку не помещаются, а понять с одного взгляда надо другое: сплошная это
     серия или редкие точки — то есть шлём каждый день или через раз. */
  function dayRanges(lines) {
    var days = lines.map(function (l) {
      var m = String(l).match(/(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    }).filter(function (d) { return d != null; }).sort(function (a, b) { return a - b; });
    var out = [], i = 0;
    while (i < days.length) {
      var j = i;
      while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++;
      /* Тире только для серии от трёх: «1–2» короче «1, 2» ровно на ничего, а читается
         как диапазон там, где его нет. */
      out.push(j > i + 1 ? days[i] + "–" + days[j] : days.slice(i, j + 1).join(", "));
      i = j + 1;
    }
    return out.join(", ");
  }

  /* Условие выхода на блоке — одной строкой. В таблице оно лежит целым SQL на
     полтора экрана: показать его как есть значило бы вместо схемы получить простыню,
     а спрятать совсем — соврать, что условия нет. Поэтому вытаскиваем имена событий,
     ради которых запрос и написан, а полный текст оставляем в подсказке при наведении. */
  /* Имена событий из условия. Смотрим именно на event_name: в запросе есть и другие
     строковые литералы, и брать подряд всё в кавычках значит однажды выдать за событие
     кусок чужого сравнения. Оба написания разбираем — и цепочку OR, и IN (...).

     Если шаблон не наш, возвращаемся к «всё, что в кавычках»: показать лишнее лучше,
     чем промолчать о том, что условие вообще есть. */
  function eventNames(v) {
    var s = String(v == null ? "" : v);
    var re = /event_name\s*(?:=|!=|<>)\s*'([^']*)'|event_name\s+in\s*\(([^)]*)\)/gi;
    var out = [], m;
    while ((m = re.exec(s))) {
      if (m[1]) out.push(m[1]);
      else (m[2].match(/'[^']*'/g) || []).forEach(function (q) { out.push(q.slice(1, -1)); });
    }
    if (!out.length) {
      out = (s.match(/'[A-Za-z_][A-Za-z0-9_.]*'/g) || []).map(function (q) { return q.slice(1, -1); });
    }
    return out.filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  }

  function condWords(v) {
    var s = String(v == null ? "" : v).trim();
    if (!s) return "";
    var names = eventNames(s);
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
      case "startIncome": {
        var head = [d.event_name || "событие не задано", d.system].filter(Boolean).join(" · ");
        return [head, d.exit_condition ? "отменяет всё: " + condWords(d.exit_condition) : null]
          .filter(Boolean).join("\n");
      }
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
      case "pause":
      case "timer":
        return [waitWords(d.wait_time) + "\nотсчёт от прихода события", d.note]
          .filter(Boolean).join("\n");
      case "flowExit":
        return d.event_name
          ? "обрывает всю цепочку:\n" + condWords(d.event_name)
          : "условие не задано";
      case "stepExit":
        return d.event_name
          ? "отменяет этот шаг:\n" + condWords(d.event_name)
          : "условие не задано";
      case "ifCheck":
        return [condWords(d.expr) || "условие не задано", d.note].filter(Boolean).join("\n");
      /* Блоки данных: сверху что делает шаг, снизу таблица. Условие отбора и SQL —
         в подсказке при наведении: на карточке в 230 пикселей они не помещаются, а
         обрезанный по середине запрос хуже отсутствующего. */
      case "getRecords":
      case "createRecords":
      case "updateRecords":
      case "deleteRecords":
        return [d.title, d.object, d.into ? "→ " + d.into : null]
          .filter(Boolean).join("\n");
      case "noteCard":
        /* Пустая карточка — просто рамка, по которой не догадаться, что делать.
           Подсказка исчезает, как только в заметке появляется текст. */
        return d.note || "двойной клик — вписать заметку";
      case "subflow": {
        var j = listCache.filter(function (x) { return x.id === d.journey; })[0];
        return j ? "→ " + j.name : "цепочка не выбрана";
      }
      case "decision":
        return [d.title,
                (d.sql || "").trim() ? condWords(d.sql) : "условие не задано",
                d.step_exit === "true"
                  ? "да — шаг отменён, идём к следующему\nнет — шаг отрабатывает"
                  : "да / нет — ветки проверки"].filter(Boolean).join("\n");
      case "assignment":
        return d.variable ? d.variable + " = " + (d.value || "") : (d.title || "");
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
    if (type === "startIncome") return d.exit_condition || "";
    if (type === "flowExit" || type === "stepExit") return d.event_name || "";
    if (type === "ifCheck") return d.expr || "";
    if (type === "decision") return d.sql || "";
    if (type === "createRecords" || type === "updateRecords") return d.fieldsMap || "";
    if (type === "getRecords" || type === "deleteRecords") return d.filter || "";
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
    /* Метка step exit — на самой карточке: исполняется эта проверка или пока только
       нарисована, видно на схеме, а не по двойному клику. */
    var tag = (type === "decision" && d && d.step_exit === "true")
      ? '<span class="jrn-tag">step exit</span>' : "";
    /* У примечания в заголовке — его собственное название: карточка с надписью
       «Примечание» на схеме, где их несколько, не отличается одна от другой. */
    var head = (type === "noteCard" && d && d.title) ? esc(d.title) : t.label;
    var html = '<div class="jrn jrn-' + t.cls + chCls + '"' +
      (tip ? ' title="' + esc(tip) + '"' : "") + ">" +
      '<div class="jrn-head">' + head + tag + "</div>" +
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
    /* Старые Pause считали дни, новый — минуты от события: в commapi.events_chain
       колонка одна, wait_time в минутах. Пересчитываем, а не обнуляем: у нарисованных
       раньше схем «ждать 3 дня» — это осмысленное число, и терять его нельзя. */
    if (type === "pause" && data.wait_time == null && data.duration != null) {
      var days = parseInt(data.duration, 10);
      data.wait_time = String(isFinite(days) ? days * 1440 : 0);
      if (data.until && !data.note) data.note = "Раньше стояло «до события " + data.until + "»";
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
    /* Класс по типу узла — отдельной строкой: classList.add со списком через пробел
       падает, а Drawflow принимает ровно один класс. Нужен, чтобы подписать выходы
       Decision («да»/«нет») в CSS: у Loop выходы те же два, но значат другое. */
    var el = nodeElById(id);
    if (el) el.classList.add("jrn-t-" + type);
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
    /* Рамка по пустому месту (capture — чтобы Drawflow не начал панораму канвы).
       Сброс выделения делается здесь же, а не отдельным обработчиком: этот стоит на
       перехвате и глушит событие, так что до обработчиков на всплытии оно не доходит —
       отдельный «сбросить по клику мимо» просто не вызывался, и выделение не
       отпускалось. Одно нажатие — одно место, где решают, что с выделением. */
    host.addEventListener("mousedown", function (e) {
      if (!canEdit() || e.button !== 0) return;
      if (e.shiftKey) return;                       // Shift — панорама холста, её ведёт Drawflow
      if (e.target.closest(".drawflow-node")) return;
      e.preventDefault();
      e.stopPropagation();
      /* Ctrl — добавить к выделению рамкой, без него — начать заново. Поэтому простой
         щелчок мимо блоков и снимает выделение: рамка нулевого размера ничего не
         добавит, а сброс уже случился. */
      if (!e.ctrlKey && !e.metaKey) clearSel();
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
      /* Взяли блок мимо выделения — выделение снимается: тащить хотят именно его,
         а оставленная подсветка на других блоках обещала бы, что поедут и они. */
      if (!e.ctrlKey && !e.metaKey && !groupSel.has(id)) clearSel();
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
      renderExitScope();   // рамка группировки уехала — область условия за ней
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
    /* Колесо масштабирует без модификаторов: на схеме прокручивать нечего, холст
       двигают Shift+протягиванием. На перехвате и с остановкой — у Drawflow свой зум
       на Ctrl+колесо, и без этого при зажатом Ctrl складывались бы два разных шага. */
    host.addEventListener("wheel", function (e) {
      if (!editor) return;
      e.preventDefault();
      e.stopPropagation();
      var r = host.getBoundingClientRect();
      zoomTo(editor.zoom * (e.deltaY > 0 ? 1 / ZOOM.step : ZOOM.step),
             e.clientX - r.left, e.clientY - r.top);
    }, { capture: true, passive: false });
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
    /* Сам переключатель уехал в модалку заведения, но тип открытой цепочки надо видеть
       и потом: от него зависит, что вообще значат блоки на холсте. */
    var lab = document.getElementById("jrKindLabel");
    if (lab) lab.textContent = offline ? "offline · по расписанию" : "online · от события";
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
    }).catch(function (e) {
      /* Список сохранённых цепочек — не вся работа раздела: завести новую можно, не
         открыв ни одной. Раньше отказ /api/journeys рвал всю цепочку промисов, и
         дальше не выполнялось ничего: ни списка, ни модалки заведения, ни причины —
         раздел просто оставался пустым до первого нажатия кнопки. Теперь отказ
         остаётся внутри списка и о нём написано. */
      if (window.console) console.error("Цепочки: /api/journeys не ответил", e);
      listCache = [];
      var sel = document.getElementById("jrSelect");
      if (sel) sel.innerHTML = '<option value="">— список не загрузился —</option>';
      sectionNote("Список сохранённых цепочек не загрузился: " + why(e) +
        ". Завести новую можно, открыть сохранённую — нет.");
      return [];
    });
  }

  /* Сообщение о неполадке в строке подсказок: alert посреди открытия раздела человек
     закрывает не читая, а молчание он принимает за «раздел сломан целиком». */
  function sectionNote(text) {
    var hint = document.getElementById("jrHint");
    if (!hint) return;
    hint.textContent = text;
    hint.style.color = "var(--coral)";
  }

  /* Причина отказа одной строкой. В сообщении может лежать целая страница ошибки от
     сервера — вывалить её в подсказку значит закрыть простынёй весь раздел. */
  function why(e) {
    var s = (e && e.message ? e.message : String(e == null ? "" : e)).trim();
    s = s.split("\n")[0];
    return s.length > 120 ? s.slice(0, 117) + "…" : (s || "причина не названа");
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
  var trackerEvents = null, trackerEventsP = null, trackerEventsErr = null;
  /* Причину неудачи храним рядом со списком: раньше любой отказ превращался в пустой
     массив, и модалка объявляла «база не подключена» — единственную причину, которую
     умела назвать. На проде база подключена, а список всё равно был пуст, и человек
     шёл проверять настройки подключения вместо настоящей ошибки. */
  function loadTrackerEvents() {
    if (trackerEventsP) return trackerEventsP;
    trackerEventsP = fetch("api/events/chains", {
        credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null;
          try { j = t ? JSON.parse(t) : null; } catch (e) { /* не json — покажем как есть */ }
          if (!r.ok) throw new Error((j && j.message) || t || ("HTTP " + r.status));
          return j || [];
        });
      })
      .then(function (list) { trackerEvents = list; trackerEventsErr = null; return trackerEvents; })
      .catch(function (e) {
        trackerEvents = [];
        trackerEventsErr = (e && e.message) || String(e);
        /* Кэш сбрасываем: неудача не должна держаться до перезагрузки страницы —
           модалку открывают повторно именно затем, чтобы попробовать ещё раз. */
        trackerEventsP = null;
        return trackerEvents;
      });
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
            (ev.steps == null ? " · цепочка неизвестна"
                              : ev.steps ? " · шагов: " + ev.steps : " · цепочки нет");
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
    renderExitScope();   // условие могли поменять прямо сейчас
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
    /* Блок вне цепочки — блок ни о чём: шаг существует только внутри потока, у него
       есть событие-старт, название и условие выхода, и без них он никуда не уедет.
       Поэтому первым делом заводят цепочку, а не кладут блок на пустой холст.

       Примечание — исключение: оно не часть потока, а подпись к нему. Требовать
       цепочку ради заметки значило бы запретить записать мысль до того, как решено,
       что именно рисуем. */
    if (type !== "noteCard" &&
        findNodeByType("startIncome") == null && findNodeByType("startTime") == null) {
      alert("Сначала заведите цепочку: у неё есть стартовое событие, название и"
            + " отменяющее событие — без них блоку негде стоять.");
      window.jrNew();
      return;
    }
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

    /* Идём ПО СТРЕЛКАМ от старта, а не по порядку создания узлов. Pause и Decision —
       накопители: они задают колонки того шага, который идёт за ними. По порядку
       создания накопитель лёг бы не на тот шаг, стоило человеку переставить блок.

       У Decision с меткой step exit продолжение — ветка «нет» (output_2): «да»
       означает, что шаг снят, и дальше по цепочке оттуда не идут. У проверки без
       метки такого правила нет, и первой пробуем обычную ветку «да». Если выбранная
       никуда не ведёт, берём вторую — обрывать обход из-за этого нельзя. */
    var seq = [], seen = {}, cur = startKey;
    while (cur && !seen[cur]) {
      seen[cur] = true;
      seq.push(cur);
      var o = raw[cur].outputs || {};
      var isStepExit = raw[cur].name === "decision" && (raw[cur].data || {}).step_exit === "true";
      var order = isStepExit ? ["output_2", "output_1"] : ["output_1", "output_2"];
      var port = null;
      order.forEach(function (name) {
        var cand = o[name];
        if (!port && cand && (cand.connections || []).length) port = cand;
      });
      var link = port && port.connections && port.connections[0];
      cur = link ? String(link.node) : null;
    }

    /* Условие выхода берём из блока Income event: оно одно на цепочку и лежит там.
       Блок Flow exit остался только у схем, нарисованных до этой правки, — их читаем
       по-старому, чтобы уже нарисованное не пришлось перекладывать заново. */
    var steps = [], exitCondition = String(start.exit_condition || "").trim();
    var pendingWait = "", pendingExit = "", ignored = {};
    seq.forEach(function (k) {
      var n = raw[k], d = n.data || {};
      switch (n.name) {
        case "startIncome": break;
        /* timer и stepExit — блоки старых схем, читаем наравне с новыми: перекладывать
           уже нарисованное только ради переименования блоков незачем. */
        case "pause":
        case "timer":    pendingWait = d.wait_time || "0"; break;
        case "decision":
          /* Без метки step exit проверку движок не исполняет: в таблице под неё нет
             колонки. Молча взять её SQL как снятие шага значило бы завести не то,
             что нарисовано, — поэтому такая проверка попадает в список неисполняемых
             блоков, о котором спрашивают перед заведением. */
          if (d.step_exit === "true") pendingExit = d.sql || "";
          else ignored["Decision без метки «step exit»"] = true;
          break;
        case "stepExit": pendingExit = d.event_name || ""; break;
        case "flowExit":
          /* Старая схема: условие стояло отдельным блоком. Берём его, только если в
             Income event пусто — там теперь источник, и молча перекрыть его блоком
             значило бы завести не то, что человек видит в стартовом узле. */
          if (exitCondition && d.event_name && d.event_name !== exitCondition) {
            alert("Условие выхода задано и в блоке Income event, и в старом блоке Flow exit,"
                  + " и они разные. Оставлено то, что в Income event: условие одно на цепочку."
                  + "\nЛишний блок Flow exit лучше убрать с холста.");
            break;
          }
          exitCondition = exitCondition || d.event_name || "";
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

     Условия выхода в ряду нет вовсе: оно действует всё время, а не на своём месте
     в цепочке. Лежит оно в блоке Income event, а докуда достаёт — видно по подсветке
     вокруг всей схемы (renderExitScope).

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

    /* prevPort — из какого выхода предыдущего блока выходит стрелка. У Decision
       продолжение цепочки идёт веткой «нет»: «да» означает, что шаг снят, и вести
       оттуда некуда. Поэтому порт запоминается, а не берётся всегда первым. */
    var prevPort = "output_1";
    /* Проверка, чья ветка «да» ещё не привязана: она ведёт не в тупик, а к первому
       блоку следующего шага — привязать её можно только когда тот появится. */
    var pendingYes = null;
    function block(type, x, y, props, extra) {
      var id = "c" + (++seq);
      nodes.push(Object.assign({ id: id, type: type, posX: x, posY: y, props: props || {} }, extra || {}));
      if (prev) edges.push({ from: prev, to: id, fromPort: prevPort });
      prev = id;
      prevPort = type === "decision" ? "output_2" : "output_1";
      return id;
    }
    var x = LAY.x0, y = LAY.y0;
    block("startIncome", x, y, {
      /* id события подставляем только когда цепочку открыли из этого же контура.
         В примере он остаётся пустым: чужой id предложил бы завести цепочку не тому. */
      t_event_comm_id: opts.bindEvent && ch.id != null ? String(ch.id) : "",
      event_name: ch.eventName || "",
      system: ch.system || "",
      exit_condition: exit
    });
    x += LAY.pitch;

    steps.forEach(function (s, i) {
      var blocks = [];
      var w = Number(s.waitTime);
      if (isFinite(w) && w > 0) blocks.push({ t: "pause", props: { wait_time: String(w) } });
      if (s.exitStep) {
        blocks.push({ t: "decision", props: { sql: s.exitStep, step_exit: "true" },
                      extra: { title: "Событие, отменяющее шаг, было?" } });
      }
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
      var first = null;
      blocks.forEach(function (b) {
        var id = block(b.t, x, y, b.props, b.extra);
        if (!first) {
          first = id;
          /* Ветка «да» проверки из предыдущего шага ведёт сюда: условие выхода
             выполнилось — тот шаг отменён, и цепочка продолжается со следующего.
             Оставить «да» ни с чем значило бы нарисовать конец потока там, где он
             на самом деле идёт дальше. */
          if (pendingYes) {
            edges.push({ from: pendingYes, to: id, fromPort: "output_1" });
            pendingYes = null;
          }
        }
        if (b.t === "decision") pendingYes = id;
        x += LAY.pitch;
      });
      if (i < steps.length - 1) {
        y += LAY.row;
        x = x - LAY.pitch + LAY.indent;   // ниже и правее последней коммуникации
      }
    });

    return { id: null, name: name, kind: "online", nodes: nodes, edges: edges };
  }

  /* Область действия отменяющего события. Условие обрывает поток на любом шаге, а не
     на своём месте в ряду, — значит и на схеме ему не место в ряду. Рисуем его
     подсветкой вокруг всей цепочки: сразу видно, докуда оно достаёт, и ни одна
     ступень не делает вид, будто условие относится к ней одной.

     Это не узел. У узла есть координаты, которые кто-то передвинет, и своя копия
     условия, которая разойдётся с полем в Income event. Полоса живёт на самом холсте
     и каждый раз пересчитывается от того, что на нём сейчас лежит, — расходиться
     нечему. */
  function renderExitScope() {
    if (!editor || !editor.precanvas) return;
    var start = findNodeByType("startIncome");
    var n = start == null ? null : editor.getNodeFromId(start);
    var cond = n ? String((n.data || {}).exit_condition || "").trim() : "";

    /* Имена событий — строкой над холстом, а не на самом холсте. На холсте они ездят
       вместе со схемой и мельчают вместе с ней: у цепочки в три шага масштаб уходит
       к трети, и список, ради которого всё затевалось, читать нельзя. Наверху он
       всегда на месте и всегда одного размера. */
    var bar = document.getElementById("jrExitBar");
    if (bar) {
      var pop = document.getElementById("jrExitPop");
      var cnt = document.getElementById("jrExitCount");
      if (!cond) {
        bar.style.display = "none";
        if (pop) { pop.style.display = "none"; pop.innerHTML = ""; }
        bar.removeAttribute("title");
      } else {
        var names = eventNames(cond);
        bar.style.display = "";
        bar.title = cond;
        /* Сколько их — на самой кнопке: это то единственное, что нужно знать не
           открывая список. Имена — внутри. */
        if (cnt) {
          cnt.textContent = names.length
            ? names.length + " " + plural(names.length, "событие", "события", "событий")
            : "условие задано";
        }
        if (pop) {
          pop.innerHTML = names.length
            ? names.map(function (nm) { return "<i>" + esc(nm) + "</i>"; }).join("")
            : '<i class="jr-exit-raw">' + esc(condWords(cond)) + "</i>";
        }
      }
    }

    /* На холсте остаётся сама область: докуда условие достаёт. Подпись короткая —
       перечислять события ещё и здесь значило бы держать один список в двух местах
       и однажды показать в них разное. */
    var box = document.getElementById("jrExitScope");
    var els = document.querySelectorAll("#jrCanvas .drawflow-node");
    /* Пока в цепочке один блок, обводить нечего: подсветка вокруг одного узла
       читалась бы как свойство этого узла — ровно то, от чего мы уходим. */
    if (!cond || els.length < 2) {
      if (box) box.remove();
      return;
    }
    if (!box) {
      box = document.createElement("div");
      box.id = "jrExitScope";
      box.innerHTML = '<div class="jr-exit-tag"><b>Отменяющее событие</b></div>';
      editor.precanvas.insertBefore(box, editor.precanvas.firstChild);
    }
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    els.forEach(function (el) {
      x1 = Math.min(x1, el.offsetLeft);
      y1 = Math.min(y1, el.offsetTop);
      x2 = Math.max(x2, el.offsetLeft + el.offsetWidth);
      y2 = Math.max(y2, el.offsetTop + el.offsetHeight);
    });
    var pad = 28, padTop = 44;
    box.style.left = (x1 - pad) + "px";
    box.style.top = (y1 - padTop) + "px";
    box.style.width = (x2 - x1 + pad * 2) + "px";
    box.style.height = (y2 - y1 + padTop + pad) + "px";
    box.title = cond;
  }

  /* Список отменяющих событий: развернуть и свернуть. Закрывается кликом мимо —
     иначе висел бы поверх холста, пока о нём не вспомнят. */
  window.jrExitToggle = function () {
    var pop = document.getElementById("jrExitPop");
    if (!pop) return;
    pop.style.display = pop.style.display === "none" ? "" : "none";
  };
  /* На перехвате: рамка выделения слушает mousedown на холсте тоже на перехвате и
     глушит событие stopPropagation'ом. Обычный обработчик на document до клика по
     холсту не доходил вовсе — список оставался открытым поверх схемы. */
  document.addEventListener("mousedown", function (e) {
    var pop = document.getElementById("jrExitPop");
    var bar = document.getElementById("jrExitBar");
    if (!pop || pop.style.display === "none") return;
    if (bar && bar.contains(e.target)) return;
    pop.style.display = "none";
  }, true);

  /* Уместить всё на экран. Раскладка уходит вправо по диагонали, и у цепочки из
     трёх шагов правый край уже за пределами холста: без этой кнопки человек ищет
     свои же блоки колесом мыши. */
  /* ------------------------------------------------------------------ масштаб
     Родной зум Drawflow не годится по трём причинам сразу. Он ограничен снизу
     половиной — а оффлайн-процесс на 238 блоков занимает восемь тысяч точек по
     ширине и целиком не помещается ни при каком разрешении. Он прибавляет к
     масштабу постоянные 0,1 — от 0,15 это увеличение в полтора раза, от 1,5 —
     на седьмую часть, то есть у мелкого шаг грубый, а у крупного бесполезный.
     И он тянет схему к началу координат: целишься в блок, а тот уезжает за край.

     Поэтому свой: шаг кратный, пределы шире, а точка, на которую смотришь,
     остаётся на месте. Для этого же в CSS у холста transform-origin: 0 0 — без
     него начало отсчёта плавает вместе с размером окна. */
  var ZOOM = { min: 0.08, max: 2.5, step: 1.12 };

  function zoomTo(z, cx, cy) {
    if (!editor || !editor.precanvas) return;
    var host = document.getElementById("jrCanvas");
    if (cx == null) { cx = host.clientWidth / 2; cy = host.clientHeight / 2; }
    var z0 = editor.zoom || 1;
    z = Math.min(ZOOM.max, Math.max(ZOOM.min, z));
    /* Точка схемы под курсором до и после должна оказаться в одном месте экрана. */
    editor.canvas_x = cx - (cx - editor.canvas_x) * (z / z0);
    editor.canvas_y = cy - (cy - editor.canvas_y) * (z / z0);
    editor.zoom = z;
    editor.zoom_last_value = z;
    editor.precanvas.style.transform =
      "translate(" + editor.canvas_x + "px, " + editor.canvas_y + "px) scale(" + z + ")";
    showZoom();
    hidePopups();
  }

  function showZoom() {
    var el = document.getElementById("jrZoomPct");
    if (el && editor) el.textContent = Math.round(editor.zoom * 100) + "%";
  }

  window.jrZoomIn = function () { zoomTo((editor ? editor.zoom : 1) * ZOOM.step); };
  window.jrZoomOut = function () { zoomTo((editor ? editor.zoom : 1) / ZOOM.step); };
  window.jrZoom100 = function () { zoomTo(1); };

  /* Уместить всё на экран. Раскладка уходит вправо, и у длинной схемы правый край
     давно за пределами холста: без этой кнопки человек ищет свои же блоки колесом. */
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
    /* Сверху единица: у схемы из трёх блоков растягивать её на весь экран незачем —
       «уместить» означает «показать всё», а не «увеличить до упора». */
    var z = Math.min((host.clientWidth - pad * 2) / Math.max(1, x2 - x1),
                     (host.clientHeight - pad * 2) / Math.max(1, y2 - y1), 1);
    z = Math.max(ZOOM.min, z);
    editor.zoom = z;
    editor.zoom_last_value = z;
    editor.canvas_x = pad - x1 * z;
    editor.canvas_y = pad - y1 * z;
    editor.precanvas.style.transform =
      "translate(" + editor.canvas_x + "px, " + editor.canvas_y + "px) scale(" + z + ")";
    showZoom();
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
     из десяти событий), второй шаг отменяется отдельно — звонком телеконтакта.

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

  /* Тип цепочки спрашивается здесь же, первым вопросом, и из шапки холста уехал.
     Онлайн и оффлайн — это не настройка уже нарисованной цепочки, а развилка в самом
     начале: у них разные стартовые блоки и разный смысл почти всех полей. Переключатель
     над готовым холстом обещал, что цепочку можно переобуть на ходу, — а нельзя. */
  var NEW_TYPES = [
    { k: "online", t: "Онлайн-цепочка",
      d: "Стартует от входящего события из tracker.t_event_comm. Шаги отсчитываются от прихода события." },
    { k: "offline", t: "Оффлайн-цепочка",
      d: "Ретеншен по расписанию: стартует Time event по крону, кого брать — задаётся SQL-шагами." }
  ];

  function renderNewTypes() {
    var kind = document.getElementById("jrKind").value === "offline" ? "offline" : "online";
    var box = document.getElementById("jrNewTypes");
    if (box) {
      box.innerHTML = NEW_TYPES.map(function (t) {
        return '<button type="button" class="jr-card' + (t.k === kind ? " sel" : "") +
          '" onclick="jrNewType(\'' + t.k + '\')">' +
          '<div class="jr-card-t">' + esc(t.t) + '</div>' +
          '<div class="jr-card-d">' + esc(t.d) + "</div></button>";
      }).join("");
    }
    document.querySelectorAll("#jrNewChain .jr-only-online").forEach(function (el) {
      el.style.display = kind === "online" ? "" : "none";
    });
    document.querySelectorAll("#jrNewChain .jr-only-offline").forEach(function (el) {
      el.style.display = kind === "offline" ? "" : "none";
    });
  }

  window.jrNewType = function (kind) {
    document.getElementById("jrKind").value = kind === "offline" ? "offline" : "online";
    window.jrKindChanged();
    renderNewTypes();
  };

  /* ------------------------------------------ раскладка оффлайн-процесса (граф)
     Шаг встаёт в колонку по длине самого длинного пути до него: слева то, с чего
     процесс начинается, справа — то, что зависит от всего остального. Раскладывать
     по номерам ORDER_NUM было бы неверно: у воронки МФО двадцатый шаг не зависит ни
     от чего и мог бы считаться первым, а номер ставит его в середину.

     Колонки выравниваются по общей середине: длинная цепочка идёт прямой линией, а
     веер входов расходится вокруг неё, а не жмётся к верхнему краю. */
  var DAG = { x0: 60, y0: 70, pitch: 300, row: 190 };

  function layoutDag(items) {
    var byId = {};
    items.forEach(function (n) { byId[n.id] = n; });
    var level = {};
    function lvl(id) {
      if (level[id] != null) return level[id];
      level[id] = 0;                       // на время счёта: защита от кольца в данных
      var m = 0;
      (byId[id].from || []).forEach(function (f) {
        if (byId[f]) m = Math.max(m, lvl(f) + 1);
      });
      level[id] = m;
      return m;
    }
    items.forEach(function (n) { lvl(n.id); });

    var cols = {}, tallest = 0;
    items.forEach(function (n) {
      var k = level[n.id];
      (cols[k] = cols[k] || []).push(n);
      tallest = Math.max(tallest, cols[k].length);
    });
    Object.keys(cols).forEach(function (k) {
      var col = cols[k], off = (tallest - col.length) / 2;
      col.forEach(function (n, i) {
        n.posX = DAG.x0 + Number(k) * DAG.pitch;
        n.posY = DAG.y0 + (off + i) * DAG.row;
      });
    });
    return items;
  }

  /* Пример оффлайн-процесса — настоящая воронка МФО из прода. Данные лежат отдельным
     файлом: это большой кусок SQL, и мешать его с логикой раздела незачем. */
  window.jrExampleOffline = function () {
    if (!ensureEditor()) return;
    if (!canEdit()) { alert("Раздел открыт только на просмотр."); return; }
    var ex = window.JR_OFFLINE_EXAMPLE;
    if (!ex) {
      alert("Файл примера js/journeys-offline-example.js не загрузился — обновите страницу с Ctrl+F5.");
      return;
    }

    /* ---- 1. Подготовка данных: те же блоки, что и везде.
       Внешняя таблица — это Get Records, шаг, создающий таблицу, — Create Records,
       финальная выборка — снова Get Records: она возвращает строки, а не создаёт
       таблицу. Отдельных «Внешней таблицы» и «Шага выборки» не заводим: это было бы
       второе имя тому, что уже есть. */
    var items = ex.steps.map(function (s) {
      var props, type;
      if (s.role === "source") {
        type = "getRecords";
        props = { title: s.note || "", object: s.table || "", filter: "", into: "" };
      } else if (s.role === "audience") {
        type = "getRecords";
        props = { title: "Шаг " + s.order + " · " + (s.note || ""),
                  object: "core.mfo_sms_funnel_5", filter: s.sql || "", into: "аудитория шаблона" };
      } else {
        type = "createRecords";
        /* Ключ распределения дописываем к запросу комментарием: он часть той самой
           обвязки, отдельного поля под него нет, а терять его нельзя — в Greenplum
           от него зависит, разъедется таблица по сегментам или ляжет в один. */
        props = { title: "Шаг " + s.order + " · " + (s.note || ""),
                  object: s.table || "",
                  fieldsMap: (s.sql || "") +
                    (s.dist && s.dist !== "—" ? "\n-- distributed by (" + s.dist + ")" : "") };
      }
      return { id: s.id, from: (s.from || []).slice(), type: type, props: props };
    });

    /* ---- 2. Матрица шаблонов лестницей Decision, как она и написана в шаге 60:
       сперва «какое последнее действие», внутри — «сколько дней назад», и на каждый
       шаблон своя коммуникация. Ветка ДА ведёт к отправке, ветка НЕТ — к следующей
       проверке: ровно так CASE и выбирает первое совпадение. */
    var comms = ex.comms || [], prevEvent = null;
    comms.forEach(function (c, ci) {
      var eid = "ev_" + c.event;
      items.push({ id: eid, from: prevEvent ? [] : ["s80"], type: "decision", props: {
        title: "Последнее действие — " + c.label + "?",
        sql: "event_check = '" + c.event + "'",
        step_exit: "false"
      }, lane: ci });
      /* Первая проверка висит на выборке, остальные — на ветке НЕТ предыдущей:
         человек попадает ровно в одну ветку, и лестница это показывает. */
      if (prevEvent) items[items.length - 1].fromNo = prevEvent;
      prevEvent = eid;

      var prevDay = null;
      c.days.forEach(function (pair, di) {
        var day = pair[0], tpl = pair[1];
        var did = "d_" + c.event + "_" + day;
        items.push({ id: did, from: prevDay ? [] : [eid], type: "decision", props: {
          title: day + " " + plural(day, "день", "дня", "дней") + " назад",
          sql: c.dateCol + "::date = current_date - " + day,
          step_exit: "false"
        }, lane: ci, rung: di });
        if (prevDay) items[items.length - 1].fromNo = prevDay;
        prevDay = did;

        items.push({ id: "t_" + tpl, from: [], type: "comm", fromYes: did,
          lane: ci, rung: di,
          props: { channel: "sms", template: String(tpl), day: String(day),
                   note: c.label + " · " + day + " " + plural(day, "день", "дня", "дней") + " назад",
                   active: "true" } });
      });
    });

    /* ---- 3. Раскладка. Конвейер данных — слева графом по зависимостям; лестница
       отправок — своей парой колонок на каждое событие: одна под проверки дней, вторая
       под шаблоны. Сто пять шаблонов в один столбец дали бы схему высотой в двадцать
       тысяч точек, в которой не найти ни одного. */
    var flow = items.filter(function (it) { return it.lane == null; });
    layoutDag(flow);
    var right = Math.max.apply(null, flow.map(function (it) { return it.posX; })) + DAG.pitch;
    items.forEach(function (it) {
      if (it.lane == null) return;
      if (it.rung == null) {                       // проверка события — общий столбец
        it.posX = right;
        it.posY = DAG.y0 + it.lane * DAG.row;
      } else {                                     // проверка дня и её шаблон
        it.posX = right + DAG.pitch * (1 + it.lane * 2) + (it.type === "comm" ? DAG.pitch : 0);
        it.posY = DAG.y0 + it.rung * DAG.row;
      }
    });

    var nodes = items.map(function (it) {
      return { id: it.id, type: it.type, posX: it.posX, posY: it.posY, props: it.props };
    });
    var edges = [];
    items.forEach(function (it) {
      (it.from || []).forEach(function (f) { edges.push({ from: f, to: it.id }); });
      /* ДА — первый выход, НЕТ — второй. Об этом же говорят подписи у точек. */
      if (it.fromYes) edges.push({ from: it.fromYes, to: it.id, fromPort: "output_1" });
      if (it.fromNo) edges.push({ from: it.fromNo, to: it.id, fromPort: "output_2" });
    });
    /* Паспорт процесса — слева от схемы и без стрелок: расписание и база данных не
       дают, а стрелка здесь означает поток данных. Слева, а не сверху: высота карточки
       зависит от длины текста, и над первой колонкой она рано или поздно на неё ляжет. */
    nodes.push({ id: "pass", type: "noteCard", posX: DAG.x0 - 330, posY: DAG.y0,
                 props: { title: ex.note.title, note: ex.note.text } });
    renderJourney({ id: null, name: ex.name, kind: "offline", nodes: nodes, edges: edges });
    currentId = null;
    document.getElementById("jrSelect").value = "";
    window.jrFit();
  };

  window.jrNew = function () {
    if (!ensureEditor()) return;
    if (!canEdit()) { alert("Раздел открыт только на просмотр."); return; }
    newPick = null;
    ["jrNewName", "jrNewSystem", "jrNewExit", "jrNewFilter"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = "";
    });
    document.getElementById("jrKind").value = "online";
    refreshContinuesOptions(null);
    renderNewTypes();
    document.getElementById("jrNewChain").style.display = "";
    renderNewList("");
    loadTrackerEvents().then(function () { renderNewList(document.getElementById("jrNewFilter").value); });
    var f = document.getElementById("jrNewFilter");
    if (f) f.focus();
  };

  window.jrNewClose = function () {
    document.getElementById("jrNewChain").style.display = "none";
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
      var why = trackerEvents.length
        ? "Ничего не нашлось. Событие берётся из tracker.t_event_comm — если его там нет, сначала заведите событие."
        : (trackerEventsErr
            ? "Список событий не прочитан: " + trackerEventsErr
            : "В tracker.t_event_comm нет ни одного события.");
      box.innerHTML = '<div class="jr-hint">' + esc(why) + "</div>";
      return;
    }
    box.innerHTML = list.slice(0, 200).map(function (e) {
      /* steps == null — не «ноль», а «не смогли посмотреть»: у подключения нет прав на
         commapi.events_chain. Писать «цепочки нет» в этом случае значит подтолкнуть
         человека заводить вторую поверх существующей. */
      var tail = e.steps == null
        ? "есть ли цепочка — неизвестно"
        : (e.steps ? "цепочка уже заведена · шагов: " + e.steps : "цепочки нет");
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
    var kind = document.getElementById("jrKind").value === "offline" ? "offline" : "online";
    var name = (document.getElementById("jrNewName").value || "").trim();
    var system = (document.getElementById("jrNewSystem").value || "").trim();

    if (kind === "offline") {
      /* У оффлайна нет ни стартового события, ни условия выхода: он стартует по крону,
         а кого брать — решает SQL-выборка в самом Time event. Спрашивать эти поля у
         него значило бы собирать то, чему негде лечь. */
      if (!name) { alert("Укажите название цепочки."); return; }
      renderJourney({
        id: null, name: name, kind: "offline",
        continuesJourneyId: document.getElementById("jrContinues").value || null,
        nodes: [{ id: "s1", type: "startTime", posX: LAY.x0, posY: LAY.y0,
                  props: { event_name: name, system: system } }],
        edges: []
      });
    } else {
      if (!newPick) { alert("Выберите стартовое событие: цепочка начинается с него."); return; }
      if (!name) name = newPick.eventName || "";
      var exit = (document.getElementById("jrNewExit").value || "").trim();
      if (newPick.steps && !confirm("У события «" + (newPick.eventName || newPick.id) +
          "» уже заведена цепочка (шагов " + newPick.steps + ").\nЗавести поверх неё не выйдет:" +
          " правку существующих не делаем, по этим строкам движок ведёт людей прямо сейчас.\n" +
          "Открыть холст всё равно — как черновик?")) return;
      renderJourney({
        id: null, name: name, kind: "online",
        nodes: [{ id: "s1", type: "startIncome", posX: LAY.x0, posY: LAY.y0,
                  props: { t_event_comm_id: String(newPick.id), event_name: newPick.eventName || "",
                           system: system, exit_condition: exit } }],
        edges: []
      });
    }
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
      /* Пределы масштаба — наши: у Drawflow нижний предел 0,5, и схема шире экрана
         вдвое целиком не показывалась ни при каком разрешении. */
      editor.zoom_min = ZOOM.min;
      editor.zoom_max = ZOOM.max;
      editor.start();
      showZoom();
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
    /* Область действия отменяющего события пересчитывается от того, что лежит на
       холсте: добавили блок, убрали, передвинули — граница поехала за ними. */
    ["nodeCreated", "nodeRemoved", "nodeMoved"].forEach(function (ev) {
      editor.on(ev, renderExitScope);
    });
    /* Список событий для «Открыть цепочку»: те же, что в блоке Income event. Сколько
       шагов заведено, пишем прямо в строке — иначе выбор превращается в перебор. */
    loadTrackerEvents().then(function (list) {
      var pick = document.getElementById("jrChainPick");
      if (!pick) return;
      /* Счётчик шагов не прочитан (нет прав на commapi.events_chain) — значит про
         цепочки мы не знаем ничего, и «заведённых цепочек нет» было бы неправдой. */
      var unknown = (list || []).some(function (e) { return e.steps == null; });
      var withChain = (list || []).filter(function (e) { return e.steps > 0; });
      if (unknown) {
        pick.innerHTML = '<option value="">— список цепочек недоступен: нет прав на чтение'
          + ' commapi.events_chain —</option>';
        pick.disabled = true;
        return;
      }
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
      /* За время запроса человек мог успеть нажать «Пример» или «Новая». Открыть
         поверх сохранённую цепочку значило бы стереть нарисованное без объяснений —
         именно так и выглядело: что ни нажми, на холсте оказывалась чужая цепочка. */
      if (Object.keys(editor.export().drawflow.Home.data).length ||
          document.getElementById("jrNewChain").style.display !== "none") return;
      if (list && list.length) {
        document.getElementById("jrSelect").value = list[0].id;
        loadSelected();
        return;
      }
      /* Показывать пустой холст незачем: положить на него нечего, пока не заведена
         цепочка. Открываем модалку сразу — это и есть первый шаг работы, а не
         препятствие перед ней. Читателю не открываем: заводить ему нельзя. */
      if (canEdit()) window.jrNew();
    }).catch(function (e) {
      /* Последняя сетка. Что бы ни отказало при открытии раздела, он обязан открыться
         рабочим: молчащий раздел человек чинит перезагрузкой и не узнаёт причину. */
      if (window.console) console.error("Цепочки: открытие раздела", e);
      sectionNote("Раздел открылся не полностью: " + why(e));
      if (canEdit()) window.jrNew();
    });
    document.getElementById("jrSelect").addEventListener("change", loadSelected);
  };

  /* Подстраховка на случай, если раздел открыли раньше, чем выполнился этот файл.
     Порядок подключения скриптов мы поправили, но полагаться только на него нельзя:
     проверка в оболочке молчаливая — не оказалось функции, и раздел просто не ожил,
     без ошибки и без следа. Здесь же мы точно знаем, что функция есть, и если раздел
     уже на экране — поднимаем его сами. Повторный вызов безопасен: initJourneysSection
     выходит по флагу inited. */
  function initIfAlreadyOpen() {
    var sec = document.getElementById("sec-journeys");
    if (sec && sec.classList.contains("active")) window.initJourneysSection();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initIfAlreadyOpen);
  } else {
    initIfAlreadyOpen();
  }
})();
