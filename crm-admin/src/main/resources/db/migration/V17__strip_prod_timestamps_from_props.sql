-- Первые прогоны ETL складывали служебные метки прод-таблиц (timestamp_cr/timestamp_upd)
-- в channel_props как обычные канальные поля. Это вредно: при синке «мы -> прод» такая
-- метка уехала бы обратно и затёрла настоящую, сломав отслеживание изменений.
-- Метки — бухгалтерия прода: у себя не храним, наружу не отправляем, при записи прод
-- проставляет их сам (см. ProdDbService.insert/update, TemplateStore.PROD_TIMESTAMPS).
UPDATE template.d_template
   SET channel_props = channel_props - 'timestamp_cr' - 'timestamp_upd'
 WHERE channel_props ?| array['timestamp_cr', 'timestamp_upd'];
