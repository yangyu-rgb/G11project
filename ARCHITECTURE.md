# 系统架构文档

## 文档状态

**最后更新**: 2026-07-23

**状态**: 已确认

**版本**: 1.1.0

本文档记录已经确认的系统边界、模块关系、数据流和当前实现状态。具体特征定义、训练参数和实验指标以 [技术规范](Docs/TECHNICAL_SPECIFICATION.md) 为准，任务执行状态以 [架构师-Codex桥接文档](ARCHITECT_CODEX_BRIDGE.md) 为准。

---

## 1. 整体架构

### 1.1 层次结构

```text
┌──────────────────────────────────────────────────────────┐
│ 前端展示层（FrontEnd）                                    │
│ React + TypeScript + Vite                                │
│ 当前：WebSocket测试消息展示与自动重连                     │
│ 计划：地图、注意力、调度决策、指标及基线对比视图           │
└──────────────────────────┬───────────────────────────────┘
                           │ WebSocket /ws/simulation
┌──────────────────────────┴───────────────────────────────┐
│ FastAPI服务层（BackEnd/app）                              │
│ 当前：健康检查、WebSocket测试消息                         │
│ 计划：场景控制、仿真状态管理、完整状态广播                │
└──────────────────────────┬───────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────┐
│ 核心算法层（BackEnd/src）                                 │
│ Transformer Encoder（M1已实现）                           │
│ PPO Agent、Environment Wrapper、Reward（M1已实现）        │
└──────────────────────────┬───────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────┐
│ 仿真与网络层                                              │
│ SUMO高速场景生成（M1已实现）                              │
│ 简化Network Model（M1已实现）→ 3GPP模型（M2计划）         │
└──────────────────────────────────────────────────────────┘
```

### 1.2 分阶段数据流

#### M1当前已实现的数据生成流

```text
高速场景YAML配置
    ↓
生成SUMO路网、车辆路由和仿真配置
    ↓
通过TraCI运行急刹事件仿真
    ↓
输出车辆轨迹XML与事件JSON
```

#### M1已实现的离线训练流

```text
轨迹XML + 事件JSON
    ↓
Environment Wrapper构建车辆token、事件token和网络状态
    ↓
Transformer编码全局嵌入与车辆局部嵌入
    ↓
PPO选择接收者、优先级和带宽档位
    ↓
Network Model计算传输结果
    ↓
Reward Calculator计算奖励
    ↓
按训练批次更新PPO策略
```

#### 计划中的演示与推理流

```text
SUMO/场景回放 → 环境状态 → Transformer → PPO决策
    ↓
Network Model计算消息传播结果
    ↓
FastAPI通过WebSocket推送完整状态
    ↓
React前端展示仿真、注意力、决策和指标
```

训练更新只发生在训练流程中；演示与推理流程加载已训练模型，不在每条消息送达后更新策略。

---

## 2. 后端模块

### 2.1 SUMO高速场景生成

**路径**:

- `BackEnd/scripts/generate_highway_scenario.py`
- `BackEnd/configs/scenarios/highway_emergency.yaml`

**状态**: 已实现M1版本

**职责**:

- 生成单向3车道、长度5公里的高速公路路网。
- 根据固定随机种子生成30–50辆车，初始速度为80–120 km/h。
- 在仿真时间10–30秒触发1–2个急刹事件。
- 通过SUMO和TraCI实际运行场景，确保生成结果可加载。

**输出目录内容**:

- `highway.net.xml`: SUMO路网。
- `vehicles.rou.xml`: 车辆与路由。
- `scenario.sumocfg`: SUMO仿真配置。
- `trajectory.xml`: SUMO FCD车辆轨迹。
- `events.json`: 急刹事件的类型、位置、时间和严重程度。

相对输出路径以 `BackEnd/` 为基准。例如 `--output experiments/test_scenario` 输出到 `BackEnd/experiments/test_scenario/`。

### 2.2 Transformer环境编码器

**路径**:

- `BackEnd/src/models/transformer.py`
- `BackEnd/src/models/utils.py`

**状态**: 已实现M1基础版

**输入**:

- 车辆特征 `[B, N_vehicles, 5]`: `(x, y, vx, vy, heading)`。
- 事件特征 `[B, N_events, 4]`: `(type, x, y, severity)`。
- 可选的车辆和事件padding mask。

车辆token和事件token使用独立线性投影，并添加token类型嵌入与正弦序列位置编码。

**架构**:

