/* ========== Список шаблонов (формат Salesforce list view) ==========

   Фильтрация, поиск, сортировка и подсчёт идут на бэкенде: в браузер приезжают
   страницы по LIST_PAGE строк, весь справочник (десятки тысяч) сюда не грузится.

   Настройка списка (какие колонки и фильтры показывать) — личная, живёт в
   localStorage: crmpanel:listCols / crmpanel:listFilters.
   Ячейки правятся по карандашу, правка применяется ✓ и уходит на бэкенд. */

/* Колонки списка. Порядок задаёт порядок в таблице; opts — значения для правки selectом. */
var LIST_COLUMNS = [
    { k:'channel',  label:'Канал',       edit:'select', opts:['sms','push','email','cc','fa','vk','la'] },
    /* Live Activity — разновидность пуша, отдельным каналом в списке не показывается:
       в колонке «Канал» у него бейдж Push, а принадлежность к LA видна здесь.
       Только чтение: смена канала у заведённого шаблона — это переезд между таблицами,
       карточка её тоже не даёт (тумблер «Это Live Activity» есть лишь при создании). */
    { k:'is_la',    label:'Live Activity', ro:true },
    { k:'code',     label:'Code / ID',   edit:'text', link:true },
    { k:'name',     label:'Название',    edit:'text', link:true },
    { k:'product',  label:'Продукт',     edit:'text' },
    { k:'touch',    label:'Touch point', edit:'text' },
    { k:'trigger',  label:'Trigger',     edit:'select', opts:['','trigger','promo'] },
    /* combo, а не строгий select: значения берутся из dictionary.d_partner, но вписать
       своё можно — партнёр в работе появляется раньше, чем его заводят в справочник */
    { k:'partner',  label:'Партнёр',     edit:'combo', dict:'partner' },
    { k:'active',   label:'Статус',      edit:'bool' },
    /* Остальные поля списка, которые отдаёт бэкенд (CRM.apiItemToList). Правка source_type
       и Letteros ID — в карточке шаблона: оба участвуют в неймингe и в поиске, менять их
       по одной ячейке, не видя остальных полей, опасно. */
    { k:'source',   label:'Source type', ro:true },
    { k:'letteros', label:'Letteros ID', ro:true },
];
/* Ключ колонки списка не всегда совпадает с ключом поля карточки: строки списка
   собирает CRM.apiItemToList, а сохраняется правка через CRM.dtoToV1 — там имя
   коммуникации лежит в comname, а не в name. Без этой таблицы правка «Названия»
   уходила в несуществующее поле, до сервера не доезжала и молча откатывалась
   при следующем обновлении списка: на экране значение менялось, в базе — нет. */
var LIST_TO_V1 = { name: 'comname' };
/* Фильтры — только те, что умеет бэкенд (TemplateController.list): фильтрация и подсчёт
   идут по всей базе, клиентский фильтр поверх страницы в 50 строк врал бы. Новый фильтр
   = новый @RequestParam и условие в запросе. */
var LIST_FILTERS = [
    { k:'channel', label:'Канал' }, { k:'product', label:'Продукт' }, { k:'touch', label:'Touch point' },
    { k:'trigger', label:'Trigger type' }, { k:'partner', label:'Партнёр' }, { k:'active', label:'Статус' },
];
/* Не больше 10 колонок и 10 фильтров одновременно — иначе список перестаёт читаться. */
var LIST_MAX_COLS = 10;
var LIST_MAX_FILTERS = 10;
/* по умолчанию — первые LIST_MAX_COLS колонок; Letteros ID включается вручную */
var DEFAULT_LIST_COLS = LIST_COLUMNS.map(function(c){ return c.k; }).slice(0, LIST_MAX_COLS);
var DEFAULT_LIST_FILTERS = LIST_FILTERS.map(function(f){ return f.k; });

