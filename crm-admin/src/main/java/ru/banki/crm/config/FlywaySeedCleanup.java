package ru.banki.crm.config;

import org.flywaydb.core.Flyway;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;

/**
 * Одноразовая зачистка записей о dev-сидах (V900/V901) перед миграцией.
 *
 * <p>Сиды лежали в {@code db/seed} и наполняли {@code notice.*}/{@code callcenter.*}. Эти
 * таблицы удаляет V12, поэтому на ЧИСТОМ томе Flyway шёл по возрастанию версии, V900
 * (900 &gt; 24) выполнялся последним и падал с «relation notice.push_template does not
 * exist» — приложение не стартовало. Локацию {@code db/seed} убрали, но на уже поднятых
 * контурах сиды записаны в истории, и Flyway начинал валиться уже на валидации:
 * «Detected applied migration not resolved locally: 900».
 *
 * <p>Штатное лекарство — {@code flyway repair}, а шаблон {@code *:missing} для
 * {@code ignoreMigrationPatterns} доступен только в платной редакции. Поэтому убираем
 * ровно две строки истории сами: точечно, вместо {@code repair()}, который заодно
 * переписал бы контрольные суммы всех миграций и замаскировал бы случайную правку
 * применённого файла.
 *
 * <p>Идемпотентно: на чистой БД таблицы истории ещё нет, на вычищенной — строк уже нет.
 * Класс можно удалить, когда все контуры (test/preprod/prod) один раз поднимутся с ним.
 */
@Configuration
public class FlywaySeedCleanup {

    private static final Logger log = LoggerFactory.getLogger(FlywaySeedCleanup.class);

    /** Версии выведенных из обращения сидов. */
    private static final String[] SEED_VERSIONS = {"900", "901"};

    @Bean
    public FlywayMigrationStrategy flywayMigrationStrategy() {
        return flyway -> {
            dropSeedHistory(flyway);
            flyway.migrate();
        };
    }

    private void dropSeedHistory(Flyway flyway) {
        DataSource ds = flyway.getConfiguration().getDataSource();
        String schema = flyway.getConfiguration().getDefaultSchema();
        String table = flyway.getConfiguration().getTable();
        if (ds == null || schema == null || table == null) {
            return;
        }
        String qualified = "\"" + schema + "\".\"" + table + "\"";
        try (Connection c = ds.getConnection()) {
            if (!historyExists(c, schema, table)) {
                return;   // чистая БД — истории ещё нет, чистить нечего
            }
            try (PreparedStatement ps = c.prepareStatement(
                    "DELETE FROM " + qualified + " WHERE version = ANY (?)")) {
                ps.setArray(1, c.createArrayOf("text", SEED_VERSIONS));
                int n = ps.executeUpdate();
                if (n > 0) {
                    log.info("Flyway: удалены записи о выведенных из обращения сидах ({} шт.): {}",
                            n, String.join(", ", SEED_VERSIONS));
                }
            }
        } catch (Exception e) {
            // Не валим старт: если зачистка не удалась, Flyway сам скажет, что не так.
            log.warn("Flyway: не удалось вычистить записи о сидах: {}", e.getMessage());
        }
    }

    private boolean historyExists(Connection c, String schema, String table) throws Exception {
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT to_regclass(?) IS NOT NULL")) {
            ps.setString(1, schema + "." + table);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() && rs.getBoolean(1);
            }
        }
    }
}
