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
import org.springframework.http.HttpStatus;

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

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(PUBLIC).permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers("/settings/**").hasRole("ADMIN")   // настроечная админка — только админам
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
