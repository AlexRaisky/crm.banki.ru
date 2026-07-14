package ru.banki.crm.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import ru.banki.crm.domain.CcSegment;

import java.util.Optional;

public interface CcSegmentRepository extends JpaRepository<CcSegment, Long> {

    Optional<CcSegment> findFirstBySegment(Integer segment);

    @Query("select distinct c.partnerName from CcSegment c where c.partnerName is not null and c.partnerName <> ''")
    java.util.List<String> distinctPartnerNames();

    @Query("select distinct c.communicationName from CcSegment c where c.communicationName is not null and c.communicationName <> ''")
    java.util.List<String> distinctCommunicationNames();
}
