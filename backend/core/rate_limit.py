from dataclasses import dataclass
from datetime import timedelta


@dataclass(frozen=True)
class RateLimitPolicy:
    action: str
    window: timedelta
    attempt_limit: int
    block_for: timedelta


KIOSK_LOGIN_RATE_LIMIT = RateLimitPolicy(
    action="kiosk.login",
    window=timedelta(minutes=5),
    attempt_limit=5,
    block_for=timedelta(minutes=15),
)
