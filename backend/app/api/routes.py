from fastapi import APIRouter


router = APIRouter()


@router.get("/health")
def health_check():
    return {
        "status": "healthy",
    }


@router.get("/status")
def system_status():
    return {
        "status": "operational",
        "services": {
            "api": "operational",
            "orbital_propagation": "available",
            "conjunction_detection": "available",
            "risk_assessment": "available",
        },
    }