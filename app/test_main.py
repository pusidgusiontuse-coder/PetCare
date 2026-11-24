import base64
import json
import unittest
import warnings
from datetime import timedelta
from unittest.mock import AsyncMock, patch

warnings.simplefilter("ignore")

from fastapi.testclient import TestClient
import jwt

import auth
import main
import models


class TestAuthSecurity(unittest.TestCase):
    """Тесты безопасности авторизации: хеширование паролей с солью и проверка JWT-токенов"""

    def setUp(self):
        self.client = TestClient(main.app)
        resp = self.client.post("/api/v1/auth/demo-login/1")
        self.assertEqual(resp.status_code, 200)
        self.user_id = resp.json()["user"]["id"]

    def test_password_saved_as_hash_with_unique_salt(self):
        """Пароль сохраняется как хеш с новой случайной солью при каждом вызове"""
        first = auth.get_password_hash("correct horse battery staple")
        second = auth.get_password_hash("correct horse battery staple")

        self.assertRegex(first, r"^\$2[aby]\$\d{2}\$.{53}$")
        self.assertNotEqual(first, second)
        self.assertTrue(auth.verify_password("correct horse battery staple", first))
        self.assertFalse(auth.verify_password("wrong password", first))

    def test_malformed_hashes_are_rejected(self):
        """Повреждённые и некорректные хеши безопасно отвергаются"""
        valid_hash = auth.get_password_hash("x")
        malformed_hashes = [
            "",
            "plain-text",
            "scrypt$bad$bad",
            "$2b$12$bad",
            valid_hash[:20],
        ]
        for malformed in malformed_hashes:
            self.assertFalse(auth.verify_password("x", malformed))

    def test_signed_token_returns_user_id(self):
        """Подписанный токен возвращает идентификатор пользователя, чужой секрет отвергается"""
        token = auth.create_access_token({"sub": str(self.user_id)})
        resp = self.client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["id"], self.user_id)

        wrong_secret_token = jwt.encode(
            {"sub": str(self.user_id)},
            "another-secret-that-is-invalid",
            algorithm=auth.ALGORITHM,
        )
        resp_wrong = self.client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {wrong_secret_token}"},
        )
        self.assertEqual(resp_wrong.status_code, 401)

    def test_tampered_and_expired_tokens_are_rejected(self):
        """Подделанный и истёкший токены отвергаются"""
        token = auth.create_access_token({"sub": str(self.user_id)})
        header_b64, payload_b64, signature_b64 = token.split(".")

        # Подмена полезной нагрузки (sub) без пересчёта подписи
        altered_payload = (
            base64.urlsafe_b64encode(json.dumps({"sub": "999999"}).encode("utf-8"))
            .decode("utf-8")
            .rstrip("=")
        )
        tampered_token = f"{header_b64}.{altered_payload}.{signature_b64}"
        resp_tampered = self.client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {tampered_token}"},
        )
        self.assertEqual(resp_tampered.status_code, 401)

        # Истёкший токен
        expired_token = auth.create_access_token(
            {"sub": str(self.user_id)},
            expires_delta=timedelta(seconds=-10),
        )
        resp_expired = self.client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {expired_token}"},
        )
        self.assertEqual(resp_expired.status_code, 401)

        # Повреждённая подпись
        resp_extra_sig = self.client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {header_b64}.{payload_b64}.{signature_b64}extra"},
        )
        self.assertEqual(resp_extra_sig.status_code, 401)

    def test_invalid_header_and_invalid_subject_are_rejected(self):
        """Неверный заголовок авторизации и некорректный sub в токене отвергаются"""
        # Без заголовка
        resp_none = self.client.get("/api/v1/auth/me")
        self.assertIn(resp_none.status_code, (401, 403))

        # Неверная схема Basic вместо Bearer
        resp_basic = self.client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Basic abc"},
        )
        self.assertIn(resp_basic.status_code, (401, 403))

        # Невалидный JWT
        resp_invalid = self.client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer invalid"},
        )
        self.assertEqual(resp_invalid.status_code, 401)

        # Токен с нечисловым идентификатором субъекта (sub: "not-a-user")
        bad_sub_token = jwt.encode({"sub": "not-a-user"}, auth.SECRET_KEY, algorithm=auth.ALGORITHM)
        resp_bad_sub = self.client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {bad_sub_token}"},
        )
        self.assertEqual(resp_bad_sub.status_code, 401)


