# MySQL on REG.RU shared hosting

Use MySQL 8 with InnoDB and utf8mb4. Connections must stay on localhost/127.0.0.1 or a local Unix socket. The web account needs SELECT, INSERT, UPDATE, DELETE only; keep schema-owner credentials outside its environment. A separate SELECT-only account is recommended for backup.py. Runtime permission checks reject DDL, global privileges and GRANT OPTION.

1. Create a new, empty database and dedicated users through ISPmanager. Do not reuse a WordPress database.
2. Keep a private SQLite snapshot and the previous Passenger dispatcher. Stop writes during the final snapshot/import/switch.
3. Put schema-owner credentials in a private migration environment as MIGRATION_DATABASE_URL=mysql+pymysql://USER:PASSWORD@127.0.0.1:3306/DATABASE?charset=utf8mb4. Never commit this file.
4. Install app/requirements.txt, then run Alembic upgrade head with this migration environment. The MySQL migration widens document columns to MEDIUMTEXT and preserves microsecond timestamps and double precision weights. max_allowed_packet must be at least 16 MB for 10 MB uploads.
5. Run `python app/transfer_sqlite.py /private/before-mysql.db --legacy-regru`. The legacy flag adds only known missing fields and service tables to its disposable SQLite copy. The original snapshot stays unchanged. The tool refuses unknown schema changes, nonempty destinations and broken foreign keys. It compares every row count and value checksum in a single destination transaction. MySQL AUTO_INCREMENT advances automatically after explicit IDs.
6. Configure the web environment APP_ENV=production, ENABLE_DEMO_LOGIN=false and a data-only MySQL DATABASE_URL. Keep the existing signing key, VAPID keys and user data. Do not copy migration credentials into this environment.
7. Stage the new release outside the public root, verify import and /api/v1/health, then switch the Passenger dispatcher. Preserve the old release and SQLite snapshot for rollback.
8. backup.py supports MySQL consistent gzip/JSON snapshots. A manifest can be supplied to dump_database(); verify_restore() checks a migrated empty petcare_restore_ destination and compares every restored row/value. Existing PostgreSQL dump/restore remains supported.

MySQL compatibility runs as an additional GitHub CI job, including migration from SQLite. PostgreSQL tests remain enabled.