- 隐藏维度256。
- 4层Transformer Encoder。
- 每层8个注意力头。
- FFN维度1024，使用GELU、残差连接和Layer Normalization。
- 使用可学习的attention pooling生成全局嵌入。

**输出**:

- 全局嵌入 `[B, 256]`。
- 车辆局部嵌入 `[B, N_vehicles, 256]`。
- 每层每个注意力头的权重 `[B, 4, 8, T, T]`，其中 `T = N_vehicles + N_events`。

### 2.3 PPO通信调度器

**路径**: `BackEnd/src/models/ppo_agent.py`

**状态**: 已实现M1基础版

**状态空间**:

- Transformer全局环境嵌入。
- 候选车辆局部嵌入。
- 消息队列状态。
- 可用带宽和当前网络负载。

**动作空间**:

- 候选车辆的二进制接收选择。
- 低、中、高三级优先级。
- 十档带宽份额。

**当前结构**:

- Actor: `state_dim → 512 → 256 → action_logits`。
- Critic: `state_dim → 512 → 256 → 1`。
- 使用Stable-Baselines3的PPO实现基础版本。

具体训练超参数由配置文件管理，不在架构文档中重复维护。

### 2.4 Environment Wrapper

**路径**: `BackEnd/src/environment/v2x_env.py`

**状态**: 已实现M1离线版

**接口**: 遵循Gymnasium API。

- `reset() → (observation, info)`
- `step(action) → (observation, reward, terminated, truncated, info)`

**职责**:

- M1读取离线SUMO轨迹与事件数据，M2扩展TraCI在线交互。
- 构建Transformer输入及PPO观察空间。
- 调用Network Model并记录消息传输结果。
- 调用奖励计算模块。
- 管理episode状态和终止条件。

### 2.5 Network Abstraction Layer

**路径**: `BackEnd/src/environment/network_model.py`

**状态**: 已实现M1简化版

**公共接口**:

```text
calculate_transmission(
    sender_pos,
    receiver_pos,
    message_size,
    priority,
    current_load,
) → TransmissionResult
```

**M1当前模型**:

- 时延：`base_delay + distance / c + random_jitter`。
- 丢包率：距离大于500米时为10%，否则为0%。
- 总带宽：默认100 Mbps。
- 当前负载范围为 `[0, 1]`；低、中、高优先级分别获得剩余带宽的25%、50%和100%。
- 结构化输出包括时延、丢包率和分配带宽。

**M2计划升级**:

- 引入3GPP TR 38.901城市/高速信道模型。
- 分别计算基础、传播、排队和传输时延。
- 根据路径损耗、SINR、干扰和网络负载计算丢包率。
- 保持现有网络层边界，是否需要调整公共接口须先由架构师确认。

### 2.6 FastAPI服务

**路径**: `BackEnd/app/main.py`

**状态**: M0基础骨架已实现

**当前接口**:

- `GET /api/v1/health`: 健康检查。
- `WS /ws/simulation`: 每秒发送M0测试消息，支持客户端断开后重新连接。

当前WebSocket消息格式：

```json
{
  "type": "test",
  "timestamp": 1234567890.123,
  "message": "Hello from backend"
}
```

**计划接口**:

- `GET /api/v1/status`: 查询系统状态。
- `POST /api/v1/scenario`: 加载或创建场景。
- `POST /api/v1/control`: 播放、暂停和重置仿真。
- 保持 `WS /ws/simulation` 路径不变，将内容扩展为车辆、事件、消息、指标、注意力权重和调度决策。

---

## 3. 前端架构

### 3.1 当前实现

**路径**: `FrontEnd/src/`

**状态**: M1 mock可视化已实现

- `App.tsx`: 展示连接状态、mock指标和高速公路通信态势。
- `hooks/useWebSocket.ts`: 管理连接、消息解析、断开状态和2秒自动重连。
- `components/MapView/`: 三车道、车辆、急刹事件和消息传播动画。
- `components/MetricsPanel/`: 实时时延、覆盖率和通信开销卡片。
- `data/mockSimulation.ts`: 本轮5车、1事件和3条消息的本地演示数据。

### 3.2 后续计划组件

```text
components/
├── AttentionViz/        # 注意力热力图及关联线
├── DecisionPanel/       # 候选车辆和资源分配
├── MetricsPanel/        # 时序图和事件统计
├── ComparisonView/      # AI与基线同步对比
└── Scene3D/             # Three.js可选增强
```

在组件数量增长前不提前引入全局状态库。需要跨多个页面共享仿真状态时，再由React Context和Zustand中选择一种方案。

