/* ================== Просмотр настроек: карточка Salesforce Details ==================
   Заменяет старый рендер (клон формы канала + «Редактировать»): поля с карандашами,
   секции, inline-редактирование и предпросмотр SMS/Push/Email.
   Данные — v1-объект (CRM.dtoToV1), сохранение — CRM.updateTemplate.
   ==================================================================================== */
var SFD_STATE = null; /* { id, orig, work, editing:{}, pushOS } */
function sfdT(s){ return (typeof t === 'function') ? t(s) : s; }
function sfdEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

function renderTemplateDetails(data, templateId) {
    var work = Object.assign({}, data);
    /* флаг cross не хранится в БД отдельным полем — восстанавливаем из communication_name */
    if (work.cross == null) work.cross = !!(work.comname && String(work.comname).indexOf('-cross') !== -1);
    SFD_STATE = {
        id: templateId || null,
        orig: data,
        work: work,
        editing: {},
        pushOS: (SFD_STATE && SFD_STATE.pushOS) || 'ios'
    };
    sfdRender();
}

/* ---------- пересчёт имён: чистые копии наших правил нейминга ----------
   communication_name — зеркало updateComNameFromContext, campaign_name — зеркало
   computeCampaignName. DOM-версии работают от форм мастера и СОХРАНЕНЫ (мастер
   использует их через buildSource); здесь — «безформенные» дубли от объекта d,
   чтобы inline-правки в карточке пересчитывали имена без скрытых форм. */
function sfdStripComnameFlags(v){
    v = String(v == null ? '' : v).trim();
    if (v.indexOf('marketplace-') === 0) v = v.slice('marketplace-'.length);
    var sufs = ['-cross','-dialog','-loyalty','-nr','-news','-mobile-app'];
    var changed = true;
    while (changed){
        changed = false;
        for (var i = 0; i < sufs.length; i++){
            var s = sufs[i];
            if (v.length > s.length && v.slice(-s.length) === s){ v = v.slice(0, -s.length); changed = true; break; }
        }
    }
    return v || 'NoComName';
}
function sfdComputeComname(d){
    var b = sfdStripComnameFlags(d.comname);
    /* база out-trigger- достраивается партнёром (правило updateComNameFromContext) */
    if (b.indexOf('out-trigger-') === 0) b = 'out-trigger-' + (d.partner || '');
    var v = (d.marketplace ? 'marketplace-' : '') + (b || 'NoComName');
    if (d.cross) v += '-cross';
    if (d.dialog) v += '-dialog';
    if (d.loyalty) v += '-loyalty';
    if (d.national_rating) v += '-nr';
    if (d.news) v += '-news';
    if (d.mobile_app) v += '-mobile-app';
    return v;
}
function sfdComputeCampaignName(d){
    var senderType = d.trigger;
    if (senderType !== 'promo' && senderType !== 'trigger') return '';
    var product = d.product || '', partner = d.partner || '', comname = d.comname || '', day = d.day || '';
    var date = (typeof formatDateDDMMYY === 'function') ? formatDateDDMMYY() : '';
    if (d.channel === 'cc'){
        var segment = (d.segment != null && d.segment !== '') ? d.segment : (d.code || '');
        if (senderType === 'trigger') return 'contact_' + senderType + '_' + product + '_' + comname + '_' + segment + '_' + day + 'day';
        return 'contact_' + senderType + '_' + product + '_' + partner + '_' + comname + '_' + date + 'day';
    }
    /* канал в campaign_name — как в формах мастера (hidden .channel): push пишется как mobile-push */
    var chTab = ({ sms:'sms', push:'mobile-push', 'mobile-push':'mobile-push', email:'email' })[d.channel] || d.channel;
    /* контекст «выгрузка в КЦ» (cb-sms-cc / cb-email-cc) отдельным полем не хранится —
       восстанавливаем из сохранённого campaign_name (префикс contact_) */
    var tab = /^contact_/.test(d.source || '') ? 'contact' : chTab;
    if (senderType === 'promo') return tab + '_' + senderType + '_' + product + '_' + partner + '_' + comname + '_' + date;
    return tab + '_' + senderType + '_' + product + '_' + comname + '_' + day + 'day';
}
var SFD_NAME_KEYS = { trigger:1, product:1, partner:1, comname:1, day:1, segment:1,
    marketplace:1, cross:1, dialog:1, loyalty:1, national_rating:1, news:1, mobile_app:1 };
function sfdRecalcNames(){
    var st = SFD_STATE; if (!st) return;
    var d = st.work;
    d.comname = sfdComputeComname(d);
    var src = sfdComputeCampaignName(d);
    if (src) d.source = src;
    /* email: сервисные флаги следуют за типом коммуникации (правило collectFormData) */
    if (d.channel === 'email'){
        d.service_flag = d.biz_type === 'service';
        d.info_flag = d.biz_type === 'info';
    }
}

