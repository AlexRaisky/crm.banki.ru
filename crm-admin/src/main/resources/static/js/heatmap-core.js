// ==================== ЯДРО АНАЛИТИКИ (порт из Python) ====================
// Работает над «сырыми» данными day×product и пересчитывает всё при импорте.

const CH_ORDER = ['callcenter','email','messenger','mobile-push','push','sms'];
const MONTHS_RU = {1:'январь',2:'февраль',3:'март',4:'апрель',5:'май',6:'июнь',
  7:'июль',8:'август',9:'сентябрь',10:'октябрь',11:'ноябрь',12:'декабрь'};
const MON_SHORT = {1:'янв',2:'фев',3:'мар',4:'апр',5:'май',6:'июн',
  7:'июл',8:'авг',9:'сен',10:'окт',11:'ноя',12:'дек'};
const WD = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const WD_FULL = {'Пн':'понедельник','Вт':'вторник','Ср':'среда','Чт':'четверг','Пт':'пятница','Сб':'суббота','Вс':'воскресенье'};
const SERVICE = new Set(['Grand Total','not_off','Total','nan','']);

function median(arr){
  const a=arr.filter(v=>v!=null).slice().sort((x,y)=>x-y);
  if(!a.length) return null;
  const m=Math.floor(a.length/2);
  return a.length%2 ? a[m] : (a[m-1]+a[m])/2;
}
function mean(arr){const a=arr.filter(v=>v!=null);return a.length?a.reduce((s,v)=>s+v,0)/a.length:0;}
function std(arr){const a=arr.filter(v=>v!=null);if(a.length<2)return 0;const m=mean(a);
  return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length);}

// Скользящая центрированная 7-дн. медиана (окно ±3)
function rollingMedian(vals, win=7, minP=4){
  const half=Math.floor(win/2), out=new Array(vals.length).fill(null);
  for(let i=0;i<vals.length;i++){
    const lo=Math.max(0,i-half), hi=Math.min(vals.length-1,i+half);
    const w=vals.slice(lo,hi+1).filter(v=>v!=null);
    if(w.length>=minP) out[i]=median(w);
  }
  return out;
}
function rollingMean(vals, win=7, minP=5){
  const half=Math.floor(win/2), out=new Array(vals.length).fill(null);
  for(let i=0;i<vals.length;i++){
    const lo=Math.max(0,i-half), hi=Math.min(vals.length-1,i+half);
    const w=vals.slice(lo,hi+1).filter(v=>v!=null);
    if(w.length>=minP) out[i]=mean(w);
  }
  return out;
}

