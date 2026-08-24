-- Журнал выкаток: кто, что и куда собирался выкатить.
--
-- Пишется в момент, когда человек берёт команду на выкат, а не когда контейнер поднялся:
-- выполняет команду он сам, в терминале, и подтвердить факт мы можем только косвенно —
-- увидев на контуре новую версию. Поэтому запись живёт в двух состояниях: planned, пока
-- версия не сменилась, и done, когда панель увидела на цели ожидаемый коммит.
--
-- Ценность журнала не в «нажали кнопку», а в ответе на вопрос «почему на препроде это
-- есть, а на проде нет»: видно, кто, когда и до какого коммита катил.
CREATE TABLE IF NOT EXISTS app.deploy_log (
    id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_env    text        NOT NULL,          -- откуда берём версию: test / preprod
    target_env    text        NOT NULL,          -- куда катим: preprod / prod
    to_commit     text        NOT NULL,          -- полный хеш среза, до которого катим
    to_subject    text        NOT NULL DEFAULT '',
    from_commit   text        NOT NULL DEFAULT '',   -- что стояло на цели в момент выката
    commits       integer     NOT NULL DEFAULT 0,    -- сколько коммитов в срезе
    migrations    integer     NOT NULL DEFAULT 0,    -- сколько из них тянут миграции
    status        text        NOT NULL DEFAULT 'planned',   -- planned / done / cancelled
    actor         text,
    note          text        NOT NULL DEFAULT '',
    timestamp_cr  timestamptz NOT NULL DEFAULT now(),
    timestamp_upd timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_deploy_log_ts ON app.deploy_log (timestamp_cr DESC);
