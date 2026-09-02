/* ================== Просмотр настроек: карточка Salesforce Details ==================
   Заменяет старый рендер (клон формы канала + «Редактировать»): поля с карандашами,
   секции, inline-редактирование и предпросмотр SMS/Push/Email.
   Данные — v1-объект (CRM.dtoToV1), сохранение — CRM.updateTemplate.
   ==================================================================================== */
var SFD_STATE = null; /* { id, orig, work, editing:{}, pushOS } */
/* Подписи каналов — единственное место, где они заданы: карточка, пикер
   «Просмотра настроек» и список шаблонов берут их отсюда. */
var CH_LABELS = { sms:'SMS', push:'Push', 'mobile-push':'Push', email:'Email',
                  cc:'КЦ', fa:'FA', vk:'VK', la:'Live Activity' };
/* Подписи каналов — используются в карточке и в пикере «Просмотра настроек». */
var CH_LABELS = { sms:'SMS', push:'Push', 'mobile-push':'Push', email:'Email', cc:'КЦ', fa:'FA', vk:'VK', la:'Live Activity' };
function sfdT(s){ return (typeof t === 'function') ? t(s) : s; }
/* Права на шаблоны по глаголу. Операции лежат за двумя разделами — admin (мастер) и
   templates (список); право достаточно иметь в любом из них, как и проверяет сервер
   (AccessGuard.requireCapability(cap, ADMIN, TEMPLATES)). Кнопки прячем — сервер отбивает. */
function sfdCan(cap){ return !!(window.CRM && CRM.can && CRM.can(cap, 'admin', 'templates')); }
function sfdEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

function renderTemplateDetails(data, templateId) {
    var work = Object.assign({}, data);
    /* флаг cross не хранится в БД отдельным полем — восстанавливаем из communication_name */
    if (work.cross == null) work.cross = !!(work.comname && String(work.comname).indexOf('-cross') !== -1);
    /* is_contact — ровно та же история: своей колонки в notice.* у него нет, но он
       виден в campaign_name, где вместо канала стоит contact_. Оттуда и читаем,
       иначе галка при открытии сохранённого шаблона всегда была бы снята. */
    if (work.cc_cross == null) work.cc_cross = /^contact_/.test(String(work.source || ''));
    /* is_autopromo — тоже без своей колонки: виден суффиксом -autopromo в
       communication_name, оттуда и читаем при открытии сохранённого шаблона */
    if (work.autopromo == null) work.autopromo = sfdAutopromoOn(work);
    /* дата в имени — не сегодняшняя: значит её задавали руками. Восстанавливаем и флаг,
       и саму дату, иначе первая же правка пересчитала бы имя на сегодня. */
    if (work.delayed == null){
        var был = sfdDelayedFromSource(work);
        work.delayed = !!был;
        if (был && !work.promo_date) work.promo_date = был;
    }
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
    var sufs = ['-cross','-dialog','-loyalty','-nr','-news','-mobile-app','-autopromo'];
    var changed = true;
    while (changed){
        changed = false;
        for (var i = 0; i < sufs.length; i++){
            var s = sufs[i];
            if (v.length > s.length && v.slice(-s.length) === s){ v = v.slice(0, -s.length); changed = true; break; }
        }
    }
    /* Пустое имя так и остаётся пустым: NoComName здесь подставлялся как заглушка, из-за
       чего поле выглядело заполненным, а сохранить шаблон всё равно не давало. Теперь
       NoComName — только плейсхолдер в поле, значением он не становится. */
    return v;
}
function sfdComputeComname(d){
    var b = sfdStripComnameFlags(d.comname);
    /* база out-trigger- достраивается партнёром (правило updateComNameFromContext) */
    if (b.indexOf('out-trigger-') === 0) b = 'out-trigger-' + (d.partner || '');
    /* без имени суффиксы вешать не на что: собранное из одних флагов «-cross-nr»
       именем не является и в campaign_name уехало бы мусором */
    if (!b) return '';
    var v = (d.marketplace ? 'marketplace-' : '') + b;
    if (d.cross) v += '-cross';
    if (d.dialog) v += '-dialog';
    if (d.loyalty) v += '-loyalty';
    if (d.national_rating) v += '-nr';
    if (d.news) v += '-news';
    if (d.mobile_app) v += '-mobile-app';
    /* autopromo — последним суффиксом. Дефис только если есть к чему цеплять:
       у пустого имени коммуникации остаётся голое autopromo. */
    if (d.autopromo) v += (v ? '-' : '') + 'autopromo';
    return v;
}
/* Флаг is_autopromo своей колонки в notice.* не имеет — признак живёт суффиксом в
   communication_name. Правки из списка шаблонов приходят объектом без ключа
   autopromo (dtoToV1 его не знает), поэтому при отсутствии ключа читаем имя:
   иначе переименование строки в списке вернуло бы в campaign_name дату. */
function sfdAutopromoOn(d){
    if (d.autopromo != null) return !!d.autopromo;
    return /(^|-)autopromo(-|$)/.test(String(d.comname || ''));
}

/* ---------- дата в имени кампании ----------
   По умолчанию в campaign_name уходит сегодняшнее число: рассылку заводят в день
   отправки. «Отложенное промо» — когда шаблон готовят заранее: дату задают руками,
   и в имени оказывается она. Больше флаг ничего не меняет.
   Своей колонки в БД у него нет — дата видна в самом имени, оттуда и читается при
   открытии сохранённого шаблона (sfdDelayedFromSource). */
function sfdPromoDate(d){
    var today = (typeof formatDateDDMMYY === 'function') ? formatDateDDMMYY() : '';
    if (!d) return today;
    /* Ключа delayed нет вовсе — объект пришёл не из карточки, а из списка шаблонов
       (dtoToV1 про флаг не знает). Тогда читаем дату из сохранённого имени: иначе
       переименование строки в списке молча переставило бы её на сегодня. */
    if (d.delayed == null){
        var было = sfdDelayedFromSource(d);
        if (!было) return today;
        var q = было.split('-');
        return q[2] + q[1] + q[0].slice(2);
    }
    var iso = String(d.promo_date ? d.promo_date : '').trim();
    if (d.delayed && /^\d{4}-\d{2}-\d{2}$/.test(iso)){
        var p = iso.split('-');
        return p[2] + p[1] + p[0].slice(2);          /* 2026-08-20 -> 200826 */
    }
    return today;
}
/**
 * Восстановить «отложенное промо» из сохранённого имени кампании.
 * <p>
 * Имя promo-кампании кончается на ддммгг. Стоит там не сегодняшнее число — значит дату
 * задавали руками; иначе при первой же правке любого поля имя пересчиталось бы на
 * сегодня и молча уехало от того, что согласовали.
 */
function sfdDelayedFromSource(d){
    var m = /_(\d{2})(\d{2})(\d{2})(?:day)?$/.exec(String(d && d.source ? d.source : ''));
    if (!m) return null;
    var today = (typeof formatDateDDMMYY === 'function') ? formatDateDDMMYY() : '';
    if ((m[1] + m[2] + m[3]) === today) return null;
    return '20' + m[3] + '-' + m[2] + '-' + m[1];
}
function sfdComputeCampaignName(d){
    /* «выгрузка в КЦ» (в развёрнутой форме — cb-sms-cc / cb-email-cc): вместо канала в
       campaign_name встаёт contact. Своей колонки у флага нет, поэтому при открытии
       он восстанавливается из префикса — но раз человек может его переключить, решает
       именно галка, и только при её отсутствии смотрим на сохранённое имя. */
    var ccOn = (d.cc_cross != null ? !!d.cc_cross : /^contact_/.test(String(d.source || '')));
    var senderType = d.trigger;
    if (senderType !== 'promo' && senderType !== 'trigger') return '';
    var product = d.product || '', partner = d.partner || '', comname = d.comname || '', day = d.day || '';
    /* autopromo: дата из имени кампании уходит — такие рассылки не привязаны ко дню */
    var date = sfdAutopromoOn(d) ? '' : sfdPromoDate(d);
    if (d.channel === 'cc'){
        var segment = (d.segment != null && d.segment !== '') ? d.segment : (d.code || '');
        if (senderType === 'trigger') return 'contact_' + senderType + '_' + product + '_' + comname + '_' + segment + '_' + day + 'day';
        return 'contact_' + senderType + '_' + product + '_' + partner + '_' + comname + '_' + date + 'day';
    }
    /* канал в campaign_name — как в формах мастера (hidden .channel): push пишется как mobile-push,
       FA — как fin-assistent (единый нейминг с «Планированием промо») */
    var chTab = ({ sms:'sms', push:'mobile-push', 'mobile-push':'mobile-push', email:'email',
                   fa:'fin-assistent', vk:'vk' })[d.channel] || d.channel;
    var tab = ccOn ? 'contact' : chTab;
    /* дата приклеивается отдельно: у autopromo её нет, и конкатенация оставила бы
       висеть хвостовой разделитель — email_promo_kk_alfa_leto_.
       Пустые product/partner при этом по-прежнему дают двойное подчёркивание:
       так видно, что поле не заполнено, и правило нейминга это не меняет. */
    if (senderType === 'promo'){
        var head = tab + '_' + senderType + '_' + product + '_' + partner + '_' + comname;
        return date ? head + '_' + date : head;
    }
    return tab + '_' + senderType + '_' + product + '_' + comname + '_' + day + 'day';
}
/**
 * Не заводим второй раз то, что уже заведено.
 *
 * Спрашиваем сервер ДО сохранения, чтобы показать вопрос человеку, а не отказ после
 * нажатия. Проверок две, и они разной строгости:
 *   letteros_id — точный ключ макета письма: совпадение означает то же самое письмо,
 *                 и заводить второй шаблон незачем — предлагаем открыть существующий;
 *   source      — имя кампании: обычно совпадение это повторное «Создать», но у А/Б-пары
 *                 и у дней цепочки оно общее по замыслу, поэтому спрашиваем, а не запрещаем.
 *
 * Возвращает промис: null — не сохранять, объект {force} — сохранять (force сообщает
 * серверу, что дубль по source осознанный). Проверка не удалась — работать не мешаем:
 * сервер проверит то же самое сам.
 */
function sfdGuardDuplicate(d){
    if (!CRM.willCreateFromV1(d)) return Promise.resolve({ force:false });
    var source = d.source || '';
    var letteros = (d.channel === 'email') ? (d.letteros_id || '') : '';
    if (!source && !letteros) return Promise.resolve({ force:false });
    return CRM.templateDuplicates(d.channel, source, letteros).then(function(res){
        if (res && res.letterosId){
            alert(sfdT('Письмо с таким Letteros Id уже заведено') + ': ' + d.channel + '/' + res.letterosId +
                '.\n' + sfdT('Откройте существующий шаблон вместо создания нового.'));
            return null;
        }
        if (res && res.source){
            return confirm(sfdT('Шаблон с таким source уже есть') + ': ' + d.channel + '/' + res.source +
                '\n' + source + '\n\n' +
                sfdT('Создать ещё один? Так делают для А/Б-пары и для дней цепочки.'))
                ? { force:true } : null;
        }
        return { force:false };
    }).catch(function(){ return { force:false }; });
}

/* ---------- предзаполнение по типу отправителя ----------
   У promo-рассылок эти четыре поля всегда одни и те же, и заполнять их руками каждый
   раз незачем. Пишем во все четыре, а не только в пустые: правило жёсткое, и выбранное
   раньше значение (например touch point из прошлой правки карточки) должно смениться на
   promo — иначе выбор «promo» не приводил бы к обещанному состоянию полей. Срабатывает
   только в момент выбора типа отправителя, при обычной правке других полей — нет. */
