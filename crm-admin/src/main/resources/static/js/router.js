/* =========================================================
   МАРШРУТИЗАТОР: у каждого экрана свой адрес.

   Зачем. До него панель была одной страницей без адресов: openSection
   переключала класс .active, адрес не менялся никогда. Отсюда три беды —
   кнопка «назад» (в том числе системная на телефоне) уводила со страницы
   целиком, ссылку на карточку нельзя было переслать, а после F5 терялось
   всё глубже пары «раздел/подраздел».

   Что делает. Держит адрес и модель приложения в согласии в обе стороны:
   переход в интерфейсе пишет адрес, переход по истории (popstate) —
   применяет адрес к интерфейсу. Кнопка «назад» браузера и системная
   кнопка на телефоне — один и тот же переход по истории, поэтому
   отдельной обработки для мобильных не нужно.

   Чего он НЕ знает. Ни про NAV, ни про PANES, ни про секции. Всё
   прикладное живёт в адаптере (Router.configure) и в провайдерах
   (Router.register) — движок один на панель и на настроечную админку.

   Базовый путь берётся из window.APP_BASE, который считает инлайновый
   скрипт в <head> ДО загрузки ресурсов: при адресе /entities/client
   относительные пути вроде js/shell.js иначе разрешились бы в
   /entities/js/shell.js. Скрипт обязан быть инлайновым — внешний файл
   сам подтягивается относительным путём и умер бы первым.
   ========================================================= */
