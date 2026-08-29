/* =========================================================
   ОБОЛОЧКА: приложения (App Launcher — вафля), сайдбар
   разделов, всплывающий сайдбар 2-го уровня (по наведению),
   обзорные страницы групп и виджеты главной. Контент разделов
   встроен нативно ниже по документу.

   Дерево разделов: элемент с children показывает по наведению
   flyout с подразделами, а по клику — обзорную страницу
   (overviewView). Дочерний элемент указывает view (id секции)
   и, для админки, adminMode (wizard|list|dashboard).
   id разделов НЕ менять: на них завязан RBAC (me.sections). */
const NAV = [
  /* noAcl: «Главная» — личная страница (задачи, недавнее, быстрые ссылки), как раздел
     не гейтится. shell.js её из ACL исключал (sectionAllowed/aclAllows), а applyNavAcl
     в api.js — нет: роль без секции home (например Маркетолог после V23) теряла пункт
     из сайдбара. Флаг выравнивает оба гейта. */
  { id:"home",  label:"Главная", icon:"home", view:"view-home", noAcl:true },
  { id:"comms", label:"Управление коммуникациями", icon:"megaphone", overviewView:"view-comms-overview", children:[
      { id:"onelink",   label:"OneLink Builder",     icon:"link", view:"sec-onelink" },
      { id:"admin",     label:"Мастер коммуникаций", icon:"pen",  view:"sec-admin", adminMode:"wizard" },
      /* «Список шаблонов» переехал в раздел «Сущности» как подраздел «Шаблоны и сегменты»
         (сущность template в схеме, source:"templates"). Пункт здесь не дублируем —
         id секции RBAC остался прежним (templates), права не менялись. */
      /* «Просмотр настроек» — тот же экран, что и мастер, но в режиме чтения. Секция
         у пункта теперь своя (viewer), а не заимствованная у admin: смотреть настройки
         коммуникаций часто нужно тем, кого в мастер не пускают. Миграция V38 выдала
         viewer всем, у кого был admin, — пункт ни у кого не пропал. */
      { id:"viewer",    label:"Просмотр настроек",   icon:"search", view:"sec-admin", adminMode:"view", aclSection:"viewer" },
      /* клиентские инструменты без серверной секции — не фильтруются по me.sections (data-no-acl) */
      { id:"srcbuilder",label:"Конструктор source",  icon:"pulse", view:"sec-srcbuilder" },
      /* promo: таблица давно переехала на сервер (app.promo_plan), noAcl снят в V29 —
         раздел гейтится матрицей, как все остальные. Чтобы снятие никого не выбросило,
         миграция выдала read всем ролям, у кого его не было. */
      { id:"promo",     label:"Планирование промо",  icon:"calendar", view:"sec-promo" },
      /* А/Б тесты: секция abtests в RBAC заведена (V26, права скопированы с promo),
         поэтому пункт гейтится по me.sections — noAcl тут НЕ ставим. */
      { id:"abtests",   label:"А/Б тесты",           icon:"beaker", view:"sec-abtests" },
      { id:"heatmap",   label:"Тепловая карта",      icon:"grid2", view:"view-heatmap", appOnly:["Маркетинг"] },
  ]},
  /* «События» — завод события формой, по образцу старой Appsmith-админки: онлайновое
     приходит извне, событие по расписанию порождает планировщик по кронтабу. Вторая
     дорога к тем же таблицам, что и «Цепочки», только без канвы. Права на каждую
     страницу свои: id пункта И ЕСТЬ секция RBAC. */
  { id:"events", label:"События", icon:"bolt", overviewView:"view-events-overview", children:[
      { id:"ev-online",  label:"Онлайн-событие",       icon:"pulse", view:"sec-event-online" },
      { id:"ev-offline", label:"Событие по расписанию", icon:"calendar", view:"sec-event-offline" },
      { id:"ev-list",    label:"Список событий",        icon:"list", view:"sec-event-list" },
      /* Планировщик стоит в «Событиях», хотя по устройству это интеграция: нужен он
         тому, кто заводит события по расписанию, а среди Jira и подключений к БД его
         просто не нашли. */
      { id:"ev-cron",    label:"Планировщик",          icon:"clock", view:"sec-event-cron" },
      /* «Перелив в прод» отсюда уехал в настройки (/settings → «Переливы»): секция
         ev-export осталась той же, поменялось только место. */
  ]},
  /* «Сущности» — данные CRM по схеме Scheme Builder. Подразделы НЕ задаются здесь:
     children заполняет js/entities.js (entSyncNav) по сущностям схемы, поэтому
     заведённая в Scheme Builder сущность появляется в панели сама.
     adminOnly:true — стартовое (безопасное) состояние: до ответа /api/me и загрузки
     схемы раздел считается админским. Дальше entSyncNav пересчитывает флаг: он
     снимается, только если пользователю доступна хотя бы одна сущность. По
     умолчанию не-админам не доступна ни одна — доступ выдаётся явно, в матрице
     прав: секция ent:<сущность> на одну сущность, entities — на все сразу. */
  /* id группы совпадает с секцией RBAC entities: гейт стоит не здесь, а в entAllowed
     (entities.js) — раздел показывается, когда доступна хотя бы одна сущность, а
     доступность теперь решает секция. Держать ещё и гейт на самой группе нельзя:
     он отобрал бы раздел у ролей, которым сущность выдали клиентским реестром. */
  { id:"entities", label:"Сущности", icon:"db", overviewView:"view-entities-overview",
    adminOnly:true, children:[] },
  /* «Отчёты» — встраивание отчётов Tableau: обзор с карточками, у каждого отчёта
     свой блок подключения (адрес сервера + книга); «Пример» — демо-макет окна */
  { id:"reports", label:"Отчёты", icon:"reports", overviewView:"view-reports-overview", children:[
      /* aclSection у детей больше нет: id пункта И ЕСТЬ секция RBAC (V29), поэтому доступ
         выдаётся по каждому отчёту отдельно. Сама группа секцией не является — она
         скрывается, когда скрыты все её дети (applyNavAcl). */
      { id:"rep-planfact", label:"Plan-Fact",   icon:"chart", view:"view-report-embed", report:"planfact" },
      { id:"rep-matrix",   label:"CRM Matrix",  icon:"grid2", view:"view-report-embed", report:"matrix" },
      { id:"rep-leadgen",  label:"CRM Leadgen", icon:"pulse", view:"view-report-embed", report:"leadgen" },
      { id:"rep-smscheck", label:"ЧЕК СМС траффик", icon:"download", view:"view-report-smscheck" },
      { id:"rep-demo",     label:"Пример визуализации отчёта", icon:"reports", view:"view-reports" },
  ]},
  { id:"dash", label:"Дашборд", icon:"gauge", overviewView:"view-dash-overview", children:[
      { id:"dashboard",  label:"Общая статистика",  icon:"chart", view:"sec-admin", adminMode:"dashboard" },
      { id:"deviations", label:"Панель отклонений", icon:"pulse", view:"sec-deviations" },
  ]},
  { id:"monitoring", label:"Мониторинг", icon:"monitor", overviewView:"view-mon-overview", children:[
      { id:"mon-campaigns", label:"Базовая работа кампаний", icon:"pulse", view:"view-mon-campaigns" },
  ]},
  { id:"uploads",  label:"Загруженные инструменты", icon:"upload", view:"view-uploads" },
  { id:"journeys", label:"Цепочки",             icon:"flow", view:"sec-journeys", adminOnly:true },
  /* «Управление доступом» переехало в настроечную админку (settings/ → pane access) */
];

/* Среды (prod / preprod / test) — это отдельные инстансы приложения со своими БД.
   Имя среды сообщает бэкенд (GET /api/env). Пункт NAV с полем envs:[...] виден только
   на перечисленных средах; фильтрация — в applyNavAcl (api.js).
   «Цепочки» доступны на всех средах, но только роли ADMIN (adminOnly + серверный гейт). */

const ICONS = {
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/></svg>',
  megaphone:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v3a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M14 8c1.5 1 1.5 6 0 7"/><path d="M17.5 5.5c3 2.5 3 9.5 0 12"/></svg>',
  gauge:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14 15 9"/><path d="M3.5 18a9 9 0 1 1 17 0"/><circle cx="12" cy="14" r="1.5"/></svg>',
  link:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  pen:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  list:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  chart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-6M21 20H3"/></svg>',
  download:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  pulse:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  flow:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="6" height="5" rx="1"/><rect x="16" y="4" width="6" height="5" rx="1"/><rect x="9" y="15" width="6" height="5" rx="1"/><path d="M5 9v3a2 2 0 0 0 2 2h2M19 9v3a2 2 0 0 1-2 2h-2"/></svg>',
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></svg>',
  doc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  calendar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  beaker:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6.5L5 18a2 2 0 0 0 1.7 3h10.6A2 2 0 0 0 19 18l-5-8.5V3"/><path d="M7.5 14h9"/></svg>',
  grid2:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  monitor:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  upload:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  chev:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
  reports:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 17v-4M12 17V8M16 17v-6"/></svg>',
  bolt:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 4 14 11 14 10 22 20 10 13 10 13 2"/></svg>',
  /* «Сущности»: db — группа раздела, table — подраздел отдельной сущности */
  db:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/><path d="M4 11.5v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></svg>',
  table:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M9 9.5V20"/></svg>',
};

/* =========================================================
   ОБЩИЕ ПАРАМЕТРЫ: тема (light/dark/system) и язык (ru/en).
   Хранятся в crmpanel:theme / crmpanel:lang, применяются сразу
   и при изменении в другой вкладке (событие storage).
   Переводится только ОБОЛОЧКА (сайдбар, вафля, обзорные,
   главная) — внутренности разделов не размечены.
   ========================================================= */
