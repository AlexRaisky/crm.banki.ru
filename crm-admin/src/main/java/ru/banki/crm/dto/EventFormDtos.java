package ru.banki.crm.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * Формы завода событий (раздел «События»). Повторяют пошаговые формы старой
 * Appsmith-админки: «Онлайн» (событие приходит извне) и «V2» (событие порождает
 * планировщик по кронтабу).
 * <p>
 * Отличие от Flow Builder: там событие рисуется на канве и материализуется из цепочки,
 * здесь оно заводится напрямую формой. Пишут обе дороги в одно и то же — слой A
 * (flow.*) плюс слой B (tracker/scheduler/template/commapi).
 */
public final class EventFormDtos {

    private EventFormDtos() {}

    /**
     * Один SQL-шаг выборки (только у оффлайн-события).
     * <p>
     * Без bean-валидации намеренно: constraint на поле записи внутри списка сработал бы
     * только с {@code List<@Valid StepForm>}, а без него молча ничего не проверял бы.
     * Пустой SQL ловит сервис — там же, где проверяется, что шаг вообще есть.
     */
    public record StepForm(String sql, Integer orderNum, Boolean returnsResultSet) {}

    /**
     * Оффлайн-событие: планировщик по кронтабу выполняет SQL-шаги и порождает коммуникацию.
     *
     * @param selection имя процесса выборки. Связывает три прод-таблицы между собой
     *                  (t_get_event, t_launch_settings, t_execution_steps.process_name) —
     *                  внешних ключей там нет, только совпадение строки.
     * @param isChain   маппинг шаблона пишется в d_template_mapping_mass вместо
     *                  d_template_mapping (в проде цепочка живёт отдельной таблицей).
     */
    public record OfflineEventForm(
            @NotBlank(message = "Не заполнено имя события") String eventName,
            @NotBlank(message = "Не заполнено имя процесса (selection)") String selection,
            String source,
            @NotBlank(message = "Не выбран канал (notify_channel)") String notifyChannel,
            String definitionKey,
            String businessKeyPrefix,
            Long templateId,
            String system,
            Boolean isActive,
            Boolean isBatch,
            Boolean isChain,
            String dateStart,
            @NotBlank(message = "Не выбрана база выборки") String database,
            String crontab,
            @NotNull(message = "Не задан ни один SQL-шаг") List<StepForm> steps) {}

    /**
     * Онлайн-событие: приходит из внешней системы.
     *
     * @param idCommCreation ссылка на ГОТОВЫЙ набор параметров доставки
     *                       (tracker.d_comm_creation) — форма его выбирает, а не создаёт.
     */
    public record OnlineEventForm(
            @NotBlank(message = "Не заполнено имя события") String eventName,
            String source,
            @NotBlank(message = "Не выбран канал (notify_channel)") String notifyChannel,
            String definitionKey,
            String businessKeyPrefix,
            Long templateId,
            String system,
            Boolean isActive,
            Boolean isBatch,
            @NotNull(message = "Не выбран id_comm_creation") Long idCommCreation) {}

    /** Что создалось: id события слоя A и строки слоя B. */
    public record EventCreated(long eventId, String eventName, List<CreatedRow> rows, List<String> warnings) {}

    public record CreatedRow(String table, long id) {}
}
