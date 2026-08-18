package ru.banki.crm.security;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;
import ru.banki.crm.service.Sections;

import java.util.Set;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    // Public endpoints: the login page + its helper assets, health, and the login/logout actions.
    private static final String[] PUBLIC = {
            "/login.html", "/api/login", "/logout", "/favicon.ico", "/error"
    };

    /** Секретный ключ для подписи remember-me токена. Стабильный между рестартами → кука переживает перезапуск. */
    @Value("${app.remember-me.key:crm-admin-remember-me-key-change-me}")
    private String rememberKey;

    /** Срок жизни remember-me куки, дней. */
    @Value("${app.remember-me.days:30}")
    private int rememberDays;

    /** Имена кук — свои на среду (prod/preprod/test на одном хосте не затирают друг друга). */
    @Value("${app.remember-me.cookie-name:crm-remember}")
    private String rememberCookie;

    @Value("${server.servlet.session.cookie.name:JSESSIONID}")
    private String sessionCookie;

    /** Доступ по ЛЮБОЙ из перечисленных секций (право просмотра). Админ проходит всегда. */
    private static AuthorizationManager<RequestAuthorizationContext> section(String... sectionIds) {
        return (auth, ctx) -> new AuthorizationDecision(allowed(auth.get(), Set.of(sectionIds)));
    }

    /** Доступ, если есть хоть одна секция настроечной админки. */
    private static AuthorizationManager<RequestAuthorizationContext> anySettings() {
        return (auth, ctx) -> new AuthorizationDecision(allowed(auth.get(), Sections.SETTINGS));
    }

    /**
     * Чтение модели схемы: перечисленные секции ИЛИ доступ к любой отдельной сущности.
     * <p>
     * Сущности выдаются поштучно (ent:client), и зонтичной секции entities у такой роли
     * может не быть вовсе. Без этой ветки роль с одной выданной сущностью получала бы
     * 403 на самой модели — а из неё строится всё: подразделы, колонки, карточки. Раздел
     * просто исчезал бы из меню, ничего не сообщая.
     */
    private static AuthorizationManager<RequestAuthorizationContext> schemaRead(String... sectionIds) {
        return (auth, ctx) -> new AuthorizationDecision(
                allowed(auth.get(), Set.of(sectionIds)) || hasEntitySection(auth.get()));
    }

    private static boolean hasEntitySection(Authentication a) {
        return a != null && a.isAuthenticated()
                && a.getPrincipal() instanceof AppUserPrincipal p
                && p.sections().stream().anyMatch(Sections::isEntity);
    }

    private static boolean allowed(Authentication a, Set<String> sectionIds) {
        if (a == null || !a.isAuthenticated()) {
            return false;
        }
        // админ обходит матрицу — иначе разделы, добавленные после создания учётки,
        // были бы недоступны и ему (то же правило, что в AccessGuard)
        boolean admin = a.getAuthorities().stream()
                .anyMatch(g -> "ROLE_ADMIN".equals(g.getAuthority()));
        if (admin) {
            return true;
        }
        return a.getPrincipal() instanceof AppUserPrincipal p
                && p.sections().stream().anyMatch(sectionIds::contains);
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(PUBLIC).permitAll()
                /* Настроечная админка раздаётся ПОШТУЧНО: панель = секция матрицы прав.
                   Правила идут от частного к общему, и последним стоит админский
                   запасной вариант: любая ручка под /api/admin, которую здесь забыли
                   перечислить, остаётся доступной только администратору. Забыть и молча
                   открыть эндпоинт всем — так нельзя. */
                .requestMatchers("/api/admin/db-connections/**").access(section(Sections.SET_DBCONN))
                .requestMatchers("/api/admin/etl/**", "/api/admin/prod-db/**").access(section(Sections.SET_SYNC))
                .requestMatchers("/api/admin/users/**", "/api/admin/roles/**",
                                 "/api/admin/sections").access(section(Sections.ACCESS))
                /* Саму МОДЕЛЬ схемы читает не только конструктор в настройках, но и
                   раздел «Сущности» в панели: из неё он строит подразделы, колонки
                   списков и поля карточек. Закрыв её настроечными секциями, мы отняли
                   раздел у всех, кому выдали entities, — и он молча исчезал из меню,
                   потому что группа прячется, когда у неё не осталось подразделов.
                   Всё остальное под /api/schema (структура базы, версии, аудит, запись
                   и DDL) остаётся за настройками. */
                .requestMatchers(HttpMethod.GET, "/api/schema").access(schemaRead(Sections.ENTITIES,
                        Sections.SET_SCHEME, Sections.SET_OBJECTS, Sections.SET_DBTREE))
                .requestMatchers("/api/schema/**").access(section(Sections.SET_SCHEME, Sections.SET_OBJECTS,
                                                                 Sections.SET_DBTREE))
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                /* Сама страница /settings данных не содержит — это оболочка, каждая её
                   панель ходит за своими данными и проверяется отдельно. Пускаем всех, у
                   кого есть хоть одна секция настроек. */
                /* Описание схемы — запасной источник модели для раздела «Сущности»,
                   когда API недоступен. Секретов в нём нет, а лежит он под /settings,
                   куда не-админа не пускают: без этого исключения запасной путь для
                   него всегда упирался бы в 403. */
                .requestMatchers(HttpMethod.GET, "/settings/schema/**").authenticated()
                .requestMatchers("/settings/**").access(anySettings())
                .anyRequest().authenticated()
            )
            // Session-cookie SPA. CSRF is disabled for now (internal tool behind auth);
            // re-enable with a CookieCsrfTokenRepository + token header in api.js before exposing externally.
            .csrf(csrf -> csrf.disable())
            .formLogin(form -> form
                .loginPage("/login.html")
                .loginProcessingUrl("/api/login")
                .usernameParameter("email")
                .passwordParameter("password")
                .successHandler((req, res, a) -> res.setStatus(HttpServletResponse.SC_OK))
                .failureHandler((req, res, e) -> res.sendError(HttpServletResponse.SC_UNAUTHORIZED))
                .permitAll()
            )
            // Постоянная кука-токен: автоматически переавторизует после таймаута сессии,
            // закрытия браузера и рестарта сервера — пользователь не «вылетает» из ЛК.
            .rememberMe(rm -> rm
                .key(rememberKey)
                .alwaysRemember(true)
                .tokenValiditySeconds(rememberDays * 24 * 60 * 60)
                .rememberMeCookieName(rememberCookie)
            )
            .logout(out -> out
                .logoutUrl("/logout")
                .deleteCookies(rememberCookie, sessionCookie)
                .logoutSuccessHandler((req, res, a) -> res.setStatus(HttpServletResponse.SC_OK))
            )
            // XHR to /api/** gets a clean 401; browser navigations are redirected to the login page.
            // (второй entry point задан явно: без него кастомизация перекрывает дефолт form-login
            // и анонимный заход на / получал голый 401 вместо страницы входа)
            .exceptionHandling(ex -> ex
                .defaultAuthenticationEntryPointFor(
                        new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED),
                        request -> request.getRequestURI().startsWith("/api/"))
                .defaultAuthenticationEntryPointFor(
                        new org.springframework.security.web.authentication.LoginUrlAuthenticationEntryPoint("/login.html"),
                        request -> !request.getRequestURI().startsWith("/api/"))
            );
        return http.build();
    }
}
