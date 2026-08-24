from dataclasses import dataclass
from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class KioskLoginInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device_name: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=80),
    ]
    password: str = Field(min_length=1, max_length=256)


@dataclass(frozen=True)
class KioskTokens:
    session_id: UUID
    access_token: str
    access_expires_at: datetime
    refresh_token: str
    refresh_expires_at: datetime
    device_name: str = "공용 키오스크"


@dataclass(frozen=True)
class QrChallenge:
    kiosk_session_id: UUID
    issued_at: datetime
    expires_at: datetime
    nonce: UUID


@dataclass(frozen=True)
class IssuedQrChallenge:
    token: str
    challenge: QrChallenge


class KioskSessionView(BaseModel):
    session_id: UUID
    device_name: str
    access_expires_at: datetime
    refresh_expires_at: datetime

    @classmethod
    def from_tokens(cls, tokens: KioskTokens) -> "KioskSessionView":
        return cls(
            session_id=tokens.session_id,
            device_name=tokens.device_name,
            access_expires_at=tokens.access_expires_at,
            refresh_expires_at=tokens.refresh_expires_at,
        )


class AdminKioskSessionView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    session_id: UUID
    device_name: str
    created_at: datetime
    last_seen_at: datetime
    refresh_expires_at: datetime
    revoked_at: datetime | None


class KioskSessionListFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cursor: Annotated[str, StringConstraints(min_length=1, max_length=2048)] | None = None
    page_size: int = Field(default=50, ge=1, le=100)


class AdminKioskSessionPage(BaseModel):
    items: list[AdminKioskSessionView]
    next_cursor: str | None
    page_size: int = Field(ge=1, le=100)


class QrChallengeView(BaseModel):
    token: str
    issued_at: datetime
    expires_at: datetime

    @classmethod
    def from_issued(cls, issued: IssuedQrChallenge) -> "QrChallengeView":
        return cls(
            token=issued.token,
            issued_at=issued.challenge.issued_at,
            expires_at=issued.challenge.expires_at,
        )