const I18N_EN = {
  "Просмотр":"View", "Открыть настройки шаблона":"Open template settings",
  "Пароль":"Password", "Смена пароля":"Change password", "Текущий пароль":"Current password",
  "Новый пароль":"New password", "Повторите новый пароль":"Repeat new password",
  "Отмена":"Cancel", "Пароль изменён":"Password changed",
  "Заполни текущий и новый пароль":"Fill in the current and new password",
  "Новый пароль — минимум 8 символов":"New password must be at least 8 characters",
  "Новые пароли не совпадают":"New passwords do not match",
  "Не удалось изменить пароль":"Could not change the password",
  "1. Канал":"1. Channel", "2. Шаблон":"2. Template",
  "Поиск по source_type":"Search by source_type", "Шаблон":"Template",
  "— Выберите шаблон":"— Select a template", "(неактивный)":"(inactive)",
  /* навигация и разделы */
  "Главная":"Home", "Управление коммуникациями":"Communications", "Дашборд":"Dashboard",
  "Цепочки":"Journeys", "Управление доступом":"Access management",
  "OneLink Builder":"OneLink Builder", "Мастер коммуникаций":"Communication wizard",
  "Список шаблонов":"Template list", "Общая статистика":"Overall statistics",
  "Панель отклонений":"Deviations panel",
  "Мониторинг":"Monitoring", "Загруженные инструменты":"Uploaded tools",
  "Просмотр настроек":"Settings viewer", "Тепловая карта":"Heat map",
  "Конструктор source":"Source builder",
  "Базовая работа кампаний":"Campaign basics", "Загрузить инструмент":"Upload tool",
  "Канал коммуникации":"Communication channel",
  /* приложения */
  "Приложения":"Apps", "Администрирование":"Administration", "Аналитика":"Analytics",
  "Маркетинг":"Marketing", "Бизнес":"Business", "Контактный центр":"Contact center",
  "Полный набор разделов панели":"Full set of panel sections",
  "Дашборды, статистика и отклонения":"Dashboards, statistics and deviations",
  "Коммуникации, шаблоны и кампании":"Communications, templates and campaigns",
  "Бизнес-инструменты и отчётность":"Business tools and reporting",
  "Управление настройками контактных центров":"Contact center settings management",
  /* оболочка */
  "Настроить главную":"Customize home", "Готово":"Done", "Свернуть меню":"Collapse menu",
  "Настройки (настроечная админка)":"Settings (admin settings)",
  "Выбрать приложение":"Choose an app", "Добавить блок":"Add a block", "Выйти":"Log out",
  /* личные «Общие параметры» (тема/язык) */
  "Вид":"View", "Тема и язык интерфейса — только для вашей учётки":"Theme and interface language — for your account only",
  "Общие параметры":"General settings", "Тема оформления":"Theme",
  "Системная":"System", "Тёмная":"Dark", "Светлая":"Light", "Язык интерфейса":"Interface language",
  "Название из импорта":"Name from import",
  /* виджеты главной */
  "Сводка по коммуникациям":"Communications summary", "Мои задачи":"My tasks",
  "Недавно использованные инструменты":"Recently used tools", "Быстрые ссылки":"Quick links",
  "Статусы систем":"System status",
  "Соберите главную под себя: добавляйте, удаляйте и перетаскивайте блоки в режиме настройки.":"Build your own home page: add, remove and drag blocks in customize mode.",
  "Выручка CPA, нед/нед":"CPA revenue, WoW", "Активных кампаний":"Active campaigns",
  "CTR e-mail, среднее":"Avg. e-mail CTR", "Просроченные задачи":"Overdue tasks",
  "Демо-данные. Подключите источник в следующей итерации.":"Demo data. Connect a source in the next iteration.",
  "Новая задача… (Enter)":"New task… (Enter)", "Задач пока нет — добавьте первую.":"No tasks yet — add the first one.",
  "Удалить":"Delete", "Убрать блок":"Remove block",
  "Откройте любой инструмент в меню слева — он появится здесь.":"Open any tool in the left menu — it will appear here.",
  "Рассылки e-mail":"E-mail campaigns", "Push-шлюз":"Push gateway", "Выгрузка CPA-фида":"CPA feed export",
  "Интеграция AppsFlyer":"AppsFlyer integration", "Задержка":"Delayed", "Демо-данные для MVP.":"Demo data for the MVP.",
  "сейчас":"now", " мин":" min", " ч":" h", " дн":" d",
  /* обзорные страницы */
  "Инструменты подготовки и настройки коммуникаций. Выберите блок или воспользуйтесь меню слева.":"Tools for preparing and configuring communications. Pick a block or use the left menu.",
  "Конструктор ретаргетинговых ссылок AppsFlyer: собирает название кампании, deep link и utm-метки автоматически.":"AppsFlyer retargeting link builder: assembles campaign name, deep link and utm tags automatically.",
  "Создание и редактирование шаблонов SMS, Push, Email и КЦ: параметры, аудитории, тексты и настройки отправки.":"Create and edit SMS, Push, Email and call center templates: parameters, audiences, texts and delivery settings.",
  "Реестр всех шаблонов коммуникаций с фильтрами по каналу, продукту, триггеру и статусу активности.":"Registry of all communication templates with filters by channel, product, trigger and status.",
  "Открыть →":"Open →",
  "Аналитика по коммуникациям и выручке. Выберите блок или наведите на раздел в меню слева.":"Communications and revenue analytics. Pick a block or hover the section in the left menu.",
  "Отправки по каналам, доставляемость, ошибки, перегрев аудиторий и статистика по шаблонам.":"Sends by channel, deliverability, errors, audience overheating and template statistics.",
  "Резкие выбросы и плавные снижения выручки по дням: скользящая медиана, гипотезы и комментарии.":"Sharp spikes and gradual revenue declines by day: rolling median, hypotheses and comments.",
  "Поиск шаблона по каналу, source_type и Letteros ID; аккуратная карточка всех настроек шаблона.":"Find a template by channel, source_type and Letteros ID; a tidy card with all template settings.",
  "Тепловая карта коммуникационной нагрузки по сегментам и каналам. Раздел в разработке.":"Heat map of communication load by segments and channels. Under development.",
  "Сборка source по правилам названия кампании: канал, тип, продукт и параметры — в реальном времени.":"Builds source using campaign naming rules: channel, type, product and parameters — in real time.",
  "Статистика →":"Statistics →", "Загрузить →":"Upload →",
  "Контроль работоспособности кампаний и интеграций. Выберите подраздел.":"Health control for campaigns and integrations. Pick a subsection.",
  "Отбор базы, поступление событий, отправки, доставки и дублирование коммуникаций.":"Base selection, event inflow, sends, deliveries and duplicated communications.",
  "Контрольные точки жизненного цикла кампании. При клике на блок будет открываться связанная статистика.":"Campaign lifecycle checkpoints. Clicking a block will open its related statistics.",
  "Работа отбора базы":"Base selection", "Наличие поступления событий":"Event inflow",
  "Наличие отправок коммуникаций":"Communication sends", "Наличие доставок":"Deliveries",
  "Дублирование отправок":"Duplicated sends",
  "Контроль формирования сегментов: объёмы отбора, время выполнения, сбои.":"Segment building control: selection volumes, execution time, failures.",
  "Поток триггерных событий от источников: объёмы, задержки, разрывы поступления.":"Trigger event flow from sources: volumes, delays, inflow gaps.",
  "Факт отправок по каналам за период: объёмы, паузы, аномальные провалы.":"Actual sends by channel over the period: volumes, pauses, anomalous drops.",
  "Подтверждения доставки от провайдеров: delivery rate, задержки статусов.":"Delivery confirmations from providers: delivery rate, status delays.",
  "Повторные коммуникации одному клиенту: дубли по шаблонам и каналам.":"Repeated communications to one client: duplicates by template and channel.",
  "← К блокам мониторинга":"← Back to monitoring blocks",
  "Мониторинг · Базовая работа кампаний":"Monitoring · Campaign basics",
  "Статистика в разработке":"Statistics under development",
  "Управление коммуникациями · доступно в приложении «Маркетинг»":"Communications · available in the Marketing app",
  "Раздел в разработке":"Section under development",
  "Здесь появится тепловая карта коммуникационной нагрузки: пересечения сегментов, каналов и частоты касаний.":"A heat map of communication load will appear here: segment overlaps, channels and touch frequency.",
  /* загруженные инструменты */
  "Свои HTML-страницы внутри панели.":"Your own HTML pages inside the panel.",
  "Выберите инструмент или загрузите новый.":"Pick a tool or upload a new one.",
  "Загрузите первый инструмент.":"Upload your first tool.",
  "Добавьте HTML-файл — он появится в этом разделе и в меню слева.":"Add an HTML file — it will appear in this section and in the left menu.",
  "Переименовать":"Rename", "Масштаб: по ширине":"Scale: fit width", "Масштаб: 1:1":"Scale: 1:1",
  "Название инструмента (необязательно — распознаем из файла автоматически)":"Tool name (optional — detected from the file automatically)",
  "Перетащите файл .html сюда":"Drop an .html file here",
  "или нажмите, чтобы выбрать файл":"or click to choose a file",
  /* конструктор source */
  "Итоговый source":"Resulting source",
  "ЧЕРНОВИК — заполните обязательные поля":"DRAFT — fill in the required fields",
  "ГОТОВО — можно копировать":"READY — you can copy",
  "⧉ Скопировать":"⧉ Copy", "✓ Скопировано":"✓ Copied",
  "Соберите source по правилам названия кампании. Части разделяются подчёркиванием:":"Assemble the source using campaign naming rules. Parts are joined with underscores:",
  "Куда подставляется:":"Where it is used:",
  "этот формат используется в поле source_type шаблонов коммуникаций и в параметре c ссылок OneLink.":"this format goes into the source_type field of communication templates and into the c parameter of OneLink links.",
  "Название кампании (source)":"Campaign name (source)",
  "Поля со звёздочкой * обязательны. Значение подставляется в source_type шаблона и в параметр c ссылки OneLink.":"Fields marked with * are required. The value goes into the template's source_type and into the c parameter of a OneLink link.",
  "Канал":"Channel", "Выберите канал":"Select a channel",
  "Тип кампании":"Campaign type", "Выберите тип":"Select a type",
  "promo или trigger — определяет структуру названия.":"promo or trigger — defines the name structure.",
  "Продукт":"Product", "Выберите продукт":"Select a product",
  "Партнёр / General / Digest":"Partner / General / Digest",
  "Уникальное название":"Unique name", "Дата рассылки":"Send date",
  "Подставится в формате ддммгг (напр. 180326).":"Inserted as ddmmyy (e.g. 180326).",
  "Номер сегмента":"Segment number", "Обязателен для канала callcenter.":"Required for the callcenter channel.",
  "День отправки":"Send day", "Подставится с припиской day (напр. 3day).":"Inserted with the day suffix (e.g. 3day).",
  "Для callcenter первая часть подставляется как contact.":"For callcenter the first part is inserted as contact.",
  /* список шаблонов (SF list view) и карточка настроек (SF Details) */
  "Шаблоны коммуникаций":"Communication templates", "Все шаблоны":"All templates",
  "Поиск в списке…":"Search this list…", "Сбросить фильтры":"Reset filters",
  "Название":"Name", "Партнёр":"Partner", "Статус":"Status",
  "элементов":"items", "Отсортировано по":"Sorted by", "всего":"total",
  "активных":"active", "неактивных":"inactive", "активный":"active", "неактивный":"inactive",
  "Открыть настройки":"Open settings",
  "Нет шаблонов по заданным фильтрам":"No templates match the filters",
  "← К списку шаблонов":"← Back to template list",
  "Основное":"General", "Источник и сегментация":"Source & segmentation",
  "Контент и ссылки":"Content & links", "Служебные параметры и флаги":"Service parameters & flags",
  "Сегмент":"Segment", "Описание сегмента":"Segment description",
  "Сохранить":"Save", "Отменить":"Cancel", "Редактировать":"Edit",
  "Добавить значение в справочник":"Add value to the dictionary",
  "Сначала впишите значение.":"Enter a value first.",
  "Не удалось добавить в справочник":"Could not add to the dictionary",
  "АКТИВНЫЙ":"ACTIVE", "НЕАКТИВНЫЙ":"INACTIVE", "да":"yes", "нет":"no",
  "Предпросмотр SMS":"SMS preview", "Предпросмотр Push":"Push preview", "Предпросмотр Email":"Email preview",
  "Тема":"Subject",
  "Вёрстка шаблона будет подтягиваться из Letteros":"Template markup will be pulled from Letteros",
  "Пример отображения. Точный вид зависит от устройства и версии ОС.":"Approximate rendering. The exact look depends on device and OS version.",
  /* мастер: заголовки блоков форм (тексты донора) и «Просмотр» */
  "1. Обязательные параметры (капитанские)":"1. Required parameters (captain's)",
  "1. Обязательные параметры":"1. Required parameters",
  "2. Флаги горизонталей и настроечные":"2. Horizontal & tuning flags",
  "3. Для КЦ":"3. For call center", "3. Цепочка":"3. Chain",
  "Выберите шаблон из списка или введите Code / Letteros ID":"Pick a template from the list or enter Code / Letteros ID",
  "Найти":"Find", "или":"or",
  "Режим просмотра":"View mode", "По конкретному шаблону":"By specific template",
  /* цепочки (Flow Builder) */
  "Название цепочки":"Journey name", "Новая":"New", "Предпросмотр":"Preview",
  "Старт":"Start", "Действия":"Actions", "Логика":"Logic", "Данные":"Data",
  "Настройки блока":"Block settings", "Применить":"Apply",
  "Предпросмотр: будет записано в таблицы процесса":"Preview: what will be written to process tables",
  "Добавить и соединить":"Add and connect",
  /* панель отклонений */
  "Динамика и коридор нормы":"Dynamics and normal range", "Помесячная сводка":"Monthly summary",
  "Дни с отклонениями":"Days with deviations", "Требуют точечной проверки":"Need a targeted check",
  "Плавные снижения":"Gradual declines", "Выгрузка":"Export",
  "↺ Загрузить / заменить":"↺ Load / replace", "＋ Дозагрузить дни":"＋ Append days",
  "↓ Сохранить в Excel":"↓ Save to Excel", "↓ Комментарии (CSV)":"↓ Comments (CSV)", "Очистить":"Clear",
  /* OneLink Builder */
  "Канал и тип рассылки":"Channel and campaign type", "Название кампании":"Campaign name",
  "Посадочная и deep link":"Landing and deep link", "Fallback-ссылки":"Fallback links",
  /* управление доступом (admin-users.js, через tr()) */
  "Почта":"Email", "Имя":"Name", "Роль":"Role", "Разделы":"Sections", "Активен":"Active",
  "Изменить":"Edit", "Пароль":"Password", "Изменение: ":"Editing: ",
  "Новый пользователь":"New user", "Пароль (мин. 8)":"Password (min 8)", "Создать":"Create",
  "Роль задаёт уровень возможностей, набор разделов — что видит пользователь.":"The role sets the capability level; the section set defines what the user sees.",
};
/* ---- планирование промо, настройка списка, заголовки разделов ---- */
Object.assign(I18N_EN, {
  "Планирование промо":"Promo planning",
  "Планирование промо-кампаний: календарь по дням, продуктам, партнёрам, каналам, задачам и ответственным.":"Promo campaign planning: calendar by day, product, partner, channel, issue and owner.",
  "Календарь промо-коммуникаций: даты вынесены в строки-разделители, «+» в конце такой строки добавляет запись на эту дату. Ячейки редактируются по клику, правка подтверждается ✓ (или кликом мимо ячейки).":"Promo communications calendar: dates are separator rows; the “+” at the end of such a row adds an entry for that date. Cells are editable on click and confirmed with ✓ (or by clicking outside the cell).",
  "Дата":"Date", "День недели":"Weekday", "База":"Audience", "Тотал":"Total",
  "Название коммуникации":"Communication name", "Ответственный":"Owner", "Комментарий":"Comment",
  "Партнёр":"Partner", "Задача":"Issue", "Все партнёры":"All partners",
  "Месяц":"Month", "Поиск":"Search", "Название, база, задача…":"Name, audience, issue…",
  "Добавить запись на эту дату":"Add an entry for this date",
  "Словесное описание базы":"Free-text audience description",
  "Сохранить":"Save", "Отмена":"Cancel", "Собрать из строки":"Build from row",
  "по формату source":"source format required",
  "Формат соответствует Конструктору source.":"Matches the source builder format.",
  "1-я часть — канал: sms, mobile-push, email или contact (для callcenter).":"Part 1 — channel: sms, mobile-push, email or contact (for callcenter).",
  "2-я часть — тип кампании: promo или trigger.":"Part 2 — campaign type: promo or trigger.",
  "3-я часть — код продукта из справочника, напр. creditcards.":"Part 3 — a product code from the catalogue, e.g. creditcards.",
  "Формат promo: канал_promo_продукт_партнёр_имя_ддммгг":"Promo format: channel_promo_product_partner_name_ddmmyy",
  "4-я часть — партнёр (или General / Digest).":"Part 4 — partner (or General / Digest).",
  "5-я часть — уникальное имя кампании.":"Part 5 — unique campaign name.",
  "Последняя часть — дата ддммгг (для callcenter — ддммггday).":"Last part — date ddmmyy (ddmmyyday for callcenter).",
  "Для contact дата заканчивается на day, напр. 180326day.":"For contact the date ends with day, e.g. 180326day.",
  "Формат trigger для contact: contact_trigger_продукт_имя_сегмент_Nday":"Trigger format for contact: contact_trigger_product_name_segment_Nday",
  "Формат trigger: канал_trigger_продукт_имя_Nday":"Trigger format: channel_trigger_product_name_Nday",
  "4-я часть — уникальное имя кампании.":"Part 4 — unique campaign name.",
  "5-я часть — сегмент.":"Part 5 — segment.",
  "Последняя часть — Nday, напр. 3day.":"Last part — Nday, e.g. 3day.",
  /* вкладки, форма новой записи и правила планирования */
  "Актуальные":"Upcoming", "Архивные":"Archived",
  "Запланировать промо-рассылку":"Schedule a promo send",
  "Все рассылки":"All sends", "Только тотал":"Totals only", "Без тотала":"Excluding totals",
  "Уникальное имя":"Unique name", "Латиница, цифры и дефис":"Latin letters, digits and hyphens",
  "Только латиница, цифры и дефис":"Latin letters, digits and hyphens only",
  "Несколько каналов — будет создано по записи на каждый":"Several channels — one record will be created per channel",
  "Создать":"Create", "Будет создано записей":"Records to be created",
  "нужно заполнить":"to fill in", "соберётся автоматически":"generated automatically",
  "Название собирается автоматически":"The name is generated automatically",
  "укажите дату":"set the date", "выберите хотя бы один канал":"select at least one channel",
  "уникальное имя: латиница, цифры и дефис":"unique name: Latin letters, digits and hyphens",
  "канал":"channel", "продукт":"product", "партнёр":"partner", "уникальное имя":"unique name", "дата":"date",
  "К планированию":"To plan", "Нужен статус по рассылке":"Send status required",
  "Требуют внимания":"Need attention", "нарушают правила планирования":"break the planning rules",
  "акций с признаком «Тотал»":"campaigns flagged as Total",
  "Лимит тоталов на неделю":"Weekly total limit", "есть рассылка по ставке ЦБ":"a key-rate send is present",
  "эта рассылка сверх лимита":"this send is over the limit",
  "По одному продукту допускается не больше 3 промо в день":"At most 3 promos per product per day",
  "Промо одного продукта должны идти в разных каналах":"Promos for the same product must use different channels",
  "В день допускается не больше 4 промо":"At most 4 promos per day",
  "В этот день в этом канале уже запланирован тотал":"A total is already scheduled for this day and channel",
  "Правила планирования:":"Planning rules:",
  "В неделю допускается один тотал (каналов у него может быть несколько). Если в уникальном имени есть -cb (рассылка по ставке ЦБ) — в неделе допускаются два тотала. Всё, что сверх лимита, помечается жёлтым треугольником.":"One total per week is allowed (it may use several channels). If the unique name contains -cb (a key-rate send), two totals are allowed that week. Anything over the limit is marked with a yellow triangle.",
  "По одному продукту — максимум 3 промо в день, с разными названиями и в разных каналах (e-mail, mobile-push, sms).":"At most 3 promos per product per day, with different names and in different channels (e-mail, mobile-push, sms).",
  "Не больше 4 промо в день; одна акция в нескольких каналах считается за одно промо.":"At most 4 promos per day; one campaign across several channels counts as a single promo.",
  "Если на день запланирован тотал, остальные промо в том же канале подсвечиваются.":"If a total is scheduled for the day, other promos in the same channel are highlighted.",
  "Одна запись — один канал: при сохранении нескольких каналов создаётся отдельная запись на каждый. Дату можно переназначить иконкой календаря — запись сама перейдёт в нужный блок дат. «Название коммуникации» собирается автоматически по формату Конструктора source из канала, продукта, партнёра, уникального имени и даты. Записи с прошедшей датой уходят на вкладку «Архивные». Правки сохраняются в браузере.":"One record per channel: saving several channels creates a separate record for each. The date can be reassigned with the calendar icon — the record moves to the right date block by itself. The communication name is generated automatically in the source builder format from channel, product, partner, unique name and date. Records with a past date move to the Archived tab. Edits are stored in the browser.",
  "Перенести на другую дату":"Move to another date",
  "Все месяцы":"All months", "Все продукты":"All products", "Все каналы":"All channels",
  "Все ответственные":"All owners", "+ Строка":"+ Row", "Экспорт CSV":"Export CSV",
  "Сбросить данные":"Reset data", "Сбросить таблицу к исходным данным?":"Reset the table to the original data?",
  "Удалить строку":"Delete row", "Удалить строку?":"Delete this row?",
  "Нет строк по заданным фильтрам":"No rows match the current filters",
  "Коммуникаций":"Communications", "по текущему фильтру":"for the current filter",
  "Тотал-рассылок":"Total sends", "признак «Тотал»":"the Total flag",
  "Запланировано":"Planned", "от строк":"of rows", "Каналы":"Channels",
  "Формулы:":"Formulas:",
  "Строки сгруппированы по датам, день недели вычисляется из даты, выходные подсвечиваются; строки с признаком «Тотал» выделяются; сводка сверху считает коммуникации, тоталы, каналы и заполненность статусов по текущему фильтру. «Название коммуникации» проверяется по правилам Конструктора source, «Задача» принимает ссылку или номер и показывается ссылкой на Jira. Правки сохраняются в браузере.":"Rows are grouped by date, the weekday is derived from the date and weekends are highlighted; rows flagged as Total are emphasised; the summary above counts communications, totals, channels and status coverage for the current filter. The communication name is validated against the source builder rules; the issue field accepts a link or a key and is shown as a Jira link. Edits are stored in the browser.",
  "Понедельник":"Monday", "Вторник":"Tuesday", "Среда":"Wednesday", "Четверг":"Thursday",
  "Пятница":"Friday", "Суббота":"Saturday", "Воскресенье":"Sunday",
  "Январь":"January", "Февраль":"February", "Март":"March", "Апрель":"April", "Май":"May", "Июнь":"June",
  "Июль":"July", "Август":"August", "Сентябрь":"September", "Октябрь":"October", "Ноябрь":"November", "Декабрь":"December",
  /* настройка списка и правка ячеек */
  "Отображаемые поля":"Displayed fields", "Показывать фильтры":"Visible filters",
  "По умолчанию":"Reset to default", "Закрыть":"Close", "Применить":"Apply",
  "Настройка полей и фильтров":"Fields and filters settings",
  /* мастер коммуникаций (карточка создания) и предпросмотр */
  "Новый шаблон":"New template", "Создать шаблон":"Create template", "Очистить":"Clear",
  "Заполните":"Fill in",
  /* цепочка в карточке мастера */
  "Цепочка":"Chain", "шаблон на каждый день цепочки":"a template for each chain day",
  "Дни цепочки (числа через запятую)":"Chain days (numbers, comma-separated)",
  "Сгенерировать строки":"Generate rows", "День":"Day",
  "Создать цепочку":"Create chain", "Цепочка создана":"Chain created", "шаблон(ов)":"template(s)",
  "На каждый день при создании заводится отдельный шаблон со своим source_type (по дню).":"On create, a separate template is made for each day with its own source_type (per day).",
  "Введите хотя бы один день (число), напр. 0, 3, 7":"Enter at least one day (a number), e.g. 0, 3, 7",
  "Дни не должны повторяться":"Days must not repeat",
  "Сгенерируйте строки: введите дни и нажмите «Сгенерировать строки».":"Generate the rows: enter the days and press “Generate rows”.",
  "для дня":"for day",
  "Шаблон создан":"Template created", "Ошибка сохранения":"Save error",
  "Сегмент (code)":"Segment (code)", "Поле в БД":"Database field",
  "таблица":"table", "отдельного поля нет":"no dedicated column",
  "Предпросмотр Mobile-push":"Mobile-push preview", "Предпросмотр E-mail":"E-mail preview",
  "Не помещается":"Does not fit", "заголовок":"title", "текст":"body",
  "часть будет скрыта под «ещё». Заголовок — 1 строка, текст — до 4 строк.":"part will be hidden behind “more”. Title — 1 line, body — up to 4 lines.",
  "Текст помещается в карточку уведомления полностью.":"The text fits the notification card in full.",
  /* шапки описания разделов */
  "Заведение нового шаблона: канал выбирается настроечным блоком, поля зависят от канала. communication_name и source_type собираются автоматически по правилам нейминга, справа — предпросмотр сообщения перед сохранением.":"Creating a new template: the channel is chosen in the settings block and the fields depend on it. communication_name and source_type are generated automatically by the naming rules; the message preview is on the right.",
  "Витрина всех шаблонов коммуникаций: поиск, сортировка, настройка отображаемых полей и фильтров через шестерёнку. Значения правятся прямо в таблице — карандаш у поля, подтверждение галочкой.":"A showcase of all communication templates: search, sorting and field/filter settings via the gear. Values are edited in place — a pencil next to the field, confirmed with a check mark.",
  "Карточка шаблона со всеми параметрами: канал и шаблон выбираются настроечными блоками, каждое поле правится по карандашу, справа — предпросмотр сообщения в канале.":"The template card with every parameter: channel and template are chosen in the settings blocks, each field is edited via its pencil, and the channel preview is on the right.",
  "Сводные показатели по отправкам, доставкам и реакциям в разрезе каналов, продуктов и шаблонов.":"Summary metrics for sends, deliveries and reactions by channel, product and template.",
  "Контроль основных этапов: отбор базы, поступление событий, отправки, доставки и дубли. Блок открывается кликом — внутри метрики и пороги.":"Control of the main stages: audience selection, incoming events, sends, deliveries and duplicates. Click a block to see its metrics and thresholds.",
  "Свои HTML-страницы внутри панели: оформление файла не меняется, страница масштабируется под размер окна.":"Your own HTML pages inside the panel: the file styling is preserved and the page scales to the window.",
  "Конструктор цепочек коммуникаций: шаги, условия и связи между шаблонами.":"Communication journey builder: steps, conditions and links between templates.",
  "Пользователи панели: роль задаёт уровень возможностей, набор разделов — что видит пользователь.":"Panel users: the role sets the capability level, the section set defines what the user sees.",
  "Не удалось сохранить изменение на сервере. Значение возвращено.":"Could not save the change on the server. The value was reverted.",
});

