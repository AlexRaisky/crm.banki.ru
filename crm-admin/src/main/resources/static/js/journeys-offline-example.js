/* ============================================================
   ПРИМЕР ОФФЛАЙН-ПРОЦЕССА — воронка МФО (mfo_sms_funnel).

   Настоящий процесс из прода, разложенный по шагам. Здесь только данные: как их
   раскладывать на холсте, знает journeys.js (jrExampleOffline).

   Что важно про этот пример.

   Шаги связаны НЕ порядковыми номерами, а тем, кто чью таблицу читает. По номерам
   двадцатый идёт после четырнадцатого, хотя ни от чего не зависит и может считаться
   параллельно; тридцатый питает сразу двоих — сороковой и шестьдесят второй, — и
   трогать его опаснее прочих. Ровно это и рисуется стрелками, поэтому у каждого шага
   указано, из каких он вырастает (from).

   В sql лежит тело шага без обвязки: drop table / create table / distributed by /
   GRANT одинаковы у всех шестнадцати и в схеме ничего не объясняют. Шаг 70 в исходном
   скрипте — вообще только GRANT, поэтому блоком он не стал: прав данные не меняют,
   а стрелка от него означала бы, что аудитория проходит через него насквозь.

   Внешние таблицы показаны там, где процесс из них начинается. Справочники, которые
   шаг дотягивает по ходу (t_application_client_data у 11-го, стоп-листы у 64-го),
   названы в тексте самого шага: рисовать их блоками значило бы вместо схемы процесса
   получить список всех таблиц хранилища.
   ============================================================ */