var SFD_PROMO_DEFAULTS = { touch:'promo', day:'0', communication_type:'adv', biz_type:'adv' };
function sfdApplyPromoDefaults(d){
    if (d.trigger !== 'promo') return false;
    var changed = false;
    Object.keys(SFD_PROMO_DEFAULTS).forEach(function(k){
        if (String(d[k] == null ? '' : d[k]) === SFD_PROMO_DEFAULTS[k]) return;
        d[k] = SFD_PROMO_DEFAULTS[k];
        changed = true;
    });
    return changed;
}

/* ---------- Landing page из ссылки ----------
   aff_sub3 — путь посадочной страницы, и он всегда есть в самой ссылке. Берём то, что
   идёт после домена banki.ru, и отбрасываем два вида шума:
     · query и якорь — utm-метки к посадочной не относятся;
     · служебный сегмент /webview/ — он про способ открытия, а не про страницу.
   Примеры:
     https://www.banki.ru/webview/promo/leto?utm_source=push  ->  /promo/leto
     https://www.banki.ru/promo/leto                          ->  /promo/leto
   Чужие домены не трогаем: там путь к нашей аналитике отношения не имеет. */
function sfdLandingFromLink(url){
    var s = String(url == null ? '' : url).trim();
    if (!s) return '';
    var m = /(?:^|\/\/|\.)((?:[a-z0-9-]+\.)*banki\.ru)(\/[^\s]*)?/i.exec(s);
    if (!m) return '';
    var tail = (m[2] || '').split('#')[0].split('?')[0];
    var wv = /\/webview\/(.*)$/i.exec(tail);
    if (wv) tail = '/' + wv[1];
    return (tail === '' || tail === '/') ? '' : tail;
}
/* Ссылка, из которой берём посадочную: у пуша и Live Activity это webview (deep link
   там служебный, с префиксом deepLink/webview?webviewUrl=), у финансового ассистента —
   webview либо web_url. У остальных каналов ссылки в карточке нет. */
function sfdLinkFieldsOf(channel){
    if (channel === 'push' || channel === 'mobile-push' || channel === 'la') return ['webview'];
    if (channel === 'fa') return ['webview', 'web_url'];
    return [];
}
/**
 * Подставить посадочную из ссылки.
 * <p>
 * Перетирать введённое руками нельзя, но и застревать на старом значении при смене
 * ссылки тоже: помним последнее подставленное (st.landingAuto) и обновляем поле, только
 * пока в нём стоит ровно оно либо пусто. Стоит своё — не трогаем совсем.
 */
function sfdApplyLandingFromLink(){
    var st = SFD_STATE; if (!st) return false;
    var d = st.work;
    var fields = sfdLinkFieldsOf(d.channel);
    var derived = '';
    for (var i = 0; i < fields.length && !derived; i++) derived = sfdLandingFromLink(d[fields[i]]);
    if (!derived) return false;
    var cur = String(d.aff_sub3 == null ? '' : d.aff_sub3).trim();
    if (cur !== '' && cur !== st.landingAuto) return false;   /* задано руками — оставляем */
    if (cur === derived) return false;
    d.aff_sub3 = derived;
    st.landingAuto = derived;
    return true;
}

/* touch здесь не ради comname/source (они его не используют), а ради адреса
   отправителя: renewal — первое условие в правиле. */
var SFD_NAME_KEYS = { trigger:1, product:1, partner:1, comname:1, day:1, segment:1, touch:1,
    marketplace:1, cross:1, cc_cross:1, dialog:1, loyalty:1, national_rating:1, news:1, mobile_app:1,
    autopromo:1, delayed:1, promo_date:1 };
/* Адрес отправителя e-mail — копия generateEmail из v2. Порядок проверок значимый:
   renewal (по touch_point) → service → info (по business_communication_type) →
   trigger+adv → promo+adv (по trigger_type) → newsletter как общий случай. */
function sfdComputeEmailFrom(d){
    var email;
    if (d.touch === 'renewal') email = 'renewal@email.banki.ru';
    else if (d.biz_type === 'service') email = 'no-reply@email.banki.ru';
    else if (d.biz_type === 'info') email = 'inform@email.banki.ru';
    else if (d.trigger === 'trigger' && d.biz_type === 'adv') email = 'offers@email.banki.ru';
    else if (d.trigger === 'promo' && d.biz_type === 'adv') email = 'advice@email.banki.ru';
    else email = 'newsletter@email.banki.ru';
    return 'Банки.ру<' + email + '>';
}
/* Поля, от которых зависит СОСТАВ строк карточки: только они требуют полной
   перерисовки. Тип отправителя открывает «Отложенное промо», флаг — поле даты,
   тумблер LA — набор канальных полей. */
var SFD_RELAYOUT = { trigger:1, delayed:1, is_la:1 };

/**
 * Обновить значения строк «только на чтение» без перерисовки карточки.
 * <p>
 * Campaign name, communication name и адрес отправителя считаются от других полей,
 * и раньше их показывал только полный sfdRender. Перерисовка пересоздаёт поля ввода:
 * у обычного текста это незаметно, а у нативного поля даты сбрасывает набранный
 * сегмент — число ввести не получалось вовсе.
 */
/* Обновляем только то, что пересчитывает sfdRecalcNames. Остальные строки трогать
   нельзя: часть из них показывается через fmt (канал как «SMS», а не «sms»), и
   подстановка сырого значения испортила бы вид. */
var SFD_COMPUTED = { source:1, comname:1, email_from:1 };

function sfdRefreshViews(){
    var st = SFD_STATE; if (!st) return;
    var out = document.getElementById(st.mode === 'create' ? 'wizardOutput' : 'settingsOutput');
    if (!out) return;
    out.querySelectorAll('[data-view]').forEach(function(el){
        var k = el.dataset.view;
        if (!SFD_COMPUTED[k]) return;
        var v = st.work[k];
        var empty = (v === undefined || v === null || v === '');
        el.textContent = empty ? '—' : String(v);
        el.className = empty ? 'v empty' : 'v';
    });
}

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
        d.email_from = sfdComputeEmailFrom(d);
    }
}

/* ---------- справочники значений для карточки ----------
   reference.d_touch_point и reference.d_communication_name уже отдаются бэкендом
   (/api/dictionaries/*). Раньше их подтягивал wizard.js в старые канальные формы;
   формы ушли вместе с переходом мастера на карточку, и поля снова стали обычным
   вводом руками. Тянем справочники сюда: touch_point — строгий список, а
   communication_name — список с возможностью вписать своё (новые имена заводятся
   постоянно, запрещать их нельзя). */
/* Оба списка одинаковы для всех каналов (справочники ни от чего не зависят),
   поэтому тянем их по одному разу за загрузку страницы. */
var SFD_DICT = { touch: null, comm: null, product: null, partner: null };
var SFD_DICT_REQ = {};                      /* что уже запрошено, чтобы не дёргать API повторно */

/**
 * Перерисовать карточку — но не из-под рук.
 * <p>
 * Справочники приезжают четырьмя запросами, каждый по готовности перерисовывал карточку.
 * Если человек в этот момент печатает или выбирает значение, перерисовка заменяет input
 * новым: фокус и каретка теряются, а набранное на экране откатывается к тому, что было
 * в состоянии на момент отрисовки. Со стороны это выглядит как «поле не меняется».
 * Откладываем: в мастере карточка всё равно перерисуется по уходу из поля (change),
 * и список к тому времени будет готов.
 */
function sfdRenderUnlessTyping(){
    var a = document.activeElement;
    if (a && a.classList &&
        (a.classList.contains('sfd-edit') || a.classList.contains('sfd-edit-check'))) return;
    sfdRender();
}

function sfdEnsureDicts(channel){
    if (!window.CRM) return;
    if (SFD_DICT.partner === null && !SFD_DICT_REQ.partner && CRM.dictPartners){
        SFD_DICT_REQ.partner = true;
        CRM.dictPartners().then(function(list){
            SFD_DICT.partner = list || [];
            sfdRenderUnlessTyping();
        }).catch(function(){ SFD_DICT.partner = []; });
    }
    if (SFD_DICT.touch === null && !SFD_DICT_REQ.touch && CRM.dictTouchPoints){
        SFD_DICT_REQ.touch = true;
        CRM.dictTouchPoints().then(function(list){
            SFD_DICT.touch = list || [];
            sfdRenderUnlessTyping();      /* справочник приехал — перерисовываем с готовым списком */
        }).catch(function(){ SFD_DICT.touch = []; });
    }
    if (SFD_DICT.product === null && !SFD_DICT_REQ.product && CRM.dictProductTypes){
        SFD_DICT_REQ.product = true;
        CRM.dictProductTypes().then(function(list){
            SFD_DICT.product = list || [];
            sfdRenderUnlessTyping();
        }).catch(function(){ SFD_DICT.product = []; });
    }
    if (SFD_DICT.comm === null && !SFD_DICT_REQ.comm && CRM.dictCommNames){
        SFD_DICT_REQ.comm = true;
        CRM.dictCommNames(channel || '').then(function(list){
            SFD_DICT.comm = list || [];
            sfdRenderUnlessTyping();
        }).catch(function(){ SFD_DICT.comm = []; });
    }
}

/* Список для выпадашки: справочник + текущее значение, если его там нет.
   Без этого открытие старого шаблона со снятым из справочника значением
   молча подменяло бы его первым пунктом списка. */
function sfdDictOpts(list, current, withEmpty){
    var out = (list || []).slice();
    var cur = String(current == null ? '' : current);
    if (cur && out.indexOf(cur) === -1) out.unshift(cur);
    if (withEmpty) out.unshift('');
    return out;
}

/* Какие поля карточки умеют пополнять свой справочник (кнопка «+» рядом с полем).
   Пока только партнёр: остальные списки правятся осознанно, а партнёр появляется
   в работе раньше, чем кто-то успевает добавить его в справочник. */
var SFD_DICT_ADD = {
    partner: function(name){ return CRM.dictAddPartner(name); }
};

/* Исходные системы КЦ. Список закрытый: в проде source_system у d_segment_properties
   NOT NULL без дефолта, и произвольное значение там никому не нужно. Появится новая
   система — добавить сюда (или завести справочник, как у партнёров). */
var SFD_SOURCE_SYSTEMS = ['', 'CALLTRACKING', 'KASKO', 'INVEST', 'INSMORTGAGE',
                          'CPA', 'MPK', 'OSAGO', 'RKO'];

/* Занести введённое в поле значение в справочник и подставить обратно то,
   что вернул сервер (он может вернуть уже существующее написание). */
