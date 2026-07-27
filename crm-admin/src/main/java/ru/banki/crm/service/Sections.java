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
    public static final String SRCBUILDER = "srcbuilder"; // Конструктор source (только просмотр)
    public static final String REPORTS = "reports";       // Отчёты (только просмотр)
    public static final String HEATMAP = "heatmap";       // Тепловая карта (только просмотр)
    public static final String MONITORING = "monitoring"; // Мониторинг (только просмотр)
    public static final String UPLOADS = "uploads";       // Загруженные инструменты (только просмотр)

    /* Клиентские инструменты (конструктор source, отчёты, тепловая карта, мониторинг,
       загруженные инструменты) заводим в RBAC только ради видимости в NAV: серверной
       записи у них нет, поэтому они не входят в WRITABLE — значима лишь галка read. */
    public static final List<String> ALL = List.of(
            HOME, DEVIATIONS, ONELINK, ADMIN, TEMPLATES, DASHBOARD, JOURNEYS, ACCESS, PROMO,
            SRCBUILDER, REPORTS, HEATMAP, MONITORING, UPLOADS);

    public static final Set<String> VALID = Set.copyOf(ALL);

    /**
     * Разделы, где у не-админа осмысленны add/edit/delete (есть записи и серверные ручки
     * записи). Для остальных из ALL значима только видимость (read): дашборд/отклонения —
     * витрины; цепочки, доступ — только для админов (матрицу они обходят). В матрице прав
     * у не-writable разделов показываем лишь чекбокс Read.
     */
    public static final Set<String> WRITABLE = Set.of(ADMIN, TEMPLATES, PROMO);

    /**
     * Разделы только для админов: доступ к ним даёт роль администратора, а не матрица
     * (JourneyController — hasRole ADMIN, «Доступ» — под /api/admin/** hasRole ADMIN).
     * В матрице прав для не-админа их не показываем: галка там ничего бы не значила.
     */
    public static final Set<String> ADMIN_ONLY = Set.of(JOURNEYS, ACCESS);

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
