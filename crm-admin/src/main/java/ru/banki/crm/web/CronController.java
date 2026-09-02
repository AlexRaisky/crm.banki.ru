package ru.banki.crm.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import org.springframework.security.access.prepost.PreAuthorize;

import ru.banki.crm.domain.Capability;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.Sections;
import ru.banki.crm.service.cron.CronService;

import java.util.Map;

/**
 * Подключение к планировщику crm-cron.
 * <p>
 * Ручек три и все безобидные: прочитать настройки, сохранить их, проверить связь.
 * Действий над заданиями Quartz здесь пока нет намеренно — сначала убеждаемся, что
 * панель дотягивается до сервиса и чем аутентифицируется.
 */
@RestController
@RequestMapping("/api/cron")
public class CronController {

    private final CronService service;
    private final AccessGuard access;

    public CronController(CronService service, AccessGuard access) {
        this.service = service;
        this.access = access;
    }

    /* Настройки подключения — только администратор, выдаваемого права под них нет.
       Адрес планировщика один на панель и решает, на какой контур уедут боевые задания
       Quartz; такое не выдают галкой в матрице. Действует настройка при этом на всех:
       задания по кнопкам в карточке события заводит любой, у кого есть право на события
       по расписанию. */
    @GetMapping("/settings")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> settings() {
        return service.settings();
    }

    @PutMapping("/settings")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> save(@RequestBody Map<String, Object> body) {
        return service.save(body);
    }

    /**
     * Проверка связи. POST, а не GET: она ходит наружу и записывает результат в
     * app.cron_connection — то есть меняет состояние, и повторять её обновлением
     * страницы или предзагрузкой ссылки было бы неправильно.
     */
    @PostMapping("/check")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> check() {
        return service.check();
    }

    // ---------------------------------------------------------------- задания события
    /* Право — на раздел события по расписанию, а не на настройки планировщика: адрес
       сервиса задаёт администратор один раз, а заданиями управляют те, кто ведёт
       рассылки. Читать состояние (GET) разрешено с правом READ, менять — с EDIT.

       Все четыре действия — POST, включая stop и start, у которых в чужом API стоит GET.
       Их GET меняет состояние; повторять такое обновлением страницы или предзагрузкой
       ссылки нельзя, и внутрь панели эта особенность не протекает. */

    @GetMapping("/event/{eventId}")
    public Map<String, Object> state(@PathVariable long eventId) {
        access.requireCapability(Capability.READ, Sections.EV_OFFLINE, Sections.EV_ONLINE);
        return service.state(eventId);
    }

    @PostMapping("/event/{eventId}/register")
    public Map<String, Object> register(@PathVariable long eventId) {
        access.requireCapability(Capability.EDIT, Sections.EV_OFFLINE);
        return service.register(eventId);
    }

    @PostMapping("/event/{eventId}/update")
    public Map<String, Object> update(@PathVariable long eventId) {
        access.requireCapability(Capability.EDIT, Sections.EV_OFFLINE);
        return service.update(eventId);
    }

    @PostMapping("/event/{eventId}/stop")
    public Map<String, Object> stop(@PathVariable long eventId) {
        access.requireCapability(Capability.EDIT, Sections.EV_OFFLINE);
        return service.stop(eventId);
    }

    @PostMapping("/event/{eventId}/start")
    public Map<String, Object> start(@PathVariable long eventId) {
        access.requireCapability(Capability.EDIT, Sections.EV_OFFLINE);
        return service.start(eventId);
    }
}
