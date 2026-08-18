package ru.banki.crm.service;

import java.util.List;
import java.util.Set;

/** Canonical section ids — must match the NAV ids in the v1 frontend. */
public final class Sections {

    private Sections() {}

    public static final String HOME = "home";
    public static final String DEVIATIONS = "deviations";
    public static final String ONELINK = "onelink";
    public static final String ADMIN = "admin";       // Мастер коммуникаций
    public static final String TEMPLATES = "templates"; // Список шаблонов
    public static final String DASHBOARD = "dashboard";
    public static final String JOURNEYS = "journeys";   // Цепочки (схема-конструктор)
    public static final String ACCESS = "access";       // Управление доступом (ADMIN only)
    public static final String PROMO = "promo";         // Планирование промо (общая таблица)
    public static final String ABTESTS = "abtests";     // А/Б тесты (общая таблица)
    public static final String SRCBUILDER = "srcbuilder"; // Конструктор source (только просмотр)
    public static final String HEATMAP = "heatmap";       // Тепловая карта (только просмотр)
    public static final String UPLOADS = "uploads";       // Загруженные инструменты (только просмотр)

    /* «Сущности» — CRM-раздел по схеме Scheme Builder. Секции у него не было вовсе:
       раздел гейтился флагом администратора и клиентским реестром доступа к сущностям
       (crmpanel:entityAccess). Из-за этого его нельзя было выдать роли, как остальные
       разделы, — он просто не показывался в матрице прав. */
    public static final String ENTITIES = "entities";

    /* Завод событий формой — две страницы, права на каждую отдельно: онлайновое событие
       заводит одна команда, расписание с SQL-выборкой — другая. */
    public static final String EV_ONLINE = "ev-online";
    public static final String EV_OFFLINE = "ev-offline";
    /* Перелив события в прод-БД — отдельная секция от заведения: собрать событие у себя
       и отправить его в боевые таблицы это разные полномочия. */
    public static final String EV_EXPORT = "ev-export";

    /* Панели настроечной админки (/settings). До этого вся страница была закрыта одним
       правилом hasRole("ADMIN"), и выдать роли, например, только «Подключения к БД» было
       нельзя в принципе. Теперь панель = секция, как и раздел панели.
       Префикс set- не косметика: по нему SecurityConfig решает, пускать ли вообще на
       /settings и /api/admin — это нижняя граница защиты, поверх которой каждый
       контроллер проверяет свою конкретную секцию. */
    public static final String SET_DBCONN = "set-dbconn";
    public static final String SET_SYNC = "set-sync";
    public static final String SET_EVENTS = "set-events";
    public static final String SET_SCHEME = "set-scheme";
    public static final String SET_OBJECTS = "set-objects";
    public static final String SET_DBTREE = "set-dbtree";
    public static final String SET_APPS = "set-apps";
    public static final String SET_UPLOADS = "set-uploads";
    public static final String SET_MON = "set-mon";
    public static final String SET_DIAG = "set-diag";

    /* Отчёты и мониторинг — не одна секция, а по секции на пункт меню (миграция V29).
       Иначе доступ выдавался всё-или-ничего: галка «Отчёты» открывала сразу все пять.
       Зонтичных секций reports/monitoring больше нет — группа сайдбара сама скрывается,
       когда скрыты все её дети (applyNavAcl). */
    public static final String REP_PLANFACT = "rep-planfact";
    public static final String REP_MATRIX = "rep-matrix";
    public static final String REP_LEADGEN = "rep-leadgen";
    public static final String REP_SMSCHECK = "rep-smscheck";
    public static final String REP_DEMO = "rep-demo";
    public static final String MON_CAMPAIGNS = "mon-campaigns";

    /* Клиентские инструменты (конструктор source, отчёты, тепловая карта, мониторинг,
       загруженные инструменты) заводим в RBAC только ради видимости в NAV: серверной
       записи у них нет, поэтому они не входят в WRITABLE — значима лишь галка read.
       Порядок совпадает с порядком в меню: матрица прав рисуется в нём же. */
    public static final List<String> ALL = List.of(
            HOME,
            ONELINK, ADMIN, TEMPLATES, SRCBUILDER, PROMO, ABTESTS, HEATMAP,
            EV_ONLINE, EV_OFFLINE, EV_EXPORT,
            ENTITIES,
            REP_PLANFACT, REP_MATRIX, REP_LEADGEN, REP_SMSCHECK, REP_DEMO,
            DASHBOARD, DEVIATIONS,
            MON_CAMPAIGNS,
            UPLOADS, JOURNEYS,
            SET_DBCONN, SET_SYNC, SET_EVENTS, SET_SCHEME, SET_OBJECTS, SET_DBTREE,
            SET_APPS, SET_UPLOADS, SET_MON, SET_DIAG, ACCESS);

