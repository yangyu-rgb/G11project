# Asset Provenance / 图片与图表来源

Only real application screenshots, code-derived diagrams, and figures generated from saved
experiment artifacts are committed here. No generative image is used as experimental evidence.

本目录只收录真实系统截图、由代码结构绘制的架构图和可追溯实验图，不使用生成式图片充当科研证据。

| Asset | Source | Protocol / state |
|---|---|---|
| `architecture/system-overview.svg` | Implemented modules in `BackEnd/app`, `BackEnd/src`, and `FrontEnd/src` | Architecture snapshot, 2026-07-30 |
| `demo/entry-configuration.webp` | Local frontend capture of the guided demonstration setup | English adaptive-glass UI, 1462 × 750 |
| `demo/synchronized-comparison.webp` | Local live run, 50 vehicles, broadcast vs learned policy | Champion SHA `b4119963acd2…`, English PBR scene |
| `demo/results-summary.webp` | Local held-out result panel | `directional-v2`, schema v2, English UI |
| `demo/validation-lab.webp` | Local validation workspace with synchronized receiver evidence | Real PPO comparison session, English UI |
| `results/directional-v2-summary.json` | Curated machine-readable values from the accepted experiment summary | 72 cases, schema v2 |
| `results/heldout-metrics.svg` | Deterministic rendering of the curated JSON values | Metric-specific valid n |
| `results/safety-efficiency-tradeoff.png` | Curated copy of `presentation_results/fig_safety_efficiency_tradeoff.png` | Accepted highway-corridor result bundle |

The runtime experiment folders are ignored by Git. The committed figures are presentation copies;
the reproducible source commands and artifact lineage are documented in
[`../REPRODUCIBILITY.md`](../REPRODUCIBILITY.md).
