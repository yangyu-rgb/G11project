import asyncio
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from app.api.router import api_router

app = FastAPI(
    title="G11project API",
    version="0.1.0",
    description="G11project 后端服务",
)
app.include_router(api_router, prefix="/api/v1")


@app.websocket("/ws/simulation")
async def simulation_websocket(websocket: WebSocket) -> None:
    """Send an M0 heartbeat until the browser disconnects."""
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(
                {
                    "type": "test",
                    "timestamp": time.time(),
                    "message": "Hello from backend",
                }
            )
            try:
                event = await asyncio.wait_for(websocket.receive(), timeout=1)
            except TimeoutError:
                continue
            if event["type"] == "websocket.disconnect":
                return
    except WebSocketDisconnect:
        return
