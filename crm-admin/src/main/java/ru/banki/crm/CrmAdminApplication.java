package ru.banki.crm;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling   // фоновая доставка очереди синка в прод-БД (ProdSyncService)
public class CrmAdminApplication {
    public static void main(String[] args) {
        SpringApplication.run(CrmAdminApplication.class, args);
    }
}