// ---- Главная функция: из «длинной» таблицы строк {date,g1,g2,g3,revenue} → полная аналитика
function analyze(longRows){
  // фильтр служебных строк
  const rows = longRows.filter(r=>
    !SERVICE.has(r.g1) && !SERVICE.has(r.g2) && !SERVICE.has(r.g3) &&
    r.g1 && r.g2 && r.g3);

  // множество дат
  const dateSet = new Set(rows.map(r=>r.date));
  const dates = [...dateSet].sort();

  // итог по дням
  const totByDate = {}; dates.forEach(d=>totByDate[d]=0);
  // pivot product→date→value
  const prodKey = r=>`${r.g1} / ${r.g2} / ${r.g3}`;
  const piv = {}; // prod -> {date:val}
  const chByDate = {}; // date -> {channel:val}
  dates.forEach(d=>{chByDate[d]={};CH_ORDER.forEach(c=>chByDate[d][c]=0);});

  rows.forEach(r=>{
    totByDate[r.date]+=r.revenue;
    const p=prodKey(r);
    (piv[p]=piv[p]||{})[r.date]=(piv[p][r.date]||0)+r.revenue;
    if(chByDate[r.date] && r.g3 in chByDate[r.date]) chByDate[r.date][r.g3]+=r.revenue;
  });

  // ---- daily total + base ----
  const totVals = dates.map(d=>totByDate[d]);
  const totBase = rollingMedian(totVals);
  const daily = dates.map((d,i)=>{
    const base=totBase[i], rev=totVals[i];
    const dev = base ? (rev-base)/base*100 : null;
    return {date:d, rev:Math.round(rev), base:base?Math.round(base):null,
      dev:dev==null?null:Math.round(dev*10)/10};
  });

  // ---- флаги итог: |dev|>=20% ----
  const flags = [];
  daily.forEach(row=>{
    if(row.dev!=null && Math.abs(row.dev)>=20){
      const dt=new Date(row.date+'T00:00:00');
      const wd=WD[(dt.getDay()+6)%7];
      // топ-драйверы: продукты с макс |факт-база_продукта|
      const idx=dates.indexOf(row.date);
      const drivers=[];
      for(const p in piv){
        const pv=dates.map(d=>piv[p][d]||0);
        const pb=rollingMedian(pv);
        const diff=(piv[p][row.date]||0)-(pb[idx]||0);
        drivers.push([p,diff]);
      }
      drivers.sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
      flags.push({date:row.date, flag:row.dev>0?'РОСТ':'ПАДЕНИЕ', dev:row.dev,
        rev:row.rev, wd, month:MONTHS_RU[dt.getMonth()+1],
        drivers:drivers.slice(0,3).map(([p,v])=>({p,v:Math.round(v)})),
        type:'', comment:''});
    }
  });

  // ---- плавные снижения ----
  function findDeclines(vals, minDays, minDrop){
    const sm=rollingMean(vals);
    // индексы, где sm не null
    const pts=[]; sm.forEach((v,i)=>{if(v!=null)pts.push([i,v]);});
    const res=[]; let i=0;
    while(i<pts.length-1){
      let cur=i, best=i;
      let k=i+1;
      while(k<pts.length){
        if(pts[k][1]<=pts[cur][1]*1.02){cur=k;if(pts[k][1]<pts[best][1])best=k;k++;}
        else break;
      }
      const di=dates[pts[i][0]], db=dates[pts[best][0]];
      const span=(new Date(db)-new Date(di))/86400000;
      const drop=pts[i][1]>0?(pts[i][1]-pts[best][1])/pts[i][1]:0;
      if(span>=minDays && drop>=minDrop){
        res.push({start:di,end:db,days:Math.round(span),
          rev_start:Math.round(pts[i][1]),rev_end:Math.round(pts[best][1]),
          drop:Math.round(drop*1000)/10});
        i=best;
      } else i++;
    }
    return res;
  }
  const declines=[];
  findDeclines(totVals,14,0.20).forEach(d=>declines.push({level:'Итого по всем продуктам',...d,comment:''}));
  // по крупным продуктам (средняя > 500k)
  const prodMean={};
  for(const p in piv){const vv=dates.map(d=>piv[p][d]||0);prodMean[p]=mean(vv);}
  Object.keys(piv).filter(p=>prodMean[p]>500000).forEach(p=>{
    const vv=dates.map(d=>piv[p][d]||0);
    findDeclines(vv,14,0.30).forEach(d=>declines.push({level:p,...d,comment:''}));
  });

  // ---- помесячно ----
  const byMonth={};
  dates.forEach((d,i)=>{const m=+d.slice(5,7);(byMonth[m]=byMonth[m]||[]).push(totVals[i]);});
  const monthly=Object.keys(byMonth).map(Number).sort((a,b)=>a-b).map(m=>{
    const v=byMonth[m];
    return {month:MONTHS_RU[m], total:Math.round(v.reduce((s,x)=>s+x,0)),
      avg:Math.round(mean(v)), min:Math.round(Math.min(...v)),
      max:Math.round(Math.max(...v)), std:Math.round(std(v)), mom:null};
  });
  for(let i=1;i<monthly.length;i++){
    monthly[i].mom=Math.round((monthly[i].total/monthly[i-1].total-1)*1000)/10;
  }

  // ---- каналы помесячно ----
  const chMonths=[], chData={}; CH_ORDER.forEach(c=>chData[c]=[]);
  const monthsSorted=Object.keys(byMonth).map(Number).sort((a,b)=>a-b);
  monthsSorted.forEach(m=>{
    chMonths.push(MON_SHORT[m]);
    const acc={}; CH_ORDER.forEach(c=>acc[c]=0);
    dates.forEach(d=>{if(+d.slice(5,7)===m)CH_ORDER.forEach(c=>acc[c]+=chByDate[d][c]);});
    CH_ORDER.forEach(c=>chData[c].push(Math.round(acc[c])));
  });

  // ---- каналы по дням (для детального графика) ----
  const chDaily = dates.map(d=>({date:d, ...Object.fromEntries(CH_ORDER.map(c=>[c,Math.round(chByDate[d][c])]))}));

  // авто-гипотезы для флагов (эвристика)
  autoHypotheses(flags);

  return {daily, flags, declines, monthly,
    channels_monthly:{months:chMonths, channels:chData},
    channels_daily:chDaily,
    checkdays:[], // вычисляется отдельно ниже
    _meta:{dates, nProducts:Object.keys(piv).filter(p=>prodMean[p]>0).length,
      totalRev:Math.round(totVals.reduce((s,x)=>s+x,0))}};
}

