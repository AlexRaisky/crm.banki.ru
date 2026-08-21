# Развёртывание на сервере

Панель разворачивается целиком одним docker compose: три контура (prod / preprod / test)
со своими PostgreSQL + nginx, который вешает **домен только на прод**. Preprod и test
наружу не публикуются — доступ к ним только с самого сервера или по SSH-туннелю.

## Что нужно на сервере

- Linux с Docker Engine + docker compose plugin (`docker compose version` ≥ 2.20);
- открытый порт 80 (и 443, если будет TLS);
- git-доступ к репозиторию.

## Шаги

```bash
# 1. Код
git clone -b admin-panel https://github.com/AlexRaisky/crm.banki.ru.git
cd crm.banki.ru/crm-admin

# 2. Конфиг
cp .env.example .env
nano .env
```

В `.env` обязательно поменять/задать (без комментариев после значений!):

| Переменная | Что ставить |
|---|---|
| `DB_PASSWORD` | свой пароль БД |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | почта и пароль первого администратора (см. ниже) |
| `REMEMBER_ME_KEY` | случайная длинная строка |
| `APP_BIND` | `127.0.0.1` — приложения наружу не торчат, домен идёт через nginx |
| `APP_EMAIL_DOMAIN` | домен корпоративной почты (напр. `banki.ru`), пусто = любой |

```bash
# 3. Домен в конфиге nginx (по желанию, работает и с server_name _)
nano nginx/crm-admin.conf     # server_name crm.banki.ru;

# 4. Запуск всех контуров + nginx
docker compose -f docker-compose.yml -f docker-compose.server.yml up -d --build

# 5. Проверка
docker compose ps                      # все контейнеры Up
curl -s http://localhost/nginx-health  # ok
curl -sI http://localhost/login | head -1   # HTTP/1.1 200
```

Домен → прод. Preprod/test с рабочей машины: `ssh -L 8081:127.0.0.1:8081 -L 8082:127.0.0.1:8082 user@server`, затем `http://localhost:8081` / `:8082`.

## Первый админ

Ничего руками создавать не нужно: при **первом старте каждого контура** приложение само
создаёт супер-админов из `.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`, пароль хранится BCrypt).
`ADMIN_EMAIL` принимает несколько адресов через запятую — держите как минимум двоих:
свою учётку супер-админ отключить не может, это делает второй.
Логинишься этой парой → раздел «Управление доступом» → заводишь остальных пользователей
(роль READER/EDITOR/ADMIN + разделы). Если админ уже существует, при старте ничего не
перезаписывается; сменить пароль можно из UI.

## Обновление версии

```bash
cd crm.banki.ru/crm-admin && git pull
# сначала test:
docker compose -f docker-compose.yml -f docker-compose.server.yml build app-prod
docker compose -f docker-compose.yml -f docker-compose.server.yml up -d --no-deps app-test
# проверили test → катим дальше:
docker compose -f docker-compose.yml -f docker-compose.server.yml up -d --no-deps app-preprod app-prod
```

Миграции БД (Flyway) накатываются автоматически при старте контейнера.

## TLS (когда появится сертификат)

Положить серты в `nginx/certs/`, добавить в `nginx/crm-admin.conf` блок
`listen 443 ssl; ssl_certificate ...;` и редирект с 80, раскомментировать `443:443`
в `docker-compose.server.yml`. CSRF в приложении сейчас отключён — перед публикацией
наружу за пределы корпоративной сети его стоит включить (известный follow-up).

## Бэкапы

Данные живут в docker volume'ах `crm_db_data` (prod), `crm_db_preprod`, `crm_db_test`:

```bash
docker exec crm-admin-db-prod pg_dump -U crm crm | gzip > backup_prod_$(date +%F).sql.gz
```
