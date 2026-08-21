from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class KioskLoginInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: str = Field(min_length=1, max_length=256)


@dataclass(frozen=True)
class KioskTokens:
    session_id: UUID
    access_token: str
    access_expires_at: datetime
    refresh_token: str
    refresh_expires_at: datetime


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
    access_expires_at: datetime
    refresh_expires_at: datetime

    @classmethod
    def from_tokens(cls, tokens: KioskTokens) -> "KioskSessionView":
        return cls(
            session_id=tokens.session_id,
            access_expires_at=tokens.access_expires_at,
            refresh_expires_at=tokens.refresh_expires_at,
        )


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
