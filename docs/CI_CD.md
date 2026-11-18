# Проверки изменений PetCare

GitHub Actions запускает проверку Python 3.12 при каждом push, при открытии и обновлении pull request, а также вручную. Проверяются зависимости, синтаксис Python и тесты приложения; отчёт тестов доступен в Actions.

## Проверка перед отправкой кода

Один раз установите Node.js 22.12+, Python 3.12 и зависимости в виртуальное окружение:

```sh
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r app/requirements.txt
npm ci
```

Создайте отдельную PostgreSQL базу для тестов и задайте `TEST_DATABASE_URL` в окружении (не рабочую базу). Учётной записи нужны права создавать схемы:

```sh
export TEST_DATABASE_URL='postgresql+psycopg://petcare:LOCAL_PASSWORD@127.0.0.1:5432/petcare_test'
```

Перед `git push` запускайте:

```sh
source .venv/bin/activate
bash scripts/check.sh
```

Скрипт выполняет npm install по lock-файлу, React Hooks lint, frontend unit-тесты, проверку TypeScript и Vite production build, затем применяет Alembic к выделенной тестовой базе; pytest создаёт в ней отдельную случайную схему и удаляет её после тестов. API, импорт SQLite и браузерный CI проверяются на PostgreSQL 17. Подробности переноса и восстановления: [POSTGRESQL.md](POSTGRESQL.md). GitHub Actions не может запускаться до отправки кода на GitHub, поэтому для проверки до push нужна локальная команда. Для автоматического запуска можно установить локальный Git pre-push hook, учитывая, что он действует только в конкретном клоне и может быть обойдён разработчиком:

```sh
cat > .git/hooks/pre-push <<'HOOK'
#!/usr/bin/env bash
set -e
source .venv/bin/activate
bash scripts/check.sh
HOOK
chmod +x .git/hooks/pre-push
```

Если `.git/hooks/pre-push` уже существует, сначала сохраните его и объедините команды вручную. Каждому участнику нужно настроить hook самостоятельно.

## Общая ветка

Работайте в отдельных ветках и открывайте pull request в `main`. Для `main` включено правило защиты с обязательной проверкой `Tests (Python 3.12)`, актуальностью ветки и запретом административного обхода. Ручное одобрение не требуется. Настройка действует на публичном репозитории. Подробнее: [защищённые ветки GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

Автоматическая публикация на хостинг в этом workflow не настроена. Dependabot предлагает обновления Python-зависимостей и GitHub Actions отдельными pull request.


## Автоматическое слияние (настроено 16.11.2026)

Репозиторий публичный, Allow auto-merge включён. Для main требуется PR и успешная проверка `Tests (Python 3.12)` на актуальной ветке; административный обход, force-push и удаление main запрещены. Одобрение ревьюера не обязательно.

Workflow `.github/workflows/auto-merge.yml` автоматически включает squash auto-merge для новых, повторно открытых, обновлённых и переведённых из draft PR из веток этого же репозитория в main. PR из внешних forks требуют отдельного решения сопровождающего. Уже открытые PR не включаются автоматически задним числом, но обновление их ветки запустит workflow.

Workflow использует pull_request_target только для метаданных: не скачивает и не исполняет код PR. Токен GitHub существует только на время задания; дополнительных секретов и платного сервиса нет. Перед командой проверяются свежие метаданные и точный SHA ветки. Если ветка отстаёт от main, её нужно обновить и дождаться новых тестов. Включённое auto-merge не обходит правила ветки.

Слияние в GitHub не означает автоматическую загрузку изменений на REG.RU.

Структура frontend и доставка готовой сборки на Python-хостинг описаны в [FRONTEND.md](FRONTEND.md). GitHub сохраняет сборку артефактом `frontend-build`.

Проверки безопасности: полный `pytest app`, реальное разделение DB-ролей, зашифрованный backup и повторное восстановление, секреты в отслеживаемых файлах, CSP и серверные запреты роли просмотра. В GitHub API job устанавливает PostgreSQL client 17 из официального PGDG-репозитория с проверкой fingerprint ключа и restic и требует выполнения backup-тестов; отсутствие инструмента не считается успешной проверкой. Настройки production и offsite — [SECURITY.md](SECURITY.md).