function sfdDictAdd(key, btn){
    var api = SFD_DICT_ADD[key];
    if (!api || !window.CRM) return;
    var row = btn.closest('.sfd-row');
    var inp = row && row.querySelector('.sfd-edit[data-k="' + key + '"]');
    var value = inp ? String(inp.value || '').trim() : '';
    if (!value){ alert(sfdT('Сначала впишите значение.')); return; }
    var list = SFD_DICT[key] || [];
    var same = list.filter(function(o){ return String(o).toLowerCase() === value.toLowerCase(); })[0];
    if (same){
        /* уже в справочнике — запрос не нужен, просто выравниваем написание */
        SFD_STATE.work[key] = same;
        if (SFD_NAME_KEYS[key]) sfdRecalcNames();
        sfdRender();
        return;
    }
    btn.disabled = true;
    api(value).then(function(res){
        var saved = (res && res.name) || value;
        if ((SFD_DICT[key] || []).indexOf(saved) === -1){
            SFD_DICT[key] = (SFD_DICT[key] || []).concat([saved])
                .sort(function(a, b){ return String(a).toLowerCase() < String(b).toLowerCase() ? -1 : 1; });
        }
        SFD_STATE.work[key] = saved;
        if (SFD_NAME_KEYS[key]) sfdRecalcNames();
        sfdRender();
    }).catch(function(e){
        btn.disabled = false;
        alert(sfdT('Не удалось добавить в справочник') + ': ' + (e && e.message ? e.message : e));
    });
}

/* ---------- поля карточки по каналам (реальные поля наших форм + dtoToV1; preheader у нас нет) ---------- */
/* подпись ключевого поля (code) по каналу */
function sfdCodeLabel(ch){
    if (ch === 'cc') return sfdT('Сегмент (code)');
    /* у fa/vk свои поля fa_id и vk_template_name, code — обычный код записи */
    return 'Code';
}
function sfdFieldDefs(d){
    var ch = d.channel;
    var isEmail = ch === 'email', isCC = ch === 'cc', isPush = (ch === 'push' || ch === 'mobile-push'),
        isSms = ch === 'sms', isFa = ch === 'fa', isVk = ch === 'vk', isLa = ch === 'la';
    var content = [];
    if (isEmail){
        /* Subject в карточке нет: тему письма проставляет отправка. В модели поле
           осталось (прод-таблица требует его непустым — UnifiedTemplateService
           .prodDefaults подставляет пустую строку), просто заводить его руками не нужно. */
        /* Считается по правилу (sfdComputeEmailFrom), руками не задаётся — как и
           Campaign name. Раньше это делала форма мастера (updateEmailSenderName);
           с переездом на карточку поле стало обычным вводом, и адрес перестал
           следовать за touch point и типом коммуникации. */
        content.push({ k:'email_from', label:'Email from', ro:true });
        content.push({ k:'letteros_id', label:'Letteros ID' });
    } else if (!isCC){
        /* У пуша заголовок идёт первым, а текст под ним — так же, как их видит человек
           в шторке уведомления. Раньше порядок был обратный, и карточка расходилась с
           тем, что получится на экране телефона. */
        if (isPush) content.push({ k:'title', label:'Title' });
        content.push({ k:'message', label:'Message text', wide:true, type:'textarea' });
        if (isSms) content.push({ k:'sender_name', label:'Sender name', type:'select', opts:['','Banki.ru','Bamm.ru'] });
    }
    if (isPush){
        content.push({ k:'deeplink', label:'Deep link', wide:true });
        content.push({ k:'webview', label:'Webview link', wide:true });
    }
    if (isFa){
        content.push({ k:'link_title', label:'Link title' });
        content.push({ k:'deeplink', label:'Deep link', wide:true });
        content.push({ k:'webview', label:'Webview link', wide:true });
        content.push({ k:'web_url', label:'Web URL', wide:true });
        content.push({ k:'action_buttons', label:'Action buttons (JSON)', wide:true, type:'textarea' });
    }
    if (isVk){
        content.push({ k:'vk_template_name', label:'VK template name' });
        content.push({ k:'ttl', label:'TTL' });
        content.push({ k:'buttons', label:'Buttons (JSON)', wide:true, type:'textarea' });
    }
    /* Live Activity. Контентная часть у неё пушевая (текст, заголовок, ссылки, кнопки) —
       оставляем её в «Контенте и ссылках» рядом с остальными каналами. Собственные
       параметры активности вынесены отдельной секцией ниже (laRows): их шесть, и в
       общем списке они тонули, хотя относятся не к сообщению, а к самой активности. */
    var laRows = [];
    if (isLa){
        content.push({ k:'title', label:'Title' });
        content.push({ k:'deeplink', label:'Deep link', wide:true });
        content.push({ k:'webview', label:'Webview link', wide:true });
        content.push({ k:'action_buttons', label:'Action buttons (JSON)', wide:true, type:'textarea' });

        laRows.push({ k:'activity_name', label:'Activity name' });
        laRows.push({ k:'la_event', label:'LA event' });
        laRows.push({ k:'la_visualization', label:'LA visualization' });
        laRows.push({ k:'la_status', label:'LA status' });
        laRows.push({ k:'current_step', label:'Current step' });
        laRows.push({ k:'la_visualization_attributes', label:'LA visualization attributes (JSON)',
                      wide:true, type:'textarea' });
    }
    var segRows = [
        /* колонка в БД называется source_type, но в работе это «campaign name» —
           подпись по бизнес-имени, настоящее имя колонки остаётся в подсказке (SFD_DB) */
        { k:'source', label:'Campaign name', wide:true, ro:true, fmt:function(){ return SFD_STATE.work.source; } },
        { k:'trigger', label:'Trigger type', type:'select', opts:['','promo','trigger'] },
        { k:'product', label:'Product type', type:'select',
          opts: sfdDictOpts(SFD_DICT.product, d.product, true) },
        /* combo + кнопка «+»: партнёры ведутся в dictionary.d_partner, но список закрытым
           быть не может — новый партнёр появляется раньше, чем кто-то поправит справочник.
           Кнопка добавляет введённое значение в справочник (право add), см. sfdDictAdd. */
        { k:'partner', label:'Partner name', type:'combo', create:true,
          opts: sfdDictOpts(SFD_DICT.partner, d.partner, false) },
        { k:'touch', label:'Touch point', type:'select',
          opts: sfdDictOpts(SFD_DICT.touch, d.touch, true) },
        /* только цифры: значение уходит в source_type как Nday, буквы там ломают имя */
        { k:'day', label:'Sending day', type:'num' }
    ];
    if (isVk) segRows.push({ k:'ab_group', label:'AB Group' });
    if (isCC){
        /* Отдельной строки «Сегмент» здесь нет: у КЦ номер сегмента и есть код шаблона,
           он вводится выше как «Сегмент (code)». Строка была слепком старых развёрнутых
           форм — показывала то же значение на чтение, а при заведении всегда прочерк.
           Ключ segment в данных остаётся: из него собирается campaign_name (с откатом
           на code, см. sfdComputeCampaignName). */
        segRows.push({ k:'segment_desc', label:sfdT('Описание сегмента') });
        segRows.push({ k:'source_system', label:'Source system', type:'select', opts: SFD_SOURCE_SYSTEMS });
        segRows.push({ k:'host_id', label:'Host Id' });
        segRows.push({ k:'kvint', label:'Kvint campaign Id' });
    }
    var isCreate = !!(SFD_STATE && SFD_STATE.mode === 'create');
    /* При заведении шаблона канал и код показывать незачем: канал только что выбран
       вкладкой над карточкой, а код выдаёт бэкенд (TemplateService.create ->
       TemplateStore.nextCode). Исключение — КЦ: там код это номер сегмента, его
       задаёт человек, и без него create вернёт 400. В просмотре оба поля остаются:
       для заведённого шаблона это его опознавательные признаки. */
    var mainRows = [];
    /* Live Activity — разновидность пуша, а не самостоятельный канал в глазах человека:
       заводится тумблером в карточке Mobile-push. Технически это всё же отдельный
       канал (своя таблица notice.live_activity_template), поэтому тумблер переключает
       d.channel между push и la, а карточка перерисовывается с полями LA.
       Только при заведении: у сохранённого шаблона смена канала — это переезд между
       таблицами, а не правка поля. */
    if (isCreate && (isPush || isLa)) {
        d.is_la = isLa;   /* держим тумблер в согласии с каналом */
        mainRows.push({ k:'is_la', label:sfdT('Это Live Activity'), type:'bool' });
    }
    if (!isCreate) {
        mainRows.push({ k:'channel', label:sfdT('Канал'), ro:true, fmt:function(v){ return CH_LABELS[v] || v; } });
    }
    if (!isCreate || isCC) {
        mainRows.push({ k:'code', label: sfdCodeLabel(ch), ro: !isCreate });
    }
    mainRows.push({ k:'active', label:sfdT('Статус'), type:'bool' });
    /* «Выгрузка в КЦ» (в развёрнутой форме — SMS CallCenter / Email CallCenter):
       меняет campaign_name, подставляя contact вместо канала. Стоит здесь, рядом со
       статусом, а не среди служебных флагов: те правят communication_name суффиксами,
       а этот — сам канал в имени, и решение по нему принимают в начале, а не в конце.
       Канал только SMS и e-mail: у пуша и КЦ выгружать в кол-центр нечего. */
    if (isSms || isEmail) mainRows.push({ k:'cc_cross', label:'is_contact', type:'bool' });
    /* is_autopromo — рядом со статусом и is_contact, а не среди служебных флагов:
       он тоже меняет само имя кампании (убирает из него дату), а не только вешает
       суффикс. Во всех каналах кроме КЦ: у сегментов кол-центра имя строится по
       своим правилам (contact_…day), суффикса там не предусмотрено. */
    if (!isCC) mainRows.push({ k:'autopromo', label:'is_autopromo', type:'bool' });
    /* «Отложенное промо» — только у promo: дата есть лишь в имени promo-кампании,
       у trigger-а в хвосте стоит Nday, и подставлять туда нечего. Поле даты
       показываем лишь при включённом флаге, чтобы не занимать строку впустую. */
    if (d.trigger === 'promo'){
        mainRows.push({ k:'delayed', label:sfdT('Отложенное промо'), type:'bool' });
        if (d.delayed) mainRows.push({ k:'promo_date', label:sfdT('Дата в имени кампании'), type:'date' });
    }
    /* combo, а не select: значение выбирается из справочника ИЛИ вписывается своё —
       новые имена коммуникаций заводятся регулярно, строгий список их бы отсёк. */
    mainRows.push({ k:'comname', label:'Communication name', wide:true, type:'combo',
                    placeholder:'NoComName',
                    opts: sfdDictOpts(SFD_DICT.comm, null, false),
                    fmt:function(){ return SFD_STATE.work.comname; } });

    var secs = [
        { sec:'Основное', rows:mainRows },
        { sec:'Источник и сегментация', rows:segRows }
    ];
    /* Финансовый ассистент: параметры интеграции C2D отдельной секцией */
    if (isFa) secs.push({ sec:'Интеграция FA', rows:[
        { k:'fa_id', label:'FA ID' },
        { k:'channel_id', label:'Channel ID' },
        { k:'need_push', label:'Need Push', type:'bool' },
        { k:'c2d_transport', label:'C2D Transport' },
        { k:'c2d_account', label:'C2D Account' },
        { k:'ch2d_operator_id', label:'CH2D operator ID' }
    ]});
    /* Цепочка: те же поля задаются по дням в таблице секции «Цепочка», и в карточке
       они дубль. Дубль не безобидный — при создании он подставлялся в дни с нетронутой
       ячейкой (см. sfdCreate), то есть текст уезжал туда, где его не вводили, а понять
       это по экрану было нельзя. Убираем из карточки; выключение тумблера возвращает
       поля вместе с набранным — состояние мы не трогаем. */
    if (isCreate && SFD_STATE.chain && SFD_STATE.chain.on){
        var chainKeys = sfdChainKeys(d.channel);
        if (chainKeys.length) content = content.filter(function(f){ return chainKeys.indexOf(f.k) < 0; });
    }
    /* У push по-дневными оказываются все контентные поля разом — секцию тогда не
       показываем совсем, пустая рамка с заголовком выглядит как потерянные поля. */
    if (content.length) secs.push({ sec:'Контент и ссылки', rows:content });
    /* Параметры самой активности — ниже контента: сначала что показываем, потом как */
    if (laRows.length) secs.push({ sec:'Live Activity — параметры активности', rows:laRows });
    var svc = [
        /* Значений всего два и они не меняются — список зашит здесь, справочник в БД
           заводить не за чем (в отличие от product_type/touch_point). Через sfdDictOpts,
           чтобы значение вне списка у старых шаблонов не подменилось молча первым. */
        { k:'communication_type', label:'Communication tunnel', type:'select',
          opts: sfdDictOpts(['adv','service'], d.communication_type, true) },
        { k:'biz_type', label:'Business communication type', type:'select', opts:['','adv','info','service'] },
        { k:'aff_sub3', label:'Landing page' }
    ];
    svc = svc.concat([
        { k:'marketplace', label:'marketplace', type:'bool' },
        { k:'cross', label:'cross', type:'bool' },
        { k:'dialog', label:'dialog', type:'bool' },
        { k:'loyalty', label:'loyalty', type:'bool' },
        { k:'national_rating', label:'national_rating', type:'bool' },
        { k:'news', label:'news', type:'bool' },
        { k:'mobile_app', label:'mobile_app', type:'bool' }
    ]);
    /* night_send есть в таблицах push, sms и live_activity — но не в fa/vk */
    if (!isFa && !isVk) svc.push({ k:'night_send', label:'night_send', type:'bool' });
    secs.push({ sec:'Служебные параметры и флаги', rows: svc });
    return secs;
}

