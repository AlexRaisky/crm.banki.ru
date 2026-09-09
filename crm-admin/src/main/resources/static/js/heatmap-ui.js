/* Тепловая карта: состояние страницы, фильтры, отрисовка таблиц и графиков
   (работает поверх ядра из heatmap-core.js и данных из heatmap-data.js). */
// ==================== СОСТОЯНИЕ ====================
let RAW = [];
let R = null;
let CHART = {};

const fmt = n => new Intl.NumberFormat('ru-RU').format(Math.round(n));
const fmtM = n => (n/1e6).toFixed(1).replace('.',',')+' млн';
const fmtMrd = n => (n/1e9).toFixed(2).replace('.',',')+' млрд';
function ruDate(iso){const [y,m,d]=iso.split('-');return `${d}.${m}.${y}`;}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

const C = {
  green:'#3CFAB4', blue:'#50C3FF', deep:'#009BFF',
  coral:'#FF6B8A', ink:'#EAF2FB', dim:'#8FA3C0', faint:'#5A6E8C',
  solved:'#3CFAB4', grid:'rgba(80,195,255,.10)', card:'#162136'
};

function boot(seedRaw){ RAW=seedRaw; recompute(true); }
function recompute(applyManual){
  R = analyze(RAW);
  R.checkdays = computeCheckDays(RAW, R.flags.map(f=>f.date));
  if(applyManual) applyManualHypotheses(R.flags, R.declines);
  renderAll();
}

/* ---------- подъём раздела на сервере ----------

   Порядок важен: сначала комментарии (без них таблицы отрисуются пустыми и
   человек на секунду увидит «ничего не разобрано»), затем факт. Любая ошибка —
   не повод ронять раздел: остаёмся на демо-данных и localStorage, как было. */
async function bootServer(){
  let notes=null;
  try{
    const r=await fetch(DEV_API+'/notes',{credentials:'same-origin',headers:{Accept:'application/json'}});
    if(!r.ok) throw new Error('HTTP '+r.status);
    notes=await r.json();
  }catch(e){ boot(SEED_RAW); return; }

  SRV=true;
  NOTES={}; STATUS={};
  (notes||[]).forEach(n=>{
    const id=n.object_key;
    if(n.comment) NOTES[id]=n.comment;
    if(n.status==='solved') STATUS[id]='solved';
  });

  let rows=[];
  try{
    const r=await fetch(DEV_API+'/revenue',{credentials:'same-origin',headers:{Accept:'application/json'}});
    if(r.ok) rows=await r.json();
  }catch(e){ /* факт не приехал — покажем демо-набор, разбор при этом уже общий */ }

  if(rows && rows.length){
    RAW=rows.map(r=>({date:String(r.fact_date).slice(0,10), g1:r.group1, g2:r.group2,
                      g3:r.channel, revenue:Number(r.revenue)}));
    recompute(true);
    flashHint('✓ данные из базы: '+[...new Set(RAW.map(r=>r.date))].length+' дней');
  }else{
    /* В базе пусто — первый заход. Показываем демо-набор, но не выдаём его за
       факт: пока никто не загрузил файл, сохранять снимок нечего. */
    boot(SEED_RAW);
    flashHint('в базе пока нет данных — показан демонстрационный набор');
  }
}

/* Снимок расчёта: что именно показывалось и с какими порогами. Пишется после
   загрузки данных, а не на каждую перерисовку — иначе в истории копились бы
   десятки одинаковых прогонов за один сеанс. */
function saveRun(loadId){
  if(!SRV || !R) return Promise.resolve();
  const flagged=new Set(R.flags.map(f=>f.date));
  /* «День к дню» в разделе не показывается, но в файле такая колонка есть и на
     неё смотрят при разборе — считаем её здесь, чтобы снимок был полным. */
  const daily=R.daily.map((d,i)=>{
    const prev=i>0?R.daily[i-1].rev:null;
    return {date:d.date, rev:d.rev, base:d.base, dev:d.dev,
      dod: prev ? Math.round((d.rev/prev-1)*1000)/10 : null,
      flagged:flagged.has(d.date)};
  });
  const monthly=R.monthly.map(m=>({monthStart:m.monthStart||null, total:m.total, avg:m.avg,
    min:m.min, max:m.max, std:m.std, mom:m.mom}));
  return fetch(DEV_API+'/runs',{
    method:'POST', credentials:'same-origin',
    headers:{'Content-Type':'application/json', Accept:'application/json'},
    body:JSON.stringify({loadId:loadId||null, daily, flags:R.flags, declines:R.declines,
      monthly, checkdays:R.checkdays,
      productsCount:R._meta.nProducts, totalRevenue:R._meta.totalRev})
  }).then(r=>r.ok?r.json():null)
    .catch(()=>null);
}

