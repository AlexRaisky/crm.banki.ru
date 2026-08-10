/* Тонкий слой доступа к бэкенду + связывание разделов v1 с REST.
   Загружается в <head>, до инлайновых скриптов v1. */
(function () {
  "use strict";

  var BASE = "";

  function req(method, url, body) {
    var opts = {
      method: method,
      headers: { "Accept": "application/json" },
      credentials: "same-origin"
    };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(BASE + url, opts).then(function (r) {
      if (r.status === 401) {
        // сессия истекла / не аутентифицирован
        if (!/login\.html$/.test(location.pathname)) {
          location.href = "login.html";
        }
        throw new Error("Не авторизован");
      }
      if (!r.ok) {
        return r.text().then(function (t) {
          var msg = t;
          try { msg = JSON.parse(t).message || t; } catch (e) {}
          throw new Error(msg || (r.status + " " + r.statusText));
        });
      }
      if (r.status === 204) return null;
      var ct = r.headers.get("content-type") || "";
      return ct.indexOf("application/json") >= 0 ? r.json() : r.text();
    });
  }

  // ---- маппинг элемента списка API -> форма ALL_TEMPLATES (v1) ----
  function apiItemToList(t) {
    var product = (t.productType && t.productType.length) ? t.productType[0] : "";
    return {
      id: t.channel + ":" + t.code,
      channel: t.channel,
      // Live Activity — разновидность пуша: в списке оба канала показываются как Push,
      // а различает их отдельная колонка. Настоящий канал в channel не трогаем — по нему
      // ищется шаблон при открытии карточки.
      is_la: t.channel === "la",
      code: t.code,
      name: t.communicationName || t.letterosId || (t.channel + " " + t.code),
      product: product,
      touch: t.touchPoint || "",
      trigger: t.triggerType || "",
      partner: t.partnerName || "",
      active: !!t.active,
      source: t.sourceType || "",
      letteros: t.letterosId || ""
    };
  }

  /* Query-строка из объекта фильтров. Массив = несколько значений одного параметра
     (channel=sms&channel=email) — бэк трактует их как OR внутри фильтра. */
  function buildQuery(filters) {
    var qs = [];
    if (filters) {
      Object.keys(filters).forEach(function (k) {
        var v = filters[k];
        if (Array.isArray(v)) {
          v.forEach(function (item) {
            if (item !== null && item !== undefined && item !== "") {
              qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(item));
            }
          });
        } else if (v) {
          qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
        }
      });
    }
    return qs.length ? "?" + qs.join("&") : "";
  }

  function bool(v) { return v == null ? null : !!v; }

  /* Обрезка краёв у всех текстовых полей шаблона.
     Пробел в начале заголовка пуша никто не набирает руками — он приезжает вместе со
     вставкой из Excel, письма или Confluence. И сохранялся молча: trim() в панели
     звали только чтобы решить, пустое ли поле, а в базу уходила исходная строка.
     Класс \s в JS покрывает и неразрывный пробел (U+00A0), и узкий (U+202F), и BOM
     (U+FEFF) — глазом они неотличимы от обычного, а поиск и сравнение строк ломают.
     Середину не трогаем нигде: двойной пробел внутри текста — забота автора, не наша.
     Пустая строка после обрезки становится null, как и было при `|| null`.
     Имя не t(): так зовётся параметр-DTO в соседних функциях, и тень сбивала бы с толку. */
  function trimEdges(v) {
    if (typeof v !== "string") return v;
    var s = v.replace(/^\s+|\s+$/g, "");
    return s === "" ? null : s;
  }

  // ---- маппинг «рыхлого» объекта формы v1 -> TemplateDto бэкенда ----
  function v1ToDto(d) {
    var products = [];
    if (d.product) products = (Array.isArray(d.product) ? d.product : [d.product])
      .map(trimEdges).filter(function (x) { return x != null; });
    return {
      channel: d.channel,
      code: trimEdges(d.code != null ? String(d.code) : null),
      productType: products,
      sourceType: trimEdges(d.source),
      communicationType: trimEdges(d.communication_type),
      triggerType: trimEdges(d.trigger),
      partnerName: trimEdges(d.partner),
      touchPoint: trimEdges(d.touch),
      affSub3: trimEdges(d.aff_sub3),
      sendingDay: trimEdges(d.day != null ? String(d.day) : null),
      source: trimEdges(d.source),
      communicationName: trimEdges(d.comname),
      name: trimEdges(d.comname),
      brief: trimEdges(d.comname),
      msgText: trimEdges(d.message),
      title: trimEdges(d.title),
      deepLink: trimEdges(d.deeplink),
      webviewUrl: trimEdges(d.webview),
      senderName: trimEdges(d.sender_name),
      emailFrom: trimEdges(d.email_from),
      subject: trimEdges(d.subject),
      letterosId: trimEdges(d.letteros_id != null ? String(d.letteros_id) : null),
      serviceFlag: bool(d.service_flag),
      infoFlag: bool(d.info_flag),
      sourceSystem: trimEdges(d.source_system),
      segmentDescr: trimEdges(d.segment_desc),
      hostId: d.host_id != null && d.host_id !== "" ? Number(d.host_id) : null,
      kvintCampaignId: trimEdges(d.kvint),
      businessCommunicationType: trimEdges(d.biz_type),
      active: d.active != null ? !!d.active : null,
      marketplace: bool(d.marketplace),
      dialog: bool(d.dialog),
      loyalty: bool(d.loyalty),
      nationalRating: bool(d.national_rating),
      news: bool(d.news),
      mobileApp: bool(d.mobile_app),
      nightSend: bool(d.night_send),
      // fa
      faId: trimEdges(d.fa_id),
      channelId: d.channel_id != null && d.channel_id !== "" ? Number(d.channel_id) : null,
      needPush: bool(d.need_push),
      c2dTransport: trimEdges(d.c2d_transport),
      c2dAccount: trimEdges(d.c2d_account),
      ch2dOperatorId: d.ch2d_operator_id != null && d.ch2d_operator_id !== "" ? Number(d.ch2d_operator_id) : null,
      webUrl: trimEdges(d.web_url),
      linkTitle: trimEdges(d.link_title),
      actionButtons: trimEdges(d.action_buttons),
      // vk
      vkTemplateName: trimEdges(d.vk_template_name),
      ttl: d.ttl != null && d.ttl !== "" ? Number(d.ttl) : null,
      abGroup: trimEdges(d.ab_group),
      buttons: trimEdges(d.buttons),
      // la
      activityName: trimEdges(d.activity_name),
      laEvent: trimEdges(d.la_event),
      laVisualization: trimEdges(d.la_visualization),
      laVisualizationAttributes: trimEdges(d.la_visualization_attributes),
      laStatus: trimEdges(d.la_status),
      currentStep: d.current_step != null && d.current_step !== "" ? Number(d.current_step) : null
    };
  }

  // ---- маппинг TemplateDto бэкенда -> объект формы v1 (для открытия/редактирования) ----
  function dtoToV1(t) {
    return {
      channel: t.channel,
      code: t.code,
      trigger: t.triggerType || "",
      product: (t.productType && t.productType.length) ? t.productType[0] : "",
      partner: t.partnerName || "",
      touch: t.touchPoint || "",
      aff_sub3: t.affSub3 || "",
      communication_type: t.communicationType || "",
      active: !!t.active,
      source: t.source || "",
      comname: t.communicationName || "NoComName",
      day: t.sendingDay || "",
      message: t.msgText || "",
      title: t.title || "",
      deeplink: t.deepLink || "",
      webview: t.webviewUrl || "",
      sender_name: t.senderName || "",
      email_from: t.emailFrom || "",
      subject: t.subject || "",
      letteros_id: t.letterosId || t.code,
      service_flag: !!t.serviceFlag,
      info_flag: !!t.infoFlag,
      source_system: t.sourceSystem || "",
      segment: t.channel === "cc" ? t.code : "",
      segment_desc: t.segmentDescr || "",
      host_id: t.hostId != null ? t.hostId : "",
      kvint: t.kvintCampaignId || "",
      biz_type: t.businessCommunicationType || "",
      marketplace: !!t.marketplace,
      dialog: !!t.dialog,
      loyalty: !!t.loyalty,
      national_rating: !!t.nationalRating,
      news: !!t.news,
      mobile_app: !!t.mobileApp,
      night_send: !!t.nightSend,
      // fa
      fa_id: t.faId || "",
      channel_id: t.channelId != null ? t.channelId : "",
      need_push: !!t.needPush,
      c2d_transport: t.c2dTransport || "",
      c2d_account: t.c2dAccount || "",
      ch2d_operator_id: t.ch2dOperatorId != null ? t.ch2dOperatorId : "",
      web_url: t.webUrl || "",
      link_title: t.linkTitle || "",
      action_buttons: t.actionButtons || "",
      // vk
      vk_template_name: t.vkTemplateName || "",
      ttl: t.ttl != null ? t.ttl : "",
      ab_group: t.abGroup || "",
      buttons: t.buttons || "",
      // la
      activity_name: t.activityName || "",
      la_event: t.laEvent || "",
      la_visualization: t.laVisualization || "",
      la_visualization_attributes: t.laVisualizationAttributes || "",
      la_status: t.laStatus || "",
      current_step: t.currentStep != null ? t.currentStep : ""
    };
  }

  var CRM = {
    meReady: null,
    me: null,
    envReady: null,
    envInfo: null,

    fetchMe: function () { return req("GET", "/api/me"); },
    fetchEnv: function () { return req("GET", "/api/env"); },

    listTemplates: function (filters) {
      return req("GET", "/api/templates" + buildQuery(filters));
    },
    countTemplates: function (filters) {
      return req("GET", "/api/templates/count" + buildQuery(filters));
    },
    facetsTemplates: function () { return req("GET", "/api/templates/facets"); },
    getTemplate: function (channel, code) { return req("GET", "/api/templates/" + channel + "/" + code); },
    createTemplate: function (dto) { return req("POST", "/api/templates/" + dto.channel, dto); },
    updateTemplate: function (channel, code, dto) { return req("PUT", "/api/templates/" + channel + "/" + code, dto); },
    deleteTemplate: function (channel, code) { return req("DELETE", "/api/templates/" + channel + "/" + code); },
    createChain: function (channel, base, days) { return req("POST", "/api/templates/" + channel + "/chain", { base: base, days: days }); },

    dictPartners: function () { return req("GET", "/api/dictionaries/partners"); },
    dictAddPartner: function (name) { return req("POST", "/api/dictionaries/partners", { name: name }); },
    dictCcSegments: function () { return req("GET", "/api/dictionaries/cc-segments"); },
    dictCommNames: function (channel) { return req("GET", "/api/dictionaries/comm-names?channel=" + encodeURIComponent(channel)); },
    dictTouchPoints: function () { return req("GET", "/api/dictionaries/touch-points"); },
    dictProductTypes: function () { return req("GET", "/api/dictionaries/product-types"); },

    // flow: материализация цепочек (предпросмотр инсертов слоя B и выполнение)
    flowPreview: function (journey) { return req("POST", "/api/flow/preview", journey); },
    flowMaterialize: function (journey, rows) { return req("POST", "/api/flow/materialize", { journey: journey, rows: rows }); },

    // journeys (цепочки-схемы)
    journeysList: function () { return req("GET", "/api/journeys"); },
    journeyGet: function (id) { return req("GET", "/api/journeys/" + encodeURIComponent(id)); },
    journeyCreate: function (j) { return req("POST", "/api/journeys", j); },
    journeyUpdate: function (id, j) { return req("PUT", "/api/journeys/" + encodeURIComponent(id), j); },
    journeyDelete: function (id) { return req("DELETE", "/api/journeys/" + encodeURIComponent(id)); },

    // admin
    adminSections: function () { return req("GET", "/api/admin/sections"); },
    adminListUsers: function () { return req("GET", "/api/admin/users"); },
    adminCreateUser: function (u) { return req("POST", "/api/admin/users", u); },
    adminUpdateUser: function (id, u) { return req("PUT", "/api/admin/users/" + id, u); },
    adminDeleteUser: function (id) { return req("DELETE", "/api/admin/users/" + id); },
    adminResetPassword: function (id, pwd) { return req("PUT", "/api/admin/users/" + id + "/password", { newPassword: pwd }); },

    changeOwnPassword: function (cur, next) { return req("PUT", "/api/me/password", { currentPassword: cur, newPassword: next }); },
    logout: function () { return req("POST", "/logout").then(function () { location.href = "login.html"; }); },

    apiItemToList: apiItemToList,
    v1ToDto: v1ToDto,
    dtoToV1: dtoToV1,

    /** Решает create/update по контексту открытого шаблона (window.CRM_CURRENT). */
    saveFromV1: function (d) {
      var dto = v1ToDto(d);
      var cur = window.CRM_CURRENT;
      var isUpdate = cur && cur.channel === dto.channel && dto.code && String(cur.code) === String(dto.code);
      if (isUpdate) {
        return CRM.updateTemplate(dto.channel, dto.code, dto).then(function () { return { code: dto.code }; });
      }
      return CRM.createTemplate(dto);
    }
  };

  window.CRM = CRM;

  /* Роль для показа в интерфейсе: SUPER_ADMIN наружу не светим — выглядит как ADMIN.
     Реальные права super-admin проверяются на сервере, а на клиенте — по флагу me.isSuperAdmin. */
  function displayRole(role) { return role === "SUPER_ADMIN" ? "ADMIN" : role; }
  CRM.displayRole = displayRole;

  /* Есть ли у текущего пользователя право cap ('read'|'add'|'edit'|'delete') хотя бы в
     одном из перечисленных разделов. Админ может всё; иначе смотрим карту me.caps
     (её отдаёт /api/me). Это зеркало серверного AccessGuard.requireCapability: фронт по
     нему прячет кнопки, но истина — сервер, он всё равно отбивает без права. */
  function can(cap) {
    var me = CRM.me;
    if (!me) return false;
    if (me.isAdmin) return true;
    var caps = me.caps || {};
    for (var i = 1; i < arguments.length; i++) {
      var c = caps[arguments[i]];
      if (c && c[cap]) return true;
    }
    return false;
  }
  CRM.can = can;

  // ---- bootstrap: кто я + среда инстанса + фильтрация NAV ----
  CRM.meReady = CRM.fetchMe().then(function (me) {
    CRM.me = me;
    window.CRM_ME = me;
    document.body && document.body.setAttribute("data-role", displayRole(me.role));
    return me;
  }).catch(function () { /* redirect уже произошёл в req() при 401 */ });

  CRM.envReady = CRM.fetchEnv().then(function (env) {
    CRM.envInfo = env;
    window.CRM_ENV = env;
    return env;
  }).catch(function () { return null; });

  /* Конфиг «приложение → разделы» (App Launcher): истина в БД (app.panel_settings),
     оболочка читает localStorage — синкаем при загрузке и перерисовываем сайдбар. */
  function syncAppSections() {
    return req("GET", "/api/panel-settings/appSections").then(function (res) {
      if (!res || res.value == null) return;
      var next = JSON.stringify(res.value);
      var prev = null;
      try { prev = localStorage.getItem("crmpanel:appSections"); } catch (e) {}
      if (prev === next) return;
      try { localStorage.setItem("crmpanel:appSections", next); } catch (e) {}
      if (typeof window.renderNav === "function") window.renderNav();
    }).catch(function () { /* нет доступа/сети — остаёмся на localStorage */ });
  }

  function applyNavAcl() {
    var me = CRM.me;
    if (!me) return;
    // Шестерёнка настроечной админки (/settings) — только админам
    var gear = document.getElementById("settingsLink");
    if (gear) gear.style.display = me.isAdmin ? "" : "none";
    document.body.setAttribute("data-role", displayRole(me.role));
    if (!me.canEdit) document.body.setAttribute("data-readonly", "1");
    var ue = document.getElementById("userEmail");
    if (ue) {
      ue.textContent = me.email;
      ue.title = (me.displayName ? me.displayName + " · " : "") + me.email + " (" + displayRole(me.role) + ")";
    }
    var envName = (CRM.envInfo && CRM.envInfo.name) || null;
    // Виден ли раздел по персональному ACL (nav id == section id).
    function sectionVisible(id) {
      return !(id && me.sections && me.sections.indexOf(id) < 0);
    }
    document.querySelectorAll(".nav-item").forEach(function (el) {
      var id = el.dataset.id;
      // Разделы, ограниченные средой (data-envs): показываем только на перечисленных средах.
      if (el.dataset.envs) {
        var allowed = envName && el.dataset.envs.split(",").indexOf(envName) >= 0;
        if (!allowed) { el.remove(); return; }
        el.style.display = "";
      }
      // Разделы только для админов (data-admin-only) — прочим убираем совсем.
      if (el.dataset.adminOnly && !me.isAdmin) { el.remove(); return; }
      // Группа сайдбара (data-group): её id — не раздел, ACL по sections не применяем.
      // Скрываем группу, если все её ACL-подразделы (data-children) скрыты;
      // группа с data-no-acl (есть клиентские дети без серверной секции) видима всегда.
      if (el.dataset.group) {
        if (el.dataset.noAcl) { el.style.display = ""; return; }
        var kids = (el.dataset.children || "").split(",").filter(Boolean);
        var anyVisible = kids.some(sectionVisible);
        el.style.display = anyVisible ? "" : "none";
        return;
      }
      // Клиентские инструменты без серверной секции (data-no-acl) — по sections не фильтруем.
      if (el.dataset.noAcl) return;
      // data-acl-section: пункт следует правам другого раздела (viewer → admin).
      if (!sectionVisible(el.dataset.aclSection || id)) el.style.display = "none";
    });
    // Карточки подразделов на обзорных страницах групп — скрываем синхронно с ACL.
    document.querySelectorAll("[data-nav-ref]").forEach(function (el) {
      if (el.dataset.noAcl) return; // видимостью управляет оболочка (напр. тепловая карта — по приложению)
      el.style.display = sectionVisible(el.dataset.aclSection || el.dataset.navRef) ? "" : "none";
    });
    // Открыть первый доступный раздел, если текущий активный скрыт/удалён.
    var active = document.querySelector("#nav .nav-item.active");
    if (!active || active.style.display === "none") {
      var firstVisible = document.querySelector('#nav .nav-item:not([style*="display: none"])');
      if (firstVisible && typeof window.openSection === "function") {
        window.openSection(firstVisible.dataset.id);
      }
    }
  }
  // Оболочка перерисовывает сайдбар (смена приложения/языка) — даём ей переприменить ACL.
  window.applyNavAcl = applyNavAcl;

  // NAV строится в инлайновом скрипте; применяем ACL, когда известны и права, и среда.
  document.addEventListener("DOMContentLoaded", function () {
    Promise.all([CRM.meReady, CRM.envReady]).then(function () {
      applyNavAcl();
      syncAppSections(); // конфиг приложений из БД (перерисует сайдбар при изменениях)
    });
  });
})();
