/* Мастер коммуникаций (#sec-admin), формы каналов: вкладки SMS/Push/Email/КЦ,
   подсказки полей, автогенерация communication_name и campaign_name (правила v2),
   редактируемые выпадающие списки, загрузка/поиск шаблона.
   Сохранение и карточка просмотра — в template-details.js, витрина — в template-list.js. */
function openTab(id, el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.form').forEach(f => f.classList.remove('active'));
    el.classList.add('active');
    document.getElementById(id).classList.add('active');
    // Переход на вкладку создания канала = новый шаблон: сбрасываем контекст редактирования,
    // чтобы сохранение пошло как INSERT, а не UPDATE ранее открытого шаблона.
    if (id === 'sms' || id === 'push' || id === 'email' || id === 'cc' || id === 'fa' || id === 'vk' || id === 'la') {
        window.CRM_CURRENT = null;
    }
    if (id === 'dashboard' && DASHBOARD_DATA && Object.keys(DASHBOARD_DATA).length) {
        renderPerUserByChannel();
        renderOverheatIndicator();
        renderActiveAudience();
    }
}

/* Подсказки для полей */
var FIELD_HELP_POPUP = null;

/* Подсказки полей мастера: ключ — подпись поля в нижнем регистре (поиск регистронезависимый). */
var FIELD_HELP_TEXTS = {
    'code': 'Уникальный код шаблона коммуникации (SMS, Push, КЦ).',
    'brief': 'Краткое описание. Автоматически совпадает с Touch point.',
    'name': 'Название. Автоматически совпадает с Communication name.',
    'message text': 'Текст сообщения для SMS или Push. Для цепочки задаётся построчно в таблице дней.',
    'sender name': 'SMS: отправитель (Banki.ru или Bamm.ru). Email: имя отправителя.',
    'sender email': 'Адрес отправителя письма. Автоподстановка: service → no-reply@, info → inform@, renewal → renewal@, trigger → offers@, promo → advice@.',
    'trigger type': 'Тип рассылки: promo (промо) или trigger (триггерная). promo — в конце Campaign Name дата ddmmyy; trigger — Sending Day как «Nday».',
    'sender type': 'Тип рассылки: promo или trigger. Определяет формулу Campaign Name (дата для promo, день для trigger).',
    'product type': 'Продукт (credits, creditcards, deposits и др.). Попадает в Campaign Name и достраивает Communication Name.',
    'partner name': 'Партнёр. В promo попадает в Campaign Name; для базы «out-trigger-» достраивает Communication Name.',
    'touch point': 'Точка касания: abandoned-form, sign, renewal, issue и др. Определяет Brief.',
    'sending day': 'День отправки (для trigger). Подставляется в Campaign Name как «Nday». Для шаблона цепочки — день шага.',
    'campaign name': 'Собирается автоматически. promo: канал_promo_продукт_партнёр_comname_ддммгг. trigger: канал_trigger_продукт_comname_Nday. При флаге CallCenter канал заменяется на contact.',
    'communication name': 'Имя коммуникации: база (из списка или вручную) + продукт + флаги: marketplace- впереди; -cross, -dialog, -loyalty, -nr, -news, -mobile-app в конце.',
    'business communication type': 'Тип: adv (реклама), info (информация), service (сервис). Для Email влияет на адрес отправителя.',
    'communication tunnel': 'Туннель коммуникации (Email): к какой цепочке/потоку писем относится шаблон.',
    'landing page': 'Посадочная страница, на которую ведёт письмо.',
    'letteros id': 'Идентификатор письма в системе Letteros (Email). Является кодом email-шаблона.',
    'subject': 'Тема письма (Email).',
    'title text': 'Заголовок push-уведомления.',
    'deep link': 'Диплинк — переход в раздел мобильного приложения (Push).',
    'webview link': 'Ссылка веб-вью, открывается внутри приложения (Push).',
    'source system': 'Исходная система для КЦ (CRM, Billing и др.).',
    'segment': 'Код сегмента для КЦ — бизнес-ключ записи в справочнике сегментов.',
    'segment descr': 'Описание сегмента для КЦ.',
    'host id': 'Host Id — идентификатор хоста для выгрузки сегмента КЦ.',
    'kvint campaign id': 'Идентификатор кампании в Kvint (робот-обзвон КЦ).',
    'active': 'Шаблон активен и участвует в рассылках.',
    'active flag': 'Шаблон активен и участвует в рассылках.',
    'is chain': 'Цепочка: укажи дни, сгенерируй таблицу — на каждый день при сохранении создаётся отдельный шаблон со своим Campaign Name (по дню).',
    'дни цепочки — числа через запятую/пробел': 'Дни шагов цепочки (например 0, 3, 7). По кнопке «Сгенерировать строки» появится таблица — заполни контент каждого шага.',
    'sms callcenter': 'Флаг КЦ: Campaign Name строится как contact_… (канал заменяется на contact).',
    'email callcenter': 'Флаг КЦ: Campaign Name строится как contact_… (канал заменяется на contact).',
    'cross': 'Кросс-коммуникация. При включении в Communication Name добавляется суффикс -cross (уходит и в Campaign Name).',
    'marketplace': 'Продукт маркетплейса. В Communication Name добавляется префикс marketplace-.',
    'dialog': 'Ведёт на страницу диалога. Суффикс -dialog в Communication Name.',
    'loyalty': 'Ссылка ведёт на продукты лояльности. Суффикс -loyalty в Communication Name.',
    'national rating': 'Народный рейтинг. Суффикс -nr в Communication Name.',
    'news': 'Новостная рассылка. Суффикс -news в Communication Name.',
    'mobile app': 'Шаблон ведёт на скачивание мобильного приложения. Суффикс -mobile-app в Communication Name.',
    'night send': 'Разрешена отправка коммуникации ночью.',
    'aff_sub3': 'Метка aff_sub3 для партнёрской аналитики.',
    'communication_type': 'Тип коммуникации: adv, service.',
    'канал': 'Канал шаблона: SMS, Push, Email или КЦ.',
    'продукт': 'Фильтр по типу продукта.',
    'статус': 'Фильтр по статусу шаблона: активные / неактивные.',
    'выберите шаблон из списка или введите code / letteros id': 'Поиск шаблона для просмотра настроек: выбери из списка или введи код (для Email — Letteros ID).',
    'режим просмотра': 'Общая статистика по всем коммуникациям или разрез по конкретному шаблону.',
    'выберите шаблон': 'Шаблон, по которому показать статистику отправок.',
    'доп. флаги': 'Дополнительные флаги. Горизонтали: marketplace, dialog, loyalty, national_rating, news. Настроечные: night_send, mobile_app, cross. В режиме просмотра недоступны до нажатия «Редактировать».',
    'горизонтали': 'Флаги горизонталей: marketplace, dialog, loyalty, national_rating, news. Влияют на Communication Name (marketplace-, -dialog, -loyalty, -nr, -news).',
    'настроечные': 'Настроечные флаги: night_send (ночная отправка), mobile_app (-mobile-app), cross (-cross).'
};

