# Проверки изменений PetCare

GitHub Actions запускает проверку Python 3.12 при каждом push, при открытии и обновлении pull request, а также вручную. Проверяются зависимости, синтаксис Python и тесты приложения; отчёт тестов доступен в Actions.

## Проверка перед отправкой кода

Один раз установите Python 3.12 и зависимости в виртуальное окружение:

```sh
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r app/requirements.txt
```

Перед `git push` запускайте:

```sh
source .venv/bin/activate
bash scripts/check.sh
```

Скрипт использует отдельную временную базу и удаляет её после тестов. GitHub Actions не может запускаться до отправки кода на GitHub, поэтому для проверки до push нужна локальная команда. Для автоматического запуска можно установить локальный Git pre-push hook, учитывая, что он действует только в конкретном клоне и может быть обойдён разработчиком:

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

Работайте в отдельных ветках и открывайте pull request в `main`. Владелец репозитория должен включить защиту `main` в Settings → Rules → Rulesets: требовать pull request, прохождение `Tests (Python 3.12)` и при необходимости одобрение другого участника; ограничить прямой push и обход правила. Доступность настроек для приватного репозитория зависит от тарифа GitHub. До включения защиты проверка автоматически запускается, но GitHub не запрещает слияние при её ошибке. Подробнее: [защищённые ветки GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

Автоматическая публикация на хостинг в этом workflow не настроена. Dependabot предлагает обновления Python-зависимостей и GitHub Actions отдельными pull request.
