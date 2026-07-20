/* ========== Список шаблонов (формат Salesforce list view) ========== */

/* Применение фильтров */
function applyFilters() {
    const channelFilter = document.getElementById('filterChannel').value;
    const productFilter = document.getElementById('filterProduct').value;
    const touchFilter = document.getElementById('filterTouch').value;
    const triggerFilter = document.getElementById('filterTrigger').value;
    const activeFilter = document.getElementById('filterActive').value;

    // Начинаем со всех шаблонов
    let filtered = [...ALL_TEMPLATES];

    // Фильтр по статусу
    if (activeFilter === 'active') {
        filtered = filtered.filter(t => t.active);
    } else if (activeFilter === 'inactive') {
        filtered = filtered.filter(t => !t.active);
    }

    if (channelFilter) {
        filtered = filtered.filter(t => t.channel === channelFilter);
    }
    if (productFilter) {
        filtered = filtered.filter(t => t.product === productFilter);
    }
    if (touchFilter) {
        filtered = filtered.filter(t => t.touch === touchFilter);
    }
    if (triggerFilter) {
        filtered = filtered.filter(t => t.trigger === triggerFilter);
    }

    // Поиск по списку (как в Salesforce): code / название / продукт / партнёр / точка / триггер
    const searchEl = document.getElementById('listSearch');
    const q = searchEl ? searchEl.value.trim().toLowerCase() : '';
    if (q) {
        filtered = filtered.filter(t =>
            [t.code, t.name, t.product, t.partner, t.touch, t.trigger]
                .some(v => String(v || '').toLowerCase().indexOf(q) !== -1));
    }

    renderTemplateList(filtered);
}

/* Сброс фильтров */
function resetFilters() {
    document.getElementById('filterChannel').value = '';
    document.getElementById('filterProduct').value = '';
    document.getElementById('filterTouch').value = '';
    document.getElementById('filterTrigger').value = '';
    document.getElementById('filterActive').value = '';
    const searchEl = document.getElementById('listSearch');
    if (searchEl) searchEl.value = '';
    applyFilters();
}

/* Сортировка списка по колонке (клик по заголовку) */
var LIST_SORT = { col: 'code', dir: 1 };
var LIST_SORT_LABELS = { channel: 'Канал', code: 'Code / ID', name: 'Название', product: 'Продукт', touch: 'Touch point', trigger: 'Trigger', partner: 'Партнёр', active: 'Статус' };
function listSortBy(col) {
    if (LIST_SORT.col === col) LIST_SORT.dir = -LIST_SORT.dir;
    else LIST_SORT = { col: col, dir: 1 };
    applyFilters();
}

/* Отрисовка списка (формат Salesforce list view) */
function renderTemplateList(templates) {
    const tbody = document.getElementById('templateListBody');
    const stats = document.getElementById('listStats');

    const sorted = templates.slice().sort((a, b) => {
        let va = a[LIST_SORT.col], vb = b[LIST_SORT.col];
        if (typeof va === 'boolean') { va = va ? 1 : 0; vb = vb ? 1 : 0; }
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * LIST_SORT.dir;
        return String(va || '').localeCompare(String(vb || ''), 'ru') * LIST_SORT.dir;
    });

    // индикатор сортировки в заголовках
    document.querySelectorAll('#list th.sf-sortable').forEach(th => {
        const mark = th.querySelector('.sf-sort');
        if (mark) mark.textContent = th.dataset.col === LIST_SORT.col ? (LIST_SORT.dir === 1 ? '▲' : '▼') : '';
    });

    const totalAll = ALL_TEMPLATES.length;
    const totalActive = ALL_TEMPLATES.filter(x => x.active).length;
    stats.innerHTML = `${sorted.length} ${sfdT('элементов')} · ${sfdT('Отсортировано по')} «${sfdT(LIST_SORT_LABELS[LIST_SORT.col] || LIST_SORT.col)}» · ${sfdT('всего')} ${totalAll} (${sfdT('активных')}: ${totalActive}, ${sfdT('неактивных')}: ${totalAll - totalActive})`;

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 30px; color: #888;">${sfdT('Нет шаблонов по заданным фильтрам')}</td></tr>`;
        return;
    }

    tbody.innerHTML = sorted.map(tpl => {
        const channelLabels = { sms: 'SMS', push: 'Push', 'mobile-push': 'Push', email: 'Email', cc: 'КЦ' };
        return `
            <tr>
                <td class="sf-check-col"><input type="checkbox"></td>
                <td><span class="channel-badge channel-${tpl.channel}">${channelLabels[tpl.channel] || tpl.channel}</span></td>
                <td><button class="sf-link" onclick="viewFromList('${tpl.id}')">${sfdEsc(tpl.code)}</button></td>
                <td><button class="sf-link" onclick="viewFromList('${tpl.id}')">${sfdEsc(tpl.name)}</button></td>
                <td>${sfdEsc(tpl.product)}</td>
                <td>${sfdEsc(tpl.touch)}</td>
                <td>${sfdEsc(tpl.trigger)}</td>
                <td>${sfdEsc(tpl.partner)}</td>
                <td class="${tpl.active ? 'status-active' : 'status-inactive'}">${tpl.active ? '● ' + sfdT('активный') : '○ ' + sfdT('неактивный')}</td>
                <td><button class="sf-row-menu" title="${sfdT('Открыть настройки шаблона')}" onclick="viewFromList('${tpl.id}')">${sfdT('Просмотр')}</button></td>
            </tr>
        `;
    }).join('');
}

