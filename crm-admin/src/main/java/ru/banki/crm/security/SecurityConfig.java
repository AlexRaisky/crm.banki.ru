package ru.banki.crm.security;

import jakarta.servlet.http.HttpServletResponse;
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
            .logout(out -> out
                .logoutUrl("/logout")
                .logoutSuccessHandler((req, res, a) -> res.setStatus(HttpServletResponse.SC_OK))
            )
            // XHR to /api/** gets a clean 401; browser navigations fall through to the login page.
            .exceptionHandling(ex -> ex
                .defaultAuthenticationEntryPointFor(
                        new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED),
                        request -> {
                            String p = request.getRequestURI();
                            return p.startsWith("/api/");
                        })
            );
        return http.build();
    }
}
