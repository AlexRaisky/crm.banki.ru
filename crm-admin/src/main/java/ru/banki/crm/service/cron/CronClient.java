package ru.banki.crm.service.cron;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * HTTP к планировщику crm-cron. Тонкий слой: собрать запрос, поставить токен, вернуть
 * статус и тело как есть.
 * <p>
 * Разбор ответа тут намеренно не делается. Пока идёт знакомство с сервисом, важнее
 * видеть, что он ответил на самом деле, чем получить аккуратно разобранный объект и
 * потерять текст ошибки: диагноз «permission denied for table events_chain» мы вчера
 * искали ровно потому, что кто-то однажды проглотил исключение.
 * <p>
 * Таймауты короткие. Ручка вызывается из живого экрана, и честное «планировщик не
 * ответил за десять секунд» лучше, чем полминуты неподвижной кнопки.
 * <p>
 * Токен ставится заголовком {@code Authorization: Bearer}. Если у сервиса схема другая,
 * это выяснится первой же проверкой связи — и поменять придётся одну строку здесь.
 */
public class CronClient {

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(10);

    /** Ответ как есть: код и тело. Разбирает тот, кто знает, чего ждёт. */
    public record Reply(int status, String body) {
        public boolean ok() {
            return status >= 200 && status < 300;
        }
    }

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(CONNECT_TIMEOUT)
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    private final String baseUrl;
    private final String token;

    public CronClient(String baseUrl, String token) {
        this.baseUrl = baseUrl == null ? "" : baseUrl.trim().replaceAll("/+$", "");
        this.token = token == null ? "" : token.trim();
    }

    public Reply get(String path) {
        return send(HttpRequest.newBuilder(uri(path)).GET());
    }

    public Reply post(String path, String json) {
        return send(HttpRequest.newBuilder(uri(path))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json, java.nio.charset.StandardCharsets.UTF_8)));
    }

    public Reply patch(String path, String json) {
        return send(HttpRequest.newBuilder(uri(path))
                .header("Content-Type", "application/json")
                .method("PATCH", HttpRequest.BodyPublishers.ofString(
                        json, java.nio.charset.StandardCharsets.UTF_8)));
    }

    // ---------------------------------------------------------------- четыре ручки
    /* Ровно те, что нужны панели. Остальное, что есть в /v3/api-docs (список, удаление,
       пакетные операции, пауза), намеренно не заводим: чего нет в клиенте, то нельзя
       вызвать по ошибке. */

    /** Создать задание. Ответ — CrmCronEventDto, из него берём id. */
    public Reply createEvent(String json) {
        return post("/api/v1/event", json);
    }

    /** Обновить задание. Сервис деактивирует и пересоздаёт контекст — это остановка на время. */
    public Reply updateEvent(long id, String json) {
        return patch("/api/v1/event/" + id, json);
    }

    /* stop и start — GET с побочным эффектом. Это их API, не наше решение; в панели они
       вызываются только по нажатию кнопки с подтверждением и никогда на предзагрузке. */
    public Reply stopEvent(long id) {
        return get("/api/v1/event/" + id + "/stop");
    }

    public Reply startEvent(long id) {
        return get("/api/v1/event/" + id + "/start");
    }

    private URI uri(String path) {
        String p = path == null ? "" : path.trim();
        if (!p.startsWith("/")) {
            p = "/" + p;
        }
        return URI.create(baseUrl + p);
    }

    private Reply send(HttpRequest.Builder b) {
        b.timeout(READ_TIMEOUT).header("Accept", "application/json");
        if (!token.isEmpty()) {
            b.header("Authorization", "Bearer " + token);
        }
        try {
            HttpResponse<String> r = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
            return new Reply(r.statusCode(), r.body());
        } catch (java.io.InterruptedIOException e) {
            /* Таймаут отдельно от прочих сбоев: «не ответил за 10 секунд» и «отказал в
               соединении» ведут к разным действиям — в первом случае ждут, во втором
               проверяют адрес и сеть. */
            return new Reply(0, "планировщик не ответил за " + READ_TIMEOUT.toSeconds() + " с");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Reply(0, "запрос прерван");
        } catch (Exception e) {
            return new Reply(0, e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
        }
    }
}