/* ---------- подсказки к полям: назначение + поле в БД ----------
   Таблицы: push → notice.push_template, sms → notice.d_com_sms_template,
   email → notice.email_template, КЦ → callcenter.d_segment_properties. */
var SFD_TABLES = { push:'notice.push_template', 'mobile-push':'notice.push_template',
                   sms:'notice.d_com_sms_template', email:'notice.email_template',
                   cc:'callcenter.d_segment_properties',
                   /* fa/vk/la: у нас поля живут в channel_props, но прод-таблиц ещё нет
                      (в notice есть только sms/push/email). Имена — планируемые, при
                      доставке ProdDbService шлёт ключи channel_props как имена колонок,
                      поэтому окончательные названия сверяем при заведении таблиц. */
                   fa:'notice.fa_template (план)', vk:'notice.vk_template (план)',
                   la:'notice.live_activity_template (план)' };
var SFD_DB = {
    channel:            { all:'—' },
    code:               { push:'code', sms:'code', email:'trigger_code', cc:'segment' },
    active:             { all:'active_flag' },
    comname:            { all:'communication_name' },
    source:             { all:'source_type' },
    trigger:            { all:'trigger_type' },
    product:            { all:'product_type' },
    partner:            { all:'partner_name' },
    touch:              { all:'touch_point' },
    day:                { all:'sending_day' },
    segment:            { cc:'segment' },
    segment_desc:       { cc:'segment_descr' },
    source_system:      { cc:'source_system' },
    host_id:            { cc:'host_id' },
    kvint:              { cc:'kvint_campaign_id' },
    subject:            { email:'subject' },
    email_from:         { email:'email_from' },
    letteros_id:        { email:'letteros_id' },
    message:            { all:'msg_text' },
    title:              { push:'title' },
    sender_name:        { sms:'sender_name' },
    deeplink:           { push:'deep_link', fa:'deep_link' },
    webview:            { push:'webview_url', fa:'webview_url' },
    communication_type: { all:'communication_type' },
    biz_type:           { all:'business_communication_type' },
    aff_sub3:           { all:'aff_sub3' },
    marketplace:        { all:'marketplace' },
    cross:              { all:'—' },
    cc_cross:           { all:'—' },
    autopromo:          { all:'—' },
    delayed:            { all:'—' },
    promo_date:         { all:'—' },
    dialog:             { all:'dialog' },
    loyalty:            { all:'loyalty' },
    national_rating:    { all:'national_rating' },
    news:               { all:'news' },
    mobile_app:         { all:'mobile_app' },
    night_send:         { push:'night_send', sms:'night_send' },
    /* Финансовый ассистент */
    channel_id:         { fa:'channel_id' },
    need_push:          { fa:'need_push' },
    c2d_transport:      { fa:'c2d_transport' },
    c2d_account:        { fa:'c2d_account' },
    ch2d_operator_id:   { fa:'ch2d_operator_id' },
    fa_id:              { fa:'fa_id' },
    vk_template_name:   { vk:'template_name' },
    activity_name:      { la:'activity_name' },
    la_event:           { la:'event' },
    la_visualization:   { la:'visualization' },
    la_visualization_attributes: { la:'visualization_attributes' },
    la_status:          { la:'status' },
    current_step:       { la:'current_step' },
    web_url:            { fa:'web_url' },
    link_title:         { fa:'link_title' },
    action_buttons:     { fa:'action_buttons' },
    /* VK */
    ttl:                { vk:'time_to_live' },
    ab_group:           { vk:'ab_group' },
    buttons:            { vk:'buttons' }
};
var SFD_HELP = {
    channel:            'Канал шаблона: SMS, Mobile-push, E-mail, КЦ, FA (Финансовый ассистент) или VK. Определяет таблицу, в которой хранится шаблон.',
    code:               'Уникальный код шаблона. Для E-mail это Letteros ID, для КЦ — номер сегмента, для FA — FA ID, для VK — имя шаблона.',
    active:             'Шаблон активен и участвует в рассылках.',
    comname:            'Имя коммуникации: база + флаги (marketplace- впереди; -cross, -dialog, -loyalty, -nr, -news, -mobile-app в конце).',
    source:             'Собирается автоматически: promo — канал_promo_продукт_партнёр_comname_ддммгг, trigger — канал_trigger_продукт_comname_Nday. Для КЦ канал заменяется на contact.',
    trigger:            'Тип рассылки: promo или trigger. Определяет формулу source_type.',
    product:            'Продукт (creditcards, credits, deposits и др.). Попадает в source_type.',
    partner:            'Партнёр. В promo попадает в source_type; для базы out-trigger- достраивает communication_name.',
    touch:              'Точка касания: abandoned-form, sign, renewal, issue и др.',
    day:                'День отправки для триггерных рассылок, подставляется в source_type как Nday.',
    segment:            'Код сегмента КЦ — бизнес-ключ записи в справочнике сегментов.',
    segment_desc:       'Описание сегмента для КЦ.',
    source_system:      'Исходная система для КЦ (CRM, Billing и др.).',
    host_id:            'Идентификатор хоста для выгрузки сегмента КЦ.',
    kvint:              'Идентификатор кампании в Kvint (робот-обзвон КЦ).',
    subject:            'Тема письма.',
    email_from:         'Адрес отправителя, считается сам: touch point renewal → renewal@, иначе service → no-reply@, info → inform@, adv+trigger → offers@, adv+promo → advice@, во всех остальных случаях newsletter@.',
    letteros_id:        'Идентификатор письма в Letteros, он же код email-шаблона.',
    message:            'Текст сообщения: тело SMS или push-уведомления, для e-mail — вёрстка письма.',
    title:              'Заголовок push-уведомления — первая строка карточки на экране.',
    sender_name:        'Отправитель SMS: Banki.ru или Bamm.ru.',
    deeplink:           'Диплинк — переход в раздел мобильного приложения.',
    webview:            'Ссылка веб-вью, открывается внутри приложения.',
    communication_type: 'Тип коммуникации: adv, service.',
    biz_type:           'Бизнес-тип: adv (реклама), info (информация), service (сервис). Для e-mail влияет на адрес отправителя.',
    aff_sub3:           'Метка aff_sub3 для партнёрской аналитики.',
    marketplace:        'Продукт маркетплейса: в communication_name добавляется префикс marketplace-.',
    cross:              'Кросс-коммуникация: суффикс -cross. Отдельного поля в БД нет — признак живёт в communication_name.',
    cc_cross:           'Выгрузка в кол-центр: в campaign_name вместо канала встаёт contact (sms_promo_… → contact_promo_…). Отдельного поля в БД нет — признак виден только в самом имени.',
    delayed:            'Отложенное промо: шаблон готовят заранее, и в конце campaign_name ставится не сегодняшняя дата, а выбранная. Больше ничего не меняется. Отдельного поля в БД нет — дата видна в самом имени, оттуда и восстанавливается при открытии.',
    promo_date:         'Дата, которая уйдёт в конец campaign_name в виде ддммгг. Действует только при включённом «Отложенном промо».',
    autopromo:          'Автопромо: к communication_name добавляется суффикс -autopromo, а из campaign_name уходит дата (sms_promo_kk_alfa_leto_110826 → sms_promo_kk_alfa_leto-autopromo). Отдельного поля в БД нет — признак живёт в имени коммуникации.',
    dialog:             'Ведёт на страницу диалога: суффикс -dialog.',
    loyalty:            'Ссылка на продукты лояльности: суффикс -loyalty.',
    national_rating:    'Народный рейтинг: суффикс -nr.',
    news:               'Новостная рассылка: суффикс -news.',
    mobile_app:         'Ведёт на скачивание мобильного приложения: суффикс -mobile-app.',
    night_send:         'Разрешена отправка коммуникации ночью.',
    /* Финансовый ассистент */
    channel_id:         'Идентификатор канала в Финансовом ассистенте.',
    need_push:          'Дублировать сообщение пуш-уведомлением в приложении.',
    c2d_transport:      'Транспорт C2D, через который уходит сообщение Финансового ассистента.',
    c2d_account:        'Учётная запись C2D для отправки.',
    ch2d_operator_id:   'Идентификатор оператора CH2D.',
    fa_id:              'Идентификатор шаблона в Финансовом ассистенте.',
    vk_template_name:   'Имя шаблона на стороне VK.',
    activity_name:      'Имя Live Activity, под которым активность показывается на устройстве.',
    la_event:           'Событие Live Activity: старт, обновление или завершение активности.',
    la_visualization:   'Вариант визуализации Live Activity.',
    la_visualization_attributes: 'Атрибуты визуализации Live Activity, JSON.',
    la_status:          'Статус активности, отображаемый пользователю.',
    current_step:       'Текущий шаг активности (для многошаговых сценариев).',
    web_url:            'Веб-ссылка для перехода из сообщения (открывается в браузере).',
    link_title:         'Подпись ссылки, отображаемая в сообщении.',
    action_buttons:     'Кнопки действий в сообщении, JSON: [{"title":"...","action":"..."}].',
    /* VK */
    ttl:                'Время жизни сообщения (TTL): не доставлено за это время — не отправляется.',
    ab_group:           'Группа A/B-теста шаблона.',
    buttons:            'Кнопки VK-сообщения, JSON: [{"label":"...","link":"..."}].'
};
function sfdDbField(k, channel){
    /* канал сам по себе не колонка — он определяет таблицу хранения */
    if (k === 'channel') return SFD_TABLES[channel] ? sfdT('таблица') + ' ' + SFD_TABLES[channel] : '';
    var m = SFD_DB[k];
    if (!m) return '';
    var col = m.all || m[channel] || m[channel === 'mobile-push' ? 'push' : channel] || '';
    if (!col) return '';
    if (col === '—') return sfdT('отдельного поля нет');
    return (SFD_TABLES[channel] || '') + '.' + col;
}
/* значок (i): подсказка показывается фиксированным попапом (#fieldHelpPopup),
   а не CSS-тултипом — тот обрезался краями карточки и секций */
