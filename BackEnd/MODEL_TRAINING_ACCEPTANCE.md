# 方向风险走廊模型：训练与验收

本项目的正式演示模型不再使用固定接收者模板。PPO 动作直接决定四项内容：后向风险走廊半径、车道范围、消息优先级和带宽比例。接收者集合由该动作与车辆相对几何关系共同形成，前方车辆、对向车辆及走廊外车辆不属于合法动作空间。

## 当前准入状态

正式模型路径为：

- `experiments/highway_corridor/champion/model_best.zip`
- `experiments/highway_corridor/champion/model_manifest.json`

只有模型文件和清单同时存在，并满足以下条件，前端 AI 演示与实验运行按钮才会启用：

- `action_mode` 为 `directional_corridor`
- `observation_schema_version` 为 `2`
- 独立留出集的全部 acceptance checks 通过
- 方向行为门禁通过
- 模型 SHA-256 与清单一致

任一条件不满足时系统都会 fail closed：明确显示模型不可用，不以规则结果冒充 AI 推理。

## CUDA 训练

方向走廊v1保留为未通过验收的诊断实验。新的训练必须在 Google Colab 中打开并“全部运行”：

`notebooks/colab_directional_corridor_v2.ipynb`

Notebook 会使用新的Drive目录保存检查点，生成48/12/12组单事故训练、验证和独立测试场景，训练3个候选种子，并执行PPO、全广播、固定距离、紧急度和固定方向走廊五种方法的同步对比。重复网络种子不会被错误计为新的事故几何；运行中断后再次执行Notebook会从v2持久化状态继续。

成功产物位于 Drive 的：

`G11project-directional-corridor-v2/champion/`

该目录必须同时包含 `model_best.zip` 和 `model_manifest.json`。若任何验收项失败，流水线不会生成可准入清单。

## 本地晋级

将 Colab 的 `champion` 目录复制到本机后，在 `BackEnd` 目录执行：

```bash
.venv/bin/python scripts/promote_presentation_model.py /path/to/champion
```

晋级脚本会再次校验动作模式、观察结构、验收状态和哈希，然后原子写入正式模型目录。重启后端后可用以下接口确认：

```text
GET /api/v1/demo/model-status
```

只有返回 `eligible: true` 才表示模型已进入正式答辩链路。

## 方向行为验收含义

每个独立测试事故都会检查：

- 不通知事故车前方车辆
- 不通知对向或无关车辆
- 事故车最近的有效后车必须被覆盖
- 不同独立事故位置必须产生足够多样的接收者签名；同一事故的重复网络种子先去重
- 测试集中必须确实包含事故事件

这些检查专门防止旧模型曾出现的“换事故车但接收者基本不变”、通知前车以及漏掉正后车问题。