/* ---------- поля карточки по каналам (реальные поля наших форм + dtoToV1; preheader у нас нет) ---------- */
function sfdFieldDefs(d){
    var ch = d.channel;
    var isEmail = ch === 'email', isCC = ch === 'cc', isPush = (ch === 'push' || ch === 'mobile-push'), isSms = ch === 'sms';
    var isFa = ch === 'fa', isVk = ch === 'vk', isLa = ch === 'la';
    var content = [];
    if (isEmail){
        content.push({ k:'subject', label:'Subject', wide:true });
        content.push({ k:'email_from', label:'Email from' });
        content.push({ k:'letteros_id', label:'Letteros ID' });
    } else if (!isCC){
        content.push({ k:'message', label:'Message text', wide:true, type:'textarea' });
        if (isPush) content.push({ k:'title', label:'Title' });
        if (isSms) content.push({ k:'sender_name', label:'Sender name', type:'select', opts:['','Banki.ru','Bamm.ru'] });
    }
    if (isPush){
        content.push({ k:'deeplink', label:'Deep link', wide:true });
        content.push({ k:'webview', label:'Webview link', wide:true });
    }
    if (isFa){
        content.push({ k:'fa_id', label:'FA ID' });
        content.push({ k:'channel_id', label:'Channel ID' });
        content.push({ k:'need_push', label:'Need push', type:'bool' });
        content.push({ k:'c2d_transport', label:'C2D transport' });
        content.push({ k:'c2d_account', label:'C2D account' });
        content.push({ k:'ch2d_operator_id', label:'CH2D operator ID' });
        content.push({ k:'deeplink', label:'Deep link', wide:true });
        content.push({ k:'webview', label:'Webview link', wide:true });
        content.push({ k:'web_url', label:'Web URL', wide:true });
        content.push({ k:'link_title', label:'Link title' });
        content.push({ k:'action_buttons', label:'Action buttons (JSON)', wide:true, type:'textarea' });
    }
    if (isVk){
        content.push({ k:'vk_template_name', label:'VK template name' });
        content.push({ k:'ttl', label:'TTL' });
        content.push({ k:'ab_group', label:'AB group' });
        content.push({ k:'buttons', label:'Buttons (JSON)', wide:true, type:'textarea' });
    }
    if (isLa){
        content.push({ k:'activity_name', label:'Activity name' });
        content.push({ k:'la_event', label:'LA event' });
        content.push({ k:'la_visualization', label:'LA visualization' });
        content.push({ k:'la_status', label:'LA status' });
        content.push({ k:'current_step', label:'Current step' });
        content.push({ k:'title', label:'Title' });
        content.push({ k:'deeplink', label:'Deep link', wide:true });
        content.push({ k:'webview', label:'Webview link', wide:true });
        content.push({ k:'action_buttons', label:'Action buttons (JSON)', wide:true, type:'textarea' });
        content.push({ k:'la_visualization_attributes', label:'LA visualization attributes (JSON)', wide:true, type:'textarea' });
    }
    var segRows = [
        { k:'source', label:'Source_type (campaign_name)', wide:true, ro:true, fmt:function(){ return SFD_STATE.work.source; } },
        { k:'trigger', label:'Trigger type', type:'select', opts:['','promo','trigger'] },
        { k:'product', label:'Product type' },
        { k:'partner', label:'Partner name' },
        { k:'touch', label:'Touch point' },
        { k:'day', label:sfdT('День отправки') }
    ];
    if (isCC){
        segRows.push({ k:'segment', label:sfdT('Сегмент'), ro:true });
        segRows.push({ k:'segment_desc', label:sfdT('Описание сегмента') });
        segRows.push({ k:'source_system', label:'Source system' });
        segRows.push({ k:'host_id', label:'Host Id' });
        segRows.push({ k:'kvint', label:'Kvint campaign Id' });
    }
    var secs = [
        { sec:'Основное', rows:[
            { k:'channel', label:sfdT('Канал'), ro:true, fmt:function(v){ return ({sms:'SMS',push:'Push','mobile-push':'Push',email:'Email',cc:'КЦ',fa:'FA',vk:'VK',la:'Live Activity'})[v] || v; } },
            { k:'code', label:'Code', ro:true },
            { k:'active', label:sfdT('Статус'), type:'bool' },
            { k:'comname', label:'communication_name', wide:true, fmt:function(){ return SFD_STATE.work.comname; } }
        ]},
        { sec:'Источник и сегментация', rows:segRows }
    ];
    if (content.length) secs.push({ sec:'Контент и ссылки', rows:content });
    secs.push({ sec:'Служебные параметры и флаги', rows:[
        { k:'communication_type', label:'communication_type' },
        { k:'biz_type', label:'Business communication type', type:'select', opts:['','adv','info','service'] },
        { k:'aff_sub3', label:'aff_sub3' },
        { k:'marketplace', label:'marketplace', type:'bool' },
        { k:'cross', label:'cross', type:'bool' },
        { k:'dialog', label:'dialog', type:'bool' },
        { k:'loyalty', label:'loyalty', type:'bool' },
        { k:'national_rating', label:'national_rating', type:'bool' },
        { k:'news', label:'news', type:'bool' },
        { k:'mobile_app', label:'mobile_app', type:'bool' },
        { k:'night_send', label:'night_send', type:'bool' }
    ]});
    return secs;
}

function sfdRowHtml(f){
    var st = SFD_STATE, d = st.work;
    var raw = f.fmt ? f.fmt(d[f.k]) : d[f.k];
    var editing = !!st.editing[f.k];
    var valHtml;
    if (editing){
        if (f.type === 'bool'){
            valHtml = '<input type="checkbox" class="sfd-edit-check" data-k="' + f.k + '"' + (d[f.k] ? ' checked' : '') + '>';
        } else if (f.type === 'select'){
            valHtml = '<select class="sfd-edit" data-k="' + f.k + '">' + f.opts.map(function(o){
                return '<option value="' + o + '"' + (String(d[f.k] || '') === o ? ' selected' : '') + '>' + (o || '—') + '</option>';
            }).join('') + '</select>';
        } else if (f.type === 'textarea'){
            valHtml = '<textarea class="sfd-edit" data-k="' + f.k + '">' + sfdEsc(d[f.k] == null ? '' : d[f.k]) + '</textarea>';
        } else {
            valHtml = '<input type="text" class="sfd-edit" data-k="' + f.k + '" value="' + sfdEsc(d[f.k] == null ? '' : d[f.k]) + '">';
        }
    } else if (f.type === 'bool'){
        valHtml = '<span class="v">' + (d[f.k] ? '<span class="flag-on">✓ ' + sfdT('да') + '</span>' : '<span class="flag-off">— ' + sfdT('нет') + '</span>') + '</span>';
    } else {
        valHtml = (raw === undefined || raw === null || raw === '')
            ? '<span class="v empty">—</span>'
            : '<span class="v">' + sfdEsc(raw) + '</span>';
    }
    var pen = (!f.ro && !editing)
        ? '<button class="sfd-pen" data-k="' + f.k + '" title="' + sfdT('Редактировать') + '" aria-label="' + sfdT('Редактировать') + '">' +
          '<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>'
        : '';
    return '<div class="sfd-row' + (f.wide ? ' wide' : '') + (editing ? ' editing' : '') + '">' +
        '<div class="l">' + sfdEsc(f.label) + '</div>' + valHtml + pen + '</div>';
}

function sfdRender(){
    var st = SFD_STATE;
    if (!st) return;
    var output = document.getElementById('settingsOutput');
    if (!output) return;
    var d = st.work;
    var chLabels = { sms:'SMS', push:'Push', 'mobile-push':'Push', email:'Email', cc:'КЦ', fa:'FA', vk:'VK', la:'Live Activity' };
    var isEmail = d.channel === 'email';
    var mainId = isEmail
        ? (d.letteros_id != null && d.letteros_id !== '' ? d.letteros_id : d.code)
        : (d.code != null && d.code !== '' ? d.code : d.letteros_id);
    var dirty = Object.keys(st.editing).length > 0;
    var secs = sfdFieldDefs(d);

    output.innerHTML =
        '<div class="sfd-top"><button type="button" class="sf-btn" onclick="openSection(\'comms\',\'templates\')">' + sfdT('← К списку шаблонов') + '</button></div>' +
        '<div class="sfd-layout"><div class="sfd">' +
        '<div class="sfd-head">' +
            '<span class="sfd-ch">' + sfdEsc(chLabels[d.channel] || d.channel) + '</span>' +
            '<b>' + sfdEsc(mainId == null ? '' : mainId) + ' — ' + sfdEsc(d.comname || '') + '</b>' +
            '<span class="sfd-status ' + (d.active ? 'on' : 'off') + '">' + sfdT(d.active ? 'АКТИВНЫЙ' : 'НЕАКТИВНЫЙ') + '</span>' +
        '</div>' +
        secs.map(function(s){
            return '<div class="sfd-sec"><div class="sfd-sec-title" onclick="this.parentElement.classList.toggle(\'closed\')">' + sfdEsc(sfdT(s.sec)) + '</div>' +
                '<div class="sfd-grid">' + s.rows.map(sfdRowHtml).join('') + '</div></div>';
        }).join('') +
        (dirty ? '<div class="sfd-footer">' +
            '<button type="button" class="sf-btn accent" id="sfdSaveBtn">' + sfdT('Сохранить') + '</button>' +
            '<button type="button" class="sf-btn" id="sfdCancelBtn">' + sfdT('Отменить') + '</button>' +
        '</div>' : '') +
        '</div><div class="sfd-side" id="sfdSide"></div></div>';

    /* карандаши: включают редактирование поля */
    output.querySelectorAll('.sfd-pen').forEach(function(btn){
        btn.onclick = function(){
            st.editing[btn.dataset.k] = true;
            sfdRender();
            var inp = document.querySelector('#settingsOutput .sfd-edit[data-k="' + btn.dataset.k + '"], #settingsOutput .sfd-edit-check[data-k="' + btn.dataset.k + '"]');
            if (inp) inp.focus();
        };
    });
    /* редактируемые поля: изменения пишутся в рабочую копию; поля, влияющие на имена,
       пересчитывают communication_name / campaign_name по нашим правилам нейминга */
    output.querySelectorAll('.sfd-edit, .sfd-edit-check').forEach(function(inp){
        var handler = function(){
            var k = inp.dataset.k;
            st.work[k] = inp.type === 'checkbox' ? inp.checked : inp.value;
            if (SFD_NAME_KEYS[k] || k === 'biz_type') sfdRecalcNames();
            sfdRenderPreview();
        };
        inp.addEventListener('input', handler);
        /* чекбоксы и селекты: после change перерисовываем карточку,
           чтобы пересчитанные comname/source сразу были видны */
        inp.addEventListener('change', function(){
            handler();
            if (inp.type === 'checkbox' || inp.tagName === 'SELECT') sfdRender();
        });
    });
    var saveBtn = document.getElementById('sfdSaveBtn');
    if (saveBtn) saveBtn.onclick = sfdSave;
    var cancelBtn = document.getElementById('sfdCancelBtn');
    if (cancelBtn) cancelBtn.onclick = function(){
        /* отмена: сбрасываем правки и возвращаемся к этому же шаблону в режиме просмотра */
        renderTemplateDetails(st.orig, st.id);
    };
    sfdRenderPreview();
}

