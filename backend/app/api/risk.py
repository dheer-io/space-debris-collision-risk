from fastapi import APIRouter, HTTPException

from backend.app.schemas.risk import RiskAssessmentRequest
from orbital.risk.risk_assessment import assess_conjunctions


router = APIRouter(
    prefix="/risk",
    tags=["Risk Assessment"],
)


@router.post("/")
def assess(request: RiskAssessmentRequest):
    try:
        result = assess_conjunctions(
            request.conjunctions,
            now=request.now,
        )

        return result

    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )