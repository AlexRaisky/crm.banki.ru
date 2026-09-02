/* OneLink Builder (#sec-onelink): сборка диплинков AppsFlyer —
   правила каналов, предпросмотр и копирование ссылки. Чисто клиентский раздел. */
  const ONE_LINK_BASE='https://banki.onelink.me/JmaP';
  const DEFAULT_WEB_DP='https://mobile.banki.ru/';
  const WEBVIEW_PREFIX='https://www.banki.ru/deepLink/webview?webviewUrl=';

  const LABELS={channel:'Канал',mailingType:'Тип рассылки',campType:'Тип кампании',product:'Продукт',
    partner:'Партнёр/General/Digest',uniqNameP:'Уникальное название',campDate:'Дата рассылки',
    uniqNameT:'Уникальное название',segment:'Номер сегмента',day:'День отправки',
    deepLinkValue:'deep_link_value',webviewUrl:'webview_url'};

  const els={};
  ['channel','mailingType','campType','product','partner','uniqNameP','campDate','uniqNameT','segment','day',
   'webDp','webviewFlag','webviewWrap','webviewUrl','deepLinkValue','iosUrl','androidUrl',
   'result','resultCard','banner','draftNote','copyBtn','campPreview',
   'wrapPartner','wrapUniqP','wrapDate','wrapUniqT','wrapSegment','wrapDay']
   .forEach(id=>els[id]=document.getElementById(id));

  function normalizeSpaces(v){return (v||'').trim().replace(/\s+/g,'');}
  function slug(v){return (v||'').trim().replace(/\s+/g,'-');}
  function fmtDate(iso){if(!iso)return'';const[y,m,d]=iso.split('-');return d+m+y.slice(2);}

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
  // af_dp: собираем полный URI и кодируем один раз (плейсхолдеры сохраняем)
  function buildAfDp(path){return encodePreservingBraces(`BankiRuInfo2://www.banki.ru/${path}`);}

  function isValidHttpUrl(v){try{const u=new URL(v);return u.protocol==='http:'||u.protocol==='https:';}catch(e){return false;}}
  function affPlaceholder(channel){return channel==='email'?'{{aff_unique5}}':'{AFFUNIQUE5}';}
  function getSourceValue(channel){return channel==='email'?'{{linkSourceCRM}}':'{sourceCrm}';}
  function getUtmMedium(mailingType){
    const t=(mailingType||'').trim().toLowerCase();
    if(!t) return '';
    return (t==='adv'||t==='info')?'email':'crm';
  }
  function addMarketingParams(url,source,pid,mailingType,aff){
    url.searchParams.set('source',source);
    url.searchParams.set('utm_source',pid);
    const med=getUtmMedium(mailingType);
    if(med) url.searchParams.set('utm_medium',med);
    url.searchParams.set('utm_campaign',source);
    url.searchParams.set('aff_unique5',aff);
    return url;
  }
  function buildEncodedUrl(baseValue,source,pid,mailingType,aff){
    const base=normalizeSpaces(baseValue)||DEFAULT_WEB_DP;
    let url;
    try{url=new URL(base);}catch(e){return encodePreservingBraces(base);}
    addMarketingParams(url,source,pid,mailingType,aff);
    return encodePreservingBraces(url.toString());
  }
  function highlight(link){
    return link.replace(/([?&])([a-z0-9_]+)=/gi,(m,sep,key)=>`<span class="amp">${sep}</span><span class="k">${key}</span>=`);
  }

  function syncCampaignUI(){
    const type=els.campType.value;
    const isCC=els.channel.value==='callcenter';
    els.wrapPartner.style.display = type==='promo'?'block':'none';
    els.wrapUniqP.style.display   = type==='promo'?'block':'none';
    els.wrapDate.style.display    = type==='promo'?'block':'none';
    els.wrapUniqT.style.display   = type==='trigger'?'block':'none';
    els.wrapDay.style.display     = type==='trigger'?'block':'none';
    els.wrapSegment.style.display = (type==='trigger'&&isCC)?'block':'none';
  }

  function buildCampaign(channel){
    const campChannel = channel==='callcenter' ? 'contact' : channel;
    const type=els.campType.value;
    const product=els.product.value;
    const missing=[];
    if(!type) missing.push('campType');
    if(!product) missing.push('product');
    let parts=[];
    if(type==='promo'){
      const partner=slug(els.partner.value);
      const uniq=slug(els.uniqNameP.value);
      const date=fmtDate(els.campDate.value);
      if(!partner) missing.push('partner');
      if(!uniq) missing.push('uniqNameP');
      if(!els.campDate.value) missing.push('campDate');
      parts=[campChannel,'promo',product,partner,uniq,date];
    }else if(type==='trigger'){
      const uniq=slug(els.uniqNameT.value);
      const day=normalizeSpaces(els.day.value);
      if(!uniq) missing.push('uniqNameT');
      if(!day) missing.push('day');
      if(channel==='callcenter'){
        const seg=normalizeSpaces(els.segment.value);
        if(!seg) missing.push('segment');
        parts=[campChannel,'trigger',product,uniq,seg,day?day+'day':''];
      }else{
        parts=[campChannel,'trigger',product,uniq,day?day+'day':''];
      }
    }else{
      parts=[campChannel,'',product];
    }
    return {value:parts.filter(p=>p!=='').join('_'),missing};
  }

  function syncWebviewUI(){
    if(els.webviewFlag.checked){
      els.webviewWrap.style.display='block';
      els.deepLinkValue.value=WEBVIEW_PREFIX;
      els.deepLinkValue.disabled=true;
    }else{
      els.webviewWrap.style.display='none';
      els.deepLinkValue.disabled=false;
      if(els.deepLinkValue.value===WEBVIEW_PREFIX) els.deepLinkValue.value='';
    }
  }

  // Возвращает СЫРОЙ deep link path (без пред-кодирования).
  // Для webview: url страницы получает utm-метки и кодируется ОДИН раз,
  // чтобы его собственный query не смешался с webviewUrl. Итоговое значение
  // deep_link_value/af_dp кодируется ещё раз уже при вставке в OneLink.
  function getDeepLinkPath(source,channel,mailingType,aff){
    if(els.webviewFlag.checked){
      const wv=normalizeSpaces(els.webviewUrl.value);
      if(!wv) return 'deepLink/webview?webviewUrl=';
      let inner;
      try{
        const u=new URL(wv);
        addMarketingParams(u,source,channel,mailingType,aff);
        inner=encodePreservingBraces(u.toString()); // кодируем сам URL страницы
      }catch(e){inner=encodePreservingBraces(wv);}
      return 'deepLink/webview?webviewUrl=' + inner;
    }
    return normalizeDeepLink(els.deepLinkValue.value);
  }

  function update(){
    const channel=els.channel.value;
    const source=getSourceValue(channel);
    const aff=affPlaceholder(channel);
    const mailingType=els.mailingType.value;
    const webDpRaw=normalizeSpaces(els.webDp.value)||DEFAULT_WEB_DP;
    const iosUrl=normalizeSpaces(els.iosUrl.value);
    const androidUrl=normalizeSpaces(els.androidUrl.value);

    const camp=buildCampaign(channel);
    els.campPreview.textContent=camp.value||'—';

    // сырой deep link path
    const deepLinkPath=getDeepLinkPath(source,channel,mailingType,aff);

    const missingKeys=[];
    if(!channel) missingKeys.push('channel');
    if(!mailingType) missingKeys.push('mailingType');
    missingKeys.push(...camp.missing);
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
    params.push(['pid',channel]);
    params.push(['c',camp.value]);
    params.push(['af_channel',source]);
    params.push(['aff_unique5',aff]);
    params.push(['is_retargeting','true']);
    params.push(['af_reengagement_window','30d']);
    params.push(['af_force_deeplink','true']);
    // af_dp и deep_link_value кодируются одинаково, один раз, из одного сырого path
    params.push(['af_dp',buildAfDp(deepLinkPath)]);
    params.push(['deep_link_value',encodePreservingBraces(deepLinkPath)]);
    if(iosUrl) params.push(['af_ios_url',buildEncodedUrl(iosUrl,source,channel,mailingType,aff)]);
    if(androidUrl) params.push(['af_android_url',buildEncodedUrl(androidUrl,source,channel,mailingType,aff)]);
    params.push(['af_web_dp',buildEncodedUrl(webDpRaw,source,channel,mailingType,aff)]);

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

  els.campType.addEventListener('change',()=>{syncCampaignUI();update();});
  els.channel.addEventListener('change',()=>{syncCampaignUI();update();});
  els.webviewFlag.addEventListener('change',()=>{syncWebviewUI();update();});

  ['input','change'].forEach(ev=>{
    ['channel','mailingType','campType','product','partner','uniqNameP','campDate','uniqNameT','segment','day',
     'webDp','webviewUrl','deepLinkValue','iosUrl','androidUrl']
      .forEach(id=>els[id].addEventListener(ev,update));
  });

  syncCampaignUI();syncWebviewUI();update();
