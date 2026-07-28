from fastapi import APIRouter

from app.api.routes.demo import router as demo_router
from app.api.routes.copilot import router as copilot_router
from app.api.routes.experiments import router as experiments_router
from app.api.routes.health import router as health_router
from app.api.routes.scenarios import router as scenarios_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
api_router.include_router(demo_router, tags=["demo"])
api_router.include_router(scenarios_router, tags=["scenarios"])
api_router.include_router(experiments_router, tags=["experiments"])
api_router.include_router(copilot_router, tags=["copilot"])