(function () {
  "use strict";

  function sql() {
    return Array.prototype.slice.call(arguments).join("\n");
  }

  window.JR_OFFLINE_EXAMPLE = {
    name: "Пример: оффлайн — воронка МФО (mfo_sms_funnel)",
    /* Паспорт процесса. Отдельной карточкой, а не блоком в потоке: расписание не
       даёт данных, а стрелка на схеме означает именно поток данных. */
    note: {
      title: "Процесс mfo_sms_funnel · Greenplum",
      text: "Ежедневная воронка МФО: 16 шагов, окно 45 дней, 105 шаблонов.\n"
          + "Что и когда уходит — в зелёных блоках справа: они и есть матрица шага 60,"
          + " развёрнутая по событиям.\n"
          + "У каждого шага в скрипте своя обвязка drop / create / distributed by / GRANT —"
          + " она одинакова и здесь опущена.\n"
          + "Шаг 70 (только GRANT) блоком не стал: прав данные не меняют.\n"
          + "Больше трети исходного скрипта — закомментированные sandbox-двойники шагов"
          + " 10, 20, 30, 40 и 50. Это история правок в теле процесса; такому место —"
          + " выключенный шаг, а не комментарий."
    },
    steps: [
      /* ---------- входы: откуда процесс берёт сырые события ---------- */
      { id: "x10", type: "extTable", from: [],
        table: "cidb.t_queue_offer_list_stat\ncidb.t_application_info",
        note: "Показы витрины предложений и анкеты — исходные события" },
      { id: "x12", type: "extTable", from: [],
        table: "cidb.t_application_info\ncidb.t_application_client_data",
        note: "Анкеты и их привязка к mybid" },
      { id: "x13", type: "extTable", from: [],
        table: "core.get_product_offer_list_log",
        note: "Лог запросов витрины: mybId в ответе" },
      { id: "x20", type: "extTable", from: [],
        table: "mybanki.t_mybanki_tracker_event_offline",
        note: "Трекер: просмотры раздела МФО" },
      { id: "x30", type: "extTable", from: [],
        table: "core_test.itog\ngp.core.selection_t_partner_prescoring_result\nmybanki.t_mybanki_tracker_event_online",
        note: "Клики, прескоринг и отправки в КЦ" },

      /* ---------- шаги ---------- */
      { id: "s10", type: "sqlStep", from: ["x10"], order: 10,
        table: "core.mfo_sms_funnel_001_1", dist: "acdb_id",
        note: "Брошенный сплэш: максимум даты по анкете за 45 дней",
        sql: sql(
          "select tqols.acdb_id, max(tqols.timestamp_cr) as max_splash_dt",
          "from cidb.t_queue_offer_list_stat tqols",
          "left join cidb.t_application_info tai on tqols.acdb_id = tai.acdb_id",
          "where tqols.timestamp_cr >= current_date - 45",
          "  and (tai.purpose_code in (12)",
          "       or (tai.purpose_code in (1) and tai.requested_amount < 70001))",
          "  and tai.activity_code not in (14, 17)",
          "group by 1") },

      { id: "s11", type: "sqlStep", from: ["s10"], order: 11,
        table: "core.mfo_sms_funnel_001", dist: "mybid",
        note: "Тот же сплэш, но в разрезе mybid (через t_application_client_data)",
        sql: sql(
          "select tacd.mybid, max(t.max_splash_dt) as max_splash_dt",
          "from core.mfo_sms_funnel_001_1 t",
          "left join cidb.t_application_client_data tacd on t.acdb_id = tacd.acdb_id",
          "where mybid is not null",
          "group by 1") },

      { id: "s12", type: "sqlStep", from: ["x12"], order: 12,
        table: "core.mfo_sms_funnel_002", dist: "mybid",
        note: "Брошенная анкета: максимум даты по mybid за 45 дней",
        sql: sql(
          "select tacd.mybid, max(tai.timestamp_cr) as max_applic_dt",
          "from cidb.t_application_info tai",
          "left join cidb.t_application_client_data tacd on tai.acdb_id = tacd.acdb_id",
          "where tai.timestamp_cr >= current_date - 45",
          "  and mybid is not null",
          "  and (tai.purpose_code in (12)",
          "       or (tai.purpose_code in (1) and tai.requested_amount < 70001))",
          "  and tai.status not in (129, 130)",
          "  and tai.activity_code not in (14, 17)",
          "group by 1") },

      { id: "s13", type: "sqlStep", from: ["x13"], order: 13,
        table: "core.mfo_sms_funnel_003", dist: "myb",
        note: "Показ витрины из лога: mybId и дата последнего запроса",
        sql: sql(
          "select response->>'mybId' as myb, max(timestamp_request) as max_splash_dt_new",
          "from core.get_product_offer_list_log",
          "where timestamp_request >= current_date - 45",
          "  and (request->'userData'->>'userId') is not null",
          "  and (request->'params'->>'purposeCode') = '12'",
          "group by 1") },

      { id: "s14", type: "sqlStep", from: ["s11", "s12", "s13"], order: 14,
        table: "core.mfo_sms_funnel_004", dist: "mybid",
        note: "Свести сплэши, анкеты и показы витрины в одну строку на mybid",
        sql: sql(
          "with t3 as (",
          "  select coalesce(t.mybid, t2.mybid, t0.myb) as mybid,",
          "         greatest(t.max_splash_dt, t0.max_splash_dt_new) as max_splash_dt,",
          "         t2.max_applic_dt",
          "  from core.mfo_sms_funnel_001 t",
          "  full join core.mfo_sms_funnel_002 t2 on t.mybid = t2.mybid",
          "  full join core.mfo_sms_funnel_003 t0 on t.mybid = t0.myb",
          ")",
          "select mybid, max(max_applic_dt) as max_applic_dt,",
          "       max(max_splash_dt) as max_splash_dt",
          "from t3 group by mybid") },

      { id: "s20", type: "sqlStep", from: ["x20"], order: 20,
        table: "core.mfo_sms_funnel_2", dist: "mybanki_id",
        note: "Максимум даты просмотра раздела МФО. От остальных шагов не зависит —"
            + " считается параллельно, номер 20 об этом не говорит",
        sql: sql(
          "select mybanki_id, max(event_dt) as max_view_dt",
          "from mybanki.t_mybanki_tracker_event_offline",
          "where event_dt >= current_date - 45",
          "  and event_type = 'mfo'",
          "group by 1") },

      { id: "s30", type: "sqlStep", from: ["x30"], order: 30,
        table: "core.mfo_sms_funnel_3", dist: "mybanki_id",
        note: "Клик, одобрение, выдача, отказ — максимум по каждому. Питает сразу два"
            + " шага (40 и 62): трогать опаснее прочих",
        sql: sql(
          "select mybanki_id, max(max_click) max_click, max(max_approve) max_approve,",
          "       max(max_issue) max_issue, max(max_reject) max_reject, max(acdb_id) acdb_id",
          "from (",
          "  select mybanki_id, max(coalesce(offer_dt, deep_dt)) max_click,",
          "         max(approved_dt) max_approve, max(issued_dt) max_issue,",
          "         max(rejected_dt) max_reject, max(aff_unique4) acdb_id",
          "  from core_test.itog",
          "  where offer_category in (8) and click_dt >= current_date - 45",
          "    and mybanki_id is not null",
          "  group by 1",
          "  union",
          "  select tm.mybanki_id, max(t.timestamp_cr::date), max(t.timestamp_cr),",
          "         max(t.timestamp_cr::date), max(t.timestamp_cr::date), max(t.acdb_id)::text",
          "  from gp.core.selection_t_partner_prescoring_result t",
          "  left join core.wnd_crm_client_info_uid tm on t.user_id = tm.user_id",
          "  where t.timestamp_cr >= current_date - 45",
          "    and product_type_code = 5 and status in (13, 10)",
          "  group by 1",
          "  union",
          "  select mybanki_id, max(event_dt::date), max(event_dt), max(event_dt::date),",
          "         max(event_dt::date), max(application_id)::text",
          "  from mybanki.t_mybanki_tracker_event_online",
          "  where event_dt >= current_date - 45",
          "    and event_name ilike '%sendMFoToCC%'",
          "  group by 1",
          ") t",
          "where not exists (select 1 from core.wnd_crm_market_exc wcme",
          "                  where wcme.myb_id = mybanki_id",
          "                    and product_type in ('deposit', 'credit'))",
          "group by 1") },

      { id: "s40", type: "sqlStep", from: ["s14", "s30", "s20"], order: 40,
        table: "core.mfo_sms_funnel_4_1", dist: "myb_id",
        note: "Полное объединение анкет, кликов и просмотров — все даты рядом",
        sql: sql(
          "with t as (",
          "  select coalesce(t1.mybid, t2.mybanki_id) as myb_id,",
          "         t1.max_applic_dt, t1.max_splash_dt,",
          "         t2.max_click, t2.max_approve, t2.max_issue, t2.max_reject",
          "  from core.mfo_sms_funnel_004 t1",
          "  full join core.mfo_sms_funnel_3 t2 on t1.mybid = t2.mybanki_id",
          ")",
          "select coalesce(t.myb_id, t1_1.mybanki_id) as myb_id, t1_1.max_view_dt,",
          "       t.max_applic_dt, t.max_splash_dt, t.max_click,",
          "       t.max_approve, t.max_issue, t.max_reject",
          "from t",
          "full join core.mfo_sms_funnel_2 t1_1 on t.myb_id = t1_1.mybanki_id") },

      { id: "s50", type: "sqlStep", from: ["s40"], order: 50,
        table: "core.mfo_sms_funnel_4", dist: "myb_id",
        note: "Последнее действие: самая поздняя из дат и её имя (event_check)",
        sql: sql(
          "select t4.myb_id, max_view_dt, max_applic_dt, max_splash_dt,",
          "       max_click, max_approve, max_issue, max_reject,",
          "       case greatest(max_view_dt, max_applic_dt, max_splash_dt,",
          "                     max_click, max_approve, max_issue, max_reject)",
          "         when max_view_dt   then 'view'",
          "         when max_applic_dt then 'aband_applic'",
          "         when max_splash_dt then 'splash'",
          "         when max_click     then 'click'",
          "         when max_approve   then 'approve'",
          "         when max_issue     then 'issue'",
          "         when max_reject    then 'reject'",
          "       end as event_check",
          "from core.mfo_sms_funnel_4_1 t4") },

      { id: "s60", type: "sqlStep", from: ["s50"], order: 60,
        table: "core.mfo_sms_funnel_01_5", dist: "—",
        note: "Матрица шаблонов: событие × «дней назад» → templateId."
            + " 7 событий, до 30 дней — около 90 клеток одним CASE на 120 строк."
            + " Правят в процессе чаще всего именно её",
        sql: sql(
          "-- Один срез матрицы; остальные шесть событий устроены так же.",
          "case",
          "  when event_check = 'view' then case",
          "    when max_view_dt::date = current_date - 1  then 643",
          "    when max_view_dt::date = current_date - 2  then 722",
          "    when max_view_dt::date = current_date - 3  then 299",
          "    when max_view_dt::date = current_date - 4  then 723",
          "    when max_view_dt::date = current_date - 5  then 724",
          "    when max_view_dt::date = current_date - 12 then 1014",
          "    when max_view_dt::date = current_date - 13 then 1015",
          "    when max_view_dt::date = current_date - 14 then 1016",
          "    when max_view_dt::date = current_date - 26 then 5246",
          "    when max_view_dt::date = current_date - 27 then 5247",
          "    when max_view_dt::date = current_date - 28 then 5248",
          "  end",
          "  -- aband_applic, splash, click, approve, issue, reject — так же",
          "end as \"templateId\",",
          "*",
          "from core.mfo_sms_funnel_4 t4") },

      { id: "s61", type: "sqlStep", from: ["s60"], order: 61,
        table: "core.mfo_sms_funnel_02_5", dist: "—",
        note: "Анкеты отобранных mybid — из cidb.t_application_client_data",
        sql: sql(
          "select * from cidb.t_application_client_data tacd",
          "where tacd.mybid in (select myb_id from core.mfo_sms_funnel_01_5)",
          "  and tacd.mybid is not null",
          "  and tacd.purpose in (12, 1)") },

      { id: "s62", type: "sqlStep", from: ["s60", "s61", "s30"], order: 62,
        table: "core.mfo_sms_funnel_03_5", dist: "—",
        note: "Подставить acdb_id к каждому шаблону; строки без шаблона отбрасываются",
        sql: sql(
          "select t.*, coalesce(tacd.acdb_id, tt.acdb_id::bigint) as acdb_id",
          "from core.mfo_sms_funnel_01_5 t",
          "left join core.mfo_sms_funnel_02_5 tacd on t.myb_id = tacd.mybid",
          "left join core.mfo_sms_funnel_3 tt on tt.mybanki_id = t.myb_id",
          "where \"templateId\" is not null") },

      { id: "s63", type: "sqlStep", from: ["s62"], order: 63,
        table: "core.mfo_sms_funnel_04_5", dist: "—",
        note: "Отсечь анкеты с activity_code 14 и 17 — из cidb.t_application_info",
        sql: sql(
          "select * from cidb.t_application_info tai",
          "where acdb_id in (select acdb_id from core.mfo_sms_funnel_03_5)",
          "  and coalesce(tai.activity_code, 2) not in (14, 17)") },

      { id: "s64", type: "sqlStep", from: ["s62", "s63"], order: 64,
        table: "core.mfo_sms_funnel_5", dist: "—",
        note: "Одна анкета на mybid и минус стоп-лист рынка (wnd_crm_market_exc)",
        sql: sql(
          "with t3 as (",
          "  select t2.myb_id,",
          "         max(t2.acdb_id) filter (where t2.acdb_id is not null) as application",
          "  from core.mfo_sms_funnel_03_5 t2",
          "  left join core.mfo_sms_funnel_04_5 tai on t2.acdb_id = tai.acdb_id",
          "  group by 1",
          "), t4 as (",
          "  select t3.myb_id, t3.application, \"templateId\"",
          "  from t3",
          "  left join core.mfo_sms_funnel_03_5 t2",
          "    on t3.myb_id = t2.myb_id and t3.application = t2.acdb_id",
          ")",
          "select \"templateId\", t4.myb_id, application",
          "from t4",
          "where t4.myb_id not in (select distinct myb_id from core.wnd_crm_market_exc",
          "                        where myb_id is not null",
          "                          and product_type in ('deposit', 'credit'))") },

      { id: "s80", type: "sqlStep", from: ["s64"], order: 80, returns: true,
        table: "— выборка —", dist: "—",
        note: "Аудитория одного шаблона: myb_id и анкета, минус пролонгации страховок."
            + " Единственный шаг, который возвращает строки, а не создаёт таблицу",
        sql: sql(
          "select myb_id, application from core.mfo_sms_funnel_5 t",
          "where \"templateId\" = 722",
          "  and myb_id not ilike '3752cf15-b75f-4588-87a7-ac357e244ba3'",
          "  and not exists (select 1 from core.wnd_crm_insurance_prolong_to_exclude t1",
          "                  where t1.myb_id = t.myb_id and t1.myb_id is not null)") }
    ],

    /* Что и когда уходит. Это развёрнутая матрица из шага 60: там она лежит одним
       CASE на 120 строк, и по нему не прочитать ни сколько всего шаблонов, ни на
       какой день молчим. Здесь — по блоку на событие, день → шаблон.

       Канал sms: так называется сам процесс, и в закомментированной проверке
       шестидесятого шага стоит очередь retention.t_notice_com_sms_queue.

       Дни — «сколько прошло с последнего действия человека» (current_date - N), а не
       день цепочки от старта: у оффлайна нет момента входа, воронка каждый день
       пересчитывается заново и смотрит, когда человек был активен в последний раз. */
    comms: [
      { event: "view", note: "Смотрел раздел МФО и не пошёл дальше",
        days: [[1, 643], [2, 722], [3, 299], [4, 723], [5, 724],
               [12, 1014], [13, 1015], [14, 1016],
               [26, 5246], [27, 5247], [28, 5248]] },
      { event: "aband_applic", note: "Бросил анкету",
        days: [[1, 172], [2, 735], [3, 173], [4, 736], [5, 174],
               [12, 1017], [13, 1018], [14, 1019],
               [26, 5249], [27, 5250], [28, 5251]] },
      { event: "splash", note: "Бросил витрину предложений",
        days: [[1, 495], [2, 496], [3, 166], [4, 725], [5, 167], [6, 1010], [7, 163],
               [12, 1020], [13, 1021], [14, 1022], [15, 164], [21, 165],
               [26, 5252], [27, 5253], [28, 5254]] },
      { event: "click", note: "Кликнул в предложение партнёра",
        days: [[1, 302], [2, 499], [3, 644], [4, 733], [5, 303], [6, 1011],
               [12, 1023], [13, 1024], [14, 1025], [15, 304], [21, 347],
               [26, 5255], [27, 5256], [28, 5257]] },
      { event: "approve", note: "Заявку одобрили",
        days: [[1, 336], [2, 649], [3, 650], [4, 730], [5, 337], [6, 731], [7, 1128],
               [12, 1026], [13, 1027], [14, 1028], [15, 338],
               [26, 5258], [27, 5259], [28, 5260], [30, 339]] },
      { event: "issue", note: "Заём выдан — самая длинная ветка, 26 шаблонов",
        days: [[1, 651], [2, 652], [3, 653], [4, 727], [5, 1085], [6, 728], [7, 729],
               [8, 1029], [9, 1030], [10, 1086], [11, 1087], [12, 1031], [13, 1032],
               [14, 1033], [16, 1088], [17, 5283], [18, 5284], [19, 5285], [20, 320],
               [21, 1129], [22, 1130], [25, 1089], [26, 5261], [27, 5262], [28, 5263],
               [30, 1131]] },
      { event: "reject", note: "Заявку отклонили",
        days: [[1, 1063], [2, 1075], [3, 1076], [4, 1077], [5, 1078], [6, 1124], [7, 1125],
               [12, 1079], [13, 1080], [14, 1081],
               [26, 2213], [27, 1126], [28, 1127]] }
    ]
  };
})();
