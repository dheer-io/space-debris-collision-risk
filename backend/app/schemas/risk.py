from typing import Any
from pydantic import BaseModel


class RiskAssessmentRequest(BaseModel):
    conjunctions: list[dict[str, Any]]
    now: str | None = None