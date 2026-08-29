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
    /* «Просмотр настроек» — тот же экран, что и «Мастер коммуникаций», но в режиме
       чтения. Секции у него не было: пункт меню повторял права admin (aclSection).
       Из-за этого нельзя было дать человеку смотреть настройки коммуникаций, не пуская
       его в мастер, — а это ровно тот случай, ради которого режим просмотра и делали. */
    public static final String VIEWER = "viewer";
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

    /* Отдельная сущность — тоже страница панели, и выдаваться она должна там же, где
       остальные: в матрице прав. Раньше это делал клиентский реестр crmpanel:entityAccess
       — объект в localStorage браузера, который правился из консоли и до сервера не
       доходил вовсе. Поэтому секции сущностей ДИНАМИЧЕСКИЕ: их список не константа, а
       текущая схема (app.schema_model), и в ALL их нет — они приезжают в матрицу
       отдельным блоком из /api/admin/sections.
       ENTITIES при этом остаётся зонтиком «все сущности»: снимать его у ролей, которым
       он уже выдан, миграцией нельзя — люди потеряли бы раздел. Точечная выдача просто
       добавляет к нему сущности, а сузить доступ = снять зонтик и отметить нужные. */
    public static final String ENTITY_PREFIX = "ent:";

    /** Секция отдельной сущности: ent:client. */
    public static String entity(String entityId) {
        return ENTITY_PREFIX + entityId;
    }

    public static boolean isEntity(String id) {
        return id != null && id.startsWith(ENTITY_PREFIX) && id.length() > ENTITY_PREFIX.length();
    }

    /* Завод событий формой — две страницы, права на каждую отдельно: онлайновое событие
       заводит одна команда, расписание с SQL-выборкой — другая. */
    public static final String EV_ONLINE = "ev-online";
    public static final String EV_OFFLINE = "ev-offline";
    /* Перелив события в прод-БД — отдельная секция от заведения: собрать событие у себя
       и отправить его в боевые таблицы это разные полномочия. */
    public static final String EV_EXPORT = "ev-export";
    /* Подключение к планировщику Quartz. Секция живёт в «Событиях», а не в настройках:
       по устройству это интеграция, но нужна она тому, кто заводит события по
       расписанию, и искать её среди Jira и подключений к БД никто не стал. Право
       отдельное от ev-offline: заводить события и задавать адрес планировщика, на
       который уедут боевые задания, — разные полномочия. */
    public static final String EV_CRON = "ev-cron";
    /* Список событий — витрина. Смотреть каталог и отправлять события в боевую базу это
       разные полномочия, поэтому секция своя и НЕ входит в WRITABLE: правок тут нет. */
    public static final String EV_LIST = "ev-list";

    /* Панели настроечной админки (/settings). До этого вся страница была закрыта одним
       правилом hasRole("ADMIN"), и выдать роли, например, только «Подключения к БД» было
       нельзя в принципе. Теперь панель = секция, как и раздел панели.
       Префикс set- не косметика: по нему SecurityConfig решает, пускать ли вообще на
       /settings и /api/admin — это нижняя граница защиты, поверх которой каждый
       контроллер проверяет свою конкретную секцию. */
    public static final String SET_DBCONN = "set-dbconn";
    public static final String SET_SYNC = "set-sync";
    /* Управление процессами перелива: остановить и пустить снова. Секция своя, потому
       что это другое полномочие — не «настроить синхронизацию», а «перекрыть поток
       в прод». Смотреть состояние даёт read, нажимать кнопки — edit. */
    public static final String SET_PROCS = "set-procs";
    /* Интеграция с Jira: адрес, токен сервисной учётки, проект и карта полей. Секция
       своя, потому что в токене права на весь проект, а подмена адреса уводит задачи
       в чужую систему: смотреть настройку — одно полномочие, менять — другое. */
    public static final String SET_JIRA = "set-jira";
    public static final String SET_EVENTS = "set-events";
    public static final String SET_SCHEME = "set-scheme";
    public static final String SET_OBJECTS = "set-objects";
    public static final String SET_DBTREE = "set-dbtree";
    /* Ведение справочников значений (имена коммуникаций, точки касания). Секция своя,
       а не set-objects: там правят СТРУКТУРУ карточек, здесь — значения, которые видят
       в выпадашках все. И не admin: пополнить список из формы мастера кнопкой «+» и
       вести сам справочник — разные полномочия. */
    public static final String SET_REFS = "set-refs";
    public static final String SET_APPS = "set-apps";
    public static final String SET_UPLOADS = "set-uploads";
    public static final String SET_MON = "set-mon";
    public static final String SET_DIAG = "set-diag";
    public static final String SET_GENERAL = "set-general";

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
            ONELINK, ADMIN, VIEWER, TEMPLATES, SRCBUILDER, PROMO, ABTESTS, HEATMAP,
            EV_ONLINE, EV_OFFLINE, EV_LIST,
            ENTITIES,
            REP_PLANFACT, REP_MATRIX, REP_LEADGEN, REP_SMSCHECK, REP_DEMO,
            DASHBOARD, DEVIATIONS,
            MON_CAMPAIGNS,
            UPLOADS, JOURNEYS,
            SET_DBCONN, SET_JIRA, SET_PROCS, SET_SYNC, SET_EVENTS, EV_EXPORT, SET_SCHEME,
            SET_OBJECTS, SET_DBTREE, SET_REFS, SET_APPS, SET_UPLOADS, SET_MON,
            SET_DIAG, SET_GENERAL, ACCESS, EV_CRON);

    /**
     * Группа сайдбара, в которой живёт раздел. Нужна матрице прав: строк стало больше двадцати,
     * и без заголовков групп таблица читается плохо. Ключ — id секции, значение — подпись группы;
     * разделы верхнего уровня группы не имеют (пустая строка).
     */
    public static final java.util.Map<String, String> GROUP_OF = java.util.Map.ofEntries(
            java.util.Map.entry(ONELINK, "Управление коммуникациями"),
            java.util.Map.entry(ADMIN, "Управление коммуникациями"),
            java.util.Map.entry(VIEWER, "Управление коммуникациями"),
            java.util.Map.entry(TEMPLATES, "Управление коммуникациями"),
            java.util.Map.entry(SRCBUILDER, "Управление коммуникациями"),
            java.util.Map.entry(PROMO, "Управление коммуникациями"),
            java.util.Map.entry(ABTESTS, "Управление коммуникациями"),
            java.util.Map.entry(HEATMAP, "Управление коммуникациями"),
            java.util.Map.entry(EV_ONLINE, "События"),
            java.util.Map.entry(EV_OFFLINE, "События"),
            java.util.Map.entry(EV_LIST, "События"),
            /* Перелив уехал из панели в настройки: это не работа с событием, а процесс
               доставки его в боевую базу — соседи ему синхронизация шаблонов и импорт из
               crmdb, а не форма завода. Идентификатор секции остался прежним (ev-export),
               поэтому выданные права никуда не делись. */
            java.util.Map.entry(EV_EXPORT, "Настройки"),
            java.util.Map.entry(REP_PLANFACT, "Отчёты"),
            java.util.Map.entry(REP_MATRIX, "Отчёты"),
            java.util.Map.entry(REP_LEADGEN, "Отчёты"),
            java.util.Map.entry(REP_SMSCHECK, "Отчёты"),
            java.util.Map.entry(REP_DEMO, "Отчёты"),
            java.util.Map.entry(DASHBOARD, "Дашборд"),
            java.util.Map.entry(DEVIATIONS, "Дашборд"),
            java.util.Map.entry(MON_CAMPAIGNS, "Мониторинг"),
            java.util.Map.entry(SET_DBCONN, "Настройки"),
            java.util.Map.entry(SET_PROCS, "Настройки"),
            java.util.Map.entry(SET_JIRA, "Настройки"),
            java.util.Map.entry(SET_SYNC, "Настройки"),
            java.util.Map.entry(SET_EVENTS, "Настройки"),
            java.util.Map.entry(SET_SCHEME, "Настройки"),
            java.util.Map.entry(SET_OBJECTS, "Настройки"),
            java.util.Map.entry(SET_DBTREE, "Настройки"),
            java.util.Map.entry(SET_REFS, "Настройки"),
            java.util.Map.entry(EV_CRON, "События"),
            java.util.Map.entry(SET_APPS, "Настройки"),
            java.util.Map.entry(SET_UPLOADS, "Настройки"),
            java.util.Map.entry(SET_MON, "Настройки"),
            java.util.Map.entry(SET_DIAG, "Настройки"),
            java.util.Map.entry(SET_GENERAL, "Настройки"),
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
            SET_DBCONN, SET_JIRA, SET_PROCS, SET_SYNC, SET_EVENTS, SET_SCHEME, SET_OBJECTS,
            SET_APPS, SET_UPLOADS, SET_REFS, EV_CRON);

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
            SET_DBCONN, SET_JIRA, SET_PROCS, SET_SYNC, SET_EVENTS, EV_EXPORT, SET_SCHEME,
            SET_OBJECTS, SET_DBTREE, SET_REFS, SET_APPS, SET_UPLOADS, SET_MON,
            SET_DIAG, SET_GENERAL, ACCESS);

    public static boolean isSettings(String id) {
        return SETTINGS.contains(id);
    }

    /** Секции сущностей в VALID не лежат — их список задаёт схема, а не этот класс. */
    public static boolean isValid(String id) {
        return VALID.contains(id) || isEntity(id);
    }

    public static boolean isWritable(String id) {
        return WRITABLE.contains(id);
    }

    public static boolean isAdminOnly(String id) {
        return ADMIN_ONLY.contains(id);
    }
}
