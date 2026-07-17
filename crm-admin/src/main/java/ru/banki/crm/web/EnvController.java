package ru.banki.crm.web;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Среда инстанса: имя (prod/preprod/test) + включены ли dev-разделы. Красит бейдж и NAV фронта. */
@RestController
@RequestMapping("/api")
public class EnvController {

    public record EnvDto(String name, boolean devFeatures) {}

    @Value("${app.env.name:prod}")
    private String envName;

    @Value("${app.features.dev:false}")
    private boolean devFeatures;

    @GetMapping("/env")
    public EnvDto env() {
        return new EnvDto(envName, devFeatures);
    }
}