const MANUAL = {
  'flag_2026-01-01':{type:'confident',comment:'Новый год — нерабочий день. Обвал в основном по Кредиты/Микрозаймы/sms (−14,9 млн). Календарный фактор, ожидаемо.'},
  'flag_2026-02-14':{type:'check',comment:'Суббота, но провал глубже обычного выходного. Драйвер — Микрозаймы (callcenter+sms). Совпадает с началом общего спада 11.01–14.02. ПРОВЕРИТЬ паузу/сбой рассылок по Микрозаймам.'},
  'flag_2026-02-15':{type:'check',comment:'Воскресенье, провал глубже нормы. Драйвер — Микрозаймы/sms (−8,0 млн). Дно февральского спада. ПРОВЕРИТЬ вместе с 14.02.'},
  'flag_2026-03-31':{type:'confident',comment:'Вторник, последний день I квартала. Всплеск Микрозаймов и Каско — типичная докрутка плана к концу квартала.'},
  'flag_2026-05-14':{type:'check',comment:'Четверг (не конец месяца). Драйвер сместился на Карты/Кредитные карты и Ипотека/КПЗН/sms. Нетипичный набор. ПРОВЕРИТЬ акцию/спецрассылку по картам и ипотеке 14.05.'},
  'flag_2026-05-16':{type:'check',comment:'Суббота, провал глубже нормы. Драйвер — Микрозаймы/sms (−10,6 млн). Похоже на разовый сбой канала sms. ПРОВЕРИТЬ доставку sms 16–17.05.'},
  'flag_2026-05-17':{type:'check',comment:'Воскресенье, продолжение провала 16.05 (Микрозаймы callcenter+sms+email). ПРОВЕРИТЬ — выглядит как двухдневный сбой.'},
  'flag_2026-06-23':{type:'confident',comment:'Вторник, конец месяца близко. Сильный всплеск Микрозаймов (sms +11,3 млн, mobile-push +4,8 млн) + Карты. Плановая активация рассылок в конце июня.'},
};
const MANUAL_DECL = {
  'Итого по всем продуктам__2026-01-11':'Общий спад после новогоднего пика. Тянут вниз Микрозаймы (mobile-push, email) и ОСАГО/email. Связан с провалом mobile-push (374→127 млн м/м) и обнулением push с февраля.',
  'Кредиты / Микрозаймы / email__2026-01-27':'−82% за 17 дней. ПРОВЕРИТЬ: смена стратегии рассылок или выработка базы.',
  'Кредиты / Микрозаймы / mobile-push__2026-01-19':'−75% за 22 дня — часть системного провала mobile-push в феврале (канал просел втрое). Вероятна техпроблема/отключение канала.',
  'Страхование / ОСАГО / email__2026-01-11':'−58% за 26 дней. Сезонное ослабление / выработка базы ОСАГО после праздников.',
  'Страхование / ОСАГО / email__2026-03-29':'Повторное −40% за 16 дней. ПРОВЕРИТЬ цикличность рассылок ОСАГО.',
};
function applyManualHypotheses(flags, declines){
  flags.forEach(f=>{const m=MANUAL['flag_'+f.date];if(m){f.type=m.type;f.comment=m.comment;}});
  declines.forEach(d=>{const c=MANUAL_DECL[d.level+'__'+d.start];if(c)d.comment=c;});
}

/* ==================== ХРАНИЛИЩЕ РАЗБОРА ====================

   Комментарии и статусы гипотез лежат в базе (deviation.t_note): раньше они
   жили в localStorage, то есть история была только у того, кто последним
   сохранил Excel, а коллега открывал раздел и не видел ничего.

   localStorage остался запасным путём — для демо на GitHub Pages и на случай,
   когда сервер недоступен: раздел обязан работать и без него, иначе человек
   теряет уже написанный текст. Признак SRV показывает, куда мы пишем.

   Рендер синхронный, поэтому и то и другое держим в памяти: NOTES/STATUS
   наполняются один раз при открытии раздела. */