    /**
     * Группа сайдбара, в которой живёт раздел. Нужна матрице прав: строк стало больше двадцати,
     * и без заголовков групп таблица читается плохо. Ключ — id секции, значение — подпись группы;
     * разделы верхнего уровня группы не имеют (пустая строка).
     */
    public static final java.util.Map<String, String> GROUP_OF = java.util.Map.ofEntries(
            java.util.Map.entry(ONELINK, "Управление коммуникациями"),
            java.util.Map.entry(ADMIN, "Управление коммуникациями"),
            java.util.Map.entry(TEMPLATES, "Управление коммуникациями"),
            java.util.Map.entry(SRCBUILDER, "Управление коммуникациями"),
            java.util.Map.entry(PROMO, "Управление коммуникациями"),
            java.util.Map.entry(ABTESTS, "Управление коммуникациями"),
            java.util.Map.entry(HEATMAP, "Управление коммуникациями"),
            java.util.Map.entry(EV_ONLINE, "События"),
            java.util.Map.entry(EV_OFFLINE, "События"),
            java.util.Map.entry(EV_EXPORT, "События"),
            java.util.Map.entry(REP_PLANFACT, "Отчёты"),
            java.util.Map.entry(REP_MATRIX, "Отчёты"),
            java.util.Map.entry(REP_LEADGEN, "Отчёты"),
            java.util.Map.entry(REP_SMSCHECK, "Отчёты"),
            java.util.Map.entry(REP_DEMO, "Отчёты"),
            java.util.Map.entry(DASHBOARD, "Дашборд"),
            java.util.Map.entry(DEVIATIONS, "Дашборд"),
            java.util.Map.entry(MON_CAMPAIGNS, "Мониторинг"),
            java.util.Map.entry(SET_DBCONN, "Настройки"),
            java.util.Map.entry(SET_SYNC, "Настройки"),
            java.util.Map.entry(SET_EVENTS, "Настройки"),
            java.util.Map.entry(SET_SCHEME, "Настройки"),
            java.util.Map.entry(SET_OBJECTS, "Настройки"),
            java.util.Map.entry(SET_DBTREE, "Настройки"),
            java.util.Map.entry(SET_APPS, "Настройки"),
            java.util.Map.entry(SET_UPLOADS, "Настройки"),
            java.util.Map.entry(SET_MON, "Настройки"),
            java.util.Map.entry(SET_DIAG, "Настройки"),
            java.util.Map.entry(ACCESS, "Настройки"));

    public static String groupOf(String id) {
        return GROUP_OF.getOrDefault(id, "");
    }

    public static final Set<String> VALID = Set.copyOf(ALL);

    /**
     * Разделы, где у не-админа осмысленны add/edit/delete (есть записи и серверные ручки
     * записи). Для остальных из ALL значима только видимость (read): дашборд/отклонения —
     * витрины; цепочки, доступ — только для админов (матрицу они обходят). В матрице прав
     * у не-writable разделов показываем лишь чекбокс Read.
     */
    public static final Set<String> WRITABLE = Set.of(ADMIN, TEMPLATES, PROMO, ABTESTS,
            EV_ONLINE, EV_OFFLINE, EV_EXPORT, JOURNEYS, ACCESS,
            SET_DBCONN, SET_SYNC, SET_EVENTS, SET_SCHEME, SET_OBJECTS, SET_APPS, SET_UPLOADS);

    /**
     * Разделы, которые нельзя выдать матрицей — только флагом администратора.
     * <p>
     * Набор ПУСТ намеренно. Раньше сюда входили «Цепочки» и «Управление доступом»: их
     * закрывал hasRole("ADMIN"), и галка в матрице ничего бы не значила. Теперь оба
     * гейтятся секцией, как всё остальное, и в матрице появляются честно.
     * <p>
     * Осторожно с ACCESS: выдав его роли, вы разрешаете ей менять права — в том числе
     * свои. Признак администратора при этом по-прежнему ставит только супер-админ, так
     * что «повысить себя до админа» через матрицу нельзя.
     */
    public static final Set<String> ADMIN_ONLY = Set.of();

    /** Секции настроечной админки. По ним SecurityConfig решает, пускать ли на /settings. */
    public static final Set<String> SETTINGS = Set.of(
            SET_DBCONN, SET_SYNC, SET_EVENTS, SET_SCHEME, SET_OBJECTS, SET_DBTREE,
            SET_APPS, SET_UPLOADS, SET_MON, SET_DIAG, ACCESS);

    public static boolean isSettings(String id) {
        return SETTINGS.contains(id);
    }

    public static boolean isValid(String id) {
        return VALID.contains(id);
    }

    public static boolean isWritable(String id) {
        return WRITABLE.contains(id);
    }

    public static boolean isAdminOnly(String id) {
        return ADMIN_ONLY.contains(id);
    }
}
