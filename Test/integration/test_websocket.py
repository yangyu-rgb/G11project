"""Integration coverage for the M0 simulation WebSocket."""

from fastapi.testclient import TestClient

from app.main import app


def test_simulation_websocket_sends_test_message() -> None:
    with TestClient(app).websocket_connect("/ws/simulation") as websocket:
        message = websocket.receive_json()

    assert message["type"] == "test"
    assert isinstance(message["timestamp"], float)
    assert message["message"] == "Hello from backend"


def test_simulation_websocket_accepts_a_new_connection_after_disconnect() -> None:
    client = TestClient(app)
    for _ in range(2):
        with client.websocket_connect("/ws/simulation") as websocket:
            assert websocket.receive_json()["type"] == "test"