/* Сохранение карточки: v1-объект → v1ToDto → PUT /api/templates/{channel}/{code};
   после успеха перезагружаем детали с бэка и обновляем ALL_TEMPLATES (loadMockData). */
function sfdSave(){
    var st = SFD_STATE;
    if (!st) return;
    sfdRecalcNames();
    var d = Object.assign({}, st.work);
    var channel = d.channel;
    var code = (st.orig.code != null && st.orig.code !== '') ? st.orig.code : d.code;
    var dto = CRM.v1ToDto(d);
    window.CRM_CURRENT = { channel: channel, code: code };
    CRM.updateTemplate(channel, code, dto).then(function () {
        var newCode = dto.code != null ? dto.code : code;
        alert('Шаблон сохранён.\ncommunication_name: ' + (d.comname || '') + '\nCode: ' + newCode);
        return CRM.getTemplate(channel, newCode)
            .then(function (fresh) { return CRM.dtoToV1(fresh); })
            .catch(function () { return d; });
    }).then(function (v1) {
        if (!v1) return;
        var newId = channel + ':' + (v1.code != null && v1.code !== '' ? v1.code : code);
        renderTemplateDetails(v1, newId);
        if (typeof loadMockData === 'function') {
            loadMockData().then(function () {
                if (typeof applyFilters === 'function' && document.getElementById('templateListBody')) applyFilters();
                var sel = document.getElementById('templateSelect');
                if (sel) sel.value = newId;
            });
        }
    }).catch(function (e) { alert('Ошибка сохранения: ' + (e && e.message ? e.message : e)); });
}

/* ---------- предпросмотр коммуникации ---------- */
function sfdSetPushOS(os){
    if (SFD_STATE){ SFD_STATE.pushOS = os; sfdRenderPreview(); }
}
function sfdRenderPreview(){
    var st = SFD_STATE;
    var side = document.getElementById('sfdSide');
    if (!st || !side) return;
    var d = st.work;
    var ch = d.channel === 'mobile-push' ? 'push' : d.channel;
    if (ch === 'cc'){ side.innerHTML = ''; return; }

    if (ch === 'sms'){
        side.innerHTML = '<div class="pv-card"><div class="pv-title">' + sfdT('Предпросмотр SMS') + '</div>' +
            '<div class="pv-phone"><div class="pv-sms-sender">' + sfdEsc(d.sender_name || 'Banki.ru') + '</div>' +
            '<div class="pv-sms-bubble">' + sfdEsc(d.message || '—') + '</div>' +
            '<div class="pv-sms-time">' + sfdT('сейчас') + '</div></div>' +
            '<div class="pv-note">' + sfdT('Пример отображения. Точный вид зависит от устройства и версии ОС.') + '</div></div>';
        return;
    }
    if (ch === 'push'){
        var os = st.pushOS;
        side.innerHTML = '<div class="pv-card"><div class="pv-title">' + sfdT('Предпросмотр Push') + '</div>' +
            '<div class="pv-os">' +
                '<button type="button" class="' + (os === 'ios' ? 'active' : '') + '" onclick="sfdSetPushOS(\'ios\')">iOS · 17</button>' +
                '<button type="button" class="' + (os === 'android' ? 'active' : '') + '" onclick="sfdSetPushOS(\'android\')">Android · 14</button>' +
            '</div>' +
            '<div class="pv-push ' + os + '">' +
                '<div class="pv-push-head"><span class="pv-push-appico"></span><span class="pv-push-app">Banki.ru</span><span class="pv-push-when">' + sfdT('сейчас') + '</span></div>' +
                '<div class="pv-push-title">' + sfdEsc(d.title || d.comname || '—') + '</div>' +
                '<div class="pv-push-body">' + sfdEsc(d.message || '—') + '</div>' +
            '</div>' +
            (d.deeplink ? '<div class="pv-note">Deep link: ' + sfdEsc(d.deeplink) + '</div>' : '') +
            '<div class="pv-note">' + sfdT('Пример отображения. Точный вид зависит от устройства и версии ОС.') + '</div></div>';
        return;
    }
    if (ch === 'email'){
        side.innerHTML = '<div class="pv-card"><div class="pv-title">' + sfdT('Предпросмотр Email') + '</div>' +
            '<div class="pv-em"><div class="pv-em-head">Letteros-шаблон</div>' +
            '<div class="pv-em-meta"><div class="l">' + sfdT('Тема') + '</div><div class="v">' + sfdEsc(d.subject || '—') + '</div></div>' +
            (d.message
                ? '<iframe class="pv-em-frame" sandbox="" title="Letteros"></iframe>'
                : '<div class="pv-em-stub">' + sfdT('Вёрстка шаблона будет подтягиваться из Letteros') + '</div>') +
            '</div></div>';
        var fr = side.querySelector('.pv-em-frame');
        if (fr) fr.srcdoc = d.message;
        return;
    }
    side.innerHTML = '';
}

