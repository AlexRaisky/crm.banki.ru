package ru.banki.crm.web;

import org.springframework.web.bind.annotation.*;
import ru.banki.crm.service.DbConnectionService;

import java.util.List;
import java.util.Map;

/**
 * Реестр подключений к БД для страницы «Диагностика».
 * ADMIN гарантируется общим правилом /api/admin/** в SecurityConfig.
 */
@RestController
@RequestMapping("/api/admin/db-connections")
public class DbConnectionController {

    private final DbConnectionService service;

    public DbConnectionController(DbConnectionService service) {
        this.service = service;
    }

    /** Список: встроенные (наша/прод) + пользовательские, со статусом последней проверки. */
    @GetMapping
    public List<Map<String, Object>> list() {
        return service.list();
    }

    /** Добавить подключение. Тело: {name, jdbcUrl, username, password, purpose, active}. */
    @PostMapping
    public Map<String, Object> add(@RequestBody Map<String, Object> body) {
        return service.add(body);
    }

    /** Изменить подключение. Пароль пишется только если прислан непустым. */
    @PutMapping("/{id}")
    public void update(@PathVariable long id, @RequestBody Map<String, Object> body) {
        service.update(id, body);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable long id) {
        service.delete(id);
    }

    /** Проверить одно подключение (SELECT 1). id — число или встроенное our-db/prod-db. */
    @PostMapping("/{id}/test")
    public Map<String, Object> test(@PathVariable String id) {
        return service.test(id);
    }

    /** Проверить все и вернуть свежий список со статусами. */
    @PostMapping("/test-all")
    public List<Map<String, Object>> testAll() {
        return service.testAll();
    }
}
