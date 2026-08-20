package ru.banki.crm.web;

import org.springframework.web.bind.annotation.*;
import ru.banki.crm.domain.Capability;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.Sections;
import ru.banki.crm.service.jira.JiraService;

import java.util.Map;

/**
 * Настройка интеграции с Jira: адрес, токен сервисной учётки, проект и карта полей.
 * <p>
 * Смотреть настройки может тот, кому выдан раздел; менять их и дёргать Jira — тот, у кого
 * есть право на редактирование. Разделение не косметическое: в токене сервисной учётки
 * права на весь проект, и подменить адрес Jira — это увести задачи в чужую систему.
 */
@RestController
@RequestMapping("/api/admin/jira")
public class JiraController {

    private final JiraService jira;
    private final AccessGuard access;

    public JiraController(JiraService jira, AccessGuard access) {
        this.jira = jira;
        this.access = access;
    }

    @GetMapping("/config")
    public Map<String, Object> config() {
        access.requireAnySection(Sections.SET_JIRA);
        return jira.config();
    }

    @PutMapping("/config")
    public Map<String, Object> save(@RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.EDIT, Sections.SET_JIRA);
        return jira.save(body);
    }

    /** Проверка связи: кто мы для Jira. Ничего не создаёт и не меняет. */
    @PostMapping("/check")
    public Map<String, Object> check() {
        access.requireCapability(Capability.EDIT, Sections.SET_JIRA);
        return jira.check();
    }

    /** Поля экрана создания задачи: что обязательно и какие значения допустимы. */
    @GetMapping("/meta")
    public Map<String, Object> meta() {
        access.requireCapability(Capability.EDIT, Sections.SET_JIRA);
        return jira.meta();
    }

    /** Сопоставить наши поля с полями Jira по названию и сохранить карту. */
    @PostMapping("/automap")
    public Map<String, Object> autoMap() {
        access.requireCapability(Capability.EDIT, Sections.SET_JIRA);
        return jira.autoMap();
    }

    /** Ручная правка карты полей и значений. */
    @PutMapping("/maps")
    public Map<String, Object> saveMaps(@RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.EDIT, Sections.SET_JIRA);
        return jira.saveMaps(body);
    }
}
