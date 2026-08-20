-- Промо: заказчик, ссылка и описание.
--
-- Три поля нужны для заведения задачи в Jira (тип CRM-Промо): «Заказчик» там
-- обязательное, «Ссылка» и «Контент» заполняет постановщик. Раньше их держали в голове
-- и вписывали руками уже в самой задаче — то есть план промо и задача расходились с
-- первой минуты.
--
-- customer заполняется из справочника (chain.chain + gorizontal.gorizontal по name),
-- но хранится строкой: справочник живёт своей жизнью, а в плане должно остаться то
-- значение, которое выбрали, — даже если запись справочника потом переименуют.
ALTER TABLE app.promo_plan ADD COLUMN IF NOT EXISTS customer varchar(200) NOT NULL DEFAULT '';
ALTER TABLE app.promo_plan ADD COLUMN IF NOT EXISTS link     text         NOT NULL DEFAULT '';
ALTER TABLE app.promo_plan ADD COLUMN IF NOT EXISTS content  text         NOT NULL DEFAULT '';

COMMENT ON COLUMN app.promo_plan.customer IS 'Заказчик: имя из chain.chain / gorizontal.gorizontal';
COMMENT ON COLUMN app.promo_plan.link     IS 'Основная ссылка, на которую ведём получателя';
COMMENT ON COLUMN app.promo_plan.content  IS 'Что учесть в тексте или визуале (поле «Контент» задачи)';
