package ru.banki.crm.config;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.web.servlet.error.ErrorViewResolver;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.web.servlet.ModelAndView;
import org.springframework.web.servlet.View;

import java.util.Map;
import java.util.Set;

/**
 * Адрес есть у каждого экрана, а файл на диске — только у двух документов.
 *
 * <p>С маршрутизацией (js/router.js) панель живёт по обычным путям вида
 * /entities/client/client/12, и по такому адресу браузер приходит на сервер
 * дважды: при переходе по внешней ссылке и при F5. Файла там нет, поэтому без
 * этой настройки человек получал бы 404 на собственную закладку.
 *
 * <p>Сделано перехватом 404, а не catch-all маршрутом: раздача статики
 * остаётся нетронутой, и путь сюда доходит только тогда, когда ничего другого
 * не нашлось. Права проверяются раньше — до 404 запрос доживает уже
 * аутентифицированным, а /settings/** ещё и с проверкой секций
 * (SecurityConfig), поэтому подмена документа ничего не открывает лишнего.
 *
 * <p>Исключения из подмены:
 * <ul>
 *   <li>/api/** — ручка обязана отвечать ошибкой, а не HTML. Если отдать сюда
 *       страницу, фронт примет её за ответ: строка вместо объекта в /api/me
 *       молча роняет весь ACL в «нет прав» — ровно так и ломался стенд;</li>
 *   <li>пути с расширением (.js, .css, .json) — отсутствующий ресурс должен
 *       честно давать 404, иначе вместо скрипта приедет HTML и ошибка
 *       всплывёт где-то далеко от причины.</li>
 * </ul>
 */
@Configuration
public class SpaFallbackConfig {

    @Bean
    public ErrorViewResolver spaFallbackViewResolver() {
        return (request, status, model) -> {
            if (status != HttpStatus.NOT_FOUND) {
                return null;
            }
            String uri = request.getRequestURI();
            if (uri == null || uri.startsWith("/api/") || isAsset(uri)) {
                return null;
            }
            String target = uri.startsWith("/settings/") || uri.equals("/settings")
                    ? "/settings/index.html"
                    : "/index.html";
            return new ModelAndView(forwardOk(target), Map.of());
        };
    }

    /**
     * Запрос файла, а не экрана.
     *
     * <p>Проверяется по списку известных расширений, а не «есть точка в последнем
     * сегменте»: в маршрут попадают коды шаблонов и идентификаторы записей, а
     * точка в них — обычное дело. По точке такая ссылка молча получала бы 404.
     */
    private static boolean isAsset(String uri) {
        int dot = uri.lastIndexOf('.');
        if (dot < 0 || dot < uri.lastIndexOf('/')) {
            return false;
        }
        return ASSET_EXTENSIONS.contains(uri.substring(dot + 1).toLowerCase());
    }

    private static final Set<String> ASSET_EXTENSIONS = Set.of(
            "js", "mjs", "css", "map", "json", "html", "htm", "txt", "xml", "csv",
            "png", "jpg", "jpeg", "gif", "svg", "ico", "webp", "avif",
            "woff", "woff2", "ttf", "otf", "eot", "pdf", "zip", "wasm");

    /**
     * Отдать документ приложения со статусом 200.
     *
     * <p>Именно 200, а не 404 с телом: адрес существует с точки зрения
     * приложения, а по 404 браузеры и прокси иначе относятся к кешу и истории.
     * Штатный вид «forward:/…» сюда не годится — он сохранил бы код ошибки.
     */
    private static View forwardOk(String path) {
        return (model, req, res) -> {
            res.setStatus(HttpServletResponse.SC_OK);
            req.getRequestDispatcher(path).forward(req, res);
        };
    }
}
