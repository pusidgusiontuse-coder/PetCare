import base64
import os
import re
import secrets
from datetime import timedelta, date, datetime
from typing import List, Optional
from pathlib import Path
import httpx
from fastapi import FastAPI, Depends, HTTPException, status, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response
from urllib.parse import quote
from uploads import enforce_attachment_quota, validate_attachment
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import or_, select

from settings import ENABLE_DEMO_LOGIN, PRODUCTION
import models
import schemas
from database import engine, get_db
from auth import get_password_hash, verify_password, create_access_token, get_current_user, session_response

# Schema changes are applied explicitly before starting workers.
from schema import check_schema
check_schema(engine)
if PRODUCTION and os.environ.get('MIGRATION_DATABASE_URL'):
    raise RuntimeError('Migration credentials must not be loaded into the web process')
if PRODUCTION or os.getenv('ENFORCE_DB_PERMISSIONS') == 'true':
    from db_security import assert_runtime_permissions
    assert_runtime_permissions(engine)

OPENAPI_TAGS = [
    {
        "name": "Авторизация и профиль",
        "description": "Регистрация, вход по email/паролю, быстрый вход в демо-аккаунты и управление профилем владельца (JWT Bearer).",
    },
    {
        "name": "Питомцы и совместный уход",
        "description": "Создание карточек питомцев, редактирование, удаление и подключение совладельцев по коду совместного ухода.",
    },
    {
        "name": "Здоровье, вес и назначения",
        "description": "Медицинская карта (прививки, обработки, визиты к врачу), динамика веса и курсы приёма препаратов.",
    },
    {
        "name": "Питание и рацион",
        "description": "Ежедневное расписание кормлений (точное время и интервал), дневник кормлений и база оценок кормов.",
    },
    {
        "name": "Уход и напоминания",
        "description": "Напоминания по московскому времени (Europe/Moscow), интервальные повторы (каждые N дней/месяцев), отметка выполнения и перенос.",
    },
    {
        "name": "Документы и ИИ-распознавание",
        "description": "Хранение ветеринарных паспортов, анализов и заключений, а также OCR-распознавание фото документов через LLM Proxy.",
    },
    {
        "name": "Список покупок",
        "description": "Общий список покупок для питомца с отметкой о покупке совладельцами.",
    },
    {
        "name": "Журнал активности",
        "description": "Лента последних действий владельцев и участников совместного ухода.",
    },
    {
        "name": "Знакомства питомцев (Pet Match)",
        "description": "Анкеты для поиска друзей и пар, скоринг совместимости, лайки/пропуски и взаимные симпатии.",
    },
    {
        "name": "Системные маршруты",
        "description": "Проверка работоспособности сервиса (Healthcheck).",
    },
]

app = FastAPI(
    title="PetCare API v1",
    description=(
        "REST API сервиса **PetCare** для комплексной заботы о домашних питомцах.\n\n"
        "### Основные возможности API\n"
        "- **JWT-авторизация** (`Authorization: Bearer <token>`) и мгновенный вход в предзаполненные демо-аккаунты.\n"
        "- **Карточки питомцев и совместный доступ** по уникальному коду (`PET-XXXX-...`).\n"
        "- **Здоровье, вакцинация, вес и назначения** с автоматическим планированием повторных процедур.\n"
        "- **Питание и интервалы кормления** с журналом приёмов пищи и сравнением рационов.\n"
        "- **ИИ-распознавание документов** (`POST /api/v1/documents/recognize`) через LLM Proxy.\n"
        "- **Pet Match** — рекомендательный алгоритм подбора друзей и пар для питомцев."
    ),
    version="1.3.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    openapi_tags=OPENAPI_TAGS,
)

if PRODUCTION:
    from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware
    from starlette.middleware.trustedhost import TrustedHostMiddleware
    allowed_hosts = [host.strip() for host in os.getenv('ALLOWED_HOSTS', '').split(',') if host.strip()]
    if not allowed_hosts or '*' in allowed_hosts:
        raise RuntimeError('Set explicit ALLOWED_HOSTS for production')
    app.add_middleware(HTTPSRedirectMiddleware)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)

from security import SecurityMiddleware
app.add_middleware(SecurityMiddleware, production=PRODUCTION)
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    # Never echo passwords, base64 files or complete request payloads in errors.
    return JSONResponse(status_code=422, content={'detail': [
        {'loc': list(error['loc']), 'msg': error['msg'], 'type': error['type']}
        for error in exc.errors()
    ]})

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_user_pet_or_404(pet_id: int, user_id: int, db: Session, write: bool = False) -> models.Pet:
    pet = db.query(models.Pet).filter(models.Pet.id == pet_id).first()
    if not pet:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Питомец не найден"
        )
    if pet.owner_id != user_id:
        is_member = db.query(models.PetMember).filter(
            models.PetMember.pet_id == pet_id,
            models.PetMember.user_id == user_id
        ).first()
        if not is_member or is_member.role not in {"viewer", "editor", "co_owner"} or (is_member.expires_at and is_member.expires_at <= datetime.utcnow()) or (write and is_member.role not in {"editor", "co_owner"}):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="У вас нет доступа к этому питомцу"
            )
    return pet

def pet_response(pet, user_id, detail=False):
    schema = schemas.PetDetailOut if detail else schemas.PetOut
    result = schema.model_validate(pet)
    if pet.owner_id != user_id:
        result.share_code = None
    return result


def active_member_pet_ids(user_id):
    return select(models.PetMember.pet_id).where(
        models.PetMember.user_id == user_id,
        models.PetMember.role.in_(['viewer', 'editor', 'co_owner']),
        or_(models.PetMember.expires_at.is_(None), models.PetMember.expires_at > datetime.utcnow()),
    )


def user_has_pet_access(pet_id: int, user_id: int, db: Session, write: bool = False) -> bool:
    pet = db.query(models.Pet).filter(models.Pet.id == pet_id).first()
    if not pet:
        return False
    if pet.owner_id == user_id:
        return True
    member = db.query(models.PetMember).filter(models.PetMember.pet_id == pet_id, models.PetMember.user_id == user_id).first()
    return bool(member and member.role in {"viewer", "editor", "co_owner"} and (not member.expires_at or member.expires_at > datetime.utcnow()) and (not write or member.role in {"editor", "co_owner"}))

# =====================================================================
# 1. АВТОРИЗАЦИЯ И СЕССИЯ (/api/v1/auth)
# =====================================================================

