from fastapi import APIRouter, HTTPException

from backend.app.schemas.propagation import (
    PropagationRequest,
    TrajectoryRequest,
)
from orbital.propagation.propagator import (
    propagate_from_tle,
    propagate_and_save,
)


router = APIRouter(
    prefix="/propagation",
    tags=["Propagation"],
)


@router.post("/")
def propagate(request: PropagationRequest):
    try:
        result = propagate_from_tle(
            request.tle_file,
            request.timestamp,
        )

        return result

    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )


@router.post("/trajectory")
def generate_trajectory(
    request: TrajectoryRequest,
):
    try:
        result = propagate_and_save(
            tle_file=request.tle_file,
            start_time=request.start_time,
            duration_seconds=request.duration_seconds,
            step_seconds=request.step_seconds,
            output_file=request.output_file,
        )

        return result

    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )