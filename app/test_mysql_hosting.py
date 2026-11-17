"""MySQL-specific transfer checks against a disposable CI database."""
from datetime import datetime, date
import os
import uuid

from alembic import command
import pytest
from sqlalchemy import create_engine, select, text
from database import engine
from schema import migration_config
from transfer_sqlite import transfer
import models


@pytest.mark.skipif(engine.dialect.name != 'mysql' or os.getenv('PETCARE_MYSQL_INTEGRATION')!='true', reason='Requires isolated MySQL CI service')
def test_sqlite_to_mysql_preserves_values_and_large_files(tmp_path):
    name='petcare_transfer_'+uuid.uuid4().hex
    with engine.begin() as connection:
        connection.execute(text('CREATE DATABASE `'+name+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'))
    target=create_engine(engine.url.set(database=name))
    try:
        with target.begin() as connection:
            config=migration_config();config.attributes['connection']=connection
            command.upgrade(config,'head')
        path=tmp_path/'legacy-copy.db'
        source=create_engine('sqlite:///'+str(path))
        models.Base.metadata.create_all(source)
        stamp=datetime(2026,11,17,12,15,16,123456)
        with source.begin() as connection:
            connection.execute(models.User.__table__.insert().values(id=41,full_name='Проверка 🐾',email='mysql@example.test',hashed_password='unchanged-hash',created_at=stamp))
            connection.execute(models.Pet.__table__.insert().values(id=42,owner_id=41,name='Барсик',species='Кошка'))
            connection.execute(models.WeightRecord.__table__.insert().values(pet_id=42,date=date(2026,11,17),kg=4.123456789))
            connection.execute(models.Document.__table__.insert().values(pet_id=42,title='Большой документ',date=date(2026,11,17),file_data='x'*(2*1024*1024)))
        source.dispose()
        report=transfer(path,target)
        assert report['users']['rows']==1
        with target.begin() as connection:
            assert connection.scalar(select(models.User.created_at))==stamp
            assert len(connection.scalar(select(models.Document.file_data)))==2*1024*1024
            assert connection.scalar(select(models.WeightRecord.kg))==4.123456789
            created=connection.execute(models.User.__table__.insert().values(full_name='Новый',email='next@example.test',hashed_password='hash'))
            assert created.inserted_primary_key[0]==42
    finally:
        target.dispose()
        with engine.begin() as connection:connection.execute(text('DROP DATABASE `'+name+'`'))
