/* Раздел «Управление доступом» (только ADMIN). Рендерит UI в #sec-access.
   Права задаются матрицей «раздел × [Просмотр/Добавление/Редактирование/Удаление]».
   Роль — пресет: при её смене матрица заполняется значениями по умолчанию, дальше
   админ правит клетки вручную (напр. ридеру дать add только в промо). Истина — матрица;
   на бэке enforcement идёт по ней (см. AccessGuard.requireCapability). */
(function () {
  "use strict";

  var SECTION_LABELS = {
    home: "Главная", deviations: "Панель отклонений", onelink: "OneLink Builder",
    admin: "Мастер коммуникаций", templates: "Список шаблонов",
    dashboard: "Дашборд", promo: "Планирование промо",
    journeys: "Цепочки", access: "Управление доступом"
  };
  /* Перевод: t() — глобальный словарь оболочки (I18N_EN); до её загрузки отдаём как есть */
  function tr(s) { return (typeof window.t === "function") ? window.t(s) : s; }
  function sectionLabel(s) { return tr(SECTION_LABELS[s] || s); }
  /* Роль-пресет. ADMIN обходит матрицу на сервере — при её выборе матрицу гасим. */
  var ROLES = [
    { v: "READER", t: "Reader — просмотр (права уточняются матрицей)" },
    { v: "EDITOR", t: "Editor — просмотр + запись в доступных разделах" },
    { v: "ADMIN", t: "Admin — полный доступ ко всем разделам" }
  ];
  var CAPS = [
    { k: "read", t: "Просмотр" },
    { k: "add", t: "Добавление" },
    { k: "edit", t: "Редактирование" },
    { k: "delete", t: "Удаление" }
  ];

  var matrixSections = [];   // [{id, writable, adminOnly}] — только не-adminOnly
  var rendered = false;

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "style") el.style.cssText = attrs[k];
      else if (k === "class") el.className = attrs[k];
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }

  /** Роль ADMIN доступна в списке только супер-администратору (сервер проверяет это же правило). */
  function isSuperAdmin() {
    return !!(window.CRM && CRM.me && CRM.me.isSuperAdmin);
  }
  /* Наружу супер-админ выглядит обычным админом (см. CRM.displayRole). */
  function shownRole(role) {
    return (window.CRM && CRM.displayRole) ? CRM.displayRole(role) : role;
  }

  function fieldStyle() {
    return "padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg2);color:var(--ink);font-size:13px";
  }
  function btnStyle(bg) {
    return "padding:7px 12px;border:0;border-radius:8px;background:" + (bg || "#4a6cf7") + ";color:#fff;font-size:13px;cursor:pointer";
  }
  function field(label, control) {
    return h("div", { style: "margin:8px 0" }, [
      h("div", { style: "font-size:12px;color:var(--faint);margin-bottom:4px" }, [label]),
      control
    ]);
  }

  function roleSelect(value) {
    var sel = h("select", { style: fieldStyle() });
    ROLES.filter(function (r) {
      return r.v !== "ADMIN" || isSuperAdmin() || value === "ADMIN";
    }).forEach(function (r) {
      var o = h("option", { value: r.v }, [tr(r.t)]);
      if (r.v === value) o.selected = true;
      sel.appendChild(o);
    });
    // не супер-админ не может ни назначить, ни снять администратора
    if (!isSuperAdmin() && value === "ADMIN") {
      sel.disabled = true;
      sel.title = tr("Менять роль администратора может только супер-администратор");
    }
    return sel;
  }

  /* ---------- матрица прав ----------
     accessList — [{section, read, add, edit, delete}] с сервера. Возвращает объект с
     методами collect() (собрать в тот же формат) и applyPreset(role). */
  /* Что даёт роль-пресет по записи в writable-разделах:
       READER — только просмотр; EDITOR — всё, кроме удаления; ADMIN — всё. */
  function presetWrites(role) {
    if (role === "ADMIN") return { add: true, edit: true, delete: true };
    if (role === "EDITOR") return { add: true, edit: true, delete: false };
    return { add: false, edit: false, delete: false };
  }

  function buildMatrix(accessList, initialRole) {
    var byId = {};
    (accessList || []).forEach(function (a) { byId[a.section] = a; });
    var rows = {};
    /* Текущий шаблон записи по роли — применяется к writable-разделу при включении
       его просмотра (ручном или пресетом). Витрины остаются только на просмотр. */
    var writePattern = presetWrites(initialRole);

    var thStyle = "text-align:center;padding:6px 8px;border-bottom:1px solid var(--line);color:var(--dim);font-size:12px;font-weight:600";
    var tdStyle = "text-align:center;padding:6px 8px;border-bottom:1px solid var(--line)";
    var head = h("tr", null, [h("th", { style: thStyle.replace("center", "left") }, [tr("Раздел")])]
      .concat(CAPS.map(function (c) { return h("th", { style: thStyle }, [tr(c.t)]); })));
    var body = [head];

    matrixSections.forEach(function (sec) {
      var cur = byId[sec.id] || {};
      var checks = {};
      CAPS.forEach(function (c) {
        var cb = h("input", { type: "checkbox" });
        cb.checked = !!cur[c.k];
        // add/edit/delete существуют только у writable-разделов (витрины — только просмотр)
        if (c.k !== "read" && !sec.writable) { cb.checked = false; cb.disabled = true; }
        checks[c.k] = cb;
      });
      // Начальное состояние: только блокируем запись, если раздел не виден. Значения
      // (из accessList при правке существующего) не трогаем — иначе стёрли бы права.
      if (sec.writable) {
        var vis = checks.read.checked;
        ["add", "edit", "delete"].forEach(function (k) { checks[k].disabled = !vis; });
      }
      // Ручное переключение просмотра: выключили — снимаем запись; включили — ставим
      // запись по шаблону текущей роли (editor: add/edit без delete; reader: ничего).
      checks.read.addEventListener("change", function () {
        if (!sec.writable) return;
        var on = checks.read.checked;
        ["add", "edit", "delete"].forEach(function (k) {
          checks[k].disabled = !on;
          checks[k].checked = on ? writePattern[k] : false;
        });
      });
      rows[sec.id] = { sec: sec, checks: checks };

      var cells = [h("td", { style: tdStyle.replace("center", "left") + ";color:var(--ink)" }, [sectionLabel(sec.id)])];
      CAPS.forEach(function (c) {
        var cell = h("td", { style: tdStyle });
        if (c.k === "read" || sec.writable) cell.appendChild(checks[c.k]);
        else cell.appendChild(h("span", { style: "color:var(--faint)" }, ["—"]));
        cells.push(cell);
      });
      body.push(h("tr", null, cells));
    });

    var table = h("table", { style: "width:100%;border-collapse:collapse;font-size:13px" }, body);
    var wrap = h("div", { style: "overflow-x:auto;border:1px solid var(--line);border-radius:8px" }, [table]);

    return {
      el: wrap,
      collect: function () {
        return matrixSections.map(function (sec) {
          var r = rows[sec.id].checks;
          return {
            section: sec.id,
            read: r.read.checked,
            add: sec.writable && r.add.checked,
            edit: sec.writable && r.edit.checked,
            delete: sec.writable && r.delete.checked
          };
        }).filter(function (a) { return a.read || a.add || a.edit || a.delete; });
      },
      /* Пресет по роли — предвыбор по умолчанию (админ может уточнить любую клетку):
         READER — все разделы на просмотр; EDITOR — все разделы, всё кроме удаления;
         ADMIN — всё. Отмечает просмотр у ВСЕХ разделов и запись во writable по шаблону. */
      applyPreset: function (role) {
        writePattern = presetWrites(role);
        matrixSections.forEach(function (sec) {
          var r = rows[sec.id].checks;
          r.read.checked = true;
          if (sec.writable) {
            ["add", "edit", "delete"].forEach(function (k) {
              r[k].disabled = false;
              r[k].checked = writePattern[k];
            });
          }
        });
      },
      setEnabled: function (on) {
        matrixSections.forEach(function (sec) {
          var r = rows[sec.id].checks;
          r.read.disabled = !on;
          ["add", "edit", "delete"].forEach(function (k) {
            if (sec.writable) r[k].disabled = !on || !r.read.checked;
          });
        });
        wrap.style.opacity = on ? "1" : ".5";
      }
    };
  }

  /* Роль + матрица связаны: смена роли перезаполняет матрицу пресетом. У ADMIN пресет
     отмечает всё, а матрица гасится с пометкой «доступ куда угодно» — админ обходит её
     на сервере, поэтому редактировать клетки незачем. */
  function wireRoleToMatrix(role, matrix, note) {
    function apply() {
      if (role.value === "ADMIN") {
        matrix.setEnabled(false);
        note.textContent = tr("Администратор: доступ куда угодно и для чего угодно — матрица не ограничивает.");
      } else {
        matrix.setEnabled(true);
        note.textContent = "";
      }
    }
    role.addEventListener("change", function () {
      matrix.applyPreset(role.value);   // ADMIN — тоже: отметить всё, затем погасить
      apply();
    });
    apply();
  }

  /* ---------- список пользователей ---------- */
  function capLetters(a) {
    var s = "";
    if (a.read) s += "П"; if (a.add) s += "Д"; if (a.edit) s += "Р"; if (a.delete) s += "У";
    return s;
  }
  function accessSummary(u) {
    var list = (u.access || []).filter(function (a) { return a.read || a.add || a.edit || a.delete; });
    if (!list.length) return "—";
    return list.map(function (a) { return sectionLabel(a.section) + " " + capLetters(a); }).join(" · ");
  }

  function renderUsers(container) {
    CRM.adminListUsers().then(function (users) {
      container.innerHTML = "";
      var table = h("table", { style: "width:100%;border-collapse:collapse;font-size:13px" });
      var head = h("tr", null, ["Почта", "Имя", "Роль", "Доступ", "Активен", ""].map(function (t) {
        return h("th", { style: "text-align:left;padding:8px;border-bottom:1px solid var(--line);color:var(--dim)" }, [t ? tr(t) : t]);
      }));
      table.appendChild(head);
      users.forEach(function (u) {
        var td = "padding:8px;border-bottom:1px solid var(--line)";
        var row = h("tr", null, [
          h("td", { style: td }, [u.email]),
          h("td", { style: td }, [u.displayName || "—"]),
          h("td", { style: td }, [shownRole(u.role)]),
          h("td", { style: td + ";color:var(--dim);max-width:340px" }, [accessSummary(u)]),
          h("td", { style: td }, [u.enabled ? "✓" : "—"]),
          // manageable приходит с сервера: false — запись не в зоне ответственности текущего пользователя
          h("td", { style: td + ";white-space:nowrap" },
            u.manageable === false
              ? [h("span", { style: "color:var(--faint)" }, ["—"])]
              : [
                  h("button", { style: btnStyle("#334155"), onclick: function () { editUser(u, container); } }, [tr("Изменить")]),
                  h("span", null, [" "]),
                  h("button", { style: btnStyle("#7c2d12"), onclick: function () { resetPwd(u); } }, [tr("Пароль")]),
                  h("span", null, [" "]),
                  h("button", { style: btnStyle("#991b1b"), onclick: function () { delUser(u, container); } }, [tr("Удалить")])
                ])
        ]);
        table.appendChild(row);
      });
      container.appendChild(table);
    }).catch(function (e) { container.textContent = "Ошибка: " + e.message; });
  }

  function editUser(u, container) {
    var box = h("div", { style: "margin:12px 0;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--card)" });
    var name = h("input", { style: fieldStyle(), value: u.displayName || "" });
    var role = roleSelect(shownRole(u.role));
    var enabled = h("input", { type: "checkbox" }); enabled.checked = u.enabled;
    var matrix = buildMatrix(u.access, shownRole(u.role));
    var note = h("div", { style: "font-size:12px;color:var(--faint);margin-top:6px" });
    wireRoleToMatrix(role, matrix, note);
    box.appendChild(h("div", { style: "font-weight:600;margin-bottom:8px" }, [tr("Изменение: ") + u.email]));
    box.appendChild(field(tr("Имя"), name));
    box.appendChild(field(tr("Роль"), role));
    box.appendChild(field(tr("Активен"), enabled));
    box.appendChild(field(tr("Права по разделам"), matrix.el));
    box.appendChild(note);
    box.appendChild(h("button", {
      style: btnStyle() + ";margin-top:10px",
      onclick: function () {
        CRM.adminUpdateUser(u.id, {
          displayName: name.value, role: role.value, enabled: enabled.checked,
          access: matrix.collect()
        }).then(function () { renderUsers(container); }).catch(function (e) { alert(e.message); });
      }
    }, [tr("Сохранить")]));
    box.appendChild(h("button", {
      style: btnStyle("#475569") + ";margin:10px 0 0 8px",
      onclick: function () { renderUsers(container); }
    }, [tr("Отмена")]));
    container.insertBefore(box, container.firstChild);
  }

  function resetPwd(u) {
    var pwd = prompt("Новый пароль для " + u.email + " (минимум 8 символов):");
    if (!pwd) return;
    CRM.adminResetPassword(u.id, pwd).then(function () { alert("Пароль обновлён"); }).catch(function (e) { alert(e.message); });
  }

  function delUser(u, container) {
    if (!confirm("Удалить пользователя " + u.email + "?")) return;
    CRM.adminDeleteUser(u.id).then(function () { renderUsers(container); }).catch(function (e) { alert(e.message); });
  }

  function createForm(usersContainer) {
    var email = h("input", { style: fieldStyle(), type: "email", placeholder: "name@banki.ru" });
    var name = h("input", { style: fieldStyle(), placeholder: tr("Имя") });
    var pwd = h("input", { style: fieldStyle(), type: "password", placeholder: tr("Пароль (мин. 8)") });
    var role = roleSelect("READER");
    var matrix = buildMatrix([], "READER");
    matrix.applyPreset("READER");   // стартовый пресет: все разделы на просмотр
    var note = h("div", { style: "font-size:12px;color:var(--faint);margin-top:6px" });
    wireRoleToMatrix(role, matrix, note);
    var box = h("div", { style: "padding:16px;border:1px solid var(--line);border-radius:10px;background:var(--card);margin-bottom:18px" });
    box.appendChild(h("div", { style: "font-weight:600;margin-bottom:10px" }, [tr("Новый пользователь")]));
    box.appendChild(field(tr("Почта"), email));
    box.appendChild(field(tr("Имя"), name));
    box.appendChild(field(tr("Пароль"), pwd));
    box.appendChild(field(tr("Роль"), role));
    box.appendChild(field(tr("Права по разделам"), matrix.el));
    box.appendChild(note);
    box.appendChild(h("button", {
      style: btnStyle() + ";margin-top:12px",
      onclick: function () {
        CRM.adminCreateUser({
          email: email.value.trim(), displayName: name.value, password: pwd.value,
          role: role.value, access: matrix.collect()
        }).then(function () {
          email.value = name.value = pwd.value = "";
          matrix.applyPreset(role.value);
          renderUsers(usersContainer);
        }).catch(function (e) { alert(e.message); });
      }
    }, [tr("Создать")]));
    return box;
  }

  /* Сброс кэша отрисовки (например, при смене языка) — раздел перерисуется при следующем открытии */
  window.accessInvalidate = function () { rendered = false; };

  window.renderAccessSection = function () {
    var root = document.getElementById("sec-access");
    if (!root) return;
    if (rendered) return;
    root.innerHTML = "";
    /* заголовок и описание рисует pane настроечной админки (pane-access) */
    var usersContainer = h("div", null, []);
    CRM.adminSections().then(function (secs) {
      // secs — [{id, writable, adminOnly}]; в матрице только не-adminOnly разделы
      matrixSections = (secs || []).filter(function (s) { return !s.adminOnly; });
      root.appendChild(createForm(usersContainer));
      root.appendChild(usersContainer);
      renderUsers(usersContainer);
      rendered = true;
    }).catch(function (e) { root.appendChild(h("div", null, ["Ошибка: " + e.message])); });
  };
})();
