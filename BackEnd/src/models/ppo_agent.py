"""Stable-Baselines3 PPO agent using the M1 environment Transformer."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from typing import Any, Literal

import gymnasium as gym
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.torch_layers import BaseFeaturesExtractor

from src.models.transformer import EnvironmentTransformer


@dataclass(frozen=True)
class DecodedAction:
    receiver_slots: tuple[int, ...]
    priority: int
    bandwidth_level: int


class TransformerFeatureExtractor(BaseFeaturesExtractor):
    """Encode padded vehicle/event observations before the actor and critic MLPs."""

    def __init__(self, observation_space: gym.spaces.Dict) -> None:
        vehicle_space = observation_space.spaces["vehicles"]
        event_space = observation_space.spaces["events"]
        network_space = observation_space.spaces["network_state"]
        max_vehicles, vehicle_feature_dim = vehicle_space.shape
        _, event_feature_dim = event_space.shape
        network_feature_dim = network_space.shape[0]
        d_model = 256
        features_dim = d_model + max_vehicles * d_model + network_feature_dim
        super().__init__(observation_space, features_dim=features_dim)
        self.max_vehicles = max_vehicles
        self.transformer = EnvironmentTransformer(
            vehicle_feature_dim=vehicle_feature_dim,
            event_feature_dim=event_feature_dim,
        )
        self._capture_attention_once = False
        self._captured_attention: torch.Tensor | None = None

    def capture_next_attention(self) -> None:
        """Capture attention from the next forward pass without affecting training."""
        self._capture_attention_once = True
        self._captured_attention = None

    def consume_captured_attention(self) -> torch.Tensor | None:
        """Return and clear the most recently requested attention tensor."""
        attention = self._captured_attention
        self._captured_attention = None
        return attention

    def forward(self, observations: dict[str, torch.Tensor]) -> torch.Tensor:
        vehicle_valid = observations["vehicle_mask"].bool()
        event_valid = observations["event_mask"].bool()
        output = self.transformer(
            observations["vehicles"].float(),
            observations["events"].float(),
            vehicle_padding_mask=~vehicle_valid,
            event_padding_mask=~event_valid,
        )
        if getattr(self, "_capture_attention_once", False):
            self._captured_attention = output.attention_weights.detach().cpu()
            self._capture_attention_once = False
        local_embeddings = output.vehicle_embeddings * vehicle_valid.unsqueeze(-1)
        return torch.cat(
            (
                output.global_embedding,
                local_embeddings.reshape(local_embeddings.shape[0], -1),
                observations["network_state"].float(),
            ),
            dim=1,
        )


class HandcraftedFeatureExtractor(BaseFeaturesExtractor):
    """Flatten local motion plus nearest-event relative features for RL-only ablation."""

    def __init__(self, observation_space: gym.spaces.Dict) -> None:
        max_vehicles = observation_space.spaces["vehicles"].shape[0]
        max_events = observation_space.spaces["events"].shape[0]
        features_dim = max_vehicles * 9 + max_events * 5 + 2
        super().__init__(observation_space, features_dim=features_dim)

    def forward(self, observations: dict[str, torch.Tensor]) -> torch.Tensor:
        vehicles = observations["vehicles"].float()
        events = observations["events"].float()
        vehicle_valid = observations["vehicle_mask"].float()
        event_valid = observations["event_mask"].bool()
        differences = vehicles[:, :, None, :2] - events[:, None, :, 1:3]
        distances = torch.linalg.vector_norm(differences, dim=-1)
        distances = distances.masked_fill(~event_valid[:, None, :], float("inf"))
        nearest_distance, nearest_index = distances.min(dim=-1)
        has_event = event_valid.any(dim=-1, keepdim=True)
        nearest_index = nearest_index.unsqueeze(-1).unsqueeze(-1).expand(-1, -1, 1, 2)
        nearest_difference = torch.gather(differences, 2, nearest_index).squeeze(2)
        nearest_difference = torch.where(
            has_event.unsqueeze(-1), nearest_difference, torch.zeros_like(nearest_difference)
        )
        nearest_distance = torch.where(
            has_event, nearest_distance, torch.zeros_like(nearest_distance)
        ).unsqueeze(-1)
        vehicle_features = torch.cat(
            (vehicles, nearest_difference, nearest_distance, vehicle_valid.unsqueeze(-1)), dim=-1
        ) * vehicle_valid.unsqueeze(-1)
        event_features = torch.cat((events, event_valid.float().unsqueeze(-1)), dim=-1)
        return torch.cat(
            (
                vehicle_features.flatten(start_dim=1),
                event_features.flatten(start_dim=1),
                observations["network_state"].float(),
            ),
            dim=1,
        )


class PPOAgent:
    """Thin lifecycle wrapper around the configured Stable-Baselines3 PPO model."""

    def __init__(
        self,
        environment: gym.Env,
        *,
        learning_rate: float = 3e-4,
        clip_epsilon: float = 0.2,
        entropy_coef: float = 0.01,
        batch_size: int = 64,
        n_epochs: int = 10,
        n_steps: int = 64,
        gamma: float = 0.99,
        seed: int | None = None,
        tensorboard_log: str | Path | None = None,
        device: str = "auto",
        verbose: int = 0,
        feature_extractor: Literal["transformer", "handcrafted"] = "transformer",
    ) -> None:
        extractor_classes = {
            "transformer": TransformerFeatureExtractor,
            "handcrafted": HandcraftedFeatureExtractor,
        }
        try:
            extractor_class = extractor_classes[feature_extractor]
        except KeyError as exc:
            raise ValueError("feature_extractor must be 'transformer' or 'handcrafted'") from exc
        policy_kwargs: dict[str, Any] = {
            "features_extractor_class": extractor_class,
            "net_arch": {"pi": [512, 256], "vf": [512, 256]},
        }
        self.model = PPO(
            "MultiInputPolicy",
            environment,
            learning_rate=learning_rate,
            clip_range=clip_epsilon,
            ent_coef=entropy_coef,
            batch_size=batch_size,
            n_epochs=n_epochs,
            n_steps=n_steps,
            gamma=gamma,
            seed=seed,
            tensorboard_log=str(tensorboard_log) if tensorboard_log else None,
            device=device,
            verbose=verbose,
            policy_kwargs=policy_kwargs,
        )

    def train(
        self,
        total_timesteps: int,
        callback: BaseCallback | None = None,
        *,
        reset_num_timesteps: bool = True,
    ) -> "PPOAgent":
        if total_timesteps <= 0:
            raise ValueError("total_timesteps must be positive")
        self.model.learn(
            total_timesteps=total_timesteps,
            callback=callback,
            reset_num_timesteps=reset_num_timesteps,
        )
        return self

    def predict(self, observation: dict[str, Any], *, deterministic: bool = True) -> DecodedAction:
        action = self.predict_raw(observation, deterministic=deterministic)
        return self.decode_action(action)

    def predict_raw(self, observation: dict[str, Any], *, deterministic: bool = True) -> Any:
        """Return the environment action produced by PPO for direct ``env.step`` use."""
        action, _ = self.model.predict(observation, deterministic=deterministic)
        return action

    def predict_raw_timed(
        self, observation: dict[str, Any], *, deterministic: bool = True
    ) -> tuple[Any, float]:
        """Return an action and measured end-to-end policy inference time in milliseconds."""
        started = perf_counter()
        action = self.predict_raw(observation, deterministic=deterministic)
        return action, (perf_counter() - started) * 1000.0

    def predict_raw_with_attention(
        self, observation: dict[str, Any], *, deterministic: bool = True
    ) -> tuple[Any, torch.Tensor | None]:
        """Predict once and return the final encoder attention produced by that pass."""
        extractor = self.model.policy.features_extractor
        if not isinstance(extractor, TransformerFeatureExtractor):
            return self.predict_raw(observation, deterministic=deterministic), None
        extractor.capture_next_attention()
        action = self.predict_raw(observation, deterministic=deterministic)
        return action, extractor.consume_captured_attention()

    @staticmethod
    def decode_action(action: Any) -> DecodedAction:
        values = [int(value) for value in action]
        if len(values) < 3:
            raise ValueError("PPO action must contain receiver flags, priority, and bandwidth")
        return DecodedAction(
            receiver_slots=tuple(index for index, selected in enumerate(values[:-2]) if selected),
            priority=values[-2],
            bandwidth_level=values[-1],
        )

    def save(self, path: str | Path) -> Path:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        self.model.save(target)
        return target.with_suffix(".zip")

    @classmethod
    def load(
        cls,
        path: str | Path,
        environment: gym.Env | None = None,
        *,
        device: str = "auto",
    ) -> "PPOAgent":
        agent = cls.__new__(cls)
        agent.model = PPO.load(path, env=environment, device=device)
        return agent
