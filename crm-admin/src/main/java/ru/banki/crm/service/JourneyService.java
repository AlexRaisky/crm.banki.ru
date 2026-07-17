package ru.banki.crm.service;

import ru.banki.crm.dto.JourneyDtos.JourneyDto;
import ru.banki.crm.dto.JourneyDtos.JourneyListItem;

import java.util.List;

/**
 * Хранилище цепочек-схем. Сейчас единственная реализация — {@link MockJourneyService}
 * (in-memory); при появлении таблицы в БД добавляется Db-реализация с тем же контрактом.
 */
public interface JourneyService {

    List<JourneyListItem> list();

    JourneyDto get(String id);

    /** @return созданная цепочка с присвоенным id */
    JourneyDto create(JourneyDto dto);

    JourneyDto update(String id, JourneyDto dto);

    void delete(String id);
}
