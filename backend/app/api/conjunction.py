from fastapi import APIRouter, HTTPException

from backend.app.schemas.conjunction import ConjunctionRequest
from orbital.conjunction.detector import detect_conjunctions


router = APIRouter(
    prefix="/conjunctions",
    tags=["Conjunction Detection"],
)


@router.post("/")
def detect(request: ConjunctionRequest):
    try:
        result = detect_conjunctions(
            request.trajectory_files,
            request.threshold_km,
        )

        return result

    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )