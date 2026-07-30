# Research Roadmap / 研究路线图

This roadmap separates completed prototype capability from research extensions. It is not a promise that every future item already exists.

## 1. Current classroom-demo baseline — completed

- configurable three-lane highway with 50 vehicles and selectable incident sender;
- SUMO/TraCI traffic traces and a 3GPP-inspired network abstraction;
- observation schema v2 and four-dimensional directional-corridor action;
- Transformer feature extractor and PPO actor/critic training;
- fail-closed model registry, manifest, hash and behavioral gates;
- broadcast, distance, urgency and fixed-directional baselines;
- 72-configuration, five-method preliminary held-out artifact;
- synchronized four-stage Three.js presentation, live telemetry and validation laboratory;
- controllable comparison camera and receiver/source audit.

当前版本已经满足课堂Demo的“真实AI、可对比、可解释、可追溯”底线，但实验范围仍是高速单事故。

## 2. Immediate hardening

| Priority | Work | Acceptance evidence |
|---|---|---|
| P0 | Freeze the presentation model and artifacts | Reproducible manifest and hashes on a clean clone |
| P0 | Run full dress rehearsal on presentation hardware | Stable start, scenario load, camera and four stages |
| P1 | Add multi-seed confidence intervals and significance tests | Machine-generated report with per-metric `n` |
| P1 | Record performance and failure-mode evidence | Browser FPS, backend latency, fallback behavior |
| P1 | Package a static backup video/slide | Same incident and claims as live demo |

## 3. Research extensions

### Scenario generalization

- urban expressway ramps and merge/diverge geometry;
- curves, elevation, tunnels and partial occlusion;
- concurrent incidents and event-priority conflicts;
- density, weather and channel-condition sweeps.

### Algorithmic evaluation

- Transformer ablation and PPO ablation;
- recurrent or graph-based encoder comparison;
- constrained/safe RL and explicit risk budgets;
- out-of-distribution detection and calibrated uncertainty;
- sensitivity analysis for reward weights and legal corridor rules.

### Communication fidelity

- packet-level NS-3 or equivalent co-simulation;
- explicit queueing, retransmission and interference;
- hardware-in-the-loop latency accounting;
- standards-aligned message formats and radio profiles.

### Presentation evidence

- replayable experiment runs selected from immutable artifacts;
- multi-incident timeline and intervention controls;
- per-vehicle counterfactual explanation;
- side-by-side two-method live view plus five-method aggregate dashboard.

## 4. Publication readiness gate

A future publication-grade claim requires preregistered hypotheses, isolated configurations, multiple independent seeds, confidence intervals, statistical tests with effect sizes, ablations, out-of-distribution scenarios, failure cases, complete configuration snapshots, and externally reproducible artifacts. Until then, figures must retain the label “preliminary highway-only course-demo evidence.”
