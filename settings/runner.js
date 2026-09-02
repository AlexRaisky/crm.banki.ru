/* ============================================================
   ОБРАБОТЧИК ВЫКАТОВ — кто на самом деле выполняет выкат и что с ним сейчас.

   Панель docker не видит и видеть не должна: сокет хоста в контейнере равен правам root
   на сервере, а прод панель пересоздавала бы вместе с собой, обрывая себе запрос. Поэтому
   кнопка «Выкатить» ставит задание, а выполняет его скрипт на хосте.

   Отсюда и назначение страницы: у механизма, который работает снаружи приложения, должно
   быть место, где видно — жив ли он, что взял в работу и почему прошлое задание упало.
   Иначе единственный способ это узнать — идти на сервер, а туда есть доступ не у всех,
   кто нажимает кнопку.
   ============================================================ */
window.DeployRunner = (function(){
  "use strict";

  var bound = false, state = null, jobs = [], timer = null;

  function T(s){ return (typeof window.t2 === "function") ? window.t2(s) : s; }
  function esc(v){ return String(v == null ? "" : v)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
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
    var n = document.getElementById("rnMsg");
    if (!n) return;
    n.textContent = text || "";
    n.style.color = bad ? "var(--coral)" : "";
  }

  /* Три состояния, и путать их нельзя: «работает», «остановлен человеком» и «молчит».
     Последнее — единственная поломка; вторая — чьё-то решение, и красным её красить
     неправильно. */
  function health(){
    if (!state) return { key:"unknown", label:T("состояние неизвестно"), cls:"off" };
    if (!state.alive) return { key:"down", label:T("не отвечает"), cls:"down" };
    if (state.paused) return { key:"paused", label:T("на паузе"), cls:"warn" };
    return { key:"ok", label:T("работает"), cls:"ok" };
  }

  function renderState(){
    var host = document.getElementById("rnState");
    if (!host) return;
    var h = health();
    var ago = state && state.agoSec >= 0 ? state.agoSec : null;
    host.className = "rn-state " + h.cls;
    host.innerHTML =
      '<div class="rn-head"><span class="dp-dot ' + (h.cls === "ok" ? "ok" : "off") + '"></span>' +
        '<b>' + esc(h.label) + "</b></div>" +
      '<div class="rn-facts">' +
        fact(T("Последний раз выходил на связь"),
             state && state.lastSeenAt ? esc(when(state.lastSeenAt)) : "—",
             ago === null ? "" : (ago < 90 ? T("только что") : T("это ") + human(ago) + T(" назад"))) +
        fact(T("Сервер"), state && state.host ? esc(state.host) : "—",
             state && state.version ? T("версия скрипта ") + esc(state.version) : "") +
        (state && state.paused
          ? fact(T("Пауза"), esc(state.pausedBy || "—"), state.pausedAt ? esc(when(state.pausedAt)) : "")
          : fact(T("Очередь"), String(queued()), T("ждут обработчика"))) +
      "</div>" +
      (h.key === "down"
        ? '<div class="rn-warn">' + T("Задания будут копиться, но никто их не выполнит: пока обработчик молчит, кнопка «Выкатить» в разделе «Выкатки» не показывается. Катите командой из терминала.") + "</div>"
        : "") +
      (h.key === "paused"
        ? '<div class="rn-warn soft">' + T("Новые задания не берутся. Уже начатое доделывается — рвать выкат на середине хуже, чем дать ему закончиться.") + "</div>"
        : "");

    var b = document.getElementById("rnPause");
    if (b){
      b.textContent = state && state.paused ? T("Снять с паузы") : T("Поставить на паузу");
      b.disabled = !state || !state.alive && !state.paused;
    }
  }

  function fact(label, value, sub){
    return '<div class="rn-fact"><div class="rn-fact-l">' + esc(label) + "</div>" +
      '<div class="rn-fact-v">' + value + "</div>" +
      (sub ? '<div class="rn-fact-s">' + sub + "</div>" : "") + "</div>";
  }

  function human(sec){
    if (sec < 120) return sec + " " + T("сек");
    if (sec < 7200) return Math.round(sec / 60) + " " + T("мин");
    return Math.round(sec / 3600) + " " + T("ч");
  }

  function queued(){
    return jobs.filter(function(j){ return j.run_status === "queued"; }).length;
  }

  var LABEL = { queued:"в очереди", running:"катится", done:"выкачено", failed:"ошибка", cancelled:"отменено" };

  function renderJobs(){
    var host = document.getElementById("rnJobs");
    if (!host) return;
    if (!jobs.length){
      host.className = "empty";
      host.textContent = T("Заданий ещё не было: выкаты либо не заказывали, либо катили командой вручную.");
      return;
    }
    host.className = "";
    host.innerHTML = '<table class="rn-tbl"><thead><tr>' +
        "<th>" + T("Заказано") + "</th><th>" + T("Куда") + "</th><th>" + T("Версия") + "</th>" +
        "<th>" + T("Кто") + "</th><th>" + T("Состояние") + "</th><th></th>" +
      "</tr></thead><tbody>" + jobs.map(function(j){
        var st = String(j.run_status || "");
        var dur = j.run_started_at && j.run_finished_at
          ? Math.max(0, Math.round((new Date(j.run_finished_at) - new Date(j.run_started_at)) / 1000)) : null;
        return '<tr class="rn-' + esc(st) + '">' +
          '<td class="mono">' + esc(when(j.timestamp_cr)) + "</td>" +
          "<td><b>" + esc(j.target_env) + "</b></td>" +
          '<td class="mono" title="' + esc(j.to_subject || "") + '">' + esc(String(j.to_commit || "").slice(0, 7)) +
            (j.migrations ? ' <span class="rn-mig">' + j.migrations + " " + T("миг.") + "</span>" : "") + "</td>" +
          "<td>" + esc(j.actor || "—") + "</td>" +
          '<td><span class="rn-st ' + esc(st) + '">' + esc(T(LABEL[st] || st)) + "</span>" +
            (dur !== null ? ' <span class="rn-dur">' + human(dur) + "</span>" : "") + "</td>" +
          "<td>" + actions(j) + "</td></tr>" +
          (st === "failed" && j.run_output
            ? '<tr class="rn-out"><td colspan="6"><div class="rn-output mono">' +
              esc(String(j.run_output).slice(-2000)) + "</div></td></tr>"
            : "");
      }).join("") + "</tbody></table>";
    bindJobs();
  }

  /* Отменить можно только то, что обработчик ещё не взял: у running половина работы уже
     сделана в реальном мире — образ собран, контейнер пересоздан, — и запись в базе об
     этом ничего не знает. */
  function actions(j){
    if (j.run_status === "queued")
      return '<button type="button" class="btn tiny rn-cancel" data-id="' + j.id + '">' + T("Отменить") + "</button>";
    if (j.run_status === "failed" || j.run_status === "cancelled")
      return '<button type="button" class="btn tiny rn-retry" data-id="' + j.id + '">' + T("Повторить") + "</button>";
    return "";
  }

  function bindJobs(){
    document.querySelectorAll("#rnJobs .rn-cancel").forEach(function(b){
      b.onclick = function(){
        req("POST", "../api/admin/deploy/jobs/" + b.dataset.id + "/cancel")
          .then(function(){ note(T("Задание снято")); return load(); })
          .catch(function(e){ note((e && e.message) || T("Не удалось отменить"), true); });
      };
    });
    document.querySelectorAll("#rnJobs .rn-retry").forEach(function(b){
      b.onclick = function(){
        if (!confirm(T("Поставить это задание в очередь заново?"))) return;
        req("POST", "../api/admin/deploy/jobs/" + b.dataset.id + "/retry")
          .then(function(){ note(T("Задание снова в очереди")); return load(); })
          .catch(function(e){ note((e && e.message) || T("Не удалось повторить"), true); });
      };
    });
  }

  /* Инструкция по установке нужна ровно тогда, когда обработчика нет, — и не мозолит
     глаза, когда всё работает. */
  function renderHelp(){
    var host = document.getElementById("rnHelp");
    if (!host) return;
    var down = health().key === "down";
    host.innerHTML = down
      ? "<p>" + T("Обработчик ставится на сервере один раз. Пользователь, от которого он работает, должен состоять в группе docker — иначе пересоздать контур он не сможет.") + "</p>" +
        "<pre><code>sudo cp ~/crm.banki.ru/crm-admin/scripts/crm-deploy-runner.* /etc/systemd/system/\n" +
        "sudo systemctl daemon-reload\n" +
        "sudo systemctl enable --now crm-deploy-runner.timer</code></pre>" +
        "<p>" + T("Проверить, что он видит базу и отмечается:") + "</p>" +
        "<pre><code>bash ~/crm.banki.ru/crm-admin/scripts/deploy-runner.sh --heartbeat</code></pre>" +
        "<p>" + T("Посмотреть, почему не запускается:") + "</p>" +
        "<pre><code>journalctl -u crm-deploy-runner.service -n 30 --no-pager</code></pre>"
      : "<p>" + T("Обработчик установлен и выходит на связь. Он читает очередь из базы этого контура и умеет ровно одно — выкатить контур до коммита: имя контура сверяется со списком, коммит обязан быть в ветке.") + "</p>";
  }

  function load(){
    return Promise.all([
      req("GET", "../api/admin/deploy/runner"),
      req("GET", "../api/admin/deploy/jobs?limit=30")
    ]).then(function(res){
      state = res[0] || {};
      jobs = res[1] || [];
      renderState(); renderJobs(); renderHelp();
    }).catch(function(e){
      note((e && e.message) || T("Не удалось прочитать состояние"), true);
    });
  }

  function bind(){
    if (bound) return;
    var b = document.getElementById("rnReload");
    if (!b) return;
    bound = true;
    b.onclick = function(){ note(""); load(); };
    document.getElementById("rnPause").onclick = function(){
      var on = !(state && state.paused);
      if (on && !confirm(T("Обработчик перестанет брать новые задания. Начатое доделает. Продолжить?"))) return;
      req("POST", "../api/admin/deploy/runner/pause", { paused: on })
        .then(function(){ note(on ? T("Пауза включена") : T("Пауза снята")); return load(); })
        .catch(function(e){ note((e && e.message) || T("Не удалось переключить"), true); });
    };
  }

  return {
    open: function(){
      bind();
      load();
      /* Пока страница открыта, обновляемся сами: её держат открытой во время выката,
         и устаревшее «катится» здесь хуже всего. */
      clearInterval(timer);
      timer = setInterval(function(){
        var pane = document.getElementById("pane-runner");
        if (pane && pane.classList.contains("active")) load(); else clearInterval(timer);
      }, 15000);
    },
    reload: load
  };
})();