function getFieldHelpKey(labelEl) {
    var t = (labelEl && labelEl.textContent || '').trim();
    if (t.indexOf('(') >= 0) t = t.substring(0, t.indexOf('(')).trim();
    return t.toLowerCase();
}

function showFieldHelp(el) {
    if (!el || !el.getAttribute('data-help')) return;
    var popup = document.getElementById('fieldHelpPopup');
    if (!popup) return;
    popup.textContent = el.getAttribute('data-help');
    popup.style.display = 'block';
    var r = el.getBoundingClientRect();
    var pr = popup.getBoundingClientRect();
    var left = r.left;
    var top = r.bottom + 6;
    if (top + pr.height > window.innerHeight) top = r.top - pr.height - 6;
    if (left + pr.width > window.innerWidth) left = window.innerWidth - pr.width - 10;
    if (left < 10) left = 10;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
}

function hideFieldHelp() {
    var popup = document.getElementById('fieldHelpPopup');
    if (popup) popup.style.display = 'none';
}

/* Подсказки к полям — значок (i) с тултипом при наведении, как на странице OneLink Builder. */
function makeInfoIcon(text) {
    var span = document.createElement('span');
    span.className = 'info';
    span.tabIndex = 0;
    span.textContent = 'i';
    var tip = document.createElement('span');
    tip.className = 'tip';
    tip.textContent = text;
    span.appendChild(tip);
    return span;
}

