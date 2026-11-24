from datetime import datetime, timedelta
from typing import Optional
import re
import uuid
import bcrypt
import jwt
from jwt import InvalidTokenError
from fastapi import Depends, HTTPException, status, Request, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from database import get_db, SessionLocal
import models

from settings import PRODUCTION, SECRET_KEY
ALGORITHM = "HS256"
DUMMY_PASSWORD_HASH = bcrypt.hashpw(b'not-an-account-password', bcrypt.gensalt()).decode()
SESSION_TTL = timedelta(hours=8)
ADMIN_SESSION_TTL = timedelta(hours=2)
SESSION_COOKIE = '__Host-petcare_session' if PRODUCTION else 'petcare_session'
SESSION_HINT = 'petcare_signed_in'
BROWSER_HEADER = 'X-PetCare-Browser'

security = HTTPBearer(auto_error=False)


def session_response(request: Request, response: Response, token: str, user, ttl=SESSION_TTL):
    if request.headers.get(BROWSER_HEADER) != '1':
        return {'access_token': token, 'token_type': 'bearer', 'user': user}
    options = dict(max_age=int(ttl.total_seconds()), secure=PRODUCTION, samesite='strict', path='/')
    response.set_cookie(SESSION_COOKIE, token, httponly=True, **options)
    response.set_cookie(SESSION_HINT, '1', **options)
    return {'user': user}


def clear_browser_session(response: Response):
    response.delete_cookie(SESSION_COOKIE, secure=PRODUCTION, httponly=True, samesite='strict')
    response.delete_cookie(SESSION_HINT, secure=PRODUCTION, samesite='strict')

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
    expiry=datetime.utcnow()+(expires_delta or SESSION_TTL)
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
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db)
) -> models.User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Не удалось подтвердить учетные данные",
        headers={"WWW-Authenticate": "Bearer"},
    )
    token = credentials.credentials if credentials else request.cookies.get(SESSION_COOKIE)
    if not token:
        raise credentials_exception
    if credentials is None and request.method not in {'GET', 'HEAD', 'OPTIONS'}:
        if request.headers.get(BROWSER_HEADER) != '1':
            raise HTTPException(403, 'Запрос браузера не прошёл проверку CSRF')
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM],
                             options={'require': ['sub', 'exp', 'jti', 'ver']})
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_exception
        user_id_int = int(user_id)
    except (InvalidTokenError, ValueError, TypeError):
        raise credentials_exception

    user = db.query(models.User).filter(models.User.id == user_id_int).first()
    if user is None or user.disabled or payload.get("ver") != user.token_version:
        raise credentials_exception
    session=db.get(models.LoginSession,payload.get("jti", ""))
    if not session or session.user_id!=user.id or session.revoked or session.expires_at<=datetime.utcnow():
        raise credentials_exception
    ttl = ADMIN_SESSION_TTL if user.is_admin else SESSION_TTL
    if not session.created_at or session.created_at + ttl <= datetime.utcnow():
        raise credentials_exception
    request.state.session_id=session.id
    return user