const NOTE_KEY='revenue_notes_crmteam';
const STAT_KEY='revenue_status_crmteam';
const DEV_API='/api/deviations';
let NOTES=null, STATUS=null, SRV=false;

function lsNotes(){try{return JSON.parse(localStorage.getItem(NOTE_KEY)||'{}');}catch(e){return{};}}
function lsStatus(){try{return JSON.parse(localStorage.getItem(STAT_KEY)||'{}');}catch(e){return{};}}
function loadNotes(){ if(NOTES===null) NOTES=lsNotes(); return NOTES; }
function loadStatus(){ if(STATUS===null) STATUS=lsStatus(); return STATUS; }

/* Ключ объекта разбора → что это: день проверки или плавное снижение.
   Формат ключей исторический (check_<дата>, decl_<уровень>__<дата начала>) —
   он же уходит в базу как object_key, чтобы старые записи и выгрузка в Excel
   продолжали сходиться по одному и тому же идентификатору. */
function noteObject(id){
  if(id.indexOf('check_')===0) return {kind:'day', key:id, date:id.slice(6), level:null};
  if(id.indexOf('decl_')===0){
    const rest=id.slice(5), i=rest.lastIndexOf('__');
    return {kind:'decline', key:id, date:i<0?null:rest.slice(i+2), level:i<0?rest:rest.slice(0,i)};
  }
  return {kind:'day', key:id, date:null, level:null};
}
/* Обстоятельства на момент комментария: по ним запись можно узнать, если после
   дозагрузки дней граница тренда уедет и ключ перестанет совпадать. */
function noteSnapshot(id){
  const o=noteObject(id);
  if(o.kind==='decline' && R){
    const d=(R.declines||[]).filter(x=>('decl_'+x.level+'__'+x.start)===id)[0];
    if(d) return {level:d.level, start:d.start, end:d.end, days:d.days, drop:d.drop};
  }
  if(o.kind==='day' && R){
    const c=(R.checkdays||[]).filter(x=>('check_'+x.date)===id)[0];
    if(c) return {date:c.date, auto:c.comment};
  }
  return null;
}

function pushNote(id){
  if(!SRV) return;
  const o=noteObject(id);
  fetch(DEV_API+'/notes', {
    method:'PUT', credentials:'same-origin',
    headers:{'Content-Type':'application/json', Accept:'application/json'},
    body:JSON.stringify({kind:o.kind, key:o.key, date:o.date, level:o.level,
      comment:loadNotes()[id]||'', status:loadStatus()[id]||'open', snapshot:noteSnapshot(id)})
  }).catch(()=>flashHint('⚠ не сохранилось на сервере'));
}
function persistLocal(){
  try{
    localStorage.setItem(NOTE_KEY,JSON.stringify(loadNotes()));
    localStorage.setItem(STAT_KEY,JSON.stringify(loadStatus()));
  }catch(e){}
}
function saveNote(id,val){
  const n=loadNotes();
  if(val.trim()) n[id]=val; else delete n[id];
  if(SRV) pushNote(id); else persistLocal();
  flashHint('✓ сохранено');
}
function setStatus(id,st){
  const s=loadStatus();
  if(st) s[id]=st; else delete s[id];
  if(SRV) pushNote(id); else persistLocal();
}
function mergeNotes(inc){
  const n=loadNotes(); Object.assign(n,inc);
  if(SRV) Object.keys(inc).forEach(pushNote); else persistLocal();
}
function mergeStatus(inc){
  const s=loadStatus(); Object.assign(s,inc);
  if(SRV) Object.keys(inc).forEach(pushNote); else persistLocal();
}
let hintTimer;
function flashHint(msg){const h=document.getElementById('saveHint');if(!h)return;
  h.innerHTML='<b>'+msg+'</b>';clearTimeout(hintTimer);hintTimer=setTimeout(()=>h.textContent='',2400);}
function acceptHypo(id){setStatus(id,'solved');flashHint('✓ гипотеза принята');renderAll();}
function reopenHypo(id){setStatus(id,'');flashHint('↻ возвращено на пересмотр');renderAll();}

