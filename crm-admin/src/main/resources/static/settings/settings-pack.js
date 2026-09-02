/* ============================================================
   ПЕРЕНОС НАСТРОЕК между контурами — вкладка «Настройки» раздела «Выкатки».

   Код едет коммитами, а роли, модель схемы и справочники живут в базе, и у каждого
   контура она своя. Здесь их собирают в файл на одном контуре и применяют на другом.

   Почему файлом, а не прямым соединением с базой соседа: прямое соединение означало бы
   дать проду доступ в тест. Файл виден человеку целиком и переносится осознанно.

   Применение всегда двухшаговое: сначала предпросмотр «что появится, что изменится»,
   потом применение выбранного. Перед перезаписью сервер кладёт слепок «как было».
   ============================================================ */
window.SettingsPack = (function(){
  "use strict";

  var bound = false, catalog = [], pack = null, preview = null, snaps = [];

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
    var n = document.getElementById("spMsg");
    if (!n) return;
    n.textContent = text || "";
    n.classList.toggle("show", !!text);
    n.style.color = bad ? "var(--coral)" : "";
  }

  // ---------------------------------------------------------------- сборка пакета

  function renderCatalog(){
    var host = document.getElementById("spItems");
    if (!host) return;
    host.innerHTML = catalog.map(function(it){
      return '<label class="sp-item">' +
        '<input type="checkbox" class="sp-pick" value="' + esc(it.key) + '" checked>' +
        '<span class="sp-item-main"><span class="sp-item-title">' + esc(T(it.title)) + "</span>" +
          '<span class="sp-item-about">' + esc(T(it.about)) + "</span></span>" +
        '<span class="sp-item-count mono">' + it.count + "</span>" +
      "</label>";
    }).join("");
  }

  function picked(){
    return Array.prototype.slice.call(document.querySelectorAll("#spItems .sp-pick:checked"))
      .map(function(c){ return c.value; });
  }

  function exportPack(){
    var keys = picked();
    if (!keys.length){ note(T("Выберите, что переносить"), true); return; }
    note(T("Собираем пакет…"));
    req("POST", "../api/admin/settings-pack/export", { keys: keys }).then(function(p){
      var blob = new Blob([JSON.stringify(p, null, 1)], { type:"application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      /* Имя файла говорит, откуда и когда пакет: разбираться в трёх одинаковых
         settings.json на рабочем столе — отдельное удовольствие. */
      a.download = "settings-" + (p.sourceEnv || "env") + "-" +
        String(p.exportedAt || "").slice(0, 10) + ".json";
      document.body.appendChild(a);
      a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 0);
      note(T("Пакет собран: объектов ") + keys.length);
    }).catch(function(e){ note((e && e.message) || T("Не удалось собрать пакет"), true); });
  }

  // ---------------------------------------------------------------- применение

  function readFile(file){
    return new Promise(function(resolve, reject){
      var fr = new FileReader();
      fr.onload = function(){
        try { resolve(JSON.parse(String(fr.result))); }
        catch(e){ reject(new Error(T("Файл не читается как JSON"))); }
      };
      fr.onerror = function(){ reject(new Error(T("Не удалось прочитать файл"))); };
      fr.readAsText(file);
    });
  }

  function onFile(ev){
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    note(T("Читаем пакет…"));
    readFile(file).then(function(p){
      pack = p;
      return req("POST", "../api/admin/settings-pack/preview", p);
    }).then(function(pv){
      preview = pv;
      note("");
      renderPreview();
    }).catch(function(e){
      pack = null; preview = null; renderPreview();
      note((e && e.message) || T("Пакет не подошёл"), true);
    });
  }

  function renderPreview(){
    var host = document.getElementById("spPreview");
    if (!host) return;
    if (!preview){ host.innerHTML = ""; return; }
    var rows = preview.items || [];
    host.innerHTML =
      '<div class="sp-from">' + T("Пакет с контура") + " <b>" + esc(preview.sourceEnv || "?") + "</b>" +
        (preview.exportedAt ? " · " + esc(when(preview.exportedAt)) : "") +
        (preview.exportedBy ? " · " + esc(preview.exportedBy) : "") +
        " → " + T("применяем на") + " <b>" + esc(preview.targetEnv) + "</b></div>" +
      (preview.sameEnv ? '<div class="sp-warn">' +
        T("Пакет собран на этом же контуре — применять его здесь нечего.") + "</div>" : "") +
      '<table class="sp-tbl"><thead><tr><th></th><th>' + T("Объект") + "</th><th>" + T("Появится") +
        "</th><th>" + T("Изменится") + "</th><th>" + T("Не тронем") + "</th><th></th></tr></thead><tbody>" +
      rows.map(function(r){
        return "<tr><td><input type=\"checkbox\" class=\"sp-apply\" value=\"" + esc(r.key) + "\" checked></td>" +
          "<td><b>" + esc(T(r.title)) + "</b></td>" +
          '<td class="num">' + (r.add || 0) + "</td>" +
          '<td class="num">' + (r.update || 0) + "</td>" +
          '<td class="num">' + (r.skip || 0) + "</td>" +
          '<td class="sp-note">' + esc(T(r.note || "")) + "</td></tr>";
      }).join("") + "</tbody></table>" +
      '<div class="row" style="gap:10px;margin-top:12px">' +
        '<button type="button" class="btn primary" id="spApply">' + T("Применить выбранное") + "</button>" +
        '<button type="button" class="btn" id="spDrop">' + T("Отменить") + "</button>" +
      "</div>";

    document.getElementById("spApply").onclick = apply;
    document.getElementById("spDrop").onclick = function(){
      pack = null; preview = null; renderPreview(); note("");
      var f = document.getElementById("spFile");
      if (f) f.value = "";
    };
  }

  function apply(){
    if (!pack) return;
    var keys = Array.prototype.slice.call(document.querySelectorAll("#spPreview .sp-apply:checked"))
      .map(function(c){ return c.value; });
    if (!keys.length){ note(T("Выберите, что применять"), true); return; }
    /* Спрашиваем прямо и с именем контура: пакет перезаписывает роли и права, и «ой, не
       туда» здесь стоит дорого. Слепок «как было» сервер снимет, но лучше не проверять. */
    if (!confirm(T("Применить на контуре") + " " + preview.targetEnv + "? " +
        T("Выбранные объекты будут перезаписаны данными из пакета."))) return;
    note(T("Применяем…"));
    req("POST", "../api/admin/settings-pack/apply", { pack: pack, keys: keys }).then(function(res){
      var parts = (res.applied || []).map(function(a){
        var bits = [];
        if (a.added) bits.push(T("добавлено") + " " + a.added);
        if (a.updated) bits.push(T("обновлено") + " " + a.updated);
        return T(a.title) + (bits.length ? " (" + bits.join(", ") + ")" : "");
      });
      note(T("Готово") + ": " + parts.join("; "));
      pack = null; preview = null; renderPreview();
      var f = document.getElementById("spFile");
      if (f) f.value = "";
      return loadSnapshots();
    }).catch(function(e){ note((e && e.message) || T("Не удалось применить"), true); });
  }

  // ---------------------------------------------------------------- слепки

  function loadSnapshots(){
    return req("GET", "../api/admin/settings-pack/snapshots?limit=20").then(function(list){
      snaps = list || [];
      renderSnapshots();
    }).catch(function(){ snaps = []; renderSnapshots(); });
  }

  function renderSnapshots(){
    var host = document.getElementById("spSnaps");
    if (!host) return;
    if (!snaps.length){ host.className = "empty"; host.textContent = T("Слепков нет: настройки ещё не переносили"); return; }
    host.className = "";
    host.innerHTML = '<table class="sp-tbl"><thead><tr><th>' + T("Когда") + "</th><th>" + T("Объект") +
        "</th><th>" + T("Пакет с") + "</th><th>" + T("Кто") + "</th><th></th></tr></thead><tbody>" +
      snaps.map(function(s){
        return "<tr><td class=\"mono\">" + esc(when(s.at)) + "</td>" +
          "<td>" + esc(T(s.title)) + "</td>" +
          "<td>" + esc(s.sourceEnv || "—") + "</td>" +
          "<td>" + esc(s.actor || "—") + "</td>" +
          '<td><button type="button" class="btn sp-restore" data-id="' + s.id + '">' +
            T("Вернуть как было") + "</button></td></tr>";
      }).join("") + "</tbody></table>";

    Array.prototype.forEach.call(host.querySelectorAll(".sp-restore"), function(b){
      b.onclick = function(){
        if (!confirm(T("Вернуть объект к состоянию из слепка? Текущее состояние тоже сохранится слепком."))) return;
        req("POST", "../api/admin/settings-pack/snapshots/" + b.dataset.id + "/restore")
          .then(function(r){ note(T("Возвращено") + ": " + T(r.title)); return loadSnapshots(); })
          .catch(function(e){ note((e && e.message) || T("Не удалось вернуть"), true); });
      };
    });
  }

  function load(){
    return req("GET", "../api/admin/settings-pack")
      .then(function(list){ catalog = list || []; renderCatalog(); })
      .then(loadSnapshots)
      .catch(function(e){ note((e && e.message) || T("Не удалось прочитать список объектов"), true); });
  }

  function bind(){
    if (bound) return;
    var b = document.getElementById("spExport");
    if (!b) return;
    bound = true;
    b.onclick = exportPack;
    document.getElementById("spFile").onchange = onFile;
  }

  return { open: function(){ bind(); load(); }, reload: load };
})();
