"""Схемы аутентификации.

Email проверяется своим выражением, а не `EmailStr`: тот требует пакет
email-validator, которого нет в согласованном наборе зависимостей, а нам нужна
нормализация к нижнему регистру и отсечение явного мусора.
"""

import re
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")

# Длина пароля — §5.1 docs/data-model.md. Требований к составу нет: NIST
# запрещает их, они не добавляют стойкости и выгоняют людей в «Password1!».
PASSWORD_MIN = 15
PASSWORD_MAX = 128


class Credentials(BaseModel):
    email: Annotated[str, Field(min_length=3, max_length=254)]
    password: Annotated[str, Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)]

    @field_validator("email")
    @classmethod
    def normalise_email(cls, value: str) -> str:
        email = value.strip().lower()
        if not EMAIL_RE.match(email):
            raise ValueError("некорректный адрес электронной почты")
        return email


class TokenResponse(BaseModel):
    access_token: str
    expires_in: int


class UserResponse(BaseModel):
    id: str
    email: str