/* ---- раздел «Отчёты» (Tableau) ---- */
Object.assign(I18N_EN, {
  "Отчёты":"Reports",
  "Отчёт":"Report", "Период":"Period",
  "Воронка коммуникаций":"Communication funnel",
  "Доставляемость по каналам":"Deliverability by channel",
  "Эффективность промо":"Promo performance",
  "Последние 7 дней":"Last 7 days", "Последние 30 дней":"Last 30 days", "Квартал":"Quarter",
  "↻ Обновить":"↻ Refresh", "⤢ Во весь экран":"⤢ Fullscreen", "Во весь экран":"Fullscreen",
  "Свернуть":"Collapse", "</> Код встраивания":"</> Embed code", "МАКЕТ":"DEMO",
  "Как подключить реальный отчёт (Tableau Embedding API v3)":"How to connect a real report (Tableau Embedding API v3)",
  /* карточки отчётов и подключение */
  "Пример визуализации отчёта":"Report visualisation example",
  "Отчёты компании, встраиваемые из Tableau. Выберите отчёт или воспользуйтесь меню слева.":"Company reports embedded from Tableau. Pick a report or use the menu on the left.",
  "Общий финансовый отчёт компании: план и факт по ключевым показателям.":"The company-wide financial report: plan and actuals for the key metrics.",
  "Основной отчёт команды CRM: каналы, кампании и показатели в одном разрезе.":"The CRM team's main report: channels, campaigns and metrics in one view.",
  "Детализация лидогенерации: что именно покупают с каждой кампании.":"Lead-gen breakdown: what exactly is bought from each campaign.",
  "Демо-макет окна Tableau на плейсхолдер-данных: как отчёт выглядит внутри панели.":"A demo mock-up of the Tableau window on placeholder data: how a report looks inside the panel.",
  "Подключение к Tableau":"Tableau connection",
  "Адрес Tableau Server / Cloud":"Tableau Server / Cloud address",
  "Опубликованная книга/лист":"Published workbook/sheet",
  "Токен (JWT / PAT, опционально)":"Token (JWT / PAT, optional)",
  "Сохранить и подключить":"Save and connect", "Сохранено.":"Saved.",
  "Очистить настройки подключения этого отчёта?":"Clear this report's connection settings?",
  /* общий конфиг подключения: правит только админ, остальные видят готовый отчёт */
  "Загружаем настройки подключения…":"Loading connection settings…",
  "Не удалось получить настройки подключения":"Could not load the connection settings",
  "Обновите страницу; если не помогает — обратитесь к администратору панели.":"Reload the page; if that does not help, contact the panel administrator.",
  "токен сохранён — оставьте пустым, чтобы не менять":"token saved — leave empty to keep it",
  "Сохраняем…":"Saving…",
  "Сохранено для всех пользователей.":"Saved for all users.",
  "Менять подключение к Tableau может только администратор.":"Only an administrator can change the Tableau connection.",
  "Не удалось сохранить настройки подключения.":"Could not save the connection settings.",
  "Очистить настройки подключения этого отчёта? Отчёт перестанет открываться у всех пользователей.":"Clear this report's connection settings? The report will stop opening for every user.",
  "Подключение очищено.":"Connection cleared.",
  "Не удалось очистить настройки подключения.":"Could not clear the connection settings.",
  "Отчёт пока недоступен":"The report is not available yet",
  "Подключение к Tableau ещё не настроено, обратитесь к администратору.":"The Tableau connection has not been set up yet — please contact an administrator.",
  "Сервер должен быть доступен из браузера (VPN/интранет) и разрешать встраивание для домена панели. Настройки общие для всех пользователей панели.":"The server must be reachable from the browser (VPN/intranet) and allow embedding for the panel's domain. The settings are shared by all panel users.",
  "Отчёт появится здесь":"The report will appear here",
  "Укажите адрес вашего Tableau Server (или Tableau Cloud) и путь к опубликованной книге — например CRMMatrix/Overview — и нажмите «Сохранить и подключить».":"Enter your Tableau Server (or Tableau Cloud) address and the path to the published workbook — e.g. CRMMatrix/Overview — then press “Save and connect”.",
  "Сервер должен быть доступен из браузера (VPN/интранет) и разрешать встраивание для домена панели. Настройки хранятся в этом браузере.":"The server must be reachable from the browser (VPN/intranet) and allow embedding for the panel's domain. Settings are stored in this browser.",
  "Подключаемся к":"Connecting to",
  "Не удалось загрузить Tableau Embedding API с":"Failed to load the Tableau Embedding API from",
  "Проверьте адрес сервера, VPN/доступ из браузера и что встраивание разрешено.":"Check the server address, VPN/browser access, and that embedding is allowed.",
  "Нужен адрес вашего Tableau Server (или Tableau Cloud) и опубликованная книга.":"You need your Tableau Server (or Tableau Cloud) address and a published workbook.",
  "Авторизация — Connected Apps (JWT) или Personal Access Token; токен выдаёт бэкенд, чтобы не логиниться вручную.":"Auth is Connected Apps (JWT) or a Personal Access Token; the backend issues the token so no manual login is needed.",
  "Сервер Tableau должен быть доступен из браузера (VPN/интранет) и разрешать встраивание для домена панели.":"The Tableau server must be reachable from the browser (VPN/intranet) and allow embedding for the panel's domain.",
  "На GitHub Pages бэкенда нет — реальные данные появятся только с запущенным crm-admin.":"There is no backend on GitHub Pages — real data appears only with crm-admin running.",
  /* KPI и подписи виджетов макета */
  "Отправлено":"Sent", "Доставлено":"Delivered", "Открыто":"Opened", "Клик":"Click", "Конверсия":"Conversion",
  "Отписки":"Unsubscribes", "Промо-рассылок":"Promo sends", "Средний CTR":"Average CTR", "Выручка":"Revenue",
  "за 30 дней":"over 30 days", "за месяц":"this month", "доставлено":"delivered",
  "атрибуция 7 дней":"7-day attribution", "по конверсии":"by conversion",
  "Обзор":"Overview", "Этапы":"Stages", "Каналы":"Channels", "Детализация":"Breakdown",
  "Динамика":"Trend", "Топ-кампании":"Top campaigns",
  "Воронка этапов":"Stage funnel", "Доставляемость по дням":"Deliverability by day",
  "Показатели по этапам":"Metrics by stage", "Доставлено и открыто по каналам":"Delivered and opened by channel",
  "Доставляемость e-mail":"E-mail deliverability", "Сводка по каналам":"Channel summary",
  "Конверсия промо по дням":"Promo conversion by day", "CTR по каналам":"CTR by channel", "Лучшие промо":"Top promos",
  "доля от отправленных, %":"share of sent, %", "%, последние 14 дней":"%, last 14 days",
  "абсолют и доля":"absolute and share", "%, 14 дней":"%, 14 days",
  "Этап":"Stage", "Объём":"Volume", "Доля":"Share", "Канал":"Channel",
  "Кампания":"Campaign", "Конв.":"Conv.",
});