/* Перевод интерфейсных элементов админки при смене языка (вызывает applyLang оболочки) */
function translateAdminChrome(){
    if (typeof applyFilters === 'function' && document.getElementById('templateListBody')) applyFilters();
    if (typeof refreshViewTemplateSelect === 'function') refreshViewTemplateSelect();
    if (SFD_STATE) sfdRender();
    /* «Управление доступом» рендерится admin-users.js и кэшируется — сбрасываем кэш;
       если раздел открыт, перерисовываем сразу, иначе — при следующем открытии */
    if (typeof window.accessInvalidate === 'function'){
        window.accessInvalidate();
        var acc = document.getElementById('sec-access');
        if (acc && acc.classList.contains('active') && typeof window.renderAccessSection === 'function') window.renderAccessSection();
    }
}

/* Парсинг HTML email и извлечение текста и ссылок */
function parseEmailHtml(html) {
    if (!html || typeof html !== 'string') return { textContent: '', links: [] };
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    if (!doc.body) return { textContent: '', links: [] };
    // Извлекаем текст
    const textContent = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    
    // Извлекаем ссылки
    const links = [];
    const allLinks = doc.querySelectorAll('a');
    
    allLinks.forEach(a => {
        const href = a.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;
        
        let linkType = 'text';
        let context = '';
        
        // Проверяем, содержит ли ссылка изображение (баннер)
        const img = a.querySelector('img');
        if (img) {
            linkType = 'banner';
            context = img.getAttribute('alt') || 'Изображение';
        }
        // Проверяем, является ли это кнопкой (по стилям или родителю)
        else if (
            a.style.cssText.includes('padding') && 
            (a.style.cssText.includes('background') || a.closest('td[style*="background"]'))
        ) {
            linkType = 'button';
            context = a.textContent.trim();
        }
        // Проверяем, находится ли в ячейке таблицы с фоном (кнопка)
        else if (a.closest('td')?.style?.cssText?.includes('background')) {
            linkType = 'button';
            context = a.textContent.trim();
        }
        // Обычная текстовая ссылка
        else {
            linkType = 'text';
            context = a.textContent.trim();
            // Если текст ссылки совпадает с URL, пробуем взять контекст вокруг
            if (context === href || context.length > 50) {
                const parent = a.parentElement;
                if (parent && parent.textContent.length < 100) {
                    context = parent.textContent.replace(href, '').trim().substring(0, 50);
                    if (!context) context = a.textContent.trim().substring(0, 50);
                } else {
                    context = a.textContent.trim().substring(0, 50);
                }
            }
        }
        
        links.push({
            url: href,
            type: linkType,
            context: context || '—'
        });
    });
    
    // Также ищем изображения без ссылок
    const images = doc.querySelectorAll('img');
    images.forEach(img => {
        const src = img.getAttribute('src');
        if (src && !img.closest('a')) {
            // Изображение без ссылки - просто информация
        }
    });
    
    return { textContent, links };
}

/* Заглушка, когда msg_text нет */
function renderEmailContentPlaceholder() {
    const section = document.createElement('div');
    section.className = 'email-content-section';
    section.style.marginTop = '20px';
    section.style.padding = '20px';
    section.style.background = 'var(--card2)';
    section.style.borderRadius = '8px';
    section.style.color = 'var(--dim)';
    section.innerHTML = '<h4>📧 Текст письма</h4><p>Текст письма не загружен (нет данных для этого шаблона). Откройте страницу через локальный сервер, чтобы подгрузить mock-data.json.</p>';
    return section;
}