function sfdHintHtml(f){
    var help = f.help || SFD_HELP[f.k];
    var db = sfdDbField(f.k, SFD_STATE.work.channel);
    if (!help && !db) return '';
    var text = (help ? sfdT(help) : '') + (db ? '\n' + sfdT('Поле в БД') + ': ' + db : '');
    return '<span class="info" tabindex="0" data-help="' + sfdEsc(text) + '"' +
        ' onmouseenter="showFieldHelp(this)" onmouseleave="hideFieldHelp()"' +
        ' onfocus="showFieldHelp(this)" onblur="hideFieldHelp()">i</span>';
}

function sfdRowHtml(f){
    var st = SFD_STATE, d = st.work;
    var raw = f.fmt ? f.fmt(d[f.k]) : d[f.k];
    /* в мастере (создание) поля сразу открыты для ввода, в карточке — по карандашу */
    var editing = (st.mode === 'create') ? !f.ro : !!st.editing[f.k];
    var valHtml;
    if (editing){
        if (f.type === 'bool'){
            valHtml = '<input type="checkbox" class="sfd-edit-check" data-k="' + f.k + '"' + (d[f.k] ? ' checked' : '') + '>';
        } else if (f.type === 'select'){
            valHtml = '<select class="sfd-edit" data-k="' + f.k + '">' + f.opts.map(function(o){
                return '<option value="' + o + '"' + (String(d[f.k] || '') === o ? ' selected' : '') + '>' + (o || '—') + '</option>';
            }).join('') + '</select>';
        } else if (f.type === 'date'){
            /* нативный выбор даты: значение хранится как ГГГГ-ММ-ДД, в имя кампании
               уходит ддммгг (sfdPromoDate) */
            valHtml = '<input type="date" class="sfd-edit" data-k="' + f.k + '"' +
                      ' value="' + sfdEsc(d[f.k] == null ? '' : d[f.k]) + '">';
        } else if (f.type === 'num'){
            /* Не type=number: он в разных браузерах пропускает e, +, - и знаки экспоненты,
               а нам нужны строго цифры. Текстовое поле с числовой клавиатурой на телефоне,
               остальное отсекает обработчик ввода по data-num. */
            valHtml = '<input type="text" class="sfd-edit" data-k="' + f.k + '" data-num="1"' +
                      ' inputmode="numeric" autocomplete="off"' +
                      ' value="' + sfdEsc(d[f.k] == null ? '' : d[f.k]) + '">';
        } else if (f.type === 'combo'){
            /* редактируемая выпадашка: нативный input+datalist — и выбрать из списка,
               и вписать своё, без самодельного дропдауна */
            var lid = 'sfd-dl-' + f.k;
            /* autocomplete="off" обязателен: иначе браузер показывает поверх datalist свою
               историю ввода — то, что когда-то набирали в этом поле. В ней оказываются
               значения с уже приклеенными флагами (NoComName-cross-nr), которых в справочнике
               нет и быть не должно: флаги проставляются галками и считаются сами. Человек
               видит подсказку не из справочника, а из своего же прошлого мусора. */
            var inpHtml = '<input type="text" class="sfd-edit" data-k="' + f.k + '" list="' + lid + '"' +
                      ' autocomplete="off"' +
                      (f.placeholder ? ' placeholder="' + sfdEsc(f.placeholder) + '"' : '') +
                      ' value="' + sfdEsc(d[f.k] == null ? '' : d[f.k]) + '">';
            /* f.create: вписанное значение можно тут же занести в справочник — иначе оно
               осталось бы только в этом шаблоне и в следующий раз его снова набирали бы руками */
            if (f.create && sfdCan('add')){
                inpHtml = '<div class="sfd-combo-add">' + inpHtml +
                    '<button type="button" class="sfd-dict-add" data-k="' + f.k + '"' +
                    ' title="' + sfdT('Добавить значение в справочник') + '"' +
                    ' aria-label="' + sfdT('Добавить значение в справочник') + '">+</button></div>';
            }
            valHtml = inpHtml +
                      '<datalist id="' + lid + '">' + (f.opts || []).map(function(o){
                          return '<option value="' + sfdEsc(o) + '"></option>';
                      }).join('') + '</datalist>';
        } else if (f.type === 'textarea'){
            valHtml = '<textarea class="sfd-edit" data-k="' + f.k + '">' + sfdEsc(d[f.k] == null ? '' : d[f.k]) + '</textarea>';
        } else {
            /* та же причина, что и у combo: история браузера в полях карточки только мешает */
            valHtml = '<input type="text" class="sfd-edit" data-k="' + f.k + '" autocomplete="off"' +
                      ' value="' + sfdEsc(d[f.k] == null ? '' : d[f.k]) + '">';
        }
    } else if (f.type === 'bool'){
        valHtml = '<span class="v">' + (d[f.k] ? '<span class="flag-on">✓ ' + sfdT('да') + '</span>' : '<span class="flag-off">— ' + sfdT('нет') + '</span>') + '</span>';
    } else {
        /* data-view: по нему значение обновляется на месте, без перерисовки карточки
           (см. sfdRefreshViews) — иначе правка одного поля уводила бы курсор из другого */
        valHtml = (raw === undefined || raw === null || raw === '')
            ? '<span class="v empty" data-view="' + f.k + '">—</span>'
            : '<span class="v" data-view="' + f.k + '">' + sfdEsc(raw) + '</span>';
    }
    /* карандаш — только при праве edit; иначе поле остаётся, но правки нет (сервер отбил бы) */
    var pen = (!f.ro && !editing && sfdCan('edit'))
        ? '<button class="sfd-pen" data-k="' + f.k + '" title="' + sfdT('Редактировать') + '" aria-label="' + sfdT('Редактировать') + '">' +
          '<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>'
        : '';
    return '<div class="sfd-row' + (f.wide ? ' wide' : '') + (editing ? ' editing' : '') + '">' +
        '<div class="l">' + sfdEsc(f.label) + sfdHintHtml(f) + '</div>' + valHtml + pen + '</div>';
}

/* ---------- Мастер коммуникаций: та же карточка в режиме создания ---------- */
/* Диплинк пуша почти всегда ведёт в вебвью, и адрес страницы дописывают к служебному
   префиксу. Подставляем его сразу: набирать руками каждый раз незачем, а ошибка в
   префиксе ломает переход молча — приложение просто не откроет ссылку.
   Тот же адрес зашит в старой развёрнутой форме (index.html) и в «Конструкторе
   ссылок» (onelink.js, WEBVIEW_PREFIX) — при переезде мастера на карточку он потерялся. */
var SFD_PUSH_DEEPLINK = 'https://www.banki.ru/deepLink/webview?webviewUrl=';

/* Пустая карточка — действительно пустая.
   Trigger type, Sending day и Sender name раньше приходили с готовыми значениями
   (promo, 0, Banki.ru). Раз эти поля обязательные, подставленное значение — обман:
   в подсказке «заполните» они не появлялись и уезжали в прод такими, какими их
   никто не выбирал. Пусть человек выберет сам; значения никуда не делись — они
   первые в своих списках. */
function sfdBlank(channel){
    /* comname пустой: NoComName стоит плейсхолдером в поле. Раньше он был значением,
       и карточка выглядела заполненной, а завести шаблон не давала. */
    return { channel: channel, code:'', active:true, comname:'', source:'',
             trigger:'', product:'', partner:'', touch:'', day:'',
             message:'', title:'', sender_name:'',
             /* только у пуша и Live Activity: у FA и VK свои правила ссылок */
             deeplink: (channel === 'push' || channel === 'mobile-push' || channel === 'la')
                       ? SFD_PUSH_DEEPLINK : '',
             webview:'', subject:'', email_from:'', letteros_id:'',
             segment:'', segment_desc:'', source_system:'', host_id:'', kvint:'',
             communication_type:'', biz_type:'', aff_sub3:'',
             /* FA */ fa_id:'', channel_id:'', need_push:false, c2d_transport:'', c2d_account:'',
             ch2d_operator_id:'', web_url:'', link_title:'', action_buttons:'',
             /* VK */ vk_template_name:'', ttl:'', ab_group:'', buttons:'',
             /* Live Activity */ activity_name:'', la_event:'', la_visualization:'',
             la_visualization_attributes:'', la_status:'', current_step:'',
             marketplace:false, cross:false, cc_cross:false, autopromo:false, delayed:false, promo_date:'',
             dialog:false, loyalty:false,
             national_rating:false, news:false, mobile_app:false, night_send:false };
}
function wizardCardOpen(channel){
    SFD_STATE = { id:null, orig:null, work: sfdBlank(channel), editing:{}, mode:'create',
                  chain: { on:false, days:'', rows:[] } };
    sfdRecalcNames();
    sfdRender();
}

/* ---------- цепочка: шаблон на каждый день (перенесено из старой формы) ---------- */
/* контент шага по каналам — как в CHAIN_COLUMNS старой формы */
var SFD_CHAIN_COLS = {
    sms:   [{ key:'message',     label:'Message Text', type:'textarea' }],
    push:  [{ key:'title',       label:'Title Text' },
            { key:'message',     label:'Message Text', type:'textarea' },
            { key:'deeplink',    label:'Deep Link' },
            { key:'webview',     label:'Webview link' }],
    email: [{ key:'letteros_id', label:'Letteros Id' }]
};
var SFD_CHAIN_REQ = { sms:['message'], push:['title','message'], email:['letteros_id'] };
function sfdChainAble(ch){ return !!SFD_CHAIN_COLS[ch]; }
/* Поля, которые при включённой цепочке задаются по дням: карточка их прячет,
   sfdCreate не подставляет их в общую часть шаблона. */
function sfdChainKeys(ch){
    return (SFD_CHAIN_COLS[ch] || []).map(function(c){ return c.key; });
}

function sfdChainToggle(on){
    var st = SFD_STATE;
    if (!st || !st.chain) return;
    st.chain.on = !!on;
    if (!on){ st.chain.days = ''; st.chain.rows = []; }
    sfdRender();
}
function sfdChainDays(v){ if (SFD_STATE && SFD_STATE.chain) SFD_STATE.chain.days = v; }
/* В поле дней допустимы только цифры и запятые. Всё остальное sfdChainBuild либо молча
   отбрасывает (буквы превращаются в NaN и выпадают из списка), либо принимает за
   разделитель — и человек получает не те шаги, не поняв почему. Отсекаем на вводе,
   позицию курсора сохраняем, иначе правка середины строки прыгает в конец. */