/* Открыть шаблон из списка */
function viewFromList(templateId) {
    const listItem = ALL_TEMPLATES.find(t => t.id === templateId);
    if (!listItem) return;
    // Помечаем контекст редактирования, чтобы сохранение пошло как UPDATE именно этого шаблона.
    window.CRM_CURRENT = { channel: listItem.channel, code: listItem.code };
    // Тянем полные данные шаблона из бэкенда; при ошибке — частичные из строки списка.
    CRM.getTemplate(listItem.channel, listItem.code)
        .then(function (dto) { showTemplateInViewer(templateId, CRM.dtoToV1(dto)); })
        .catch(function () {
            showTemplateInViewer(templateId, {
                channel: listItem.channel, code: listItem.code, name: listItem.name, brief: listItem.name,
                trigger: listItem.trigger, product: listItem.product, partner: listItem.partner,
                touch: listItem.touch, active: listItem.active,
                source: [listItem.channel, listItem.trigger, listItem.product, listItem.partner, listItem.touch].filter(Boolean).join('_'),
                comname: 'NoComName', day: '', message: '', letteros_id: listItem.code,
                subject: listItem.name, source_system: '', segment: '', segment_desc: '', link_type: '', biz_type: ''
            });
        });
}

/* Отрисовка выбранного шаблона во вкладке «Просмотр настроек» (SF Details). */
function showTemplateInViewer(templateId, data) {
    if (!data) return;
    // Открываем подраздел «Просмотр настроек» через оболочку (режим view в #sec-admin)
    if (typeof openSection === 'function') openSection('comms', 'viewer');
    const templateSelect = document.getElementById('templateSelect');
    if (templateSelect) {
        templateSelect.value = templateId;
        if (!templateSelect.querySelector('option[value="' + templateId + '"]')) {
            const opt = document.createElement('option');
            opt.value = templateId;
            opt.textContent = (data.code || data.letteros_id) + ' - ' + (data.comname || data.name || '');
            templateSelect.appendChild(opt);
            templateSelect.value = templateId;
        }
    }
    renderTemplateDetails(data, templateId);
}

/* Мок-данные подгружаются из mock-data.json */
var MOCK_TEMPLATES = {};
var ALL_TEMPLATES = [];
var DASHBOARD_DATA = {};

