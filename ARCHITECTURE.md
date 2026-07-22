# 系统架构文档

## 文档状态
**最后更新**: 2026-07-22  
**状态**: 已确认  
**版本**: 1.0.0

---

## 1. 整体架构

### 1.1 层次结构

```
┌─────────────────────────────────────────────────────────┐
│                    前端展示层 (FrontEnd)                  │
│  React + Leaflet + D3.js + [Three.js]                    │
│  - 地图可视化  - 注意力热力图  - 实时指标  - 对比视图   │
└─────────────────────┬───────────────────────────────────┘
                      │ WebSocket
┌─────────────────────┴───────────────────────────────────┐
│                  FastAPI 服务层 (BackEnd/app)            │
│  - WebSocket Handler  - 状态管理  - 消息广播            │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────────┐
│                    核心算法层 (BackEnd/src)              │
│  ┌──────────────┐    ┌──────────────┐                  │
│  │ Transformer  │───▶│  RL Agent    │                  │
│  │   Encoder    │    │    (PPO)     │                  │
│  └──────┬───────┘    └──────┬───────┘                  │
│         │                   │                            │
│         │ 环境嵌入          │ 动作(接收者+优先级+带宽)   │
│         │                   │                            │
│  ┌──────┴───────────────────┴───────┐                  │
│  │      Environment Wrapper          │                  │
│  │  - 状态构建  - 奖励计算           │                  │
│  └──────┬────────────────────────────┘                  │
└─────────┼────────────────────────────────────────────────┘
          │
┌─────────┴───────────────────────────────────────────────┐
│              仿真与网络层 (BackEnd/src/environment)      │
│  ┌──────────────────┐    ┌──────────────────┐          │
│  │   SUMO Wrapper   │    │  Network Layer   │          │
│  │  (TraCI/离线)    │    │  (3GPP Model)    │          │
│  └──────────────────┘    └──────────────────┘          │
└─────────────────────────────────────────────────────────┘
```

### 1.2 数据流

```
事件发生 (SUMO)
    ↓
收集车辆状态 + 事件信息
    ↓
构建输入序列 (车辆tokens + 事件tokens)
    ↓
Transformer编码 → 全局嵌入 + 局部嵌入
    ↓
RL Agent决策 → (接收者集合, 优先级, 带宽分配)
    ↓
Network Layer计算 → (实际时延, 丢包)
    ↓
消息送达状态 → 计算奖励
    ↓
更新PPO策略网络
    ↓
WebSocket推送状态 → 前端可视化
```

---

## 2. 模块详细设计

### 2.1 Transformer模块
**路径**: `BackEnd/src/models/transformer.py`  
**状态**: 未实现

**输入**:
- 车辆序列: `[N_vehicles, feature_dim]`
  - 特征: (x, y, vx, vy, heading, lane, ...)
- 事件序列: `[N_events, event_feature_dim]`
  - 特征: (type, x, y, timestamp, severity, ...)
- 位置编码: 时间顺序编码

**架构**:
- 多头自注意力: 8 heads
- 前馈网络 (FFN)
- Layer Norm + Residual
- 层数: 4-6层 (可配置)

**输出**:
- 全局嵌入: `[256]` (所有token的加权和)
- 车辆嵌入: `[N_vehicles, 256]`

---

### 2.2 PPO Agent
**路径**: `BackEnd/src/models/ppo_agent.py`  
**状态**: 未实现

**State Space**:
- Transformer全局嵌入: `[256]`
- 候选车辆嵌入: `[N_candidates, 256]`
- 消息队列状态: `[queue_size, message_features]`
- 网络状态: `[available_bandwidth, current_load, ...]`

**Action Space** (Multi-discrete):
- 接收者选择: `[N_candidates]` binary
- 优先级: `[3]` (低/中/高)
- 带宽分配: `[10]` (0-100%分10档)

**网络结构**:
- Actor: MLP `[state_dim → 512 → 256 → action_logits]`
- Critic: MLP `[state_dim → 512 → 256 → 1]`