@app.post("/api/v1/auth/register", response_model=schemas.TokenResponse, status_code=status.HTTP_201_CREATED, tags=["Авторизация и профиль"], summary="Регистрация нового пользователя")
def register(user_data: schemas.UserRegister, db: Session = Depends(get_db)):
    existing_user = db.query(models.User).filter(models.User.email == user_data.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Пользователь с таким email уже существует")

    new_user = models.User(
        full_name=user_data.full_name,
        email=user_data.email,
        hashed_password=get_password_hash(user_data.password),
        timezone=user_data.timezone
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    token = create_access_token(data={"sub": str(new_user.id)})
    return {"access_token": token, "token_type": "bearer", "user": new_user}


@app.post("/api/v1/auth/login", response_model=schemas.TokenResponse, tags=["Авторизация и профиль"], summary="Вход по email и паролю")
def login(login_data: schemas.UserLogin, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == login_data.email.strip().lower()).first()
    if not user or not verify_password(login_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")

    token = create_access_token(data={"sub": str(user.id)})
    return {"access_token": token, "token_type": "bearer", "user": user}


def seed_demo_account(db: Session, account_id: int) -> models.User:
    """Создаёт и наполняет демонстрационный аккаунт богатыми презентационными данными."""
    is_acc2 = (account_id == 2)
    email = "demo2@petcare.app" if is_acc2 else "demo1@petcare.app"
    legacy_email = "demo2@petcare.local" if is_acc2 else "demo1@petcare.local"
    full_name = "Анна" if is_acc2 else "Илья"

    user = db.query(models.User).filter((models.User.email == email) | (models.User.email == legacy_email)).first()
    if user:
        changed = False
        if user.email == legacy_email:
            user.email = email
            changed = True
        if user.full_name in ["Илья (Демо 1)", "Анна (Демо 2)"]:
            user.full_name = full_name
            changed = True
        if changed:
            db.commit()
            db.refresh(user)

    if not user:
        user = models.User(
            full_name=full_name,
            email=email,
            hashed_password=get_password_hash(secrets.token_urlsafe(32)),
            timezone="Europe/Moscow"
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    existing_pets = db.query(models.Pet).filter(models.Pet.owner_id == user.id).all()
    if len(existing_pets) >= 2:
        return user
    elif len(existing_pets) > 0:
        for p in existing_pets:
            db.delete(p)
        db.commit()

    today_str = date.today().isoformat()
    now_dt = datetime.now()

    if not is_acc2:
        barsik = models.Pet(
            owner_id=user.id,
            name="Барсик",
            species="Кот",
            breed="Британская короткошёрстная",
            birth_date=date(2023, 8, 16),
            sex="Самец",
            sterilized=True,
            microchip_number="643094100001234",
            notes="Любит спать у окна на подушке и наблюдать за птицами",
            marks="Аллергия на курицу (зуд ушей)",
            clinic_url="https://vet-friend.example.ru",
            doctor_name="А. Соколова",
            avatar_bg="lavender",
            avatar_accessory="bow",
            share_code="PET-BARS-8F92-K4M9"
        )
        db.add(barsik)
        db.commit()
        db.refresh(barsik)

        h1 = models.HealthRecord(
            pet_id=barsik.id,
            record_type="vaccination",
            event_date=date(2026, 8, 12),
            title="Комплексная прививка Мультифел-4",
            medicine_name="Мультифел-4",
            clinic="ВетКлиника Друг",
            doctor="А. Соколова",
            result="Перенёс отлично, температура в норме",
            comment="Ежегодная ревакцинация от панлейкопении и ринотрахеита",
            next_date=date(2027, 8, 12)
        )
        h2 = models.HealthRecord(
            pet_id=barsik.id,
            record_type="parasite_treatment",
            event_date=date(2026, 9, 12),
            title="Обработка от паразитов",
            medicine_name="Мильбемакс для кошек",
            comment="Профилактика перед плановой вакцинацией",
            next_date=date(2026, 12, 12)
        )
        h3 = models.HealthRecord(
            pet_id=barsik.id,
            record_type="vet_visit",
            event_date=date(2026, 9, 28),
            title="Плановый осмотр и стоматолог",
            clinic="ВетКлиника Друг",
            doctor="А. Соколова",
            vet_conclusion="Зубы чистые, десны здоровые, прикус правильный"
        )
        db.add_all([h1, h2, h3])

        weights_barsik = [
            models.WeightRecord(pet_id=barsik.id, date=date(2026, 6, 16), kg=4.2),
            models.WeightRecord(pet_id=barsik.id, date=date(2026, 7, 16), kg=4.4),
            models.WeightRecord(pet_id=barsik.id, date=date(2026, 8, 16), kg=4.3),
            models.WeightRecord(pet_id=barsik.id, date=date(2026, 9, 16), kg=4.5),
            models.WeightRecord(pet_id=barsik.id, date=date(2026, 10, 15), kg=4.6),
        ]
        db.add_all(weights_barsik)

        db.add(models.Prescription(
            pet_id=barsik.id,
            name="Витамины Beaphar Top 10",
            dose="1 таблетка в день",
            start_date=date(2026, 10, 1),
            duration="30 дней",
            times="09:00",
            status="Активно"
        ))

        mp1 = models.MealPlan(
            pet_id=barsik.id,
            food="Индейка с тыквой (паштет), 60 г",
            time="08:30",
            notes="Комнатная температура, порция 60 г",
            completed_on=today_str
        )
        mp2 = models.MealPlan(
            pet_id=barsik.id,
            food="Сухой корм Grandorf White Fish, 40 г",
            time="19:30",
            notes="Свежая фильтрованная вода в поилке",
            completed_on=None
        )
        db.add_all([mp1, mp2])
        db.commit()

        db.add(models.FeedingLog(
            pet_id=barsik.id,
            food="Индейка с тыквой (паштет), 60 г",
            amount="60 г",
            notes="Съел всё с удовольствием",
            meal_plan_id=mp1.id,
            completion_day=today_str,
            actor="Илья"
        ))

        db.add_all([
            models.NutritionLog(
                pet_id=barsik.id,
                food_name="Grandorf Белая рыба с рисом",
                brand="Grandorf",
                kind="food",
                date=date(2026, 10, 10),
                liked="yes",
                tolerated="yes",
                price=1450.0,
                notes="Ест охотно, стул и шерсть в идеальном состоянии"
            ),
            models.NutritionLog(
                pet_id=barsik.id,
                food_name="Корм с курицей и печенью",
                brand="Whiskas",
                kind="food",
                date=date(2026, 9, 30),
                liked="yes",
                tolerated="no",
                adverse_reactions="Зуд, расчёсы за ушами",
                price=420.0,
                notes="Появилась аллергическая реакция, курица исключена"
            ),
            models.NutritionLog(
                pet_id=barsik.id,
                food_name="Мясные палочки с лососем",
                brand="Мнямс",
                kind="treat",
                date=date(2026, 10, 14),
                liked="yes",
                tolerated="yes",
                price=190.0,
                notes="Любимое лакомство"
            )
        ])

        db.add_all([
            models.Reminder(
                pet_id=barsik.id,
                title="Приём у ветеринара (плановый чекап)",
                reminder_type="vet_visit",
                due_date=date.today() + timedelta(days=1),
                at=(now_dt + timedelta(days=1)).strftime("%Y-%m-%dT12:00:00+03:00"),
                status="pending"
            ),
            models.Reminder(
                pet_id=barsik.id,
                title="Обработка каплями от блох и клещей",
                reminder_type="procedure",
                due_date=date.today() + timedelta(days=5),
                at=(now_dt + timedelta(days=5)).strftime("%Y-%m-%dT10:00:00+03:00"),
                status="pending",
                interval_days=30
            )
        ])

        db.add_all([
            models.Document(
                pet_id=barsik.id,
                title="Международный ветеринарный паспорт",
                doc_type="passport",
                date=date(2023, 9, 1),
                file_name="barsik_vet_passport.pdf"
            ),
            models.Document(
                pet_id=barsik.id,
                title="Биохимический анализ крови (август)",
                doc_type="conclusion",
                date=date(2026, 8, 15),
                file_name="blood_test_barsik.pdf"
            )
        ])

        db.add_all([
            models.ShoppingItem(pet_id=barsik.id, title="Сухой корм Grandorf 2 кг", quantity="1 уп", is_done=False),
            models.ShoppingItem(pet_id=barsik.id, title="Древесный эко-наполнитель", quantity="15 л", is_done=True, bought_by="Илья"),
            models.ShoppingItem(pet_id=barsik.id, title="Когтеточка из джута угловая", quantity="1 шт", is_done=False)
        ])

        db.add_all([
            models.ActivityLog(pet_id=barsik.id, actor="Илья", action="Покормил Барсика утренней порцией", icon="🍽️"),
            models.ActivityLog(pet_id=barsik.id, actor="Илья", action="Измерил вес: 4.6 кг", icon="⚖️")
        ])

        luna = models.Pet(
            owner_id=user.id,
            name="Луна",
            species="Кошка",
            breed="Метис",
            birth_date=date(2025, 2, 16),
            sex="Самка",
            sterilized=False,
            notes="Очень общительная и игривая, любит запрыгивать на плечи",
            marks="",
            avatar_bg="peach",
            avatar_accessory="none",
            share_code="PET-LUNA-4X91-W7M2"
        )
        db.add(luna)
        db.commit()
        db.refresh(luna)

        db.add(models.HealthRecord(
            pet_id=luna.id,
            record_type="vet_visit",
            event_date=date(2026, 9, 28),
            title="Первичный осмотр котенка",
            clinic="Добрый доктор",
            doctor="А. Соколова",
            vet_conclusion="Развитие соответствует возрасту, здорова"
        ))

        db.add_all([
            models.WeightRecord(pet_id=luna.id, date=date(2026, 8, 16), kg=3.0),
            models.WeightRecord(pet_id=luna.id, date=date(2026, 10, 14), kg=3.2),
        ])

        db.add_all([
            models.MealPlan(pet_id=luna.id, food="Monge Kitten влажный корм, 85 г", time="09:00", notes="Утреннее кормление"),
            models.MealPlan(pet_id=luna.id, food="Monge Kitten влажный корм, 85 г", time="18:30", notes="Вечернее кормление"),
        ])

        db.add(models.Document(
            pet_id=luna.id,
            title="Свидетельство о чипировании и вакцинации",
            doc_type="passport",
            date=date(2025, 5, 20),
            file_name="luna_chip_certificate.pdf"
        ))

    else:
        rex = models.Pet(
            owner_id=user.id,
            name="Рекс",
            species="Собака",
            breed="Немецкая овчарка",
            birth_date=date(2022, 4, 10),
            sex="Самец",
            sterilized=True,
            microchip_number="643094100099881",
            notes="Обучен курсу ОКД, знает все команды. Очень преданный, обожает плавать и бегать за мячом.",
            marks="Чувствительное пищеварение, только беззерновой рацион",
            clinic_url="https://hatiko-vet.example.ru",
            doctor_name="В. М. Белов",
            avatar_bg="mint",
            avatar_accessory="crown",
            share_code="PET-REXX-3F88-P9D1"
        )
        db.add(rex)
        db.commit()
        db.refresh(rex)

        r_h1 = models.HealthRecord(
            pet_id=rex.id,
            record_type="vaccination",
            event_date=date(2026, 5, 15),
            title="Вакцинация Нобивак DHPPi + Rabies",
            medicine_name="Nobivac DHPPi + R (бешенство)",
            clinic="Хатико ВетСервис",
            doctor="В. М. Белов",
            result="Вакцинация прошла без осложнений",
            comment="Ежегодная комплексная вакцинация",
            next_date=date(2027, 5, 15)
        )
        r_h2 = models.HealthRecord(
            pet_id=rex.id,
            record_type="parasite_treatment",
            event_date=date(2026, 8, 1),
            title="Защита от клещей и блох",
            medicine_name="Бравекто 20–40 кг",
            comment="Таблетка длительного действия на 12 недель",
            next_date=date(2026, 11, 1)
        )
        r_h3 = models.HealthRecord(
            pet_id=rex.id,
            record_type="vet_visit",
            event_date=date(2026, 9, 10),
            title="Ежегодный кардио-чекап овчарки",
            clinic="Хатико ВетСервис",
            doctor="В. М. Белов",
            vet_conclusion="ЭхоКГ без патологий, ритм синусовый, сердце в отличной форме"
        )
        db.add_all([r_h1, r_h2, r_h3])

        db.add_all([
            models.WeightRecord(pet_id=rex.id, date=date(2026, 5, 10), kg=34.0),
            models.WeightRecord(pet_id=rex.id, date=date(2026, 7, 10), kg=34.8),
            models.WeightRecord(pet_id=rex.id, date=date(2026, 9, 10), kg=35.2),
            models.WeightRecord(pet_id=rex.id, date=date(2026, 10, 15), kg=35.5),
        ])

        db.add(models.Prescription(
            pet_id=rex.id,
            name="Хондропротекторы Stride Plus",
            dose="4 мл в утреннее кормление",
            start_date=date(2026, 9, 15),
            duration="60 дней",
            times="08:00",
            status="Активно"
        ))

        r_mp1 = models.MealPlan(
            pet_id=rex.id,
            food="Говядина с кабачком и рисом, 450 г",
            time="08:00",
            notes="Добавить в порцию витамины для суставов",
            completed_on=today_str
        )
        r_mp2 = models.MealPlan(
            pet_id=rex.id,
            food="Сухой корм Acana Grass-Fed Lamb, 300 г",
            time="20:00",
            notes="После вечерней полуторачасовой прогулки",
            completed_on=None
        )
        db.add_all([r_mp1, r_mp2])
        db.commit()

        db.add(models.FeedingLog(
            pet_id=rex.id,
            food="Говядина с кабачком и рисом, 450 г",
            amount="450 г",
            notes="Съел с отличным аппетитом",
            meal_plan_id=r_mp1.id,
            completion_day=today_str,
            actor="Анна"
        ))

        db.add_all([
            models.NutritionLog(
                pet_id=rex.id,
                food_name="Acana Grass-Fed Lamb беззерновой",
                brand="Acana",
                kind="food",
                date=date(2026, 9, 15),
                liked="yes",
                tolerated="yes",
                price=8200.0,
                notes="Идеально подходит для чувствительного ЖКТ овчарки"
            ),
            models.NutritionLog(
                pet_id=rex.id,
                food_name="Сушёное говяжье лёгкое кусочками",
                brand="Деревенские лакомства",
                kind="treat",
                date=date(2026, 10, 5),
                liked="yes",
                tolerated="yes",
                price=340.0,
                notes="Используется для поощрения на дрессировочной площадке"
            )
        ])

        db.add_all([
            models.Reminder(
                pet_id=rex.id,
                title="Вечерняя тренировка ОКД на площадке",
                reminder_type="procedure",
                due_date=date.today(),
                at=datetime.now().strftime("%Y-%m-%dT19:00:00+03:00"),
                status="pending"
            ),
            models.Reminder(
                pet_id=rex.id,
                title="Стрижка когтей и гигиена ушей",
                reminder_type="procedure",
                due_date=date.today() + timedelta(days=3),
                at=(now_dt + timedelta(days=3)).strftime("%Y-%m-%dT11:00:00+03:00"),
                status="pending",
                interval_days=14
            )
        ])

        db.add_all([
            models.Document(
                pet_id=rex.id,
                title="Родословная РКФ / Свидетельство о происхождении",
                doc_type="passport",
                date=date(2022, 6, 1),
                file_name="rkf_pedigree_rex.pdf"
            ),
            models.Document(
                pet_id=rex.id,
                title="Международный ветеринарный паспорт",
                doc_type="passport",
                date=date(2022, 5, 20),
                file_name="rex_passport.pdf"
            )
        ])

        db.add_all([
            models.ShoppingItem(pet_id=rex.id, title="Шлейка анатомическая эргономичная", quantity="размер L", is_done=True, bought_by="Анна"),
            models.ShoppingItem(pet_id=rex.id, title="Светящийся ошейник для вечерних прогулок", quantity="1 шт", is_done=False),
            models.ShoppingItem(pet_id=rex.id, title="Мяч Chuckit Ultra Ball сверхпрочный", quantity="2 шт", is_done=False)
        ])

        milo = models.Pet(
            owner_id=user.id,
            name="Майло",
            species="Собака",
            breed="Вельш-корги пемброк",
            birth_date=date(2024, 11, 20),
            sex="Самец",
            sterilized=False,
            notes="Очень весёлый и дружелюбный щенок корги, обожает обниматься и выпрашивать внимание",
            avatar_bg="lavender",
            avatar_accessory="bow",
            share_code="PET-MILO-6A72-Q2B4"
        )
        db.add(milo)
        db.commit()
        db.refresh(milo)

        db.add(models.HealthRecord(
            pet_id=milo.id,
            record_type="vaccination",
            event_date=date(2026, 7, 10),
            title="Вакцинация Эурикан DHPPi2-L",
            medicine_name="Eurican DHPPi2-L",
            clinic="Хатико ВетСервис",
            doctor="В. М. Белов",
            result="Перенёс без побочных эффектов",
            next_date=date(2027, 7, 10)
        ))

        db.add_all([
            models.WeightRecord(pet_id=milo.id, date=date(2026, 7, 20), kg=10.8),
            models.WeightRecord(pet_id=milo.id, date=date(2026, 9, 20), kg=11.5),
            models.WeightRecord(pet_id=milo.id, date=date(2026, 10, 16), kg=12.0),
        ])

        db.add_all([
            models.MealPlan(pet_id=milo.id, food="Корм Farmina N&D Puppy Mini, 120 г", time="08:30", notes="Для щенков мелких пород"),
            models.MealPlan(pet_id=milo.id, food="Корм Farmina N&D Puppy Mini, 120 г", time="18:30", notes="Вечерняя порция"),
        ])

        db.add(models.Document(
            pet_id=milo.id,
            title="Щенячья метрика РКФ",
            doc_type="passport",
            date=date(2025, 1, 15),
            file_name="milo_puppy_card.pdf"
        ))

    db.commit()
    return user


@app.post("/api/v1/auth/demo-login/{account_id}", tags=["Авторизация и профиль"], summary="Быстрый вход в демо-аккаунт (1 или 2)")
def demo_login(account_id: int, request: Request, response: Response, db: Session = Depends(get_db)):
    if not ENABLE_DEMO_LOGIN:
        raise HTTPException(status_code=404, detail="Демо-вход отключён")
    try:
        if account_id not in [1, 2]:
            account_id = 1
        user = seed_demo_account(db, account_id)
        token = create_access_token(data={"sub": str(user.id)})
        return session_response(request, response, token, schemas.UserOut.model_validate(user, from_attributes=True))
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Не удалось подготовить демо-аккаунт")


@app.get("/api/v1/auth/session", response_model=schemas.UserOut, tags=["Авторизация и профиль"], summary="Проверка текущей сессии пользователя")
@app.get("/api/v1/auth/me", response_model=schemas.UserOut, tags=["Авторизация и профиль"], summary="Получение данных текущего пользователя")
def check_session(current_user: models.User = Depends(get_current_user)):
    return current_user


@app.put("/api/v1/auth/user", response_model=schemas.UserOut, tags=["Авторизация и профиль"], summary="Обновление профиля пользователя")
@app.patch("/api/v1/auth/profile", response_model=schemas.UserOut, tags=["Авторизация и профиль"], summary="Частичное обновление профиля пользователя")
def update_profile(
    user_data: schemas.UserUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    if user_data.full_name is not None:
        current_user.full_name = user_data.full_name
    if user_data.email is not None:
        current_user.email = user_data.email
    if user_data.timezone is not None:
        current_user.timezone = user_data.timezone
    if user_data.password is not None and len(user_data.password.strip()) >= 4:
        current_user.hashed_password = get_password_hash(user_data.password.strip())
    db.commit()
    db.refresh(current_user)
    return current_user


# =====================================================================
# 2. КАРТОЧКИ ПИТОМЦЕВ (/api/v1/pets)
# =====================================================================

@app.post("/api/v1/pets", response_model=schemas.PetOut, status_code=status.HTTP_201_CREATED, tags=["Питомцы и совместный уход"], summary="Создать карточку питомца")
def create_pet(
    pet_data: schemas.PetCreate, 
    db: Session = Depends(get_db), 
    current_user: models.User = Depends(get_current_user)
):
    from features import enforce_pet_limit
    enforce_pet_limit(db, current_user)

    code = models.generate_pet_share_code()
    new_pet = models.Pet(
        owner_id=current_user.id,
        name=pet_data.name,
        species=pet_data.species,
        breed=pet_data.breed,
        birth_date=pet_data.birth_date,
        sex=pet_data.sex,
        sterilized=pet_data.sterilized,
        microchip_number=pet_data.microchip_number,
        notes=pet_data.notes,
        marks=pet_data.marks,
        photo_file_id=pet_data.photo_file_id,
        clinic_url=pet_data.clinic_url,
        doctor_name=pet_data.doctor_name,
        avatar_bg=pet_data.avatar_bg or "lavender",
        avatar_accessory=pet_data.avatar_accessory or "none",
        share_code=code
    )
    db.add(new_pet)
    db.commit()
    db.refresh(new_pet)
    new_pet.is_shared = False
    return new_pet


@app.post("/api/v1/pets/join-by-code", response_model=schemas.PetOut, status_code=status.HTTP_200_OK, tags=["Питомцы и совместный уход"], summary="Подключиться к питомцу по коду совместного ухода")
def join_pet_by_code(
    payload: schemas.PetJoinByCode,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    from features import enforce_quota
    enforce_quota(db, 'invite:'+str(current_user.id)+':'+datetime.utcnow().strftime('%Y%m%d%H'), 20)
    code = payload.invite_code.strip().upper().replace(" ", "")
    if not code:
        raise HTTPException(status_code=400, detail="Введите код совместного ухода")

    pet = db.query(models.Pet).filter(models.Pet.share_code == code).with_for_update().first()
    if not pet:
        raise HTTPException(status_code=404, detail="Питомец с таким кодом не найден. Проверьте правильность кода.")

    if pet.owner_id == current_user.id:
        pet.is_shared = True
        return pet_response(pet, current_user.id)

    existing = db.query(models.PetMember).filter(
        models.PetMember.pet_id == pet.id,
        models.PetMember.user_id == current_user.id
    ).with_for_update().first()
    if existing:
        if existing.role not in {'viewer', 'editor', 'co_owner'}:
            raise HTTPException(403, 'Доступ отозван. Обратитесь к владельцу.')
        if existing.expires_at and existing.expires_at <= datetime.utcnow():
            raise HTTPException(403, 'Срок доступа истёк. Обратитесь к владельцу.')
        pet.is_shared = True
        return pet_response(pet, current_user.id)

    from features import enforce_pet_limit
    enforce_pet_limit(db, current_user)
    member = models.PetMember(pet_id=pet.id, user_id=current_user.id, role="co_owner")
    db.add(member)

    db.add(models.ActivityLog(
        pet_id=pet.id,
        actor=current_user.full_name or "Совладелец",
        action=f"Подключился(лась) к совместному уходу за {pet.name}",
        icon="🐾"
    ))

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(models.PetMember).filter_by(pet_id=pet.id, user_id=current_user.id).first()
        if existing is None:
            raise
        raise HTTPException(409, "Доступ уже изменился. Обновите страницу.") from None
    db.refresh(pet)
    pet.is_shared = True
    return pet_response(pet, current_user.id)


@app.get("/api/v1/pets", response_model=List[schemas.PetOut], tags=["Питомцы и совместный уход"], summary="Список всех питомцев пользователя (своих и совместных)")
def get_user_pets(
    db: Session = Depends(get_db), 
    current_user: models.User = Depends(get_current_user)
):
    member_pet_ids = active_member_pet_ids(current_user.id)
    pets = db.query(models.Pet).options(selectinload(models.Pet.members)).filter(
        (models.Pet.owner_id == current_user.id) | (models.Pet.id.in_(member_pet_ids))
    ).all()
    needs_commit = False
    for p in pets:
        if not p.share_code:
            p.share_code = models.generate_pet_share_code()
            needs_commit = True
        p.is_shared = (p.owner_id != current_user.id or any(m.role in {'viewer', 'editor', 'co_owner'} for m in p.members))
    if needs_commit:
        db.commit()
    return [pet_response(p, current_user.id) for p in pets]


@app.get("/api/v1/pets/{pet_id}", response_model=schemas.PetDetailOut, tags=["Питомцы и совместный уход"], summary="Получить полную карточку питомца со всеми записями")
def get_pet(
    pet_id: int, 
    db: Session = Depends(get_db), 
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db)
    pet.is_shared = (pet.owner_id != current_user.id or any(m.role in {'viewer', 'editor', 'co_owner'} for m in pet.members))
    return pet_response(pet, current_user.id, detail=True)


@app.put("/api/v1/pets/{pet_id}", response_model=schemas.PetOut, tags=["Питомцы и совместный уход"], summary="Обновить карточку питомца")
@app.patch("/api/v1/pets/{pet_id}", response_model=schemas.PetOut, tags=["Питомцы и совместный уход"], summary="Частично обновить карточку питомца")
def update_pet(
    pet_id: int,
    pet_data: schemas.PetUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db, write=True)
    dump_fn = getattr(pet_data, "model_dump", None) or getattr(pet_data, "dict")
    for k, v in dump_fn(exclude_unset=True).items():
        if v is not None:
            setattr(pet, k, v)
    db.commit()
    db.refresh(pet)
    pet.is_shared = (pet.owner_id != current_user.id or any(m.role in {'viewer', 'editor', 'co_owner'} for m in pet.members))
    return pet_response(pet, current_user.id)


@app.delete("/api/v1/pets/{pet_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Питомцы и совместный уход"], summary="Удалить питомца или выйти из совместного ухода")
def delete_pet(
    pet_id: int, 
    db: Session = Depends(get_db), 
    current_user: models.User = Depends(get_current_user)
):
    db.get(models.Pet, pet_id, with_for_update=True)
    pet = get_user_pet_or_404(pet_id, current_user.id, db)
    if pet.owner_id == current_user.id:
        # Hidden PetMatch records still have enforced PostgreSQL foreign keys.
        profile_ids = select(models.MatchProfile.id).where(models.MatchProfile.pet_id == pet_id)
        db.query(models.MatchDecision).filter(or_(
            models.MatchDecision.from_pet_id == pet_id,
            models.MatchDecision.to_pet_id == pet_id,
            models.MatchDecision.to_profile_id.in_(profile_ids),
        )).delete(synchronize_session=False)
        db.query(models.MatchProfile).filter(models.MatchProfile.pet_id == pet_id).delete(synchronize_session=False)
        db.delete(pet)
    else:
        member = db.query(models.PetMember).filter(
            models.PetMember.pet_id == pet_id,
            models.PetMember.user_id == current_user.id
        ).with_for_update().first()
        if member and member.role != 'revoked':
            db.delete(member)
    db.commit()
    return None


# =====================================================================
# 3. КАРТА ЗДОРОВЬЯ, ВЕС, НАЗНАЧЕНИЯ
# =====================================================================

@app.post("/api/v1/pets/{pet_id}/health-records", response_model=schemas.HealthRecordOut, status_code=status.HTTP_201_CREATED, tags=["Здоровье, вес и назначения"], summary="Добавить запись о здоровье (прививка, обработка, приём врача)")
def add_health_record(
    pet_id: int, 
    record_data: schemas.HealthRecordCreate, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db, write=True)
    enforce_attachment_quota(db, pet.id, record_data.file_data)

    new_record = models.HealthRecord(
        pet_id=pet.id,
        record_type=record_data.record_type,
        event_date=record_data.event_date,
        title=record_data.title,
        weight=record_data.weight,
        vet_conclusion=record_data.vet_conclusion,
        medicine_name=record_data.medicine_name,
        clinic=record_data.clinic,
        doctor=record_data.doctor,
        result=record_data.result,
        comment=record_data.comment,
        next_date=record_data.next_date,
        file_name=record_data.file_name,
        file_data=record_data.file_data
    )
    db.add(new_record)

    if record_data.weight:
        db.add(models.WeightRecord(pet_id=pet.id, date=record_data.event_date, kg=record_data.weight))

    target_next_date = record_data.next_date
    if not target_next_date:
        if record_data.record_type == "vaccination":
            target_next_date = record_data.event_date + timedelta(days=365)
        elif record_data.record_type == "parasite_treatment":
            target_next_date = record_data.event_date + timedelta(days=90)

    if target_next_date:
        reminder = models.Reminder(
            pet_id=pet.id,
            title=f"Повтор: {record_data.title}",
            reminder_type=record_data.record_type,
            due_date=target_next_date,
            at=f"{target_next_date}T12:00:00+03:00",
            status="pending"
        )
        db.add(reminder)

    db.commit()
    db.refresh(new_record)
    return new_record


@app.get("/api/v1/pets/{pet_id}/health-records", response_model=List[schemas.HealthRecordOut], tags=["Здоровье, вес и назначения"], summary="Список записей о здоровье питомца")
def get_health_records(
    pet_id: int, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db)
    return pet.health_records


@app.delete("/api/v1/health-records/{record_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Здоровье, вес и назначения"], summary="Удалить запись о здоровье")
def delete_health_record(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    rec = db.query(models.HealthRecord).filter(models.HealthRecord.id == record_id).first()
    if not rec or not user_has_pet_access(rec.pet_id, current_user.id, db, write=True):
        raise HTTPException(status_code=404, detail="Запись о здоровье не найдена")
    db.delete(rec)
    db.commit()
    return None


@app.post("/api/v1/pets/{pet_id}/weights", response_model=schemas.WeightOut, status_code=status.HTTP_201_CREATED, tags=["Здоровье, вес и назначения"], summary="Добавить измерение веса")
def add_weight(
    pet_id: int,
    weight_data: schemas.WeightCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db, write=True)
    new_weight = models.WeightRecord(pet_id=pet.id, date=weight_data.date, kg=weight_data.kg)
    db.add(new_weight)
    db.commit()
    db.refresh(new_weight)
    return new_weight


@app.get("/api/v1/pets/{pet_id}/weights", response_model=List[schemas.WeightOut], tags=["Здоровье, вес и назначения"], summary="История измерений веса")
def get_weights(
    pet_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db)
    return pet.weights


@app.delete("/api/v1/weights/{weight_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Здоровье, вес и назначения"], summary="Удалить запись о весе")
def delete_weight(
    weight_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    w = db.query(models.WeightRecord).filter(models.WeightRecord.id == weight_id).first()
    if not w or not user_has_pet_access(w.pet_id, current_user.id, db, write=True):
        raise HTTPException(status_code=404, detail="Запись о весе не найдена")
    db.delete(w)
    db.commit()
    return None


@app.post("/api/v1/pets/{pet_id}/prescriptions", response_model=schemas.PrescriptionOut, status_code=status.HTTP_201_CREATED, tags=["Здоровье, вес и назначения"], summary="Добавить назначение препарата")
def add_prescription(
    pet_id: int,
    presc_data: schemas.PrescriptionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db, write=True)
    new_presc = models.Prescription(
        pet_id=pet.id,
        name=presc_data.name,
        dose=presc_data.dose,
        start_date=presc_data.start_date,
        duration=presc_data.duration,
        times=presc_data.times,
        status=presc_data.status
    )
    db.add(new_presc)
    db.flush()
    if presc_data.status == 'Активно' and presc_data.times:
        clocks = list(dict.fromkeys(re.split(r'[,;\s]+', presc_data.times.strip())))
        days = re.fullmatch(r'(\d{1,3})(?:\s*(?:день|дня|дней|дн\.?))?', (presc_data.duration or '').strip())
        if not days or not 1 <= int(days[1]) <= 365 or not 1 <= len(clocks) <= 6 or any(not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', clock) for clock in clocks):
            raise HTTPException(422, 'Для напоминаний укажите длительность в днях (1–365) и время ЧЧ:ММ через запятую (до 6 приёмов в день).')
        for offset in range(int(days[1])):
            day = presc_data.start_date + timedelta(days=offset)
            for clock in clocks:
                db.add(models.Reminder(pet_id=pet.id, prescription_id=new_presc.id,
                    title=(presc_data.name + (' · ' + presc_data.dose if presc_data.dose else ''))[:255],
                    reminder_type='Препарат', due_date=day, due_time=clock, at=day.isoformat()+'T'+clock+':00+03:00'))
    db.commit()
    db.refresh(new_presc)
    return new_presc


@app.get("/api/v1/pets/{pet_id}/prescriptions", response_model=List[schemas.PrescriptionOut], tags=["Здоровье, вес и назначения"], summary="Список назначений препаратов")
def get_prescriptions(
    pet_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db)
    return pet.prescriptions


@app.delete("/api/v1/prescriptions/{presc_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Здоровье, вес и назначения"], summary="Удалить назначение препарата")
def delete_prescription(
    presc_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pr = db.query(models.Prescription).filter(models.Prescription.id == presc_id).first()
    if not pr or not user_has_pet_access(pr.pet_id, current_user.id, db, write=True):
        raise HTTPException(status_code=404, detail="Назначение не найдено")
    db.query(models.Reminder).filter(models.Reminder.prescription_id == pr.id, models.Reminder.status == 'pending').delete(synchronize_session=False)
    db.query(models.Reminder).filter(models.Reminder.prescription_id == pr.id).update({'prescription_id':None}, synchronize_session=False)
    db.delete(pr)
    db.commit()
    return None


# =====================================================================
# 4. ПИТАНИЕ: РАСПИСАНИЕ, ЖУРНАЛ КОРМЛЕНИЙ И ОЦЕНКА КОРМОВ
# =====================================================================

@app.post("/api/v1/pets/{pet_id}/meal-plans", response_model=schemas.MealPlanOut, status_code=status.HTTP_201_CREATED, tags=["Питание и рацион"], summary="Добавить ежедневное кормление в расписание")
def create_meal_plan(
    pet_id: int,
    plan_data: schemas.MealPlanCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db, write=True)
    new_plan = models.MealPlan(
        pet_id=pet.id,
        food=plan_data.food,
        time=plan_data.time,
        end_time=plan_data.end_time,
        notes=plan_data.notes,
        completed_on=None
    )
    db.add(new_plan)
    db.commit()
    db.refresh(new_plan)
    return new_plan


@app.get("/api/v1/pets/{pet_id}/meal-plans", response_model=List[schemas.MealPlanOut], tags=["Питание и рацион"], summary="Получить ежедневное расписание кормлений")
def get_meal_plans(
    pet_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db)
    return pet.meal_plans


@app.patch("/api/v1/meal-plans/{plan_id}/toggle", response_model=schemas.MealPlanOut, tags=["Питание и рацион"], summary="Отметить ежедневное кормление выполненным")
def toggle_meal_plan(
    plan_id: int,
    completed_on: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    plan = db.query(models.MealPlan).filter(models.MealPlan.id == plan_id).first()
    if not plan or not user_has_pet_access(plan.pet_id, current_user.id, db, write=True):
        raise HTTPException(status_code=404, detail="План кормления не найден")
    
    plan.completed_on = completed_on if completed_on else None
    db.commit()
    db.refresh(plan)
    return plan


@app.delete("/api/v1/meal-plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Питание и рацион"], summary="Удалить пункт расписания кормления")
def delete_meal_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    plan = db.query(models.MealPlan).filter(models.MealPlan.id == plan_id).first()
    if not plan or not user_has_pet_access(plan.pet_id, current_user.id, db, write=True):
        raise HTTPException(status_code=404, detail="План не найден")
    db.delete(plan)
    db.commit()
    return None


@app.post("/api/v1/pets/{pet_id}/feeding-logs", response_model=schemas.FeedingLogOut, status_code=status.HTTP_201_CREATED, tags=["Питание и рацион"], summary="Записать фактическое кормление в дневник")
def add_feeding_log(
    pet_id: int,
    log_data: schemas.FeedingLogCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db, write=True)
    for model, record_id in ((models.MealPlan, log_data.meal_plan_id), (models.Reminder, log_data.reminder_id)):
        if record_id is not None:
            record = db.get(model, record_id, with_for_update=True)
            if not record or record.pet_id != pet.id:
                raise HTTPException(404, 'Связанная запись не найдена у этого питомца')
    new_log = models.FeedingLog(
        pet_id=pet.id,
        food=log_data.food,
        amount=log_data.amount,
        notes=log_data.notes,
        meal_plan_id=log_data.meal_plan_id,
        reminder_id=log_data.reminder_id,
        completion_day=log_data.completion_day,
        actor=log_data.actor or current_user.full_name,
        at=log_data.at or datetime.utcnow()
    )
    db.add(new_log)
    db.commit()
    db.refresh(new_log)
    return new_log


@app.get("/api/v1/pets/{pet_id}/feeding-logs", response_model=List[schemas.FeedingLogOut], tags=["Питание и рацион"], summary="История фактических кормлений")
def get_feeding_logs(
    pet_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db)
    return pet.feeding_logs


@app.delete("/api/v1/feeding-logs/{log_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Питание и рацион"], summary="Удалить запись из дневника кормлений")
def delete_feeding_log(
    log_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    f_log = db.query(models.FeedingLog).filter(models.FeedingLog.id == log_id).first()
    if not f_log or not user_has_pet_access(f_log.pet_id, current_user.id, db, write=True):
        raise HTTPException(status_code=404, detail="Запись о кормлении не найдена")
    db.delete(f_log)
    db.commit()
    return None


@app.post("/api/v1/pets/{pet_id}/nutrition", response_model=schemas.NutritionLogOut, status_code=status.HTTP_201_CREATED, tags=["Питание и рацион"], summary="Добавить оценку корма, лакомства или добавки")
def add_nutrition_review(
    pet_id: int, 
    log_data: schemas.NutritionLogCreate, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db, write=True)

    new_log = models.NutritionLog(
        pet_id=pet.id,
        food_name=log_data.food_name,
        brand=log_data.brand,
        kind=log_data.kind or "food",
        liked=log_data.liked or "unknown",
        tolerated=log_data.tolerated or "unknown",
        adverse_reactions=log_data.adverse_reactions,
        price=log_data.price,
        notes=log_data.notes,
        date=log_data.date or date.today()
    )
    db.add(new_log)
    db.commit()
    db.refresh(new_log)
    return new_log


@app.get("/api/v1/pets/{pet_id}/nutrition", response_model=List[schemas.NutritionLogOut], tags=["Питание и рацион"], summary="Список оценок кормов и рационов")
def get_nutrition_reviews(
    pet_id: int, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db)
    return pet.nutrition_logs


@app.delete("/api/v1/nutrition/{item_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Питание и рацион"], summary="Удалить оценку корма")
def delete_nutrition_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    item = db.query(models.NutritionLog).filter(models.NutritionLog.id == item_id).first()
    if not item or not user_has_pet_access(item.pet_id, current_user.id, db, write=True):
        raise HTTPException(status_code=404, detail="Запись о питании не найдена")
    db.delete(item)
    db.commit()
    return None


# =====================================================================
# 5. НАПОМИНАНИЯ И СОБЫТИЯ (/api/v1/reminders)
# =====================================================================

@app.get("/api/v1/reminders", response_model=List[schemas.ReminderOut], tags=["Уход и напоминания"], summary="Список всех напоминаний по всем доступным питомцам")
def get_all_reminders(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    member_pet_ids = active_member_pet_ids(current_user.id)
    query = db.query(models.Reminder).join(models.Pet).filter(
        (models.Pet.owner_id == current_user.id) | (models.Pet.id.in_(member_pet_ids))
    )
    return query.order_by(models.Reminder.due_date.asc()).all()


@app.get("/api/v1/pets/{pet_id}/shared-care", response_model=Optional[List[schemas.ReminderOut]])
def shared_care_reminders(
    pet_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db)
    sharing_active = db.query(models.PetMember.id).filter(
        models.PetMember.pet_id == pet_id,
        models.PetMember.user_id != pet.owner_id,
        models.PetMember.role.in_(["viewer", "editor", "co_owner"]),
        or_(models.PetMember.expires_at.is_(None), models.PetMember.expires_at > datetime.utcnow()),
    ).first()
    if not sharing_active:
        return None
    return db.query(models.Reminder).filter_by(pet_id=pet_id).order_by(models.Reminder.id).all()


@app.post("/api/v1/pets/{pet_id}/reminders", response_model=schemas.ReminderOut, status_code=status.HTTP_201_CREATED, tags=["Уход и напоминания"], summary="Создать напоминание по уходу")
def create_reminder(
    pet_id: int,
    reminder_data: schemas.ReminderCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db, write=True)
    new_reminder = models.Reminder(
        pet_id=pet.id,
        title=reminder_data.title,
        reminder_type=reminder_data.reminder_type,
        due_date=reminder_data.due_date,
        due_time=reminder_data.due_time,
        at=reminder_data.at or f"{reminder_data.due_date}T12:00:00+03:00",
        interval_days=reminder_data.interval_days,
        interval_months=reminder_data.interval_months,
        food=reminder_data.food,
        status=reminder_data.status or "pending",
        is_completed=(reminder_data.status == "completed")
    )
    db.add(new_reminder)
    db.commit()
    db.refresh(new_reminder)
    return new_reminder


@app.patch("/api/v1/reminders/{reminder_id}/complete", response_model=schemas.ReminderOut, tags=["Уход и напоминания"], summary="Быстро отметить напоминание выполненным")
def mark_reminder_completed(
    reminder_id: int, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    reminder = db.query(models.Reminder).filter(models.Reminder.id == reminder_id).first()
    if not reminder or not user_has_pet_access(reminder.pet_id, current_user.id, db, write=True):
        raise HTTPException(status_code=404, detail="Напоминание не найдено или доступ запрещен")

    previous_status=reminder.status
    reminder.is_completed = True
    reminder.status = "completed"
    reminder.done_by = current_user.full_name
    reminder.completed_at = datetime.utcnow()
    from features import reminder_transition
    import secrets, json
    undo=reminder_transition(db,reminder,previous_status)
    token=secrets.token_urlsafe(24)
    db.add(models.RecoveryAction(id=token,user_id=current_user.id,pet_id=reminder.pet_id,data=json.dumps(undo),expires_at=datetime.utcnow()+timedelta(minutes=5)))
    db.commit()
    db.refresh(reminder)
    reminder.undo_token=token
    return reminder


@app.patch("/api/v1/reminders/{reminder_id}/action", response_model=schemas.ReminderOut, tags=["Уход и напоминания"], summary="Изменить статус или перенести время напоминания")
@app.patch("/api/v1/reminders/{reminder_id}", response_model=schemas.ReminderOut, tags=["Уход и напоминания"], summary="Обновить напоминание")
def update_reminder_action(
    reminder_id: int,
    action: schemas.ReminderAction,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    reminder = db.query(models.Reminder).filter(models.Reminder.id == reminder_id).first()
    if not reminder or not user_has_pet_access(reminder.pet_id, current_user.id, db, write=True):
        raise HTTPException(status_code=404, detail="Напоминание не найдено")

    previous_status=reminder.status
    if action.at is not None:
        reminder.at = action.at
        try:
            reminder.due_date = date.fromisoformat(action.at[:10])
        except Exception:
            pass
    if action.due_date is not None:
        reminder.due_date = action.due_date

    if action.status is not None:
        reminder.status = action.status
        reminder.is_completed = (action.status == "completed")
        reminder.done_by = action.done_by or current_user.full_name
        if action.status == "completed":
            reminder.completed_at = datetime.utcnow()
        elif action.status == "pending":
            reminder.completed_at = None
            reminder.done_by = None

    from features import reminder_transition
    import secrets, json
    undo=reminder_transition(db,reminder,previous_status)
    token=secrets.token_urlsafe(24)
    db.add(models.RecoveryAction(id=token,user_id=current_user.id,pet_id=reminder.pet_id,data=json.dumps(undo),expires_at=datetime.utcnow()+timedelta(minutes=5)))
    db.commit()
    db.refresh(reminder)
    reminder.undo_token=token
    return reminder


@app.delete("/api/v1/reminders/{reminder_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Уход и напоминания"], summary="Удалить напоминание")
def delete_reminder(
    reminder_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    reminder = db.query(models.Reminder).filter(models.Reminder.id == reminder_id).first()
    if not reminder or not user_has_pet_access(reminder.pet_id, current_user.id, db, write=True):
        raise HTTPException(status_code=404, detail="Напоминание не найдено")
    db.delete(reminder)
    db.commit()
    return None


# =====================================================================
# 6. ДОКУМЕНТЫ (/api/v1/pets/{pet_id}/documents)
# =====================================================================

@app.post("/api/v1/pets/{pet_id}/documents", response_model=schemas.DocumentOut, status_code=status.HTTP_201_CREATED, tags=["Документы и ИИ-распознавание"], summary="Сохранить документ в архив питомца")
def add_document(
    pet_id: int,
    doc_data: schemas.DocumentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db, write=True)
    enforce_attachment_quota(db, pet.id, doc_data.file_data)
    new_doc = models.Document(
        pet_id=pet.id,
        title=doc_data.title,
        doc_type=doc_data.doc_type,
        date=doc_data.date,
        file_name=doc_data.file_name,
        file_data=doc_data.file_data
    )
    db.add(new_doc)
    db.commit()
    db.refresh(new_doc)
    return new_doc


@app.get("/api/v1/pets/{pet_id}/documents", response_model=List[schemas.DocumentOut], tags=["Документы и ИИ-распознавание"], summary="Список документов питомца")
def get_documents(
    pet_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db)
    return pet.documents


def attachment_download(record, db, user):
    if record is None:
        raise HTTPException(404, 'Запись не найдена')
    get_user_pet_or_404(record.pet_id, user.id, db)
    if not record.file_data:
        raise HTTPException(404, 'У записи нет вложения')
    try:
        value, filename = validate_attachment(record.file_data, record.file_name)
    except ValueError:
        raise HTTPException(415, 'Вложение не прошло проверку безопасности') from None
    data = base64.b64decode(value.split(',', 1)[1])
    return Response(data, media_type='application/octet-stream', headers={
        'Content-Disposition': "attachment; filename=attachment; filename*=UTF-8''" + quote(filename, safe=''),
        'Content-Security-Policy': "sandbox; default-src 'none'",
    })


@app.get('/api/v1/documents/{doc_id}/download', tags=['Документы и ИИ-распознавание'])
def download_document(doc_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return attachment_download(db.get(models.Document, doc_id), db, current_user)


@app.get('/api/v1/health-records/{record_id}/download', tags=['Здоровье, вес и назначения'])
def download_health_attachment(record_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return attachment_download(db.get(models.HealthRecord, record_id), db, current_user)


@app.delete("/api/v1/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Документы и ИИ-распознавание"], summary="Удалить документ из архива")
def delete_document(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc or not user_has_pet_access(doc.pet_id, current_user.id, db, write=True):
        raise HTTPException(status_code=404, detail="Документ не найден")
    db.delete(doc)
    db.commit()
    return None


# =====================================================================
# 7. СПИСОК ПОКУПОК (/api/v1/pets/{pet_id}/shopping)
# =====================================================================

@app.post("/api/v1/pets/{pet_id}/shopping", response_model=schemas.ShoppingOut, status_code=status.HTTP_201_CREATED, tags=["Список покупок"], summary="Добавить товар в список покупок")
def add_shopping_item(
    pet_id: int,
    item_data: schemas.ShoppingCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db, write=True)
    item = models.ShoppingItem(
        pet_id=pet.id,
        title=item_data.title,
        quantity=item_data.quantity,
        is_done=False
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.get("/api/v1/pets/{pet_id}/shopping", response_model=List[schemas.ShoppingOut], tags=["Список покупок"], summary="Получить список покупок питомца")
def get_shopping_items(
    pet_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db)
    return pet.shopping_items


@app.patch("/api/v1/shopping/{item_id}/toggle", response_model=schemas.ShoppingOut, tags=["Список покупок"], summary="Отметить товар купленным / снять отметку")
def toggle_shopping_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    item = db.query(models.ShoppingItem).filter(models.ShoppingItem.id == item_id).first()
    if not item or not user_has_pet_access(item.pet_id, current_user.id, db, write=True):
        raise HTTPException(status_code=404, detail="Товар не найден")
    item.is_done = not item.is_done
    if item.is_done:
        item.bought_by = current_user.full_name
    else:
        item.bought_by = None
    db.commit()
    db.refresh(item)
    return item


@app.delete("/api/v1/shopping/{item_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Список покупок"], summary="Удалить товар из списка покупок")
def delete_shopping_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    item = db.query(models.ShoppingItem).filter(models.ShoppingItem.id == item_id).first()
    if not item or not user_has_pet_access(item.pet_id, current_user.id, db, write=True):
        raise HTTPException(status_code=404, detail="Товар не найден")
    db.delete(item)
    db.commit()
    return None


# =====================================================================
# 8. ЖУРНАЛ ДЕЙСТВИЙ (ACTIVITY)
# =====================================================================

@app.post("/api/v1/pets/{pet_id}/activity", response_model=schemas.ActivityOut, status_code=status.HTTP_201_CREATED, tags=["Журнал активности"], summary="Записать действие в журнал ухода")
def add_activity(
    pet_id: int,
    act_data: schemas.ActivityCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db, write=True)
    new_act = models.ActivityLog(
        pet_id=pet.id,
        action=act_data.action,
        actor=act_data.actor or current_user.full_name,
        icon=act_data.icon or "🐾",
        at=act_data.at or datetime.utcnow()
    )
    db.add(new_act)
    db.commit()
    db.refresh(new_act)
    return new_act


@app.get("/api/v1/pets/{pet_id}/activity", response_model=List[schemas.ActivityOut], tags=["Журнал активности"], summary="Получить последние 50 записей журнала ухода")
def get_activities(
    pet_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db)
    return (
        db.query(models.ActivityLog)
        .filter(models.ActivityLog.pet_id == pet.id)
        .order_by(models.ActivityLog.at.desc())
        .limit(50)
        .all()
    )


# =====================================================================
# 9. ИИ-РАСПОЗНАВАНИЕ И РАЗБОР ДОКУМЕНТОВ (/api/v1/documents/*)
# =====================================================================

_PLACEHOLDER_KEYS = {
    "",
    "YOUR_LLM_PROXY_API_KEY",
    "YOUR_API_KEY",
    "MY_GEMINI_API_KEY",
    "<API key>",
    "<API_KEY>",
}


from ocr import recognize_text, require_ocr_configuration


@app.post("/api/v1/documents/recognize", tags=["Документы и ИИ-распознавание"], summary="ИИ-распознавание текста с фото ветеринарного документа через LLM Proxy")
async def recognize_document(
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from features import enforce_quota, premium
    if not premium(current_user):
        raise HTTPException(403, "ИИ-распознавание доступно в платной версии. Запросите доступ у администратора.")
    from uploads import checked_upload, MAX_FILE_BYTES
    try:
        photo = await file.read(MAX_FILE_BYTES + 1)
    finally:
        await file.close()
    checked_upload(photo, file.content_type)

    require_ocr_configuration()
    enforce_quota(db, "ocr-user:"+str(current_user.id)+":"+datetime.utcnow().strftime("%Y%m%d"), 10)
    enforce_quota(db, "ocr-global:"+datetime.utcnow().strftime("%Y%m%d"), 40)
    try:
        text = await recognize_text(photo, file.content_type)
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Ошибка сервиса распознавания") from exc

    return {"text": text}


# =====================================================================
# 10. ЗНАКОМСТВА ПИТОМЦЕВ (PET MATCH / TINDER FOR PETS)
# =====================================================================

def _species_group(species: str) -> str:
    s = (species or "").lower()
    if any(k in s for k in ["кошк", "кот", "котён"]):
        return "cat"
    if any(k in s for k in ["собак", "пёс", "пес", "щенок", "овчарк", "корги", "ретривер", "бульдог"]):
        return "dog"
    if any(k in s for k in ["хомяк", "грызун", "крыс"]):
        return "hamster"
    if any(k in s for k in ["птиц", "попуг", "канар"]):
        return "bird"
    return s.strip() or "other"


def _compute_recommendation(pet: models.Pet, my_profile: Optional[models.MatchProfile], cand: models.MatchProfile):
    my_species = (my_profile.species if my_profile else pet.species) or ""
    my_breed = ((my_profile.breed if my_profile else pet.breed) or "").lower()
    my_sex = (my_profile.sex if my_profile else pet.sex) or ""
    same_group = _species_group(my_species) == _species_group(cand.species or "")

    score = 62 if same_group else 25
    reasons = []
    if same_group:
        reasons.append(f"Подходящий вид ({cand.species})")

    cand_breed = (cand.breed or "").lower()
    words = [w for w in my_breed.replace("-", " ").split() if len(w) > 3]
    exact_breed = bool(my_breed and cand_breed and (my_breed == cand_breed or any(w in cand_breed for w in words)))
    if exact_breed:
        score += 22
        reasons.append(f"Совпадение породы: {cand.breed}")
    elif same_group and cand.breed and cand.breed != "Метис":
        score += 8
        reasons.append(f"Порода: {cand.breed}")

    if (cand.vaccinated or "").lower().startswith("да"):
        score += 6
        reasons.append("Есть прививки")

    if my_sex and cand.sex and my_sex != "Неизвестно" and cand.sex != "Неизвестно" and my_sex != cand.sex:
        score += 6
        reasons.append("Подходит для создания пары")

    return {
        "match_score": min(99, max(35, score)),
        "match_reasons": reasons[:4],
        "same_species": same_group,
        "same_breed": exact_breed
    }


def _profile_to_dict(mp: models.MatchProfile, *, show_contact: bool = False) -> dict:
    return {
        "id": mp.id,
        "pet_id": mp.pet_id,
        "owner_id": mp.owner_id,
        "name": mp.name,
        "species": mp.species,
        "breed": mp.breed,
        "birth_date": mp.birth_date,
        "sex": mp.sex,
        "vaccinated": mp.vaccinated,
        "sterilized": mp.sterilized,
        "purpose": mp.purpose,
        "city": mp.city,
        "bio": mp.bio,
        "owner_name": mp.owner_name,
        "owner_contact": mp.owner_contact if show_contact else None,
        "photo": mp.photo,
        "photos": mp.photos if mp.photos is not None else ([mp.photo] if mp.photo else []),
        "is_published": mp.is_published,
    }


def _ensure_match_seed_data(db: Session):
    if not ENABLE_DEMO_LOGIN:
        return
    count = db.query(models.MatchProfile).filter(models.MatchProfile.pet_id.is_(None)).count()
    if count == 0:
        seeds = [
            models.MatchProfile(
                name="Мишель", species="Кошка", breed="Британская короткошёрстная", birth_date="2023-11-10",
                sex="Самка", vaccinated="Да, все по возрасту (Мультифел-4, Рабиес)", sterilized="Нет",
                purpose="Вязка / продолжение рода", city="Москва, Хамовники",
                bio="Ласковая британская кошечка голубого окраса с родословной WCF. Спокойная, чистоплотная, с актуальными прививками.",
                owner_name="Екатерина Смирнова", owner_contact="Telegram: @ekaterina_britcat · +7 (916) 442-18-90", is_published=True
            ),
            models.MatchProfile(
                name="Оливер", species="Кот", breed="Шотландская прямоухая (Скоттиш-страйт)", birth_date="2024-02-14",
                sex="Самец", vaccinated="Да, все по возрасту (Пуревакс)", sterilized="Нет",
                purpose="Вязка / продолжение рода", city="Москва, Сокольники",
                bio="Интеллигентный шотландский страйт золотистого окраса. Отлично ладит с вислоухими кошечками, ветпаспорт на руках.",
                owner_name="Дмитрий Волков", owner_contact="Telegram: @dmitry_scottish · +7 (926) 715-33-04", is_published=True
            ),
            models.MatchProfile(
                name="Симба", species="Кот", breed="Британская короткошёрстная", birth_date="2023-05-20",
                sex="Самец", vaccinated="Да, все по возрасту", sterilized="Да",
                purpose="Совместные прогулки и игры", city="Москва, Пресня",
                bio="Крупный плюшевый британец, обожает интерактивные игрушки. Будем рады знакомству с владельцами британцев!",
                owner_name="Алина Морозова", owner_contact="Telegram: @alina_simba · +7 (903) 558-92-11", is_published=True
            ),
            models.MatchProfile(
                name="Клео", species="Кошка", breed="Шотландская вислоухая", birth_date="2024-05-01",
                sex="Самка", vaccinated="Да, все по возрасту", sterilized="Да",
                purpose="Совместные прогулки и игры", city="Москва, Парк Горького",
                bio="Нежная и любознательная кошечка, приучена к шлейке и переноске-рюкзаку. Ищем друзей для спокойных прогулок.",
                owner_name="Максим Лебедев", owner_contact="Telegram: @max_kleo · +7 (985) 210-64-77", is_published=True
            ),
            models.MatchProfile(
                name="Грета", species="Собака", breed="Немецкая овчарка", birth_date="2022-09-12",
                sex="Самка", vaccinated="Да, все по возрасту (Нобивак DHPPi+RL)", sterilized="Нет",
                purpose="Совместные прогулки и игры", city="Москва, Измайловский парк",
                bio="Воспитанная немецкая овчарка чепрачного окраса, диплом ОКД-1. Обожает активные пробежки в парке.",
                owner_name="Сергей Орлов", owner_contact="Telegram: @sergey_gsd · +7 (915) 884-20-19", is_published=True
            ),
            models.MatchProfile(
                name="Бейли", species="Собака", breed="Вельш-корги пемброк", birth_date="2024-09-05",
                sex="Самка", vaccinated="Да, все по возрасту (Эурикан)", sterilized="Нет",
                purpose="Совместные прогулки и игры", city="Москва, Патриаршие пруды",
                bio="Солнечная девочка корги рыже-белого окраса! Обожает компании других корги и догонялки на площадке.",
                owner_name="Мария Ковалёва", owner_contact="Telegram: @maria_corgi · +7 (925) 339-47-82", is_published=True
            ),
            models.MatchProfile(
                name="Арчи", species="Собака", breed="Золотистый ретривер", birth_date="2023-03-18",
                sex="Самец", vaccinated="Да, все по возрасту", sterilized="Да",
                purpose="Совместные прогулки и игры", city="Москва, Воробьёвы горы",
                bio="Самый дружелюбный голден ретривер в районе, отлично ладит со щенками и крупными собаками.",
                owner_name="Павел Соколов", owner_contact="Telegram: @pavel_archie · +7 (905) 612-09-55", is_published=True
            ),
            models.MatchProfile(
                name="Рокки", species="Собака", breed="Вельш-корги кардиган", birth_date="2024-04-12",
                sex="Самец", vaccinated="Да, все по возрасту", sterilized="Нет",
                purpose="Совместные прогулки и игры", city="Москва, Парк Сокольники",
                bio="Улыбчивый корги с пушистым хвостом! Всегда готов к вечерним прогулкам и играм в мяч.",
                owner_name="Ольга Романова", owner_contact="Telegram: @olga_rocky · +7 (916) 901-74-33", is_published=True
            ),
        ]
        db.add_all(seeds)
        db.commit()


@app.get("/api/v1/pets/{pet_id}/match-data", tags=["Знакомства питомцев (Pet Match)"], summary="Получить анкету питомца, рекомендованные пары и лайки")
def get_pet_match_data(
    pet_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db)
    _ensure_match_seed_data(db)

    my_profile = db.query(models.MatchProfile).filter(models.MatchProfile.pet_id == pet_id).first()
    can_share_contacts = bool(my_profile and my_profile.is_published and pet.owner_id == current_user.id)
    my_decisions = db.query(models.MatchDecision).filter(models.MatchDecision.from_pet_id == pet_id).all()
    swiped_ids = {d.to_profile_id for d in my_decisions}

    inc_conds = [models.MatchDecision.to_pet_id == pet_id]
    if my_profile:
        inc_conds.append(models.MatchDecision.to_profile_id == my_profile.id)

    inc_decisions = db.query(models.MatchDecision).filter(
        models.MatchDecision.decision == "like",
        or_(*inc_conds)
    ).all()

    incoming_likes = []
    seen_sender_ids = set()
    for inc in inc_decisions:
        sender = db.query(models.MatchProfile).filter(
            models.MatchProfile.pet_id == inc.from_pet_id
        ).first()
        if not sender or not sender.is_published or sender.pet_id == pet_id or sender.id in seen_sender_ids:
            continue
        seen_sender_ids.add(sender.id)
        my_resp = next((d for d in my_decisions if d.to_profile_id == sender.id), None)
        if my_resp and my_resp.decision == "skip":
            continue
        rec = _compute_recommendation(pet, my_profile, sender)
        incoming_likes.append({
            **_profile_to_dict(sender, show_contact=bool(can_share_contacts and my_resp and my_resp.decision == "like")),
            **rec,
            "my_decision": my_resp.decision if my_resp else "pending",
            "is_mutual": bool(my_resp and my_resp.decision == "like")
        })

    my_likes = []
    for d in my_decisions:
        if d.decision != "like":
            continue
        target = db.query(models.MatchProfile).filter(models.MatchProfile.id == d.to_profile_id).first()
        if not target or not target.is_published:
            continue
        mutual = any(item["id"] == target.id for item in incoming_likes)
        rec = _compute_recommendation(pet, my_profile, target)
        my_likes.append({
            **_profile_to_dict(target, show_contact=mutual and can_share_contacts),
            **rec,
            "is_mutual": mutual
        })

    candidates = db.query(models.MatchProfile).filter(
        models.MatchProfile.owner_id.isnot(None),
        models.MatchProfile.pet_id.isnot(None),
        models.MatchProfile.is_published == True,
        (models.MatchProfile.pet_id.is_(None)) | (models.MatchProfile.pet_id != pet_id)
    ).all()

    all_candidates = []
    for c in candidates:
        if c.id in swiped_ids:
            continue
        rec = _compute_recommendation(pet, my_profile, c)
        all_candidates.append({
            **_profile_to_dict(c),
            **rec,
            "liked_me": any(i["id"] == c.id for i in incoming_likes)
        })
    all_candidates.sort(key=lambda x: x["match_score"], reverse=True)
    same_species = [c for c in all_candidates if c["same_species"]]
    recommendations = same_species if same_species else all_candidates

    owns_pet = pet.owner_id == current_user.id
    visible_profile = my_profile if my_profile and (owns_pet or my_profile.is_published) else None
    return {
        "my_profile": _profile_to_dict(visible_profile, show_contact=owns_pet) if visible_profile else None,
        "recommendations": recommendations,
        "incoming_likes": incoming_likes,
        "my_likes": my_likes,
        "swiped_count": len(swiped_ids)
    }


@app.post("/api/v1/pets/{pet_id}/match-profile", tags=["Знакомства питомцев (Pet Match)"], summary="Создать или обновить анкету питомца для знакомств")
@app.put("/api/v1/pets/{pet_id}/match-profile", tags=["Знакомства питомцев (Pet Match)"], summary="Обновить анкету питомца для знакомств")
def save_pet_match_profile(
    pet_id: int,
    data: schemas.MatchProfileCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db, write=True)
    if pet.owner_id != current_user.id:
        raise HTTPException(403, 'Только владелец управляет публикацией анкеты')
    existing = db.query(models.MatchProfile).filter(models.MatchProfile.pet_id == pet_id).first()
    if existing:
        existing.name = data.name
        existing.species = data.species
        existing.breed = data.breed or "Метис"
        existing.birth_date = data.birth_date
        existing.sex = data.sex or "Неизвестно"
        existing.vaccinated = data.vaccinated or "Не указано"
        existing.sterilized = data.sterilized or "Нет"
        existing.purpose = data.purpose or "Совместные прогулки и игры"
        existing.city = data.city or ""
        existing.bio = data.bio
        existing.owner_name = data.owner_name or current_user.full_name
        existing.owner_contact = data.owner_contact
        if data.photo:
            existing.photo = data.photo
        elif not existing.photo:
            existing.photo = pet.photo_file_id
        if "is_published" in data.model_fields_set and data.is_published is not None:
            existing.is_published = data.is_published
    else:
        existing = models.MatchProfile(
            pet_id=pet_id,
            owner_id=current_user.id,
            name=data.name,
            species=data.species,
            breed=data.breed or "Метис",
            birth_date=data.birth_date,
            sex=data.sex or "Неизвестно",
            vaccinated=data.vaccinated or "Не указано",
            sterilized=data.sterilized or "Нет",
            purpose=data.purpose or "Совместные прогулки и игры",
            city=data.city or "",
            bio=data.bio,
            owner_name=data.owner_name or current_user.full_name,
            owner_contact=data.owner_contact,
            photo=data.photo or pet.photo_file_id,
            is_published=data.is_published is not False
        )
        db.add(existing)
    if data.photos is not None:
        existing.photos = data.photos
        existing.photo = data.photos[0] if data.photos else None
    elif data.photo:
        existing.photos = [data.photo]
    db.commit()
    db.refresh(existing)
    return _profile_to_dict(existing, show_contact=True)


@app.post("/api/v1/pets/{pet_id}/match-decision", tags=["Знакомства питомцев (Pet Match)"], summary="Поставить лайк или пропустить анкету кандидата")
def save_pet_match_decision(
    pet_id: int,
    data: schemas.MatchDecisionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db, write=True)
    if pet.owner_id != current_user.id:
        raise HTTPException(403, 'Только владелец управляет знакомствами')
    target = db.query(models.MatchProfile).filter(models.MatchProfile.id == data.target_profile_id,
        models.MatchProfile.is_published.is_(True),
        models.MatchProfile.pet_id != pet_id,
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="Анкета не найдена")

    norm_dec = "like" if data.decision == "like" else "skip"
    rec = db.query(models.MatchDecision).filter(
        models.MatchDecision.from_pet_id == pet_id,
        models.MatchDecision.to_profile_id == target.id
    ).first()
    if rec:
        rec.decision = norm_dec
    else:
        rec = models.MatchDecision(
            from_pet_id=pet_id,
            to_profile_id=target.id,
            to_pet_id=target.pet_id,
            decision=norm_dec
        )
        db.add(rec)
    db.commit()
    return {"status": "ok", "decision": norm_dec, "target_profile": _profile_to_dict(target)}


@app.post("/api/v1/pets/{pet_id}/match-reset", tags=["Знакомства питомцев (Pet Match)"], summary="Сбросить пропущенные анкеты для повторного просмотра")
def reset_pet_match_skips(
    pet_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pet = get_user_pet_or_404(pet_id, current_user.id, db, write=True)
    if pet.owner_id != current_user.id:
        raise HTTPException(403, 'Только владелец управляет знакомствами')
    db.query(models.MatchDecision).filter(
        models.MatchDecision.from_pet_id == pet_id,
        models.MatchDecision.decision == "skip"
    ).delete()
    db.commit()
    return {"status": "ok"}


# =====================================================================
# 11. СИСТЕМНЫЕ МАРШРУТЫ (HEALTHCHECK & ФРОНТЕНД ДЛЯ DOCKER)
# =====================================================================

@app.get("/api/v1/health", tags=["Системные маршруты"], summary="Проверка состояния сервера (Healthcheck)")
def health_check():
    return {"status": "ok", "service": "PetCare API v1"}


@app.get("/swagger", include_in_schema=False)
@app.get("/api/docs", include_in_schema=False)
def redirect_to_swagger():
    return RedirectResponse(url="/docs")


@app.get("/styles.css", include_in_schema=False)
def serve_styles():
    styles_path = Path(__file__).resolve().parent / "styles.css"
    if styles_path.exists():
        return FileResponse(styles_path, media_type="text/css")
    raise HTTPException(status_code=404, detail="styles.css not found")


@app.get("/", include_in_schema=False)
def serve_frontend():
    index_path = Path(__file__).resolve().parent / "static" / "frontend" / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    raise HTTPException(status_code=503, detail="Frontend build missing. Run npm ci && npm run build before starting PetCare.")


from features import install_features
install_features(app)
