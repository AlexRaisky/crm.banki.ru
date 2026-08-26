package ru.banki.crm.web;

import org.springframework.web.bind.annotation.*;
import ru.banki.crm.domain.Capability;
import ru.banki.crm.security.AccessGuard;
import ru.banki.crm.service.Sections;
import ru.banki.crm.service.prod.NoticeEtlService;
import ru.banki.crm.service.prod.ProcessControlService;
import ru.banki.crm.service.prod.SmsApprovedService;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Управление процессами перелива: остановить и пустить снова.
 * <p>
 * Смотреть состояние может тот, кому выдан раздел; нажимать «Остановить» / «Запустить» —
 * тот, у кого есть право на редактирование в нём. Разделение не косметическое: перекрытие
 * потока в прод видно всей команде, а решает его один человек.
 */
@RestController
@RequestMapping("/api/admin/processes")
public class ProcessControlController {

    private final ProcessControlService control;
    private final NoticeEtlService etl;
    private final SmsApprovedService smsApproved;
    private final AccessGuard access;

    public ProcessControlController(ProcessControlService control, NoticeEtlService etl,
                                    SmsApprovedService smsApproved, AccessGuard access) {
        this.control = control;
        this.etl = etl;
        this.smsApproved = smsApproved;
        this.access = access;
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        access.requireAnySection(Sections.SET_PROCS);
        Map<String, Object> etlStatus = etl.status();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> p : control.list()) {
            Map<String, Object> row = new LinkedHashMap<>(p);
            /* Обратный ETL остаётся выключенным свойством app.etl.enabled, даже когда
               выключатель включён. Не сказать об этом — значит показать кнопку, которая
               ничего не меняет: человек «запустит» процесс и не поймёт, почему тихо. */
            if (ProcessControlService.ETL_NOTICE.equals(p.get("code"))) {
                row.put("configEnabled", Boolean.TRUE.equals(etlStatus.get("enabled")));
                row.put("running", Boolean.TRUE.equals(etlStatus.get("running")));
            }
            out.add(row);
        }
        return out;
    }

    @PutMapping("/{code}")
    public Map<String, Object> set(@PathVariable String code, @RequestBody Map<String, Object> body) {
        access.requireCapability(Capability.EDIT, Sections.SET_PROCS);
        boolean enabled = Boolean.TRUE.equals(body.get("enabled"));
        return control.set(code, enabled);
    }

    /**
     * Ручной проход сверки текстов согласования.
     * <p>
     * Право спрашивается по делу, а не по единому правилу раздела: сухой прогон только
     * считает и потому доступен всем, кому виден раздел, а запись идёт в боевую базу —
     * на неё нужно право правки.
     */
    @PostMapping("/sms-approved/run")
    public Map<String, Object> runSmsApproved(@RequestParam(defaultValue = "false") boolean apply)
            throws Exception {
        if (apply) {
            access.requireCapability(Capability.EDIT, Sections.SET_PROCS);
        } else {
            access.requireAnySection(Sections.SET_PROCS);
        }
        return smsApproved.run(apply);
    }
}
