from datetime import date as date_type, datetime as datetime_type
from decimal import Decimal
from typing import Annotated, List, Optional
from pydantic import BaseModel, Field, model_validator, field_validator
from uploads import validate_attachment, MAX_PHOTO_BYTES, safe_stored_url

# ----------------- ПОЛЬЗОВАТЕЛЬ -----------------

class UserRegister(BaseModel):
    full_name: str = Field(..., min_length=1)
    email: str = Field(..., min_length=3)
    password: str = Field(..., min_length=4)
    timezone: str = "Europe/Moscow"

class UserLogin(BaseModel):
    email: str
    password: str

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    timezone: Optional[str] = None
    password: Optional[str] = None

class UserOut(BaseModel):
    id: int
    full_name: str
    email: str
    timezone: str

    class Config:
        from_attributes = True

# ----------------- НАПОМИНАНИЯ И СОБЫТИЯ -----------------

class ReminderBase(BaseModel):
    title: str
    reminder_type: str = "procedure"
    due_date: date_type
    due_time: Optional[str] = None
    at: Optional[str] = None
    interval_days: Optional[int] = None
    interval_months: Optional[int] = None
    food: Optional[str] = None

class ReminderCreate(ReminderBase):
    status: Optional[str] = "pending"

class ReminderAction(BaseModel):
    status: Optional[str] = None  # completed, skipped, pending
    done_by: Optional[str] = None
    at: Optional[str] = None
    due_date: Optional[date_type] = None

class ReminderOut(ReminderBase):
    undo_token: Optional[str] = None
    id: int
    pet_id: int
    status: Optional[str] = "pending"
    is_completed: bool
    done_by: Optional[str] = None
    completed_at: Optional[datetime_type] = None

    class Config:
        from_attributes = True

# ----------------- ЗДОРОВЬЕ -----------------

class HealthRecordBase(BaseModel):
    record_type: str
    event_date: date_type
    title: str
    weight: Optional[float] = None
    vet_conclusion: Optional[str] = None
    medicine_name: Optional[str] = None
    clinic: Optional[str] = None
    doctor: Optional[str] = None
    result: Optional[str] = None
    comment: Optional[str] = None
    next_date: Optional[date_type] = None
    file_name: Optional[str] = None

class HealthRecordCreate(HealthRecordBase):
    file_data: Optional[str] = None

    @model_validator(mode='after')
    def validate_file(self):
        self.file_data, self.file_name = validate_attachment(self.file_data, self.file_name)
        return self

class HealthRecordOut(HealthRecordBase):
    has_attachment: bool

    id: int
    pet_id: int

    class Config:
        from_attributes = True

class WeightCreate(BaseModel):
    date: date_type
    kg: float = Field(gt=0, allow_inf_nan=False)

class WeightOut(WeightCreate):
    id: int
    pet_id: int

    class Config:
        from_attributes = True

class PrescriptionCreate(BaseModel):
    name: str
    dose: Optional[str] = None
    start_date: date_type
    duration: Optional[str] = None
    times: Optional[str] = None
    status: Optional[str] = "Активно"

class PrescriptionOut(PrescriptionCreate):
    id: int
    pet_id: int

    class Config:
        from_attributes = True

# ----------------- ПИТАНИЕ -----------------