function renderAll(){
  renderMeta(); renderMonths(); renderFlags(); renderCheck(); renderDecl();
  renderMainChart(); renderMonthChart(); renderChannelChart();
}
function renderMeta(){
  const up=R.flags.filter(f=>f.flag==='РОСТ').length;
  const dn=R.flags.filter(f=>f.flag==='ПАДЕНИЕ').length;
  const status=loadStatus();
  const solved=Object.values(status).filter(v=>v==='solved').length;
  document.getElementById('metaStrip').innerHTML=`
    <div><span>Период</span><b>${R.daily.length} дней</b></div>
    <div><span>Выручка всего</span><b>${fmtMrd(R._meta.totalRev)}</b></div>
    <div><span>Всплесков ↑</span><b style="color:${C.green}">${up}</b></div>
    <div><span>Провалов ↓</span><b style="color:${C.coral}">${dn}</b></div>
    <div><span>Плавных снижений</span><b>${R.declines.length}</b></div>
    <div><span>Решено гипотез</span><b style="color:${C.solved}">${solved}</b></div>`;
}
function renderMonths(){
  document.getElementById('monthStrip').innerHTML=R.monthly.map(m=>{
    let mom;
    if(m.mom===null) mom=`<div class="mmom" style="color:var(--faint)">старт периода</div>`;
    else{const cls=m.mom>=0?'up':'down';const s=m.mom>=0?'+':'';
      mom=`<div class="mmom ${cls}">${s}${m.mom.toFixed(1).replace('.',',')}% к пред.</div>`;}
    return `<div class="mcard"><div class="mname">${m.month}</div><div class="mval">${fmtMrd(m.total)}</div>${mom}</div>`;
  }).join('');
}
function heatWidth(dev){return Math.min(Math.abs(dev)/40*100,100);}
function heatColor(dev){const a=Math.min(Math.abs(dev)/40,1);
  return dev>0?`rgba(60,250,180,${0.4+a*0.6})`:`rgba(255,107,138,${0.4+a*0.6})`;}

function renderFlags(){
  const notes=loadNotes();
  document.getElementById('flagBody').innerHTML=R.flags.map(f=>{
    const isGrow=f.flag==='РОСТ';
    const pill=`<span class="pill ${isGrow?'grow':'drop'}">${isGrow?'▲ рост':'▼ падение'}</span>`;
    const tag=f.type==='confident'?`<span class="tag confident">гипотеза ясна</span>`:`<span class="tag check">нужна проверка</span>`;
    const cmt=(f.comment||'').replace(/(ПРОВЕРИТЬ[^.]*\.)/g,'<span class="hl">$1</span>');
    const userNote=notes['check_'+f.date];
    const userBlock=userNote?`<div class="usernote"><span class="un-lbl">ваш комментарий:</span> ${esc(userNote)}</div>`:'';
    return `<tr>
      <td class="t-date">${ruDate(f.date)}<small>${WD_FULL[f.wd]}, ${f.month}</small></td>
      <td>${pill}</td>
      <td><div class="devcell" style="color:${isGrow?C.green:C.coral}">${f.dev>0?'+':''}${f.dev}%</div>
        <div class="rev">${fmtM(f.rev)}</div>
        <div class="heat"><i style="width:${heatWidth(f.dev)}%;background:${heatColor(f.dev)}"></i></div></td>
      <td>${tag}<div class="cmt">${cmt}</div>${userBlock}</td></tr>`;
  }).join('');
}

function workItem(id, autoComment){
  const notes=loadNotes(), status=loadStatus();
  const solved = status[id]==='solved';
  const note = notes[id]||'';
  const autoHtml=(autoComment||'').replace(/(ПРОВЕРИТЬ[^.]*\.)/g,'<span class="hl">$1</span>');
  if(solved){
    return `<div class="hypo solved">
      <div class="solved-badge">✓ гипотеза принята</div>
      ${autoComment?`<div class="cmt">${autoHtml}</div>`:''}
      ${note?`<div class="usernote"><span class="un-lbl">комментарий:</span> ${esc(note)}</div>`:''}
      <button class="mini-btn reopen" onclick="reopenHypo('${id}')">↻ Пересмотреть гипотезу</button></div>`;
  }
  return `<div class="hypo open">
    ${autoComment?`<div class="cmt">${autoHtml}</div>`:''}
    <div class="note"><label>Комментарий · причина</label>
      <textarea data-id="${id}" placeholder="что выяснилось…">${esc(note)}</textarea></div>
    <button class="mini-btn accept" onclick="acceptHypo('${id}')">✓ Принять гипотезу</button></div>`;
}

