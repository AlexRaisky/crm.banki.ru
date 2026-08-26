package ru.banki.crm.service.prod;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Тексты смс для согласования у сотовых операторов: сверка.
 * <p>
 * Строка в {@code notice.d_com_sms_approved_template} создаётся при доставке шаблона
 * в прод — то есть ловится только то, что заводят и правят сейчас. Шаблоны, уехавшие
 * до появления этого правила, и те, у кого доставка когда-то падала, остались бы без
 * текста навсегда. Этот процесс их добирает.
 * <p>
 * Ходит через пару минут после старта и дальше раз в сутки. Только при старте мало:
 * приложение перезапускают редко, а шаблоны заводят каждый день; суточный проход —
 * та же страховка, что вечерний полный проход обратного ETL.
 * <p>
 * <b>Только смс.</b> Разложение и таблица согласований живут в {@link ProdDbService}
 * и завязаны на прод-таблицу sms-шаблонов; другой канал в этот код не попадает.
 */
@Service
public class SmsApprovedService {

    private static final Logger log = LoggerFactory.getLogger(SmsApprovedService.class);

    private final ProdDbService prod;
    private final ProcessControlService control;

    public SmsApprovedService(ProdDbService prod, ProcessControlService control) {
        this.prod = prod;
        this.control = control;
    }

    /**
     * Плановый проход. Первый — через две минуты после старта, дальше раз в сутки.
     * <p>
     * Прод не настроен или процесс остановлен — молча пропускаем: это не поломка,
     * а штатное состояние контура, где боевой базы нет.
     */
    @Scheduled(fixedDelayString = "${app.smsapproved.interval-ms:86400000}",
               initialDelayString = "${app.smsapproved.initial-delay-ms:120000}")
    public void tick() {
        if (!prod.configured() || !control.canStart(ProcessControlService.SMS_APPROVED)) {
            return;
        }
        try {
            Map<String, Object> res = run(true);
            control.noteRun(ProcessControlService.SMS_APPROVED, "заполнено: " + res.getOrDefault("filled", 0));
        } catch (Exception e) {
            log.warn("Сверка текстов согласования не прошла: {}", e.toString());
            control.noteRun(ProcessControlService.SMS_APPROVED, "ошибка: " + cut(e.getMessage()));
        }
    }

    /**
     * Один проход сверки.
     *
     * @param apply {@code false} — сухой прогон: посчитать и показать, ничего не записывая
     */
    public Map<String, Object> run(boolean apply) throws Exception {
        if (!prod.configured()) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("configured", false);
            out.put("message", "Прод-БД шаблонов не настроена — сверять нечего.");
            return out;
        }
        Map<String, Object> out = new LinkedHashMap<>(prod.smsApprovedSweep(apply));
        out.put("configured", true);
        return out;
    }

    private static String cut(String s) {
        String v = String.valueOf(s);
        return v.length() > 300 ? v.substring(0, 300) : v;
    }
}
