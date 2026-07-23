/* ========== Список шаблонов (формат Salesforce list view) ========== */

/* Сколько строк тянем с сервера за раз (пагинация: не грузим весь справочник в браузер). */
var LIST_PAGE = 50;
var _listReqSeq = 0;        // защита от гонки: применяем только последний набор
var _listDebounce = null;   // чтобы не бить в бэк на каждый символ поиска
var _listCount = null;      // {total, active} под текущими фильтрами (для строки статистики)
var _listOffset = 0;        // сколько строк уже загружено (курсор для дозагрузки)
var _listLoading = false;   // идёт запрос страницы
var _listExhausted = false; // сервер отдал меньше LIST_PAGE — грузить больше нечего

/* ===== Мультиселект фильтра: кнопка + выпадающая панель с чекбоксами =====
   Внутри одного фильтра выбранные значения комбинируются по ИЛИ (сервер получает
   несколько одноимённых параметров), между фильтрами — И. */
var MS_ALL_LABEL = { channel: 'Все каналы', product: 'Все продукты', touch: 'Все точки',
                     trigger: 'Все типы', partner: 'Все партнёры' };
var MS_STATE = {};   // ключ фильтра -> { options: [{v,l}], selected: [] }
var MS_CHANNELS = [
    { v: 'sms', l: 'SMS' }, { v: 'push', l: 'Push' }, { v: 'email', l: 'Email' }, { v: 'cc', l: 'КЦ' },
    { v: 'fa', l: 'FA' }, { v: 'vk', l: 'VK' }, { v: 'la', l: 'Live Activity' }
];

function msRoot(key) { return document.querySelector('.ms[data-filter="' + key + '"]'); }
function msSelected(key) { return ((MS_STATE[key] || {}).selected || []).slice(); }

/* Разовая привязка обработчиков открытия/закрытия. */
function msInit() {
    Object.keys(MS_ALL_LABEL).forEach(function (key) {
        MS_STATE[key] = MS_STATE[key] || { options: [], selected: [] };
        var root = msRoot(key);
        if (!root || root.dataset.wired) return;
        root.dataset.wired = '1';
        root.querySelector('.ms-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            var wasOpen = root.classList.contains('open');
            document.querySelectorAll('.ms.open').forEach(function (o) { o.classList.remove('open'); });
            if (!wasOpen) root.classList.add('open');
        });
        root.querySelector('.ms-panel').addEventListener('click', function (e) { e.stopPropagation(); });
        msSyncLabel(key);
    });
}
document.addEventListener('click', function () {   // клик мимо — закрыть все панели
    document.querySelectorAll('.ms.open').forEach(function (o) { o.classList.remove('open'); });
});

/* opts — массив строк либо {v,l}. Ранее выбранные значения, которых больше нет, отбрасываем. */
function msSetOptions(key, opts) {
    var st = MS_STATE[key] = MS_STATE[key] || { options: [], selected: [] };
    st.options = (opts || []).map(function (o) { return (typeof o === 'string') ? { v: o, l: o } : o; });
    var valid = st.options.map(function (o) { return o.v; });
    st.selected = st.selected.filter(function (v) { return valid.indexOf(v) !== -1; });

    var root = msRoot(key);
    if (!root) return;
    var panel = root.querySelector('.ms-panel');
    panel.innerHTML =
        '<label class="ms-opt ms-all"><input type="checkbox" data-all="1"' + (st.selected.length ? '' : ' checked') +
        '><span>' + sfdEsc(sfdT(MS_ALL_LABEL[key])) + '</span></label>' +
        st.options.map(function (o) {
            return '<label class="ms-opt"><input type="checkbox" value="' + sfdEsc(o.v) + '"' +
                   (st.selected.indexOf(o.v) !== -1 ? ' checked' : '') + '><span>' + sfdEsc(o.l) + '</span></label>';
        }).join('');
    panel.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
        cb.addEventListener('change', function () {
            if (cb.dataset.all) {                       // «Все» — снять весь выбор
                st.selected = [];
                panel.querySelectorAll('input[type=checkbox]').forEach(function (o) { o.checked = !!o.dataset.all; });
            } else {
                var i = st.selected.indexOf(cb.value);
                if (cb.checked && i === -1) st.selected.push(cb.value);
                if (!cb.checked && i !== -1) st.selected.splice(i, 1);
                var all = panel.querySelector('input[data-all]');
                if (all) all.checked = st.selected.length === 0;
            }
            msSyncLabel(key);
            applyFilters();
        });
    });
    msSyncLabel(key);
}