(function (global) {
  "use strict";

  var CFG = null;              /* адаптер приложения */
  var PROV = {};               /* ключ секции -> провайдер глубины */
  var want = null;             /* маршрут, который просили, но ещё не смогли применить */
  var applying = false;        /* идёт применение адреса — синхронизацию глушим */
  var depth = 0;               /* вложенность обёрнутой навигации */
  var replaceOnce = false;     /* следующую запись сделать replaceState */
  var lastApplied = "";        /* последний адрес, который мы сами поставили */
  var started = false;
  var wrapped = null;          /* наша обёртка над глобальной функцией навигации */
  var syncBudget = { at: 0, n: 0 };   /* защита от циклов синхронизации */

  function base() {
    var b = global.APP_BASE;
    return (typeof b === "string" && b) ? b : "/";
  }

  /* ---------- адрес <-> сегменты ---------- */

  /** Сегменты текущего адреса: путь минус база, без пустых и без имени документа. */
  function readPath() {
    var p = location.pathname, b = base();
    var rest = (p.indexOf(b) === 0) ? p.slice(b.length) : p.replace(/^\//, "");
    return rest.split("/")
      .filter(function (s) { return s && s.indexOf(".html") < 0; })
      .map(function (s) { try { return decodeURIComponent(s); } catch (e) { return s; } });
  }

  /** Сегменты -> абсолютный путь. Строка запроса сохраняется: на ней держится ?only=. */
  function build(segs) {
    var tail = (segs || []).filter(function (s) {
      return s !== null && s !== undefined && s !== "";
    }).map(function (s) { return encodeURIComponent(String(s)); }).join("/");
    return base() + tail + location.search;
  }

  /* ---------- синхронизация модели в адрес ---------- */

  /** Полный маршрут из модели: верхний уровень от адаптера + глубина от провайдера. */
  function currentSegs() {
    var segs = (CFG.serializeTop() || []).slice();
    var prov = PROV[CFG.key ? CFG.key() : ""];
    if (prov && prov.serialize) {
      var tail = prov.serialize() || [];
      for (var i = 0; i < tail.length; i++) segs.push(tail[i]);
    }
    return segs;
  }

  function sync() {
    if (!started || applying || depth || CFG.embedded) return;

    var url = build(currentSegs());
    if (url === location.pathname + location.search) { replaceOnce = false; return; }

    /* Циклы ловим бюджетом на кадр: applyNavAcl зовётся дважды, а openSection
       рекурсивна в своих защитах — без бюджета взаимный вызов молча съел бы
       вкладку. Лучше предупреждение в консоли, чем зависший браузер.
       Считаем только реальные записи: перерисовка списка при вводе в поиск
       заходит сюда на каждый символ, но адрес при этом не меняется. */
    var now = Date.now();
    if (now - syncBudget.at > 60) { syncBudget.at = now; syncBudget.n = 0; }
    if (++syncBudget.n > 12) {
      if (typeof console !== "undefined") console.warn("Router: слишком много синхронизаций подряд, пропускаю");
      return;
    }

    var replace = replaceOnce;
    replaceOnce = false;
    try {
      history[replace ? "replaceState" : "pushState"]({ r: url }, "", url);
    } catch (e) {
      /* Разные origin у документа и адреса (файловый протокол, песочница) —
         навигация должна продолжать работать без истории, а не падать. */
      if (typeof console !== "undefined") console.warn("Router: адрес не записан —", e);
      return;
    }
    lastApplied = url;
    setTitleFromProvider();
    if (CFG.persist) CFG.persist(url);
  }

  /**
   * Заголовок вкладки для глубоких экранов.
   *
   * Раздел свой заголовок ставит сам, а вот запись — нет: она открывается
   * внутри одного и того же экрана, и без этого во всех вкладках с карточками
   * стояло бы одинаковое «Клиенты». Заодно так подписывается закладка.
   */
  function setTitleFromProvider() {
    if (!CFG.setTitle) return;
    var prov = PROV[CFG.key ? CFG.key() : ""];
    if (!prov || !prov.title) return;
    var s = prov.title();
    if (s) CFG.setTitle(s);
  }

  /* ---------- применение адреса к модели ---------- */

  /**
   * Разрешение отложенного маршрута.
   *
   * Адрес известен сразу, а состав разделов — нет: подразделы «Сущностей»
   * появляются после ответа /api/me и загрузки схемы. Поэтому openTop может
   * ответить pending — тогда ждём Router.navReady() от того, кто пересобрал
   * навигацию. Раньше ту же задачу решал костыль ENT_WANT, читавший
   * lastSection напрямую из localStorage.
   */
  function applyWant() {
    if (!want || !CFG) return;
    var res;
    applying = true;
    try { res = CFG.openTop(want.segs) || {}; }
    finally { applying = false; }

    if (res.pending) return;                       /* раздел ещё не знает своих детей */
    if (!res.ok) { want = null; fixUrl(); return; } /* адрес соврал — приводим его к факту */

    var rest = want.segs.slice(res.consumed || want.segs.length);
    var prov = PROV[CFG.key ? CFG.key() : ""];
    /* Пустой хвост — тоже маршрут: провайдера зовём и с ним, иначе «назад» из
       карточки на голый адрес раздела не свернул бы открытое поверх списка.
       Экран знает своё исходное состояние, движок — нет. */
    if (!prov || !prov.apply) { want = null; fixUrl(); return; }

    var mine = want;
    want = null;
    var ready = prov.ready ? prov.ready() : null;
    var done = function () {
      applying = false;
      setTitleFromProvider();
      fixUrl();
    };
    var go = function () {
      var res;
      applying = true;
      try { res = prov.apply(rest); }
      catch (e) {
        if (typeof console !== "undefined") console.warn("Router: не удалось открыть", rest, e);
      }
      /* Экран может открываться в два приёма: карточку шаблона сначала надо
         запросить у сервера. Пока запрос идёт, состояние ещё не то, которое
         просили, и приведение адреса к факту стёрло бы правильный адрес —
         поэтому ждём. */
      if (res && typeof res.then === "function") res.then(done, done);
      else done();
    };
    if (ready && typeof ready.then === "function") ready.then(go, go); else go();
  }

  /** Привести адрес к тому, что реально открылось, не засоряя историю. */
  function fixUrl() { replaceOnce = true; sync(); }

  function onUrl() {
    if (applying || !started) return;
    var here = location.pathname + location.search;
    if (here === lastApplied) return;              /* это наша же запись */
    want = { segs: readPath() };
    applyWant();
  }

  /* ---------- публичный интерфейс ---------- */

  var Router = {
    /* Панель открыта во внешнем окне (?only=list|dashboard): там своим адресом
       распоряжается принимающая страница — разбираем, но не навигируем и
       историю не трогаем. Это второй, более ранний контракт на URL, и ломать
       его маршрутизацией нельзя. */
    embedded: /[?&]only=(list|dashboard)\b/.test(location.search),

    configure: function (adapter) {
      CFG = adapter;
      CFG.embedded = !!Router.embedded;
      var name = adapter.wrap;
      var orig = global[name];
      if (typeof orig !== "function") {
        if (typeof console !== "undefined") console.warn("Router: нет функции навигации " + name);
        return;
      }
      /* Одна обёртка вместо правки трёх десятков мест вызова: и инлайновые
         onclick в разметке, и вызовы из модулей резолвят одно и то же
         свойство window. Счётчик вложенности схлопывает цепочки вида
         entGo → openSection → откат на home в ОДНУ запись истории, а
         синхронизация читает уже итоговое состояние — адрес никогда не
         показывает то, что на самом деле не открылось. */
      wrapped = function () {
        depth++;
        try { return orig.apply(this, arguments); }
        finally { if (!--depth) sync(); }
      };
      wrapped.__router = true;
      global[name] = wrapped;
    },

    /** Провайдер глубины экрана: {serialize, apply, ready, title}. */
    register: function (key, prov) { PROV[key] = prov; },

    /** «Состояние секции изменилось» — из точки перерисовки, push/replace решает движок. */
    touch: function () { sync(); },

    /**
     * Один переход, собранный из нескольких шагов, — одна запись в истории.
     *
     * Переход по связи из карточки в карточку сначала открывает подраздел
     * другой сущности, и только потом выставляет запись. Без группировки в
     * историю попадали обе остановки, и «назад» приводил на промежуточный
     * экран вместо карточки, из которой человек ушёл.
     */
    batch: function (fn) {
      depth++;
      try { return fn(); }
      finally { if (!--depth) sync(); }
    },

    /** Следующая запись адреса не должна попасть в историю. */
    replaceNext: function () { replaceOnce = true; },

    /** «Состав навигации пересчитан / данные приехали» — попробовать отложенный маршрут. */
    navReady: function () { if (want) applyWant(); },

    start: function () {
      if (!CFG || started) return;
      started = true;

      if (global[CFG.wrap] !== wrapped && typeof console !== "undefined") {
        console.warn("Router: обёртка навигации перезаписана — адреса работать не будут");
      }

      global.addEventListener("popstate", onUrl);
      global.addEventListener("hashchange", onUrl);

      if (Router.embedded) return;      /* внешнее окно: маршрут не наш */

      var segs = readPath();
      want = { segs: segs.length ? segs : (CFG.home ? CFG.home() : []) };
      replaceOnce = true;               /* первый заход не должен оставлять лишнюю запись */

      var wait = CFG.ready ? CFG.ready() : null;
      var run = function () {
        applyWant();
        /* Страховка на случай, когда маршрут так и не разрешился: раздел не
           появился (нет прав), схема не приехала, сервер молчит. Уводим на
           стартовый экран с честным адресом, а не оставляем человека смотреть
           в пустой обзор.

           Задержка, а не нулевой таймаут: неразрешённым маршрут остаётся
           именно в ожидании данных (схема сущностей грузится после ответа
           /api/me), и мгновенная проверка сбрасывала бы правильный адрес
           за секунду до того, как он сработает. Неверный адрес сюда не
           доходит — его отбивает openTop сразу, ещё в applyWant. */
        setTimeout(function () {
          if (!want) return;
          want = null;
          if (CFG.fallback) { applying = true; try { CFG.fallback(); } finally { applying = false; } }
          fixUrl();
        }, 5000);
      };
      if (wait && typeof wait.then === "function") wait.then(run, run); else run();
    },

    /* для отладки и тестов */
    _state: function () { return { want: want, applying: applying, depth: depth, base: base() }; }
  };

  global.Router = Router;
})(window);