function sfdChainDaysInput(inp){
    /* Пробел и «;» не выкидываем, а превращаем в запятую: они и раньше работали
       разделителями, и вставленное «0 3 7» иначе слиплось бы в один день 037 —
       ошибка молчаливая и заметная только по числу шагов. Остальное отбрасываем. */
    var было = inp.value,
        стало = было.replace(/[\s;]+/g, ',').replace(/[^\d,]+/g, '').replace(/,{2,}/g, ',');
    if (было !== стало){
        var pos = (inp.selectionStart || 0) - (было.length - стало.length);
        inp.value = стало;
        try { inp.setSelectionRange(pos, pos); } catch(e){}
    }
    sfdChainDays(inp.value);
}
function sfdChainBuild(){
    var st = SFD_STATE;
    if (!st || !st.chain) return;
    var days = String(st.chain.days || '').split(/[\s,;]+/)
        .map(function(s){ return s.trim(); }).filter(Boolean)
        .map(Number).filter(function(n){ return !isNaN(n); });
    if (!days.length){ alert(sfdT('Введите хотя бы один день (число), напр. 0, 3, 7')); return; }
    if (new Set(days).size !== days.length){ alert(sfdT('Дни не должны повторяться')); return; }
    /* при перегенерации значения уже заполненных дней сохраняем */
    var old = {};
    st.chain.rows.forEach(function(r){ old[r.day] = r.overrides; });
    st.chain.rows = days.map(function(day){
        return { day: day, overrides: old[day] || {} };
    });
    sfdRender();
}
function sfdChainSet(i, key, v){
    var st = SFD_STATE;
    if (st && st.chain && st.chain.rows[i]) st.chain.rows[i].overrides[key] = v;
}
/* HTML секции «Цепочка» в карточке мастера */
function sfdChainHtml(d){
    var st = SFD_STATE, ch = st.chain;
    var cols = SFD_CHAIN_COLS[d.channel] || [];
    var body = '<label class="sfd-chain-on"><input type="checkbox"' + (ch.on ? ' checked' : '') +
        ' onchange="sfdChainToggle(this.checked)"> <b>Is chain</b> — ' +
        sfdT('шаблон на каждый день цепочки') + '</label>';
    if (ch.on){
        body += '<div class="sfd-chain-days"><span>' + sfdT('Дни цепочки (числа через запятую)') + '</span>' +
            '<input class="sfd-edit" value="' + sfdEsc(ch.days) + '" placeholder="0,3,7"' +
            ' inputmode="numeric" autocomplete="off"' +
            ' oninput="sfdChainDaysInput(this)"' +
            ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();sfdChainBuild();}">' +
            '<button type="button" class="sf-btn" onclick="sfdChainBuild()">' + sfdT('Сгенерировать строки') + '</button></div>';
        if (ch.rows.length){
            body += '<div class="sfd-chain-tbl-wrap"><table class="sfd-chain-tbl"><thead><tr>' +
                '<th style="width:64px">' + sfdT('День') + '</th>' +
                cols.map(function(c){ return '<th>' + sfdEsc(c.label) + '</th>'; }).join('') +
                '</tr></thead><tbody>' +
                ch.rows.map(function(r, i){
                    return '<tr><td class="d">' + r.day + '</td>' + cols.map(function(c){
                        var v = sfdEsc(r.overrides[c.key] == null ? '' : r.overrides[c.key]);
                        return '<td>' + (c.type === 'textarea'
                            ? '<textarea class="sfd-edit" rows="2" oninput="sfdChainSet(' + i + ',\'' + c.key + '\',this.value)">' + v + '</textarea>'
                            : '<input class="sfd-edit" value="' + v + '" oninput="sfdChainSet(' + i + ',\'' + c.key + '\',this.value)">') + '</td>';
                    }).join('') + '</tr>';
                }).join('') + '</tbody></table></div>';
        }
        body += '<div class="sfd-chain-note">' + sfdT('На каждый день при создании заводится отдельный шаблон со своим source_type (по дню).') + '</div>';
    }
    return '<div class="sfd-sec"><div class="sfd-sec-title" onclick="this.parentElement.classList.toggle(\'closed\')">' +
        sfdT('Цепочка') + '</div><div class="sfd-chain">' + body + '</div></div>';
}
/* Поля, без которых шаблон не заводится.
   Список общий для всех каналов, но спрашиваются только те, что есть в карточке
   ЭТОГО канала: набор полей у sms, e-mail, КЦ и пушей разный (sfdFieldDefs), и
   требовать «Sender name» у письма было бы не с чего. Поэтому список сверяется
   с реально нарисованными полями, а не перечисляется по каналам руками —
   иначе новый канал молча остался бы без проверок.
   comname здесь нет: у него своё правило (см. ниже, NoComName). */
var SFD_REQUIRED = ['trigger', 'product', 'partner', 'touch', 'day', 'message',
                    'sender_name', 'communication_type', 'biz_type', 'aff_sub3'];

/* обязательные поля нового шаблона; при цепочке code и контент задаются по дням */
function sfdCreateMissing(d){
    var miss = [];
    var chainOn = SFD_STATE && SFD_STATE.mode === 'create' && SFD_STATE.chain && SFD_STATE.chain.on;
    /* Код требуем только у КЦ: там это номер сегмента, который задаёт человек.
       Остальным каналам код выдаёт бэкенд, и поля в форме больше нет. */
    if (d.channel === 'cc' && !chainOn && !String(d.code == null ? '' : d.code).trim()) {
        miss.push(sfdCodeLabel(d.channel));
    }
    /* В проде source_system у d_segment_properties NOT NULL без дефолта: пустое поле
       заводило шаблон у нас, а в прод не уезжало (см. пре-флайт в TemplateService). */
    if (d.channel === 'cc' && !String(d.source_system || '').trim()) miss.push('Source system');
    /* Подписи берём из самой карточки: в сообщении человек читает ровно то,
       что видит над полем. */
    var shown = {};
    sfdFieldDefs(d).forEach(function(s){
        (s.rows || []).forEach(function(f){ if (f && !f.ro) shown[f.k] = f.label; });
    });
    /* Идём по полям в порядке карточки, а не по списку обязательных: тогда подсказка
       читается сверху вниз ровно так, как человек будет их заполнять. */
    Object.keys(shown).forEach(function(k){
        if (k === 'comname'){
            /* Имя обязательно и проверяется как обычное поле: карточка теперь открывается
               с пустым полем и плейсхолдером NoComName, так что «не трогали» и «выбрали
               осознанно» различать больше не нужно — раньше ради этого держали флаг
               comnameTouched, и из-за него шаблон не заводился с виду заполненным полем. */
            if (!String(d.comname || '').trim()) miss.push('communication_name');
            return;
        }
        if (SFD_REQUIRED.indexOf(k) < 0) return;          /* поле не обязательное */
        /* Sending day при цепочке берётся из строк таблицы (sfdCreate подставляет
           день каждому шаблону), в карточке он пустой и требовать его нечего. */
        if (chainOn && k === 'day') return;
        var v = d[k];
        if (v == null || !String(v).trim()) miss.push(shown[k]);
    });
    /* У e-mail контент живёт в Letteros, а тему проставляет отправка — требуем не текст,
       а Letteros ID: он же становится кодом шаблона, и без него за шаблоном не стоит
       никакого письма. При цепочке ID задаётся по дням в таблице. */
    if (d.channel === 'email' && !chainOn
        && !String(d.letteros_id == null ? '' : d.letteros_id).trim()) miss.push('Letteros ID');
    /* FA ID требует сам прод: notice.fa_template закрыт проверкой chk_fa_or_msg_null,
       и она в обеих ветках требует fa_id непустым. Без этой строки шаблон сохранялся
       у нас и падал уже в очереди доставки — с ошибкой, которую видел не автор. */
    if (d.channel === 'fa' && !String(d.fa_id == null ? '' : d.fa_id).trim()) miss.push('FA ID');
    /* Message text отдельной строкой здесь больше нет: он в SFD_REQUIRED, а карточка
       при включённой цепочке сама убирает по-дневные поля — проверка идёт по ним. */
    return miss;
}
function sfdCreate(){
    var st = SFD_STATE;
    if (!st || st.mode !== 'create') return;
    if (!sfdCan('add')){ alert(sfdT('Нет прав на создание шаблонов.')); return; }
    sfdRecalcNames();
    var d = Object.assign({}, st.work);
    if (sfdCreateMissing(d).length) return;
    function refreshList(){
        if (typeof loadMockData === 'function'){
            loadMockData().then(function(){
                if (typeof applyFilters === 'function' && document.getElementById('templateListBody')) applyFilters();
            });
        }
    }

    /* ---- цепочка: отдельный шаблон на каждый день, source считается по дню ---- */
    if (st.chain && st.chain.on && sfdChainAble(d.channel)){
        var rows = st.chain.rows;
        if (!rows.length){ alert(sfdT('Сгенерируйте строки: введите дни и нажмите «Сгенерировать строки».')); return; }
        var req = SFD_CHAIN_REQ[d.channel] || [];
        var cols = SFD_CHAIN_COLS[d.channel] || [];
        for (var i = 0; i < rows.length; i++){
            for (var j = 0; j < req.length; j++){
                if (!String(rows[i].overrides[req[j]] || '').trim()){
                    var lbl = (cols.filter(function(c){ return c.key === req[j]; })[0] || {}).label || req[j];
                    alert(sfdT('Заполните') + ' «' + lbl + '» ' + sfdT('для дня') + ' ' + rows[i].day);
                    return;
                }
            }
        }
        window.CRM_CURRENT = null;   /* цепочка — всегда создание */
        /* По-дневные поля вычищаем из общей части: значение, набранное до включения
           тумблера, иначе досталось бы дням с пустой ячейкой — а поля этого в карточке
           уже не видно. Каждый день берёт контент только из своей строки таблицы. */
        var base = Object.assign({}, d);
        sfdChainKeys(d.channel).forEach(function(k){ base[k] = ''; });
        /* Дни цепочки делят одно имя кампании, поэтому спрашиваем про дубль один раз —
           по первому дню, — а остальные идут с уже полученным согласием. Иначе второй
           день упирался бы в только что созданный первый. */
        var first = Object.assign({}, base, rows[0].overrides, { day: String(rows[0].day) });
        var firstSrc = sfdComputeCampaignName(first);
        if (firstSrc) first.source = firstSrc;
        sfdGuardDuplicate(first).then(function(go){
            if (!go) return;
            var seq = rows.reduce(function(p, row){
                return p.then(function(acc){
                    var dd = Object.assign({}, base, row.overrides, { day: String(row.day) });
                    if (dd.channel === 'email' && dd.letteros_id) dd.code = dd.letteros_id;
                    var src = sfdComputeCampaignName(dd);
                    if (src) dd.source = src;
                    return CRM.saveFromV1(dd, { force: go.force || acc.length > 0 })
                        .then(function(r){ acc.push(r && r.code); return acc; });
                });
            }, Promise.resolve([]));
            return seq.then(function(codes){
                alert(sfdT('Цепочка создана') + ': ' + rows.length + ' ' + sfdT('шаблон(ов)') +
                    '.\nCode: ' + codes.filter(Boolean).join(', '));
                refreshList();
                wizardCardOpen(d.channel);
            });
        }).catch(function(e){ alert(sfdT('Ошибка сохранения') + ': ' + (e && e.message ? e.message : e)); });
        return;
    }

    /* ---- одиночный шаблон ---- */
    if (d.channel === 'email' && !d.letteros_id) d.letteros_id = d.code;
    window.CRM_CURRENT = null;   /* новый шаблон — POST, а не PUT */
    sfdGuardDuplicate(d).then(function(go){
        if (!go) return;
        return CRM.saveFromV1(d, go).then(function(res){
            var code = (res && res.code != null) ? res.code : d.code;
            alert(sfdT('Шаблон создан') + '.\ncommunication_name: ' + (d.comname || '') + '\nCode: ' + code);
            refreshList();
            wizardCardOpen(d.channel);
        });
    }).catch(function(e){ alert(sfdT('Ошибка сохранения') + ': ' + (e && e.message ? e.message : e)); });
}
/* мастер: обновляем подвал (чего не хватает) без перерисовки — чтобы не терять фокус */
function sfdSyncCreate(){
    var st = SFD_STATE;
    if (!st || st.mode !== 'create') return;
    var miss = sfdCreateMissing(st.work);
    var box = document.querySelector('#wizardOutput .sfd-miss');
    var btn = document.getElementById('sfdCreateBtn');
    if (btn) btn.disabled = !!miss.length;
    if (box) box.textContent = miss.length ? (sfdT('Заполните') + ': ' + miss.join(', ')) : '';
    else if (miss.length){
        var foot = document.querySelector('#wizardOutput .sfd-footer');
        if (foot){
            var s = document.createElement('span');
            s.className = 'sfd-miss';
            s.textContent = sfdT('Заполните') + ': ' + miss.join(', ');
            foot.insertBefore(s, foot.firstChild);
        }
    }
}
/* Старые развёрнутые формы каналов остаются в DOM скрытыми: их функции
   (collectFormData, computeCampaignName, saveFromChannelForm) используются
   как библиотека, но отдельной кнопки для форм больше нет — цепочка
   перенесена в карточку (секция «Цепочка»). */

