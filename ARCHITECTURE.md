# System Architecture / 系统架构

**Status:** implemented research prototype

**Current contract:** observation schema v2 · `directional_corridor` action mode · evaluation protocol `directional-v2`

This document describes the architecture that is actually used by the current classroom demo. Detailed model and metric definitions live in [Technical Specification](Docs/TECHNICAL_SPECIFICATION.md); reproduction steps live in [Reproducibility Guide](Docs/REPRODUCIBILITY.md).

本文只描述已经实现并用于当前演示的系统，不把计划功能写成现有能力。

## 1. End-to-end structure

![End-to-end system architecture](Docs/assets/architecture/system-overview.svg)

```text
Scenario YAML ──► SUMO / TraCI ──► vehicle and incident traces
                                         │
                                         ▼
                              Gymnasium V2X environment
                         vehicle + event + mask + network state
                                         │
                                         ▼
                              Transformer feature extractor
                                         │
                                         ▼
                PPO actor/critic ──► radius, lane scope, priority, bandwidth
                                         │
                     ┌───────────────────┴────────────────────┐
                     ▼                                        ▼
            network + reward model                   held-out evaluation
                     │                                        │
                     └──────────── model bundle ──────────────┘
                                         │
                                         ▼
                         registry + FastAPI + WebSocket
                                         │
                                         ▼
                      React / Three.js evidence interface
```

## 2. Three isolated execution paths

### Training

SUMO traces and randomized network conditions feed the Gymnasium environment. The Transformer encodes masked vehicle/event tokens; PPO samples a structured communication action; the network and reward modules produce the transition used for policy updates.

### Evaluation and promotion

Candidate checkpoints are evaluated on configuration-isolated held-out scenarios against deterministic baselines. A champion is promoted only with a matching manifest, hashes, schema versions, metric summary, and behavioral audit.

### Live inference and presentation

The backend loads only an eligible champion. A presentation session freezes the selected incident context, obtains the AI action and chosen baseline result, and streams synchronized evidence. The frontend interpolates movement for visual continuity but does not train or synthesize decisions.

训练、评价和现场推理相互隔离，避免把测试集调参、运行时学习或前端模板误当作模型能力。

## 3. Backend modules

| Layer | Responsibility | Main locations |
|---|---|---|
| Traffic simulation | Generate highway topology, traffic and emergency braking traces | `BackEnd/scripts`, `BackEnd/src/simulation` |
| Environment | Build padded observations, masks, legal actions and rewards | `BackEnd/src/environment` |
| Learning | Transformer feature extraction and PPO optimization | `BackEnd/src/models`, `BackEnd/src/training` |
| Communication | Estimate delivery, latency, loss and channel usage | `BackEnd/src/network` |
| Evaluation | Run aligned baselines, held-out metrics and behavior gates | `BackEnd/scripts`, `BackEnd/src/evaluation` |
| Serving | Model eligibility, simulation sessions, REST and WebSocket transport | `BackEnd/app` |

## 4. Observation and policy contract

At time \(t\), the environment emits

\[
o_t=\{V_t,M_t^V,E_t,M_t^E,N_t\},
\]

where \(V_t\) and \(E_t\) are padded vehicle/event tensors, the masks distinguish valid tokens from padding, and \(N_t\) represents communication state. After separate projections and masked self-attention, PPO receives the encoded state and outputs

\[
a_t=(r_t,\ell_t,p_t,b_t).
\]

The v2 action controls rear-corridor radius, lane scope, three-level priority, and bandwidth fraction. Receiver IDs are deterministically derived from the action plus relative road geometry. The legality layer excludes the sender, forward vehicles, opposite-direction traffic, and vehicles outside the selected lane/radius scope.

因此AI价值体现在合法安全边界内联合选择“风险走廊多大、覆盖哪些车道、消息多紧急、分配多少带宽”，而非把“只通知后车”本身包装成学习结果。

## 5. Service and presentation contract

The FastAPI application exposes health/model state, scenario configuration, comparison/session controls, and WebSocket state. The React application uses dedicated session and presentation hooks, an animation runtime, and Three.js scenes to render one synchronized evidence source.

The 38-second presentation has four stages:

1. normal traffic;
2. incident and hard braking;
3. simultaneous AI/baseline comparison;
4. evidence summary.

The entry view selects environment, incident type, accident vehicle, and comparison baseline. The comparison camera supports orbit, zoom, pan, and recommended follow reset. The validation laboratory freezes a real decision frame and exposes receiver eligibility, model source, action, and held-out evidence.

## 6. Trust boundaries

- The browser is a renderer and controller, not the source of model truth.
- Model registry and manifest determine whether formal AI inference is available.
- A shared session timestamp and incident state are required for method comparison.
- Runtime experiment directories and checkpoints are ignored by Git; only curated documentation evidence is versioned.
- A rule fallback, when explicitly enabled for development, must be visibly labelled and cannot be reported as PPO output.

## 7. Current scope

Implemented: 50-vehicle three-lane highway presentation, configurable incident types, selectable sender, synchronized AI/baseline comparison, live telemetry, validation laboratory, directional-v2 model gates, and five-method offline evaluation.

Not established: city-road results, concurrent incidents, NS-3 integration, hardware-in-the-loop behavior, real-road validity, or publication-grade statistical significance.
