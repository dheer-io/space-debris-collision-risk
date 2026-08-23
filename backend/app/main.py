from fastapi import FastAPI

from backend.app.api.routes import router as system_router
from backend.app.api.propagation import router as propagation_router
from backend.app.api.conjunction import router as conjunction_router
from backend.app.api.risk import router as risk_router


app = FastAPI(
    title="Space Debris Collision Risk API",
    description=(
        "Backend API for orbital propagation, conjunction detection, "
        "and collision risk assessment."
    ),
    version="1.0.0",
)


app.include_router(
    system_router,
    prefix="/api",
)

app.include_router(
    propagation_router,
    prefix="/api",
)

app.include_router(
    conjunction_router,
    prefix="/api",
)

app.include_router(
    risk_router,
    prefix="/api",
)


@app.get("/")
def root():
    return {
        "status": "operational",
        "service": "space-debris-collision-risk-api",
    }