/* ============================================================ СОБЫТИЯ ШАБЛОНА

   Обратная сторона связи flow.d_event_template: в карточке события видно его
   шаблоны, здесь — события, которые по этому шаблону ходят. Блок стоит колонкой
   справа, как связанные объекты у клиента и у события.

   Ответ кэшируем по паре канал+код: карточка перерисовывается на каждую правку
   поля, и запрос на каждый рендер означал бы десятки одинаковых обращений. */
var SFD_EVENTS = {};      /* "канал:код" -> {state:'load'|'ok'|'err'|'deny', rows:[]} */
function sfdEvKey(d){
    var code = (d && d.code != null && d.code !== '') ? d.code : (d && d.letteros_id);
    return (d && d.channel && code) ? (d.channel + ':' + code) : null;
}
function sfdEnsureEvents(d){
    var key = sfdEvKey(d);
    if (!key || SFD_EVENTS[key]) return SFD_EVENTS[key] || null;
    SFD_EVENTS[key] = { state:'load', rows:[] };
    var i = key.indexOf(':');
    fetch('/api/events/by-template?channel=' + encodeURIComponent(key.slice(0, i)) +
          '&code=' + encodeURIComponent(key.slice(i + 1)),
          { credentials:'same-origin', headers:{ Accept:'application/json' } })
        .then(function(r){
            /* 403 — у роли нет доступа к событиям. Это не ошибка карточки шаблона:
               блок просто скажет, что показывать нечего, и не станет пугать красным. */
            if (r.status === 403) { SFD_EVENTS[key] = { state:'deny', rows:[] }; return null; }
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(function(rows){ if (rows) SFD_EVENTS[key] = { state:'ok', rows:rows || [] }; })
        .catch(function(){ SFD_EVENTS[key] = { state:'err', rows:[] }; })
        .then(function(){ sfdRenderUnlessTyping(); });
    return SFD_EVENTS[key];
}
var SFD_EV_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/>' +
    '<path d="M16 2v4M8 2v4M3 10h18"/></svg>';
function sfdEventsRailHtml(d){
    var got = sfdEnsureEvents(d);
    if (!got) return '';
    var body;
    if (got.state === 'load') {
        body = '<div class="sfd-rl-empty">' + sfdT('читаю…') + '</div>';
    } else if (got.state === 'deny') {
        body = '<div class="sfd-rl-empty">' + sfdT('нет доступа к событиям') + '</div>';
    } else if (got.state === 'err') {
        body = '<div class="sfd-rl-empty">' + sfdT('не удалось загрузить') + '</div>';
    } else if (!got.rows.length) {
        body = '<div class="sfd-rl-empty">' + sfdT('событий нет') + '</div>';
    } else {
        body = got.rows.map(function(x){
            var sub = (x.kind === 'time' ? sfdT('по расписанию') : sfdT('онлайновое')) +
                (x.step_no == null ? '' : ' · ' + sfdT('шаг') + ' ' + sfdEsc(x.step_no)) +
                (x.is_active ? '' : ' · ' + sfdT('выключено'));
            return '<div class="sfd-rl-item" data-ev-id="' + sfdEsc(x.id) + '">' +
                '<div class="t">' + sfdEsc(x.event_name || ('#' + x.id)) + '</div>' +
                '<div class="s">' + sub + '</div>' +
                '<div class="n">#' + sfdEsc(x.id) + '</div>' +
            '</div>';
        }).join('');
    }
    return '<section class="sfd-rl"><header class="sfd-rl-head">' +
        '<span class="ico">' + SFD_EV_ICO + '</span><b>' + sfdT('События') + '</b>' +
        '<span class="cnt">' + (got.state === 'ok' ? got.rows.length : '—') + '</span></header>' +
        '<div class="sfd-rl-body">' + body + '</div>' +
        '<div class="sfd-rl-foot">flow.d_event_template.template_id → template.d_template.id</div>' +
    '</section>';
}

function sfdRender(){
    var st = SFD_STATE;
    if (!st) return;
    var isCreate = st.mode === 'create';
    var output = document.getElementById(isCreate ? 'wizardOutput' : 'settingsOutput');
    if (!output) return;
    var d = st.work;
    /* Справочники тянем при первой отрисовке канала; когда приедут — перерисуемся.
       Повторных запросов нет: sfdEnsureDicts помнит, что уже спрашивал. */
    sfdEnsureDicts(d.channel);
    var chLabels = CH_LABELS;
    var isEmail = d.channel === 'email';
    var mainId = isEmail
        ? (d.letteros_id != null && d.letteros_id !== '' ? d.letteros_id : d.code)
        : (d.code != null && d.code !== '' ? d.code : d.letteros_id);
    var dirty = Object.keys(st.editing).length > 0;
    var secs = sfdFieldDefs(d);
    var miss = isCreate ? sfdCreateMissing(d) : [];

    output.innerHTML =
        /* в мастере верхней кнопки нет: цепочка — секцией в самой карточке */
        (isCreate
            ? ''
            /* список переехал в «Сущности» → «Шаблоны и сегменты» */
            : '<div class="sfd-top"><button type="button" class="sf-btn" onclick="openSection(\'entities\',\'ent-template\')">' +
                sfdT('← К списку шаблонов') + '</button></div>') +
        /* Заводимому шаблону колонка событий не нужна: связей у него ещё нет. */
        '<div class="sfd-layout' + (isCreate ? ' no-rail' : '') + '"><div class="sfd-main"><div class="sfd">' +
        '<div class="sfd-head">' +
            '<span class="sfd-ch">' + sfdEsc(chLabels[d.channel] || d.channel) + '</span>' +
            '<b>' + (isCreate
                ? sfdT('Новый шаблон') + (String(d.code || '').trim() ? ' · ' + sfdEsc(d.code) : '') + ' — ' + sfdEsc(d.comname || '')
                : sfdEsc(mainId == null ? '' : mainId) + ' — ' + sfdEsc(d.comname || '')) + '</b>' +
            '<span class="sfd-status ' + (d.active ? 'on' : 'off') + '">' + sfdT(d.active ? 'АКТИВНЫЙ' : 'НЕАКТИВНЫЙ') + '</span>' +
        '</div>' +
        secs.map(function(s){
            return '<div class="sfd-sec"><div class="sfd-sec-title" onclick="this.parentElement.classList.toggle(\'closed\')">' + sfdEsc(sfdT(s.sec)) + '</div>' +
                '<div class="sfd-grid">' + s.rows.map(sfdRowHtml).join('') + '</div></div>';
        }).join('') +
        (isCreate && sfdChainAble(d.channel) ? sfdChainHtml(d) : '') +
        (isCreate
            ? '<div class="sfd-footer">' +
                (sfdCan('add')
                    ? (miss.length ? '<span class="sfd-miss">' + sfdT('Заполните') + ': ' + sfdEsc(miss.join(', ')) + '</span>' : '') +
                      '<button type="button" class="sf-btn accent" id="sfdCreateBtn"' + (miss.length ? ' disabled' : '') + '>' +
                          ((st.chain && st.chain.on)
                              ? sfdT('Создать цепочку') + (st.chain.rows.length ? ' (' + st.chain.rows.length + ')' : '')
                              : sfdT('Создать шаблон')) + '</button>' +
                      '<button type="button" class="sf-btn" id="sfdResetBtn">' + sfdT('Очистить') + '</button>'
                    /* нет права add: мастер открыт (раздел виден), но заводить нечем */
                    : '<span class="sfd-miss">' + sfdT('Нет прав на создание шаблонов.') + '</span>') +
              '</div>'
            /* save появляется только при dirty, а dirty возникает лишь через карандаш (edit),
               который уже скрыт без права — но подстрахуемся и здесь */
            : (dirty && sfdCan('edit') ? '<div class="sfd-footer">' +
                '<button type="button" class="sf-btn accent" id="sfdSaveBtn">' + sfdT('Сохранить') + '</button>' +
                '<button type="button" class="sf-btn" id="sfdCancelBtn">' + sfdT('Отменить') + '</button>' +
              '</div>' : '')) +
        '</div></div>' +
        (isCreate ? '' : '<aside class="sfd-rail">' + sfdEventsRailHtml(d) + '</aside>') +
        '<div class="sfd-side"></div></div>';

    /* переход в карточку события — той же дорогой, что и из списка событий */
    output.querySelectorAll('.sfd-rl-item[data-ev-id]').forEach(function(it){
        it.onclick = function(){
            if (typeof window.openEventCard === 'function') window.openEventCard(it.dataset.evId);
        };
    });

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
        var handler = function(commit){
            var k = inp.dataset.k;
            /* числовое поле: вычищаем всё, кроме цифр, прямо в поле — иначе набранная
               буква осталась бы на экране и уехала бы в source_type как часть Nday.
               Позицию курсора держим, чтобы правка в середине значения не прыгала. */
            if (inp.dataset.num){
                var было = inp.value, стало = было.replace(/\D+/g, '');
                if (было !== стало){
                    var pos = (inp.selectionStart || 0) - (было.length - стало.length);
                    inp.value = стало;
                    try { inp.setSelectionRange(pos, pos); } catch(e){}
                }
            }
            st.work[k] = inp.type === 'checkbox' ? inp.checked : inp.value;
            /* тумблер Live Activity — не поле шаблона, а переключатель канала:
               набранное (текст, ссылки, сегментация) остаётся, меняется только
               набор канальных полей и таблица, в которую шаблон уедет */
            if (k === 'is_la') st.work.channel = inp.checked ? 'la' : 'push';
            /* Подстановки, меняющие ДРУГИЕ поля карточки: типовые значения promo и
               посадочная из ссылки. Разбор ссылки — только по commit (change/blur):
               на каждый набранный символ он давал бы новое значение, а перерисовка
               из-под рук уводит каретку из поля, в котором печатают. */
            var filled = false;
            if (k === 'trigger') filled = sfdApplyPromoDefaults(st.work);
            if (commit && sfdLinkFieldsOf(st.work.channel).indexOf(k) >= 0) {
                filled = sfdApplyLandingFromLink() || filled;
            }
            if (SFD_NAME_KEYS[k] || k === 'biz_type' || filled) sfdRecalcNames();
            sfdRenderPreview();
            /* пересчитанные имена показываем на месте: перерисовывать всю карточку
               ради одной строки незачем, а курсор из поля она уводит */
            sfdRefreshViews();
            return filled;
        };
        inp.addEventListener('input', function(){ handler(false); if (isCreate) sfdSyncCreate(); });
        /* чекбоксы и селекты: после change перерисовываем карточку,
           чтобы пересчитанные comname/source сразу были видны.
           В мастере то же делаем по потере фокуса у текстовых полей */
        inp.addEventListener('change', function(){
            var filled = handler(true);
            /* Перерисовываем только когда меняется НАБОР строк: тип отправителя открывает
               «Отложенное промо», сам флаг — поле даты, тумблер LA — канальные поля.
               Для остальных значений хватает обновления на месте, а перерисовка ломала
               ввод: поле даты пересоздавалось после каждого сегмента, и число набрать
               было невозможно. */
            if (SFD_RELAYOUT[inp.dataset.k] || filled) sfdRender();
        });
    });
    /* «+» рядом с combo: занести введённое значение в справочник */
    output.querySelectorAll('.sfd-dict-add').forEach(function(btn){
        btn.onclick = function(){ sfdDictAdd(btn.dataset.k, btn); };
    });
    var createBtn = document.getElementById('sfdCreateBtn');
    if (createBtn) createBtn.onclick = sfdCreate;
    var resetBtn = document.getElementById('sfdResetBtn');
    if (resetBtn) resetBtn.onclick = function(){ wizardCardOpen(d.channel); };
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
    if (!sfdCan('edit')){ alert(sfdT('Нет прав на изменение шаблона.')); return; }
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
/* Письмо живёт в Letteros, у нас от него только идентификатор: показываем
   опубликованную версию по адресу webv/<letteros_id>. У части шаблонов
   letteros_id пуст, а идентификатор лежит в code — порядок тот же, что в
   sfdBizCode и при сохранении (sfdCreate: code = letteros_id). */
var SFD_LETTEROS_BASE = 'https://app.letteros.com/webv/';
var SFD_EM_TIMER = null;
function sfdLetterosUrl(d){
    if (!d || (d.channel !== 'email')) return '';
    var id = (d.letteros_id != null && d.letteros_id !== '') ? d.letteros_id : d.code;
    id = String(id == null ? '' : id).trim();
    return id ? SFD_LETTEROS_BASE + encodeURIComponent(id) : '';
}

/* Проверяем, помещается ли текст в карточку уведомления: заголовок обрезается
   одной строкой, тело — четырьмя (как в свёрнутом пуше на экране блокировки). */
function sfdPushFit(side){
    var box = side.querySelector('.pv-fit');
    if (!box) return;
    var over = [];
    var ttl = side.querySelector('.pv-push-title');
    var bdy = side.querySelector('.pv-push-body');
    if (ttl && ttl.scrollHeight - ttl.clientHeight > 1) over.push(sfdT('заголовок'));
    if (bdy && bdy.scrollHeight - bdy.clientHeight > 1) over.push(sfdT('текст'));
    if (over.length){
        box.className = 'pv-fit bad';
        box.textContent = sfdT('Не помещается') + ': ' + over.join(', ') + ' — ' +
            sfdT('часть будет скрыта под «ещё». Заголовок — 1 строка, текст — до 4 строк.');
    } else {
        box.className = 'pv-fit ok';
        box.textContent = sfdT('Текст помещается в карточку уведомления полностью.');
    }
}
function sfdRenderPreview(){
    var st = SFD_STATE;
    if (!st) return;
    /* карточка мастера и карточка просмотра живут в разных контейнерах —
       ищем панель предпросмотра внутри своего, а не по общему id */
    var host = document.getElementById(st.mode === 'create' ? 'wizardOutput' : 'settingsOutput');
    var side = host ? host.querySelector('.sfd-side') : null;
    if (!side) return;
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
        side.innerHTML = '<div class="pv-card"><div class="pv-title">' + sfdT('Предпросмотр Mobile-push') + '</div>' +
            '<div class="pv-push">' +
                '<div class="pv-push-head"><span class="pv-push-appico"></span><span class="pv-push-app">Banki.ru</span><span class="pv-push-when">' + sfdT('сейчас') + '</span></div>' +
                '<div class="pv-push-title">' + sfdEsc(d.title || d.comname || '—') + '</div>' +
                '<div class="pv-push-body">' + sfdEsc(d.message || '—') + '</div>' +
            '</div>' +
            '<div class="pv-fit"></div>' +
            (d.deeplink ? '<div class="pv-note">Deep link: ' + sfdEsc(d.deeplink) + '</div>' : '') +
            '<div class="pv-note">' + sfdT('Пример отображения. Точный вид зависит от устройства и версии ОС.') + '</div></div>';
        sfdPushFit(side);
        return;
    }
    if (ch === 'fa' || ch === 'vk'){
        /* сообщение мессенджера: бабл + кнопки из JSON (Action Buttons / Buttons) */
        var btns = [];
        try {
            var arr = JSON.parse((ch === 'fa' ? d.action_buttons : d.buttons) || '[]');
            if (Array.isArray(arr)) btns = arr.map(function(b){
                return b && (b.title || b.label) ? String(b.title || b.label) : null;
            }).filter(Boolean);
        } catch(e){}
        side.innerHTML = '<div class="pv-card"><div class="pv-title">' +
            sfdT(ch === 'fa' ? 'Предпросмотр FA' : 'Предпросмотр VK') + '</div>' +
            '<div class="pv-im ' + ch + '">' +
                '<div class="pv-im-head"><span class="pv-im-ava ' + ch + '"></span>' +
                    '<b>' + (ch === 'fa' ? sfdT('Финансовый ассистент') : 'Banki.ru') + '</b>' +
                    '<span class="pv-push-when">' + sfdT('сейчас') + '</span></div>' +
                '<div class="pv-im-bubble">' + sfdEsc(d.message || '—') + '</div>' +
                (btns.length ? '<div class="pv-im-btns">' + btns.map(function(b){ return '<span>' + sfdEsc(b) + '</span>'; }).join('') + '</div>' : '') +
            '</div>' +
            (ch === 'fa' && d.need_push ? '<div class="pv-note">Need Push: ' + sfdT('сообщение дублируется пуш-уведомлением.') + '</div>' : '') +
            '<div class="pv-note">' + sfdT('Пример отображения. Точный вид зависит от устройства и версии ОС.') + '</div></div>';
        return;
    }
    if (ch === 'email'){
        var url = sfdLetterosUrl(d);
        /* Тот же адрес — карточку не трогаем вовсе: iframe пересоздался бы, и Letteros
           перезагружался на каждое нажатие клавиши в любом поле (превью зовётся с
           каждого input). Показывать в шапке нечего — тема письма задаётся отправкой. */
        var было = side.querySelector('.pv-em-frame');
        if (url && было && было.dataset.url === url) return;
        var тело;
        if (url){
            /* sandbox оставляем: письмо чужое. allow-same-origin здесь безопасен —
               документ сохраняет свой origin (app.letteros.com), то есть остаётся
               кросс-доменным для панели и до её DOM не дотянется. */
            тело = '<iframe class="pv-em-frame" title="Letteros" referrerpolicy="no-referrer"' +
                   ' sandbox="allow-scripts allow-same-origin allow-popups"></iframe>' +
                   '<div class="pv-em-foot"><a href="' + sfdEsc(url) + '" target="_blank" rel="noopener noreferrer">' +
                   sfdT('Открыть в Letteros') + ' ↗</a><span>' +
                   sfdT('Письмо подтягивается из Letteros по Letteros ID. Пустое окно означает, что письма с таким ID нет или Letteros недоступен из браузера.') +
                   '</span></div>';
        } else if (d.message){
            тело = '<iframe class="pv-em-frame" sandbox="" title="Letteros"></iframe>';
        } else {
            тело = '<div class="pv-em-stub">' + sfdT('Укажите Letteros ID — письмо подтянется из Letteros') + '</div>';
        }
        side.innerHTML = '<div class="pv-card"><div class="pv-title">' + sfdT('Предпросмотр E-mail') + '</div>' +
            '<div class="pv-em"><div class="pv-em-head">Letteros-шаблон</div>' + тело + '</div></div>';
        var fr = side.querySelector('.pv-em-frame');
        if (fr && !url){ fr.srcdoc = d.message; return; }
        if (fr){
            fr.dataset.url = url;
            /* ID набирается посимвольно, и каждый промежуточный вариант — это запрос к
               Letteros за несуществующим письмом. Грузим, когда человек допечатал. */
            clearTimeout(SFD_EM_TIMER);
            SFD_EM_TIMER = setTimeout(function(){
                /* Ищем внутри своего host: карточка мастера и карточка просмотра живут
                   в DOM одновременно, и поиск по документу находил чужой iframe. */
                var f = host.querySelector('.pv-em-frame');
                if (f && f.dataset.url === url && f.src !== url) f.src = url;
            }, 500);
        }
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
        else if (classes.includes('cb-autopromo')) data.autopromo = val;
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
        /* Про дубль спрашиваем один раз, по первому дню: имя кампании у дней общее,
           и второй день упирался бы в только что созданный первый. */
        var firstDay = Object.assign({}, data, rows[0].overrides, {
            day: String(rows[0].day),
            source: computeCampaignName(formEl, rows[0].day)
        });
        sfdGuardDuplicate(firstDay).then(function (go) {
            if (!go) return;
            var seq = rows.reduce(function (p, row) {
                return p.then(function (acc) {
                    var d = Object.assign({}, data, row.overrides, {
                        day: String(row.day),
                        source: computeCampaignName(formEl, row.day)
                    });
                    return CRM.saveFromV1(d, { force: go.force || acc.length > 0 })
                        .then(function (r) { acc.push(r && r.code); return acc; });
                });
            }, Promise.resolve([]));
            return seq.then(function (codes) {
                alert('Цепочка сохранена: ' + rows.length + ' шаблон(ов).\nCode: ' + codes.filter(Boolean).join(', '));
                window.CRM_CURRENT = null;
                afterChannelSave();
            });
        }).catch(function (e) { alert('Ошибка сохранения цепочки: ' + (e && e.message ? e.message : e)); });
        return;
    }

    // ---- Одиночный шаблон ----
    data.source = computeCampaignName(formEl, undefined) || data.source;
    /* Проверка молчит, когда это правка открытого шаблона: спрашивать «такой уже есть»
       про него же самого было бы издевательством (см. sfdGuardDuplicate). */
    sfdGuardDuplicate(data).then(function (go) {
        if (!go) return;
        return CRM.saveFromV1(data, go).then(function (r) {
            alert('Сохранено.\ncommunication_name: ' + data.comname + '\nCode: ' + (r && r.code != null ? r.code : ''));
            window.CRM_CURRENT = null;
            afterChannelSave();
        });
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
            /* Канал выбран блоком выше — в подписи он лишний. Оставляем его только
               если канал почему-то не задан: тогда список сборный, а коды между
               каналами повторяются и без префикса не различить. */
            var ch = VIEWER_CHANNEL ? '' : ((CH_LABELS[t.channel] || t.channel || '') + ' · ');
            /* Номер шаблона и source_type: именно по source_type шаблон и ищут (поле
               поиска рядом). communication_name — запасной вариант: у части записей
               source_type пуст, и подпись выродилась бы в голый номер. */
            var подпись = t.source || t.name || String(t.code);
            opt.textContent = ch + t.code + ' — ' + подпись +
                              (t.active ? '' : ' ' + sfdTT('(неактивный)'));
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
