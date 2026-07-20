/* =========================================================
   КОНСТРУКТОР SOURCE — сборка source по правилам названия
   кампании. Формулы приведены к живому мастеру (v2,
   computeCampaignName):
     promo   → канал_promo_продукт_партнёр_имя_ддммгг
     trigger → канал_trigger_продукт_имя_Nday
     callcenter → первая часть contact; trigger: …_имя_сегмент_Nday;
                  promo: …_имя_ддммггday (как в computeCampaignName)
   Значение подставляется в source_type шаблонов и в параметр c ссылок.
   ========================================================= */
(function(){
  const ids = ["sbChannel","sbCampType","sbProduct","sbPartner","sbUniqP","sbDate","sbUniqT","sbSegment","sbDay",
               "sbWrapPartner","sbWrapUniqP","sbWrapDate","sbWrapUniqT","sbWrapSegment","sbWrapDay",
               "sbResult","sbResultCard","sbBanner","sbCopyBtn"];
  const el = {};
  ids.forEach(id => el[id] = document.getElementById(id));
  if (!el.sbChannel) return;

  const slug = v => (v || "").trim().replace(/\s+/g, "-");
  const clean = v => (v || "").trim().replace(/\s+/g, "");
  const fmtDate = iso => { if (!iso) return ""; const p = iso.split("-"); return p[2] + p[1] + p[0].slice(2); };

  function syncVisibility(){
    const type = el.sbCampType.value;
    const isCC = el.sbChannel.value === "callcenter";
    el.sbWrapPartner.style.display = type === "promo" ? "" : "none";
    el.sbWrapUniqP.style.display   = type === "promo" ? "" : "none";
    el.sbWrapDate.style.display    = type === "promo" ? "" : "none";
    el.sbWrapUniqT.style.display   = type === "trigger" ? "" : "none";
    el.sbWrapDay.style.display     = type === "trigger" ? "" : "none";
    el.sbWrapSegment.style.display = (type === "trigger" && isCC) ? "" : "none";
  }

  /* Глобально — используется applyLang для перерисовки при смене языка */
  window.sbUpdate = function(){
    const channel = el.sbChannel.value;
    const isCC = channel === "callcenter";
    const campChannel = isCC ? "contact" : channel;   /* sms | mobile-push | email | contact */
    const type = el.sbCampType.value;
    const product = el.sbProduct.value;
    const missing = [];
    if (!channel) missing.push("channel");
    if (!type) missing.push("campType");
    if (!product) missing.push("product");

    let parts = [];
    if (type === "promo"){
      const partner = slug(el.sbPartner.value);
      const uniq = slug(el.sbUniqP.value);
      let date = fmtDate(el.sbDate.value);
      if (!partner) missing.push("partner");
      if (!uniq) missing.push("uniqP");
      if (!el.sbDate.value) missing.push("date");
      /* КЦ-promo в v2 (computeCampaignName) заканчивается на ддммггday */
      if (isCC && date) date += "day";
      parts = [campChannel, "promo", product, partner, uniq, date];
    } else if (type === "trigger"){
      const uniq = slug(el.sbUniqT.value);
      const day = clean(el.sbDay.value);
      if (!uniq) missing.push("uniqT");
      if (!day) missing.push("day");
      if (isCC){
        const seg = clean(el.sbSegment.value);
        if (!seg) missing.push("segment");
        parts = [campChannel, "trigger", product, uniq, seg, day ? day + "day" : ""];
      } else {
        parts = [campChannel, "trigger", product, uniq, day ? day + "day" : ""];
      }
    } else {
      parts = [campChannel, "", product];
    }

    const value = parts.filter(p => p !== "").join("_");
    el.sbResult.innerHTML = value
      ? value.split("_").map(p => '<span class="part">' + p + '</span>').join('<span class="us">_</span>')
      : "";

    document.querySelectorAll('#sec-srcbuilder .field[data-req]').forEach(f => {
      const key = f.getAttribute("data-req");
      const visible = f.offsetParent !== null;
      f.classList.toggle("missing", visible && missing.includes(key));
    });

    const ready = missing.length === 0;
    el.sbResultCard.classList.toggle("is-draft", !ready);
    el.sbResultCard.classList.toggle("is-ready", ready);
    el.sbCopyBtn.disabled = !ready;
    el.sbCopyBtn.textContent = (typeof t === "function") ? t("⧉ Скопировать") : "⧉ Скопировать";
    if (ready){
      el.sbBanner.className = "banner ready";
      el.sbBanner.innerHTML = '<span class="pulse"></span>' + ((typeof t === "function") ? t("ГОТОВО — можно копировать") : "ГОТОВО — можно копировать");
    } else {
      el.sbBanner.className = "banner draft";
      el.sbBanner.innerHTML = '<span class="pulse"></span>' + ((typeof t === "function") ? t("ЧЕРНОВИК — заполните обязательные поля") : "ЧЕРНОВИК — заполните обязательные поля");
    }
  };

  el.sbCopyBtn.addEventListener("click", async () => {
    if (el.sbCopyBtn.disabled) return;
    const value = el.sbResult.textContent.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      el.sbCopyBtn.textContent = (typeof t === "function") ? t("✓ Скопировано") : "✓ Скопировано";
      setTimeout(sbUpdate, 1600);
    } catch(e){}
  });

  ["sbChannel","sbCampType","sbProduct","sbPartner","sbUniqP","sbDate","sbUniqT","sbSegment","sbDay"].forEach(id => {
    ["input","change"].forEach(ev => el[id].addEventListener(ev, () => { syncVisibility(); sbUpdate(); }));
  });

  syncVisibility();
  sbUpdate();
})();
