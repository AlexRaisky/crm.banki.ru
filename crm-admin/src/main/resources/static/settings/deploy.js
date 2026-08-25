/* ============================================================
   ВЫКАТКИ — что стоит на каждом контуре, что не доехало и какой командой это доставить.

   Панель не выполняет выкат: приложение живёт в контейнере и не может ни пересобрать
   себя, ни пересоздать соседа. Раздел отвечает на вопросы «что где стоит» и «что поедет»,
   отдаёт готовую команду и записывает намерение в журнал — команду человек выполняет сам.

   Выбор — срез, а не набор галочек: коммиты зависят друг от друга, а миграции Flyway
   идут строго по номерам, и пропустить одну посередине нельзя. Поэтому выбирается точка
   «докуда катим», и всё, что ниже неё, едет целиком.
   ============================================================ */
window.Deploy = (function(){
  "use strict";

  var bound = false, over = null, pend = null, upTo = null, plan = null, log = [];
  /* Состояние обработчика очереди на хосте и текущее задание. Панель сама выкат не
     выполняет — она ставит задание, а показывает то, что обработчик о себе сообщил. */
  var runner = null, watch = null, schemaState = null;

  function T(s){ return (typeof window.t2 === "function") ? window.t2(s) : s; }
  function esc(v){ return String(v == null ? "" : v)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function short(s){ return String(s || "").slice(0, 8); }
  /* «1 правок» в заголовке плана читается как недоделка, а заголовок здесь — главное,
     что человек прочтёт перед выкатом. */
  function plural(n, one, few, many){
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  function when(s){ return String(s || "").replace("T", " ").slice(0, 16); }

  function req(method, url, body){
    var opts = { method: method, credentials:"same-origin", headers:{ Accept:"application/json" } };
    if (body !== undefined){
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function(r){
      if (r.ok) return r.status === 204 ? null : r.json();
      return r.text().then(function(t){
        var m = ""; try { m = JSON.parse(t).message || ""; } catch(e){}
        throw new Error(m || ("HTTP " + r.status));
      });
    });
  }

  function note(text, bad){
    var n = document.getElementById("dpMsg");
    if (!n) return;
    n.textContent = text || "";
    n.classList.toggle("show", !!text);
    n.style.color = bad ? "var(--coral)" : "";
  }

  var ORDER = ["test", "preprod", "prod"];
  function renderEnvs(){
    var host = document.getElementById("dpEnvs");
    if (!host || !over) return;
    var by = {};
    (over.envs || []).forEach(function(e){ by[e.env] = e; });
    host.innerHTML = ORDER.map(function(name){
      var e = by[name] || { env:name, reachable:false, error:"контур не настроен" };
      var known = e.reachable && e.commit;
      var cls = !e.reachable ? "down" : (known ? "ok" : "warn");
      return '<div class="dp-env ' + name + " " + cls + '">' +
        '<div class="dp-env-name">' + esc(name) + (e.self ? " · " + T("вы здесь") : "") + "</div>" +
        '<div class="dp-env-ver mono">' + (known ? esc(e.shortCommit || short(e.commit)) : "—") + "</div>" +
        '<div class="dp-env-sub">' + esc(
            !e.reachable ? (T("не отвечает") + (e.error ? ": " + e.error : ""))
              : (known ? (e.subject || "") : T("версия неизвестна: собрано мимо scripts/build.sh"))) + "</div>" +
        (known && e.builtAt ? '<div class="dp-env-when mono">' + T("собрано") + " " + esc(when(e.builtAt)) + "</div>" : "") +
        rollButton(name, by) +
      "</div>";
    }).join("");
    bindRoll();
  }

  /* Кнопка «принять версию соседа»: на препроде — из теста, на проде — из препрода.
     Это не отдельный механизм, а быстрый выбор пары для того же плана: команда умеет
     встать на конкретный коммит (git checkout <срез>), поэтому «принять то, что стоит
     на тесте» выражается планом с upTo = версия теста. */
  function rollButton(name, by){
    var i = ORDER.indexOf(name);
    if (i <= 0) return "";                       // на тест катить неоткуда
    var from = ORDER[i - 1];
    var src = by[from];
    if (!src || !src.commit) return "";          // сосед молчит — принимать нечего
    var same = (by[name] || {}).commit === src.commit;
    return '<button type="button" class="dp-roll" data-target="' + esc(name) + '"' +
      ' data-from="' + esc(from) + '" data-commit="' + esc(src.commit) + '"' +
      (same ? " disabled" : "") + ">" +
      (same ? T("совпадает с ") + from : T("принять из ") + from) + "</button>";
  }

  function bindRoll(){
    var list = document.querySelectorAll("#dpEnvs .dp-roll");
    Array.prototype.forEach.call(list, function(b){
      b.onclick = function(){ planFor(b.dataset.target, b.dataset.from, b.dataset.commit); };
    });
  }

  /**
   * План «поставить на target то, что стоит на from».
   * <p>
   * Версия источника должна быть в истории ЭТОЙ сборки — иначе панель не знает, какие
   * правки войдут в срез. Так бывает, когда раздел открыт на отставшем контуре: прод
   * собран вчера и про сегодняшний коммит теста знает только со слов соседа. Тогда
   * честнее сказать, где смотреть, чем показать пустой план.
   */
  function planFor(target, from, commit){
    note(T("Считаем срез…"));
    req("POST", "../api/admin/deploy/plan", { target: target, upTo: commit, record: false })
      .then(function(p){
        plan = p;
        pend = pend && pend.target === target ? pend : null;
        renderPlan();
        note(T("Срез до версии ") + from + ": " + T("коммитов ") + ((p.commits || []).length));
        var el = document.getElementById("dpPlan");
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      })
      .catch(function(e){
        plan = null; renderPlan();
        var msg = (e && e.message) || "";
        note(msg.indexOf("нет в истории") >= 0
          ? T("Версия ") + from + T(" не в истории этой сборки — откройте раздел на контуре ") + from
          : msg, true);
      });
  }

  function renderPending(){
    var host = document.getElementById("dpList");
    if (!host) return;
    if (!pend){ host.className = "empty"; host.textContent = T("Читаем разницу между контурами…"); return; }

    if (!pend.known){
      host.className = "empty";
      host.textContent = T("Этот контур не знает своей версии — соберите образ через scripts/build.sh, и разница появится.");
      return;
    }
    if (!pend.comparable){
      host.className = "empty";
      host.textContent = pend.targetReachable
        ? T("Не с чем сравнивать: контур ") + pend.target + T(" не знает своей версии.")
        : T("Не с чем сравнивать: контур ") + pend.target + T(" не отвечает.");
      return;
    }
    var list = pend.commits || [];
    if (!list.length){
      host.className = "empty";
      host.textContent = T("Всё доехало: на ") + pend.target + T(" стоит та же версия.");
      return;
    }
    host.className = "";
    /* Радио, а не чекбоксы: выбирается точка «докуда», и это видно по форме элемента. */
    host.innerHTML = '<div class="dp-hint">' +
        T("Выберите, до какой правки катим. Всё, что ниже выбранной строки, поедет вместе с ней.") +
      "</div>" + list.map(function(c, i){
      var checked = upTo ? (c.commit === upTo) : (i === 0);
      return '<label class="dp-commit' + (checked ? " on" : "") + '">' +
        '<input type="radio" name="dpUpTo" value="' + esc(c.commit) + '"' + (checked ? " checked" : "") + ">" +
        '<span class="dp-c-hash mono">' + esc(c.shortCommit) + "</span>" +
        '<span class="dp-c-main"><span class="dp-c-subj">' + esc(c.subject) + "</span>" +
          '<span class="dp-c-meta">' + esc(c.author) + " · " + esc(c.date) + "</span></span>" +
        (c.migration ? '<span class="dp-c-mig" title="' +
            esc(T("Коммит меняет структуру базы: пропустить его нельзя")) + '">' + T("миграция") + "</span>" : "") +
      "</label>";
    }).join("");

    Array.prototype.forEach.call(host.querySelectorAll('input[name="dpUpTo"]'), function(r){
      r.onchange = function(){
        upTo = r.value;
        plan = null;
        renderPending();
        renderPlan();
        /* Пересобрать план обязательно: срез сменился, а команда и состав правок в нём
           считаются на сервере — без этого вызова под списком осталась бы пустота. */
        buildPlan();
      };
    });
  }

  /* Копирование в буфер.
     navigator.clipboard живёт только в защищённом контексте — HTTPS или localhost.
     Панель отдаётся по http://crm.banki.ru, поэтому объекта там просто НЕТ, и обращение
     к нему падало с TypeError: кнопка «Скопировать команду» не делала ничего. Запасной
     путь через скрытое поле и execCommand устарел, но работает без HTTPS. Такой же
     обход уже стоит в Конструкторе source — держим их одинаковыми. */
  function copyText(value){
    if (navigator.clipboard && window.isSecureContext){
      return navigator.clipboard.writeText(value);
    }
    return new Promise(function(resolve, reject){
      var ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = false;
      try { ok = document.execCommand("copy"); } catch(e){ ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error("execCommand"));
    });
  }

  function renderPlan(){
    var host = document.getElementById("dpPlan");
    if (!host) return;
    if (!plan){ host.innerHTML = ""; return; }
    var mig = plan.migrations || 0;
    host.innerHTML =
      '<div class="dp-plan-head">' + T("Поедет на") + " <b>" + esc(plan.target) + "</b>: " +
        (plan.commits || []).length + " " +
        T(plural((plan.commits || []).length, "правка", "правки", "правок")) +
        (mig ? ", " + T("из них с миграциями") + ": " + mig : "") + "</div>" +
      (plan.partial ? '<div class="dp-warn">' +
        T("Выбран не последний коммит: команда переключит рабочую копию на него, а не на ветку. После выката верните ветку обратно — git checkout ") +
        esc((over && over.branch) || "admin-panel") + "</div>" : "") +
      (mig ? '<div class="dp-warn">' +
        T("В срезе есть изменения структуры базы. Они накатятся при старте контура и обратно сами не откатятся.") +
        "</div>" : "") +
      "<pre><code>" + esc(plan.script) + "</code></pre>" +
      '<div class="row" style="gap:10px;margin-top:10px">' +
        '<button type="button" class="btn" id="dpCopy">' + T("Скопировать команду") + "</button>" +
        '<button type="button" class="btn" id="dpRecord">' + T("Записать в журнал") + "</button>" +
        /* Кнопка появляется, только когда обработчик на хосте выходил на связь: иначе она
           молча копила бы задания, а человек ждал бы выката, которого никто не делает. */
        (runner && runner.alive
          ? '<button type="button" class="btn primary" id="dpRun">' + T("Выкатить") + "</button>"
          : '<span class="dp-runner-off">' + T("Выкатывает обработчик на сервере — он сейчас не отвечает, выполните команду вручную") + "</span>") +
      "</div>";

    document.getElementById("dpCopy").onclick = function(){
      copyText(plan.script).then(
        function(){ note(T("Команда скопирована")); },
        function(){ note(T("Не вышло скопировать — выделите текст вручную"), true); });
    };
    document.getElementById("dpRecord").onclick = function(){
      req("POST", "../api/admin/deploy/plan", { target: plan.target, upTo: plan.upTo, record: true })
        .then(function(p){
          plan = p;
          note(T("Записано в журнал. Выполните команду на сервере — панель отметит выкат, когда увидит новую версию."));
          return loadLog();
        })
        .catch(function(e){ note((e && e.message) || T("Не удалось записать"), true); });
    };
    var runBtn = document.getElementById("dpRun");
    if (runBtn) runBtn.onclick = function(){
      var mig = (plan.migrations || 0) > 0;
      if (!confirm(T("Выкатить на ") + plan.target + T(" версию ") + (plan.upTo || "").slice(0, 7) + "?" +
                   (mig ? "\n" + T("В срезе есть миграции — структура базы изменится и сама назад не откатится.") : ""))) return;
      runBtn.disabled = true;
      req("POST", "../api/admin/deploy/run", { target: plan.target, upTo: plan.upTo })
        .then(function(){
          note(T("Задание поставлено в очередь — обработчик возьмёт его в течение минуты."));
          return Promise.all([loadRunner(), loadLog()]);
        })
        .catch(function(e){ runBtn.disabled = false; note((e && e.message) || T("Не удалось поставить задание"), true); });
    };
  }

  function renderLog(){
    var host = document.getElementById("dpLog");
    if (!host) return;
    if (!log.length){ host.className = "empty"; host.textContent = T("Выкаток ещё не было"); return; }
    host.className = "";
    host.innerHTML = '<table class="dp-tbl"><thead><tr>' +
        "<th>" + T("Когда") + "</th><th>" + T("Куда") + "</th><th>" + T("Версия") + "</th>" +
        "<th>" + T("Правок") + "</th><th>" + T("Кто") + "</th><th>" + T("Статус") + "</th>" +
      "</tr></thead><tbody>" + log.map(function(r){
        return "<tr><td class=\"mono\">" + esc(when(r.at)) + "</td>" +
          "<td>" + esc(r.from) + " → <b>" + esc(r.to) + "</b></td>" +
          '<td class="mono" title="' + esc(r.subject) + '">' + esc(r.shortCommit) + "</td>" +
          '<td class="num">' + r.commits + (r.migrations ? " (" + r.migrations + " " + T("миг.") + ")" : "") + "</td>" +
          "<td>" + esc(r.actor || "—") + "</td>" +
          '<td><span class="dp-st ' + esc(r.status) + '">' + esc(T(statusLabel(r.status))) + "</span></td></tr>";
      }).join("") + "</tbody></table>";
  }

  function statusLabel(s){
    return s === "done" ? "выкачено" : (s === "cancelled" ? "отменено" : "запланировано");
  }

  function loadLog(){
    return req("GET", "../api/admin/deploy/history?limit=30")
      .then(function(l){ log = l || []; renderLog(); })
      .catch(function(){ log = []; renderLog(); });
  }

  function loadPending(){
    var target = over && over.target;
    if (!target){
      pend = null;
      var host = document.getElementById("dpList");
      if (host){
        host.className = "empty";
        host.textContent = T("С прода выкатывать некуда — это последний контур.");
      }
      return Promise.resolve();
    }
    return req("GET", "../api/admin/deploy/pending?target=" + encodeURIComponent(target))
      .then(function(p){
        pend = p;
        upTo = (p.commits && p.commits.length) ? p.commits[0].commit : null;
        renderPending();
        return buildPlan();
      })
      .catch(function(e){
        pend = null; renderPending();
        note((e && e.message) || T("Не удалось прочитать разницу"), true);
      });
  }

  function buildPlan(){
    if (!pend || !pend.comparable || !(pend.commits || []).length){ plan = null; renderPlan(); return; }
    return req("POST", "../api/admin/deploy/plan", { target: pend.target, upTo: upTo, record: false })
      .then(function(p){ plan = p; renderPlan(); })
      .catch(function(e){ plan = null; renderPlan(); note((e && e.message) || "", true); });
  }

  /* Структура базы по контурам. Отвечает на вопрос, который до сих пор задавали psql:
     модель переехала пакетом, а таблицы и колонки на приёмнике не создались, потому что
     их создаёт отдельная кнопка. */
  function loadSchema(){
    return req("GET", "../api/admin/deploy/schema")
      .then(function(j){ schemaState = j || {}; renderSchema(); })
      .catch(function(){ schemaState = null; renderSchema(); });
  }

  function renderSchema(){
    var host = document.getElementById("dpSchema");
    if (!host) return;
    if (!schemaState){
      host.className = "empty";
      host.textContent = T("Не удалось прочитать структуру контуров");
      return;
    }
    var envs = schemaState.envs || [];
    host.className = "dp-envs";
    host.innerHTML = envs.map(function(e){
      var ok = e.reachable && !e.missing;
      var cls = !e.reachable ? "down" : (e.missing ? "warn" : "ok");
      var by = e.bySchema || {};
      var names = Object.keys(by).sort(function(a, b){ return by[b] - by[a]; }).slice(0, 4);
      return '<div class="dp-env ' + esc(e.env) + " " + cls + '">' +
        '<div class="dp-env-name">' + esc(e.env) + (e.self ? " · " + T("вы здесь") : "") + "</div>" +
        '<div class="dp-env-ver">' + (!e.reachable ? "—" : (e.missing || 0)) + "</div>" +
        '<div class="dp-env-sub">' + esc(
          !e.reachable ? (T("не отвечает") + (e.error ? ": " + e.error : ""))
            : (ok ? T("база совпадает с моделью")
                  : T("объектов не создано") + (names.length ? ": " + names.map(function(n){ return n + " (" + by[n] + ")"; }).join(", ") : ""))) +
        "</div>" +
        (e.self && e.missing
          ? '<button type="button" class="dp-roll" id="dpApplyDdl">' + T("применить к базе") + "</button>"
          : "") +
      "</div>";
    }).join("");
    var b = document.getElementById("dpApplyDdl");
    /* Применение — в конструкторе: там предпросмотр DDL, охрана защищённых схем и
       журнал. Дублировать всё это здесь значило бы завести вторую точку правды. */
    if (b) b.onclick = function(){
      note(T("Открываю конструктор — применение идёт там, с предпросмотром."));
      if (typeof window.openPane === "function") window.openPane("scheme");
    };
  }

  function loadRunner(){
    return req("GET", "../api/admin/deploy/runner")
      .then(function(r){ runner = r || {}; renderRunner(); return runner; })
      .catch(function(){ runner = { alive: false }; renderRunner(); });
  }

  /* Строка состояния: жив ли обработчик и что с текущим заданием. Пока задание в работе,
     перечитываем раз в 10 секунд — выкат идёт минуты, и человек ждёт у экрана. */
  function renderRunner(){
    var host = document.getElementById("dpRunner");
    if (!host) return;
    var job = (runner && runner.job && runner.job.id) ? runner.job : null;
    var alive = !!(runner && runner.alive);
    var parts = [];
    parts.push('<span class="dp-dot ' + (alive ? "ok" : "off") + '"></span>' +
      (alive ? T("обработчик на связи") : T("обработчик не отвечает")) +
      (runner && runner.agoSec >= 0 && runner.lastSeenAt
        ? ' <span class="mono">' + T("последний раз") + " " + esc(when(runner.lastSeenAt)) + "</span>" : ""));
    if (job){
      var st = String(job.run_status || "");
      var label = st === "queued" ? T("в очереди") : st === "running" ? T("катится")
        : st === "done" ? T("выкачено") : T("ошибка");
      parts.push('<b>' + esc(job.target_env) + "</b> " + label +
        ' <span class="mono">' + esc(String(job.to_commit || "").slice(0, 7)) + "</span>");
      if (st === "failed" && job.run_output){
        parts.push('<div class="dp-run-err mono">' + esc(String(job.run_output).slice(-600)) + "</div>");
      }
    }
    host.className = "dp-runner " + (alive ? "" : "off");
    host.innerHTML = parts.join(" · ");

    clearTimeout(watch);
    if (job && (job.run_status === "queued" || job.run_status === "running")){
      watch = setTimeout(function(){
        loadRunner().then(function(r){
          /* Задание закончилось — перечитываем версии контуров: на цели уже новая. */
          if (r && r.job && (r.job.run_status === "done" || r.job.run_status === "failed")) load();
        });
      }, 10000);
    }
  }

  function load(){
    note("");
    return req("GET", "../api/admin/deploy")
      .then(function(o){
        over = o; renderEnvs();
        /* Сверку с фактом делаем при каждом открытии: команду выполняют в терминале, и
           узнать, что выкат состоялся, можно только увидев на цели новую версию. */
        return req("POST", "../api/admin/deploy/reconcile").catch(function(){ return null; });
      })
      .then(function(){ return loadPending(); })
      .then(function(){ return loadLog(); })
      .then(function(){ return loadRunner(); })
      .then(function(){ return loadSchema(); })
      .catch(function(e){
        var host = document.getElementById("dpEnvs");
        if (host) host.innerHTML = '<div class="empty">' +
          T("Не удалось прочитать состояние контуров") + ": " + esc((e && e.message) || "") + "</div>";
      });
  }

  function bind(){
    if (bound) return;
    var b = document.getElementById("dpReload");
    if (!b) return;
    bound = true;
    b.onclick = load;
  }

  return { open: function(){ bind(); load(); }, reload: load };
})();