ClockTime = Annotated[str, Field(pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")]


class MealPlanBase(BaseModel):
    food: str
    time: str
    end_time: Optional[str] = None
    notes: Optional[str] = None

class MealPlanCreate(MealPlanBase):
    time: ClockTime
    end_time: Optional[ClockTime] = None


class MealPlanOut(MealPlanBase):
    id: int
    pet_id: int
    completed_on: Optional[str] = None

    class Config:
        from_attributes = True

class FeedingLogCreate(BaseModel):
    food: str
    amount: Optional[str] = None
    notes: Optional[str] = None
    meal_plan_id: Optional[int] = None
    reminder_id: Optional[int] = None
    completion_day: Optional[str] = None
    actor: Optional[str] = "Владелец"
    at: Optional[datetime_type] = None

class FeedingLogOut(FeedingLogCreate):
    id: int
    pet_id: int
    at: datetime_type

    class Config:
        from_attributes = True

class NutritionLogBase(BaseModel):
    food_name: str
    brand: Optional[str] = None
    kind: Optional[str] = "food"
    liked: Optional[str] = "unknown"
    tolerated: Optional[str] = "unknown"
    adverse_reactions: Optional[str] = None
    price: Optional[float] = None
    notes: Optional[str] = None
    date: Optional[date_type] = None

class NutritionLogCreate(NutritionLogBase):
    price: Optional[float] = Field(default=None, ge=0, lt=1_000_000_000_000, allow_inf_nan=False)

    @field_validator("price")
    @classmethod
    def validate_price_precision(cls, value: Optional[float]) -> Optional[float]:
        if value is not None and Decimal(str(value)).normalize().as_tuple().exponent < -2:
            raise ValueError("Цена должна содержать не более двух знаков после запятой")
        return value

class NutritionLogOut(NutritionLogBase):
    id: int
    pet_id: int
    created_at: datetime_type

    class Config:
        from_attributes = True

# ----------------- ДОКУМЕНТЫ -----------------

class DocumentBase(BaseModel):
    title: str
    doc_type: str = "other"
    date: date_type
    file_name: Optional[str] = None

class DocumentCreate(DocumentBase):
    file_data: Optional[str] = None

    @model_validator(mode='after')
    def validate_file(self):
        self.file_data, self.file_name = validate_attachment(self.file_data, self.file_name)
        return self

class DocumentOut(DocumentBase):
    has_attachment: bool

    id: int
    pet_id: int

    class Config:
        from_attributes = True

# ----------------- ПОКУПКИ -----------------

class ShoppingCreate(BaseModel):
    title: str
    quantity: Optional[str] = None

class ShoppingOut(ShoppingCreate):
    id: int
    pet_id: int
    is_done: bool
    bought_by: Optional[str] = None

    class Config:
        from_attributes = True

# ----------------- ЖУРНАЛ ДЕЙСТВИЙ (ACTIVITY) -----------------

class ActivityCreate(BaseModel):
    action: str
    actor: Optional[str] = "Владелец"
    icon: Optional[str] = "🐾"
    at: Optional[datetime_type] = None

class ActivityOut(ActivityCreate):
    id: int
    pet_id: int
    at: datetime_type

    class Config:
        from_attributes = True

# ----------------- ПИТОМЕЦ -----------------

class PetBase(BaseModel):
    name: str
    species: str
    breed: str = "Метис"
    birth_date: date_type
    sex: Optional[str] = None
    sterilized: bool = False
    microchip_number: Optional[str] = None
    notes: Optional[str] = None
    marks: Optional[str] = None
    photo_file_id: Optional[str] = None
    clinic_url: Optional[str] = None
    doctor_name: Optional[str] = None
    avatar_bg: Optional[str] = "lavender"
    avatar_accessory: Optional[str] = "none"
    share_code: Optional[str] = None

class PetCreate(PetBase):
    @model_validator(mode='after')
    def validate_photo(self):
        self.photo_file_id, _ = validate_attachment(self.photo_file_id, images_only=True, limit=MAX_PHOTO_BYTES)
        return self

class PetJoinByCode(BaseModel):
    invite_code: str

class PetUpdate(BaseModel):
    name: Optional[str] = None
    species: Optional[str] = None
    breed: Optional[str] = None
    birth_date: Optional[date_type] = None
    sex: Optional[str] = None
    sterilized: Optional[bool] = None
    microchip_number: Optional[str] = None
    notes: Optional[str] = None
    marks: Optional[str] = None
    photo_file_id: Optional[str] = None
    clinic_url: Optional[str] = None
    doctor_name: Optional[str] = None
    avatar_bg: Optional[str] = None
    avatar_accessory: Optional[str] = None

    @model_validator(mode='after')
    def validate_photo(self):
        self.photo_file_id, _ = validate_attachment(self.photo_file_id, images_only=True, limit=MAX_PHOTO_BYTES)
        return self

class PetOut(PetBase):
    @field_validator('photo_file_id')
    @classmethod
    def safe_photo(cls, value): return safe_stored_url(value, image=True)

    id: int
    owner_id: int
    share_code: Optional[str] = None
    is_shared: Optional[bool] = False

    class Config:
        from_attributes = True

class PetDetailOut(PetBase):
    @field_validator('photo_file_id')
    @classmethod
    def safe_photo(cls, value): return safe_stored_url(value, image=True)

    id: int
    owner_id: int
    share_code: Optional[str] = None
    is_shared: Optional[bool] = False
    health_records: List[HealthRecordOut] = []
    nutrition_logs: List[NutritionLogOut] = []
    reminders: List[ReminderOut] = []
    meal_plans: List[MealPlanOut] = []
    feeding_logs: List[FeedingLogOut] = []
    weights: List[WeightOut] = []
    prescriptions: List[PrescriptionOut] = []
    documents: List[DocumentOut] = []
    shopping_items: List[ShoppingOut] = []
    activities: List[ActivityOut] = []

    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class MatchProfileCreate(BaseModel):
    name: str
    species: str
    breed: Optional[str] = "Метис"
    birth_date: Optional[str] = None
    sex: Optional[str] = "Неизвестно"
    vaccinated: Optional[str] = "Не указано"
    sterilized: Optional[str] = "Нет"
    purpose: Optional[str] = "Совместные прогулки и игры"
    city: Optional[str] = ""
    bio: Optional[str] = None
    owner_name: Optional[str] = "Владелец"
    owner_contact: str
    photo: Optional[str] = None
    photos: Optional[List[str]] = Field(default=None, max_length=5)
    is_published: Optional[bool] = True


    @model_validator(mode='after')
    def validate_photo(self):
        self.photo, _ = validate_attachment(self.photo, images_only=True, limit=MAX_PHOTO_BYTES)
        if self.photos is not None:
            if any(not photo for photo in self.photos):
                raise ValueError("Фото не должно быть пустым")
            self.photos = [validate_attachment(photo, images_only=True, limit=MAX_PHOTO_BYTES)[0] for photo in self.photos]
            if sum(len(payload) * 3 // 4 - (len(payload) - len(payload.rstrip("="))) for payload in (photo.split(",", 1)[1] for photo in self.photos)) > MAX_PHOTO_BYTES:
                raise ValueError("Все фото анкеты вместе должны быть не больше 10 МБ")
        return self

class MatchDecisionCreate(BaseModel):
    target_profile_id: int
    decision: str  # 'like' or 'skip'


# PetMatch photos also enter browser image elements.
