package ru.banki.crm.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import ru.banki.crm.domain.SmsTemplate;

import java.util.Optional;

public interface SmsTemplateRepository extends JpaRepository<SmsTemplate, Integer> {

    Optional<SmsTemplate> findFirstByCode(Integer code);

    // v2 rule: SMS business codes are kept below 10000.
    @Query("select coalesce(max(s.code), 0) from SmsTemplate s where s.code < 10000")
    int maxCode();

    @Query("select distinct s.partnerName from SmsTemplate s where s.partnerName is not null and s.partnerName <> ''")
    java.util.List<String> distinctPartnerNames();

    @Query("select distinct s.communicationName from SmsTemplate s where s.communicationName is not null and s.communicationName <> ''")
    java.util.List<String> distinctCommunicationNames();
}
