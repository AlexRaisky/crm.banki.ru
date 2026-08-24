package ru.banki.crm.web;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.security.CurrentUser;
import ru.banki.crm.service.deploy.BuildInfoService;
import ru.banki.crm.service.deploy.DeployService;

import java.util.List;
import java.util.Map;

/**
 * Выкатки: что где стоит, что не доехало, какой командой это доставить.
 * <p>
 * Всё под {@code /api/admin/**}, то есть за ролью администратора. Исключение — {@code /api/build}:
 * его спрашивает соседний контур, у которого нашей куки нет. Там свой пропуск — общий секрет
 * {@code DEPLOY_PEER_TOKEN}; без него и без входа версия не отдаётся никому.
 */
@RestController
public class DeployController {

    private final DeployService deploy;
    private final BuildInfoService build;

    public DeployController(DeployService deploy, BuildInfoService build) {
        this.deploy = deploy;
        this.build = build;
    }

    /**
     * Версия сборки этого контура. Отвечаем своему вошедшему пользователю и соседнему
     * контуру с верным секретом — больше никому: знать, какой коммит стоит на проде,
     * анониму незачем.
     */
    @GetMapping("/api/build")
    public Map<String, Object> buildInfo(@RequestHeader(value = "X-Peer-Token", required = false) String token) {
        boolean insider = CurrentUser.principal().isPresent() || deploy.peerTokenValid(token);
        if (!insider) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Не авторизован");
        }
        return build.summary();
    }

    /** Три контура с версиями: своя из образа, соседние — опросом по внутренней сети. */
    @GetMapping("/api/admin/deploy")
    public Map<String, Object> overview() {
        return deploy.overview();
    }

    /** Что есть у нас и чего ещё нет на целевом контуре. */
    @GetMapping("/api/admin/deploy/pending")
    public Map<String, Object> pending(@RequestParam(required = false) String target) {
        return deploy.pending(target);
    }

    /**
     * План выката: срез коммитов и готовая команда. {@code record=true} пишет намерение
     * в журнал — тогда потом видно, кто и до какого коммита катил.
     */
    @PostMapping("/api/admin/deploy/plan")
    public Map<String, Object> plan(@RequestBody(required = false) JsonNode body) {
        String target = text(body, "target");
        String upTo = text(body, "upTo");
        boolean record = body != null && body.path("record").asBoolean(false);
        return deploy.plan(target, upTo, record);
    }

    @GetMapping("/api/admin/deploy/history")
    public List<Map<String, Object>> history(@RequestParam(defaultValue = "50") int limit) {
        return deploy.history(limit);
    }

    /** Сверить журнал с фактом: что уже стоит на цели — то и выкачено. */
    @PostMapping("/api/admin/deploy/reconcile")
    public Map<String, Object> reconcile() {
        return Map.of("closed", deploy.reconcile());
    }

    @PostMapping("/api/admin/deploy/{id}/cancel")
    public void cancel(@PathVariable long id) {
        deploy.cancel(id);
    }

    private static String text(JsonNode body, String field) {
        JsonNode v = body == null ? null : body.get(field);
        return v == null || v.isNull() ? "" : v.asText().trim();
    }
}