/* ---- раздел «Сущности» (данные по схеме Scheme Builder) ----
   Переводится только «обвязка» раздела: названия сущностей, полей и блоков
   приходят из схемы и показываются так, как их завели в Scheme Builder. */
Object.assign(I18N_EN, {
  "Сущности":"Objects",
  "Данные":"Data",
  "Данные CRM по схеме из Scheme Builder. Каждая заведённая сущность становится подразделом: выберите её здесь или в меню слева.":"CRM data based on the Scheme Builder schema. Every object defined there becomes a subsection: pick one here or in the left menu.",
  "Карточка записи по схеме Scheme Builder: поля разложены по смысловым блокам, каждое правится по карандашу. Правки сохраняются сразу.":"A record card built from the Scheme Builder schema: fields are grouped by meaning and each one is edited via its pencil. Changes are saved immediately.",
  "Карточка записи с полями по смысловым блокам и переходами по связям.":"A record card with fields grouped by meaning and links to related records.",
  "Раздел доступен только администраторам. Сущности и их поля настраиваются в Scheme Builder (настроечная админка).":"The section is available to administrators only. Objects and their fields are configured in Scheme Builder (settings admin).",
  "полей":"fields", "записей":"records", "связей":"relations", "доступ":"access",
  "Новая запись":"New record", "Запись создана":"Record created", "Запись удалена":"Record deleted",
  "Удалить запись":"Delete record", "Удалить запись?":"Delete this record?",
  "Записей пока нет — заведите первую.":"No records yet — create the first one.",
  "Сущность не найдена в схеме. Проверьте Scheme Builder в настроечной админке.":"The object was not found in the schema. Check Scheme Builder in the settings admin.",
  "В схеме пока нет сущностей. Заведите первую в Scheme Builder (настроечная админка).":"The schema has no objects yet. Create the first one in Scheme Builder (settings admin).",
  "связанных записей нет":"no related records", "нет обратной ссылки в схеме":"no back-reference in the schema",
  "запись не найдена":"record not found", "записей нет":"no records",
  "Обязательное поле":"Required field", "Сохранено":"Saved",
  "Обязательное при текущих значениях":"Required with the current values",
  "не заполнено":"not filled in", "Поле обязательно":"The field is required",
  "Как это работает:":"How it works:",
  "подраздел построен по сущности из Scheme Builder: блоки полей собраны по смыслу, связи показаны ссылками на записи других сущностей — по ним можно перейти. Правка поля подтверждается ✓ (Enter), отменяется ✕ или Esc; клик мимо поля сохраняет значение. Изменения хранятся в браузере.":"the subsection is built from a Scheme Builder object: field blocks are grouped by meaning and relations are shown as links to records of other objects, which you can follow. A field edit is confirmed with ✓ (Enter) and cancelled with ✕ or Esc; clicking outside the field saves the value. Changes are stored in the browser.",
  /* названия смысловых блоков карточки */
  "Основное":"General", "Конфигурация":"Configuration", "Служебные":"System fields",
  "Персональные данные":"Personal details", "Профиль клиента":"Client profile", "Связи":"Relations",
  "Документы":"Documents", "Адреса":"Addresses", "Согласия":"Consents",
  "Стоп-листы каналов":"Channel stop lists", "Доход и скоринг":"Income & scoring",
  "Самозапрет на кредиты":"Self-imposed credit ban", "Реквизиты":"Company details",
  "Доступность":"Reachability", "Флаги":"Flags", "Показатели":"Metrics",
  /* список записей и карточка со вкладками */
  "Шаблоны и сегменты":"Templates & segments",
  "Реестр всех шаблонов коммуникаций с фильтрами по каналу, продукту, триггеру и статусу активности. Раздел переехал в «Сущности».":"A registry of all communication templates with filters by channel, product, trigger and status. The section has moved to Objects.",
  "Список записей сущности: колонки и фильтры настраиваются шестерёнкой, запись открывается по клику.":"The object's record list: columns and filters are configured with the gear, and a record opens on click.",
  "Список записей и карточка: поля по смысловым блокам, переходы по связям.":"A record list and card: fields grouped by meaning, with links to related records.",
  "Поиск в списке…":"Search this list…", "Сбросить фильтры":"Reset filters",
  "Нет записей по заданным фильтрам":"No records match the filters",
  "Настройка полей и фильтров":"Fields and filters settings",
  "Отображаемые поля":"Displayed fields", "Показывать фильтры":"Visible filters",
  "Не больше 10 колонок и 10 фильтров одновременно. Настройка личная — хранится в вашем браузере.":"At most 10 columns and 10 filters at a time. The setting is personal — it is stored in your browser.",
  "Не больше 10 колонок в списке":"At most 10 columns in the list",
  "Не больше 10 фильтров в списке":"At most 10 filters in the list",
  "По умолчанию":"Reset to default", "Закрыть":"Close", "Все":"All", "любое":"any", "из":"of",
  "Отсортировано по":"Sorted by", "К списку":"Back to list", "данные из API":"data from the API",
  "Детали":"Details", "Коммуникации":"Communications",
  "Сохранить":"Save", "Отмена":"Cancel", "Удалить":"Delete",
  "Запись будет удалена без возможности отменить.":"The record will be deleted permanently.",
  "Заполните":"Fill in", "записей нет":"no records",
  "Блоки не назначены":"No blocks assigned",
  "На эту вкладку не выведен ни один блок полей. Настроить можно в админке: «Сущности» → «Настройки отображения карточки».":"No field block is assigned to this tab. Configure it in the admin: Objects → Card display settings.",
  "Здесь появятся отправленные по этой записи коммуникации: канал, шаблон, дата отправки и статус доставки. Раздел в разработке.":"Communications sent for this record will appear here: channel, template, send date and delivery status. Under development.",
  "подраздел построен по сущности из Scheme Builder. Список открывается первым: колонки и фильтры настраиваются шестерёнкой (не больше 10 тех и других), запись открывается по клику и возвращает назад кнопкой «К списку». В карточке поля разложены по смысловым блокам, связи показаны ссылками на записи других сущностей. Правка поля подтверждается ✓ (Enter), отменяется ✕ или Esc; клик мимо поля сохраняет значение. Изменения хранятся в браузере.":"the subsection is built from a Scheme Builder object. The list opens first: columns and filters are configured with the gear (at most 10 of each), a record opens on click and the “Back to list” button returns you. In the card, fields are grouped by meaning and relations are shown as links to records of other objects. A field edit is confirmed with ✓ (Enter) and cancelled with ✕ or Esc; clicking outside the field saves the value. Changes are stored in the browser.",
});

