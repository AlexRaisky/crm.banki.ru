package ru.banki.crm.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import ru.banki.crm.domain.PushTemplate;

import java.util.Optional;

public interface PushTemplateRepository extends JpaRepository<PushTemplate, Long> {

    Optional<PushTemplate> findFirstByCode(Integer code);

    @Query("select coalesce(max(p.code), 0) from PushTemplate p")
    int maxCode();

    @Query("select distinct p.partnerName from PushTemplate p where p.partnerName is not null and p.partnerName <> ''")
    java.util.List<String> distinctPartnerNames();

    @Query("select distinct p.communicationName from PushTemplate p where p.communicationName is not null and p.communicationName <> ''")
    java.util.List<String> distinctCommunicationNames();
}