/* Подпись на кнопке: «Все …» / единственное значение / «N выбрано». */
function msSyncLabel(key) {
    var st = MS_STATE[key], root = msRoot(key);
    if (!st || !root) return;
    var btn = root.querySelector('.ms-btn');
    if (st.selected.length === 0) {
        btn.textContent = sfdT(MS_ALL_LABEL[key]);
    } else if (st.selected.length === 1) {
        var o = st.options.filter(function (x) { return x.v === st.selected[0]; })[0];
        btn.textContent = o ? o.l : st.selected[0];
    } else {
        btn.textContent = st.selected.length + ' ' + sfdT('выбрано');
    }
    btn.title = btn.textContent;
    root.classList.toggle('has-sel', st.selected.length > 0);
}

function msClear(key) {
    var st = MS_STATE[key];
    if (!st) return;
    st.selected = [];
    var root = msRoot(key);
    if (root) root.querySelectorAll('input[type=checkbox]').forEach(function (cb) { cb.checked = !!cb.dataset.all; });
    msSyncLabel(key);
}

/* Текущие значения фильтров и поиска из DOM (мультифильтры — массивами). */
function collectListFilters() {
    var val = function (id) { var e = document.getElementById(id); return e ? e.value : ''; };
    var f = {
        channel: msSelected('channel'),
        product: msSelected('product'),
        touch: msSelected('touch'),
        trigger: msSelected('trigger'),
        partner: msSelected('partner'),
        active: val('filterActive')
    };
    var s = document.getElementById('listSearch');
    f.q = s ? s.value.trim() : '';
    return f;
}

/* Запрос страницы списка с сервера: фильтры + поиск + limit + offset. Фильтрация/поиск идут
   по всей базе на бэке, в браузер приезжают порциями по LIST_PAGE.
   reset=true — новый набор (сброс курсора, заменяем список); иначе — дозагрузка (append). */
function fetchListPage(reset) {
    // Догрузку не дублируем, а вот смену фильтра/сортировки/поиска (reset) НИКОГДА не глотаем:
    // иначе изменение, сделанное пока летит предыдущий запрос, терялось бы молча.
    // Ответ устаревшего запроса отбрасывается по _listReqSeq ниже.
    if (!reset && (_listLoading || _listExhausted)) return Promise.resolve();

    var f = collectListFilters();
    if (reset) { _listOffset = 0; _listExhausted = false; _listReqSeq++; }
    var my = _listReqSeq;
    _listLoading = true;

    var params = {};
    // массив = мультифильтр (пустой не отправляем); строка — как есть
    Object.keys(f).forEach(function (k) {
        var v = f[k];
        if (Array.isArray(v)) { if (v.length) params[k] = v; }
        else if (v) params[k] = v;
    });
    params.sort = LIST_SORT.col;                       // сортирует сервер по всей выборке
    params.dir = LIST_SORT.dir === 1 ? 'asc' : 'desc';
    params.limit = LIST_PAGE;
    if (_listOffset > 0) params.offset = _listOffset;

    var stats = document.getElementById('listStats');
    if (reset && stats) stats.textContent = sfdT('Загрузка…');
    if (!reset) setLoadMoreNote(sfdT('Загрузка…'));

    var p = CRM.listTemplates(params).then(function (items) {
        if (my !== _listReqSeq) return;             // фильтры сменились на лету — ответ устарел
        var mapped = (items || []).map(CRM.apiItemToList);
        ALL_TEMPLATES = reset ? mapped : ALL_TEMPLATES.concat(mapped);
        _listOffset = ALL_TEMPLATES.length;
        if (mapped.length < LIST_PAGE) _listExhausted = true;   // хвост — больше страниц нет
        renderTemplateList(ALL_TEMPLATES);
    }).catch(function () {}).then(function () {
        if (my !== _listReqSeq) return;   // устаревший запрос не снимает флаг с актуального
        _listLoading = false;
        updateLoadMoreNote();
        maybeLoadMore();     // добить, если первый экран ещё не заполнен
    });

    if (reset) {
        CRM.countTemplates(f).then(function (c) {
            if (my !== _listReqSeq) return;
            _listCount = c;
            writeListStats((ALL_TEMPLATES || []).length);
        }).catch(function () {});
    }
    return p;
}

