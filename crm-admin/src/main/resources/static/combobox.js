/* Нормальный редактируемый выпадающий список (combobox), без костылей.
   Разметка:
     <div class="combo">
       <input class="combo-input ..." ...>
       <div class="combo-pop"></div>
     </div>
   Варианты задаются через data-options='["a","b"]' на input,
   либо программно: Combobox.setOptions(inputEl, [...]).

   Возможности: свободный ввод + подсказки, фильтрация по подстроке,
   навигация стрелками ↑/↓, выбор Enter/кликом, закрытие по клику вне
   (через document mousedown — без гонки onblur). */
(function () {
  "use strict";

  var OPEN = null; // текущий открытый combobox {wrap,input,pop,items,active}

  function optionsOf(input) {
    var fromProp = input._comboOptions;
    if (Array.isArray(fromProp)) return fromProp;
    var raw = input.getAttribute("data-options");
    if (raw) {
      try { return JSON.parse(raw); } catch (e) { /* ignore */ }
    }
    // fallback: <div> внутри соседнего .combo-pop (совместимость со старой разметкой)
    var pop = input.parentNode.querySelector(".combo-pop");
    if (pop) {
      var seeded = [];
      pop.querySelectorAll("[data-seed]").forEach(function (d) { seeded.push(d.textContent.trim()); });
      if (seeded.length) return seeded;
    }
    return [];
  }

  function close() {
    if (!OPEN) return;
    OPEN.pop.classList.remove("open");
    OPEN.pop.innerHTML = "";
    OPEN = null;
  }

  function render(input, filter) {
    var pop = input.parentNode.querySelector(".combo-pop");
    if (!pop) return;
    var opts = optionsOf(input);
    var q = (filter || "").toLowerCase();
    var list = opts.filter(function (o) {
      return o != null && String(o).toLowerCase().indexOf(q) >= 0;
    });
    pop.innerHTML = "";
    if (!list.length) { pop.classList.remove("open"); OPEN = null; return; }
    var items = [];
    list.slice(0, 200).forEach(function (o) {
      var d = document.createElement("div");
      d.className = "combo-item";
      d.textContent = o;
      d.addEventListener("mousedown", function (e) {
        e.preventDefault(); // не даём input потерять фокус до присвоения
        input.value = o;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        close();
        input.focus();
      });
      pop.appendChild(d);
      items.push(d);
    });
    pop.classList.add("open");
    OPEN = { input: input, pop: pop, items: items, active: -1 };
  }

  function setActive(delta) {
    if (!OPEN) return;
    var n = OPEN.items.length;
    if (!n) return;
    if (OPEN.active >= 0 && OPEN.items[OPEN.active]) OPEN.items[OPEN.active].classList.remove("active");
    OPEN.active = (OPEN.active + delta + n) % n;
    var el = OPEN.items[OPEN.active];
    el.classList.add("active");
    el.scrollIntoView({ block: "nearest" });
  }

  function onKey(e) {
    var input = e.target;
    if (!input.classList || !input.classList.contains("combo-input")) return;
    if (e.key === "ArrowDown") { if (!OPEN) render(input, input.value); else setActive(1); e.preventDefault(); }
    else if (e.key === "ArrowUp") { if (OPEN) { setActive(-1); e.preventDefault(); } }
    else if (e.key === "Enter") {
      if (OPEN && OPEN.active >= 0 && OPEN.items[OPEN.active]) {
        e.preventDefault();
        OPEN.items[OPEN.active].dispatchEvent(new MouseEvent("mousedown"));
      }
    }
    else if (e.key === "Escape") { close(); }
  }

  function attach(root) {
    (root || document).querySelectorAll("input.combo-input").forEach(function (input) {
      if (input._comboBound) return;
      input._comboBound = true;
      input.setAttribute("autocomplete", "off");
      input.addEventListener("focus", function () { render(input, input.value); });
      input.addEventListener("input", function () { render(input, input.value); });
      input.addEventListener("keydown", onKey);
    });
  }

  // Закрытие по клику вне combobox (mousedown, чтобы успеть до потери фокуса).
  document.addEventListener("mousedown", function (e) {
    if (!OPEN) return;
    if (!OPEN.input.parentNode.contains(e.target)) close();
  });

  window.Combobox = {
    attach: attach,
    setOptions: function (input, opts) {
      if (!input) return;
      input._comboOptions = Array.isArray(opts) ? opts : [];
    },
    /** Проставить одинаковые опции всем combobox с указанным селектором. */
    setOptionsFor: function (selector, opts) {
      document.querySelectorAll(selector).forEach(function (i) {
        i._comboOptions = Array.isArray(opts) ? opts : [];
      });
    },
    close: close
  };

  document.addEventListener("DOMContentLoaded", function () { attach(document); });
})();