function initFieldHelp() {
    // вся секция мастера: формы каналов, фильтры списка, просмотр настроек, дашборд
    var root = document.getElementById('sec-admin') || document;
    root.querySelectorAll('.field').forEach(function(field) {
        var label = field.querySelector('label');
        if (!label || label.querySelector('.info')) return;
        var key = getFieldHelpKey(label);
        var helpText = FIELD_HELP_TEXTS[key];
        if (!helpText && key.indexOf('доп. флаги') === 0) helpText = FIELD_HELP_TEXTS['доп. флаги'];
        if (helpText) label.appendChild(makeInfoIcon(helpText));
    });
    root.querySelectorAll('.flags-group-label').forEach(function(lbl) {
        if (lbl.querySelector('.info')) return;
        var h = FIELD_HELP_TEXTS[lbl.textContent.trim().toLowerCase()];
        if (h) lbl.appendChild(makeInfoIcon(h));
    });
}

function formatDateDDMMYY() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getFullYear()).slice(-2)}`;
}

/* Вкладка канала как в v2 (Tabs1.selectedTab.toLowerCase()): sms / mobile-push / email / cc. */
function channelTab(form) {
    var ch = (form.querySelector('.channel') && form.querySelector('.channel').value) || '';
    return ch.toLowerCase();
}
function isCallcenterOn(form) {
    var s = form.querySelector('.cb-sms-cc');
    var e = form.querySelector('.cb-email-cc');
    return !!((s && s.checked) || (e && e.checked));
}
/* campaign_name (source) строго по правилам v2 (generate*CampaignName).
   overrideDay — подстановка дня для строк цепочки. */
function computeCampaignName(form, overrideDay) {
    var val = function (cls) { var el = form.querySelector('.' + cls); return el ? (el.value || '') : ''; };
    var senderType = val('trigger');   // Sender Type: promo | trigger
    var product = val('product');
    var partner = val('partner');
    var comname = val('comname');
    var day = (overrideDay !== undefined && overrideDay !== '') ? String(overrideDay) : val('day');
    var date = formatDateDDMMYY();
    var channel = channelTab(form);
    if (channel === 'cc') {
        var segment = val('segment');
        if (senderType === 'trigger') return 'contact_' + senderType + '_' + product + '_' + comname + '_' + segment + '_' + day + 'day';
        if (senderType === 'promo')   return 'contact_' + senderType + '_' + product + '_' + partner + '_' + comname + '_' + date + 'day';
        return '';
    }
    var tab = isCallcenterOn(form) ? 'contact' : channel;   // sms | mobile-push | email | contact
    if (senderType === 'promo')   return tab + '_' + senderType + '_' + product + '_' + partner + '_' + comname + '_' + date;
    if (senderType === 'trigger') return tab + '_' + senderType + '_' + product + '_' + comname + '_' + day + 'day';
    return '';
}
function buildSource(el) {
    var form = el && el.closest('.form');
    if (!form) return;
    // сперва достраиваем communication_name по флагам (v2 generateCommunicationName), затем campaign_name от него
    var com = form.querySelector('.comname');
    if (com) updateComNameFromContext(com);
    var sourceEl = form.querySelector('.source');
    if (sourceEl) sourceEl.value = computeCampaignName(form, undefined);
    // email: адрес отправителя пересчитывается от trigger/touch/biz_type (алгоритм v2)
    if (form.id === 'email') updateEmailSenderName(el);
}

function syncComName(partnerInput) {
    const form = partnerInput.closest('.form');
    const com = form.querySelector('.comname');
    if (com) updateComNameFromContext(com);
}

/* Обновление communication_name: продукт (product) до или после "-" по месту дефиса + флаги */
function updateComNameFromContext(comnameInput) {
    const form = comnameInput.closest('.form');
    if (!form) return;
    const base = (comnameInput.getAttribute && comnameInput.getAttribute('data-comname-base')) || 'NoComName';
    const product = (form.querySelector('.product') && form.querySelector('.product').value) || '';
    const partner = (form.querySelector('.partner') && form.querySelector('.partner').value) || '';

    let basePart;
    if (base.startsWith('-')) {
        basePart = product ? (product + base) : base;
    } else if (base === 'out-trigger-') {
        basePart = 'out-trigger-' + partner;
    } else if (base.endsWith('-')) {
        basePart = product ? (base + product) : base;
    } else {
        basePart = base || 'NoComName';
    }
    // Флаги → communication_name (v2 generateCommunicationName): marketplace впереди,
    // затем cross / dialog / loyalty / nr / news / mobile-app.
    const on = (cls) => { const e = form.querySelector('.' + cls); return e && e.checked; };
    let v = (on('cb-marketplace') ? 'marketplace-' : '') + basePart;
    if (on('cb-cross')) v += '-cross';
    if (on('cb-dialog')) v += '-dialog';
    if (on('cb-loyalty')) v += '-loyalty';
    if (on('cb-national_rating')) v += '-nr';
    if (on('cb-news')) v += '-news';
    if (on('cb-mobile_app')) v += '-mobile-app';
    comnameInput.value = v;
    syncNameFromCom(comnameInput);
}

function syncNameFromCom(comEl) {
    const form = comEl.closest('.form');
    const nameEl = form && form.querySelector('.name');
    if (nameEl) nameEl.value = comEl.value;
}
function syncComFromName(nameEl) {
    const form = nameEl.closest('.form');
    const comEl = form && form.querySelector('.comname');
    if (comEl) { comEl.value = nameEl.value; if (comEl.setAttribute) comEl.setAttribute('data-comname-base', nameEl.value); updateComNameFromContext(comEl); }
}
function updateComnameFromCheckboxes(el) {
    const form = el.closest('.form');
    if (!form) return;
    const com = form.querySelector('.comname');
    if (com) updateComNameFromContext(com);
    const sourceEl = form.querySelector('.source');
    if (sourceEl) sourceEl.value = computeCampaignName(form, undefined);
}
function updateCheckboxesFromComname(comEl) {
    const form = comEl.closest('.form');
    if (!form) return;
    const v = (comEl.value || '');
    const set = (cls, cond) => { const e = form.querySelector('.' + cls); if (e) e.checked = cond; };
    set('cb-marketplace', v.startsWith('marketplace-'));
    set('cb-cross', v.includes('-cross'));
    set('cb-dialog', v.includes('-dialog'));
    set('cb-loyalty', v.includes('-loyalty'));
    set('cb-national_rating', v.includes('-nr'));
    set('cb-news', v.includes('-news'));
    set('cb-mobile_app', v.includes('-mobile-app'));
}
/* Ручной ввод communication_name: синхронизируем флаги и пересчитываем campaign_name
   (сам comname НЕ перестраиваем, чтобы не мешать вводу). */
function onComnameEdited(comEl) {
    updateCheckboxesFromComname(comEl);
    const form = comEl.closest('.form');
    if (!form) return;
    const sourceEl = form.querySelector('.source');
    if (sourceEl) sourceEl.value = computeCampaignName(form, undefined);
}
/* Sender Email — алгоритм generateEmail из v2 (порядок проверок как в исходнике):
   renewal → service → info → trigger+adv → promo+adv → newsletter. Формат: Банки.ру<email>. */
function updateEmailSenderName(el) {
    const form = el.closest('.form');
    if (!form || form.id !== 'email') return;
    const senderInput = form.querySelector('input.email_from');
    if (!senderInput) return;
    const bizType = (form.querySelector('select.biz_type') && form.querySelector('select.biz_type').value) || '';
    const touch = (form.querySelector('.touch') && form.querySelector('.touch').value) || '';
    const trigger = (form.querySelector('.trigger') && form.querySelector('.trigger').value) || '';
    let email;
    if (touch === 'renewal') email = 'renewal@email.banki.ru';
    else if (bizType === 'service') email = 'no-reply@email.banki.ru';
    else if (bizType === 'info') email = 'inform@email.banki.ru';
    else if (trigger === 'trigger' && bizType === 'adv') email = 'offers@email.banki.ru';
    else if (trigger === 'promo' && bizType === 'adv') email = 'advice@email.banki.ru';
    else email = 'newsletter@email.banki.ru';
    senderInput.value = 'Банки.ру<' + email + '>';
}

function toggleAbTestField(el) {
    const form = el.closest('.form');
    if (!form) return;
    const fieldWrap = form.querySelector('.ab-test-field');
    const countInput = form.querySelector('.ab-test-count');
    if (!fieldWrap || !countInput) return;
    if (el.checked) {
        fieldWrap.style.display = '';
        countInput.disabled = false;
    } else {
        fieldWrap.style.display = 'none';
        countInput.disabled = true;
        countInput.value = '';
    }
}

function toggleForCcBlock(btn) {
    const block = btn.closest('.for-cc-block');
    if (!block) return;
    const fields = block.querySelector('.for-cc-fields');
    if (!fields) return;
    fields.style.display = fields.style.display === 'none' ? '' : 'none';
}

/* Editable dropdown JS */
function showDropdown(input) {
    const dd = input.nextElementSibling;
    // Show all options when focusing
    Array.from(dd.children).forEach(div => {
        div.style.display = 'block';
    });
    dd.style.display = 'block';
}

function hideDropdown(input) {
    setTimeout(() => {
        input.nextElementSibling.style.display = 'none';
    }, 150);
}

function hideDropdownComname(input) {
    setTimeout(() => {
        input.nextElementSibling.style.display = 'none';
        if (!input.value || input.value.trim() === '') {
            input.value = 'NoComName';
            if (input.setAttribute) input.setAttribute('data-comname-base', 'NoComName');
        }
    }, 150);
}

function filterDropdown(input) {
    const dd = input.nextElementSibling;
    const filter = input.value.toLowerCase();
    Array.from(dd.children).forEach(div => {
        div.style.display = div.textContent.toLowerCase().includes(filter) ? 'block' : 'none';
    });
}

// Handle click on dropdown items
document.querySelectorAll('.dropdown-list div').forEach(div => {
    div.addEventListener('mousedown', e => {
        e.preventDefault();
        const input = div.closest('.editable-dropdown').querySelector('input');
        const selectedValue = div.textContent;

        if (input.classList.contains('comname')) {
            if (input.setAttribute) input.setAttribute('data-comname-base', selectedValue);
            updateComNameFromContext(input);
            updateCheckboxesFromComname(input);
        } else if (input.classList.contains('touch') || input.classList.contains('product')) {
            input.value = selectedValue;
            buildSource(input);
        } else {
            input.value = selectedValue;
        }
    });
});

/* Загрузка шаблона по ID */
function loadTemplate(templateId) {
    if (!templateId) {
        document.getElementById('settingsOutput').innerHTML = '';
        return;
    }
    // Полные данные всегда тянем с бэкенда (id в списке = "channel:code").
    if (ALL_TEMPLATES.some(function (t) { return t.id === templateId; })) {
        viewFromList(templateId);
        return;
    }
    document.getElementById('settingsOutput').innerHTML = '<p style="color: #e53935;">Шаблон не найден</p>';
}

/* Поиск шаблона по коду (Code / Letteros ID / Segment) — по данным бэкенда */
function searchTemplate() {
    const key = document.getElementById('searchKey').value.trim().toLowerCase();
    if (!key) return;
    var found = ALL_TEMPLATES.filter(function (t) {
        return String(t.code).toLowerCase() === key;
    });
    if (!found.length) {
        document.getElementById('settingsOutput').innerHTML = '<p style="color: #e53935;">Шаблон с кодом «' + key + '» не найден.</p>';
        return;
    }
    // Код уникален внутри канала, но может совпадать между каналами — берём первый,
    // остальные упоминаем подсказкой.
    viewFromList(found[0].id);
    if (found.length > 1) {
        setTimeout(function () {
            var out = document.getElementById('settingsOutput');
            if (!out) return;
            var note = document.createElement('p');
            note.style.color = '#f59e0b';
            note.textContent = 'Код найден в нескольких каналах: ' + found.map(function (t) { return t.channel; }).join(', ') + '. Показан ' + found[0].channel + '; остальные — через «Список шаблонов».';
            out.prepend(note);
        }, 300);
    }
}

/* Восстановление базы communication_name из сохранённого значения (для просмотра/редактирования) */
function inferComNameBase(comnameValue) {
    if (!comnameValue) return 'NoComName';
    if (comnameValue.startsWith('out-trigger-')) return 'out-trigger-';
    const suffixes = ['-cross', '-marketplace', '-nr', '-loyalty'];
    const found = suffixes.find(s => comnameValue.endsWith(s));
    return found || comnameValue || 'NoComName';
}
