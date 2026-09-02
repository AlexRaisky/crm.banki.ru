-- Очередь выкатов для обработчика на хосте.
--
-- Панель живёт в контейнере: docker ей недоступен и доступен быть не должен — сокет
-- хоста в контейнере равен root на сервере. Поэтому кнопка «катить» не выполняет выкат,
-- а ставит задание; выполняет его скрипт на самом сервере (scripts/deploy-runner.sh,
-- запускается systemd-таймером). Панель прав не получает, обработчик умеет ровно одно:
-- выкатить контур до коммита.
--
-- Отдельную таблицу не заводим: запись выката уже есть в app.deploy_log, и «кто и до
-- какой правки собирался катить» и «чем это кончилось» — про одно и то же событие.
-- Разведи их по двум таблицам, и первым же вопросом станет «а это та же выкатка или
-- другая».

ALTER TABLE app.deploy_log
    -- queued: ждёт обработчика; running: занято им; done/failed: отработано.
    -- NULL означает старую запись, сделанную до появления обработчика, — такие катили
    -- руками, и притворяться, что они прошли через очередь, незачем.
    ADD COLUMN IF NOT EXISTS run_status      text,
    ADD COLUMN IF NOT EXISTS run_started_at  timestamptz,
    ADD COLUMN IF NOT EXISTS run_finished_at timestamptz,
    -- хвост вывода: ошибку выката надо видеть в панели, а не только в терминале
    ADD COLUMN IF NOT EXISTS run_output      text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS run_by          text;

COMMENT ON COLUMN app.deploy_log.run_status IS 'queued | running | done | failed; NULL — катили руками, до появления обработчика';
COMMENT ON COLUMN app.deploy_log.run_output IS 'Хвост вывода обработчика: чем закончилось';

-- Обработчик берёт задания строго по одному и в порядке появления.
CREATE INDEX IF NOT EXISTS ix_deploy_log_run_queue
    ON app.deploy_log (run_status, id) WHERE run_status IN ('queued', 'running');

-- Отметка «обработчик жив».
--
-- Без неё худший сценарий выглядит как норма: обработчик не поставлен или остановлен,
-- задания копятся, кнопка нажимается — и ничего не происходит. Он отмечается при каждом
-- запуске, панель показывает, когда он выходил на связь в последний раз.
CREATE TABLE IF NOT EXISTS app.deploy_runner (
    id           bigint      PRIMARY KEY DEFAULT 1,
    last_seen_at timestamptz,
    host         text        NOT NULL DEFAULT '',
    version      text        NOT NULL DEFAULT '',
    note         text        NOT NULL DEFAULT '',
    CONSTRAINT chk_deploy_runner_single_row CHECK (id = 1)
);

INSERT INTO app.deploy_runner (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE app.deploy_runner IS 'Обработчик очереди выкатов на хосте: когда последний раз выходил на связь';
