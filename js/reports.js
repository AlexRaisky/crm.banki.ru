/* =========================================================
   ОТЧЁТЫ — макет окна встраивания Tableau.
   Пока бэкенд-коннектора нет, здесь показан демонстрационный
   макет: панель Tableau (книга, листы, тулбар) и типовые
   виджеты дашборда на плейсхолдер-данных. Реальное подключение
   через Tableau Embedding API v3 включится после настройки
   адреса сервера и доступа (см. блок «Код встраивания»).
   Все числа ниже — демонстрационные.
   ========================================================= */
function rpT(s){ return (typeof t === 'function') ? t(s) : s; }
function rpEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

var RP_STATE = { report: 'funnel', tab: 'overview' };

/* ---------- демо-данные отчётов ---------- */
var RP_DATA = {
  funnel: {
    name: 'Воронка коммуникаций',
    kpis: [
      { l:'Отправлено',  v:'1.24 млн', cls:'',      d:'за 30 дней' },
      { l:'Доставлено',  v:'96.8%',    cls:'green', d:'+1.2 п.п.', dd:'up' },
      { l:'CTR',         v:'4.2%',     cls:'blue',  d:'−0.3 п.п.', dd:'down' },
      { l:'Конверсия',   v:'1.1%',     cls:'amber', d:'+0.1 п.п.', dd:'up' }
    ],
    tabs: [
      { id:'overview', label:'Обзор', tiles:[
        { type:'funnel', title:'Воронка этапов', sub:'доля от отправленных, %',
          data:[['Отправлено',100,'b'],['Доставлено',96.8,'b'],['Открыто',38.4,'g'],['Клик',4.2,'a'],['Конверсия',1.1,'c']] },
        { type:'line', title:'Доставляемость по дням', sub:'%, последние 14 дней',
          data:[94,95,96,95.5,97,96.8,97.2,96.5,97.4,96.9,97.1,96.6,97,96.8], min:90, max:100 }
      ]},
      { id:'stages', label:'Этапы', tiles:[
        { type:'table', title:'Показатели по этапам', sub:'абсолют и доля',
          cols:['Этап','Объём','Доля'],
          rows:[['Отправлено','1 240 000',100],['Доставлено','1 200 320',96.8],
                ['Открыто','476 200',38.4],['Клик','52 080',4.2],['Конверсия','13 640',1.1]] }
      ]}
    ]
  },
  delivery: {
    name: 'Доставляемость по каналам',
    kpis: [
      { l:'E-mail',       v:'98.1%', cls:'blue',  d:'доставлено' },
      { l:'Mobile-push',  v:'92.4%', cls:'green', d:'доставлено' },
      { l:'SMS',          v:'99.3%', cls:'amber', d:'доставлено' },
      { l:'Отписки',      v:'0.28%', cls:'coral', d:'−0.05 п.п.', dd:'up' }
    ],
    tabs: [
      { id:'overview', label:'Каналы', tiles:[
        { type:'group', title:'Доставлено и открыто по каналам', sub:'%',
          groups:['E-mail','Mobile-push','SMS'],
          series:[{name:'Доставлено',cls:'b',data:[98.1,92.4,99.3]},{name:'Открыто',cls:'g',data:[41,33,0]}] },
        { type:'line', title:'Доставляемость e-mail', sub:'%, 14 дней',
          data:[97.4,98,97.8,98.2,98,98.4,98.1,97.9,98.3,98.1,98,98.2,98.1,98.1], min:96, max:100 }
      ]},
      { id:'detail', label:'Детализация', tiles:[
        { type:'table', title:'Сводка по каналам', sub:'за 30 дней',
          cols:['Канал','Отправлено','Доставлено','Открыто'],
          rows:[['E-mail','720 400','98.1%','41%'],['Mobile-push','410 900','92.4%','33%'],['SMS','108 700','99.3%','—']] }
      ]}
    ]
  },
  promo: {
    name: 'Эффективность промо',
    kpis: [
      { l:'Промо-рассылок', v:'58',    cls:'',      d:'за месяц' },
      { l:'Средний CTR',    v:'5.1%',  cls:'blue',  d:'+0.6 п.п.', dd:'up' },
      { l:'Конверсия',      v:'1.7%',  cls:'green', d:'+0.2 п.п.', dd:'up' },
      { l:'Выручка',        v:'8.9 млн ₽', cls:'amber', d:'атрибуция 7 дней' }
    ],
    tabs: [
      { id:'overview', label:'Динамика', tiles:[
        { type:'line', title:'Конверсия промо по дням', sub:'%',
          data:[1.2,1.4,1.1,1.6,1.5,1.8,1.7,2.0,1.6,1.9,1.7,2.1,1.8,1.7], min:0, max:2.5 },
        { type:'group', title:'CTR по каналам', sub:'%',
          groups:['E-mail','Mobile-push','SMS'],
          series:[{name:'CTR',cls:'b',data:[5.4,6.1,3.2]}] }
      ]},
      { id:'top', label:'Топ-кампании', tiles:[
        { type:'table', title:'Лучшие промо', sub:'по конверсии',
          cols:['Кампания','Канал','CTR','Конв.'],
          rows:[['Альфа-Карта','Mobile-push','7.3%','2.4%'],['Вклады БЖФ','E-mail','6.1%','2.1%'],
                ['ОСАГО Ренессанс','E-mail','5.8%','1.9%'],['Розыгрыш Ozon','Mobile-push','5.2%','1.6%']] }
      ]}
    ]
  }
};

