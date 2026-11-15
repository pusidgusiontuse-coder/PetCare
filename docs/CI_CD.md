# CI/CD PetCare: GitHub → REG.RU / ispmanager

## Что запускается

`PetCare CI/CD` проверяет каждый PR и push в main под Python 3.12: зависимости,
синтаксис Python/Bash, тесты упаковки, существующие тесты API и безопасности.
После тестов собирается архив исходников с проверенными SHA-256 файлами OCR.
Архив и JUnit-отчёт доступны в Actions. Зависимости и Actions обновляет Dependabot.

На main после сборки выполняется деплой, если repository variable
`DEPLOY_ENABLED=true`. Пока переменная отсутствует, работают только CI и сборка.
Ручной Run workflow также проходит тесты и сборку; деплой разрешён только с main.
Для отката через CI сделайте revert проблемного PR и влейте его в main.

## Настройки действующего сайта naumenkoilia.ru

В workflow уже заданы значения по умолчанию:

| Параметр | Значение |
| --- | --- |
| SSH_HOST | server15.hosting.reg.ru |
| SSH_USER | u3340622 |
| SSH_PORT | 22 — требует подтверждения |
| SITE_URL | https://naumenkoilia.ru |
| DEPLOY_ROOT | /var/www/u3340622/data/petcare-regru |
| PUBLIC_DIR | /var/www/u3340622/data/www/naumenkoilia.ru |
| HOST_PYTHON | /var/www/u3340622/data/petcare-regru/.venv/bin/python |

Secrets/variables из следующих разделов позволяют переопределить значения.
SSH_HOST и SSH_USER можно не добавлять в Secrets, если эти адреса верны.
Путь HOST_PYTHON взят из существующего окружения; версию Python ещё нужно
проверить на сервере. Старое окружение нельзя удалять: оно запускает установщик.

Для **существующей установки** не переносите data и .env. Скопируйте скрипт
`scripts/prepare_existing.py` из этой ветки на сервер, затем выполните:

```sh
/var/www/u3340622/data/petcare-regru/.venv/bin/python /ПУТЬ/К/prepare_existing.py --root /var/www/u3340622/data/petcare-regru
```

Скрипт проверяет наличие рабочей базы и .env, делает согласованную SQLite-копию
с проверкой целостности в `backups/before-cicd-*.db`, затем создаёт ссылки
`shared/data → ../data` и `shared/.env → ../app/.env` (абсолютные цели).
Существующие исходники, базу, окружение и публичный dispatcher не перемещает.
Повторный запуск допустим; при конфликте с уже существующим shared отказывается
перезаписывать его. Старое приложение и новые релизы используют одну базу.

После первого успешного деплоя замените старую запись cron уведомлений:

```cron
* * * * * /var/www/u3340622/data/petcare-regru/current/.venv/bin/python /var/www/u3340622/data/petcare-regru/current/app/notifications.py
```

Не добавляйте второй параллельный cron. Старые `app/`, `data/` и `.venv/`
сохраняются: на них ссылаются shared и HOST_PYTHON.

Проверка из среды Codex 15 ноября 2026: SSH на порту 22 завершился тайм-аутом
до приветствия сервера. Порт и доступность SSH необходимо подтвердить в REG.RU;
это не подтверждает, что порт закрыт для всех клиентов. Серверные команды,
подготовка shared и реальный деплой пока не выполнялись.

## Однократная подготовка хостинга

Нужны SSH, Python 3.12 с venv/pip, Bash, curl, tar, sha256sum, realpath, flock,
доступ в интернет для pip. Команды выполняются от владельца сайта, без root.
Passenger должен быть настроен в ispmanager на публичную папку домена,
где будет `passenger_wsgi.py`. HTTPS должен уже работать.

Выберите приватную папку вне document root, например `/var/www/USER/data/petcare`.
Схема:

```
petcare/
  shared/.env             # постоянные секреты, chmod 600
  shared/data/petcare.db   # постоянная база и резервные копии
  releases/<sha-run-attempt>/
  incoming/<sha-run-attempt>/
  backups/                # предыдущие Passenger dispatchers
  current -> releases/<sha-run-attempt>
```

Для новой структуры (если не используется описанное выше подключение существующей установки)
создайте `shared/data` с правами 700 и перенесите существующие `.env` и data
из старого приложения. Сначала сделайте согласованную копию SQLite через
`backup.py`, остановив записи при переносе рабочей базы. Не переносите активную
SQLite обычным cp без остановки приложения. Сохраните старый dispatcher отдельно.
При первом запуске создайте `.env` по `app/.env.example`, задайте случайный
SECRET_KEY длиной от 32 символов и `ENABLE_DEMO_LOGIN=false`.
Пайплайн не создаёт администратора и не присылает секреты на GitHub.