/* Fallback при ошибке загрузки (например file://) */
/* Все 11 шаблонов из mock-data.json templates (при ошибке загрузки JSON) */
var FALLBACK_LIST_TEMPLATES = [
    { id: "sms_1", channel: "sms", code: 1001, name: "Брошенная заявка", product: "loan", touch: "abandoned-form", trigger: "trigger", partner: "bank", active: true },
    { id: "sms_2", channel: "sms", code: 1002, name: "Промо карта", product: "card", touch: "issue", trigger: "promo", partner: "tinkoff", active: true },
    { id: "sms_5", channel: "sms", code: 1005, name: "Страхование", product: "insurance", touch: "abandoned-application", trigger: "trigger", partner: "insure", active: false },
    { id: "push_1", channel: "push", code: 2001, name: "Промо пуш", product: "card", touch: "issue", trigger: "promo", partner: "shop", active: true },
    { id: "push_2", channel: "push", code: 2002, name: "Приветственный", product: "account", touch: "sign", trigger: "trigger", partner: "internal", active: true },
    { id: "push_5", channel: "push", code: 2005, name: "Старая акция", product: "card", touch: "issue", trigger: "promo", partner: "retail", active: false },
    { id: "email_1", channel: "email", code: 12345, name: "Сброс пароля", product: "account", touch: "sign", trigger: "trigger", partner: "auth", active: true },
    { id: "email_2", channel: "email", code: 67890, name: "Подтверждение email", product: "account", touch: "sign", trigger: "trigger", partner: "registration", active: true },
    { id: "email_6", channel: "email", code: 44444, name: "Старое письмо", product: "loan", touch: "abandoned-form", trigger: "trigger", partner: "old", active: false },
    { id: "cc_1", channel: "cc", code: 4001, name: "Сегмент удержания", product: "subscription", touch: "renewal", trigger: "trigger", partner: "retention", active: true },
    { id: "cc_2", channel: "cc", code: 4002, name: "Продление подписки", product: "subscription", touch: "renewal", trigger: "trigger", partner: "billing", active: false }
];
var FALLBACK_DASHBOARD = {
    today: { total: 12847, success: 12104, error: 743, byChannel: { sms: { total: 4521, success: 4298, error: 223 }, push: { total: 5892, success: 5614, error: 278 }, email: { total: 1987, success: 1812, error: 175 }, cc: { total: 447, success: 380, error: 67 } } },
    monthlyAvg: 11203,
    weekData: [
        { day: "Пн", date: "20.01", total: 10234, success: 9621, error: 613 },
        { day: "Вт", date: "21.01", total: 11456, success: 10812, error: 644 },
        { day: "Ср", date: "22.01", total: 10987, success: 10345, error: 642 },
        { day: "Чт", date: "23.01", total: 12102, success: 11398, error: 704 },
        { day: "Пт", date: "24.01", total: 11678, success: 10989, error: 689 },
        { day: "Сб", date: "25.01", total: 8934, success: 8412, error: 522 },
        { day: "Вс", date: "26.01", total: 12847, success: 12104, error: 743 }
    ],
    topTemplates: [
        { channel: "push", code: 2001, name: "Промо пуш", sent: 2341, success: 2289, error: 52 },
        { channel: "sms", code: 1001, name: "Брошенная заявка", sent: 1876, success: 1798, error: 78 },
        { channel: "push", code: 2002, name: "Приветственный", sent: 1654, success: 1621, error: 33 },
        { channel: "email", code: 12345, name: "Сброс пароля", sent: 987, success: 934, error: 53 },
        { channel: "sms", code: 1002, name: "Промо карта", sent: 845, success: 812, error: 33 }
    ],
    duplicatesByDate: [
        { date: "20.01", day: "Пн", count: 312 }, { date: "21.01", day: "Вт", count: 287 }, { date: "22.01", day: "Ср", count: 341 },
        { date: "23.01", day: "Чт", count: 298 }, { date: "24.01", day: "Пт", count: 276 }, { date: "25.01", day: "Сб", count: 189 }, { date: "26.01", day: "Вс", count: 421 }
    ],
    perUserByChannel: { sms: { avg: 1.2, min: 0, max: 3 }, push: { avg: 1.8, min: 0, max: 3 }, email: { avg: 1.1, min: 0, max: 3 }, cc: { avg: 1.0, min: 0, max: 3 } },
    activeAudienceByChannel: { sms: 120000, push: 185000, email: 95000, cc: 45000 },
    channelOverlapSmsEmailPush: 42000,
    usersWithNoChannel: { count: 15000, total: 500000, sharePercent: 3 },
    topActiveSegments: [
        { name: "Кредиты — брошенная заявка", sent: 4521 }, { name: "Карты — промо", sent: 3890 }, { name: "Вклады — продление", sent: 2103 },
        { name: "Страхование — осаго", sent: 1876 }, { name: "Ипотека — заявка", sent: 1456 }
    ],
    topWorstDeliverySegments: [
        { name: "Сегмент устаревших телефонов", sent: 1200, success: 612, rate: 51 }, { name: "Неактивные email", sent: 890, success: 534, rate: 60 },
        { name: "Внешние партнёры", sent: 2100, success: 1365, rate: 65 }, { name: "Холодная база КЦ", sent: 780, success: 546, rate: 70 }, { name: "Старые пуш-токены", sent: 3400, success: 2550, rate: 75 }
    ],
    avgCommPerUser: { days7: 4.2, days30: 12.8 },
    pctUsersOverN: [ { n: 3, pct: 45 }, { n: 5, pct: 28 }, { n: 10, pct: 12 }, { n: 15, pct: 5 }, { n: 20, pct: 2 } ],
    topOverloadedSegments: [
        { name: "Промо — карты (частые рассылки)", avgPerUser: 8.2, users: 12000 }, { name: "Кредиты — брошенная корзина", avgPerUser: 7.1, users: 18500 },
        { name: "Вклады — напоминания", avgPerUser: 6.8, users: 8200 }, { name: "Страхование — осаго продление", avgPerUser: 6.2, users: 9500 },
        { name: "Ипотека — дозвон", avgPerUser: 5.9, users: 4100 }, { name: "КЦ — горячие лиды", avgPerUser: 5.5, users: 6700 },
        { name: "Push — новости дня", avgPerUser: 5.3, users: 22000 }, { name: "Email — дайджест недели", avgPerUser: 5.0, users: 35000 },
        { name: "Лояльность — бонусы", avgPerUser: 4.8, users: 14000 }, { name: "Маркетплейс — рекомендации", avgPerUser: 4.5, users: 9800 }
    ],
    unsubscribesAfterX: [
        { contacts: 1, count: 89 }, { contacts: 2, count: 156 }, { contacts: 3, count: 234 }, { contacts: 5, count: 312 },
        { contacts: 7, count: 198 }, { contacts: 10, count: 145 }, { contacts: 15, count: 87 }, { contacts: 20, count: 43 }
    ]
};

