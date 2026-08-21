package ru.banki.crm.web;

import org.springframework.web.bind.annotation.*;
import ru.banki.crm.service.BacklogService;

import java.util.List;
import java.util.Map;

/**
 * Бэклог доработок панели.
 * <p>
 * Права здесь не проверяются намеренно: весь путь {@code /api/admin/**} закрыт ролью
 * администратора в SecurityConfig, и дублировать это проверкой секции значило бы завести
 * ещё одно место, где легко ошибиться в другую сторону.
 */
@RestController
@RequestMapping("/api/admin/backlog")
public class BacklogController {

    private final BacklogService backlog;

    public BacklogController(BacklogService backlog) {
        this.backlog = backlog;
    }

    /** Список; {@code status} — фильтр по одному статусу, пусто — все. */
    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) String status) {
        return backlog.list(status);
    }

    /** Сколько задач в каждом статусе — для подписей вкладок. */
    @GetMapping("/counts")
    public Map<String, Object> counts() {
        return backlog.counts();
    }

    @PostMapping
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
        return backlog.create(body);
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable long id, @RequestBody Map<String, Object> body) {
        return backlog.update(id, body);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable long id) {
        backlog.delete(id);
    }
}
