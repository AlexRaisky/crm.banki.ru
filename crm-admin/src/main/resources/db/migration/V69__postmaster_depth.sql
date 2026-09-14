-- Постмастеры: глубина загрузки задаётся настройкой, а не зашита в код.
--
-- Было три зашитых окна: трое суток у проверки связи, тридцать дней у кнопки в
-- разделе, неделя у ночной задачи. Историю глубже месяца дотянуть было нечем, а
-- сколько её вообще отдают постмастеры, заранее неизвестно: Google срок хранения
-- не публикует, у Mail.ru он свой. Поэтому лимит — наш, с запасом, а вернётся
-- столько, сколько у них есть.
--
--   history_days — на сколько назад тянуть при полной загрузке («Загрузить всю
--                  историю» и первый ночной запуск по системе без данных);
--   daily_days   — окно ночного обновления. Шире одних суток намеренно:
--                  пропущенный из-за недоступности день подхватится следующим разом.
ALTER TABLE app.postmaster_connection
    ADD COLUMN IF NOT EXISTS history_days smallint NOT NULL DEFAULT 400,
    ADD COLUMN IF NOT EXISTS daily_days   smallint NOT NULL DEFAULT 7;

ALTER TABLE app.postmaster_connection DROP CONSTRAINT IF EXISTS chk_postmaster_depth;
ALTER TABLE app.postmaster_connection
    ADD CONSTRAINT chk_postmaster_depth
    CHECK (history_days BETWEEN 1 AND 3650 AND daily_days BETWEEN 1 AND 365);
