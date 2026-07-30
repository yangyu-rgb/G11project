# Reproducibility Guide

本指南说明如何从环境检查、场景预检、训练、验收一直复现到现场演示。正式演示只加载已经晋升并通过门禁的模型，不会在浏览器播放期间训练。

## 1. Environment

Recommended versions for the accepted course-demo workflow:

- Python 3.12;
- Node.js 22;
- Eclipse SUMO 1.27.x;
- PyTorch with CUDA support for Colab training, or CPU for local smoke checks.

```bash
git clone https://github.com/yangyu-rgb/G11project.git
cd G11project
./start.sh
```

Verify SUMO independently:

```bash
BackEnd/.venv/bin/python BackEnd/scripts/verify_sumo.py
```

## 2. Reproduction levels

| Level | Purpose | Expected output |
|---|---|---|
| Local smoke | Verify dependencies and code path | Small generated scenario and short PPO run |
| Demo-lite | Produce a classroom-ready candidate | Candidate bundle plus evaluation artifacts |
| Directional v2 | Reproduce the accepted model contract | Checkpoint, manifest, held-out summary, behavior audit |
| Formal pipeline | Larger research experiment | Multi-seed training, evaluation, plots, statistics |

课堂展示应使用 directional-v2；本地 smoke 只能证明流程可运行，不能替代最终模型。

## 3. Local smoke test

```bash
cd BackEnd
.venv/bin/python scripts/generate_highway_scenario.py \
  --output experiments/test_scenario
.venv/bin/python src/training/train_ppo.py \
  --config configs/training_config.yaml \
  --episodes 10 \
  --output experiments/test_ppo
```

Do not promote this short run as a presentation champion.

## 4. Colab pipelines

Choose one notebook according to the experimental purpose:

- [`colab_directional_corridor_v2.ipynb`](../BackEnd/notebooks/colab_directional_corridor_v2.ipynb): accepted v2 receiver geometry and behavior gates;
- [`colab_demo_lite_training.ipynb`](../BackEnd/notebooks/colab_demo_lite_training.ipynb): lower-cost classroom pipeline;
- [`colab_formal_training.ipynb`](../BackEnd/notebooks/colab_formal_training.ipynb): fuller research workflow.

The v2 configuration is [`adaptive_demo_training.yaml`](../BackEnd/configs/adaptive_demo_training.yaml). It defines 48 training, 12 validation, and 12 test configurations, three candidate seeds, up to 120,000 timesteps, 50 vehicles, and two incident events. Treat the configuration, source revision, seeds, checkpoint, and manifest as one experiment unit.

## 5. Artifact contract

A promotable model bundle must include, at minimum:

```text
checkpoint
model manifest
evaluation summary
behavior audit
training metadata and configuration snapshot
source revision and content hashes
```

The backend registry validates observation schema v2, four-dimensional `directional_corridor` action mode, protocol `directional-v2`, metric schema v2, and artifact hashes. Missing or incompatible evidence causes formal AI inference to fail closed.

模型不是只复制一个 `.pt` 文件即可使用；模型、清单、配置、评估和哈希共同组成可审计版本。

## 6. Promotion and acceptance

Follow [`MODEL_TRAINING_ACCEPTANCE.md`](../BackEnd/MODEL_TRAINING_ACCEPTANCE.md) for the canonical promotion procedure. Before promotion, confirm that:

1. train/validation/test configuration groups do not overlap;
2. the selected champion is chosen by validation evidence, not test-set tuning;
3. held-out evaluation uses identical scenario and network seeds across methods;
4. forward notifications are zero under the directional-v2 contract;
5. nearest-follower coverage and action/receiver diversity gates pass;
6. checkpoint hash and manifest hash agree;
7. generated metrics retain per-metric valid sample counts.

## 7. Running the demonstration

```bash
./start.sh
```

Open <http://localhost:5173>, select the environment, incident vehicle, and comparison baseline, then enter the four-stage presentation. The backend health endpoint is <http://localhost:8000/api/v1/health> and the API documentation is <http://localhost:8000/docs>.

The live comparison must show the same incident frame on both sides. The interface may animate between backend keyframes, but it must not fabricate model actions or evaluation metrics.

## 8. Verification commands

```bash
cd FrontEnd
npm ci
npm run lint
npm run build

cd ../BackEnd
python -m pip install -e '.[dev]'
python -m ruff check . ../Test
python -m ruff format --check . ../Test
python -m pytest

cd ..
bash -n start.sh
git diff --check
```

## 9. Reporting checklist

Every reported table or figure should state the protocol version, road scope, number of scenario configurations, per-metric valid sample count, seed policy, baseline definition, and whether the evidence is preliminary or formal. Do not manually transcribe values into slides without retaining the machine-readable source.

