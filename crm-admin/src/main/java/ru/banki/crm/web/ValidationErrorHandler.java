package ru.banki.crm.web;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * Ошибки валидации тела запроса — человеку, а не в лог.
 * <p>
 * Без этого обработчика Spring отдаёт свой служебный текст: «Validation failed for
 * object='createUser'. Error count: 1». Какое поле не устроило — не сказано, и починить
 * по такому сообщению нельзя: администратор, заводивший пользователя, видел его на каждую
 * попытку и не понимал, что не так (пароль короче восьми, не выбрана роль, адрес не похож
 * на почту — снаружи всё выглядит одинаково).
 * <p>
 * Собираем сообщения самих ограничений (они заданы по-русски в UserDtos и RoleDtos) и
 * склеиваем в одну строку. Клиент читает поле message из тела ответа (api.js, req), так
 * что формат оставляем тем же, что у остальных ошибок.
 */
@RestControllerAdvice
public class ValidationErrorHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> onInvalidBody(MethodArgumentNotValidException e) {
        /* LinkedHashSet: порядок полей формы сохраняется, дубли (два ограничения на одном
           поле с одинаковым текстом) схлопываются. */
        Set<String> parts = new LinkedHashSet<>();
        for (FieldError f : e.getBindingResult().getFieldErrors()) {
            String msg = f.getDefaultMessage();
            parts.add(msg == null || msg.isBlank() ? f.getField() : msg);
        }
        for (var g : e.getBindingResult().getGlobalErrors()) {
            if (g.getDefaultMessage() != null && !g.getDefaultMessage().isBlank()) {
                parts.add(g.getDefaultMessage());
            }
        }
        String text = parts.isEmpty() ? "Проверьте заполнение полей" : String.join("; ", parts);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", HttpStatus.BAD_REQUEST.value());
        body.put("error", "Bad Request");
        body.put("message", text);
        return ResponseEntity.badRequest().body(body);
    }
}
