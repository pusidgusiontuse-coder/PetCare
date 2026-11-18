"""Consistent MySQL logical backups, with verified restore into an empty database."""
from datetime import date, datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import re

from sqlalchemy import Date, DateTime, create_engine, func, select
from sqlalchemy.engine import make_url
import models
from connection_config import validate_url
from schema import check_schema
from transfer_sqlite import digest_rows


def dump_mysql(url, target, manifest_path=None):
    target=Path(target)
    engine=create_engine(validate_url(url, os.getenv('APP_ENV')=='production'),hide_parameters=True)
    fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    tables={}
    try:
        with os.fdopen(fd,'wb') as raw, gzip.GzipFile(fileobj=raw,mode='wb',mtime=0) as output:
            with engine.connect().execution_options(isolation_level='REPEATABLE READ') as connection:
                connection.exec_driver_sql('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
                for table in models.Base.metadata.sorted_tables:
                    digest=hashlib.sha256(); count=0
                    for row in connection.execute(select(table).order_by(*table.primary_key.columns)).mappings().yield_per(250):
                        values=dict(row)
                        payload=json.dumps(list(values.values()),default=str,ensure_ascii=False,allow_nan=False)
                        digest.update((payload+'\n').encode()); count+=1
                        record=json.dumps({'table':table.name,'values':values},default=str,ensure_ascii=False,allow_nan=False)+'\n'
                        output.write(record.encode())
                    tables[table.name]={'rows':count,'sha256':digest.hexdigest()}
                connection.rollback()
        manifest={'format':'petcare-mysql-json-v1','tables':tables,'source':{'host':engine.url.host,'port':engine.url.port,'database':engine.url.database},'dump_sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
        if manifest_path:
            descriptor=os.open(manifest_path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
            with os.fdopen(descriptor,'w') as output:json.dump(manifest,output,indent=2)
        return manifest
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    finally:engine.dispose()


def restore_mysql(url,dump,manifest):
    parsed=make_url(validate_url(url,os.getenv('APP_ENV')=='production'))
    if not re.fullmatch(r'(?:u\d+_)?petcare_restore_[A-Za-z0-9_]+',parsed.database or ''):
        raise ValueError('Use a dedicated petcare_restore_ database')
    if parsed.database==manifest['source']['database'] and parsed.host==manifest['source']['host']:
        raise ValueError('Restore target must differ from source')
    if hashlib.sha256(Path(dump).read_bytes()).hexdigest()!=manifest['dump_sha256']:raise ValueError('Dump checksum mismatch')
    engine=create_engine(parsed,hide_parameters=True)
    try:
        check_schema(engine)
        with engine.begin() as connection:
            for table in models.Base.metadata.sorted_tables:
                if connection.scalar(select(func.count()).select_from(table)):raise ValueError('Restore destination must contain no application data')
            with gzip.open(dump,'rt',encoding='utf8') as source:
                for line in source:
                    record=json.loads(line); table=models.Base.metadata.tables[record['table']]
                    values=record['values']
                    for column in table.columns:
                        value=values.get(column.name)
                        if value is not None and isinstance(column.type,DateTime):values[column.name]=datetime.fromisoformat(value)
                        elif value is not None and isinstance(column.type,Date):values[column.name]=date.fromisoformat(value)
                    connection.execute(table.insert(),values)
            for table in models.Base.metadata.sorted_tables:
                count,digest=digest_rows(connection,table,list(table.c.keys()))
                if {'rows':count,'sha256':digest}!=manifest['tables'][table.name]:raise RuntimeError('Restore verification failed: '+table.name)
    finally:engine.dispose()