function renderCheck(){
  const el=document.getElementById('checkList');
  if(!R.checkdays.length){el.innerHTML='<div class="empty">Кластеров без однозначной причины не найдено.</div>';return;}
  const status=loadStatus();
  el.innerHTML=R.checkdays.map(c=>{
    const id='check_'+c.date; const solved=status[id]==='solved';
    return `<div class="check-item ${solved?'is-solved':''}">
      <div class="cd">${ruDate(c.date)}</div>
      <div style="flex:1">${workItem(id, c.comment)}</div></div>`;
  }).join('');
}
function renderDecl(){
  const status=loadStatus();
  document.getElementById('declBody').innerHTML=R.declines.map((d)=>{
    const id='decl_'+d.level+'__'+d.start; const solved=status[id]==='solved';
    return `<tr class="decl-row ${solved?'is-solved':''}">
      <td><div class="decl-level">${d.level}</div></td>
      <td><div class="decl-span">${ruDate(d.start)} → ${ruDate(d.end)}</div><div class="decl-flow">${d.days} дней</div></td>
      <td><div class="decl-drop">${d.drop}%</div><div class="decl-flow">${fmtM(d.rev_start)} → ${fmtM(d.rev_end)}</div></td>
      <td>${workItem(id, d.comment)}</td></tr>`;
  }).join('');
}