function templateToListItem(t, id) {
    return {
        id: id,
        channel: t.channel,
        code: t.code != null ? t.code : t.letteros_id,
        name: t.name || t.brief || id,
        product: t.product || '',
        touch: t.touch || '',
        trigger: t.trigger || '',
        partner: t.partner || '',
        active: !!t.active
    };
}

/* Данные списка шаблонов приходят из бэкенда (GET /api/templates), а не из mock-data.json.
   Дашборд пока вне скоупа — оставляем демо-данные (FALLBACK_DASHBOARD). */
function loadMockData() {
    return CRM.listTemplates()
        .then(function (items) {
            ALL_TEMPLATES = (items || []).map(CRM.apiItemToList);
            MOCK_TEMPLATES = {};
            if (typeof FALLBACK_DASHBOARD !== 'undefined') DASHBOARD_DATA = FALLBACK_DASHBOARD;
            if (typeof refreshViewTemplateSelect === 'function') refreshViewTemplateSelect();
        });
}

/* Минимальный HTML писем для fallback (когда mock-data.json не загружен) */
var FALLBACK_EMAIL_MSG = {
    email_1: '<div style="font-family:Arial,sans-serif"><h1>Сброс пароля</h1><p>Вы запросили сброс пароля.</p><a href="https://example.com/reset?token=abc123" style="padding:10px 20px;background:#4a6cf7;color:white;text-decoration:none;border-radius:5px;">Сбросить пароль</a><p><a href="https://example.com/support">Центр помощи</a> | <a href="https://example.com/unsubscribe">Отписаться</a></p></div>',
    email_2: '<div style="font-family:Arial,sans-serif"><h1>Добро пожаловать!</h1><p>Подтвердите ваш email:</p><a href="https://example.com/confirm?email=user@test.com" style="padding:10px 20px;background:#22c55e;color:white;text-decoration:none;">Подтвердить email</a><p><a href="https://example.com/unsubscribe">Отписаться</a></p></div>',
    email_6: '<div style="font-family:Arial"><h1>Устаревшее письмо</h1><p>Это письмо больше не используется.</p><a href="https://example.com/contact">Служба поддержки</a></div>'
};

function applyFallbackData() {
    ALL_TEMPLATES = FALLBACK_LIST_TEMPLATES.slice();
    MOCK_TEMPLATES = {};
    ALL_TEMPLATES.forEach(function(t) {
        const rec = Object.assign({}, t);
        if (t.channel === 'email' && FALLBACK_EMAIL_MSG[t.id]) rec.msg_text = FALLBACK_EMAIL_MSG[t.id];
        MOCK_TEMPLATES[t.id] = rec;
    });
    DASHBOARD_DATA = FALLBACK_DASHBOARD;
}

/* Режим отдельного раздела: ?only=list | ?only=dashboard.
   Без параметра — обычный мастер (вкладки «Список шаблонов» и «Дашборд» скрыты,
   т.к. они вынесены в самостоятельные разделы панели). */
function applyOnlyMode() {
    var only = new URLSearchParams(location.search).get('only');
    var tabsBar = document.getElementById('tabsBar');
    if (only === 'list' || only === 'dashboard') {
        if (tabsBar) tabsBar.style.display = 'none';
        document.querySelectorAll('.form').forEach(f => f.classList.remove('active'));
        var target = document.getElementById(only);
        if (target) target.classList.add('active');
    } else if (tabsBar) {
        var lt = tabsBar.querySelector('.tab-list');
        var dt = tabsBar.querySelector('.tab-dashboard');
        if (lt) lt.style.display = 'none';
        if (dt) dt.style.display = 'none';
    }
}

/* Инициализация списка и подсказок при загрузке */
document.addEventListener('DOMContentLoaded', () => {
    applyOnlyMode();
    loadMockData()
        .then(() => {
            applyFilters();
            refreshViewTemplateSelect();
            initDashboard();
            initFieldHelp();
        })
        .catch(err => {
            console.error('Не удалось загрузить mock-data.json:', err);
            applyFallbackData();
            applyFilters();
            refreshViewTemplateSelect();
            initDashboard();
            initFieldHelp();
        });
});
