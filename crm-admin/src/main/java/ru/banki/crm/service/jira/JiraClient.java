package ru.banki.crm.service.jira;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * HTTP к Jira Data Center. Тонкий слой: собрать запрос, поставить токен, разобрать ответ
 * и превратить чужую ошибку в понятную нашу.
 * <p>
 * Аутентификация — <b>Bearer</b> с personal access token. Это важно: в Jira Cloud тот же
 * по названию «API-токен» ходит через Basic вместе с почтой, и перепутанная схема даёт
 * ровно тот же 401, что и неверный токен, — искать потом можно долго.
 * <p>
 * API версии 2: в Data Center третьей нет, а описания полей там wiki-разметкой, не ADF.
 * <p>
 * Таймауты короткие намеренно. Ручка вызывается из живого экрана, и лучше честное
 * «Jira не ответила за 10 секунд», чем полминуты неподвижной кнопки.
 */
public class JiraClient {

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(15);

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(CONNECT_TIMEOUT)
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    private final String baseUrl;
    private final String token;
    private final ObjectMapper om;

    public JiraClient(String baseUrl, String token, ObjectMapper om) {
        this.baseUrl = baseUrl == null ? "" : baseUrl.trim().replaceAll("/+$", "");
        this.token = token == null ? "" : token.trim();
        this.om = om;
    }

    public JsonNode get(String path) {
        return send(HttpRequest.newBuilder(uri(path)).GET());
    }

    public JsonNode post(String path, String json) {
        return send(HttpRequest.newBuilder(uri(path))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json, java.nio.charset.StandardCharsets.UTF_8)));
    }

    public JsonNode put(String path, String json) {
        return send(HttpRequest.newBuilder(uri(path))
                .header("Content-Type", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(json, java.nio.charset.StandardCharsets.UTF_8)));
    }

    private URI uri(String path) {
        if (baseUrl.isEmpty()) {
            throw bad("Адрес Jira не задан: «Настройки» → «Интеграции» → Jira.");
        }
        return URI.create(baseUrl + path);
    }

    private JsonNode send(HttpRequest.Builder b) {
        HttpRequest req = b.header("Authorization", "Bearer " + token)
                .header("Accept", "application/json")
                .timeout(READ_TIMEOUT)
                .build();
        HttpResponse<String> res;
        try {
            res = http.send(req, HttpResponse.BodyHandlers.ofString(java.nio.charset.StandardCharsets.UTF_8));
        } catch (java.net.http.HttpConnectTimeoutException e) {
            throw bad("Jira не отвечает (" + baseUrl + "). Проверьте, что адрес виден с сервера панели.");
        } catch (javax.net.ssl.SSLHandshakeException e) {
            /* Частая беда внутренних Jira: сертификат подписан своим удостоверяющим
               центром, и Java ему не верит там, где браузер верит. Лечится добавлением
               корневого сертификата в truststore образа, а не правкой кода. */
            throw bad("Не удалось установить TLS-соединение с Jira: " + e.getMessage()
                    + ". Похоже на самоподписанный сертификат — его корень нужно добавить в truststore контейнера.");
        } catch (java.io.IOException | InterruptedException e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            throw bad("Запрос к Jira не выполнен: " + e.getMessage());
        }
        int code = res.statusCode();
        if (code == 401) throw bad("Jira не приняла токен (401). Токен просрочен, отозван или скопирован не полностью.");
        if (code == 403) throw bad("Jira отказала в доступе (403): у сервисной учётки не хватает прав в проекте.");
        if (code == 404) throw bad("Jira ответила 404: проверьте адрес и ключ проекта.");
        if (code >= 400) throw bad("Jira ответила " + code + ": " + shorten(errorText(res.body())));
        return parse(res.body());
    }

    /** У Jira ошибка приезжает объектом с errorMessages/errors — вытаскиваем читаемое. */
    private String errorText(String body) {
        try {
            JsonNode n = om.readTree(body);
            StringBuilder sb = new StringBuilder();
            JsonNode msgs = n.get("errorMessages");
            if (msgs != null && msgs.isArray()) msgs.forEach(m -> sb.append(m.asText()).append("; "));
            JsonNode errs = n.get("errors");
            if (errs != null && errs.isObject()) {
                errs.fields().forEachRemaining(e -> sb.append(e.getKey()).append(": ")
                        .append(e.getValue().asText()).append("; "));
            }
            return sb.length() > 0 ? sb.toString() : body;
        } catch (Exception e) {
            return body;
        }
    }

    private JsonNode parse(String body) {
        if (body == null || body.isBlank()) return om.createObjectNode();
        try {
            return om.readTree(body);
        } catch (Exception e) {
            /* HTML вместо JSON — почти всегда страница входа: значит перед Jira стоит
               SSO-прокси, и токен до неё не доходит. */
            throw bad("Jira вернула не JSON. Обычно так отвечает страница входа — "
                    + "перед Jira стоит SSO-прокси, и запрос до API не доходит.");
        }
    }

    private static String shorten(String s) {
        if (s == null) return "";
        String t = s.replaceAll("\s+", " ").trim();
        return t.length() > 400 ? t.substring(0, 397) + "…" : t;
    }

    private static ResponseStatusException bad(String msg) {
        return new ResponseStatusException(HttpStatus.BAD_GATEWAY, msg);
    }
}
