from datetime import datetime

class PropagationRequest(BaseModel):
    tle_file: str
    timestamp: datetime