**训练参数**:
- Learning rate: 3e-4
- Clip epsilon: 0.2
- Entropy coef: 0.01
- Batch size: 64
- Epochs per update: 10

---

### 2.3 Environment Wrapper
**路径**: `BackEnd/src/environment/v2x_env.py`  
**状态**: 未实现

**接口**: 遵循Gymnasium API
- `reset() → observation`
- `step(action) → observation, reward, done, info`

**职责**:
- 与SUMO交互 (TraCI或读取文件)
- 调用Network Layer计算通信结果
- 构建Transformer输入
- 计算奖励函数
- 判定episode结束条件

---

### 2.4 Network Abstraction Layer
**路径**: `BackEnd/src/environment/network_model.py`  
**状态**: 未实现

**输入**: 发送者位置、接收者位置、消息大小、优先级、当前负载

**输出**: 时延、丢包率、实际占用带宽

**模型**:
- 传播时延: `distance / c`
- 路径损耗: 3GPP TR 38.901公式 (Urban/Highway场景)
- 排队时延: `f(当前负载, 优先级)` (简化排队论模型)
- 丢包率: `f(SINR, 负载)`

---

### 2.5 FastAPI服务
**路径**: `BackEnd/app/main.py`  
**状态**: 基础骨架已实现

**端点**:
- `GET /health`: 健康检查 (已实现)
- `GET /status`: 查询系统状态 (待实现)
- `WS /simulation`: WebSocket仿真流 (M0基础通信已实现)
- `POST /scenario`: 加载/创建场景 (待实现)
- `POST /control`: 控制命令 (播放/暂停/重置) (待实现)

**WebSocket消息格式**:
```json
{
  "type": "state_update",
  "timestamp": 123.45,
  "vehicles": [...],
  "events": [...],
  "messages": [...],
  "metrics": {...},
  "attention_weights": [...],
  "decision": {...}
}
```

---

## 3. 前端架构

### 3.1 组件结构
**路径**: `FrontEnd/src/`  
**状态**: 基础骨架已实现

```
src/
├── components/
│   ├── MapView/              # 主地图视图 (Leaflet) - 待实现
│   │   ├── VehicleLayer.tsx  # 车辆标记
│   │   ├── EventLayer.tsx    # 事件标记
│   │   └── MessageLayer.tsx  # 消息传播动画
│   ├── AttentionViz/         # 注意力可视化 - 待实现
│   │   ├── HeatmapOverlay.tsx
│   │   └── AttentionLinks.tsx
│   ├── DecisionPanel/        # 决策过程面板 - 待实现
│   │   ├── CandidateList.tsx
│   │   └── ResourceChart.tsx
│   ├── MetricsPanel/         # 指标面板 - 待实现
│   │   ├── RealtimeMetrics.tsx
│   │   ├── TimeSeriesChart.tsx  # D3.js
│   │   └── EventStats.tsx
│   ├── ComparisonView/       # 对比视图 - 待实现
│   │   ├── SplitScreen.tsx   # 左右分屏
│   │   └── MethodToggle.tsx
│   └── [Optional] Scene3D/   # 3D视图 (Three.js) - 待实现
├── hooks/
│   └── useWebSocket.ts       # WebSocket连接管理 - 待实现
├── utils/
│   └── dataProcessing.ts     # 数据格式转换 - 待实现
└── App.tsx                   # 已实现基础骨架
```

### 3.2 状态管理
**方案**: React Context 或 Zustand (待确定)

**全局状态**:
- 当前仿真时间
- 车辆/事件/消息列表
- 实时指标历史
- 用户选择的对比模式

---

## 4. 文件系统组织

