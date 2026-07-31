-- Журнал А/Б тестов — общая таблица команды (раздел «А/Б тесты»).
--
-- Что фиксируем: когда шёл тест, кто его инициировал, что проверяли, на каких шаблонах,
-- к чему пришли и кто тест вёл. «Кто тестировал» по умолчанию подставляется из учётки
-- (AbTestService берёт CurrentUser.email(), если поле пришло пустым), но поле обычное
-- текстовое — вписать другого человека можно руками.
--
-- Демо-данными НЕ наполняем: записи заводят люди.
CREATE TABLE IF NOT EXISTS app.ab_test (
    id            bigserial PRIMARY KEY,
    date_start    date         NOT NULL,            -- когда начали
    date_end      date,                             -- когда закончили; NULL = тест ещё идёт
    subject       text         NOT NULL DEFAULT '', -- что тестировали (гипотеза)
    templates     text         NOT NULL DEFAULT '', -- какие шаблоны использовались
    owner_name    varchar(200) NOT NULL DEFAULT '', -- кто инициировал
    tester        varchar(200) NOT NULL DEFAULT '', -- кто тестировал (по умолчанию из учётки)
    result        text         NOT NULL DEFAULT '', -- результаты

    -- timestamp_upd служит и версией строки: правка присылает его обратно, и если
    -- в базе он уже другой — строку успел изменить кто-то ещё, возвращаем 409
    -- (та же оптимистическая блокировка, что в app.promo_plan).
    timestamp_cr  timestamptz  NOT NULL DEFAULT now(),
    timestamp_upd timestamptz  NOT NULL DEFAULT now(),
    created_by    varchar(200),
    updated_by    varchar(200)
);

-- Раздел читается срезами по датам (последние тесты сверху).
CREATE INDEX IF NOT EXISTS ix_ab_test_date ON app.ab_test (date_start);

-- Доступ: «такой же, как к планированию промо» — копируем права роль-в-роль из секции
-- promo. Копируем ИМЕННО текущие права, а не «всем всё»: у Маркетолога и СЕО промо
-- только на чтение, и А/Б тесты должны вести себя так же. Новым ролям раздел выдаётся
-- через матрицу в «Управлении доступом», как и остальные.
INSERT INTO app.role_section (role_id, section_id, can_read, can_add, can_edit, can_delete)
SELECT role_id, 'abtests', can_read, can_add, can_edit, can_delete
FROM app.role_section
WHERE section_id = 'promo'
ON CONFLICT (role_id, section_id) DO NOTHING;