class TestPetCareCoreAPI(unittest.TestCase):
    """Общие интеграционные и unit-тесты всех ключевых модулей PetCare для сдачи проекта"""

    def setUp(self):
        self.client = TestClient(main.app)
        resp1 = self.client.post("/api/v1/auth/demo-login/1")
        self.assertEqual(resp1.status_code, 200)
        self.headers1 = {"Authorization": f"Bearer {resp1.json()['access_token']}"}

        resp2 = self.client.post("/api/v1/auth/demo-login/2")
        self.assertEqual(resp2.status_code, 200)
        self.headers2 = {"Authorization": f"Bearer {resp2.json()['access_token']}"}

    def test_healthcheck_and_demo_accounts(self):
        """Проверка работоспособности сервера (/api/v1/health) и демо-аккаунтов"""
        health = self.client.get("/api/v1/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["status"], "ok")

        pets1 = self.client.get("/api/v1/pets", headers=self.headers1).json()
        pet_names1 = {p["name"] for p in pets1}
        self.assertIn("Барсик", pet_names1)
        self.assertIn("Луна", pet_names1)

        pets2 = self.client.get("/api/v1/pets", headers=self.headers2).json()
        pet_names2 = {p["name"] for p in pets2}
        self.assertIn("Рекс", pet_names2)
        self.assertIn("Майло", pet_names2)

    def test_pet_crud_and_shared_access_by_code(self):
        """Создание питомца, редактирование карточки и подключение совладельца по коду"""
        create_resp = self.client.post(
            "/api/v1/pets",
            headers=self.headers1,
            json={
                "name": "Оскар",
                "species": "Кот",
                "breed": "Мейн-кун",
                "birth_date": "2024-02-10",
                "sex": "Самец",
                "sterilized": True,
            },
        )
        self.assertEqual(create_resp.status_code, 201)
        pet = create_resp.json()
        pet_id = pet["id"]
        share_code = pet["share_code"]
        self.assertTrue(bool(share_code))

        # Обновление данных питомца
        upd_resp = self.client.patch(
            f"/api/v1/pets/{pet_id}",
            headers=self.headers1,
            json={"notes": "Любит активные игры"},
        )
        self.assertEqual(upd_resp.status_code, 200)
        self.assertEqual(upd_resp.json()["notes"], "Любит активные игры")

        # Второй пользователь подключается к питомцу по коду совместного ухода
        join_resp = self.client.post(
            "/api/v1/pets/join-by-code",
            headers=self.headers2,
            json={"invite_code": share_code},
        )
        self.assertEqual(join_resp.status_code, 200)
        self.assertTrue(join_resp.json()["is_shared"])

        # Удаление тестового питомца владельцем
        del_resp = self.client.delete(f"/api/v1/pets/{pet_id}", headers=self.headers1)
        self.assertEqual(del_resp.status_code, 204)

    def test_health_records_weights_and_auto_reminders(self):
        """Добавление вакцинации с весом автоматически обновляет историю веса и создаёт напоминание"""
        pets = self.client.get("/api/v1/pets", headers=self.headers1).json()
        pet_id = pets[0]["id"]

        rec_resp = self.client.post(
            f"/api/v1/pets/{pet_id}/health-records",
            headers=self.headers1,
            json={
                "record_type": "vaccination",
                "event_date": "2026-05-01",
                "title": "Комплексная вакцинация Нобивак",
                "weight": 4.8,
                "clinic": "ВетДруг",
            },
        )
        self.assertEqual(rec_resp.status_code, 201)
        rec_id = rec_resp.json()["id"]

        # Проверяем, что вес записался
        weights = self.client.get(f"/api/v1/pets/{pet_id}/weights", headers=self.headers1).json()
        self.assertTrue(any(abs(w["kg"] - 4.8) < 0.01 for w in weights))

        # Проверяем, что создалось напоминание на повтор вакцинации
        reminders = self.client.get("/api/v1/reminders", headers=self.headers1).json()
        self.assertTrue(any("Нобивак" in r["title"] for r in reminders))

        # Очистка созданной записи
        self.client.delete(f"/api/v1/health-records/{rec_id}", headers=self.headers1)

    def test_nutrition_meal_plans_and_shopping_list(self):
        """Проверка расписания кормлений, дневника кормов и списка покупок"""
        pets = self.client.get("/api/v1/pets", headers=self.headers1).json()
        pet_id = pets[0]["id"]

        # 1. План кормления
        plan_resp = self.client.post(
            f"/api/v1/pets/{pet_id}/meal-plans",
            headers=self.headers1,
            json={"food": "Влажный пауч с индейкой", "time": "09:00"},
        )
        self.assertEqual(plan_resp.status_code, 201)
        plan_id = plan_resp.json()["id"]

        toggle_plan = self.client.patch(
            f"/api/v1/meal-plans/{plan_id}/toggle?completed_on=2026-10-18",
            headers=self.headers1,
        )
        self.assertEqual(toggle_plan.status_code, 200)
        self.assertEqual(toggle_plan.json()["completed_on"], "2026-10-18")
        self.client.delete(f"/api/v1/meal-plans/{plan_id}", headers=self.headers1)

        # 2. Список покупок
        shop_resp = self.client.post(
            f"/api/v1/pets/{pet_id}/shopping",
            headers=self.headers1,
            json={"title": "Наполнитель комкующийся", "quantity": "10 л"},
        )
        self.assertEqual(shop_resp.status_code, 201)
        item_id = shop_resp.json()["id"]

        toggle_shop = self.client.patch(
            f"/api/v1/shopping/{item_id}/toggle",
            headers=self.headers1,
        )
        self.assertEqual(toggle_shop.status_code, 200)
        self.assertTrue(toggle_shop.json()["is_done"])
        self.client.delete(f"/api/v1/shopping/{item_id}", headers=self.headers1)

    def test_pet_dating_matching_and_recommendations(self):
        """Проверка алгоритма подбора пар и анкет знакомств питомцев"""
        self.assertEqual(main._species_group("Кот"), "cat")
        self.assertEqual(main._species_group("Вельш-корги"), "dog")

        pets = self.client.get("/api/v1/pets", headers=self.headers1).json()
        pet_id = pets[0]["id"]

        prof_resp = self.client.post(
            f"/api/v1/pets/{pet_id}/match-profile",
            headers=self.headers1,
            json={
                "name": "Барсик",
                "species": "Кот",
                "breed": "Британская короткошёрстная",
                "birth_date": "2023-08-16",
                "sex": "Самец",
                "vaccinated": "Да, все по возрасту",
                "sterilized": "Да",
                "purpose": "Дружба и совместные игры",
                "city": "Москва",
                "bio": "Спокойный домашний кот",
                "owner_name": "Илья",
                "owner_contact": "@ilya_barsik",
            },
        )
        self.assertEqual(prof_resp.status_code, 200)

        reset_resp = self.client.post(
            f"/api/v1/pets/{pet_id}/match-reset", headers=self.headers1
        )
        self.assertEqual(reset_resp.status_code, 200)

        match_data = self.client.get(
            f"/api/v1/pets/{pet_id}/match-data", headers=self.headers1
        ).json()
        self.assertIsNotNone(match_data["my_profile"])
        self.assertEqual(match_data["my_profile"]["name"], "Барсик")
        total_profiles = len(match_data["recommendations"]) + match_data.get("swiped_count", 0)
        # Production discovery excludes synthetic profiles without a real owner/pet.
        self.assertTrue(all(x.get("pet_id") and x.get("owner_id") for x in match_data["recommendations"]))

    def test_document_recognition_endpoint(self):
        """Базовая проверка эндпоинта распознавания документов (валидация формата и ответ)"""
        from database import SessionLocal
        with SessionLocal() as db:
            u=db.query(models.User).filter(models.User.email=="demo1@petcare.app").first()
            u.premium_permanent=True
            db.commit()
        bad_resp = self.client.post(
            "/api/v1/documents/recognize",
            headers=self.headers1,
            files={"file": ("note.txt", b"text", "text/plain")},
        )
        self.assertEqual(bad_resp.status_code, 415)

        with patch(
            "main.recognize_text",
            new=AsyncMock(return_value="Паспорт питомца: прививка от бешенства"),
        ), patch("main.require_ocr_configuration", return_value=("test-key", "test/vision:free")):
            ok_resp = self.client.post(
                "/api/v1/documents/recognize",
                headers=self.headers1,
                files={"file": ("passport.png", __import__("test_security_features").valid_image(), "image/png")},
            )
        self.assertEqual(ok_resp.status_code, 200)
        self.assertEqual(ok_resp.json(), {"text": "Паспорт питомца: прививка от бешенства"})


if __name__ == "__main__":
    unittest.main()
