/* Раздел «Управление доступом» (только ADMIN). Рендерит UI в #sec-access. */
(function () {
  "use strict";

  var SECTION_LABELS = {
    home: "Главная", deviations: "Панель отклонений", onelink: "OneLink Builder",
    admin: "Мастер коммуникаций", templates: "Список шаблонов",
    dashboard: "Дашборд", access: "Управление доступом"
  };
  var ROLES = [
    { v: "READER", t: "Reader — только просмотр" },
    { v: "EDITOR", t: "Editor — + создание/редактирование шаблонов" },
    { v: "ADMIN", t: "Admin — + управление доступом" }
  ];

  var allSections = [];
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

  function sectionCheatboxes(selected, idPrefix) {
    var wrap = h("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-top:6px" });
    allSections.forEach(function (s) {
      var id = idPrefix + s;
      var cb = h("input", { type: "checkbox", id: id, value: s });
      if (selected && selected.indexOf(s) >= 0) cb.checked = true;
      wrap.appendChild(h("label", { style: "display:flex;align-items:center;gap:5px;font-size:13px;color:#cbd5e1" },
        [cb, SECTION_LABELS[s] || s]));
    });
    return wrap;
  }

  function collectSections(idPrefix) {
    return allSections.filter(function (s) {
      var el = document.getElementById(idPrefix + s);
      return el && el.checked;
    });
  }

  function roleSelect(value) {
    var sel = h("select", { style: fieldStyle() });
    ROLES.forEach(function (r) {
      var o = h("option", { value: r.v }, [r.t]);
      if (r.v === value) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }

  function fieldStyle() {
    return "padding:8px 10px;border-radius:8px;border:1px solid #263145;background:#0c1120;color:#e6ebf5;font-size:13px";
  }
  function btnStyle(bg) {
    return "padding:7px 12px;border:0;border-radius:8px;background:" + (bg || "#4a6cf7") + ";color:#fff;font-size:13px;cursor:pointer";
  }

  function renderUsers(container) {
    CRM.adminListUsers().then(function (users) {
      container.innerHTML = "";
      var table = h("table", { style: "width:100%;border-collapse:collapse;font-size:13px" });
      var head = h("tr", null, ["Почта", "Имя", "Роль", "Разделы", "Активен", ""].map(function (t) {
        return h("th", { style: "text-align:left;padding:8px;border-bottom:1px solid #263145;color:#8a97ad" }, [t]);
      }));
      table.appendChild(head);
      users.forEach(function (u) {
        var secText = (u.sections || []).map(function (s) { return SECTION_LABELS[s] || s; }).join(", ");
        var row = h("tr", null, [
          h("td", { style: "padding:8px;border-bottom:1px solid #1b2333" }, [u.email]),
          h("td", { style: "padding:8px;border-bottom:1px solid #1b2333" }, [u.displayName || "—"]),
          h("td", { style: "padding:8px;border-bottom:1px solid #1b2333" }, [u.role]),
          h("td", { style: "padding:8px;border-bottom:1px solid #1b2333;color:#8a97ad;max-width:260px" }, [secText || "—"]),
          h("td", { style: "padding:8px;border-bottom:1px solid #1b2333" }, [u.enabled ? "✓" : "—"]),
          h("td", { style: "padding:8px;border-bottom:1px solid #1b2333;white-space:nowrap" }, [
            h("button", { style: btnStyle("#334155"), onclick: function () { editUser(u, container); } }, ["Изменить"]),
            h("span", null, [" "]),
            h("button", { style: btnStyle("#7c2d12"), onclick: function () { resetPwd(u); } }, ["Пароль"]),
            h("span", null, [" "]),
            h("button", { style: btnStyle("#991b1b"), onclick: function () { delUser(u, container); } }, ["Удалить"])
          ])
        ]);
        table.appendChild(row);
      });
      container.appendChild(table);
    }).catch(function (e) { container.textContent = "Ошибка: " + e.message; });
  }

  function editUser(u, container) {
    var box = h("div", { style: "margin:12px 0;padding:14px;border:1px solid #263145;border-radius:10px;background:#131a29" });
    var name = h("input", { style: fieldStyle(), value: u.displayName || "" });
    var role = roleSelect(u.role);
    var enabled = h("input", { type: "checkbox" }); enabled.checked = u.enabled;
    var secs = sectionCheatboxes(u.sections, "edit_" + u.id + "_");
    box.appendChild(h("div", { style: "font-weight:600;margin-bottom:8px" }, ["Изменение: " + u.email]));
    box.appendChild(field("Имя", name));
    box.appendChild(field("Роль", role));
    box.appendChild(field("Активен", enabled));
    box.appendChild(field("Разделы", secs));
    box.appendChild(h("button", {
      style: btnStyle() + ";margin-top:10px",
      onclick: function () {
        CRM.adminUpdateUser(u.id, {
          displayName: name.value, role: role.value, enabled: enabled.checked,
          sections: collectSections("edit_" + u.id + "_")
        }).then(function () { renderUsers(container); }).catch(function (e) { alert(e.message); });
      }
    }, ["Сохранить"]));
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

  function field(label, control) {
    return h("div", { style: "margin:8px 0" }, [
      h("div", { style: "font-size:12px;color:#8a97ad;margin-bottom:4px" }, [label]),
      control
    ]);
  }

  function createForm(usersContainer) {
    var email = h("input", { style: fieldStyle(), type: "email", placeholder: "name@banki.ru" });
    var name = h("input", { style: fieldStyle(), placeholder: "Имя" });
    var pwd = h("input", { style: fieldStyle(), type: "password", placeholder: "Пароль (мин. 8)" });
    var role = roleSelect("READER");
    var secs = sectionCheatboxes([], "new_");
    var box = h("div", { style: "padding:16px;border:1px solid #263145;border-radius:10px;background:#131a29;margin-bottom:18px" });
    box.appendChild(h("div", { style: "font-weight:600;margin-bottom:10px" }, ["Новый пользователь"]));
    box.appendChild(field("Почта", email));
    box.appendChild(field("Имя", name));
    box.appendChild(field("Пароль", pwd));
    box.appendChild(field("Роль", role));
    box.appendChild(field("Разделы", secs));
    box.appendChild(h("button", {
      style: btnStyle() + ";margin-top:12px",
      onclick: function () {
        CRM.adminCreateUser({
          email: email.value.trim(), displayName: name.value, password: pwd.value,
          role: role.value, sections: collectSections("new_")
        }).then(function () {
          email.value = name.value = pwd.value = "";
          renderUsers(usersContainer);
        }).catch(function (e) { alert(e.message); });
      }
    }, ["Создать"]));
    return box;
  }

  window.renderAccessSection = function () {
    var root = document.getElementById("sec-access");
    if (!root) return;
    if (rendered) return;
    root.innerHTML = "";
    root.appendChild(h("h2", { style: "margin:0 0 4px" }, ["Управление доступом"]));
    root.appendChild(h("p", { style: "color:#8a97ad;margin:0 0 20px;font-size:13px" },
      ["Роль задаёт уровень возможностей, набор разделов — что видит пользователь."]));
    var usersContainer = h("div", null, []);
    CRM.adminSections().then(function (secs) {
      allSections = secs;
      root.appendChild(createForm(usersContainer));
      root.appendChild(usersContainer);
      renderUsers(usersContainer);
      rendered = true;
    }).catch(function (e) { root.appendChild(h("div", null, ["Ошибка: " + e.message])); });
  };
})();
