"""Tests for the Stable-Baselines3 PPO wrapper and Transformer extractor."""

import sys
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2] / "BackEnd"
sys.path.insert(0, str(BACKEND_DIRECTORY))

from src.models.ppo_agent import PPOAgent  # noqa: E402


class TinyV2XEnv(gym.Env[dict[str, np.ndarray], np.ndarray]):
    def __init__(self) -> None:
        self.observation_space = gym.spaces.Dict(
            {
                "vehicles": gym.spaces.Box(-1, 1, shape=(4, 5), dtype=np.float32),
                "vehicle_mask": gym.spaces.MultiBinary(4),
                "events": gym.spaces.Box(-1, 1, shape=(2, 4), dtype=np.float32),
                "event_mask": gym.spaces.MultiBinary(2),
                "network_state": gym.spaces.Box(0, 1, shape=(2,), dtype=np.float32),
            }
        )
        self.action_space = gym.spaces.MultiDiscrete([2, 2, 2, 2, 3, 10])
        self.steps = 0

    @staticmethod
    def _observation() -> dict[str, np.ndarray]:
        return {
            "vehicles": np.zeros((4, 5), dtype=np.float32),
            "vehicle_mask": np.asarray([1, 1, 1, 1], dtype=np.int8),
            "events": np.zeros((2, 4), dtype=np.float32),
            "event_mask": np.asarray([1, 0], dtype=np.int8),
            "network_state": np.asarray([1, 0], dtype=np.float32),
        }

    def reset(
        self, *, seed: int | None = None, options: dict[str, Any] | None = None
    ) -> tuple[dict[str, np.ndarray], dict[str, Any]]:
        super().reset(seed=seed)
        self.steps = 0
        return self._observation(), {}

    def step(
        self, action: np.ndarray
    ) -> tuple[dict[str, np.ndarray], float, bool, bool, dict[str, Any]]:
        self.steps += 1
        reward = float(np.asarray(action)[:4].sum()) / 4
        return self._observation(), reward, self.steps >= 2, False, {}


def test_ppo_agent_predicts_trains_and_round_trips_model(tmp_path: Path) -> None:
    environment = TinyV2XEnv()
    agent = PPOAgent(
        environment,
        n_steps=4,
        batch_size=4,
        n_epochs=1,
        seed=7,
        device="cpu",
    )
    observation, _ = environment.reset()

    raw_action = agent.predict_raw(observation)
    assert environment.action_space.contains(raw_action)

    attention_action, attention = agent.predict_raw_with_attention(observation)
    assert environment.action_space.contains(attention_action)
    assert attention is not None
    assert attention.shape == (1, 4, 8, 6, 6)
    assert agent.model.policy.features_extractor.consume_captured_attention() is None

    action = agent.predict(observation)
    assert all(0 <= slot < 4 for slot in action.receiver_slots)
    assert 0 <= action.priority < 3
    assert 0 <= action.bandwidth_level < 10

    agent.train(4)
    saved_path = agent.save(tmp_path / "model")
    assert saved_path.is_file()

    loaded = PPOAgent.load(saved_path, environment, device="cpu")
    loaded_action = loaded.predict(observation)
    assert 0 <= loaded_action.priority < 3
    assert 0 <= loaded_action.bandwidth_level < 10
