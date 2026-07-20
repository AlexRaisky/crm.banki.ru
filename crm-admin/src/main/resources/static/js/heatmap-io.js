// ==================== IO: импорт / экспорт xlsx (SheetJS) ====================

// Разбор исходного «широкого» листа (как в файле пользователя): year/month/day в шапке
function parseWideSheet(ws){
  const A = XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null});
  // Ищем строки year/month/day по содержимому первых ~6 строк
  const MONTH_MAP={'январь':1,'февраль':2,'март':3,'апрель':4,'май':5,'июнь':6,
    'июль':7,'август':8,'сентябрь':9,'октябрь':10,'ноябрь':11,'декабрь':12};
  let rMonth=-1, rDay=-1, rHeader=-1;
  for(let i=0;i<Math.min(8,A.length);i++){
    const rowStr=A[i].map(x=>String(x).toLowerCase());
    if(rMonth<0 && rowStr.some(s=>s in MONTH_MAP)) rMonth=i;
    if(A[i].includes('Group 1')||A[i].includes('Group 3')) rHeader=i;
  }
  // day-строка — та, что между month и header и состоит из чисел
  for(let i=rMonth+1;i<(rHeader<0?A.length:rHeader);i++){
    const nums=A[i].filter(x=>x!=null&&!isNaN(x)&&x>=1&&x<=31);
    if(nums.length>20){rDay=i;break;}
  }
  if(rMonth<0||rDay<0||rHeader<0) throw new Error('Не распознан формат: нужны строки с месяцами, днями и Group 1/2/3.');
  // year-строка обычно над month
  const rYear=rMonth-1>=0?rMonth-1:rMonth;
  // колонки данных
  const dataCols=[];
  A[rMonth].forEach((m,c)=>{if(String(m).toLowerCase() in MONTH_MAP) dataCols.push(c);});
  const colDate={};
  dataCols.forEach(c=>{
    let y=A[rYear][c]; y=(y&&!isNaN(y))?Math.round(y):2026;
    const mo=MONTH_MAP[String(A[rMonth][c]).toLowerCase()];
    const d=Math.round(A[rDay][c]);
    colDate[c]=`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  });
  // тело
  const long=[];
  for(let i=rHeader+1;i<A.length;i++){
    const g1=A[i][0], g2=A[i][1], g3=A[i][2];
    if(g1==null&&g2==null&&g3==null) continue;
    dataCols.forEach(c=>{
      let v=A[i][c]; v=(v==null||isNaN(v))?0:+v;
      long.push({date:colDate[c],g1:String(g1),g2:String(g2),g3:String(g3),revenue:v});
    });
  }
  return long;
}

// Разбор «длинного» листа Данные_день_продукт (наш экспортный формат)
function parseLongSheet(ws){
  const rows=XLSX.utils.sheet_to_json(ws,{raw:true,defval:null});
  const out=[];
  rows.forEach(r=>{
    const date=normalizeDate(r['Дата']||r['date']);
    if(!date) return;
    out.push({date, g1:String(r['Group1']||r['g1']),
      g2:String(r['Group2']||r['g2']), g3:String(r['Group3_канал']||r['Group3']||r['g3']),
      revenue:+(r['Выручка']||r['revenue']||0)});
  });
  return out;
}

function normalizeDate(v){
  if(v==null) return null;
  if(v instanceof Date) return v.toISOString().slice(0,10);
  if(typeof v==='number'){ // excel serial
    const d=XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null;
    if(d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const s=String(v).trim();
  let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m)return `${m[1]}-${m[2]}-${m[3]}`;
  m=s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/); if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}

// Чтение комментариев И статусов из ранее экспортированного файла.
// Комментарии/статусы живут в рабочих блоках: «Требуют_проверки» и «Плавные_снижения».
function parseCommentsAndStatus(wb){
  const notes={}, status={};
  const statusOf = v => String(v||'').toLowerCase().includes('реш') ? 'solved' : '';
  // Требуют_проверки
  if(wb.Sheets['Требуют_проверки']){
    const rows=XLSX.utils.sheet_to_json(wb.Sheets['Требуют_проверки'],{raw:true,defval:null});
    rows.forEach(r=>{
      const d=normalizeDate(r['Дата']); if(!d) return;
      const id='check_'+d;
      const c=r['Мой комментарий']; if(c&&String(c).trim()) notes[id]=String(c).trim();
      const st=statusOf(r['Статус']); if(st) status[id]=st;
    });
  }
  // Плавные_снижения
  if(wb.Sheets['Плавные_снижения']){
    const rows=XLSX.utils.sheet_to_json(wb.Sheets['Плавные_снижения'],{raw:true,defval:null});
    rows.forEach(r=>{
      const lvl=r['Уровень'], st0=normalizeDate(r['Дата_начала']); if(!lvl||!st0) return;
      const id='decl_'+lvl+'__'+st0;
      const c=r['Мой комментарий']; if(c&&String(c).trim()) notes[id]=String(c).trim();
      const st=statusOf(r['Статус']); if(st) status[id]=st;
    });
  }
  return {notes,status};
}

// ---- ЭКСПОРТ: строим .xlsx из текущего состояния + комментариев + статусов ----
function buildWorkbook(R, notes, status, rawLong){
  const wb=XLSX.utils.book_new();
  const stLabel=id=>status[id]==='solved'?'решено':'открыто';

  // README
  const readme=[
    ['Анализ выручки по дням — выбросы и тренды'],[''],
    ['Экспортировано из HTML-панели: '+new Date().toLocaleString('ru-RU')],
    ['Период: '+R._meta.dates[0]+' — '+R._meta.dates[R._meta.dates.length-1]+' ('+R.daily.length+' дней)'],
    ['Активных продуктов: '+R._meta.nProducts+' | Выручка всего: '+Math.round(R._meta.totalRev/1e6)+' млн'],[''],
    ['Листы:'],
    ['  Дни_отклонений — ИНФОРМАЦИОННЫЙ: выбросы (рост/падение), сила, авто-гипотеза. Без ввода.'],
    ['  Требуют_проверки — РАБОЧИЙ: кластеры без явной причины. Колонки «Статус» и «Мой комментарий».'],
    ['  Плавные_снижения — РАБОЧИЙ: тренды вниз >=14 дней. Колонки «Статус» и «Мой комментарий».'],
    ['  Ежедневно_итого — выручка по дням + база (7-дн. медиана) + отклонение'],
    ['  Помесячно — сумма, среднее, волатильность, MoM'],
    ['  Данные_день_продукт — плоская таблица (для дозагрузки в панель)'],[''],
    ['Статус «решено» = гипотеза принята в панели. «Мой комментарий» и «Статус» читаются обратно при импорте.'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(readme), 'README');

  // Дни_отклонений — ИНФОРМАЦИОННЫЙ (без колонки ввода)
  const strength=dev=>{const a=Math.abs(dev);return a>=30?'сильное':a>=20?'среднее':'слабое';};
  const flagAOA=[['Дата','Месяц','День_недели','Характер','Отклонение_%','Сила','Выручка','База','Метка','Гипотеза (авто)']];
  R.flags.forEach(f=>{
    flagAOA.push([f.date, f.month, WD_FULL[f.wd]||f.wd, f.flag, f.dev, strength(f.dev),
      f.rev, f.base||Math.round(f.rev/(1+f.dev/100)),
      f.type==='confident'?'гипотеза ясна':'нужна проверка', f.comment]);
  });
  const wsFlag=XLSX.utils.aoa_to_sheet(flagAOA);
  wsFlag['!cols']=[{wch:12},{wch:10},{wch:13},{wch:10},{wch:12},{wch:9},{wch:14},{wch:14},{wch:14},{wch:56}];
  XLSX.utils.book_append_sheet(wb, wsFlag, 'Дни_отклонений');

  // Требуют_проверки — РАБОЧИЙ (статус + комментарий)
  const checkAOA=[['Дата','Что проверить (авто)','Статус','Мой комментарий']];
  (R.checkdays||[]).forEach(c=>{
    const id='check_'+c.date;
    checkAOA.push([c.date, c.comment, stLabel(id), notes[id]||'']);
  });
  const wsCheck=XLSX.utils.aoa_to_sheet(checkAOA);
  wsCheck['!cols']=[{wch:12},{wch:60},{wch:10},{wch:44}];
  XLSX.utils.book_append_sheet(wb, wsCheck, 'Требуют_проверки');

  // Плавные_снижения — РАБОЧИЙ (статус + комментарий)
  const declAOA=[['Уровень','Дата_начала','Дата_конца','Длит_дней','Выручка_старт','Выручка_финиш','Снижение_%','Гипотеза (авто)','Статус','Мой комментарий']];
  R.declines.forEach(d=>{
    const id='decl_'+d.level+'__'+d.start;
    declAOA.push([d.level,d.start,d.end,d.days,d.rev_start,d.rev_end,-Math.abs(d.drop),
      d.comment||'', stLabel(id), notes[id]||'']);
  });
  const wsDecl=XLSX.utils.aoa_to_sheet(declAOA);
  wsDecl['!cols']=[{wch:38},{wch:13},{wch:13},{wch:10},{wch:15},{wch:15},{wch:12},{wch:44},{wch:10},{wch:40}];
  XLSX.utils.book_append_sheet(wb, wsDecl, 'Плавные_снижения');

  // Ежедневно_итого
  const dayAOA=[['Дата','Выручка_всего','База_7дн','Откл_от_базы_%','Флаг']];
  R.daily.forEach(d=>{
    const fl=d.dev==null?'':(d.dev>=20?'РОСТ':d.dev<=-20?'ПАДЕНИЕ':'');
    dayAOA.push([d.date,d.rev,d.base,d.dev,fl]);
  });
  const wsDay=XLSX.utils.aoa_to_sheet(dayAOA);
  wsDay['!cols']=[{wch:12},{wch:16},{wch:14},{wch:14},{wch:10}];
  XLSX.utils.book_append_sheet(wb, wsDay, 'Ежедневно_итого');

  // Помесячно
  const monAOA=[['Месяц','Выручка_всего','Средн_в_день','Мин_день','Макс_день','Волатильность','MoM_%']];
  R.monthly.forEach(m=>monAOA.push([m.month,m.total,m.avg,m.min,m.max,m.std,m.mom]));
  const wsMon=XLSX.utils.aoa_to_sheet(monAOA);
  wsMon['!cols']=[{wch:10},{wch:16},{wch:14},{wch:14},{wch:14},{wch:14},{wch:10}];
  XLSX.utils.book_append_sheet(wb, wsMon, 'Помесячно');

  // Данные_день_продукт (для повторной дозагрузки)
  const longAOA=[['Дата','Group1','Group2','Group3','Выручка']];
  rawLong.forEach(r=>longAOA.push([r.date,r.g1,r.g2,r.g3,r.revenue]));
  const wsLong=XLSX.utils.aoa_to_sheet(longAOA);
  wsLong['!cols']=[{wch:12},{wch:14},{wch:26},{wch:14},{wch:14}];
  XLSX.utils.book_append_sheet(wb, wsLong, 'Данные_день_продукт');

  return wb;
}