Поддерживается стандартная SQLite `shared/data/petcare.db`. Не задавайте
`DATABASE_URL` в .env: установщик резервирует именно стандартную базу.
Публичная папка должна существовать; старые index.html/index.php надо заранее
сохранить и убрать. Размещение приватной папки внутри публичной запрещено.

Создайте отдельный SSH-ключ для Actions, добавьте публичную часть в
`~/.ssh/authorized_keys` владельца сайта. Приватную часть сохраните только
в GitHub Secret. Ключ хоста для known_hosts получите и сверьте через доверенный
канал (панель хостинга/администратор), а не слепым ssh-keyscan в workflow.
При нестандартном порте known_hosts должен содержать `[host]:port`.

## Настройки GitHub

В Settings → Environments создайте `production`, разрешите deployment только
из main. В приватном репозитории доступность environments зависит от тарифа.
Если environment недоступен, можно использовать repository secrets/variables,
убрав блок `environment` из workflow; это отдельное осознанное изменение.

Secrets в production:

| Имя | Значение |
| --- | --- |
| SSH_HOST | адрес сервера |
| SSH_USER | пользователь сайта |
| SSH_PRIVATE_KEY | отдельный приватный ключ без passphrase |
| SSH_KNOWN_HOSTS | проверенная строка known_hosts |

Variables в production:

| Имя | Значение |
| --- | --- |
| SSH_PORT | 22 или порт хостинга |
| DEPLOY_ROOT | абсолютный приватный путь petcare |
| PUBLIC_DIR | абсолютная публичная папка домена |
| SITE_URL | https://ваш-домен без завершающего / |
| HOST_PYTHON | /opt/python/python-3.12/bin/python или реальный путь |

**DEPLOY_ENABLED** задайте как repository variable после подготовки сервера.
Она намеренно не environment variable: условие job проверяется до входа в environment.
Пути в этой конфигурации допускают латинские буквы, цифры, `_`, `-`, `.`, `/`.

Для команды включите ruleset на main: pull request, минимум одно одобрение,
сброс одобрения после новых коммитов, обязательные проверки
`Tests (Python 3.12)` и `Build release`, запрет force push и удаления ветки.
Права на secrets, environments и rulesets нужны администратору репозитория.
У текущего подключённого GitHub-аккаунта есть push, но нет admin.

## Обновление и восстановление

Каждый релиз получает собственный venv. Установщик резервирует базу до миграций,
сохраняет VAPID и импортирует приложение. После подготовки атомарно заменяется
Passenger dispatcher, создаётся `tmp/restart.txt`. Healthcheck ожидает SHA именно
нового релиза, поэтому ответ старого процесса не считается успешным деплоем.
Деплои сериализованы GitHub concurrency и серверным flock.

При ошибке активации восстанавливается предыдущий dispatcher и запрашивается
перезапуск Passenger. Данные автоматически назад не откатываются: это могло бы
стереть новые записи пользователей. Миграции должны быть обратно совместимы.
Ошибки до активации оставляют работающий dispatcher на месте, но не отменяют
уже выполненные миграции. Резервные копии находятся в shared/data/before-update-*.
Перед ручным восстановлением БД остановите веб-процессы и cron и сохраните
текущую базу. После восстановления проверьте вход, питомцев и запись данных.

Уведомления: добавьте cron раз в минуту с постоянным путём:
`DEPLOY_ROOT/current/.venv/bin/python DEPLOY_ROOT/current/app/notifications.py`.
Первый current появляется только после успешного healthcheck.

Старые релизы, загрузки и backup не удаляются автоматически. Настройте внешнее
резервирование и периодическую очистку после проверки, сохраняя текущий релиз,
предыдущий рабочий релиз и необходимые копии БД. При нехватке диска деплой упадёт.
Внешний uptime-мониторинг и SMTP настраиваются отдельно в хостинге.

## Проверка перед включением

Сначала выполните workflow с DEPLOY_ENABLED выключенным. Затем подготовьте
сервер и secrets, включите переменную и запустите workflow с main. Убедитесь,
что healthcheck возвращает ожидаемый SHA, вход работает, данные переживают
следующий деплой, cron выполняется. До успешного реального прогона подключение
CD к вашему хостингу не считается проверенным.

Документация: [GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments),
[Passenger restart](https://www.phusionpassenger.com/library/admin/apache/restart_app.html).
