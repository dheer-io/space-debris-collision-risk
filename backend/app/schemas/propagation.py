from datetime import datetime

from pydantic import BaseModel


class PropagationRequest(BaseModel):
    tle_file: str
    timestamp: datetime


class TrajectoryRequest(BaseModel):
    tle_file: str
    start_time: datetime
    duration_seconds: int = 5400
    step_seconds: int = 600
    output_file: str