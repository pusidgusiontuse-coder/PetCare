from datetime import datetime, date
from sqlalchemy import Column, Integer, String, Date, DateTime, Boolean, ForeignKey, Float, Text
from sqlalchemy.orm import relationship
from model_base import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    timezone = Column(String(50), default="Europe/Moscow", nullable=False)
    disabled = Column(Boolean, default=False, nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)
    premium_until = Column(DateTime, nullable=True)
    premium_permanent = Column(Boolean, default=False, nullable=False)
    email_verified = Column(Boolean, default=False, nullable=False)
    token_version = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    pets = relationship("Pet", back_populates="owner", cascade="all, delete-orphan")


class Pet(Base):
    __tablename__ = "pets"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    name = Column(String(100), nullable=False)
    species = Column(String(50), nullable=False)
    breed = Column(String(100), nullable=False, default="Метис")
    birth_date = Column(Date, nullable=False, default=date.today)
    sex = Column(String(20), nullable=True)
    sterilized = Column(Boolean, default=False)
    microchip_number = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    marks = Column(Text, nullable=True)
    photo_file_id = Column(Text, nullable=True)
    clinic_url = Column(String(500), nullable=True)
    doctor_name = Column(String(200), nullable=True)
    avatar_bg = Column(String(50), default="lavender", nullable=True)
    avatar_accessory = Column(String(50), default="none", nullable=True)
    share_code = Column(String(64), unique=True, index=True, nullable=True)

    owner = relationship("User", back_populates="pets")
    members = relationship("PetMember", back_populates="pet", cascade="all, delete-orphan")

    health_records = relationship("HealthRecord", back_populates="pet", cascade="all, delete-orphan")
    nutrition_logs = relationship("NutritionLog", back_populates="pet", cascade="all, delete-orphan")
    reminders = relationship("Reminder", back_populates="pet", cascade="all, delete-orphan")
    meal_plans = relationship("MealPlan", back_populates="pet", cascade="all, delete-orphan")
    feeding_logs = relationship("FeedingLog", back_populates="pet", cascade="all, delete-orphan")
    weights = relationship("WeightRecord", back_populates="pet", cascade="all, delete-orphan")
    prescriptions = relationship("Prescription", back_populates="pet", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="pet", cascade="all, delete-orphan")
    shopping_items = relationship("ShoppingItem", back_populates="pet", cascade="all, delete-orphan")
    activities = relationship("ActivityLog", back_populates="pet", cascade="all, delete-orphan")


class HealthRecord(Base):
    __tablename__ = "health_records"

    id = Column(Integer, primary_key=True, index=True)
    pet_id = Column(Integer, ForeignKey("pets.id"), nullable=False)

    record_type = Column(String(50), nullable=False)  # vaccination, parasite_treatment, vet_visit, other
    event_date = Column(Date, nullable=False)
    title = Column(String(200), nullable=False)
    weight = Column(Float, nullable=True)
    vet_conclusion = Column(Text, nullable=True)
    medicine_name = Column(String(200), nullable=True)
    clinic = Column(String(200), nullable=True)
    doctor = Column(String(100), nullable=True)
    result = Column(Text, nullable=True)
    comment = Column(Text, nullable=True)
    next_date = Column(Date, nullable=True)
    file_name = Column(String(255), nullable=True)
    file_data = Column(Text, nullable=True)

    pet = relationship("Pet", back_populates="health_records")


class WeightRecord(Base):
    __tablename__ = "weight_records"

    id = Column(Integer, primary_key=True, index=True)
    pet_id = Column(Integer, ForeignKey("pets.id"), nullable=False)
    date = Column(Date, nullable=False, default=date.today)
    kg = Column(Float, nullable=False)

    pet = relationship("Pet", back_populates="weights")


class Prescription(Base):
    __tablename__ = "prescriptions"

    id = Column(Integer, primary_key=True, index=True)
    pet_id = Column(Integer, ForeignKey("pets.id"), nullable=False)
    name = Column(String(200), nullable=False)
    dose = Column(String(100), nullable=True)
    start_date = Column(Date, nullable=False, default=date.today)
    duration = Column(String(100), nullable=True)
    times = Column(String(100), nullable=True)
    status = Column(String(50), default="Активно")

    pet = relationship("Pet", back_populates="prescriptions")