function setupChartDefaults(){
  Chart.defaults.color=C.dim;
  Chart.defaults.font.family="'Coil','Golos Text','Manrope','Inter',system-ui,sans-serif";
  Chart.defaults.font.size=11;
}
function destroyChart(k){if(CHART[k]){CHART[k].destroy();delete CHART[k];}}
function renderMainChart(){
  destroyChart('main');
  const d=R.daily, labels=d.map(x=>x.date);
  const flagMap={}; R.flags.forEach(f=>flagMap[f.date]=f);
  const ptColor=d.map(x=>{const f=flagMap[x.date];return f?(f.flag==='РОСТ'?C.green:C.coral):'rgba(0,0,0,0)';});
  const ptR=d.map(x=>flagMap[x.date]?5:0);
  const ctx=document.getElementById('chartMain').getContext('2d');
  CHART.main=new Chart(ctx,{type:'line',
    data:{labels,datasets:[
      {label:'База',data:d.map(x=>x.base),borderColor:C.faint,borderWidth:1.4,borderDash:[5,4],pointRadius:0,tension:.3},
      {label:'Факт',data:d.map(x=>x.rev),borderWidth:2.2,tension:.25,
        pointRadius:ptR,pointBackgroundColor:ptColor,pointBorderColor:'#0A1420',pointBorderWidth:1.5,pointHoverRadius:6,
        borderColor:function(c){const{ctx,chartArea}=c.chart;if(!chartArea)return C.blue;
          const g=ctx.createLinearGradient(chartArea.left,0,chartArea.right,0);g.addColorStop(0,C.green);g.addColorStop(1,C.blue);return g;},
        fill:{target:'origin'},
        backgroundColor:function(c){const{ctx,chartArea}=c.chart;if(!chartArea)return 'rgba(80,195,255,.08)';
          const g=ctx.createLinearGradient(0,chartArea.top,0,chartArea.bottom);g.addColorStop(0,'rgba(60,250,180,.22)');g.addColorStop(1,'rgba(80,195,255,.02)');return g;}}
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},
        tooltip:tooltipStyle({title:i=>ruDate(i[0].label),label:c=>` ${c.dataset.label}: ${fmtM(c.raw)}`,
          afterBody:i=>{const f=flagMap[i[0].label];return f?['',`${f.flag==='РОСТ'?'▲':'▼'} ${f.dev>0?'+':''}${f.dev}% к базе`]:[];}})},
      scales:{x:xTimeScale(labels), y:yMln()}}});
}
function renderMonthChart(){
  destroyChart('month');
  const ctx=document.getElementById('chartMonth').getContext('2d');
  CHART.month=new Chart(ctx,{type:'bar',
    data:{labels:R.monthly.map(m=>m.month),datasets:[{data:R.monthly.map(m=>m.total),borderRadius:6,barThickness:'flex',maxBarThickness:40,
      backgroundColor:function(c){const{ctx,chartArea}=c.chart;if(!chartArea)return C.blue;
        const m=R.monthly[c.dataIndex];
        if(m&&m.mom!==null&&m.mom<0){const g=ctx.createLinearGradient(0,chartArea.top,0,chartArea.bottom);g.addColorStop(0,C.coral);g.addColorStop(1,'rgba(255,107,138,.4)');return g;}
        const g=ctx.createLinearGradient(0,chartArea.top,0,chartArea.bottom);g.addColorStop(0,C.green);g.addColorStop(1,C.blue);return g;}}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},title:chTitle('Выручка по месяцам'),tooltip:tooltipStyle({label:c=>' '+fmtMrd(c.raw)})},
      scales:{x:{grid:{display:false},ticks:{color:C.dim}},y:{grid:{color:C.grid},ticks:{color:C.faint,callback:v=>(v/1e9).toFixed(1)+'Б'}}}}});
}
function renderChannelChart(){
  destroyChart('ch');
  const cm=R.channels_monthly;
  const pal={callcenter:C.deep,sms:C.green,email:'#7C9CFF','mobile-push':'#9B7CE0',push:C.coral,messenger:'#5FD0C9'};
  const ds=Object.keys(cm.channels).map(ch=>({label:ch,data:cm.channels[ch],backgroundColor:pal[ch]||C.dim,borderRadius:3,borderWidth:0}));
  const ctx=document.getElementById('chartChannels').getContext('2d');
  CHART.ch=new Chart(ctx,{type:'bar',data:{labels:cm.months,datasets:ds},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'bottom',labels:{color:C.dim,boxWidth:10,padding:10,font:{size:10}}},
        title:chTitle('Структура по каналам'),tooltip:tooltipStyle({label:c=>` ${c.dataset.label}: ${fmtM(c.raw)}`})},
      scales:{x:{stacked:true,grid:{display:false},ticks:{color:C.dim}},y:{stacked:true,grid:{color:C.grid},ticks:{color:C.faint,callback:v=>Math.round(v/1e6)+'М'}}}}});
}
function tooltipStyle(cbs){return{backgroundColor:'#0D1826',borderColor:'rgba(80,195,255,.25)',borderWidth:1,padding:11,titleColor:C.ink,bodyColor:C.dim,cornerRadius:8,callbacks:cbs};}
function chTitle(t){return{display:true,text:t,color:C.ink,font:{size:13,weight:'600'},padding:{bottom:14},align:'start'};}
function xTimeScale(labels){return{grid:{color:C.grid,drawTicks:false},
  ticks:{color:C.faint,maxTicksLimit:12,callback:function(v){const l=this.getLabelForValue(v);if(!l)return'';const[,m,dd]=l.split('-');
    return dd==='01'?({1:'янв',2:'фев',3:'мар',4:'апр',5:'май',6:'июн',7:'июл',8:'авг',9:'сен',10:'окт',11:'ноя',12:'дек'})[+m]:'';}}};}
function yMln(){return{grid:{color:C.grid},ticks:{color:C.faint,callback:v=>Math.round(v/1e6)+'М'},beginAtZero:false};}

/* Отправка загруженного файла в базу. Строки уходят как есть — сервер сам
   отбрасывает служебные и сводит повторы по (дата, продукт, канал). */
function pushRevenue(rows, mode, fileName){
  return fetch(DEV_API+'/revenue',{
    method:'POST', credentials:'same-origin',
    headers:{'Content-Type':'application/json', Accept:'application/json'},
    body:JSON.stringify({mode:mode==='replace'?'replace':'append', fileName:fileName||null, rows})
  }).then(r=>{
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }).then(res=>{
    flashHint('✓ сохранено в базу: '+(res.rows||0)+' строк');
    return saveRun(res.loadId);
  }).catch(()=>{
    /* Данные на экране уже пересчитаны — молчать нельзя: человек уйдёт,
       думая, что коллеги увидят то же самое. */
    flashHint('⚠ в базу не сохранилось — данные только в этом окне');
  });
}