/* HTML-заголовки (с выделением) — токены */
const I18N_HTML = {
  ru: {
    h1_home:'Добро пожаловать в <span class="grad">панель управления</span>',
    h1_comms:'Управление <span class="grad">коммуникациями</span>',
    h1_dash:'Дашборд <span class="grad">CRM Team</span>',
    h1_mon:'Мониторинг <span class="grad">процессов CRM</span>',
    h1_moncamp:'Базовая работа <span class="grad">кампаний</span>',
    h1_heatmap:'Тепловая <span class="grad">карта</span>',
    h1_uploads:'Загруженные <span class="grad">инструменты</span>',
    h1_upform:'Загрузка <span class="grad">HTML-инструмента</span>',
    h1_srcbuilder:'Конструктор <span class="grad">source</span>',
    h1_promo:'Планирование <span class="grad">промо</span>',
    h1_abtests:'А/Б <span class="grad">тесты</span>',
    h1_reports:'Пример <span class="grad">визуализации отчёта</span>',
    h1_smscheck:'ЧЕК <span class="grad">СМС траффик</span>',
    h1_reports_ov:'Отчёты <span class="grad">Tableau</span>',
    h1_entities_ov:'Сущности <span class="grad">CRM</span>',
    reports_sub:'Демо-макет того, как отчёт Tableau будет выглядеть в этом окне. Реальные отчёты подключаются на страницах Plan-Fact, CRM&nbsp;Matrix и CRM&nbsp;Leadgen — там задаются адрес сервера и книга. Все числа на макете — демонстрационные.',
  },
  en: {
    h1_home:'Welcome to the <span class="grad">control panel</span>',
    h1_comms:'Communications <span class="grad">management</span>',
    h1_dash:'CRM Team <span class="grad">dashboard</span>',
    h1_mon:'CRM process <span class="grad">monitoring</span>',
    h1_moncamp:'Campaign <span class="grad">basics</span>',
    h1_heatmap:'Heat <span class="grad">map</span>',
    h1_uploads:'Uploaded <span class="grad">tools</span>',
    h1_upform:'Upload an <span class="grad">HTML tool</span>',
    h1_srcbuilder:'Source <span class="grad">builder</span>',
    h1_promo:'Promo <span class="grad">planning</span>',
    h1_abtests:'A/B <span class="grad">tests</span>',
    h1_reports:'Report visualisation <span class="grad">example</span>',
    h1_reports_ov:'Tableau <span class="grad">reports</span>',
    h1_entities_ov:'CRM <span class="grad">objects</span>',
    reports_sub:'A demo mock-up of how a Tableau report will look in this window. Real reports are connected on the Plan-Fact, CRM&nbsp;Matrix and CRM&nbsp;Leadgen pages, where the server address and workbook are set. All numbers in the mock-up are illustrative.',
  }
};
function t(s){ return (UI_LANG === "en" && I18N_EN[s]) ? I18N_EN[s] : s; }
function tt(token){ return (I18N_HTML[UI_LANG] && I18N_HTML[UI_LANG][token]) || I18N_HTML.ru[token] || ""; }
let UI_LANG = "ru";

/* Перевод статичных элементов: data-i18n (текст), data-i18n-html (токен), data-i18n-ph (placeholder) */
function translateStatic(){
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-html]").forEach(el => { el.innerHTML = tt(el.dataset.i18nHtml); });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
}

function applyTheme(){
  let pref = "dark";
  try { const v = localStorage.getItem("crmpanel:theme"); if (v) pref = JSON.parse(v); } catch(e){}
  const light = pref === "light" || (pref === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.classList.toggle("theme-light", light);
}
function applyLang(rerender){
  let lang = "ru";
  try { const v = localStorage.getItem("crmpanel:lang"); if (v) lang = JSON.parse(v); } catch(e){}
  UI_LANG = lang === "en" ? "en" : "ru";
  document.documentElement.lang = UI_LANG;
  if (rerender){
    translateStatic();
    renderLauncher(); renderNav(); renderGrid();
    editToggle.textContent = document.body.classList.contains("edit-mode") ? t("Готово") : t("Настроить главную");
    const ha = $("#homeActions"); if (ha) ha.style.display = cur.sid === "home" ? "flex" : "none";
    const cb = document.querySelector("#collapseBtn span"); if (cb) cb.textContent = t("Свернуть меню");
    const gear = document.getElementById("settingsLink"); if (gear) gear.title = t("Настройки (настроечная админка)");
    const wf = document.getElementById("waffleBtn"); if (wf) wf.title = t("Выбрать приложение");
    if (cur.sid === "uploads") renderUploads(cur.cid);
    if (typeof sbUpdate === "function") sbUpdate();
    if (typeof translateAdminChrome === "function") translateAdminChrome();
    if (typeof promoRender === "function") promoRender();
    if (typeof rpRender === "function") rpRender();
    if (typeof entRenderOverview === "function") entRenderOverview();
    if (typeof entRender === "function" && cur.sid === "entities" && cur.cid) entRender();
    renderSectionHero(CUR_VIEW, cur.sid, cur.cid);
    /* заголовок раздела в шапке — на выбранном языке */
    const s0 = NAV.find(n => n.id === cur.sid);
    if (s0) renderPageCrumb(s0, cur.cid, $("#pageTitle") ? $("#pageTitle").textContent : "");
  }
}
applyTheme();
applyLang(false);
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyTheme);
window.addEventListener("storage", e => {
  if (e.key === "crmpanel:theme") applyTheme();
  if (e.key === "crmpanel:lang") applyLang(true);
  if (e.key === "crmpanel:appSections") renderNav();
  /* очерёдность подразделов поменяли в настроечной админке */
  if (e.key === "crmpanel:subOrder"){
    if (typeof applySubOrder === "function") applySubOrder();
    if (typeof hideFlyout === "function") hideFlyout();
  }
});

