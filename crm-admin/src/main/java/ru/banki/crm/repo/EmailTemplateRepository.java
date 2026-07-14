package ru.banki.crm.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import ru.banki.crm.domain.EmailTemplate;

public interface EmailTemplateRepository extends JpaRepository<EmailTemplate, Long> {

    @Query("select distinct e.partnerName from EmailTemplate e where e.partnerName is not null and e.partnerName <> ''")
    java.util.List<String> distinctPartnerNames();

    @Query("select distinct e.communicationName from EmailTemplate e where e.communicationName is not null and e.communicationName <> ''")
    java.util.List<String> distinctCommunicationNames();
}
