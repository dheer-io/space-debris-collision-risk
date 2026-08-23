from pydantic import BaseModel


class ConjunctionRequest(BaseModel):
    trajectory_files: list[str]
    threshold_km: float