const $ = s => document.querySelector(s);
const store = {
  get(k, d){ try{ const v = localStorage.getItem("crmpanel:"+k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem("crmpanel:"+k, JSON.stringify(v)); }catch(e){} }
};

/* =========================================================
   ПРИЛОЖЕНИЯ (App Launcher — как у Salesforce).
   Набор доступных разделов для каждого приложения задаётся
   в настроечной админке и хранится в crmpanel:appSections.
   Пока всем доступны все разделы (null = все).
   ========================================================= */
const APPS = [
  { id:"Администрирование", note:"Полный набор разделов панели" },
  { id:"Аналитика", note:"Дашборды, статистика и отклонения" },
  { id:"Маркетинг", note:"Коммуникации, шаблоны и кампании" },
  { id:"Бизнес",    note:"Бизнес-инструменты и отчётность" },
  { id:"Контактный центр", note:"Управление настройками контактных центров" },
];
let currentApp = store.get("app", "Администрирование");
if (!APPS.find(a => a.id === currentApp)) currentApp = "Администрирование";

function allowedSections(){
  const cfg = store.get("appSections", null);
  const ids = cfg && cfg[currentApp];
  return Array.isArray(ids) ? ids : null;   /* null = все разделы */
}
function appAllows(sid){
  if (sid === "home") return true;
  const a = allowedSections();
  return !a || a.includes(sid);
}

const launcher = $("#launcher");
function renderLauncher(){
  $("#appName").textContent = t(currentApp);
  const lt = document.querySelector("#launcher .l-title"); if (lt) lt.textContent = t("Приложения");
  const box = $("#launcherList"); box.innerHTML = "";
  APPS.forEach(a => {
    const el = document.createElement("div");
    el.className = "l-app" + (a.id === currentApp ? " current" : "");
    el.innerHTML = `<span class="l-ico">${a.id[0]}</span>
      <span class="l-body"><b>${t(a.id)}</b><span>${t(a.note)}</span></span>
      <span class="l-check">✓</span>`;
    el.onclick = () => setApp(a.id);
    box.appendChild(el);
  });
}
/* элементы, доступные только в отдельных приложениях (appOnly) */
/* Приложение может ограничивать не только разделы, но и отдельные подразделы:
   набор задаётся в настройках («Приложения и разделы») и лежит в crmpanel:appSections
   одним плоским списком id — родителя оболочка находит сама, по NAV.

   Особый случай — набор, в котором нет НИ ОДНОГО подраздела этой группы: так выглядят
   наборы, сохранённые до появления подразделов. Читать их как «все подразделы скрыты»
   нельзя — выкат молча опустошил бы меню тем, у кого набор настроен. Считаем такую
   группу разрешённой целиком; первое же сохранение из формы запишет подразделы явно. */
function appAllowsChild(k){
  const a = allowedSections();
  if (!a) return true;
  const parent = NAV.find(n => n.children && n.children.some(c => c.id === k.id));
  if (!parent) return true;
  const kids = parent.children.map(c => c.id);
  if (!kids.some(id => a.includes(id))) return true;
  return a.includes(k.id);
}
function childVisible(k){
  if (k.appOnly && !k.appOnly.includes(currentApp)) return false;
  return appAllowsChild(k);
}

/* ---------- очерёдность подразделов ----------
   Настраивается в настроечной админке («Приложения и разделы») и хранится
   в crmpanel:subOrder = { comms:[ids…], reports:[…], dash:[…] }.
   Применяется к меню 2-го уровня (flyout) и карточкам обзорных страниц. */
function subOrder(sid){
  const cfg = store.get("subOrder", null);
  return cfg && Array.isArray(cfg[sid]) ? cfg[sid] : null;
}
function orderedChildren(s){
  if (!s.children) return [];
  const ord = subOrder(s.id);
  if (!ord) return s.children;
  return s.children.slice().sort((a, b) => {
    let ia = ord.indexOf(a.id), ib = ord.indexOf(b.id);
    if (ia < 0) ia = 900 + s.children.indexOf(a);   /* не настроенные — в конец, в исходном порядке */
    if (ib < 0) ib = 900 + s.children.indexOf(b);
    return ia - ib;
  });
}
/* карточки обзорных страниц переставляются по data-nav-ref */
function applySubOrder(){
  NAV.forEach(s => {
    if (!s.children || !s.overviewView) return;
    const grid = document.querySelector("#" + s.overviewView + " .ov-grid");
    if (!grid) return;
    orderedChildren(s).forEach(c => {
      const card = grid.querySelector('[data-nav-ref="' + c.id + '"]');
      if (card) grid.appendChild(card);
    });
  });
}
/* элементы, видимые только в отдельных приложениях (карточка тепловой карты — «Маркетинг») */
function updateAppSpecific(){
  const hm = document.getElementById("ovHeatmapCard");
  if (hm) hm.style.display = currentApp === "Маркетинг" ? "" : "none";
}
function setApp(id){
  currentApp = id; store.set("app", id);
  renderLauncher(); renderNav(); updateAppSpecific();
  launcher.classList.remove("open");
  if (!appAllows(cur.sid)) return openSection("home");
  /* если открытый подраздел недоступен в новом приложении — на обзор раздела */
  const s = NAV.find(n => n.id === cur.sid);
  if (s && s.children && cur.cid){
    const child = s.children.find(c => c.id === cur.cid);
    if (child && !childVisible(child)) openSection(cur.sid);
  }
}
$("#waffleBtn").onclick = e => { e.stopPropagation(); launcher.classList.toggle("open"); };
document.addEventListener("click", e => { if (!launcher.contains(e.target)) launcher.classList.remove("open"); });

/* ---------- ACL оболочки: зеркало правил applyNavAcl (api.js) для
   динамически строящихся списков (flyout, «Быстрые ссылки») ---------- */
function aclAllows(item){
  if (item.envs){
    const name = window.CRM_ENV && window.CRM_ENV.name;
    if (!name || item.envs.indexOf(name) < 0) return false;
  }
  const me = window.CRM_ME;
  if (item.adminOnly && me && !me.isAdmin) return false;
  if (item.children) return item.children.some(aclAllows);
  if (item.noAcl) return true;   /* клиентский инструмент без серверной секции */
  const aclId = item.aclSection || item.id;   /* viewer следует правам admin */
  if (me && me.sections && aclId !== "home" && me.sections.indexOf(aclId) < 0) return false;
  return true;
}

/* ---------- сайдбар 1-го уровня ---------- */
const sidebar = $("#sidebar");
if (store.get("sidebarCollapsed", false)) sidebar.classList.add("collapsed");
$("#collapseBtn").onclick = () => {
  sidebar.classList.toggle("collapsed");
  store.set("sidebarCollapsed", sidebar.classList.contains("collapsed"));
};

const navEl = $("#nav");
function hasKids(item){ return !!item.children || item.id === "uploads"; }
function renderNav(){
  navEl.innerHTML = "";
  NAV.forEach(item => {
    if (!appAllows(item.id)) return;
    /* Группа, у которой приложение погасило все подразделы, сама превращается в пустой
       флайаут — прячем её целиком. Динамические группы («Сущности», «Загруженные
       инструменты») сюда не попадают: их children на момент отрисовки могут быть ещё
       пусты, и правило скрывало бы раздел до загрузки схемы. */
    if (item.children && item.children.length && !item.children.some(childVisible)) return;
    const el = document.createElement("div");
    el.className = "nav-item" + (item.id === cur.sid ? " active" : "");
    el.dataset.id = item.id; el.title = t(item.label);
    if (item.envs) {
      /* раздел, ограниченный средами: скрыт, пока /api/env не подтвердит нужную среду */
      el.dataset.envs = item.envs.join(",");
      const envName = window.CRM_ENV && window.CRM_ENV.name;
      if (!envName || item.envs.indexOf(envName) < 0) el.style.display = "none";
    }
    if (item.adminOnly) el.dataset.adminOnly = "1"; /* раздел только для роли ADMIN */
    if (item.noAcl) el.dataset.noAcl = "1";         /* клиентский инструмент: не фильтровать по me.sections */
    if (item.children) {
      /* группа: её id — не раздел; applyNavAcl скрывает её, когда скрыты все ACL-дети.
         В data-children — только дети, подчинённые серверному ACL (по их acl-id);
         если есть хоть один no-acl ребёнок — группа всегда видима (data-no-acl). */
      el.dataset.group = "1";
      el.dataset.children = item.children.filter(c => !c.noAcl).map(c => c.aclSection || c.id).join(",");
      if (item.children.some(c => c.noAcl)) el.dataset.noAcl = "1";
    }
    el.innerHTML = `<span class="nav-ico">${ICONS[item.icon]||""}</span><span class="nav-label">${t(item.label)}</span>`
      + (hasKids(item) ? `<span class="nav-more">${ICONS.chev}</span>` : "");
    el.onclick = () => { hideFlyout(); openSection(item.id); };
    el.onmouseenter = () => { clearTimeout(flyTimer); hasKids(item) ? showFlyout(el, item) : hideFlyout(); };
    el.onmouseleave = () => { flyTimer = setTimeout(hideFlyout, 200); };
    navEl.appendChild(el);
  });
  /* сайдбар перерисован с нуля — переприменяем RBAC-фильтрацию (api.js) */
  if (typeof window.applyNavAcl === "function") window.applyNavAcl();
}

/* ---------- всплывающий сайдбар 2-го уровня ---------- */
let flyTimer = null;
const flyout = $("#flyout");
flyout.onmouseenter = () => clearTimeout(flyTimer);
flyout.onmouseleave = () => { flyTimer = setTimeout(hideFlyout, 200); };

function showFlyout(itemEl, s){
  const kids = (s.id === "uploads" ? uploadChildren() : orderedChildren(s)).filter(childVisible).filter(aclAllows);
  if (!kids.length){ hideFlyout(); return; }
  $("#flyoutTitle").textContent = t(s.label);
  const list = $("#flyoutList"); list.innerHTML = "";
  kids.forEach(k => {
    const el = document.createElement("div");
    el.className = "sn-item nav-item" + (cur.sid === s.id && cur.cid === k.id ? " active" : "") + (k.action ? " sn-action" : "");
    el.dataset.id = k.id;   /* контракт applyNavAcl: кликабельный пункт = .nav-item с dataset.id */
    if (k.noAcl || s.id === "uploads") el.dataset.noAcl = "1";
    if (k.aclSection) el.dataset.aclSection = k.aclSection;
    el.title = t(k.label);
    el.innerHTML = `<span class="sn-ico">${ICONS[k.icon]||ICONS.doc}</span><span class="sn-label">${escapeShellHtml(t(k.label))}</span>`;
    el.onclick = e => { e.stopPropagation(); hideFlyout(); openSection(s.id, k.id); };
    list.appendChild(el);
  });
  flyout.classList.add("open");
  const r = itemEl.getBoundingClientRect();
  const sb = sidebar.getBoundingClientRect();
  flyout.style.left = (sb.right + 6) + "px";
  const top = Math.min(r.top, window.innerHeight - flyout.offsetHeight - 12);
  flyout.style.top = Math.max(62, top) + "px";
}
function hideFlyout(){ flyout.classList.remove("open"); }

/* Бейдж среды: имя и цвет приходят с бэкенда (GET /api/env); крепится в шапку после названия приложения */
if (window.CRM && CRM.envReady) {
  CRM.envReady.then(env => {
    if (!env || !env.name) return;
    const pill = document.createElement("span");
    pill.className = "env-pill " + env.name;
    pill.textContent = env.name.toUpperCase();
    pill.title = "Среда: " + env.name;
    const an = document.getElementById("appName");
    if (an) an.insertAdjacentElement("afterend", pill);
  });
}

/* ---------- переключение разделов ---------- */
let cur = { sid:"home", cid:null };

function sectionById(id){ return NAV.find(n => n.id === id); }

/* Доступен ли раздел на текущей среде: если у пункта задан envs:[...], он доступен только
   на этих средах (имя приходит из /api/env). До ответа env раздел со списком сред скрыт. */
function sectionAllowed(s){
  if (!s || !s.envs) return true;
  var name = window.CRM_ENV && window.CRM_ENV.name;
  return !!name && s.envs.indexOf(name) >= 0;
}

/* openSection(sid[, cid]): sid — пункт 1-го уровня, cid — подраздел группы.
   Группа без cid открывает обзорную страницу (overviewView).
   Хуки живого приложения сохранены: setAdminMode (wizard/list/dashboard в #sec-admin),
   renderAccessSection, initJourneysSection, лечение Chart.js в «Отклонениях». */
/* ---------- Смена собственного пароля (шапка → «Пароль») ---------- */
function openPwdDialog(){
  ["pwdCurrent","pwdNew","pwdRepeat"].forEach(function(id){ var e = $("#"+id); if (e) e.value = ""; });
  var msg = $("#pwdMsg"); if (msg) { msg.textContent = ""; msg.className = "pwd-msg"; }
  $("#pwdDialog").style.display = "";
  setTimeout(function(){ var f = $("#pwdCurrent"); if (f) f.focus(); }, 30);
}
function closePwdDialog(){ $("#pwdDialog").style.display = "none"; }
function submitPwdDialog(){
  var cur = $("#pwdCurrent").value, next = $("#pwdNew").value, rep = $("#pwdRepeat").value;
  var msg = $("#pwdMsg");
  msg.className = "pwd-msg";
  if (!cur || !next) { msg.textContent = t("Заполни текущий и новый пароль"); return; }
  if (next.length < 8) { msg.textContent = t("Новый пароль — минимум 8 символов"); return; }
  if (next !== rep) { msg.textContent = t("Новые пароли не совпадают"); return; }
  CRM.changeOwnPassword(cur, next).then(function(){
    msg.className = "pwd-msg ok";
    msg.textContent = t("Пароль изменён");
    setTimeout(closePwdDialog, 1200);
  }).catch(function(e){ msg.textContent = e.message || t("Не удалось изменить пароль"); });
}
document.addEventListener("keydown", function(e){
  if (e.key === "Escape" && $("#pwdDialog") && $("#pwdDialog").style.display !== "none") closePwdDialog();
});

/* «Общие параметры» — личные тема и язык (доступны каждой учётке, хранятся в браузере).
   Пишем в те же ключи crmpanel:theme / crmpanel:lang и применяем сразу — так же, как
   настроечная админка, только без прав администратора. */
function openPrefsDialog(){
  var theme = store.get("theme", "dark");
  var lang = store.get("lang", "ru");
  var r = document.querySelector('input[name="prefTheme"][value="' + theme + '"]') ||
          document.querySelector('input[name="prefTheme"][value="dark"]');
  if (r) r.checked = true;
  var ls = $("#prefLang"); if (ls) ls.value = (lang === "en" ? "en" : "ru");
  var d = $("#prefsDialog"); if (d) d.style.display = "";
}
function closePrefsDialog(){ var d = $("#prefsDialog"); if (d) d.style.display = "none"; }
function prefsThemeChange(v){ store.set("theme", v); applyTheme(); }
function prefsLangChange(v){ store.set("lang", v === "en" ? "en" : "ru"); applyLang(true); }
document.addEventListener("keydown", function(e){
  if (e.key === "Escape" && $("#prefsDialog") && $("#prefsDialog").style.display !== "none") closePrefsDialog();
});

function openSection(sid, cid){
  let s = sectionById(sid);
  if (!s){
    /* совместимость со старой плоской навигацией: openSection('admin') и т.п.
       (например, из journeys.js) — ищем id среди детей групп */
    const parent = NAV.find(n => n.children && n.children.some(c => c.id === sid));
    /* раздел исчез из NAV (например, access переехал в настройки) — уходим на главную */
    if (!parent) { if (sid !== "home") openSection("home"); return; }
    cid = sid; sid = parent.id; s = parent;
  }
  if (!appAllows(sid)) { if (sid !== "home") openSection("home"); return; }
  // Не открываем раздел, ограниченный средами (напр. «Цепочки» — только test), на чужой среде.
  if (!sectionAllowed(s)) { if (sid !== "home") openSection("home"); return; }

  let target = s;
  if (sid === "uploads"){
    /* «Загруженные инструменты»: null → обзор с карточками, up-new → форма загрузки, up-<id> → инструмент */
    const kids = uploadChildren();
    if (cid && !kids.find(k => k.id === cid)) cid = null;
    renderUploads(cid);
    const k = cid ? kids.find(x => x.id === cid) : null;
    target = { view:"view-uploads", label: (k && !k.action) ? k.label : s.label };
    if (!k || k.action) cid = cid === "up-new" ? "up-new" : null;
  } else if (s.children){
    let child = cid ? s.children.find(c => c.id === cid) : null;
    if (child && !(childVisible(child) && aclAllows(child))) child = null;
    target = child || { view: s.overviewView, label: s.label };
    cid = child ? cid : null;
  } else {
    cid = null;
  }
  cur = { sid, cid };

  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === target.view));
  document.querySelectorAll("#nav .nav-item").forEach(n => n.classList.toggle("active", n.dataset.id === sid));

  if (target.view === "view-mon-campaigns") monBack();   /* мониторинг всегда начинаем с блоков */
  if (target.adminMode && typeof setAdminMode === "function") setAdminMode(target.adminMode);
  /* отчёты Tableau: один view на все отчёты, содержимое задаёт reports.js */
  if (target.report && typeof rpEmbedOpen === "function") rpEmbedOpen(target.report);
  /* сущности: один view на все подразделы, карточку рисует entities.js */
  if (target.entity && typeof entOpen === "function") entOpen(target.entity);
  if (target.view === "view-entities-overview" && typeof entRenderOverview === "function") entRenderOverview();
  /* «ЧЕК СМС траффик» — выгрузка Excel (smscheck.js) */
  if (target.view === "view-report-smscheck" && typeof scInit === "function") scInit();
  if (sid === "journeys" && typeof initJourneysSection === "function") initJourneysSection();
  /* завод событий: справочники тянутся при первом открытии формы, не на старте панели */
  if (target.view === "sec-event-online" && typeof initEventOnlineSection === "function") initEventOnlineSection();
  /* цепочка читается из чужой базы (crmdb) — тянем при первом показе раздела */
  if (target.view === "sec-event-online" && window.EventChain) window.EventChain.open();
  if (target.view === "sec-event-offline" && typeof initEventOfflineSection === "function") initEventOfflineSection();
  if (target.view === "sec-event-list" && typeof initEventListSection === "function") initEventListSection();
  /* Настройки планировщика читаем при каждом открытии: их правят и на другом контуре,
     и прямо в базе, а показывать вчерашний адрес хуже, чем лишний раз спросить. */
  if (target.view === "sec-event-cron" && typeof initEventCronSection === "function") initEventCronSection();
  if (target.view === "sec-deviations") setTimeout(() => {
    /* графики Chart.js, созданные в скрытой секции, имеют нулевой размер —
       при первом показе пересоздаём их через renderAll(). setTimeout, а не rAF:
       rAF может не срабатывать в фоновых/нерендерящихся вкладках */
    try {
      if (typeof CHART !== "undefined" && CHART && typeof renderAll === "function"){
        const broken = Object.values(CHART).some(c => c && (!c.width || !c.height));
        if (broken) renderAll();
      }
    } catch(e){}
  }, 30);

  if (sid !== "home" && cid !== "up-new") trackRecent({ sid, cid, label: target.label });
  CUR_VIEW = target.view;
  renderSectionHero(target.view, sid, cid);
  renderPageCrumb(s, cid, target.label);
  document.title = "CRM Team · " + t(target.label || s.label);
  const ha = $("#homeActions"); if (ha) ha.style.display = sid === "home" ? "flex" : "none";
  store.set("lastSection", { sid, cid });
}

/* ---------- Шапка описания раздела (как на странице OneLink Builder) ----------
   Разделы со своим героем (OneLink, Конструктор source, Отклонения, Промо)
   пропускаются — у них заголовок уже есть в разметке. */
