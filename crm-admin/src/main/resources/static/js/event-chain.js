/* ============================================================
   ЦЕПОЧКА ОНЛАЙН-СОБЫТИЯ — отрисовка по commapi.events_chain.

   Рисуем то, что реально исполняется, а не нашу модель. Отсюда два следствия.
   Первое: раздел только читает — второй способ менять цепочку означал бы два
   источника истины, и расходиться они начали бы в первый же день. Второе: если
   в данных что-то не так (шаг без шаблона, шаги с разным условием выхода), мы
   это показываем, а не прячем: цепочка на экране должна совпадать с той, что
   отработает у человека.

   Раскладка повторяет то, как эту цепочку рисуют на бумаге: старт, пауза,
   коммуникация, снова пауза — и полоса условия выхода под всеми шагами сразу.
   Условие выхода лежит у каждой строки таблицы, но означает весь поток, поэтому
   на схеме ему место полосой, а не отметкой на одном шаге.
   ============================================================ */
(function(){
  "use strict";

  var chains = [], current = null, loaded = false;

  function $(id){ return document.getElementById(id); }
  function esc(v){ return String(v == null ? "" : v)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function msg(t, bad){
    var el = $("evChainMsg");
    if (!el) return;
    el.textContent = t || "";
    el.style.color = bad ? "var(--coral)" : "var(--dim)";
  }

  /* Минуты словами. «через 1440 мин» человек в уме не переводит, а решение
     «слать через сутки или через час» принимается именно по этому числу. */
  function wait(min){
    if (min == null) return "сразу";
    var m = Number(min);
    if (!isFinite(m) || m <= 0) return "сразу";
    if (m < 60) return m + " мин";
    if (m % 1440 === 0) return (m / 1440) + " " + plural(m / 1440, "день", "дня", "дней");
    if (m % 60 === 0) return (m / 60) + " " + plural(m / 60, "час", "часа", "часов");
    return Math.floor(m / 60) + " ч " + (m % 60) + " мин";
  }
  function plural(n, one, few, many){
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    return b === 1 ? one : many;
  }

  function req(url){
    return fetch(url, { credentials:"same-origin", headers:{ Accept:"application/json" } })
      .then(function(r){
        if (r.ok) return r.json();
        return r.text().then(function(t){
          var m = ""; try { m = JSON.parse(t).message || ""; } catch(e){}
          throw new Error(m || ("HTTP " + r.status));
        });
      });
  }

  function renderPicker(){
    var sel = $("evChainPick");
    if (!sel) return;
    if (!chains.length){
      sel.innerHTML = '<option value="">цепочек нет</option>';
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    sel.innerHTML = chains.map(function(c){
      var off = c.stepsActive < c.steps ? " · выключенных шагов: " + (c.steps - c.stepsActive) : "";
      return '<option value="' + esc(c.id) + '">' + esc(c.eventName || ("#" + c.id)) +
        (c.system ? " · " + esc(c.system) : "") + " · шагов: " + c.steps + esc(off) + "</option>";
    }).join("");
  }

  function node(kind, label, value, sub){
    return '<div class="evc-node ' + kind + '">' +
      '<div class="evc-l">' + esc(label) + "</div>" +
      '<div class="evc-v">' + esc(value) + "</div>" +
      (sub ? '<div class="evc-s">' + esc(sub) + "</div>" : "") + "</div>";
  }

  function renderChain(c){
    var host = $("evChainBody");
    if (!host) return;
    if (!c || c.available === false){
      host.innerHTML = '<div class="evc-empty">' +
        esc(c && c.error ? "Не удалось прочитать цепочку: " + c.error
                         : "Таблица commapi.events_chain недоступна — проверьте подключение к базе событий.") +
        "</div>";
      return;
    }
    var steps = c.steps || [];
    if (!steps.length){
      host.innerHTML = '<div class="evc-empty">У этого события шагов не заведено.</div>';
      return;
    }

    var parts = [node("start", "Событие · старт", c.eventName || "—",
                       c.system ? "система: " + c.system : "")];
    steps.forEach(function(s){
      parts.push('<div class="evc-arrow">→</div>');
      parts.push(node("wait", "Пауза", wait(s.waitTime), "от прихода события"));
      parts.push('<div class="evc-arrow">→</div>');
      /* Шаг без шаблона — не редкость в данных и не мелочь: такой шаг ничего не
         отправит. Показываем это прямо в узле, а не молча рисуем пустоту. */
      var tpl = s.templateId != null ? "шаблон " + s.templateId : "шаблон не указан";
      var kind = !s.active ? "off" : (s.templateId == null ? "bad" : "send");
      var sub = [];
      if (!s.active) sub.push("шаг выключен");
      if (s.exitStep) sub.push("снимает: " + s.exitStep);
      parts.push(node(kind, "Шаг " + s.order, tpl, sub.join(" · ")));
    });

    var band = c.exitCondition
      ? '<div class="evc-band">' +
          '<div class="evc-l">Условие выхода · слушается всю цепочку</div>' +
          '<div class="evc-v">' + esc(c.exitCondition) + "</div>" +
          '<div class="evc-s">приход этого события обрывает весь поток</div></div>'
      : '<div class="evc-band none">' +
          '<div class="evc-l">Условие выхода</div>' +
          '<div class="evc-v">не задано</div>' +
          '<div class="evc-s">цепочку не обрывает ничего — она отработает до конца</div></div>';

    host.innerHTML = '<div class="evc-scroll"><div class="evc-flow">' + parts.join("") + "</div></div>" + band;
  }

  function loadChain(id){
    if (!id) { renderChain(null); return; }
    msg("Читаем цепочку…");
    req("api/events/chains/" + encodeURIComponent(id))
      .then(function(c){ current = c; msg(""); renderChain(c); })
      .catch(function(e){ msg((e && e.message) || "Не удалось прочитать цепочку", true); });
  }

  function load(){
    msg("Читаем список…");
    return req("api/events/chains")
      .then(function(list){
        chains = list || [];
        msg(chains.length ? "" : "Цепочек не найдено");
        renderPicker();
        if (chains.length) loadChain(chains[0].id); else renderChain(null);
      })
      .catch(function(e){
        chains = [];
        renderPicker();
        msg((e && e.message) || "Не удалось прочитать список", true);
      });
  }

  function bind(){
    var sel = $("evChainPick");
    if (sel) sel.onchange = function(){ loadChain(sel.value); };
    var b = $("evChainReload");
    if (b) b.onclick = function(){ load(); };
  }

  /* Раздел открывают редко, а запрос идёт в чужую базу — тянем при первом показе,
     а не при загрузке страницы. */
  window.EventChain = {
    open: function(){
      bind();
      if (!loaded){ loaded = true; load(); }
    },
    reload: load
  };
})();
