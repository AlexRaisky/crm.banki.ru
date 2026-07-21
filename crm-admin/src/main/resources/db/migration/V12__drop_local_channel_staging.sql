-- Выпил локальных staging-копий канальных прод-таблиц (создавались в V1).
-- Приложение работает только с template.d_template; на эти таблицы больше ничто
-- не завязано — мёртвый JPA-код и UPDATE-ноп в applyProdCode удалены отдельным коммитом.
--
-- Важно: это НАШ app-DB. Внешняя прод-БД (PROD_DB_URL) сюда не относится — там Flyway
-- выключен, реальные notice.*/callcenter.* НЕ затрагиваются (пишем в них только через
-- ProdDbService по отдельному соединению).
--
-- CASCADE снимает вместе с таблицами их секвенции (*_id_seq) и аудит-триггеры (trg_audit_*).
-- Функция arch.log_change() и таблица arch.arch_log живут в схеме arch и остаются на месте.
-- Схему retention тоже не трогаем.
DROP TABLE IF EXISTS notice.push_template          CASCADE;
DROP TABLE IF EXISTS notice.email_template         CASCADE;
DROP TABLE IF EXISTS notice.d_com_sms_template     CASCADE;
DROP TABLE IF EXISTS callcenter.d_segment_properties CASCADE;

DROP SCHEMA IF EXISTS notice     CASCADE;
DROP SCHEMA IF EXISTS callcenter CASCADE;
