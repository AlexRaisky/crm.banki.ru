-- Схема reference становится рабочей для Scheme Builder.
--
-- В V43 она попала в стоп-лист заодно с dictionary — по аналогии, а не по решению.
-- Решение другое: справочники имён коммуникаций и точек касания ведутся руками, и
-- заводить в них поля должно быть можно из панели, а не миграцией на каждое поле.
DELETE FROM app.schema_reserved WHERE schema_name = 'reference';

-- Право трогать объект даёт запись в реестре, а не факт его наличия в базе (см. V31),
-- поэтому саму схему и обе перевезённые таблицы записываем за билдером.
--
-- Строки заводим сразу на три контура: env — метка среды, и каждая база читает только
-- свою («prod» в тестовой базе просто никогда не совпадёт с APP_ENV). Так одна миграция
-- работает во всех трёх, не требуя знать, куда её накатывают.
--
-- NOT EXISTS, а не ON CONFLICT: в UNIQUE (schema_name, table_name, env) запись про саму
-- схему держит NULL в table_name, а NULL не равен NULL — на повторном прогоне ограничение
-- дубль не поймало бы.
INSERT INTO app.schema_owned (schema_name, table_name, env, created_by)
SELECT 'reference', NULL, e.env, 'migration V44'
  FROM (VALUES ('prod'), ('preprod'), ('test')) AS e(env)
 WHERE NOT EXISTS (
     SELECT 1 FROM app.schema_owned o
      WHERE o.schema_name = 'reference' AND o.table_name IS NULL AND o.env = e.env);

INSERT INTO app.schema_owned (schema_name, table_name, env, created_by)
SELECT 'reference', t.tbl, e.env, 'migration V44'
  FROM (VALUES ('d_communication_name'), ('d_touch_point')) AS t(tbl),
       (VALUES ('prod'), ('preprod'), ('test')) AS e(env)
 WHERE to_regclass('reference.' || t.tbl) IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM app.schema_owned o
      WHERE o.schema_name = 'reference' AND o.table_name = t.tbl AND o.env = e.env);
