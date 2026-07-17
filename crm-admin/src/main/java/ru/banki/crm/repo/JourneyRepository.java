package ru.banki.crm.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import ru.banki.crm.domain.Journey;

public interface JourneyRepository extends JpaRepository<Journey, String> {
}
