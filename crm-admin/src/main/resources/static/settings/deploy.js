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
        '<button type="button" class="btn primary" id="dpRecord">' + T("Записать в журнал и катить") + "</button>" +
      "</div>";

    document.getElementById("dpCopy").onclick = function(){
      navigator.clipboard.writeText(plan.script).then(
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