```
G11project/
├── BackEnd/
│   ├── src/
│   │   ├── models/
│   │   │   ├── transformer.py        # 待创建
│   │   │   ├── ppo_agent.py          # 待创建
│   │   │   └── utils.py               # 待创建
│   │   ├── environment/
│   │   │   ├── v2x_env.py             # 待创建
│   │   │   ├── sumo_wrapper.py        # 待创建
│   │   │   ├── network_model.py       # 待创建
│   │   │   └── reward_calculator.py   # 待创建
│   │   ├── training/
│   │   │   ├── train_ppo.py           # 待创建
│   │   │   └── trainer_utils.py       # 待创建
│   │   ├── evaluation/
│   │   │   ├── evaluator.py           # 待创建
│   │   │   ├── baselines.py           # 待创建
│   │   │   └── metrics.py             # 待创建
│   │   └── deployment/
│   │       └── model_export.py        # 待创建
│   ├── app/
│   │   ├── main.py                    # 基础骨架已实现
│   │   └── websocket_handler.py       # 待创建
│   ├── configs/                       # 待创建
│   │   ├── model_config.yaml
│   │   ├── training_config.yaml
│   │   └── scenarios/
│   │       ├── highway_emergency.yaml
│   │       └── urban_intersection.yaml
│   ├── experiments/                   # 待创建
│   └── scripts/                       # 待创建
│       ├── generate_scenarios.py
│       └── run_experiment.py
├── FrontEnd/
│   └── [如上述组件结构]
├── Test/
│   ├── unit/                          # 待创建
│   │   ├── test_transformer.py
│   │   ├── test_ppo.py
│   │   └── test_network_model.py
│   ├── integration/                   # 待创建
│   │   ├── test_env_integration.py
│   │   └── test_api.py
│   └── e2e/                           # 待创建
│       └── test_full_pipeline.py
└── Docs/
    ├── TECHNICAL_SPECIFICATION.md     # 详见独立文档
    ├── IMPLEMENTATION_ROADMAP.md      # 详见独立文档
    └── DEMO_GUIDE.md                  # 详见独立文档
```

---

## 5. 部署与运行

### 5.1 开发环境启动
```bash
# 一键启动前后端
./start.sh
```

**内部流程**:
1. 检查并安装依赖
2. 后台启动FastAPI服务 (端口8000)
3. 后台启动React开发服务器 (端口5173)
4. 退出时自动清理进程

### 5.2 训练流程 (待实现)
```bash
python BackEnd/scripts/run_experiment.py \
  --config configs/training_config.yaml \
  --scenario configs/scenarios/highway_emergency.yaml \
  --output experiments/exp001
```

### 5.3 演示模式 (待实现)
```bash
# 加载预训练模型，启动WebSocket服务
python BackEnd/app/main.py --demo --model experiments/best_model.pt
```

---

## 6. 技术栈总结

| 层级 | 技术 | 状态 |
|------|------|------|
| 前端框架 | React + TypeScript + Vite | ✅ 已搭建 |
| 地图可视化 | Leaflet / Mapbox | 待集成 |
| 图表可视化 | D3.js | 待集成 |
| 3D可视化 | Three.js | 可选，待实现 |
| 后端框架 | FastAPI | ✅ 基础骨架 |
| 通信协议 | WebSocket | ✅ M0基础通信已实现 |
| ML框架 | PyTorch | ✅ 已安装并验证 |
| RL库 | Stable-Baselines3 | ✅ 已安装并验证 |
| 仿真工具 | SUMO | ✅ 已安装并验证 |
| 环境接口 | Gymnasium | ✅ 已安装并验证 |
| 测试框架 | Pytest (后端), Vitest (前端) | 已配置 |
| 代码检查 | Ruff (后端), ESLint (前端) | ✅ 已配置 |
| CI/CD | GitHub Actions | ✅ 已配置 |

---

## 7. 相关文档

- [技术规范详细说明](Docs/TECHNICAL_SPECIFICATION.md)
- [实施路线图](Docs/IMPLEMENTATION_ROADMAP.md)
- [演示指南](Docs/DEMO_GUIDE.md)
- [CI/CD流程](Docs/CI_CD.md)
- [任务桥接文档](ARCHITECT_CODEX_BRIDGE.md)
- [项目路线图](TODO.md)

---

**文档维护**: 当架构决策确认并实现后更新本文档
