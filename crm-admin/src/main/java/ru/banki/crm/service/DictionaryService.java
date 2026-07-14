package ru.banki.crm.service;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.banki.crm.domain.CcSegment;
import ru.banki.crm.repo.*;

import java.util.List;
import java.util.TreeSet;

/** Reference data: partner names (v2 AllPartnerName) and CC segments (v2 FetchCCSegments). */
@Service
public class DictionaryService {

    private final PushTemplateRepository pushRepo;
    private final EmailTemplateRepository emailRepo;
    private final SmsTemplateRepository smsRepo;
    private final CcSegmentRepository ccRepo;

    public DictionaryService(PushTemplateRepository pushRepo, EmailTemplateRepository emailRepo,
                             SmsTemplateRepository smsRepo, CcSegmentRepository ccRepo) {
        this.pushRepo = pushRepo;
        this.emailRepo = emailRepo;
        this.smsRepo = smsRepo;
        this.ccRepo = ccRepo;
    }

    @Transactional(readOnly = true)
    public List<String> partnerNames() {
        TreeSet<String> names = new TreeSet<>();
        names.addAll(pushRepo.distinctPartnerNames());
        names.addAll(emailRepo.distinctPartnerNames());
        names.addAll(smsRepo.distinctPartnerNames());
        names.addAll(ccRepo.distinctPartnerNames());
        return List.copyOf(names);
    }

    @Transactional(readOnly = true)
    public List<CcSegment> ccSegments() {
        return ccRepo.findAll();
    }

    /** Distinct communication_name values for a channel — suggestions for the editable combobox. */
    @Transactional(readOnly = true)
    public List<String> communicationNames(String channel) {
        TreeSet<String> names = new TreeSet<>();
        switch (channel == null ? "" : channel) {
            case "push" -> names.addAll(pushRepo.distinctCommunicationNames());
            case "email" -> names.addAll(emailRepo.distinctCommunicationNames());
            case "sms" -> names.addAll(smsRepo.distinctCommunicationNames());
            case "cc" -> names.addAll(ccRepo.distinctCommunicationNames());
            default -> {
                names.addAll(pushRepo.distinctCommunicationNames());
                names.addAll(emailRepo.distinctCommunicationNames());
                names.addAll(smsRepo.distinctCommunicationNames());
                names.addAll(ccRepo.distinctCommunicationNames());
            }
        }
        return List.copyOf(names);
    }
}