function lsGet(key, def){
    try { var v = localStorage.getItem('crmpanel:' + key); return v ? JSON.parse(v) : def; } catch(e){ return def; }
}
function lsSet(key, val){
    try { localStorage.setItem('crmpanel:' + key, JSON.stringify(val)); } catch(e){}
}
/* Колонки, появившиеся после того, как пользователи уже сохранили свой набор в
   localStorage: без доливки новая колонка не показалась бы никому, кроме тех, кто нажмёт
   «По умолчанию». Доливаем один раз (отметка в crmpanel:listColsAdded), чтобы осознанно
   снятая колонка не возвращалась при каждой загрузке. */
var LIST_COLS_ADDED = ['is_la'];
function listMigrateCols(saved){
    var done = lsGet('listColsAdded', []);
    var add = LIST_COLS_ADDED.filter(function(k){
        return done.indexOf(k) === -1 && saved.indexOf(k) === -1;
    });
    if (!add.length) return saved;
    var next = saved.slice();
    /* ставим на то же место, что и в наборе по умолчанию, а не в хвост */
    add.forEach(function(k){
        var at = DEFAULT_LIST_COLS.indexOf(k);
        next.splice(at === -1 ? next.length : Math.min(at, next.length), 0, k);
    });
    lsSet('listCols', next);
    lsSet('listColsAdded', done.concat(add));
    return next;
}
function listVisibleCols(){
    var saved = lsGet('listCols', null);
    var ids = (Array.isArray(saved) && saved.length) ? listMigrateCols(saved) : DEFAULT_LIST_COLS;
    /* лимит применяем и к уже сохранённым наборам: они могли скопиться до его появления */
    return LIST_COLUMNS.filter(function(c){ return ids.indexOf(c.k) !== -1; }).slice(0, LIST_MAX_COLS);
}
function listVisibleFilters(){
    var saved = lsGet('listFilters', null);
    return (Array.isArray(saved) ? saved : DEFAULT_LIST_FILTERS).slice(0, LIST_MAX_FILTERS);
}
function toggleListPanel(e){
    if (e) e.stopPropagation();
    var p = document.getElementById('listPanel');
    if (!p) return;
    var willOpen = !p.classList.contains('open');
    p.classList.toggle('open', willOpen);
    if (willOpen) renderListPanel();
}
document.addEventListener('click', function(e){
    var p = document.getElementById('listPanel');
    if (p && p.classList.contains('open') && !e.target.closest('.sf-settings')) p.classList.remove('open');
});
function renderListPanel(){
    var colsBox = document.getElementById('listColsBox');
    var filtBox = document.getElementById('listFiltersBox');
    if (!colsBox || !filtBox) return;
    var visCols = listVisibleCols().map(function(c){ return c.k; });
    var visFilt = listVisibleFilters();
    /* лимит показываем счётчиком у заголовка и гасим лишние чекбоксы,
       чтобы упереться в него было видно заранее, а не по факту отказа */
    var setLim = function(box, n, max){
        var h = box.previousElementSibling;
        if (!h) return;
        var lim = h.querySelector('.sf-lim');
        if (!lim){ lim = document.createElement('span'); lim.className = 'sf-lim'; h.appendChild(lim); }
        lim.textContent = n + ' / ' + max;
    };
    colsBox.innerHTML = LIST_COLUMNS.map(function(c){
        var on = visCols.indexOf(c.k) !== -1, full = !on && visCols.length >= LIST_MAX_COLS;
        return '<label' + (full ? ' class="off"' : '') + '><input type="checkbox" data-col="' + c.k + '"' +
            (on ? ' checked' : '') + (full ? ' disabled' : '') + '>' + sfdT(c.label) + '</label>';
    }).join('');
    filtBox.innerHTML = LIST_FILTERS.map(function(f){
        var on = visFilt.indexOf(f.k) !== -1, full = !on && visFilt.length >= LIST_MAX_FILTERS;
        return '<label' + (full ? ' class="off"' : '') + '><input type="checkbox" data-filt="' + f.k + '"' +
            (on ? ' checked' : '') + (full ? ' disabled' : '') + '>' + sfdT(f.label) + '</label>';
    }).join('');
    setLim(colsBox, visCols.length, LIST_MAX_COLS);
    setLim(filtBox, visFilt.length, LIST_MAX_FILTERS);
    colsBox.querySelectorAll('input[data-col]').forEach(function(ch){
        ch.onchange = function(){
            var ids = [];
            colsBox.querySelectorAll('input[data-col]').forEach(function(x){ if (x.checked) ids.push(x.dataset.col); });
            if (!ids.length){ ch.checked = true; return; }   /* хотя бы одна колонка */
            if (ids.length > LIST_MAX_COLS){ ch.checked = false; return; }
            lsSet('listCols', ids);
            renderListPanel();   /* перерисовываем панель: лимит мог включиться/отпустить */
            // колонки — дело отрисовки, за новой страницей на сервер не идём
            renderTemplateList(ALL_TEMPLATES);
        };
    });
    filtBox.querySelectorAll('input[data-filt]').forEach(function(ch){
        ch.onchange = function(){
            var ids = [];
            filtBox.querySelectorAll('input[data-filt]').forEach(function(x){ if (x.checked) ids.push(x.dataset.filt); });
            if (ids.length > LIST_MAX_FILTERS){ ch.checked = false; return; }
            lsSet('listFilters', ids);
            renderListPanel();
            applyListFilterVisibility();
            applyFilters();   // скрытый фильтр перестаёт применяться — выборка меняется
        };
    });
}
function resetListSettings(){
    lsSet('listCols', DEFAULT_LIST_COLS);
    lsSet('listFilters', DEFAULT_LIST_FILTERS);
    renderListPanel();
    applyListFilterVisibility();
    applyFilters();
}
/* показать/скрыть блоки фильтров согласно настройке */
function applyListFilterVisibility(){
    var vis = listVisibleFilters();
    document.querySelectorAll('#list .filters-row .field[data-filter]').forEach(function(f){
        f.style.display = vis.indexOf(f.dataset.filter) !== -1 ? '' : 'none';
    });
    var row = document.querySelector('#list .filters-row');
    if (row) row.style.display = vis.length ? '' : 'none';
}

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
/* «Push» в фильтре берёт и Live Activity: для человека это один канал, отличие
   видно в колонке «Live Activity». Раскрывается в два значения при сборке запроса
   (msExpand) — сервер по-прежнему знает про отдельный канал la. */
