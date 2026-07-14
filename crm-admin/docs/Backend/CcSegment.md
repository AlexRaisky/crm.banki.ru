---
tags: [backend, domain, entity]
---

# CcSegment

JPA-сущность сегмента call-центра (КЦ). Наследует общие поля от [[TemplateBase]]. Маппится на таблицу `callcenter.d_segment_properties` — см. [[d_segment_properties (таблица)]]. В отличие от остальных каналов, здесь суррогатный PK `id` не показывается пользователю; бизнес-идентификатор — номер сегмента `segment`.

Аннотации: `@Entity`, `@Table(name = "d_segment_properties", schema = "callcenter")`, `@Getter`, `@Setter`.

## Поля

- `id : Long` — `@Id`, `@GeneratedValue(strategy = SEQUENCE, generator = "cc_seq")`, `@SequenceGenerator(name = "cc_seq", sequenceName = "callcenter.d_segment_properties_id_seq", allocationSize = 1)`. Суррогатный PK (auto), не показывается пользователям.
- `segment : Integer` — колонка `segment`, `nullable = false`. Бизнес-номер сегмента, который вводит пользователь; по нему приложение ищет CC-шаблоны.
- `sourceSystem : String` — колонка `source_system`, default `""`.
- `segmentDescr : String` — колонка `segment_descr`.
- `hostId : Long` — колонка `host_id`.
- `mlCheckProbability : Boolean` — колонка `ml_check_probability`.
- `mlProbabilityRequired : BigDecimal` — колонка `ml_probability_required`.
- `cutpercent : Integer` — колонка `cutpercent`.
- `nocutpercent : Integer` — колонка `nocutpercent`.
- `abGroup : String` — колонка `ab_group`.
- `placement : String` — колонка `placement`.
- `kvintCampaignId : String` — колонка `kvint_campaign_id`.

## Методы

- `String channel()` — возвращает `"cc"`.
- `String businessCode()` — `segment == null ? null : String.valueOf(segment)`.

## Связи

- Базовый класс: [[TemplateBase]].
- Репозиторий: [[CcSegmentRepository]].
- Таблица БД: [[d_segment_properties (таблица)]].
- Маппинг DTO: [[TemplateMapper]], [[TemplateDto]]; справочник сегментов — [[DictionaryService]].

## Источник

`src/main/java/ru/banki/crm/domain/CcSegment.java`