---

## 4. 文件系统与职责边界

以下仅列出当前关键文件和已经确认的计划模块，避免与实现目录重复维护完整文件清单。

```text
G11project/
├── BackEnd/
│   ├── app/                         # FastAPI服务
│   │   ├── main.py                  # 已实现
│   │   └── api/                     # 健康检查路由，已实现
│   ├── src/
│   │   ├── models/
│   │   │   ├── transformer.py       # 已实现
│   │   │   ├── utils.py             # 已实现
│   │   │   └── ppo_agent.py         # M1基础版已实现
│   │   ├── environment/
│   │   │   ├── network_model.py     # M1简化版已实现
│   │   │   ├── v2x_env.py           # M1离线版已实现
│   │   │   └── reward_calculator.py # M1简化版已实现
│   │   ├── training/                 # PPO训练脚本已实现
│   │   ├── evaluation/               # 两种基线与评估器已实现
│   │   └── deployment/               # 模型导出
│   ├── configs/scenarios/
│   │   └── highway_emergency.yaml   # 已实现
│   ├── scripts/
│   │   ├── verify_sumo.py            # 已实现
│   │   └── generate_highway_scenario.py # 已实现
│   └── experiments/                  # 生成数据、模型和实验产物
├── FrontEnd/src/                     # React、Leaflet、mock地图与WebSocket hook
├── Test/
│   ├── unit/                         # 场景、Transformer和网络模型测试
│   ├── integration/                  # SUMO与WebSocket集成测试
│   └── e2e/                          # 端到端测试预留目录
└── Docs/                             # 技术规范、路线图和演示指南
```

顶层业务目录固定为 `BackEnd`、`FrontEnd`、`Test` 和 `Docs`。新增业务代码必须归入对应目录，不创建新的顶层业务目录。

---

## 5. 运行与交付边界

### 5.1 开发环境

根目录统一使用以下命令启动前后端：

```bash
./start.sh
```

脚本负责检查依赖、启动FastAPI和Vite，并在退出时清理子进程。前端和后端不要求用户分别执行启动命令。

### 5.2 场景生成

```bash
python BackEnd/scripts/generate_highway_scenario.py \
  --output experiments/test_scenario
```

该命令依赖本机SUMO运行时，输出目录位于 `BackEnd/experiments/test_scenario/`。

### 5.3 PPO训练

```bash
python BackEnd/src/training/train_ppo.py \
  --config configs/training_config.yaml \
  --episodes 10 \
  --output experiments/test_ppo
```

训练输出包含最佳模型、最终检查点、训练摘要和TensorBoard日志。完整后端状态推送和真实数据前端演示仍属于后续任务。

---

## 6. 技术栈与实现状态

| 层级 | 技术 | 当前状态 |
|------|------|----------|
| 前端框架 | React + TypeScript + Vite | ✅ 已搭建 |
| 地图可视化 | Leaflet | ✅ M1 mock地图已实现 |
| 图表可视化 | D3.js | 待集成 |
| 3D可视化 | Three.js | 可选，待实现 |
| 后端框架 | FastAPI | ✅ 基础骨架已实现 |
| 通信协议 | WebSocket | ✅ M0基础通信已实现 |
| 环境编码 | PyTorch Transformer | ✅ M1基础版已实现 |
| RL调度 | Stable-Baselines3 PPO | ✅ M1基础版已实现 |
| 交通仿真 | SUMO + TraCI | ✅ 场景生成与验证已实现 |
| 网络抽象 | Python简化模型 | ✅ M1版本已实现 |
| 环境接口 | Gymnasium | ✅ M1离线Wrapper已实现 |
| 后端测试 | Pytest | ✅ 已配置 |
| 前端测试 | 尚未选定 | 待配置 |
| 代码检查 | Ruff + ESLint | ✅ 已配置 |
| 持续集成 | GitHub Actions | ✅ 已配置 |

---

## 7. 相关文档

- [技术规范详细说明](Docs/TECHNICAL_SPECIFICATION.md)
- [实施路线图](Docs/IMPLEMENTATION_ROADMAP.md)
- [演示指南](Docs/DEMO_GUIDE.md)
- [CI/CD流程](Docs/CI_CD.md)
- [任务桥接文档](ARCHITECT_CODEX_BRIDGE.md)
- [项目路线图](TODO.md)

---

**文档维护规则**: 仅在架构决策确认、公共边界变化或实现状态发生变化后更新本文档；具体任务进度和实验参数分别维护在桥接文档与技术规范中。
