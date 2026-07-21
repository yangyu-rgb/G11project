from fastapi import FastAPI

from app.api.router import api_router

app = FastAPI(
    title="G11project API",
    version="0.1.0",
    description="G11project 后端服务",
)
app.include_router(api_router, prefix="/api/v1")
