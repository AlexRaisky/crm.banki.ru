-- Планирование промо — общая таблица команды (раздел «Планирование промо»).
-- До этого план жил в localStorage у каждого в браузере: у Саши, Тани и Юли были
-- три разные таблицы, и «общего» плана не существовало. Теперь строки лежат здесь.
--
-- Правило «одна запись = один канал» сохраняем: при заведении промо на несколько
-- каналов создаётся столько строк, сколько выбрано каналов (см. PromoPlanService.create).
--
-- Демо-данными таблицу НЕ наполняем: реальный план заливается людьми (или импортом
-- из CSV — выгрузка в разделе уже есть).
CREATE TABLE IF NOT EXISTS app.promo_plan (
    id            bigserial PRIMARY KEY,
    plan_date     date         NOT NULL,           -- дата отправки
    product       varchar(200) NOT NULL DEFAULT '',-- продукт (crm_product_segment)
    partner       varchar(200) NOT NULL DEFAULT '',
    base          text         NOT NULL DEFAULT '',-- словесное описание базы
    channel       varchar(40)  NOT NULL DEFAULT '',-- ровно один канал на строку
    is_total      boolean      NOT NULL DEFAULT false,
    uniq_name     varchar(120) NOT NULL DEFAULT '',-- уникальное имя для source (латиница/цифры/дефис)
    task_key      varchar(60)  NOT NULL DEFAULT '',-- ключ задачи, напр. CRM-8746
    owner_name    varchar(120) NOT NULL DEFAULT '',-- ответственный (пока текст, см. ниже)
    status        varchar(60)  NOT NULL DEFAULT '',
    note          text         NOT NULL DEFAULT '',

    -- timestamp_upd служит и версией строки: правка присылает его обратно, и если
    -- в базе он уже другой — строку успел изменить кто-то ещё, возвращаем 409.
    timestamp_cr  timestamptz  NOT NULL DEFAULT now(),
    timestamp_upd timestamptz  NOT NULL DEFAULT now(),
    created_by    varchar(200),
    updated_by    varchar(200)
);

-- Раздел всегда читается срезом по датам (месяц, «актуальные/архивные»).
CREATE INDEX IF NOT EXISTS ix_promo_plan_date ON app.promo_plan (plan_date);

-- owner_name пока текст («Саша», «Таня», «Юля») — как было в localStorage.
-- Привязку к app.users делаем отдельным заходом вместе со справочниками
-- продуктов и партнёров, чтобы не растить этот шаг вдвое.
