/* OneLink Builder (#sec-onelink): сборка диплинков AppsFlyer —
   правила каналов, предпросмотр и копирование ссылки. Чисто клиентский раздел. */
  const ONE_LINK_BASE='https://banki.onelink.me/JmaP';
  const DEFAULT_WEB_DP='https://mobile.banki.ru/';

  const LABELS={channel:'Канал',mailingType:'Тип рассылки',
    deepLinkValue:'deep_link_value',webviewUrl:'webview_url'};

  const els={};
  ['channel','mailingType',
   'webDp','webviewFlag','webviewWrap','webviewUrl','deepLinkValue','iosUrl','androidUrl',
   'result','resultCard','banner','draftNote','copyBtn','dockToggle']
   .forEach(id=>els[id]=document.getElementById(id));

  function normalizeSpaces(v){return (v||'').trim().replace(/\s+/g,'');}

  function normalizeDeepLink(raw){
    let v=normalizeSpaces(raw);
    if(!v) return '';
    try{ if(/%[0-9A-Fa-f]{2}/.test(v)) v=decodeURIComponent(v); }catch(e){}
    if(v.startsWith('BankiRuInfo2://')){
      v=v.replace(/^BankiRuInfo2:\/\/www\.banki\.ru\//i,'');
      v=v.replace(/^BankiRuInfo2:\/\//i,'');
    }
    v=v.replace(/^https?:\/\/www\.banki\.ru\//i,'');
    v=v.replace(/^\/+/,'');
    v=v.replace(/^www\.banki\.ru\//i,'');
    return v;
  }

  // кодирует значение один раз, сохраняя {…} и {{…}}
  function encodePreservingBraces(value){
    return encodeURIComponent(value)
      .replace(/%257B/g,'{').replace(/%257D/g,'}')
      .replace(/%7B/g,'{').replace(/%7D/g,'}');
  }
  /* af_dp — только схема приложения, без пути. Куда вести внутри приложения,
     теперь говорит один параметр — deep_link_value; дублировать маршрут ещё и в
     af_dp значило держать два источника правды, которые легко разойдутся. */
  const AF_DP_SCHEME='BankiRuInfo2://';
  function buildAfDp(){return encodeURIComponent(AF_DP_SCHEME);}

  function isValidHttpUrl(v){try{const u=new URL(v);return u.protocol==='http:'||u.protocol==='https:';}catch(e){return false;}}
  function affPlaceholder(channel){return channel==='email'?'{{aff_unique5}}':'{AFFUNIQUE5}';}
  function getSourceValue(channel){return channel==='email'?'{{linkSourceCRM}}':'{sourceCrm}';}
  /* Канал в ссылку уходит не значением, а переменной: подставит его CRM в момент
     отправки, поэтому одна ссылка годится для всех каналов. Исключение — колл-центр:
     там подстановки нет, и канал пишется как есть. Проверять его нужно ДО правила
     email/не-email, иначе callcenter получил бы {channel}.
     Скобки разные, потому что рассыльщики разные: у почты свой шаблонизатор. */
  function channelToken(channel){
    if(channel==='callcenter') return 'callcenter';
    return channel==='email'?'{{channel}}':'{channel}';
  }
  /* Имя кампании (метка c) панель больше не собирает: оно уже известно CRM как
     sourceType шаблона. Скобки — по тому же правилу, что у канала. */
  function sourceTypeToken(channel){return channel==='email'?'{{sourceType}}':'{sourceType}';}
  function getUtmMedium(mailingType){
    const t=(mailingType||'').trim().toLowerCase();
    if(!t) return '';
    return (t==='adv'||t==='info')?'email':'crm';
  }
  function addMarketingParams(url,source,chToken,mailingType,aff){
    url.searchParams.set('source',source);
    url.searchParams.set('utm_source',chToken);
    const med=getUtmMedium(mailingType);
    if(med) url.searchParams.set('utm_medium',med);
    url.searchParams.set('utm_campaign',source);
    url.searchParams.set('aff_unique5',aff);
    return url;
  }
  function buildEncodedUrl(baseValue,source,chToken,mailingType,aff){
    const base=normalizeSpaces(baseValue)||DEFAULT_WEB_DP;
    let url;
    try{url=new URL(base);}catch(e){return encodePreservingBraces(base);}
    addMarketingParams(url,source,chToken,mailingType,aff);
    return encodePreservingBraces(url.toString());
  }
  function highlight(link){
    return link.replace(/([?&])([a-z0-9_]+)=/gi,(m,sep,key)=>`<span class="amp">${sep}</span><span class="k">${key}</span>=`);
  }

  /* Режим webview: deep_link_value — адрес страницы из webview_url с метками.
     Поле блокируется и показывает ровно то, что уйдёт в ссылку (значение
     проставляет update). Прежний префикс deepLink/webview?webviewUrl= больше не
     склеивается: в af_dp — только схема приложения. */
  function syncWebviewUI(){
    if(els.webviewFlag.checked){
      els.webviewWrap.style.display='block';
      els.deepLinkValue.value=normalizeSpaces(els.webviewUrl.value);
      els.deepLinkValue.disabled=true;
    }else{
      els.webviewWrap.style.display='none';
      /* Снимая флаг, очищаем зеркало: иначе адрес страницы остался бы в поле как
         будто это маршрут приложения, и ссылка тихо собралась бы неверно. */
      if(els.deepLinkValue.disabled) els.deepLinkValue.value='';
      els.deepLinkValue.disabled=false;
    }
  }

  /* Адрес страницы webview с маркетинговыми метками. Метки обязательны: без них
     переход из рассылки в webview не виден в аналитике — ни канал, ни кампания. */
  function webviewTarget(source,chToken,mailingType,aff){
    const wv=normalizeSpaces(els.webviewUrl.value);
    if(!wv) return '';
    try{
      const u=new URL(wv);
      addMarketingParams(u,source,chToken,mailingType,aff);
      /* URL кодирует фигурные скобки плейсхолдеров — возвращаем их, иначе на
         экране вместо {sourceCrm} была бы нечитаемая %7BsourceCrm%7D. */
      return u.toString().replace(/%7B/gi,'{').replace(/%7D/gi,'}');
    }catch(e){return wv;}
  }

  // Возвращает СЫРОЙ deep link (без кодирования) — кодируется один раз при вставке.
  function getDeepLinkPath(source,chToken,mailingType,aff){
    if(els.webviewFlag.checked){
      /* Адрес из webview_url с метками — без служебного префикса и без склейки. */
      return webviewTarget(source,chToken,mailingType,aff);
    }
    return normalizeDeepLink(els.deepLinkValue.value);
  }

  function update(){
    const channel=els.channel.value;
    const source=getSourceValue(channel);
    const aff=affPlaceholder(channel);
    const chToken=channelToken(channel);
    const mailingType=els.mailingType.value;
    const webDpRaw=normalizeSpaces(els.webDp.value)||DEFAULT_WEB_DP;
    const iosUrl=normalizeSpaces(els.iosUrl.value);
    const androidUrl=normalizeSpaces(els.androidUrl.value);

    // сырой deep link path
    const deepLinkPath=getDeepLinkPath(source,chToken,mailingType,aff);

    /* Заблокированное deep_link_value показывает ровно то, что уйдёт в ссылку, —
       адрес с метками, и обновляется на каждый ввод: иначе поле застывало бы на
       моменте включения флага, а в ссылку уходило бы уже другое. */
    if(els.webviewFlag.checked) els.deepLinkValue.value=deepLinkPath;

    const missingKeys=[];
    if(!channel) missingKeys.push('channel');
    if(!mailingType) missingKeys.push('mailingType');
    if(els.webviewFlag.checked){
      if(!normalizeSpaces(els.webviewUrl.value)) missingKeys.push('webviewUrl');
    }else{
      if(!normalizeDeepLink(els.deepLinkValue.value)) missingKeys.push('deepLinkValue');
    }

    document.querySelectorAll('.field[data-req]').forEach(f=>{
      const key=f.getAttribute('data-req');
      const visible=f.offsetParent!==null;
      f.classList.toggle('missing',visible&&missingKeys.includes(key));
    });

    const softWarn=[];
    if(els.webDp.value && !isValidHttpUrl(webDpRaw)) softWarn.push('af_web_dp');
    if(iosUrl && !isValidHttpUrl(iosUrl)) softWarn.push('af_ios_url');
    if(androidUrl && !isValidHttpUrl(androidUrl)) softWarn.push('af_android_url');
    if(els.webviewFlag.checked && normalizeSpaces(els.webviewUrl.value) && !isValidHttpUrl(normalizeSpaces(els.webviewUrl.value))) softWarn.push('webview_url');

    const afXp=channel==='email'?'email':'text';
    const params=[];
    params.push(['af_xp',afXp]);
    params.push(['pid',chToken]);
    params.push(['c',sourceTypeToken(channel)]);
    params.push(['af_channel',source]);
    params.push(['aff_unique5',aff]);
    params.push(['is_retargeting','true']);
    params.push(['af_reengagement_window','30d']);
    params.push(['af_force_deeplink','true']);
    // af_dp — только схема; маршрут/страница — в deep_link_value, закодированном один раз
    params.push(['af_dp',buildAfDp()]);
    params.push(['deep_link_value',encodePreservingBraces(deepLinkPath)]);
    if(iosUrl) params.push(['af_ios_url',buildEncodedUrl(iosUrl,source,chToken,mailingType,aff)]);
    if(androidUrl) params.push(['af_android_url',buildEncodedUrl(androidUrl,source,chToken,mailingType,aff)]);
    params.push(['af_web_dp',buildEncodedUrl(webDpRaw,source,chToken,mailingType,aff)]);

    els.result.innerHTML=highlight(`${ONE_LINK_BASE}?${params.map(([k,v])=>`${k}=${v}`).join('&')}`);

    const ready = missingKeys.length===0 && softWarn.length===0;
    els.resultCard.classList.toggle('is-draft',!ready);
    els.resultCard.classList.toggle('is-ready',ready);
    els.copyBtn.disabled=!ready;
    els.copyBtn.style.opacity=ready?'1':'.45';
    els.copyBtn.style.cursor=ready?'pointer':'not-allowed';

    if(ready){
      els.banner.className='banner ready';
      els.banner.innerHTML='<span class="pulse"></span>ГОТОВО — можно вставлять в кампанию';
    }else{
      els.banner.className='banner draft';
      els.banner.innerHTML='<span class="pulse"></span>ЧЕРНОВИК — не использовать';
      const uniqLabels=[...new Set(missingKeys.map(k=>LABELS[k]))];
      const parts=[];
      if(uniqLabels.length) parts.push('Заполни: '+uniqLabels.join(', ')+'.');
      if(softWarn.length) parts.push('Проверь формат (нужен http/https URL): '+softWarn.join(', ')+'.');
      els.draftNote.innerHTML='<b>Ссылку использовать нельзя.</b> '+parts.join(' ');
    }
  }

  /* navigator.clipboard живёт только в защищённом контексте (HTTPS или localhost).
     Панель отдаётся по http://crm.banki.ru, объекта там нет вовсе — обращение
     бросало TypeError, его глотал пустой catch, и кнопка молча ничего не делала.
     Запасной путь через скрытое поле и execCommand: устарел, но контекста не
     требует. Отказ показываем на самой кнопке. */
  function copyText(value){
    if(navigator.clipboard && window.isSecureContext){
      return navigator.clipboard.writeText(value);
    }
    return new Promise((resolve,reject)=>{
      const ta=document.createElement('textarea');
      ta.value=value; ta.setAttribute('readonly','');
      ta.style.cssText='position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0,ta.value.length);
      let ok=false;
      try{ ok=document.execCommand('copy'); }catch(e){ ok=false; }
      document.body.removeChild(ta);
      ok?resolve():reject(new Error('execCommand'));
    });
  }

  els.copyBtn.addEventListener('click',()=>{
    if(els.copyBtn.disabled) return;
    const value=els.result.textContent.trim();
    if(!value) return;
    const orig=els.copyBtn.textContent;
    copyText(value).then(()=>{
      els.copyBtn.textContent='✓ Скопировано';
      setTimeout(()=>els.copyBtn.textContent=orig,1600);
    }).catch(()=>{
      els.copyBtn.textContent='Не удалось — скопируйте вручную';
      setTimeout(()=>els.copyBtn.textContent=orig,2600);
    });
  });

  /* Свёрнутый блок ссылки. Состояние запоминаем: у кого экран маленький, тот
     сворачивает раз и навсегда, а не при каждом заходе в раздел. Хранилище может
     быть недоступно (приватное окно) — тогда просто работаем без запоминания. */
  function setDock(open){
    els.resultCard.classList.toggle('collapsed',!open);
    els.dockToggle.setAttribute('aria-expanded',String(open));
    els.dockToggle.title = open ? 'Свернуть блок со ссылкой' : 'Развернуть блок со ссылкой';
  }
  if(els.dockToggle){
    setDock(store.get('onelinkDockOpen',true)!==false);
    els.dockToggle.addEventListener('click',()=>{
      const open=els.resultCard.classList.contains('collapsed');
      setDock(open);
      store.set('onelinkDockOpen',open);
    });
  }

  els.webviewFlag.addEventListener('change',()=>{syncWebviewUI();update();});

  ['input','change'].forEach(ev=>{
    ['channel','mailingType','webDp','webviewUrl','deepLinkValue','iosUrl','androidUrl']
      .forEach(id=>els[id].addEventListener(ev,update));
  });

  syncWebviewUI();update();