/* ---------- построение SVG-виджетов ---------- */
function rpFunnel(data){
  var W = 520, rowH = 34, gap = 10, H = data.length * (rowH + gap);
  var maxLabel = 92;
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '">';
  data.forEach(function(d, i){
    var y = i * (rowH + gap);
    var full = W - maxLabel - 60;
    var w = Math.max(4, full * d[1] / 100);
    s += '<text class="tv-lbl" x="0" y="' + (y + rowH / 2 + 4) + '">' + rpEsc(d[0]) + '</text>';
    s += '<rect x="' + maxLabel + '" y="' + y + '" width="' + full + '" height="' + rowH + '" rx="7" fill="var(--line)" opacity=".5"/>';
    s += '<rect class="bar-' + d[2] + '" x="' + maxLabel + '" y="' + y + '" width="' + w + '" height="' + rowH + '" rx="7"/>';
    s += '<text class="tv-val" x="' + (maxLabel + full + 8) + '" y="' + (y + rowH / 2 + 4) + '">' + d[1] + '%</text>';
  });
  return s + '</svg>';
}
function rpLine(t){
  var W = 520, H = 200, pl = 32, pr = 10, pt = 12, pb = 22;
  var min = t.min, max = t.max, data = t.data;
  var iw = W - pl - pr, ih = H - pt - pb;
  var x = function(i){ return pl + iw * i / (data.length - 1); };
  var y = function(v){ return pt + ih * (1 - (v - min) / (max - min)); };
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '">';
  for (var g = 0; g <= 4; g++){
    var gy = pt + ih * g / 4, gv = (max - (max - min) * g / 4);
    s += '<line class="tv-grid" x1="' + pl + '" y1="' + gy + '" x2="' + (W - pr) + '" y2="' + gy + '"/>';
    s += '<text class="tv-val" x="0" y="' + (gy + 3) + '">' + (Math.round(gv * 10) / 10) + '</text>';
  }
  var dPath = data.map(function(v, i){ return (i ? 'L' : 'M') + x(i) + ' ' + y(v); }).join(' ');
  var area = dPath + ' L' + x(data.length - 1) + ' ' + (pt + ih) + ' L' + x(0) + ' ' + (pt + ih) + ' Z';
  s += '<path class="ln-area b" d="' + area + '"/>';
  s += '<path class="ln b" d="' + dPath + '"/>';
  data.forEach(function(v, i){ s += '<circle class="dot b" cx="' + x(i) + '" cy="' + y(v) + '" r="3"/>'; });
  return s + '</svg>';
}
function rpGroup(t){
  var W = 520, H = 200, pl = 30, pr = 10, pt = 12, pb = 26;
  var iw = W - pl - pr, ih = H - pt - pb;
  var max = 100, groups = t.groups, series = t.series;
  var gw = iw / groups.length, bw = Math.min(34, gw / (series.length + 1));
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '">';
  s += '<line class="tv-axis" x1="' + pl + '" y1="' + (pt + ih) + '" x2="' + (W - pr) + '" y2="' + (pt + ih) + '"/>';
  groups.forEach(function(g, gi){
    var gx = pl + gw * gi + gw / 2;
    var totalW = series.length * bw + (series.length - 1) * 4;
    series.forEach(function(se, si){
      var v = se.data[gi]; if (v == null) return;
      var h = ih * v / max, bx = gx - totalW / 2 + si * (bw + 4);
      s += '<rect class="bar-' + se.cls + '" x="' + bx + '" y="' + (pt + ih - h) + '" width="' + bw + '" height="' + h + '" rx="4"/>';
    });
    s += '<text class="tv-lbl" x="' + gx + '" y="' + (pt + ih + 16) + '" text-anchor="middle">' + rpEsc(g) + '</text>';
  });
  return s + '</svg>';
}
function rpTable(t){
  var head = '<tr>' + t.cols.map(function(c, i){ return '<th' + (i ? ' style="text-align:right"' : '') + '>' + rpEsc(rpT(c)) + '</th>'; }).join('') + '</tr>';
  var body = t.rows.map(function(r){
    return '<tr>' + r.map(function(cell, i){
      if (i === 0) return '<td>' + rpEsc(cell) + '</td>';
      /* последняя числовая доля в первой таблице — рисуем мини-бар */
      return '<td class="num">' + rpEsc(cell) + (typeof cell === 'number' ?
        '<div class="tv-bar-mini" style="width:' + Math.max(3, cell) + '%"></div>' : '') + '</td>';
    }).join('') + '</tr>';
  }).join('');
  return '<table class="tv-tbl"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
}
function rpLegend(series){
  return '<div class="tv-legend">' + series.map(function(se){
    return '<span><i class="bar-' + se.cls + '" style="background:var(--' + ({b:'blue',g:'green',a:'amber',c:'coral'}[se.cls]) + ')"></i>' + rpEsc(rpT(se.name)) + '</span>';
  }).join('') + '</div>';
}