/* Наполнение мультифильтров: канал — фиксированный справочник каналов,
   продукт/точка/триггер — реальные значения из базы (facets). */
function populateFilterFacets() {
    msInit();
    msSetOptions('channel', MS_CHANNELS);
    if (!CRM || typeof CRM.facetsTemplates !== 'function') return;
    CRM.facetsTemplates().then(function (f) {
        msSetOptions('product', (f && f.products) || []);
        msSetOptions('touch', (f && f.touches) || []);
        msSetOptions('trigger', (f && f.triggers) || []);
        msSetOptions('partner', (f && f.partners) || []);
    }).catch(function () {});
}

/* Применение фильтров — новый набор с дебаунсом. */
function applyFilters() {
    if (_listDebounce) clearTimeout(_listDebounce);
    _listDebounce = setTimeout(function () { fetchListPage(true); }, 180);
}

/* Подпись у сентинела бесконечной прокрутки. */
function setLoadMoreNote(txt) {
    var el = document.getElementById('listLoadMore');
    if (el) el.textContent = txt || '';
}
function updateLoadMoreNote() {
    if (!ALL_TEMPLATES || !ALL_TEMPLATES.length) { setLoadMoreNote(''); return; }
    setLoadMoreNote(_listExhausted ? '— ' + sfdT('всё загружено') + ' —' : '');
}

