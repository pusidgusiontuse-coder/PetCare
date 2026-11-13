"""Explicit one-time local bootstrap; reads a private configuration, never hardcodes credentials."""
import json,sys
from pathlib import Path
import main,models
from database import SessionLocal
from auth import get_password_hash
from datetime import date

def bootstrap(config):
    with SessionLocal() as db:
        if db.query(models.User).filter(models.User.is_admin==True).first():
            print('Administrator already exists; credentials preserved.'); return
        u=models.User(full_name=config['login'],email='admin@petcare.local',hashed_password=get_password_hash(config['password']),is_admin=True,email_verified=False,premium_permanent=True)
        db.add(u);db.flush()
        db.add(models.Pet(owner_id=u.id,name='Лапа',species='Кошка',breed='Домашняя',birth_date=date(2024,5,1),sex='female',sterilized=True,share_code=models.generate_pet_share_code()))
        db.commit(); print('Administrator and one pet created.')
if __name__=='__main__':
    if len(sys.argv)!=2:raise SystemExit('Usage: bootstrap_admin.py /private/bootstrap-admin.json')
    bootstrap(json.loads(Path(sys.argv[1]).read_text()))