function rpTileHtml(tile){
  var body;
  if (tile.type === 'funnel') body = rpFunnel(tile.data);
  else if (tile.type === 'line') body = rpLine(tile);
  else if (tile.type === 'group') body = rpGroup(tile) + rpLegend(tile.series);
  else if (tile.type === 'table') body = rpTable(tile);
  else body = '';
  return '<div class="tile"><div class="tile-head"><div>' +
    '<div class="tv-title">' + rpEsc(rpT(tile.title)) + '</div>' +
    (tile.sub ? '<div class="tv-sub">' + rpEsc(rpT(tile.sub)) + '</div>' : '') +
    '</div></div>' + body + '</div>';
}

/* ---------- рендер окна ---------- */
function rpRenderTabs(){
  var rep = RP_DATA[RP_STATE.report];
  var box = document.getElementById('rpTabs');
  if (!box || !rep) return;
  box.innerHTML = rep.tabs.map(function(tb){
    return '<button class="' + (tb.id === RP_STATE.tab ? 'on' : '') + '" onclick="rpTab(\'' + tb.id + '\')">' + rpEsc(rpT(tb.label)) + '</button>';
  }).join('');
}
function rpRenderBody(){
  var rep = RP_DATA[RP_STATE.report];
  var body = document.getElementById('rpBody');
  if (!body || !rep) return;
  var tab = rep.tabs.filter(function(x){ return x.id === RP_STATE.tab; })[0] || rep.tabs[0];
  var kpis = '<div class="dash-grid kpis">' + rep.kpis.map(function(k){
    return '<div class="kpi-t"><div class="l">' + rpEsc(rpT(k.l)) + '</div>' +
      '<div class="v ' + (k.cls || '') + '">' + rpEsc(k.v) + '</div>' +
      (k.d ? '<div class="d ' + (k.dd || '') + '">' + rpEsc(rpT(k.d)) + '</div>' : '') + '</div>';
  }).join('') + '</div>';
  var tiles = '<div class="dash-grid tiles">' + tab.tiles.map(rpTileHtml).join('') + '</div>';
  body.innerHTML = kpis + tiles;
}
function rpRender(){
  var wb = document.getElementById('rpWorkbook');
  if (wb && RP_DATA[RP_STATE.report]) wb.textContent = rpT(RP_DATA[RP_STATE.report].name);
  rpRenderTabs(); rpRenderBody();
}

/* переключение отчёта из тулбара */
function rpSelect(key){
  if (!RP_DATA[key]) return;
  RP_STATE.report = key;
  RP_STATE.tab = RP_DATA[key].tabs[0].id;
  rpRender();
}
function rpTab(id){ RP_STATE.tab = id; rpRender(); }

/* обновление: скелетон, затем перерисовка (имитация загрузки Tableau) */
function rpRefresh(){
  var body = document.getElementById('rpBody');
  if (!body) return;
  body.innerHTML = '<div class="tv-skel"><div class="sk row"></div><div class="sk big"></div></div>';
  clearTimeout(rpRefresh._t);
  rpRefresh._t = setTimeout(rpRenderBody, 650);
}
/* полноэкранный режим окна (CSS-оверлей — надёжнее нативного requestFullscreen во встраивании) */
function rpFullscreen(){
  var f = document.getElementById('rpFrame');
  if (!f) return;
  var on = f.classList.toggle('tv-fullscreen');
  var btn = document.getElementById('rpFsBtn');
  if (btn) btn.textContent = on ? ('✕ ' + rpT('Свернуть')) : ('⤢ ' + rpT('Во весь экран'));
}
function rpToggleCode(){
  var c = document.getElementById('rpCode');
  if (c) c.hidden = !c.hidden;
}
/* закрытие фуллскрина по Esc */
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape'){
    var f = document.getElementById('rpFrame');
    if (f && f.classList.contains('tv-fullscreen')) rpFullscreen();
  }
});

rpRender();
