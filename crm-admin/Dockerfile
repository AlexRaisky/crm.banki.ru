# ---- build stage ----
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
# Prime the dependency cache (best-effort; won't fail the build if some plugins can't go offline).
COPY pom.xml .
RUN mvn -B -q dependency:resolve dependency:resolve-plugins || true
COPY src ./src
RUN mvn -B clean package -DskipTests

# ---- runtime stage ----
FROM eclipse-temurin:21-jre
WORKDIR /app
RUN groupadd -r app && useradd -r -g app app
COPY --from=build /build/target/crm-admin.jar /app/app.jar
USER app
EXPOSE 8080
# После OutOfMemoryError JVM продолжает работать, но состояние приложения уже не то:
# половина потоков умерла, половина висит, а снаружи это выглядит как «панель
# странно себя ведёт». Пусть падает сразу — контейнер поднимет restart-политика.
ENTRYPOINT ["java","-XX:+ExitOnOutOfMemoryError","-jar","/app/app.jar"]
