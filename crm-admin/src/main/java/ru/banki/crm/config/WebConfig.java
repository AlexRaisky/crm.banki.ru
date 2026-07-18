package ru.banki.crm.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * MVC-мелочи. Spring сам не отдаёт index.html для подкаталогов статики,
 * поэтому «красивый» адрес настроечной админки /settings форвардим на её файл.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addViewController("/settings").setViewName("forward:/settings/index.html");
        registry.addViewController("/settings/").setViewName("forward:/settings/index.html");
    }

    /** Программные транзакции для обработчика очереди прод-синка. */
    @Bean
    public TransactionTemplate transactionTemplate(PlatformTransactionManager tm) {
        return new TransactionTemplate(tm);
    }
}
