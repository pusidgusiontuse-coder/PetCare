from datetime import datetime, timedelta
from typing import Optional
import re
import uuid
import bcrypt
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from database import get_db, SessionLocal
import models

from settings import SECRET_KEY
ALGORITHM = "HS256"
DUMMY_PASSWORD_HASH = bcrypt.hashpw(b'not-an-account-password', bcrypt.gensalt()).decode()
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30  # 30 дней

security = HTTPBearer()

def get_password_hash(password: str) -> str:
    pwd_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        if not plain_password or len(plain_password.encode('utf-8')) > 72 or not isinstance(hashed_password, str):
            return False
    except (UnicodeError, AttributeError):
        return False
    if not re.fullmatch(r"\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}", hashed_password):
        return False
    try:
        pwd_bytes = plain_password.encode('utf-8')
        hash_bytes = hashed_password.encode('utf-8')
        return bcrypt.checkpw(pwd_bytes, hash_bytes)
    except (ValueError, TypeError):
        return False

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None, device: str = "Браузер", ip_address: str | None = None, *, expected_version: int | None = None) -> str:
    claims=data.copy()
    expiry=datetime.utcnow()+(expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    sid=uuid.uuid4().hex
    with SessionLocal() as db:
        user=db.get(models.User,int(claims["sub"]))
        if expected_version is not None and (not user or user.disabled or user.token_version != expected_version):
            raise HTTPException(401, "Войдите снова")
        claims.update(exp=expiry,jti=sid,ver=user.token_version if user else 0)
        db.add(models.LoginSession(id=sid,user_id=int(claims["sub"]),expires_at=expiry,device=device,ip_address=ip_address))
        db.commit()
    return jwt.encode(claims,SECRET_KEY,algorithm=ALGORITHM)

def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> models.User:
    token = credentials.credentials
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Не удалось подтвердить учетные данные",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_exception
        user_id_int = int(user_id)
    except (JWTError, ValueError, TypeError):
        raise credentials_exception

    user = db.query(models.User).filter(models.User.id == user_id_int).first()
    if user is None or user.disabled or payload.get("ver") != user.token_version:
        raise credentials_exception
    session=db.get(models.LoginSession,payload.get("jti", ""))
    if not session or session.user_id!=user.id or session.revoked or session.expires_at<=datetime.utcnow():
        raise credentials_exception
    request.state.session_id=session.id
    return user
