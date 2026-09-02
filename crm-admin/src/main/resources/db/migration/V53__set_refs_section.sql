-- Ведение справочников значений из настроек: новая секция set-refs.
--
-- Справочники reference.d_communication_name и reference.d_touch_point до сих пор велись
-- только инсертами в psql. Значение в них добавляют не для себя, а для всех: оно сразу
-- появляется в выпадашках мастера коммуникаций. Такое место должно быть в панели, где
-- видно, кто и что менял (adminLog), а не в терминале на сервере.
--
-- Права ПЕРЕНОСИМ от set-objects, а не раздаём заново. Это ближайший сосед по смыслу:
-- кто настраивает данные CRM, тот и ведёт их справочники. Раздать всем подряд нельзя —
-- выключенное значение исчезает из списков у всех сразу; не раздать никому тоже нельзя —
-- панель появилась бы пустой у всех, кроме администратора, и о ней бы не узнали.
--
-- Администратор секцию не получает и не теряет: он обходит матрицу (AccessGuard).
INSERT INTO app.role_section (role_id, section_id, can_read, can_add, can_edit, can_delete)
SELECT rs.role_id, 'set-refs', rs.can_read, rs.can_add, rs.can_edit, rs.can_delete
FROM app.role_section rs
WHERE rs.section_id = 'set-objects' AND rs.can_read
ON CONFLICT DO NOTHING;
