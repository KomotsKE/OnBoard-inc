"""Маршруты аутентификации владельца сайта.

Access-токен отдаётся в теле ответа, refresh — в httpOnly cookie (ADR-0008).
Лимиты частоты — §9.2 docs/vision.md; записи журнала делаются после коммита.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from app.core.config import Settings
from app.core.deps import PanelSession, SettingsDep, current_user
from app.core.errors import RateLimitedError, UnauthorizedError
from app.core.logging import log_event
from app.core.rate_limit import (
    LOGIN_BY_IP,
    LOGIN_FAILURES_BY_EMAIL,
    REFRESH_BY_IP,
    REGISTER_BY_IP,
    RateLimiter,
)
from app.models import User
from app.schemas.auth import Credentials, TokenResponse, UserResponse
from app.services import auth as service

router = APIRouter(prefix="/v1/auth", tags=["auth"])

COOKIE_NAME = "onboard_rt"
# Path сужен до маршрутов аутентификации: cookie не уходит с каждым запросом
# к API, только туда, где она нужна (ADR-0008).
COOKIE_PATH = "/v1/auth"


def _limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _check(limiter: RateLimiter, bucket: str, policy: tuple[int, int]) -> None:
    limit, window = policy
    decision = limiter.allow(bucket, limit, window)
    if not decision.allowed:
        raise RateLimitedError(decision.retry_after_s)


def _set_refresh_cookie(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.refresh_token_ttl_days * 24 * 60 * 60,
        httponly=True,
        # Secure ломает работу по http где-либо кроме localhost, поэтому
        # включается только в прод-окружении (ADR-0008).
        secure=settings.env == "prod",
        samesite="lax",
        path=COOKIE_PATH,
    )


Limiter = Annotated[RateLimiter, Depends(_limiter)]


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: Credentials,
    request: Request,
    response: Response,
    session: PanelSession,
    settings: SettingsDep,
    limiter: Limiter,
) -> TokenResponse:
    _check(limiter, f"register:ip:{_client_ip(request)}", REGISTER_BY_IP)

    issued = await service.register(session, settings, body.email, body.password)
    _set_refresh_cookie(response, settings, issued.refresh_token)
    log_event("user.registered", user_id=str(issued.user.id))
    return TokenResponse(access_token=issued.access_token, expires_in=issued.expires_in)


@router.post("/login", response_model=TokenResponse)
async def login(
    body: Credentials,
    request: Request,
    response: Response,
    session: PanelSession,
    settings: SettingsDep,
    limiter: Limiter,
) -> TokenResponse:
    _check(limiter, f"login:ip:{_client_ip(request)}", LOGIN_BY_IP)
    email_bucket = f"login:email:{body.email}"
    limit, window = LOGIN_FAILURES_BY_EMAIL
    # Счётчик по адресу ведётся по неудачам, поэтому сначала проверяем, не
    # исчерпан ли он, и только потом пробуем пароль.
    if not limiter.allow(email_bucket, limit, window, record=False).allowed:
        raise RateLimitedError(window)

    try:
        issued = await service.login(session, settings, body.email, body.password)
    except UnauthorizedError:
        limiter.allow(email_bucket, limit, window)
        log_event("user.login.failed", level=30, reason="bad_credentials")
        raise

    _set_refresh_cookie(response, settings, issued.refresh_token)
    log_event("user.login.success", user_id=str(issued.user.id))
    return TokenResponse(access_token=issued.access_token, expires_in=issued.expires_in)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    request: Request,
    response: Response,
    session: PanelSession,
    settings: SettingsDep,
    limiter: Limiter,
) -> TokenResponse:
    _check(limiter, f"refresh:ip:{_client_ip(request)}", REFRESH_BY_IP)

    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise UnauthorizedError("нет токена обновления")

    issued = await service.refresh(session, settings, token)
    _set_refresh_cookie(response, settings, issued.refresh_token)
    log_event("auth.refresh.rotated", user_id=str(issued.user.id))
    return TokenResponse(access_token=issued.access_token, expires_in=issued.expires_in)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, session: PanelSession) -> None:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        await service.logout(session, token)
    response.delete_cookie(COOKIE_NAME, path=COOKIE_PATH)
    log_event("user.logout")


me_router = APIRouter(prefix="/v1", tags=["auth"])


@me_router.get("/me", response_model=UserResponse)
async def me(user: Annotated[User, Depends(current_user)]) -> UserResponse:
    return UserResponse(id=str(user.id), email=user.email)