let CUR_VIEW = "";
const SEC_HERO = {
  "comms:admin": { eyebrow:"CRM · Templates · Wizard", title:"Мастер коммуникаций",
    sub:"Заведение нового шаблона: канал выбирается настроечным блоком, поля зависят от канала. communication_name и source_type собираются автоматически по правилам нейминга, справа — предпросмотр сообщения перед сохранением." },
  /* список шаблонов открывается из раздела «Сущности» (подраздел «Шаблоны и сегменты») */
  "entities:ent-template": { eyebrow:"CRM · Templates · List view", title:"Шаблоны и сегменты",
    sub:"Витрина всех шаблонов коммуникаций: поиск, сортировка, настройка отображаемых полей и фильтров через шестерёнку. Значения правятся прямо в таблице — карандаш у поля, подтверждение галочкой." },
  "comms:viewer": { eyebrow:"CRM · Templates · Details", title:"Просмотр настроек",
    sub:"Карточка шаблона со всеми параметрами: канал и шаблон выбираются настроечными блоками, каждое поле правится по карандашу, справа — предпросмотр сообщения в канале." },
  "dash:dashboard": { eyebrow:"CRM · Analytics · Overview", title:"Общая статистика",
    sub:"Сводные показатели по отправкам, доставкам и реакциям в разрезе каналов, продуктов и шаблонов." },
  "monitoring:mon-campaigns": { eyebrow:"CRM · Monitoring · Campaigns", title:"Базовая работа кампаний",
    sub:"Контроль основных этапов: отбор базы, поступление событий, отправки, доставки и дубли. Блок открывается кликом — внутри метрики и пороги." },
  "uploads:": { eyebrow:"CRM · Tools · Uploads", title:"Загруженные инструменты",
    sub:"Свои HTML-страницы внутри панели: оформление файла не меняется, страница масштабируется под размер окна." },
  "journeys:": { eyebrow:"CRM · Journeys · Builder", title:"Цепочки",
    sub:"Конструктор цепочек коммуникаций: шаги, условия и связи между шаблонами." }
  /* «Управление доступом» рисует свой заголовок и описание (admin-users.js) */
};
function renderSectionHero(viewId, sid, cid){
  const view = document.getElementById(viewId);
  if (!view) return;
  const meta = SEC_HERO[sid + ":" + (cid || "")];
  const old = view.querySelector(":scope > .sec-hero");
  if (!meta){ if (old) old.remove(); return; }
  /* если у раздела уже есть собственный заголовок — второй не добавляем */
  if (view.querySelector("h1:not(.sec-hero h1)")){
    if (old) old.remove();
    return;
  }
  const html = `<div class="eyebrow">${escapeShellHtml(meta.eyebrow)}</div>
    <h1>${escapeShellHtml(t(meta.title))}</h1>
    <p class="sub">${escapeShellHtml(t(meta.sub))}</p>`;
  if (old){ old.innerHTML = html; return; }
  const box = document.createElement("header");
  box.className = "sec-hero";
  box.innerHTML = html;
  view.insertBefore(box, view.firstChild);
}

/* Название текущего раздела в шапке: «родитель › раздел».
   Для загруженных инструментов заголовок — имя файла, не переводится. */
function renderPageCrumb(s, cid, label){
  const crumb = $("#pageCrumb");
  if (!crumb || !s) return;
  const child = (cid && s.children) ? s.children.find(c => c.id === cid) : null;
  const isTool = s.id === "uploads" && cid && cid !== "up-new";
  crumb.classList.toggle("no-parent", !child && !isTool);
  $("#pageParent").textContent = (child || isTool) ? t(s.label) : "";
  $("#pageTitle").textContent = isTool ? (label || t(s.label)) : t(child ? child.label : s.label);
}

/* Режим раздела админки: wizard (мастер) / list (шаблоны) / dashboard / view (просмотр настроек).
   Все режимы — одна секция #sec-admin: канальные вкладки заменены настроечным
   блоком канала (#wizardChannelBar), сами вкладки скрыты, openTab сохранён. */
function setAdminMode(mode){
  const tabsBar = document.getElementById("tabsBar");
  if (!tabsBar) return;
  tabsBar.style.display = "none";   /* вкладки заменены сайдбаром и настроечным блоком канала */
  const chBar = document.getElementById("wizardChannelBar");
  if (mode === "list" || mode === "dashboard" || mode === "view"){
    if (chBar) chBar.style.display = "none";
    document.querySelectorAll("#sec-admin .form").forEach(f => f.classList.remove("active"));
    const target = document.getElementById(mode);
    if (target) target.classList.add("active");
  } else {
    /* мастер: канал выбирается в настроечном блоке (как у Salesforce) */
    if (chBar) chBar.style.display = "";
    const seg = document.querySelector("#wizardChannelSeg button.active");
    wizardSetChannel(seg ? seg.dataset.ch : "sms");
  }
}

/* ---------- мастер: выбор канала настроечным блоком ---------- */
function wizardSetChannel(ch){
  document.querySelectorAll("#wizardChannelSeg button").forEach(function(b){
    b.classList.toggle("active", b.dataset.ch === ch);
  });
  document.querySelectorAll("#sec-admin .form").forEach(function(f){ f.classList.remove("active"); });
  /* мастер показывает карточку нового шаблона (то же оформление, что «Просмотр настроек»);
     цепочки заводятся в самой карточке — секция «Цепочка» */
  const card = document.getElementById("wizard");
  if (card) card.classList.add("active");
  /* как при переходе на канальную вкладку (openTab): новый шаблон → сбрасываем контекст
     редактирования, чтобы сохранение пошло как INSERT, а не UPDATE открытого шаблона */
  window.CRM_CURRENT = null;
  if (typeof wizardCardOpen === "function") wizardCardOpen(ch);
}

/* ---------- мониторинг: заглушки статистики блоков ---------- */
function monDetail(title){
  const home = document.getElementById("monCampaignsHome");
  const det = document.getElementById("monCampaignsDetail");
  home.style.display = "none";
  det.classList.add("open");
  const stubText = UI_LANG === "en"
    ? `Charts and control metrics for the "${escapeShellHtml(t(title))}" block will appear here: dynamics, thresholds and alerts.`
    : `Здесь появятся графики и контрольные метрики блока «${escapeShellHtml(title)}»: динамика, пороги и алерты.`;
  det.innerHTML = `<button class="mon-back" onclick="monBack()">${t("← К блокам мониторинга")}</button>
    <div class="ov-head"><h1>${escapeShellHtml(t(title))}</h1></div>
    <div class="ov-sub">${t("Мониторинг · Базовая работа кампаний")}</div>
    <div class="mon-stub"><b>${t("Статистика в разработке")}</b>
      ${stubText}</div>`;
}
function monBack(){
  const home = document.getElementById("monCampaignsHome");
  const det = document.getElementById("monCampaignsDetail");
  if (home) home.style.display = "";
  if (det){ det.classList.remove("open"); det.innerHTML = ""; }
}

/* =========================================================
   ЗАГРУЖЕННЫЕ ИНСТРУМЕНТЫ
   HTML-файлы хранятся в localStorage (crmpanel:uploadedTools)
   и открываются в исходном оформлении (без адаптации).
   ========================================================= */
function getTools(){ return store.get("uploadedTools", []); }
function saveTools(list){
  try { localStorage.setItem("crmpanel:uploadedTools", JSON.stringify(list)); return true; }
  catch(e){ alert("Не удалось сохранить инструмент: файл слишком большой для хранилища браузера (~5 МБ на все инструменты). Удалите неиспользуемые инструменты и попробуйте снова."); return false; }
}
function uploadChildren(){
  /* noAcl: детей раздела «Загруженные инструменты» не фильтруем по me.sections */
  const kids = [{ id:"up-new", label:"Загрузить инструмент", icon:"plus", action:true, noAcl:true }];
  getTools().forEach(t => kids.push({ id:"up-"+t.id, label:t.name, icon:"doc", noAcl:true }));
  return kids;
}

function detectToolName(html, filename){
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const title = doc.querySelector("title");
    if (title && title.textContent.trim()) return title.textContent.trim();
    const h1 = doc.querySelector("h1");
    if (h1 && h1.textContent.trim()) return h1.textContent.trim().slice(0, 80);
  } catch(e){}
  return (filename || "Инструмент").replace(/\.html?$/i, "");
}

function uploadsOverviewHtml(){
  const tools = getTools();
  const cards = tools.map(tool => `
    <div class="ov-card" data-open="up-${tool.id}">
      <div class="ov-ico">${ICONS.doc}</div>
      <h3>${escapeShellHtml(tool.name)}</h3>
      <div class="ov-meta">${new Date(tool.ts).toLocaleDateString(UI_LANG === "en" ? "en-GB" : "ru-RU")} · ${(tool.html.length/1024).toFixed(0)} ${UI_LANG === "en" ? "KB" : "КБ"}</div>
      <span class="ov-go">${t("Открыть →")}</span>
    </div>`).join("");
  return `<div class="up-form-wrap">
    <div class="ov-head"><h1>${tt("h1_uploads")}</h1></div>
    <div class="ov-sub">${t("Свои HTML-страницы внутри панели.")} ${tools.length ? t("Выберите инструмент или загрузите новый.") : t("Загрузите первый инструмент.")}</div>
    <div class="ov-grid">${cards}
      <div class="ov-card dashed" data-open="up-new">
        <div class="ov-ico">${ICONS.plus}</div>
        <h3>${t("Загрузить инструмент")}</h3>
        <p>${t("Добавьте HTML-файл — он появится в этом разделе и в меню слева.")}</p>
        <span class="ov-go">${t("Загрузить →")}</span>
      </div>
    </div></div>`;
}

function uploadFormHtml(){
  const en = UI_LANG === "en";
  return `<div class="up-form-wrap"><div class="up-form">
    <h1>${tt("h1_upform")}</h1>
    <div class="up-sub">${en
      ? "Upload a ready HTML page — it will appear in the Uploaded tools section and open in its original design."
      : "Загрузите готовую HTML-страницу — она появится в разделе «Загруженные инструменты» и откроется в своём исходном оформлении."}</div>
    <div class="up-field"><label>${t("Название инструмента (необязательно — распознаем из файла автоматически)")}</label>
      <input type="text" id="upName" placeholder="${en ? "e.g.: Audience calculator" : "например: Калькулятор аудиторий"}"></div>
    <div class="up-drop" id="upDrop">
      <div class="up-big">${t("Перетащите файл .html сюда")}</div>
      <p>${t("или нажмите, чтобы выбрать файл")}</p>
    </div>
    <input type="file" id="upFile" accept=".html,.htm" style="display:none">
    <div class="up-note">${en
      ? "<b>How it works:</b> the file is stored in the browser (localStorage) and opens in an embedded window without design changes. The name comes from the field above or from the file's &lt;title&gt;/&lt;h1&gt;. Rename or delete the tool on its page."
      : "<b>Как это работает:</b> файл сохраняется в браузере (localStorage) и открывается во встроенном окне без изменения оформления. Название берётся из поля выше либо из &lt;title&gt;/&lt;h1&gt; файла. Переименовать или удалить инструмент можно на его странице."}</div>
  </div></div>`;
}
function wireUploadForm(host){
  const drop = host.querySelector("#upDrop"), file = host.querySelector("#upFile");
  drop.onclick = () => file.click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("hover"); };
  drop.ondragleave = () => drop.classList.remove("hover");
  drop.ondrop = e => {
    e.preventDefault(); drop.classList.remove("hover");
    if (e.dataTransfer.files.length) importToolFile(e.dataTransfer.files[0], host.querySelector("#upName").value);
  };
  file.onchange = () => { if (file.files.length) importToolFile(file.files[0], host.querySelector("#upName").value); };
}
function importToolFile(f, customName){
  if (!/\.html?$/i.test(f.name) && f.type !== "text/html"){ alert("Нужен файл .html"); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const html = String(reader.result);
    const name = (customName || "").trim() || detectToolName(html, f.name);
    const tool = { id: Date.now().toString(36), name, html, ts: Date.now() };
    const list = getTools(); list.push(tool);
    if (saveTools(list)){
      openSection("uploads", "up-" + tool.id);
      renderWidgetBody("quicklinks");
    }
  };
  reader.readAsText(f, "utf-8");
}

