package ru.banki.crm.web;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.domain.Capability;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.SmsCheckReportService;
import ru.banki.crm.service.Sections;

import java.nio.charset.StandardCharsets;
import java.time.YearMonth;
import java.time.format.DateTimeParseException;
import java.util.Map;

/**
 * Отчёт «ЧЕК СМС траффик» — выгрузка в Excel (раздел «Отчёты»).
 * <p>
 * Скачать книгу может любой с правом READ на раздел rep-smscheck — у каждого отчёта
 * своя секция (V29), поэтому доступ к этой выгрузке выдаётся отдельно от прочих
 * отчётов. Источник данных
 * (внешняя БД DWH) задаёт только ADMIN — коннект наружу не отдаётся, в download
 * он берётся из серверной конфигурации, а не из запроса.
 */
@RestController
@RequestMapping("/api/reports/sms-check")
public class SmsCheckReportController {

    private final SmsCheckReportService service;
    private final AccessGuard access;

    public SmsCheckReportController(SmsCheckReportService service, AccessGuard access) {
        this.service = service;
        this.access = access;
    }

    /** Текущий источник + список каналов + право правки (для формы админа). */
    @GetMapping("/config")
    public Map<String, Object> config() {
        access.requireCapability(Capability.READ, Sections.REP_SMSCHECK);
        return service.configGet();
    }

    /** Задать источник-DWH (ADMIN). Тело: {connectionId: <id|null>}. */
    @PutMapping("/config")
    public Map<String, Object> saveConfig(@RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.READ, Sections.REP_SMSCHECK);
        Object raw = body == null ? null : body.get("connectionId");
        Long id = null;
        if (raw != null && !String.valueOf(raw).isBlank()) {
            try { id = Long.parseLong(String.valueOf(raw).trim()); }
            catch (NumberFormatException e) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "connectionId должен быть числом."); }
        }
        service.configSet(id);
        return service.configGet();
    }

    /** Лист «по дням» как данные — для показа отчёта прямо на странице. */
    @GetMapping("/daily")
    public Map<String, Object> daily(@RequestParam String month,
                                     @RequestParam(defaultValue = "sms") String channel,
                                     @RequestParam(required = false) String product) {
        access.requireCapability(Capability.READ, Sections.REP_SMSCHECK);
        return service.daily(parseMonth(month), channel, product);
    }

    /** Продукты, встречающиеся в выбранном месяце и канале — для выпадающего списка. */
    @GetMapping("/products")
    public Map<String, Object> products(@RequestParam String month,
                                        @RequestParam(defaultValue = "sms") String channel) {
        access.requireCapability(Capability.READ, Sections.REP_SMSCHECK);
        return service.products(parseMonth(month), channel);
    }

    /** Скачать .xlsx за месяц (YYYY-MM) по каналу (sms|push|email). */
    @GetMapping("/download")
    public ResponseEntity<byte[]> download(@RequestParam String month,
                                           @RequestParam(defaultValue = "sms") String channel,
                                           @RequestParam(required = false) String product) {
        access.requireCapability(Capability.READ, Sections.REP_SMSCHECK);
        byte[] xlsx = service.build(parseMonth(month), channel, product);
        String name = "check-sms-" + channel.toLowerCase() + "-" + month + ".xlsx";
        // (имя файла собираем из уже проверенных параметров)
        // RFC 5987: имя ASCII-безопасное, поэтому обычного filename достаточно
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + name + "\"")
                .contentType(MediaType.parseMediaType(
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(xlsx);
    }

    /** Месяц из строки YYYY-MM — общий разбор для выгрузки и для данных на странице. */
    private static YearMonth parseMonth(String month) {
        try {
            return YearMonth.parse(month);
        } catch (DateTimeParseException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Месяц должен быть в формате YYYY-MM.");
        }
    }
}