class MealPlan(Base):
    __tablename__ = "meal_plans"

    id = Column(Integer, primary_key=True, index=True)
    pet_id = Column(Integer, ForeignKey("pets.id"), nullable=False)
    food = Column(String(200), nullable=False)
    time = Column(String(20), nullable=False)
    end_time = Column(String(20), nullable=True)
    notes = Column(Text, nullable=True)
    completed_on = Column(String(20), nullable=True)

    pet = relationship("Pet", back_populates="meal_plans")


class FeedingLog(Base):
    __tablename__ = "feeding_logs"

    id = Column(Integer, primary_key=True, index=True)
    pet_id = Column(Integer, ForeignKey("pets.id"), nullable=False)
    food = Column(String(200), nullable=False)
    amount = Column(String(100), nullable=True)
    at = Column(DateTime, default=datetime.utcnow)
    actor = Column(String(100), default="Владелец")
    notes = Column(Text, nullable=True)
    meal_plan_id = Column(Integer, nullable=True)
    reminder_id = Column(Integer, nullable=True)
    completion_day = Column(String(20), nullable=True)

    pet = relationship("Pet", back_populates="feeding_logs")


class NutritionLog(Base):
    __tablename__ = "nutrition_logs"

    id = Column(Integer, primary_key=True, index=True)
    pet_id = Column(Integer, ForeignKey("pets.id"), nullable=False)

    food_name = Column(String(150), nullable=False)
    brand = Column(String(100), nullable=True)
    kind = Column(String(50), default="food")  # food, treat, supplement
    liked = Column(String(20), default="unknown")  # yes, no, unknown
    tolerated = Column(String(20), default="unknown")  # yes, no, unknown
    adverse_reactions = Column(Text, nullable=True)
    price = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)
    date = Column(Date, default=date.today)
    created_at = Column(DateTime, default=datetime.utcnow)

    pet = relationship("Pet", back_populates="nutrition_logs")


class Reminder(Base):
    __tablename__ = "reminders"

    id = Column(Integer, primary_key=True, index=True)
    pet_id = Column(Integer, ForeignKey("pets.id"), nullable=False)

    title = Column(String(255), nullable=False)
    reminder_type = Column(String(50), nullable=False)
    due_date = Column(Date, nullable=False)
    due_time = Column(String(20), nullable=True)
    at = Column(String(50), nullable=True)
    interval_days = Column(Integer, nullable=True)
    interval_months = Column(Integer, nullable=True)
    food = Column(String(200), nullable=True)
    status = Column(String(50), default="pending")  # pending, completed, skipped
    is_completed = Column(Boolean, default=False)
    done_by = Column(String(100), nullable=True)
    completed_at = Column(DateTime, nullable=True)

    pet = relationship("Pet", back_populates="reminders")


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    pet_id = Column(Integer, ForeignKey("pets.id"), nullable=False)
    title = Column(String(200), nullable=False)
    doc_type = Column(String(50), default="other")
    date = Column(Date, default=date.today)
    file_name = Column(String(255), nullable=True)
    file_data = Column(Text, nullable=True)

    pet = relationship("Pet", back_populates="documents")


class ShoppingItem(Base):
    __tablename__ = "shopping_items"

    id = Column(Integer, primary_key=True, index=True)
    pet_id = Column(Integer, ForeignKey("pets.id"), nullable=False)
    title = Column(String(255), nullable=False)
    quantity = Column(String(100), nullable=True)
    is_done = Column(Boolean, default=False)
    bought_by = Column(String(100), nullable=True)

    pet = relationship("Pet", back_populates="shopping_items")


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    pet_id = Column(Integer, ForeignKey("pets.id"), nullable=False)
    actor = Column(String(100), default="Владелец")
    action = Column(String(255), nullable=False)
    icon = Column(String(20), default="🐾")
    at = Column(DateTime, default=datetime.utcnow)

    pet = relationship("Pet", back_populates="activities")


