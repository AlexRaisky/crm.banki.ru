/* ---------- старт (после загрузки скриптов всех разделов) ---------- */
renderGrid();
(function () {
  let last = store.get("lastSection", { sid:"home", cid:null });
  if (typeof last === "string"){
    /* миграция со старой плоской навигации (crmpanel:lastSection был строкой) */
    const map = {
      home:["home",null], onelink:["comms","onelink"], admin:["comms","admin"],
      /* список шаблонов переехал в «Сущности» → «Шаблоны и сегменты» */
      templates:["entities","ent-template"], dashboard:["dash","dashboard"],
      deviations:["dash","deviations"], journeys:["journeys",null], access:["access",null]
    };
    last = map[last] ? { sid:map[last][0], cid:map[last][1] } : { sid:"home", cid:null };
  }
  // Восстанавливаем последний раздел ПОСЛЕ ответа /api/env, чтобы разделы, ограниченные
  // средой (напр. «Цепочки» — только test), корректно открывались/скрывались.
  const restore = function () {
    const s = last && sectionById(last.sid);
    if (s && sectionAllowed(s)) openSection(last.sid, last.cid);
    else openSection("home");
  };
  const envReady = (window.CRM && CRM.envReady) ? CRM.envReady : Promise.resolve();
  envReady.then(restore, restore);
  if (UI_LANG === "en") applyLang(true);   /* полный перевод статики и перерисовка на выбранном языке */
})();
