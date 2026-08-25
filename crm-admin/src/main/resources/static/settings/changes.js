/* ============================================================
   ИЗМЕНЕНИЯ КОНТУРА — «что я тут наменял и что из этого пора везти дальше».

   Панель и так ведёт два журнала: конструктор схемы пишет свой, построчные правки
   ложатся в журнал действий. Врозь их читают, когда что-то сломалось. Здесь они сложены
   в один список и разложены по объектам, которые умеет переносить пакет настроек.

   Про честность отметок. Галочка стоит у объекта, а не у отдельной правки: пакет
   переносит объект целиком. Отметив «менялись роли», вы увезёте все роли — иначе матрица
   прав приедет полурассыпанной. Список изменений под сводкой отвечает не на вопрос «что
   поедет», а на вопрос «почему это стоит везти».
   ============================================================ */
window.EnvChanges = (function(){
  "use strict";

  var bound = false, data = null, days = 14, picked = {};

  function T(s){ return (typeof window.t2 === "function") ? window.t2(s) : s; }
  function esc(v){ return String(v == null ? "" : v)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

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
    var n = document.getElementById("chMsg");
    if (!n) return;
    n.textContent = text || "";
    n.style.color = bad ? "var(--coral)" : "";
  }

  /* Время показываем коротко: в этом списке важен порядок и день, а не секунды. */
  function when(iso){
    var s = String(iso || "");
    if (s.length < 16) return s;
    return s.slice(8, 10) + "." + s.slice(5, 7) + " " + s.slice(11, 16);
  }

  function renderGroups(){
    var host = document.getElementById("chGroups");
    if (!host) return;
    var groups = (data && data.groups) || [];
    if (!groups.length){
      host.className = "empty";
      host.textContent = T("За выбранный срок настройки не менялись");
      return;
    }
    host.className = "ch-groups";
    host.innerHTML = groups.map(function(g){
      var actors = (g.actors || []).join(", ");
      return '<label class="ch-group">' +
        '<input type="checkbox" data-key="' + esc(g.key) + '"' + (picked[g.key] ? " checked" : "") + ">" +
        '<span class="ch-g-main"><span class="ch-g-title">' + esc(g.title) + "</span>" +
          '<span class="ch-g-sub">' + T("правок") + ": " + esc(g.count) +
          (g.lastAt ? " · " + T("последняя") + " " + esc(when(g.lastAt)) : "") +
          (actors ? " · " + esc(actors) : "") + "</span></span></label>";
    }).join("");
    host.querySelectorAll("input[type=checkbox]").forEach(function(cb){
      cb.onchange = function(){ picked[cb.dataset.key] = cb.checked; renderActions(); };
    });
    renderActions();
  }

  function renderActions(){
    var n = Object.keys(picked).filter(function(k){ return picked[k]; }).length;
    var b = document.getElementById("chExport");
    if (b){
      b.disabled = !n;
      b.textContent = n ? T("Собрать пакет") + " (" + n + ")" : T("Собрать пакет");
    }
  }

  function renderList(){
    var host = document.getElementById("chList");
    if (!host) return;
    var list = (data && data.items) || [];
    if (!list.length){
      host.className = "empty";
      host.textContent = T("Записей нет");
      return;
    }
    host.className = "";
    host.innerHTML = '<table class="ch-tbl"><thead><tr>' +
        "<th>" + T("Когда") + "</th><th>" + T("Что") + "</th><th>" + T("Действие") + "</th>" +
        "<th>" + T("Кто") + "</th><th>" + T("Объект") + "</th>" +
      "</tr></thead><tbody>" +
      list.map(function(c){
        return "<tr" + (c.failed ? ' class="ch-failed"' : "") + ">" +
          '<td class="mono">' + esc(when(c.at)) + "</td>" +
          '<td class="mono">' + esc(c.what) + "</td>" +
          "<td>" + esc(c.action) + (c.failed ? " <span class=\"ch-err\">" + T("с ошибкой") + "</span>" : "") + "</td>" +
          "<td>" + esc(c.actor || "—") + "</td>" +
          "<td>" + esc(titleOf(c.item)) + "</td></tr>";
      }).join("") + "</tbody></table>" +
      (data.truncated ? '<div class="ch-note">' + T("Показаны последние 300 из ") + esc(data.total) + "</div>" : "");
  }

  function titleOf(key){
    var g = ((data && data.groups) || []).filter(function(x){ return x.key === key; })[0];
    return g ? g.title : key;
  }

  /* Пакет собираем той же ручкой, что и вкладка «Настройки»: здесь другой способ выбрать
     объекты, а не другой способ их переносить. Применяется он там же — на приёмнике. */
  function exportPack(){
    var keys = Object.keys(picked).filter(function(k){ return picked[k]; });
    if (!keys.length){ note(T("Отметьте, что переносить"), true); return; }
    note(T("Собираем пакет…"));
    req("POST", "../api/admin/settings-pack/export", { keys: keys }).then(function(p){
      var blob = new Blob([JSON.stringify(p, null, 1)], { type:"application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "settings-" + (p.sourceEnv || "env") + "-" +
        String(p.exportedAt || "").slice(0, 10) + ".json";
      document.body.appendChild(a);
      a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 0);
      note(T("Пакет собран. Примените его на следующем контуре — вкладка «Настройки»."));
    }).catch(function(e){ note((e && e.message) || T("Не удалось собрать пакет"), true); });
  }

  function load(){
    note(T("Читаем журналы…"));
    return req("GET", "../api/admin/deploy/changes?days=" + days).then(function(j){
      data = j || {};
      note("");
      var head = document.getElementById("chHead");
      if (head){
        head.textContent = T("Контур") + ": " + (data.env || "?") + " · " +
          T("за последние") + " " + (data.days || days) + " " + T("дн") +
          " · " + T("правок") + ": " + (data.total || 0);
      }
      renderGroups();
      renderList();
    }).catch(function(e){
      note((e && e.message) || T("Не удалось прочитать изменения"), true);
    });
  }

  function bind(){
    if (bound) return;
    var sel = document.getElementById("chDays");
    if (!sel) return;
    bound = true;
    sel.onchange = function(){ days = parseInt(sel.value, 10) || 14; load(); };
    document.getElementById("chReload").onclick = load;
    document.getElementById("chExport").onclick = exportPack;
  }

  return {
    open: function(){ bind(); if (!data) load(); },
    reload: load
  };
})();

/* Вкладку переключает общий обработчик раздела, а данные нужны только когда её открыли:
   лезть в журналы при каждом заходе в «Выкатки» незачем. */
document.addEventListener("click", function(ev){
  var tab = ev.target.closest && ev.target.closest("#dpTabs .dp-tab");
  if (tab && tab.dataset.tab === "changes" && window.EnvChanges) window.EnvChanges.open();
});