class PetMember(Base):
    """Связь для совместного ухода за питомцем с разных аккаунтов"""
    __tablename__ = "pet_members"

    id = Column(Integer, primary_key=True, index=True)
    pet_id = Column(Integer, ForeignKey("pets.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    role = Column(String(50), default="co_owner")
    expires_at = Column(DateTime, nullable=True)
    joined_at = Column(DateTime, default=datetime.utcnow)

    pet = relationship("Pet", back_populates="members")
    user = relationship("User")


class MatchProfile(Base):
    """Анкета питомца для знакомств (PetMatch)"""
    __tablename__ = "match_profiles"

    id = Column(Integer, primary_key=True, index=True)
    pet_id = Column(Integer, ForeignKey("pets.id"), nullable=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    name = Column(String(100), nullable=False)
    species = Column(String(100), nullable=False)
    breed = Column(String(150), default="Метис")
    birth_date = Column(String(40), nullable=True)
    sex = Column(String(40), default="Неизвестно")
    vaccinated = Column(String(100), default="Не указано")
    sterilized = Column(String(40), default="Нет")
    purpose = Column(String(120), default="Совместные прогулки и игры")
    city = Column(String(120), default="")
    bio = Column(Text, nullable=True)
    owner_name = Column(String(120), default="Владелец")
    owner_contact = Column(String(255), nullable=False)
    photo = Column(Text, nullable=True)
    is_published = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class MatchDecision(Base):
    """Лайк или пропуск анкеты со стороны активного питомца"""
    __tablename__ = "match_decisions"

    id = Column(Integer, primary_key=True, index=True)
    from_pet_id = Column(Integer, ForeignKey("pets.id"), nullable=False, index=True)
    to_profile_id = Column(Integer, ForeignKey("match_profiles.id"), nullable=False, index=True)
    to_pet_id = Column(Integer, nullable=True, index=True)
    decision = Column(String(20), nullable=False)  # 'like' or 'skip'
    created_at = Column(DateTime, default=datetime.utcnow)


def generate_pet_share_code() -> str:
    """Генерирует криптографически стойкий уникальный код совместного ухода.
    Формат: PET-XXXX-XXXX-XXXX-XXXX."""
    import secrets
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    parts = ["".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(4)]
    return "PET-" + "-".join(parts)



class LoginSession(Base):
    __tablename__ = "login_sessions"
    id = Column(String(64), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    revoked = Column(Boolean, default=False, nullable=False)
    device = Column(String(200), default="Браузер")

class EmailChallenge(Base):
    __tablename__ = "email_challenges"
    id = Column(String(64), primary_key=True)
    user_id = Column(Integer, nullable=True, index=True)
    email = Column(String(255), nullable=False, index=True)
    purpose = Column(String(40), nullable=False)
    code_hash = Column(String(64), nullable=False)
    payload = Column(Text, default="{}")
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    consumed = Column(Boolean, default=False, nullable=False)

class NotificationPreference(Base):
    __tablename__ = "notification_preferences"
    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    data = Column(Text, default="{}")

class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    endpoint = Column(Text, nullable=False, unique=True)
    data = Column(Text, nullable=False)

class DeliveryReceipt(Base):
    __tablename__ = "delivery_receipts"
    key = Column(String(64), primary_key=True)
    sent_at = Column(DateTime, default=datetime.utcnow)

class RecoveryAction(Base):
    __tablename__ = "recovery_actions"
    id = Column(String(64), primary_key=True)
    user_id = Column(Integer, nullable=False)
    pet_id = Column(Integer, nullable=False)
    data = Column(Text, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    consumed = Column(Boolean, default=False, nullable=False)

class RequestQuota(Base):
    __tablename__ = "request_quotas"
    key = Column(String(100), primary_key=True)
    count = Column(Integer, default=0, nullable=False)


class AdminAudit(Base):
    __tablename__ = "admin_audit"
    id = Column(Integer, primary_key=True)
    actor_id = Column(Integer, nullable=False)
    target_id = Column(Integer, nullable=False)
    action = Column(String(100), nullable=False)
    at = Column(DateTime, default=datetime.utcnow)