/* Ближайший прокручиваемый предок (таблица списка живёт в .sf-table-wrap с max-height+overflow). */
function listScrollParent() {
    var el = document.getElementById('templateListBody');
    while (el && el !== document.body) {
        var oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
        el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
}

/* Догрузка следующей страницы, когда прокрутили близко к концу СВОЕГО скролл-контейнера. */
function maybeLoadMore() {
    if (_listLoading || _listExhausted) return;
    var list = document.getElementById('list');
    if (!list || list.offsetParent === null) return;   // список не активен/не виден
    var sc = listScrollParent();
    var remaining;
    if (sc === document.scrollingElement || sc === document.documentElement || sc === document.body) {
        var vh = window.innerHeight || document.documentElement.clientHeight;
        remaining = document.documentElement.scrollHeight - (window.scrollY + vh);
    } else {
        remaining = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
    }
    if (remaining < 300) fetchListPage(false);          // близко к низу — тянем следующие 50
}

var _listScrollRaf = null;
function onListScroll() {
    if (_listScrollRaf) return;
    _listScrollRaf = requestAnimationFrame(function () { _listScrollRaf = null; maybeLoadMore(); });
}
/* scroll не всплывает — слушаем в фазе перехвата, чтобы поймать любой скролл-контейнер. */
window.addEventListener('scroll', onListScroll, true);
window.addEventListener('resize', onListScroll);

/* Сброс фильтров */
function resetFilters() {
    ['channel', 'product', 'touch', 'trigger', 'partner'].forEach(msClear);
    var act = document.getElementById('filterActive');
    if (act) act.value = '';
    const searchEl = document.getElementById('listSearch');
    if (searchEl) searchEl.value = '';
    applyFilters();
}

/* Строка статистики: сколько показано из общего числа под фильтрами (total/active — с сервера). */
function writeListStats(shown) {
    var stats = document.getElementById('listStats');
    if (!stats) return;
    var total = _listCount ? _listCount.total : shown;
    var active = _listCount ? _listCount.active : null;
    var more = total > shown;
    stats.innerHTML = shown + ' ' + sfdT('элементов') +
        (more ? ' <span style="color:var(--dim,#9ab)">(' + sfdT('показано') + ' ' + shown + ' ' + sfdT('из') + ' ' + total + ' — ' + sfdT('листайте, чтобы загрузить ещё') + ')</span>' : '') +
        ' · ' + sfdT('Отсортировано по') + ' «' + sfdT(LIST_SORT_LABELS[LIST_SORT.col] || LIST_SORT.col) + '»' +
        (active != null ? ' · ' + sfdT('всего') + ' ' + total + ' (' + sfdT('активных') + ': ' + active + ', ' + sfdT('неактивных') + ': ' + (total - active) + ')' : '');
}

/* Сортировка списка по колонке (клик по заголовку) */
var LIST_SORT = { col: 'code', dir: 1 };
var LIST_SORT_LABELS = { channel: 'Канал', code: 'Code / ID', name: 'Название', product: 'Продукт', touch: 'Touch point', trigger: 'Trigger', partner: 'Партнёр', active: 'Статус' };
function listSortBy(col) {
    if (LIST_SORT.col === col) LIST_SORT.dir = -LIST_SORT.dir;
    else LIST_SORT = { col: col, dir: 1 };
    fetchListPage(true);   // сортирует сервер по всей выборке — тянем страницу заново
}

/* Отрисовка списка (формат Salesforce list view). templates — накопленный набор загруженных
   строк (растёт по мере прокрутки); сортируем и рисуем целиком. */
function renderTemplateList(templates) {
    const tbody = document.getElementById('templateListBody');

    // порядок задаёт сервер (сортировка идёт по всей выборке, а не по загруженным строкам)
    const sorted = templates;

    // индикатор сортировки в заголовках
    document.querySelectorAll('#list th.sf-sortable').forEach(th => {
        const mark = th.querySelector('.sf-sort');
        if (mark) mark.textContent = th.dataset.col === LIST_SORT.col ? (LIST_SORT.dir === 1 ? '▲' : '▼') : '';
    });

    writeListStats(sorted.length);

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 30px; color: #888;">${sfdT('Нет шаблонов по заданным фильтрам')}</td></tr>`;
        return;
    }

    tbody.innerHTML = sorted.map(tpl => {
        const channelLabels = { sms: 'SMS', push: 'Push', 'mobile-push': 'Push', email: 'Email', cc: 'КЦ', fa: 'FA', vk: 'VK', la: 'Live Activity' };
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

/* Открыть шаблон из списка (или из узла цепочки — тогда строки может не быть на текущей странице). */
function viewFromList(templateId) {
    var listItem = (ALL_TEMPLATES || []).find(function (t) { return t.id === templateId; });
    var channel, code;
    if (listItem) {
        channel = listItem.channel; code = listItem.code;
    } else {
        // id = "channel:code"; кода с двоеточием нет, режем по первому
        var i = templateId.indexOf(':');
        if (i < 0) return;
        channel = templateId.slice(0, i);
        code = templateId.slice(i + 1);
    }
    // Помечаем контекст редактирования, чтобы сохранение пошло как UPDATE именно этого шаблона.
    window.CRM_CURRENT = { channel: channel, code: code };
    // Тянем полные данные шаблона из бэкенда; при ошибке — частичные из строки списка (если она есть).
    CRM.getTemplate(channel, code)
        .then(function (dto) { showTemplateInViewer(templateId, CRM.dtoToV1(dto)); })
        .catch(function () {
            if (!listItem) { alert('Не удалось загрузить шаблон: ' + templateId); return; }
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

/* Данные списка шаблонов приходят из бэкенда (GET /api/templates) постранично — грузим первую
   страницу (LIST_PAGE строк) под текущими фильтрами, а не весь справочник.
   Дашборд пока вне скоупа — оставляем демо-данные (FALLBACK_DASHBOARD). */
function loadMockData() {
    if (typeof MOCK_TEMPLATES === 'undefined' || !MOCK_TEMPLATES) MOCK_TEMPLATES = {};
    if (typeof FALLBACK_DASHBOARD !== 'undefined') DASHBOARD_DATA = FALLBACK_DASHBOARD;
    populateFilterFacets();   // наполняем выпадашки продукт/точка/триггер реальными значениями
    return fetchListPage(true).then(function () {
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
