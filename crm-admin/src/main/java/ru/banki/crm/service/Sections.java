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

    /* Здесь только разделы с серверными данными. Клиентские инструменты
       (конструктор source, тепловая карта, отчёты, мониторинг, загруженные
       инструменты) в RBAC не заводим: защищать на сервере нечего — в NAV они
       помечены noAcl. */
    public static final List<String> ALL = List.of(
            HOME, DEVIATIONS, ONELINK, ADMIN, TEMPLATES, DASHBOARD, JOURNEYS, ACCESS, PROMO);

    public static final Set<String> VALID = Set.copyOf(ALL);

    public static boolean isValid(String id) {
        return VALID.contains(id);
    }
}