function renderUploads(cid){
  const host = $("#uploadsHost");
  if (!cid){
    host.innerHTML = uploadsOverviewHtml();
    host.querySelectorAll("[data-open]").forEach(card =>
      card.onclick = () => openSection("uploads", card.dataset.open));
    return;
  }
  if (cid === "up-new"){
    host.innerHTML = uploadFormHtml();
    wireUploadForm(host);
    return;
  }
  const tool = getTools().find(x => "up-" + x.id === cid);
  if (!tool){ renderUploads(null); return; }
  host.innerHTML = `<div class="up-toolbar">
      <b>${escapeShellHtml(tool.name)}</b>
      <span class="up-meta">${new Date(tool.ts).toLocaleDateString(UI_LANG === "en" ? "en-GB" : "ru-RU")} · ${(tool.html.length/1024).toFixed(0)} ${UI_LANG === "en" ? "KB" : "КБ"}</span>
      <span class="spacer"></span>
      <button class="btn" id="upFit" title="Переключить масштаб">${t("Масштаб: по ширине")}</button>
      <button class="btn" id="upRename">${t("Переименовать")}</button>
      <button class="btn ghost-danger" id="upDelete">${t("Удалить")}</button>
    </div>
    <div class="up-frame-wrap" id="upFrameWrap">
      <iframe class="up-frame" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads" title="Загруженный инструмент"></iframe>
    </div>`;
  /* инструмент открывается в исходном оформлении — адаптация под айдентику отключена;
     по умолчанию содержимое масштабируется под ширину доступного окна */
  const frame = host.querySelector(".up-frame");
  const wrap = host.querySelector("#upFrameWrap");
  let fitMode = "fit";
  function fitFrame(){
    try {
      const doc = frame.contentDocument;
      if (!doc || !doc.documentElement) return;
      const natural = Math.max(doc.documentElement.scrollWidth, doc.body ? doc.body.scrollWidth : 0, 320);
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (fitMode === "fit" && natural > w && w > 0){
        const scale = w / natural;
        frame.style.width = natural + "px";
        frame.style.height = (h / scale) + "px";
        frame.style.transform = "scale(" + scale + ")";
      } else {
        frame.style.width = "100%";
        frame.style.height = "100%";
        frame.style.transform = "none";
      }
    } catch(e){}
  }
  frame.addEventListener("load", () => { fitFrame(); setTimeout(fitFrame, 300); });
  new ResizeObserver(fitFrame).observe(wrap);
  host.querySelector("#upFit").onclick = function(){
    fitMode = fitMode === "fit" ? "raw" : "fit";
    this.textContent = fitMode === "fit" ? t("Масштаб: по ширине") : t("Масштаб: 1:1");
    fitFrame();
  };
  frame.srcdoc = tool.html;
  host.querySelector("#upRename").onclick = () => {
    const n = prompt(UI_LANG === "en" ? "New tool name:" : "Новое название инструмента:", tool.name);
    if (n && n.trim()){
      saveTools(getTools().map(x => x.id === tool.id ? { ...x, name:n.trim() } : x));
      openSection("uploads", "up-" + tool.id);
      renderWidgetBody("quicklinks");
    }
  };
  host.querySelector("#upDelete").onclick = () => {
    const q = UI_LANG === "en" ? 'Delete tool "' + tool.name + '"?' : "Удалить инструмент «" + tool.name + "»?";
    if (confirm(q)){
      saveTools(getTools().filter(x => x.id !== tool.id));
      openSection("uploads");
      renderWidgetBody("quicklinks");
    }
  };
}

/* ---------- недавние инструменты ---------- */
function trackRecent(r){
  let rec = store.get("recent", []).filter(x => !(x.sid === r.sid && x.cid === r.cid));
  rec.unshift({ sid:r.sid, cid:r.cid, label:r.label, ts:Date.now() });
  store.set("recent", rec.slice(0, 6));
  renderWidgetBody("recent");
}

/* =========================================================
   ВИДЖЕТЫ ГЛАВНОЙ
   ========================================================= */
/* листья навигации (для «Быстрых ссылок»): дети групп + одиночные разделы */
function navLeaves(){
  const rows = [];
  NAV.forEach(s => {
    if (s.id === "home" || !appAllows(s.id) || !aclAllows(s)) return;
    if (s.children) s.children.filter(c => childVisible(c) && aclAllows(c)).forEach(c => rows.push({ sid:s.id, cid:c.id, label:c.label }));
    else rows.push({ sid:s.id, cid:null, label:s.label });
  });
  return rows;
}

const WIDGETS = {
  summary: { title:"Сводка по коммуникациям", eyebrow:"Дашборд", render: el => {
    el.innerHTML = `<div class="kpi-row">
      <div class="kpi"><div class="v up">+12,4%</div><div class="l">Выручка CPA, нед/нед</div></div>
      <div class="kpi"><div class="v flat">318</div><div class="l">Активных кампаний</div></div>
      <div class="kpi"><div class="v up">4,8%</div><div class="l">CTR e-mail, среднее</div></div>
      <div class="kpi"><div class="v down">−3 SLA</div><div class="l">Просроченные задачи</div></div>
    </div>
    <div class="empty-note" style="margin-top:10px">Демо-данные. Подключите источник в следующей итерации.</div>`;
  }},
  tasks: { title:"Мои задачи", eyebrow:"To-do", render: el => {
    const tasks = store.get("tasks", []);
    el.innerHTML = `<div class="task-add">
        <input type="text" placeholder="Новая задача… (Enter)" id="taskInput">
      </div><div id="taskList"></div>`;
    const list = el.querySelector("#taskList");
    if (!tasks.length) list.innerHTML = `<div class="empty-note">Задач пока нет — добавьте первую.</div>`;
    tasks.forEach((t, i) => {
      const row = document.createElement("div");
      row.className = "task" + (t.done ? " done" : "");
      row.innerHTML = `<input type="checkbox" ${t.done?"checked":""}><span class="task-text">${escapeShellHtml(t.text)}</span><button class="task-del" title="Удалить">×</button>`;
      row.querySelector("input").onchange = e => { tasks[i].done = e.target.checked; store.set("tasks", tasks); renderWidgetBody("tasks"); };
      row.querySelector(".task-del").onclick = () => { tasks.splice(i,1); store.set("tasks", tasks); renderWidgetBody("tasks"); };
      list.appendChild(row);
    });
    el.querySelector("#taskInput").onkeydown = e => {
      if (e.key === "Enter" && e.target.value.trim()){
        tasks.unshift({ text:e.target.value.trim(), done:false });
        store.set("tasks", tasks); renderWidgetBody("tasks");
      }
    };
  }},
  recent: { title:"Недавно использованные инструменты", eyebrow:"История", render: el => {
    const rec = store.get("recent", []).filter(r => r.sid);
    if (!rec.length){ el.innerHTML = `<div class="empty-note">${t("Откройте любой инструмент в меню слева — он появится здесь.")}</div>`; return; }
    el.innerHTML = `<div class="link-list">` + rec.map((r, i) =>
      `<div class="link-row" data-i="${i}"><span class="dot"></span>${escapeShellHtml(t(r.label))}<span class="when">${timeAgo(r.ts)}</span></div>`
    ).join("") + `</div>`;
    el.querySelectorAll(".link-row").forEach(row => row.onclick = () => { const r = rec[+row.dataset.i]; openSection(r.sid, r.cid); });
  }},
  quicklinks: { title:"Быстрые ссылки", eyebrow:"Инструменты", render: el => {
    const rows = navLeaves();
    el.innerHTML = `<div class="link-list">` + rows.map((r, i) =>
      `<div class="link-row" data-i="${i}"><span class="dot"></span>${escapeShellHtml(t(r.label))}</div>`
    ).join("") + `</div>`;
    el.querySelectorAll(".link-row").forEach(row => row.onclick = () => { const r = rows[+row.dataset.i]; openSection(r.sid, r.cid); });
  }},
  status: { title:"Статусы систем", eyebrow:"Мониторинг", render: el => {
    el.innerHTML = `
      <div class="status-line">Рассылки e-mail<span class="pill ok">OK</span></div>
      <div class="status-line">Push-шлюз<span class="pill ok">OK</span></div>
      <div class="status-line">Выгрузка CPA-фида<span class="pill warn">Задержка</span></div>
      <div class="status-line">Интеграция AppsFlyer<span class="pill ok">OK</span></div>
      <div class="empty-note" style="margin-top:8px">Демо-данные для MVP.</div>`;
  }},
};

const DEFAULT_LAYOUT = ["summary","tasks","recent","quicklinks"];
let layout = store.get("layout", DEFAULT_LAYOUT).filter(id => WIDGETS[id]);

const grid = $("#grid");
function renderGrid(){
  grid.innerHTML = "";
  layout.forEach(id => {
    const w = WIDGETS[id];
    const card = document.createElement("div");
    card.className = "widget"; card.dataset.id = id;
    card.innerHTML = `
      <div class="widget-head">
        <div><div class="widget-eyebrow">${w.eyebrow}</div><div class="widget-title">${t(w.title)}</div></div>
        <div class="widget-tools"><button class="wtool del" title="${t("Убрать блок")}">×</button></div>
      </div>
      <div class="widget-body"></div>`;
    card.querySelector(".del").onclick = () => { layout = layout.filter(x => x !== id); saveLayout(); };
    enableDrag(card);
    grid.appendChild(card);
    w.render(card.querySelector(".widget-body"));
  });
  renderChips();
}
function renderWidgetBody(id){
  const card = grid.querySelector(`.widget[data-id="${id}"]`);
  if (card && layout.includes(id)) WIDGETS[id].render(card.querySelector(".widget-body"));
}
function saveLayout(){ store.set("layout", layout); renderGrid(); }

/* ---------- добавление блоков ---------- */
const chipRow = $("#chipRow");
function renderChips(){
  chipRow.innerHTML = "";
  Object.entries(WIDGETS).forEach(([id, w]) => {
    const used = layout.includes(id);
    const chip = document.createElement("div");
    chip.className = "chip" + (used ? " used" : "");
    chip.textContent = (used ? "✓ " : "+ ") + t(w.title);
    if (!used) chip.onclick = () => { layout.push(id); saveLayout(); };
    chipRow.appendChild(chip);
  });
}

/* ---------- drag & drop (в режиме настройки) ---------- */
let dragId = null;
function enableDrag(card){
  card.addEventListener("dragstart", e => { dragId = card.dataset.id; card.classList.add("dragging"); });
  card.addEventListener("dragend", () => { dragId = null; card.classList.remove("dragging");
    grid.querySelectorAll(".widget").forEach(w => w.classList.remove("drop-target")); });
  card.addEventListener("dragover", e => { if (dragId && dragId !== card.dataset.id){ e.preventDefault(); card.classList.add("drop-target"); }});
  card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
  card.addEventListener("drop", e => {
    e.preventDefault();
    const from = layout.indexOf(dragId), to = layout.indexOf(card.dataset.id);
    if (from < 0 || to < 0) return;
    layout.splice(to, 0, layout.splice(from, 1)[0]);
    saveLayout();
  });
}

/* ---------- режим настройки ---------- */
const editToggle = $("#editToggle");
editToggle.onclick = () => {
  const on = document.body.classList.toggle("edit-mode");
  editToggle.textContent = on ? t("Готово") : t("Настроить главную");
  editToggle.classList.toggle("accent", on);
  grid.querySelectorAll(".widget").forEach(w => w.draggable = on);
};

/* ---------- утилиты ---------- */
function escapeShellHtml(s){ return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function timeAgo(ts){
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return t("сейчас");
  if (m < 60) return m + t(" мин");
  const h = Math.round(m / 60);
  if (h < 24) return h + t(" ч");
  return Math.round(h / 24) + t(" дн");
}

/* ---------- CSS-тултипы .info .tip: не даём вылезти за край экрана ----------
   Тултип шириной 250px висит по центру значка (left:50% + translateX(-50%)) и сам
   про край экрана не знает: у полей слева он уезжал на сайдбар, у правых — за окно.
   Считаем нужный сдвиг и кладём его в --tip-dx; CSS двигает на него сам тултип и на
   столько же в обратную сторону стрелку, чтобы она продолжала указывать на значок.
   Значки в «Мастере коммуникаций» пользуются другим механизмом — общим попапом
   #fieldHelpPopup (position:fixed), его позицию считает showFieldHelp. */
function clampTip(info) {
  const tip = info.querySelector(":scope > .tip");
  if (!tip) return;
  tip.style.setProperty("--tip-dx", "0px");
  const r = tip.getBoundingClientRect();
  const pad = 10;
  let dx = 0;
  if (r.left < pad) dx = pad - r.left;
  else if (r.right > window.innerWidth - pad) dx = (window.innerWidth - pad) - r.right;
  if (dx) tip.style.setProperty("--tip-dx", Math.round(dx) + "px");
}
/* mouseenter не всплывает — слушаем mouseover, он же ловит переход между значками */
document.addEventListener("mouseover", e => {
  const info = e.target.closest && e.target.closest(".info");
  if (info) clampTip(info);
});
document.addEventListener("focusin", e => {
  const info = e.target.closest && e.target.closest(".info");
  if (info) clampTip(info);
});

/* первичная отрисовка шапки и меню (виджеты и восстановление раздела — в стартовом скрипте в конце документа) */
renderLauncher();
renderNav();
updateAppSpecific();
applySubOrder();