var MS_CHANNELS = [
    { v: 'sms', l: 'SMS' }, { v: 'push', l: 'Push' }, { v: 'email', l: 'Email' }, { v: 'cc', l: 'КЦ' },
    { v: 'fa', l: 'FA' }, { v: 'vk', l: 'VK' }
];
var MS_EXPAND = { channel: { push: ['push', 'la'] } };
function msExpand(key, values) {
    var map = MS_EXPAND[key];
    if (!map) return values;
    var out = [];
    values.forEach(function (v) {
        (map[v] || [v]).forEach(function (x) { if (out.indexOf(x) === -1) out.push(x); });
    });
    return out;
}

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

/* Текущие значения фильтров и поиска из DOM (мультифильтры — массивами).
   Спрятанный в настройках фильтр не применяется: иначе выборка молча сужалась бы
   значением, которого пользователь на экране не видит. */
function collectListFilters() {
    var vis = listVisibleFilters();
    var shown = function (key) { return vis.indexOf(key) !== -1; };
    var ms = function (key) { return shown(key) ? msExpand(key, msSelected(key)) : []; };
    var val = function (id) { var e = document.getElementById(id); return e ? e.value : ''; };
    var f = {
        channel: ms('channel'),
        product: ms('product'),
        touch: ms('touch'),
        trigger: ms('trigger'),
        partner: ms('partner'),
        active: shown('active') ? val('filterActive') : ''
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

/* ---------- заведение и выгрузка ----------

   Кнопки стоят в шапке реестра, рядом с фильтрами: заводить и выгружать хотят оттуда,
   где смотрят список, а не из соседнего раздела. */

/* Новый шаблон — тот же мастер коммуникаций, что и в своём пункте меню. Отдельной формы
   заведения не делаем: две формы под одно действие разошлись бы на первой же правке. */
function newTemplate() {
    if (typeof openSection === "function") openSection("comms", "admin");
    else if (typeof setAdminMode === "function") setAdminMode("wizard");
}

/* Выгрузка всего, что подходит под фильтр, — а не тех строк, что успели подгрузиться.

   Список тянется порциями по мере прокрутки, и в ALL_TEMPLATES лежит ровно то, до чего
   человек долистал. Для файла этого мало: фильтр выставлен, значит нужен весь его
   результат. Идём на сервер теми же условиями и той же сортировкой, кусками по 500,
   пока не кончится. Потолок — от файла, который никто не откроет. */
var TPL_EXPORT_CHUNK = 500, TPL_EXPORT_MAX = 20000;

function exportTemplateList() {
    var cols = listVisibleCols();
    var btn = document.getElementById("listExport");
    var stats = document.getElementById("listStats");
    if (btn) btn.disabled = true;
    if (stats) stats.textContent = sfdT("Собираем выгрузку…");

    var f = collectListFilters();
    var params = {};
    Object.keys(f).forEach(function (k) {
        var v = f[k];
        if (Array.isArray(v)) { if (v.length) params[k] = v; }
        else if (v) params[k] = v;
    });
    params.sort = LIST_SORT.col;
    params.dir = LIST_SORT.dir === 1 ? "asc" : "desc";
    params.limit = TPL_EXPORT_CHUNK;

    var all = [];
    function step(offset) {
        var q = Object.assign({}, params);
        if (offset > 0) q.offset = offset;
        return CRM.listTemplates(q).then(function (items) {
            var got = (items || []).map(CRM.apiItemToList);
            all = all.concat(got);
            if (stats) stats.textContent = sfdT("Собираем выгрузку… ") + all.length;
            if (got.length === TPL_EXPORT_CHUNK && all.length < TPL_EXPORT_MAX) {
                return step(offset + TPL_EXPORT_CHUNK);
            }
        });
    }

    step(0).then(function () {
        writeTemplateCsv(cols, all);
        if (stats) {
            stats.textContent = all.length >= TPL_EXPORT_MAX
                ? sfdT("Выгружено строк: ") + all.length + sfdT(" — это потолок выгрузки, сузьте фильтр")
                : sfdT("Выгружено строк: ") + all.length;
        }
    }).catch(function () {
        if (stats) stats.textContent = sfdT("Не удалось собрать выгрузку");
    }).then(function () {
        if (btn) btn.disabled = false;
    });
}

function writeTemplateCsv(cols, rows) {
    var cell = function (v) {
        var s = v == null ? "" : String(v);
        /* Кавычки, точки с запятой и переносы ломают строку CSV: берём в кавычки,
           внутренние кавычки удваиваем (RFC 4180). */
        return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var head = cols.map(function (c) { return cell(sfdT(c.label)); }).join(";");
    var body = rows.map(function (r) {
        return cols.map(function (c) {
            var v = r[c.k];
            /* Галки в файле должны читаться как на экране, а не как true/false. */
            return cell(typeof v === "boolean" ? (v ? "да" : "нет") : v);
        }).join(";");
    });
    /* Разделитель — точка с запятой, в начале BOM: Excel с русской локалью иначе читает
       запятую как десятичный знак, а без BOM показывает кириллицу кракозябрами. */
    var blob = new Blob(["\ufeff" + [head].concat(body).join("\r\n")],
        { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "templates-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
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
var LIST_SORT_LABELS = { channel: 'Канал', is_la: 'Live Activity', code: 'Code / ID', name: 'Название', product: 'Продукт', touch: 'Touch point', trigger: 'Trigger', partner: 'Партнёр', active: 'Статус' };
function listSortBy(col) {
    if (LIST_SORT.col === col) LIST_SORT.dir = -LIST_SORT.dir;
    else LIST_SORT = { col: col, dir: 1 };
    fetchListPage(true);   // сортирует сервер по всей выборке — тянем страницу заново
}

/* ---------- inline-редактирование ячеек списка ----------
   Перерисовываем только текущую страницу: за новыми данными на сервер не ходим,
   иначе открытие карандаша сбрасывало бы уже загруженные строки и позицию прокрутки. */
var LIST_EDIT = null;   /* { id, k } */

/* Справочники для колонок с edit:'combo'. Тянем по одному разу и только когда
   карандаш действительно открыли: список шаблонов грузится всем, а справочник
   нужен единицам. Пока не приехал — поле работает как обычный ввод. */
var LIST_DICT = { partner: null };
var LIST_DICT_LOADERS = { partner: function(){ return CRM.dictPartners(); } };
var LIST_DICT_REQ = {};
function listEnsureDict(name){
    var load = LIST_DICT_LOADERS[name];
    if (!load || LIST_DICT[name] !== null || LIST_DICT_REQ[name] || !window.CRM) return;
    LIST_DICT_REQ[name] = true;
    load().then(function(list){
        LIST_DICT[name] = list || [];
        if (LIST_EDIT) renderTemplateList(ALL_TEMPLATES);   /* дорисуем открытую ячейку */
    }).catch(function(){ LIST_DICT[name] = []; });
}

function listCellEdit(id, k){
    if (!(window.CRM && CRM.can && CRM.can('edit', 'templates', 'admin'))) return;
    var col = LIST_COLUMNS.find(function(c){ return c.k === k; });
    if (col && col.dict) listEnsureDict(col.dict);
    LIST_EDIT = { id: id, k: k }; renderTemplateList(ALL_TEMPLATES);
}
function listCellCancel(){ LIST_EDIT = null; renderTemplateList(ALL_TEMPLATES); }
function listCellSave(id, k){
    var wrap = document.querySelector('#templateListBody .sf-cell-edit[data-id="' + id + '"]');
    if (!wrap) return;
    var inp = wrap.querySelector('input, select');
    var col = LIST_COLUMNS.find(function(c){ return c.k === k; });
    var val = (col && col.edit === 'bool') ? inp.checked : inp.value;
    if (k === 'code' && val !== '' && !isNaN(Number(val))) val = Number(val);

    var li = (ALL_TEMPLATES || []).find(function(x){ return x.id === id; });
    if (!li) return;
    var prevChannel = li.channel, prevCode = li.code;
    li[k] = val;
    LIST_EDIT = null;
    renderTemplateList(ALL_TEMPLATES);

    /* правка уходит на бэкенд: тянем шаблон целиком, меняем поле и сохраняем */
    CRM.getTemplate(prevChannel, prevCode)
        .then(function(dto){
            var v1 = CRM.dtoToV1(dto);
            var v1k = LIST_TO_V1[k] || k;
            var прежнееИмя = v1.comname;
            v1[v1k] = val;
            if (k === 'code' && v1.channel === 'email') v1.letteros_id = val;
            /* Имя коммуникации входит в campaign_name — поменяли имя, пересчитываем
               и его, иначе в source_type осталось бы старое, и два поля разошлись бы.
               Карточка на сохранении делает ровно это же (sfdRecalcNames). */
            if (v1k === 'comname' && v1.comname !== прежнееИмя
                && typeof sfdComputeCampaignName === 'function'){
                var src = sfdComputeCampaignName(v1);
                if (src) v1.source = src;
            }
            window.CRM_CURRENT = { channel: prevChannel, code: prevCode };
            return CRM.saveFromV1(v1);
        })
        .then(function(){ if (typeof refreshViewTemplateSelect === 'function') refreshViewTemplateSelect(); })
        .catch(function(err){
            console.error('Не удалось сохранить правку списка:', err);
            li[k] = k === 'channel' ? prevChannel : (k === 'code' ? prevCode : li[k]);
            alert(sfdT('Не удалось сохранить изменение на сервере. Значение возвращено.'));
            renderTemplateList(ALL_TEMPLATES);
        });
}

/* Отрисовка списка (формат Salesforce list view). templates — накопленный набор загруженных
   строк (растёт по мере прокрутки). Порядок и состав задаёт сервер, здесь только рисуем. */
function renderTemplateList(templates) {
    const tbody = document.getElementById('templateListBody');
    if (!tbody) return;

    // порядок задаёт сервер (сортировка идёт по всей выборке, а не по загруженным строкам)
    const sorted = templates || [];
    const cols = listVisibleCols();

    /* шапка таблицы строится по настройке отображаемых полей */
    const thead = document.getElementById('templateListHead');
    if (thead) {
        thead.innerHTML = '<tr>' +
            '<th class="sf-check-col"><input type="checkbox" onclick="this.closest(\'table\').querySelectorAll(\'tbody input[type=checkbox]\').forEach(c=>c.checked=this.checked)"></th>' +
            cols.map(c => `<th class="sf-sortable" data-col="${c.k}" onclick="listSortBy('${c.k}')">${sfdT(c.label)} <span class="sf-sort">${c.k === LIST_SORT.col ? (LIST_SORT.dir === 1 ? '▲' : '▼') : ''}</span></th>`).join('') +
            '<th></th></tr>';
    }

    writeListStats(sorted.length);

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${cols.length + 2}" style="text-align: center; padding: 30px; color: #888;">${sfdT('Нет шаблонов по заданным фильтрам')}</td></tr>`;
        return;
    }

    /* ячейка: просмотр (значение + карандаш) либо правка (поле + ✓ / ✕) */
    function cellHtml(tpl, c) {
        const editing = LIST_EDIT && LIST_EDIT.id === tpl.id && LIST_EDIT.k === c.k;
        if (editing) {
            let input;
            if (c.edit === 'bool') {
                input = `<input type="checkbox" ${tpl[c.k] ? 'checked' : ''}>`;
            } else if (c.edit === 'select') {
                input = `<select>${c.opts.map(o => `<option value="${o}" ${String(tpl[c.k] || '') === o ? 'selected' : ''}>${o ? (CH_LABELS[o] || o) : '—'}</option>`).join('')}</select>`;
            } else if (c.edit === 'combo') {
                /* нативный input + datalist: и выбрать из справочника, и вписать своё.
                   Текущее значение подмешиваем в список — иначе снятое из справочника
                   значение не предложилось бы обратно. */
                const dlId = 'list-dl-' + c.k;
                const cur = tpl[c.k] == null ? '' : String(tpl[c.k]);
                const opts = (LIST_DICT[c.dict] || []).slice();
                if (cur && opts.indexOf(cur) === -1) opts.unshift(cur);
                input = `<input type="text" list="${dlId}" value="${sfdEsc(cur)}">` +
                        `<datalist id="${dlId}">${opts.map(o => `<option value="${sfdEsc(o)}"></option>`).join('')}</datalist>`;
            } else {
                input = `<input type="text" value="${sfdEsc(tpl[c.k] == null ? '' : tpl[c.k])}">`;
            }
            return `<td class="sf-cell"><div class="sf-cell-edit" data-id="${tpl.id}">${input}
                <button class="sf-cell-ok" title="${sfdT('Применить')}" onclick="listCellSave('${tpl.id}','${c.k}')">✓</button>
                <button class="sf-cell-no" title="${sfdT('Отменить')}" onclick="listCellCancel()">✕</button></div></td>`;
        }
        let view;
        if (c.k === 'channel') {
            /* Live Activity показываем как Push (и бейджем тоже): для человека это один
               канал, а отличие видно в колонке «Live Activity». tpl.channel не трогаем. */
            const shownCh = tpl.channel === 'la' ? 'push' : tpl.channel;
            view = `<span class="channel-badge channel-${shownCh}">${CH_LABELS[shownCh] || shownCh}</span>`;
        } else if (c.k === 'is_la') {
            view = tpl.is_la
                ? `<span class="status-active">● ${sfdT('да')}</span>`
                : `<span class="v empty">—</span>`;
        } else if (c.edit === 'bool') {
            view = `<span class="${tpl[c.k] ? 'status-active' : 'status-inactive'}">${tpl[c.k] ? '● ' + sfdT('активный') : '○ ' + sfdT('неактивный')}</span>`;
        } else if (c.link) {
            view = `<button class="sf-link" onclick="viewFromList('${tpl.id}')">${sfdEsc(tpl[c.k])}</button>`;
        } else {
            view = sfdEsc(tpl[c.k]);
        }
        /* карандаш inline-правки — только при праве edit на шаблоны (admin/templates)
           и только у правимых колонок (ro:true — вычисляемые, как «Live Activity»);
           без него ячейка остаётся на просмотр, сервер правку всё равно отбил бы */
        const canEdit = !c.ro && !!(window.CRM && CRM.can && CRM.can('edit', 'templates', 'admin'));
        const pen = canEdit ? `<button class="sf-cell-pen" title="${sfdT('Редактировать')}" onclick="listCellEdit('${tpl.id}','${c.k}')"><svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg></button>` : '';
        /* data-label: на узком экране шапка таблицы скрыта, и название колонки
           подставляется в ячейку через ::before (см. section-admin.css) */
        return `<td class="sf-cell" data-label="${sfdEsc(sfdT(c.label))}">${view}${pen}</td>`;
    }

    tbody.innerHTML = sorted.map(tpl => `
            <tr>
                <td class="sf-check-col"><input type="checkbox"></td>
                ${cols.map(c => cellHtml(tpl, c)).join('')}
                <td><button class="sf-row-menu" title="${sfdT('Открыть настройки шаблона')}" onclick="viewFromList('${tpl.id}')">${sfdT('Просмотр')}</button></td>
            </tr>
        `).join('');

    /* фокус в поле правки + Enter/Esc */
    const editWrap = tbody.querySelector('.sf-cell-edit');
    if (editWrap && LIST_EDIT) {
        const inp = editWrap.querySelector('input, select');
        if (inp) {
            inp.focus();
            inp.onkeydown = ev => {
                if (ev.key === 'Enter') listCellSave(LIST_EDIT.id, LIST_EDIT.k);
                if (ev.key === 'Escape') listCellCancel();
            };
        }
    }
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

/* Отрисовка выбранного шаблона карточкой (SF Details).

   Карточка живёт в той же секции, что и реестр: #sec-admin переключается в режим view.
   Раньше здесь открывался отдельный пункт «Просмотр настроек», и после его удаления
   openSection по несуществующему пункту уводил на обзор группы «Управление
   коммуникациями» — вместо карточки человек попадал на список разделов. */
function showTemplateInViewer(templateId, data) {
    if (!data) return;
    /* Если карточку открыли не из реестра (секция не на экране) — сначала откроем
       раздел со списком, иначе переключать режим было бы нечему. */
    var host = document.getElementById('sec-admin');
    if ((!host || host.offsetParent === null) && typeof openSection === 'function') {
        openSection('entities', 'ent-template');
    }
    if (typeof setAdminMode === 'function') setAdminMode('view');
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
    applyListFilterVisibility();   // прячем фильтры, снятые в «Настройке списка»
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
