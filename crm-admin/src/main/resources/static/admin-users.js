/* Раздел «Управление доступом» (только ADMIN). Рендерит UI в #sec-access.
   Модель — живые роли (Salesforce): права принадлежат РОЛИ (её матрице), все носители
   делят один набор, правка роли меняет всех. Пользователю назначается роль; персональной
   матрицы нет. Здесь два блока: «Пользователи» (список + форма с выбором роли) и «Роли»
   (список + создание/правка роли с матрицей прав и флагом «админ»). */
(function () {
  "use strict";

  /* Подписи ВСЕХ разделов из Sections.ALL: раздел без подписи показывался бы сырым id
     (так до V29 выглядели «А/Б тесты»). Отчёты и мониторинг с V29 — по секции на пункт
     меню, поэтому здесь их пункты, а не зонтичные reports/monitoring. */
  var SECTION_LABELS = {
    home: "Главная", deviations: "Панель отклонений", onelink: "OneLink Builder",
    admin: "Мастер коммуникаций", viewer: "Просмотр настроек",
    templates: "Список шаблонов",
    dashboard: "Общая статистика", promo: "Планирование промо",
    abtests: "А/Б тесты",
    journeys: "Цепочки", access: "Управление доступом",
    srcbuilder: "Конструктор source",
    heatmap: "Тепловая карта",
    entities: "Сущности",
    "ev-online": "Онлайн-событие", "ev-offline": "Событие по расписанию",
    "ev-list": "Список событий", "ev-export": "Перелив событий в прод",
    "rep-planfact": "Plan-Fact", "rep-matrix": "CRM Matrix",
    "rep-leadgen": "CRM Leadgen", "rep-smscheck": "ЧЕК СМС траффик",
    "rep-demo": "Пример визуализации отчёта",
    "mon-campaigns": "Базовая работа кампаний",
    uploads: "Загруженные инструменты",
    "set-dbconn": "Подключения к БД", "set-jira": "Jira", "set-procs": "Процессы переливов",
    "set-sync": "Синхронизация шаблонов",
    "set-events": "Импорт событий из crmdb", "set-scheme": "Scheme Builder",
    "set-objects": "Сущности (настройка)", "set-dbtree": "Схемы и таблицы",
    "set-apps": "Приложения и разделы", "set-uploads": "Загруженные инструменты (настройка)",
    "set-mon": "Мониторинг интеграций", "set-diag": "Диагностика хранилища",
    "set-general": "Общие параметры"
  };
  function tr(s) { return (typeof window.t === "function") ? window.t(s) : s; }
  /* Подписи сущностей (ent:client) в справочнике выше держать нельзя: сущности заводятся
     в Scheme Builder, и список у каждой установки свой. Их подпись приходит с сервера
     вместе со строкой матрицы — без неё в таблице стоял бы сырой ent:client. */
  var serverLabels = {};
  function sectionLabel(s) {
    if (SECTION_LABELS[s]) return tr(SECTION_LABELS[s]);
    return serverLabels[s] || s;
  }
  /* Контур, в котором сохранятся права. Матрица у прода, препрода и теста своя —
     базы разные, роли не общие, — а страницы выглядят одинаково. Поэтому среда стоит
     не только в шапке страницы, но и напротив каждого раздела: матрица длинная,
     и заголовок уезжает вверх задолго до того, как дойдёшь до нужной галки.
     Имя приходит из GET /api/env; настроечная страница кладёт его в window.SET_ENV
     и зовёт accessApplyEnv, когда ответ дошёл после отрисовки. */
  var ENV_LABEL = { prod: "ПРОД", preprod: "ПРЕПРОД", test: "ТЕСТ" };
  function envName() {
    var e = window.SET_ENV;
    return (e && e.name) ? String(e.name).toLowerCase() : "";
  }
  function envText() {
    var n = envName();
    return n ? (ENV_LABEL[n] || n.toUpperCase()) : "";
  }
  function envCell() {
    var s = h("span", { class: "acc-env" + (envName() ? " env-pill " + envName() : ""),
                        title: "Права сохранятся в базе этого контура. У прода, препрода и теста роли свои." },
              [envText()]);
    return s;
  }
  /* Ответ про среду мог прийти после отрисовки матрицы — дозаполняем ячейки. */
  window.accessApplyEnv = function () {
    var n = envName(), t = envText();
    document.querySelectorAll(".acc-env").forEach(function (el) {
      el.textContent = t;
      el.className = "acc-env" + (n ? " env-pill " + n : "");
    });
  };

  var CAPS = [
    { k: "read", t: "Просмотр" },
    { k: "add", t: "Добавление" },
    { k: "edit", t: "Редактирование" },
    { k: "delete", t: "Удаление" }
  ];

  var matrixSections = [];   // [{id, writable, adminOnly, group}] — не-adminOnly, для матрицы роли
  var allRoles = [];         // [{id, name, isAdmin, isSuperAdmin, isSystem, access, manageable, users}]
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
  function isSuperAdmin() { return !!(window.CRM && CRM.me && CRM.me.isSuperAdmin); }
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
  function sectionTitle(t) {
    return h("div", { style: "font-weight:700;font-size:15px;margin:22px 0 10px" }, [tr(t)]);
  }

  /* ---------- матрица роли (раздел × право) ---------- */
  function buildMatrix(access) {
    var byId = {};
    (access || []).forEach(function (a) { byId[a.section] = a; });
    var rows = {};
    var th = "text-align:center;padding:6px 8px;border-bottom:1px solid var(--line);color:var(--dim);font-size:12px;font-weight:600";
    var td = "text-align:center;padding:6px 8px;border-bottom:1px solid var(--line)";
    function toggleColumn(capKey) {
      // включаемые (не-disabled) чекбоксы столбца по всем разделам
      var cells = [];
      matrixSections.forEach(function (sec) {
        var r = rows[sec.id];
        if (!r) return;
        var cb = r[capKey];
        if (cb && !cb.disabled) cells.push(cb);
      });
      if (!cells.length) return;
      // если хоть один выключен — включаем все, иначе выключаем все
      var turnOn = cells.some(function (cb) { return !cb.checked; });
      cells.forEach(function (cb) {
        cb.checked = turnOn;
        // для «Просмотра» прогоняем существующую логику синхронизации записей
        if (capKey === "read") cb.dispatchEvent(new Event("change"));
      });
    }
    var head = h("tr", null, [h("th", { style: th.replace("center", "left") }, [tr("Раздел")]),
                              h("th", { style: th.replace("center", "left") }, [tr("Применится в")])]
      .concat(CAPS.map(function (c) {
        return h("th", {
          style: th + ";cursor:pointer",
          title: tr("Выбрать/снять весь столбец"),
          onclick: (function (capKey) { return function () { toggleColumn(capKey); }; })(c.k)
        }, [tr(c.t)]);
      })));
    var body = [head];

    /* Разделов стало больше двадцати (у каждого отчёта своя секция), поэтому строки
       разбиты заголовками групп сайдбара, а у заголовка — свой переключатель столбца:
       «выдать всю группу» частая операция, кликать пять отчётов подряд незачем.
       Переключатель читает rows лениво, в момент клика: к тому времени строки построены. */
    var groupMembers = {};
    matrixSections.forEach(function (sec) {
      var g = sec.group || "";
      if (!g) return;
      (groupMembers[g] = groupMembers[g] || []).push(sec);
    });
    function toggleGroup(group, capKey) {
      var cells = (groupMembers[group] || []).map(function (sec) {
        var r = rows[sec.id];
        return r && r[capKey];
      }).filter(function (cb) { return cb && !cb.disabled; });
      if (!cells.length) return;
      var turnOn = cells.some(function (cb) { return !cb.checked; });
      cells.forEach(function (cb) {
        cb.checked = turnOn;
        if (capKey === "read") cb.dispatchEvent(new Event("change"));
      });
    }
    var lastGroup = null;

    matrixSections.forEach(function (sec) {
      var group = sec.group || "";
      if (group !== lastGroup) {
        lastGroup = group;
        if (group) {
          var gh = "padding:7px 8px;border-bottom:1px solid var(--line);background:var(--card2);" +
                   "color:var(--dim);font-size:11.5px;font-weight:600";
          var gtitle = [tr(group)];
          /* Сущности — единственная группа, где строка выше («Сущности» без группы)
             перекрывает все строки внутри. Не сказать об этом — значит оставить
             человека гадать, почему снятая галка ничего не изменила. */
          if (group === "Сущности") {
            gtitle.push(h("span", { style: "color:var(--faint);font-weight:400" },
              [tr(" — поштучно; строка «Сущности» выше открывает сразу все")]));
          }
          var gcells = [h("td", { style: gh }, gtitle), h("td", { style: gh }, [])];
          CAPS.forEach(function (c) {
            gcells.push(h("td", {
              style: gh + ";text-align:center;cursor:pointer",
              title: tr("Выбрать/снять всю группу"),
              onclick: (function (g, capKey) {
                return function () { toggleGroup(g, capKey); };
              })(group, c.k)
            }, ["·"]));
          });
          body.push(h("tr", null, gcells));
        }
      }
      var cur = byId[sec.id] || {};
      var checks = {};
      CAPS.forEach(function (c) {
        var cb = h("input", { type: "checkbox" });
        cb.checked = !!cur[c.k];
        if (c.k !== "read" && !sec.writable) { cb.checked = false; cb.disabled = true; }
        checks[c.k] = cb;
      });
      if (sec.writable) {
        var vis = checks.read.checked;
        ["add", "edit", "delete"].forEach(function (k) { checks[k].disabled = !vis; });
      }
      checks.read.addEventListener("change", function () {
        if (!sec.writable) return;
        var on = checks.read.checked;
        ["add", "edit", "delete"].forEach(function (k) {
          checks[k].disabled = !on;
          if (!on) checks[k].checked = false;
        });
      });
      rows[sec.id] = checks;
      var cells = [h("td", {
        style: td.replace("center", "left") + ";color:var(--ink)" +
               (sec.group ? ";padding-left:22px" : "")   // вложенность в группу — отступом
      }, [sectionLabel(sec.id)]),
      h("td", { style: td.replace("center", "left") }, [envCell()])];
      CAPS.forEach(function (c) {
        var cell = h("td", { style: td });
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
          var r = rows[sec.id];
          return {
            section: sec.id, read: r.read.checked,
            add: sec.writable && r.add.checked,
            edit: sec.writable && r.edit.checked,
            delete: sec.writable && r.delete.checked
          };
        }).filter(function (a) { return a.read || a.add || a.edit || a.delete; });
      },
      setEnabled: function (on) {
        matrixSections.forEach(function (sec) {
          var r = rows[sec.id];
          r.read.disabled = !on;
          ["add", "edit", "delete"].forEach(function (k) {
            if (sec.writable) r[k].disabled = !on || !r.read.checked;
          });
        });
        wrap.style.opacity = on ? "1" : ".5";
      }
    };
  }

  /* ================= ПОЛЬЗОВАТЕЛИ ================= */
  /* Роли, которые текущий пользователь может назначить: без супер-роли; админ-роли —
     только супер-админ. */
  function assignableRoles(currentRoleId) {
    return allRoles.filter(function (r) {
      if (r.isSuperAdmin) return false;
      if (r.isAdmin && !isSuperAdmin()) return false;
      /* Отключённую роль назначать нельзя — сервер такой запрос и не примет. Но если она
         уже стоит у правимой учётки, оставляем её в списке: иначе выпадашка молча
         подменила бы роль соседней, и человек сохранил бы не то, что видел. */
      return r.active !== false || (currentRoleId != null && r.id === currentRoleId);
    });
  }
  function roleSelect(currentRoleId) {
    var sel = h("select", { style: fieldStyle() });
    var list = assignableRoles(currentRoleId);
    // роль редактируемой учётки может быть не в assignable (напр. её нельзя переназначить) —
    // но такие записи не редактируются (manageable=false), так что сюда не попадают.
    list.forEach(function (r) {
      var o = h("option", { value: String(r.id) },
        [r.name + (r.isAdmin ? " · админ" : "") + (r.active === false ? " · " + tr("отключена") : "")]);
      if (currentRoleId != null && r.id === currentRoleId) o.selected = true;
      sel.appendChild(o);
    });
    if (!list.length) sel.appendChild(h("option", { value: "" }, [tr("нет доступных ролей")]));
    return sel;
  }

  function renderUsers(container) {
    CRM.adminListUsers().then(function (users) {
      container.innerHTML = "";
      var table = h("table", { style: "width:100%;border-collapse:collapse;font-size:13px" });
      var head = h("tr", null, ["Почта", "Имя", "Роль", "Активен", ""].map(function (t) {
        return h("th", { style: "text-align:left;padding:8px;border-bottom:1px solid var(--line);color:var(--dim)" }, [t ? tr(t) : t]);
      }));
      table.appendChild(head);
      users.forEach(function (u) {
        var cell = "padding:8px;border-bottom:1px solid var(--line)";
        table.appendChild(h("tr", null, [
          h("td", { style: cell }, [u.email]),
          h("td", { style: cell }, [u.displayName || "—"]),
          h("td", { style: cell }, [u.role || "—"]),
          h("td", { style: cell }, [u.enabled ? "✓" : "—"]),
          h("td", { style: cell + ";white-space:nowrap" },
            u.manageable === false
              ? [h("span", { style: "color:var(--faint)" }, ["—"])]
              : [
                  h("button", { style: btnStyle("#334155"), onclick: function () { userForm(u, container); } }, [tr("Изменить")]),
                  h("span", null, [" "]),
                  h("button", { style: btnStyle("#7c2d12"), onclick: function () { resetPwd(u); } }, [tr("Пароль")]),
                  h("span", null, [" "]),
                  // Учётки не удаляем — только деактивируем/активируем (тумблер по u.enabled).
                  h("button", { style: btnStyle(u.enabled ? "#92400e" : "#15803d"), onclick: function () { toggleActive(u, container); } },
                    [tr(u.enabled ? "Деактивировать" : "Активировать")])
                ])
        ]));
      });
      container.appendChild(table);
    }).catch(function (e) { container.textContent = "Ошибка: " + e.message; });
  }

  function userForm(existing, container) {
    var box = h("div", { style: "margin:12px 0;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--card)" });
    var email = existing ? null : h("input", { style: fieldStyle(), type: "email", placeholder: "name@banki.ru" });
    var name = h("input", { style: fieldStyle(), value: existing ? (existing.displayName || "") : "", placeholder: tr("Имя") });
    var pwd = existing ? null : h("input", { style: fieldStyle(), type: "password", placeholder: tr("Пароль (мин. 8)") });
    var role = roleSelect(existing ? existing.roleId : null);
    var enabled = h("input", { type: "checkbox" }); if (existing) enabled.checked = existing.enabled;

    box.appendChild(h("div", { style: "font-weight:600;margin-bottom:8px" },
      [existing ? (tr("Изменение: ") + existing.email) : tr("Новый пользователь")]));
    if (email) box.appendChild(field(tr("Почта"), email));
    box.appendChild(field(tr("Имя"), name));
    if (pwd) box.appendChild(field(tr("Пароль"), pwd));
    box.appendChild(field(tr("Роль"), role));
    if (existing) box.appendChild(field(tr("Активен"), enabled));

    box.appendChild(h("button", {
      style: btnStyle() + ";margin-top:10px",
      onclick: function () {
        var roleId = role.value ? Number(role.value) : null;
        var p = existing
          ? CRM.adminUpdateUser(existing.id, { displayName: name.value, roleId: roleId, enabled: enabled.checked })
          : CRM.adminCreateUser({ email: email.value.trim(), displayName: name.value, password: pwd.value, roleId: roleId });
        p.then(function () { renderUsers(container); }).catch(function (e) { alert(e.message); });
      }
    }, [tr(existing ? "Сохранить" : "Создать")]));
    if (existing) box.appendChild(h("button", {
      style: btnStyle("#475569") + ";margin:10px 0 0 8px", onclick: function () { renderUsers(container); }
    }, [tr("Отмена")]));
    if (existing) container.insertBefore(box, container.firstChild);
    else container.parentElement.insertBefore(box, container);
  }

  function resetPwd(u) {
    var pwd = prompt("Новый пароль для " + u.email + " (минимум 8 символов):");
    if (!pwd) return;
    CRM.adminResetPassword(u.id, pwd).then(function () { alert("Пароль обновлён"); }).catch(function (e) { alert(e.message); });
  }
  /* Деактивация вместо удаления: учётку не стираем, а гасим (enabled=false) — вход
     закрывается, данные и история остаются, при надобности активируем обратно. */
  function toggleActive(u, container) {
    var on = !u.enabled;
    var verb = on ? tr("Активировать") : tr("Деактивировать");
    if (!confirm(verb + " " + u.email + "?")) return;
    CRM.adminUpdateUser(u.id, { enabled: on }).then(function () { renderUsers(container); }).catch(function (e) { alert(e.message); });
  }

  /* ================= РОЛИ ================= */
  function capLetters(a) {
    var s = "";
    if (a.read) s += "П"; if (a.add) s += "Д"; if (a.edit) s += "Р"; if (a.delete) s += "У";
    return s;
  }
  function roleSummary(r) {
    if (r.isSuperAdmin || r.isAdmin) return tr("доступ ко всему");
    var list = (r.access || []).filter(function (a) { return a.read || a.add || a.edit || a.delete; });
    if (!list.length) return "—";
    return list.map(function (a) { return sectionLabel(a.section) + " " + capLetters(a); }).join(" · ");
  }

  function renderRoles(container) {
    return CRM.adminRoles().then(function (roles) {
      allRoles = roles;
      container.innerHTML = "";
      container.appendChild(h("button", {
        style: btnStyle() + ";margin-bottom:12px", onclick: function () { roleForm(null, container); }
      }, ["+ " + tr("Создать роль")]));
      var table = h("table", { style: "width:100%;border-collapse:collapse;font-size:13px" });
      table.appendChild(h("tr", null, ["Роль", "Тип", "Права", "Учёток", ""].map(function (t) {
        return h("th", { style: "text-align:left;padding:8px;border-bottom:1px solid var(--line);color:var(--dim)" }, [tr(t)]);
      })));
      roles.forEach(function (r) {
        var cell = "padding:8px;border-bottom:1px solid var(--line)";
        var type = r.isSuperAdmin ? tr("супер-админ") : (r.isAdmin ? tr("админ") : tr("обычная"))
          + (r.isSystem ? " · " + tr("встроенная") : "");
        var off = r.active === false;
        /* Отключённая роль — вся строка приглушена: она остаётся в справочнике, но
           никого никуда не пускает, и путать её с рабочей нельзя. */
        var nameCell = [h("span", null, [r.name])];
        if (off) nameCell.push(h("span", {
          style: "margin-left:8px;font-size:11px;color:var(--coral,#ff6b8a);border:1px solid rgba(255,107,138,.4);" +
                 "border-radius:10px;padding:2px 7px;white-space:nowrap"
        }, [tr("отключена")]));
        table.appendChild(h("tr", { style: off ? "opacity:.55" : "" }, [
          h("td", { style: cell }, nameCell),
          h("td", { style: cell + ";color:var(--dim)" }, [type]),
          h("td", { style: cell + ";color:var(--dim);max-width:320px" }, [roleSummary(r)]),
          h("td", { style: cell }, [String(r.users)]),
          h("td", { style: cell + ";white-space:nowrap" },
            r.manageable === false
              ? [h("span", { style: "color:var(--faint)" }, ["—"])]
              : [
                  h("button", { style: btnStyle("#334155"), onclick: function () { roleForm(r, container); } }, [tr("Изменить")]),
                  h("span", null, [" "]),
                  /* Вместо «Удалить»: удаление отказывало на роли с носителями и на
                     встроенной, то есть почти всегда. Деактивация делает то, что от
                     удаления и хотели, — роль перестаёт использоваться, — и ничего не
                     теряет: матрица остаётся, историю можно поднять. */
                  h("button", {
                    style: btnStyle(off ? "#166534" : "#991b1b"),
                    title: off ? tr("Роль снова можно назначать, её носители смогут входить")
                               : tr("Роль останется в списке, но назначать её будет нельзя, а её носители не смогут войти")
                  , onclick: function () { toggleRole(r, container); } },
                    [off ? tr("Включить") : tr("Отключить")])
                ])
        ]));
      });
      container.appendChild(table);
    }).catch(function (e) { container.textContent = "Ошибка: " + e.message; });
  }

  function roleForm(existing, container) {
    var box = h("div", { style: "margin:12px 0;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--card)" });
    var name = h("input", { style: fieldStyle(), value: existing ? existing.name : "", placeholder: tr("Название роли") });
    if (existing && existing.isSystem) { name.disabled = true; name.title = tr("Встроенную роль переименовать нельзя"); }
    var isAdmin = h("input", { type: "checkbox" });
    if (existing) isAdmin.checked = existing.isAdmin;
    // Флаг «админ» может ставить только супер-админ.
    if (!isSuperAdmin()) { isAdmin.disabled = true; isAdmin.title = tr("Админ-роль задаёт только супер-администратор"); }
    var matrix = buildMatrix(existing ? existing.access : []);
    var note = h("div", { style: "font-size:12px;color:var(--faint);margin-top:6px" });

    function syncAdmin() {
      if (isAdmin.checked) {
        matrix.setEnabled(false);
        note.textContent = tr("Админ-роль: доступ куда угодно и для чего угодно — матрица не ограничивает.");
      } else { matrix.setEnabled(true); note.textContent = ""; }
    }
    isAdmin.addEventListener("change", syncAdmin);

    box.appendChild(h("div", { style: "font-weight:600;margin-bottom:8px" },
      [existing ? (tr("Изменение роли: ") + existing.name) : tr("Новая роль")]));
    box.appendChild(field(tr("Название"), name));
    box.appendChild(field(tr("Админ-полномочия (управление доступом, обход матрицы)"), isAdmin));
    box.appendChild(field(tr("Права по разделам"), matrix.el));
    box.appendChild(note);
    syncAdmin();

    box.appendChild(h("button", {
      style: btnStyle() + ";margin-top:10px",
      onclick: function () {
        var body = { name: name.value.trim(), isAdmin: isAdmin.checked, access: matrix.collect() };
        var p = existing ? CRM.adminUpdateRole(existing.id, body) : CRM.adminCreateRole(body);
        p.then(function () { renderRoles(container); }).catch(function (e) { alert(e.message); });
      }
    }, [tr(existing ? "Сохранить" : "Создать")]));
    box.appendChild(h("button", {
      style: btnStyle("#475569") + ";margin:10px 0 0 8px", onclick: function () { renderRoles(container); }
    }, [tr("Отмена")]));
    container.insertBefore(box, container.firstChild);
  }

  /* Отключение спрашиваем подтверждением и говорим, скольких оно коснётся: у роли с
     носителями это отказ во входе, и узнать об этом лучше до нажатия, а не от коллег.
     Включение обратно подтверждения не требует — оно возвращает штатное состояние. */
  function toggleRole(r, container) {
    var off = r.active === false;
    if (!off) {
      var who = r.users > 0
        ? tr("Учёток на этой роли") + ": " + r.users + ". " + tr("Войти в панель они не смогут.")
        : tr("Учёток на этой роли нет.");
      if (!confirm(tr("Отключить роль") + " «" + r.name + "»? " + who + " " +
                   tr("Роль и её права сохранятся, назначать её будет нельзя."))) return;
    }
    CRM.adminSetRoleActive(r.id, off).then(function () { renderRoles(container); })
      .catch(function (e) { alert(e.message); });
  }

  /* ---------- вход в раздел ---------- */
  window.accessInvalidate = function () { rendered = false; };

  window.renderAccessSection = function () {
    var root = document.getElementById("sec-access");
    if (!root) return;
    if (rendered) return;
    root.innerHTML = "";
    var usersC = h("div", null, []);
    var rolesC = h("div", null, []);
    // сначала роли (нужны для выпадашки в форме пользователя), затем пользователи
    Promise.all([CRM.adminSections(), CRM.adminRoles()]).then(function (res) {
      matrixSections = (res[0] || []).filter(function (s) { return !s.adminOnly; });
      matrixSections.forEach(function (s) { if (s.label) serverLabels[s.id] = s.label; });
      allRoles = res[1] || [];
      root.appendChild(sectionTitle("Пользователи"));
      root.appendChild(h("button", {
        style: btnStyle() + ";margin-bottom:12px", onclick: function () { userForm(null, usersC); }
      }, ["+ " + tr("Новый пользователь")]));
      root.appendChild(usersC);
      root.appendChild(sectionTitle("Роли"));
      root.appendChild(rolesC);
      renderUsers(usersC);
      renderRoles(rolesC);
      rendered = true;
    }).catch(function (e) { root.appendChild(h("div", null, ["Ошибка: " + e.message])); });
  };
})();
