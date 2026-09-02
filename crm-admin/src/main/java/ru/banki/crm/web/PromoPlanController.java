package ru.banki.crm.web;

import org.springframework.web.bind.annotation.*;
import ru.banki.crm.domain.Capability;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.PromoPlanService;
import ru.banki.crm.service.Sections;

import java.util.List;
import java.util.Map;

/**
 * Планирование промо — общая таблица команды.
 * Смотреть может любой с разделом promo, править — EDITOR/ADMIN.
 */
@RestController
@RequestMapping("/api/promo/plan")
public class PromoPlanController {

    private final PromoPlanService service;
    private final AccessGuard access;

    public PromoPlanController(PromoPlanService service, AccessGuard access) {
        this.service = service;
        this.access = access;
    }

    /**
     * Весь план. Заодно переводим прошедшие «запланировано» в «отправлено» —
     * раньше это делал каждый клиент у себя и тут же сохранял.
     */
    @GetMapping
    public List<Map<String, Object>> list() {
        access.requireAnySection(Sections.PROMO);
        service.archiveSync();
        return service.list();
    }

    /** Завести промо. Каналов может быть несколько — вернётся столько же строк. */
    @PostMapping
    public List<Map<String, Object>> create(@RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.ADD, Sections.PROMO);
        return service.create(body);
    }

    /**
     * Правка одного поля: {field, value, ver}.
     * ver — timestamp_upd, который видел клиент; разошёлся — 409.
     */
    @PatchMapping("/{id}")
    public Map<String, Object> update(@PathVariable long id, @RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.EDIT, Sections.PROMO);
        return service.updateField(id, body);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable long id) {
        access.requireCapability(Capability.DELETE, Sections.PROMO);
        service.delete(id);
    }
    /**
     * Что уйдёт в задачу: заголовок и поля. Ничего не создаёт.
     * <p>
     * Отдельной ручкой, а не «сухим прогоном» создания: заведение задачи необратимо, и
     * подмешивать к нему режим «на самом деле нет» значит однажды перепутать их местами.
     */
    @GetMapping("/{id}/jira/preview")
    public Map<String, Object> jiraPreview(@PathVariable long id,
                                           @RequestParam(required = false) String source,
                                           @RequestParam(required = false) String productCode) {
        access.requireAnySection(Sections.PROMO);
        return service.jiraPreview(id, source == null ? "" : source,
                productCode == null ? "" : productCode);
    }


    /**
     * Завести задачу в Jira по строке плана: {source, productCode}.
     * <p>
     * Право то же, что на правку строки: задача заводится по плану и тут же прописывает
     * в него свой ключ, так что это правка плана, а не отдельная привилегия.
     */
    @PostMapping("/{id}/jira")
    public Map<String, Object> createJiraTask(@PathVariable long id,
                                              @RequestBody(required = false) Map<String, Object> body) {
        access.requireCapability(Capability.EDIT, Sections.PROMO);
        Object src = body == null ? null : body.get("source");
        Object code = body == null ? null : body.get("productCode");
        return service.createJiraTask(id,
                src == null ? "" : String.valueOf(src),
                code == null ? "" : String.valueOf(code));
    }

    /**
     * Кого можно назначить ответственным — имена пользователей панели.
     * <p>
     * Лежит здесь, а не в админской ручке пользователей: список нужен всем, кто ведёт
     * план, а /api/admin/users отдаёт учётки целиком и только админу. Отдаём одни имена,
     * без почты и ролей — для выпадающего списка больше ничего не требуется.
     */
    @GetMapping("/owners")
    public List<String> owners() {
        access.requireAnySection(Sections.PROMO);
        return service.ownerCandidates();
    }

    /**
     * Кого можно поставить заказчиком — направления из chain.chain и gorizontal.gorizontal.
     * В задаче Jira это поле обязательное, поэтому список нужен всем, кто ведёт план.
     */
    @GetMapping("/customers")
    public List<String> customers() {
        access.requireAnySection(Sections.PROMO);
        return service.customerCandidates();
    }
}