// Простая эвристика гипотез по дате/драйверам (когда данные новые и нет ручной гипотезы)
function autoHypotheses(flags){
  flags.forEach(f=>{
    const dt=new Date(f.date+'T00:00:00');
    const day=dt.getDate(), month=dt.getMonth()+1;
    const isWeekend=['Сб','Вс'].includes(f.wd);
    const lastDom=new Date(dt.getFullYear(),month,0).getDate();
    const isMonthEnd=day>=lastDom-1;
    const topDriver=f.drivers&&f.drivers[0]?f.drivers[0].p:'';
    const nm=n=>(n/1e6).toFixed(1).replace('.',',');
    const drvStr=f.drivers?f.drivers.map(d=>`${d.p} (${d.v>0?'+':''}${nm(d.v)} млн)`).join(', '):'';
    // новогодний
    if(month===1&&day<=2){f.type='confident';
      f.comment=`Новогодние праздники — нерабочие дни. Драйверы: ${drvStr}. Календарный фактор.`;return;}
    if(isMonthEnd&&f.flag==='РОСТ'){f.type='confident';
      f.comment=`Конец месяца — вероятна докрутка плана. Драйверы: ${drvStr}.`;return;}
    if(isWeekend&&f.flag==='ПАДЕНИЕ'){f.type='check';
      f.comment=`Выходной, но провал глубже обычного. Драйверы: ${drvStr}. ПРОВЕРИТЬ доставку/паузу рассылок по ключевому продукту.`;return;}
    // прочее
    f.type='check';
    f.comment=`Нетипичное отклонение. Драйверы: ${drvStr}. ПРОВЕРИТЬ активность по этим продуктам/каналам в этот день.`;
  });
}

// Кластеры продуктовых аномалий → дни для точечной проверки
function computeCheckDays(longRows, flagDates){
  const rows=longRows.filter(r=>!SERVICE.has(r.g1)&&!SERVICE.has(r.g2)&&!SERVICE.has(r.g3)&&r.g1&&r.g2&&r.g3);
  const dates=[...new Set(rows.map(r=>r.date))].sort();
  const prodKey=r=>`${r.g1} / ${r.g2} / ${r.g3}`;
  const piv={};
  rows.forEach(r=>{(piv[prodKey(r)]=piv[prodKey(r)]||{})[r.date]=(piv[prodKey(r)][r.date]||0)+r.revenue;});
  const prodMean={};
  for(const p in piv){prodMean[p]=mean(dates.map(d=>piv[p][d]||0));}
  const material=Object.keys(piv).filter(p=>prodMean[p]>500000);
  const cntByDate={};
  material.forEach(p=>{
    const vv=dates.map(d=>piv[p][d]||0);
    const base=rollingMedian(vv);
    vv.forEach((v,i)=>{
      const b=base[i]; if(!b)return;
      const dev=(v-b)/b*100;
      if(Math.abs(dev)>=60 && b>prodMean[p]*0.3 && Math.abs(v-b)>prodMean[p]*0.8){
        cntByDate[dates[i]]=(cntByDate[dates[i]]||0)+1;
      }
    });
  });
  const fset=new Set(flagDates);
  return Object.entries(cntByDate)
    .filter(([d,n])=>n>=4 && !fset.has(d))
    .sort((a,b)=>b[1]-a[1])
    .slice(0,6)
    .map(([d,n])=>({date:d,
      comment:`Кластер из ${n} продуктовых аномалий без движения итога по дню — вероятна взаимокомпенсация или локальная докрутка. Однозначной причины из данных нет, ПРОВЕРИТЬ вручную.`}));
}