/* Отрисовка секции с контентом email */
function renderEmailContent(msgText) {
    const { textContent, links } = parseEmailHtml(msgText);
    
    const section = document.createElement('div');
    section.className = 'email-content-section';
    section.style.marginTop = '20px';
    
    // Предпросмотр письма в iframe (HTML с ссылками и форматированием)
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    iframe.style.cssText = 'width:100%; min-height:280px; border:1px solid #e5e7eb; border-radius:8px; background:#fff;';
    try { iframe.srcdoc = msgText; } catch (e) { iframe.srcdoc = '<p>Не удалось отобразить письмо</p>'; }
    iframe.onload = function() {
        try {
            var doc = iframe.contentDocument;
            if (doc && doc.querySelectorAll) {
                doc.querySelectorAll('a[href]').forEach(function(a) {
                    a.setAttribute('target', '_blank');
                    a.setAttribute('rel', 'noopener noreferrer');
                });
            }
        } catch (e) { /* cross-origin или недоступен */ }
    };
    
    let html = '<h4>📧 Письмо (предпросмотр)</h4>';
    section.innerHTML = html;
    section.appendChild(iframe);
    
    // Секция с извлечённым текстом и ссылками
    html = `
        <h4 style="margin-top:20px;">Текст (извлечённый)</h4>
        <div class="email-text-preview">${escapeHtml(textContent || '—')}</div>
    `;
    
    // Секция со ссылками
    if (links.length > 0) {
        html += `
            <h4>🔗 Ссылки в письме (${links.length})</h4>
            <table class="email-links-table">
                <thead>
                    <tr>
                        <th style="width:40px;">#</th>
                        <th>URL</th>
                        <th style="width:80px;">Тип</th>
                        <th>Контекст / Текст</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        links.forEach((link, i) => {
            const typeClass = link.type;
            const typeLabels = {
                'button': 'Кнопка',
                'text': 'Текст',
                'banner': 'Баннер',
                'image': 'Картинка'
            };
            
            html += `
                <tr>
                    <td>${i + 1}</td>
                    <td class="link-url">${escapeHtml(link.url)}</td>
                    <td><span class="link-type ${typeClass}">${typeLabels[link.type]}</span></td>
                    <td class="link-context">${escapeHtml(link.context)}</td>
                </tr>
            `;
        });
        
        html += `
                </tbody>
            </table>
        `;
    } else {
        html += `<h4>🔗 Ссылки в письме</h4><p style="padding:15px;color:#6b7280;">Ссылки не найдены</p>`;
    }
    
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    section.appendChild(wrap);
    return section;
}

/* Экранирование HTML */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/* Сбор данных из формы канала (SMS/Push/Email/КЦ) для нового шаблона */
function collectFormData(formEl, channel) {
    if (!formEl) return null;
    const data = { channel: channel };
    formEl.querySelectorAll('input, textarea, select').forEach(function(input) {
        if (input.type === 'hidden') return;
        var classes = input.className.split(' ');
        var label = (input.closest('.field') && input.closest('.field').querySelector('label')) ? input.closest('.field').querySelector('label').textContent.toLowerCase() : '';
        var val = input.type === 'checkbox' ? input.checked : input.value;
        if (classes.includes('trigger')) data.trigger = val;
        else if (classes.includes('product')) data.product = val;
        else if (classes.includes('partner')) data.partner = val;
        else if (classes.includes('touch')) data.touch = val;
        else if (classes.includes('day')) data.day = val;
        else if (classes.includes('source')) data.source = val;
        else if (classes.includes('comname')) data.comname = val;
        else if (classes.includes('aff_sub3')) data.aff_sub3 = val;
        else if (classes.includes('communication_type')) data.communication_type = val;
        else if (classes.includes('biz_type')) data.biz_type = val;
        else if (classes.includes('sender_name')) data.sender_name = val;
        else if (classes.includes('email_from')) data.email_from = val;
        else if (classes.includes('letteros_id')) data.letteros_id = val;
        else if (classes.includes('source_system')) data.source_system = val;
        else if (classes.includes('segment_desc')) data.segment_desc = val;
        else if (classes.includes('segment')) data.segment = val;
        else if (classes.includes('host_id')) data.host_id = val;
        else if (classes.includes('kvint')) data.kvint = val;
        else if (classes.includes('title')) data.title = val;
        else if (classes.includes('deeplink')) data.deeplink = val;
        else if (classes.includes('webview')) data.webview = val;
        else if (classes.includes('fa_id')) data.fa_id = val;
        else if (classes.includes('channel_id')) data.channel_id = val;
        else if (classes.includes('cb-need_push')) data.need_push = val;
        else if (classes.includes('c2d_transport')) data.c2d_transport = val;
        else if (classes.includes('c2d_account')) data.c2d_account = val;
        else if (classes.includes('ch2d_operator_id')) data.ch2d_operator_id = val;
        else if (classes.includes('web_url')) data.web_url = val;
        else if (classes.includes('link_title')) data.link_title = val;
        else if (classes.includes('action_buttons')) data.action_buttons = val;
        else if (classes.includes('vk_template_name')) data.vk_template_name = val;
        else if (classes.includes('ttl')) data.ttl = val;
        else if (classes.includes('ab_group')) data.ab_group = val;
        else if (classes.includes('buttons')) data.buttons = val;
        else if (classes.includes('activity_name')) data.activity_name = val;
        else if (classes.includes('la_event')) data.la_event = val;
        else if (classes.includes('la_visualization_attributes')) data.la_visualization_attributes = val;
        else if (classes.includes('la_visualization')) data.la_visualization = val;
        else if (classes.includes('la_status')) data.la_status = val;
        else if (classes.includes('current_step')) data.current_step = val;
        else if (classes.includes('cb-marketplace')) data.marketplace = val;
        else if (classes.includes('cb-dialog')) data.dialog = val;
        else if (classes.includes('cb-loyalty')) data.loyalty = val;
        else if (classes.includes('cb-national_rating')) data.national_rating = val;
        else if (classes.includes('cb-news')) data.news = val;
        else if (classes.includes('cb-night_send')) data.night_send = val;
        else if (classes.includes('cb-mobile_app')) data.mobile_app = val;
        else if (classes.includes('cb-cross')) data.cross = val;
        else if (classes.includes('cb-chain')) data.chain = val;
        else if (classes.includes('chain-count')) data.chain_count = val;
        else if (classes.includes('cb-sms-cc') || classes.includes('cb-email-cc')) data.cc_cross = val;
        else if (classes.includes('cb-ab-test')) data.ab_test = val;
        else if (classes.includes('ab-test-count')) data.ab_test_count = val;
        else if (classes.includes('active_flag')) data.active = val;
        else if (label.indexOf('message') !== -1) data.message = val;
    });
    // Для КЦ бизнес-идентификатор — segment; для email — letteros_id; для sms/push code выдаёт бэкенд.
    if (channel === 'cc' && data.segment != null && data.segment !== '') data.code = data.segment;
    if (channel === 'email') {
        data.service_flag = data.biz_type === 'service';
        data.info_flag = data.biz_type === 'info';
    }
    return data;
}

/* Следующий свободный id для канала (sms_3, push_4, ...) */
function getNextTemplateId(channel) {
    var max = 0;
    Object.keys(MOCK_TEMPLATES).forEach(function(id) {
        if (id.indexOf(channel + '_') === 0) {
            var num = parseInt(id.slice(channel.length + 1), 10);
            if (!isNaN(num) && num > max) max = num;
        }
    });
    return channel + '_' + (max + 1);
}

/* Сохранение шаблона из формы канала — через бэкенд (create/update).
   Одиночный шаблон или цепочка (таблица «день → данные шаблона», как в v2). */
function isChainOn(formEl) {
    var cb = formEl.querySelector('.cb-chain');
    return !!(cb && cb.checked);
}
function afterChannelSave() {
    if (typeof loadMockData === 'function') {
        loadMockData().then(function () { if (typeof applyFilters === 'function') applyFilters(); });
    }
}
function saveFromChannelForm(channel) {
    var formEl = document.getElementById(channel);
    // Live Activity: тумблер в форме Push → сохраняем как канал la (live_activity_template)
    var laCb = formEl && formEl.querySelector('.cb-live-activity');
    if (channel === 'push' && laCb && laCb.checked) channel = 'la';
    var data = collectFormData(formEl, channel);
    if (!data) return;

    var chainOn = isChainOn(formEl);

    if (channel === 'cc' && (data.segment == null || data.segment === '')) {
        alert('Укажите Segment.'); return;
    }
    if (channel === 'email' && !chainOn && (data.letteros_id == null || data.letteros_id === '')) {
        alert('Укажите Letteros Id.'); return;
    }
    if (!data.comname || !data.comname.trim()) {
        alert('Укажите Communication Name.'); return;
    }
    data.active = data.active !== false;

    // ---- Цепочка: по строке-дню создаём отдельный шаблон, campaign_name считается по дню ----
    if (chainOn) {
        var rows = readChainRows(formEl, channel);   // null → ошибка (alert уже показан)
        if (rows == null) return;
        if (!rows.length) { alert('Сгенерируйте строки: введите дни и нажмите «Сгенерировать строки».'); return; }
        window.CRM_CURRENT = null;                    // цепочка — всегда создание
        var seq = rows.reduce(function (p, row) {
            return p.then(function (acc) {
                var d = Object.assign({}, data, row.overrides, {
                    day: String(row.day),
                    source: computeCampaignName(formEl, row.day)
                });
                return CRM.saveFromV1(d).then(function (r) { acc.push(r && r.code); return acc; });
            });
        }, Promise.resolve([]));
        seq.then(function (codes) {
            alert('Цепочка сохранена: ' + rows.length + ' шаблон(ов).\nCode: ' + codes.filter(Boolean).join(', '));
            window.CRM_CURRENT = null;
            afterChannelSave();
        }).catch(function (e) { alert('Ошибка сохранения цепочки: ' + (e && e.message ? e.message : e)); });
        return;
    }

    // ---- Одиночный шаблон ----
    data.source = computeCampaignName(formEl, undefined) || data.source;
    CRM.saveFromV1(data).then(function (r) {
        alert('Сохранено.\ncommunication_name: ' + data.comname + '\nCode: ' + (r && r.code != null ? r.code : ''));
        window.CRM_CURRENT = null;
        afterChannelSave();
    }).catch(function (e) { alert('Ошибка сохранения: ' + (e && e.message ? e.message : e)); });
}

/* Обновить выпадающий список шаблонов во вкладке «Просмотр» (из данных бэкенда) */
/* Picker «Просмотра настроек» (визуал из main): 1) канал → 2) шаблон,
   поиск по source_type; для Email — дополнительно по Letteros ID. */
var VIEWER_CHANNEL = null;

function viewerSetChannel(ch) {
    VIEWER_CHANNEL = ch;
    document.querySelectorAll('#viewChannelSeg button').forEach(function(b) {
        b.classList.toggle('active', b.dataset.ch === ch);
    });
    var block = document.getElementById('viewerPickBlock');
    if (block) block.style.display = '';
    var lw = document.getElementById('viewLetterosWrap');
    if (lw) lw.style.display = ch === 'email' ? '' : 'none';
    refreshViewTemplateSelect();
}

function viewerFilterChanged() { refreshViewTemplateSelect(); }

var VIEWER_PICK_CAP = 500;     // столько <option> максимум тянем с сервера
var _viewSelSeq = 0;           // защита от гонки ответов
function refreshViewTemplateSelect() {
    var sel = document.getElementById('templateSelect');
    if (!sel) return;
    var current = sel.value;
    var srcQ = (document.getElementById('viewSearchSource') || { value: '' }).value.trim();
    var letQ = (document.getElementById('viewSearchLetteros') || { value: '' }).value.trim();

    // Тянем с сервера отфильтрованно (по каналу + поиску), а не перебираем весь справочник в браузере.
    var params = { limit: VIEWER_PICK_CAP };
    if (VIEWER_CHANNEL) params.channel = VIEWER_CHANNEL;
    var q = srcQ || letQ;
    if (q) params.q = q;

    var sfdTT = (typeof sfdT === 'function') ? sfdT : function(s){ return s; };
    var my = ++_viewSelSeq;
    CRM.listTemplates(params).then(function(raw) {
        if (my !== _viewSelSeq) return;                     // устаревший ответ — игнор
        var items = (raw || []).map(CRM.apiItemToList).filter(function(t) {
            // для email доп. сужаем по letteros-коду (server q ищет по всем полям)
            if (VIEWER_CHANNEL === 'email' && letQ) {
                var lid = (t.letteros != null && t.letteros !== '') ? t.letteros : t.code;
                return String(lid == null ? '' : lid).toLowerCase().indexOf(letQ.toLowerCase()) !== -1;
            }
            return true;
        });
        var capped = items.length >= VIEWER_PICK_CAP;
        sel.innerHTML = '<option value="">' + sfdTT('— Выберите шаблон') + ' (' + items.length + (capped ? ', ' + sfdTT('первые') + ' ' + VIEWER_PICK_CAP + ' — ' + sfdTT('уточните поиск') : '') + ')</option>';
        items.forEach(function(t) {
            var opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.code + ' - ' + (t.name || String(t.code)) + (t.active ? '' : ' ' + sfdTT('(неактивный)'));
            sel.appendChild(opt);
        });
        if (current && items.some(function(t) { return t.id === current; })) sel.value = current;
    }).catch(function(){});
}

/* Скачать текущие данные как mock-data.json */
function downloadMockDataJson() {
    var templates = {};
    Object.keys(MOCK_TEMPLATES).forEach(function(id) {
        var t = MOCK_TEMPLATES[id];
        var copy = {};
        Object.keys(t).forEach(function(k) {
            if (k !== '_ab_comname_list') copy[k] = t[k];
        });
        templates[id] = copy;
    });
    var listTemplates = ALL_TEMPLATES.map(function(t) {
        return { id: t.id, channel: t.channel, code: t.code, name: t.name, product: t.product, touch: t.touch, trigger: t.trigger, partner: t.partner, active: t.active };
    });
    var payload = { templates: templates, listTemplates: listTemplates, dashboard: DASHBOARD_DATA };
    var json = JSON.stringify(payload, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'mock-data.json';
    a.click();
    URL.revokeObjectURL(url);
}