function handleImport(file, mode){
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array',cellDates:true});
      let longRows=null;
      if(wb.Sheets['Данные_день_продукт']) longRows=parseLongSheet(wb.Sheets['Данные_день_продукт']);
      if(!longRows||!longRows.length){ longRows=parseWideSheet(wb.Sheets[wb.SheetNames[0]]); }
      if(!longRows||!longRows.length) throw new Error('Не удалось извлечь данные.');
      const parsed=parseCommentsAndStatus(wb);
      if(Object.keys(parsed.notes).length) mergeNotes(parsed.notes);
      if(Object.keys(parsed.status).length) mergeStatus(parsed.status);
      if(mode==='replace'){ RAW=longRows; }
      else { const nd=new Set(longRows.map(r=>r.date)); RAW=RAW.filter(r=>!nd.has(r.date)).concat(longRows); }
      recompute(true);
      const n=[...new Set(longRows.map(r=>r.date))].length;
      flashHint(mode==='replace'?`✓ загружено ${n} дней`:`✓ добавлено ${n} дней`);
      /* Файл лёг в базу — теперь его видят все, а не только этот браузер.
         Следом пишем снимок расчёта: он привязан к загрузке, по нему потом
         видно, что показывал раздел на этих данных. */
      if(SRV) pushRevenue(longRows, mode, file && file.name);
    }catch(err){ alert('Ошибка импорта: '+err.message+'\n\nОжидается .xlsx/.csv в исходном формате (шапка: месяцы / дни / Group 1-3) или ранее выгруженный из панели файл.'); }
  };
  reader.readAsArrayBuffer(file);
}
function exportExcel(){
  const wb=buildWorkbook(R, loadNotes(), loadStatus(), RAW);
  XLSX.writeFile(wb, 'Анализ_выручки_'+new Date().toISOString().slice(0,10)+'.xlsx');
  flashHint('✓ Excel сохранён');
}
function exportNotesCSV(){
  const notes=loadNotes(), status=loadStatus(); const ctx={};
  R.checkdays.forEach(c=>ctx['check_'+c.date]={date:c.date,type:'проверка',subj:'кластер',auto:c.comment});
  R.declines.forEach(d=>ctx['decl_'+d.level+'__'+d.start]={date:d.start+'→'+d.end,type:'снижение',subj:d.level+' '+d.drop+'%',auto:d.comment});
  let csv='\ufeffДата;Тип;Объект;Авто-гипотеза;Статус;Мой комментарий\n';
  Object.keys(ctx).forEach(id=>{const c=ctx[id];const mine=(notes[id]||'').replace(/\n/g,' ');
    const st=status[id]==='solved'?'решено':'открыто';const auto=(c.auto||'').replace(/\n/g,' ').replace(/;/g,',');
    csv+=`${c.date};${c.type};"${c.subj}";"${auto}";${st};"${mine}"\n`;});
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='комментарии.csv';a.click();
}
function clearNotes(){
  /* Когда разбор общий, «очистить» — это стереть работу всей команды одним
     нажатием, причём без возможности вернуть. Такой кнопки быть не должно:
     ненужный комментарий убирается по одному, прямо в его поле. */
  if(SRV){
    alert('Комментарии теперь общие и хранятся в базе — стереть их все сразу нельзя.\n'+
          'Уберите ненужный комментарий в его поле: очистите текст и снимите «принято».');
    return;
  }
  if(confirm('Удалить все ваши комментарии и статусы из этого браузера? Авто-гипотезы останутся.')){
    localStorage.removeItem(NOTE_KEY);localStorage.removeItem(STAT_KEY);
    NOTES={};STATUS={};renderAll();flashHint('очищено');
  }
}
document.addEventListener('input',e=>{ if(e.target.tagName==='TEXTAREA'&&e.target.dataset.id) saveNote(e.target.dataset.id,e.target.value); });
function bindFile(inputId, mode){
  document.getElementById(inputId).addEventListener('change',ev=>{ if(ev.target.files[0]) handleImport(ev.target.files[0],mode);ev.target.value=''; });
}
setupChartDefaults();
window.addEventListener('DOMContentLoaded',()=>{
  bindFile('fileReplace','replace'); bindFile('fileAppend','append');
  /* Раздел поднимается от базы, а к демо-набору откатывается сам, если сервера
     нет (GitHub Pages) или доступ к разделу не выдан. */
  bootServer();
});
