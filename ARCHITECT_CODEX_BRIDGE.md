# 架构师-Codex 通信桥接文档

## 🎯 文档目的
本文档是 **Dr. Aria Chen (架构师)** 和 **Codex (开发者)** 之间的主要通信接口。

**核心职责**：
- 架构师：定义任务规范、技术决策、审查实现
- Codex：执行实现、报告进度、请求澄清

**工作原则**：
- 实用优先、增量开发、早期验证
- 质量优于速度、有疑问先询问
- 遵循架构、不独立做架构决策

---

## ⚖️ 执行权限边界

### Codex 可自主决定
✅ 函数和变量命名  
✅ 不影响公共接口的内部重构  
✅ 测试组织方式（保持覆盖率）  
✅ 小版本依赖选择（如 `torch>=2.0` 范围内）  
✅ 代码风格优化（符合项目lint规则）

### 必须请求架构师批准
❌ 新增核心框架或大型依赖（如新增 TensorFlow、Ray 等）  
❌ 修改顶层目录结构或公共 API  
❌ 更换算法路线（如从 Transformer 换到 GNN）  
❌ 改变数据格式或存储方案  
❌ 删除现有能力或破坏向后兼容性  
❌ 修改实验指标定义或基线对比方法

**判断标准**：如果变更会影响其他模块或未来集成，必须请求批准。

---

## 📝 任务模板

### 任务结构
每个任务包含以下部分：

```markdown
#### 任务XXX：[标题]
**状态**：🔴 未开始 / 🟡 进行中 / 🟢 已完成 / ⚫ 被阻塞  
**优先级**：高/中/低  
**描述**：[任务目标]

**需求**：
- [具体要求列表]

**验收条件**：
- 必须通过的命令：
  - `pytest tests/xxx -v`
  - `ruff check BackEnd/src/xxx`
- 必须产生的文件：`xxx.py`, `xxx_test.py`
- 不允许修改：`yyy.py` 的公共接口
- 成功标准：[明确的可验证标准]

**Codex完成说明**：
- [x] [完成项描述]
- 修改的文件：`xxx`, `yyy`
- 验证记录：
  - `pytest -q`：通过
  - `ruff check`：通过
  - 未验证：[说明原因，如"无GPU环境"]
- [可选] 遗留问题：[如有]
```

---

## 📋 活跃任务

**当前阶段**: M1已完成 + M2训练准备就绪（Week 5-6）

### 已完成任务

#### 任务000：后端目录结构完善
**状态**：🟢 已完成  
**完成日期**：2026-07-22

**Codex完成说明**：
- [x] 目录结构已创建
- [x] __init__.py 已添加到所有Python包
- [x] .gitignore 已更新
- [x] README.md 已更新结构说明
- 修改的文件：`BackEnd/src/`、`BackEnd/configs/`、`BackEnd/experiments/`、`BackEnd/notebooks/`、`BackEnd/scripts/`、`Test/`、`.gitignore`、`README.md`
- 验证记录：目录逐项检查通过；本机缺少 `tree`，两次安装均因Homebrew外部TLS下载失败，已用 `find BackEnd Test -maxdepth 2 -type d` 完成等价检查

---

#### 任务001：Python环境和核心依赖
**状态**：🟢 已完成  
**完成日期**：2026-07-22

**Codex完成说明**：
- [x] requirements.txt 已创建
- [x] environment.yml 已创建
- [x] 在虚拟环境中测试安装
- [x] README.md 已添加安装说明
- 修改的文件：`BackEnd/requirements.txt`、`BackEnd/environment.yml`、`README.md`
- 验证记录：Python 3.12.13环境安装成功；PyTorch 2.13.0、Gymnasium 1.3.0、Stable-Baselines3 2.9.0导入成功；`pip check` 无冲突

---

#### 任务002：初始化 CI/CD 流水线与 push 检查规范
**状态**：🟢 已完成
**完成日期**：2026-07-22

**Codex完成说明**：
- [x] GitHub Actions 在 push、pull request、merge queue 和手动触发时运行
- [x] 前端执行依赖锁定安装、ESLint 和生产构建
- [x] 后端执行 Ruff 和 pytest
- [x] 根目录提供 `./start.sh`，统一初始化并启动前后端服务
- [x] 启动脚本通过语法检查，并在退出时统一清理两个服务进程
- [x] 补充本地检查、pull request 合并与 `main` 分支保护规范
- [x] 未确定部署目标前不注入部署凭据或执行自动部署
- 修改的文件：`.github/workflows/ci.yml`、`start.sh`、`Docs/CI_CD.md`、`README.md`

---

#### 任务003：SUMO安装验证
**状态**：🟢 已完成  
**完成日期**：2026-07-22

**Codex完成说明**：
- [x] verify_sumo.py 已创建
- [x] 测试文件已创建
- [x] README.md 已添加SUMO安装指南
- [x] 在本地环境验证通过
- 修改的文件：`BackEnd/scripts/verify_sumo.py`、`Test/integration/test_sumo_integration.py`、`README.md`
- 验证记录：SUMO 1.27.1最小路网运行1秒并输出 `SUMO installation verified`；集成测试通过

---

#### 任务004：WebSocket基础通信
**状态**：🟢 已完成  
**完成日期**：2026-07-22

**Codex完成说明**：
- [x] WebSocket端点已实现
- [x] useWebSocket hook 已创建
- [x] 前端能接收并显示消息
- [x] 连接/断开逻辑已测试
- 修改的文件：`BackEnd/app/main.py`、`FrontEnd/src/hooks/useWebSocket.ts`、`FrontEnd/src/App.tsx`、`FrontEnd/vite.config.ts`、`Test/integration/test_websocket.py`
- 验证记录：浏览器确认每秒更新；停止服务显示断开，重启后2秒内自动恢复连接；后端WebSocket测试通过

---

#### 任务005：创建技术文档
**状态**：🟢 已完成  
**完成日期**：2026-07-22

**Codex完成说明**：
- [x] TECHNICAL_SPECIFICATION.md 已创建
- [x] IMPLEMENTATION_ROADMAP.md 已创建
- [x] DEMO_GUIDE.md 已创建
- [x] 文档已添加到 ARCHITECTURE.md 的相关文档列表
- 修改的文件：`Docs/TECHNICAL_SPECIFICATION.md`、`Docs/IMPLEMENTATION_ROADMAP.md`、`Docs/DEMO_GUIDE.md`、`ARCHITECTURE.md`
- 验证记录：三份文档路径和链接存在；演示时长按正式评分规范修正为20分钟

---

#### 任务006：SUMO高速公路场景生成
**状态**：🟢 已完成  
**优先级**：高  
**描述**：生成简单高速公路场景，包含车辆轨迹和急刹事件

**需求**：
- 创建 `BackEnd/scripts/generate_highway_scenario.py`：
  - 高速公路单向3车道，长度5km
  - 30-50辆车，随机初始位置和速度（80-120 km/h）
  - 随机触发1-2个急刹事件（在仿真时间10-30秒之间）
  - 输出轨迹XML（SUMO格式）和事件JSON
- 创建配置文件 `BackEnd/configs/scenarios/highway_emergency.yaml`
- 在 `Test/unit/` 创建测试

**验收条件**：
- 必须通过的命令：
  - `python BackEnd/scripts/generate_highway_scenario.py --output experiments/test_scenario`
  - `pytest Test/unit/test_scenario_generation.py -v`
- 必须产生的文件：
  - `BackEnd/scripts/generate_highway_scenario.py`
  - `BackEnd/configs/scenarios/highway_emergency.yaml`
  - `Test/unit/test_scenario_generation.py`
  - 示例输出：`experiments/test_scenario/trajectory.xml`, `events.json`
- 成功标准：
  - 生成的场景可被SUMO加载
  - 事件JSON包含完整信息（type, x, y, timestamp, severity）
  - 车辆数量在30-50范围内

**Codex完成说明**：
- [x] 场景生成脚本已创建
- [x] 配置文件已创建
- [x] 测试已通过
- 完成日期：2026-07-23
- 修改的文件：`BackEnd/scripts/generate_highway_scenario.py`、`BackEnd/configs/scenarios/highway_emergency.yaml`、`Test/unit/test_scenario_generation.py`
- 验证记录：默认配置生成50辆车、2个急刹事件及完整SUMO场景包；SUMO/TraCI实际加载成功，事件字段与车辆数量测试通过

---

#### 任务007：Transformer模型实现
**状态**：🟢 已完成  
**优先级**：高  
**描述**：实现Transformer环境编码器

**需求**：
- 创建 `BackEnd/src/models/transformer.py`：
  - 输入：车辆features (x,y,vx,vy,heading) + 事件features (type,x,y,severity)
  - 实现车辆token和事件token的分离编码
  - 4层Transformer Encoder，8头注意力
  - 输出：全局嵌入（256维）+ 每辆车局部嵌入（256维）
- 创建 `BackEnd/src/models/utils.py`（位置编码等工具函数）
- 在 `Test/unit/` 创建测试（使用虚拟数据）

**验收条件**：
- 必须通过的命令：
  - `pytest Test/unit/test_transformer.py -v`
  - `ruff check BackEnd/src/models/`
- 必须产生的文件：
  - `BackEnd/src/models/transformer.py`
  - `BackEnd/src/models/utils.py`
  - `Test/unit/test_transformer.py`
- 成功标准：
  - 前向传播成功（batch_size=2, n_vehicles=10, n_events=1）
  - 输出形状正确：global_emb [256], vehicle_embs [10, 256]
  - 注意力权重可提取用于可视化

**Codex完成说明**：
- [x] Transformer模型已实现
- [x] 工具函数已创建
- [x] 单元测试通过
- 完成日期：2026-07-23
- 修改的文件：`BackEnd/src/models/transformer.py`、`BackEnd/src/models/utils.py`、`Test/unit/test_transformer.py`
- 验证记录：批量前向传播、掩码、梯度及注意力权重形状测试通过；输出保留batch维度

---

#### 任务008：简化网络抽象层
**状态**：🟢 已完成  
**优先级**：高  
**描述**：实现简化版网络抽象层

**需求**：
- 创建 `BackEnd/src/environment/network_model.py`：
  - 时延模型：`base_delay + distance/c + random_jitter`
  - 丢包率：距离阈值（>500m则10%丢包，否则0%）
  - 带宽：固定总量（100 Mbps），按分配比例计算
  - 提供 `calculate_transmission(sender_pos, receiver_pos, message_size, priority, current_load)` 接口
- 在 `Test/unit/` 创建测试

**验收条件**：
- 必须通过的命令：
  - `pytest Test/unit/test_network_model.py -v`
  - `ruff check BackEnd/src/environment/`
- 必须产生的文件：
  - `BackEnd/src/environment/network_model.py`
  - `Test/unit/test_network_model.py`
- 成功标准：
  - 时延计算合理（10-100ms范围）
  - 丢包率按距离正确触发
  - 带宽分配总和不超过100%

**Codex完成说明**：
- [x] 网络模型已实现
- [x] 测试已通过
- 完成日期：2026-07-23
- 修改的文件：`BackEnd/src/environment/network_model.py`、`Test/unit/test_network_model.py`
- 验证记录：时延、500米丢包边界、优先级带宽分配、满负载与非法输入测试通过

---

#### 任务009：Gymnasium Environment Wrapper
**状态**：🟢 已完成  
**优先级**：高  
**描述**：实现V2X通信仿真的Gymnasium环境接口

**需求**：
- 创建 `BackEnd/src/environment/v2x_env.py`：
  - 实现Gymnasium API（`reset()`, `step(action)`, `render()`, `close()`）
  - **离线模式**：读取SUMO生成的轨迹文件和事件JSON
  - 状态空间：从轨迹中提取车辆状态 + 事件信息，构建Transformer输入
  - 动作空间：Multi-discrete（接收者选择 + 优先级 + 带宽分配）
  - 奖励函数（简化版）：
    - `reward = delivery_success_rate - avg_delay_penalty`
    - delivery_success_rate：成功送达的关键消息比例
    - avg_delay_penalty：平均时延的归一化惩罚
  - 调用网络抽象层计算传输结果
- 创建 `BackEnd/src/environment/reward_calculator.py`（奖励计算逻辑）
- 在 `Test/unit/` 创建测试

**验收条件**：
- 必须通过的命令：
  - `pytest Test/unit/test_v2x_env.py -v`
  - `ruff check BackEnd/src/environment/`
- 必须产生的文件：
  - `BackEnd/src/environment/v2x_env.py`
  - `BackEnd/src/environment/reward_calculator.py`
  - `Test/unit/test_v2x_env.py`
- 成功标准：
  - `reset()` 返回正确的observation字典
  - `step(action)` 执行后返回 (obs, reward, terminated, truncated, info)
  - 奖励计算合理（-1.0 到 1.0 范围）
  - 至少运行一个完整episode（10个时间步）

**Codex完成说明**：
- [x] Environment Wrapper已实现
- [x] 奖励计算器已创建
- [x] 测试已通过
- 完成日期：2026-07-23
- 修改的文件：`BackEnd/src/environment/v2x_env.py`、`BackEnd/src/environment/reward_calculator.py`、`Test/unit/test_v2x_env.py`
- 验证记录：固定padding observation和Multi-discrete action通过Gymnasium测试；完整10步episode、300米关键车辆及奖励边界测试通过

---

#### 任务010：PPO Agent基础版
**状态**：🟢 已完成  
**优先级**：高  
**描述**：使用Stable-Baselines3实现PPO强化学习智能体

**需求**：
- 创建 `BackEnd/src/models/ppo_agent.py`：
  - 基于Stable-Baselines3的PPO
  - 策略网络：将Transformer输出作为特征输入
  - Actor网络：MLP [state_dim → 512 → 256 → action_logits]
  - Critic网络：MLP [state_dim → 512 → 256 → 1]
  - 训练参数：
    - learning_rate: 3e-4
    - clip_epsilon: 0.2
    - entropy_coef: 0.01
    - batch_size: 64
    - n_epochs: 10
- 创建 `BackEnd/src/training/train_ppo.py`（训练脚本）
- 创建训练配置 `BackEnd/configs/training_config.yaml`
- 在 `Test/unit/` 创建测试

**验收条件**：
- 必须通过的命令：
  - `python BackEnd/src/training/train_ppo.py --config configs/training_config.yaml --episodes 10 --output experiments/test_ppo`
  - `pytest Test/unit/test_ppo_agent.py -v`
  - `ruff check BackEnd/src/models/ BackEnd/src/training/`
- 必须产生的文件：
  - `BackEnd/src/models/ppo_agent.py`
  - `BackEnd/src/training/train_ppo.py`
  - `BackEnd/configs/training_config.yaml`
  - `Test/unit/test_ppo_agent.py`
  - 训练输出：`experiments/test_ppo/model.zip`, `tensorboard日志`
- 成功标准：
  - 训练10个episode后reward曲线有上升趋势
  - 模型可保存和加载
  - TensorBoard日志可查看

**Codex完成说明**：
- [x] PPO Agent已实现
- [x] 训练脚本已创建
- [x] 配置文件已创建
- [x] 测试已通过
- 完成日期：2026-07-23
- 修改的文件：`BackEnd/src/models/ppo_agent.py`、`BackEnd/src/training/train_ppo.py`、`BackEnd/configs/training_config.yaml`、`Test/unit/test_ppo_agent.py`、`BackEnd/pyproject.toml`
- 验证记录：10个episode训练完成，验证平均reward由0.241提升至0.642；`model.zip`、最终检查点、训练摘要和TensorBoard日志均已生成；模型保存加载测试通过

---

#### 任务011：基线方法实现
**状态**：🟢 已完成  
**优先级**：高  
**描述**：实现对比基线方法（全量广播、距离筛选）

**需求**：
- 创建 `BackEnd/src/evaluation/baselines.py`：
  - **全量广播**：将消息发送给通信范围内所有车辆
  - **距离筛选**：仅发送给事件点300米半径内的车辆
  - 统一接口：`select_receivers(vehicles, event, method='broadcast'|'distance')`
- 创建 `BackEnd/src/evaluation/evaluator.py`：
  - 评估指标计算：
    - 端到端时延（均值、P50/P95/P99）
    - 有效送达率
    - 通信开销（发送消息数 / 有效送达数）
  - 对比评估功能：运行AI方法和基线方法，输出对比结果
- 在 `Test/unit/` 创建测试

**验收条件**：
- 必须通过的命令：
  - `pytest Test/unit/test_baselines.py -v`
  - `pytest Test/unit/test_evaluator.py -v`
  - `ruff check BackEnd/src/evaluation/`
- 必须产生的文件：
  - `BackEnd/src/evaluation/baselines.py`
  - `BackEnd/src/evaluation/evaluator.py`
  - `Test/unit/test_baselines.py`
  - `Test/unit/test_evaluator.py`
- 成功标准：
  - 全量广播：选择所有车辆
  - 距离筛选：正确过滤300米内车辆
  - 评估器能输出3种方法的对比数据

**Codex完成说明**：
- [x] 基线方法已实现
- [x] 评估器已创建
- [x] 测试已通过
- 完成日期：2026-07-23
- 修改的文件：`BackEnd/src/evaluation/baselines.py`、`BackEnd/src/evaluation/evaluator.py`、`Test/unit/test_baselines.py`、`Test/unit/test_evaluator.py`
- 验证记录：全量广播、300米距离边界、时延分位数、有效送达率、零送达开销及AI/广播/距离三方法结果测试通过

---

#### 任务012：前端地图可视化基础
**状态**：🟢 已完成  
**优先级**：中  
**描述**：集成Leaflet地图，显示车辆和事件

**需求**：
- 创建 `FrontEnd/src/components/MapView/MapView.tsx`：
  - 集成Leaflet地图库
  - 显示简单道路网络（高速公路3车道）
- 创建 `FrontEnd/src/components/MapView/VehicleLayer.tsx`：
  - 在地图上显示车辆位置（圆点标记）
  - 车辆颜色区分：正常（蓝色）、发送消息（绿色）、接收消息（橙色）
- 创建 `FrontEnd/src/components/MapView/EventLayer.tsx`：
  - 显示事件位置（警告图标）
  - 事件类型：急刹（红色）
- 更新 `FrontEnd/src/App.tsx`：集成MapView组件
- 安装依赖：`leaflet`, `react-leaflet`, `@types/leaflet`

**数据来源（本轮）**：
- 使用前端本地mock数据验证组件功能
- Mock数据结构：
  - 5辆车：位置坐标、速度、状态（正常/发送/接收）
  - 1个事件：急刹事件，位置坐标、时间戳
- 保留现有WebSocket test消息兼容
- 完整state_update消息格式待后端Environment完成后统一定义

**验收条件**：
- 必须通过的命令：
  - `cd FrontEnd && npm run lint`
  - `cd FrontEnd && npm run build`
- 必须产生的文件：
  - `FrontEnd/src/components/MapView/MapView.tsx`
  - `FrontEnd/src/components/MapView/VehicleLayer.tsx`
  - `FrontEnd/src/components/MapView/EventLayer.tsx`
  - 更新的 `FrontEnd/src/App.tsx`
  - 更新的 `FrontEnd/package.json`（含Leaflet依赖）
- 成功标准：
  - `./start.sh` 启动后浏览器显示地图
  - 能显示测试数据：5辆车 + 1个事件
  - 地图可缩放和拖拽

**Codex完成说明**：
- [x] MapView组件已创建
- [x] VehicleLayer和EventLayer已实现
- [x] Leaflet依赖已安装
- [x] 浏览器显示正常
- 完成日期：2026-07-23
- 修改的文件：`FrontEnd/src/components/MapView/`、`FrontEnd/src/data/mockSimulation.ts`、`FrontEnd/src/types/simulation.ts`、`FrontEnd/src/App.tsx`、`FrontEnd/src/styles.css`、`FrontEnd/package.json`、`FrontEnd/package-lock.json`
- 验证记录：浏览器确认三车道、5辆mock车辆、1个急刹事件、缩放拖拽及现有WebSocket test消息正常；ESLint和生产构建通过

---

#### 任务013：前端消息传播动画
**状态**：🟢 已完成  
**优先级**：中  
**描述**：实现消息传播的可视化动画

**需求**：
- 创建 `FrontEnd/src/components/MapView/MessageLayer.tsx`：
  - 显示发送者→接收者的连线
  - 动画效果：线条从发送者流向接收者（1秒动画）
  - 颜色：成功送达（绿色）、超时（红色）
- 创建 `FrontEnd/src/components/MetricsPanel/RealtimeMetrics.tsx`：
  - 显示实时指标：当前时延、覆盖率、通信开销
  - 简单数值显示（卡片布局）
- 更新WebSocket消息处理：接收并渲染消息传播数据

**数据来源（本轮）**：
- 使用前端本地mock数据验证动画和指标显示
- Mock数据结构：
  - 消息传播：3条消息（车辆0→车辆1/2/3），包含发送者、接收者、状态（成功/超时）
  - 实时指标：时延（25ms）、覆盖率（80%）、通信开销（1.5x）
- 动画效果和性能验证不依赖真实后端数据
- 完整WebSocket消息协议待任务009完成后定义

**验收条件**：
- 必须通过的命令：
  - `cd FrontEnd && npm run lint`
  - `cd FrontEnd && npm run build`
- 必须产生的文件：
  - `FrontEnd/src/components/MapView/MessageLayer.tsx`
  - `FrontEnd/src/components/MetricsPanel/RealtimeMetrics.tsx`
  - 更新的 `FrontEnd/src/App.tsx`
- 成功标准：
  - 浏览器显示消息传播动画
  - 指标面板显示实时数值
  - 动画流畅（>30fps）

**Codex完成说明**：
- [x] MessageLayer已实现
- [x] RealtimeMetrics已实现
- [x] 动画效果已验证
- 完成日期：2026-07-23
- 修改的文件：`FrontEnd/src/components/MapView/MessageLayer.tsx`、`FrontEnd/src/components/MetricsPanel/RealtimeMetrics.tsx`、`FrontEnd/src/data/mockSimulation.ts`、`FrontEnd/src/App.tsx`、`FrontEnd/src/styles.css`
- 验证记录：浏览器确认车辆0到车辆1/2/3共3条传播线、成功/超时配色、1秒CSS流动动画，以及25ms、80%、1.5x指标显示正常；未定义或接入真实state_update协议

---

#### 任务014：后端WebSocket完整状态推送
**状态**：🟢 已完成  
**优先级**：高  
**描述**：实现完整的仿真状态WebSocket推送，替换测试消息

**需求**：
- 在 `BackEnd/app/main.py` 添加 `/ws/simulation/run` 端点：
  - 接收场景配置参数（场景路径、模型路径、speed倍率）
  - 加载V2X环境和训练好的PPO模型
  - 每个时间步执行：
    1. 从环境获取当前状态
    2. PPO模型推理得到动作
    3. 环境step执行动作
    4. 构建state_update消息推送到前端
  - 支持播放控制（播放/暂停/重置/倍速）
- 定义 **state_update 消息格式**：
  ```json
  {
    "type": "state_update",
    "timestamp": 1234567890.123,
    "vehicles": [
      {"id": "v0", "x": 100.5, "y": 50.2, "vx": 25.0, "vy": 0.0, "heading": 0.0, "status": "normal|sending|receiving"}
    ],
    "events": [
      {"id": "e0", "type": "emergency_brake", "x": 500.0, "y": 50.0, "timestamp": 10.5, "severity": 0.9}
    ],
    "messages": [
      {"from": "v0", "to": "v1", "status": "success|timeout", "delay_ms": 25.3}
    ],
    "metrics": {
      "avg_delay_ms": 28.5,
      "delivery_rate": 0.85,
      "comm_overhead": 1.3
    },
    "decision": {
      "selected_receivers": ["v1", "v2", "v3"],
      "priority": "high",
      "bandwidth_allocation": [0.3, 0.3, 0.4]
    }
  }
  ```
- 创建 `Test/integration/test_simulation_websocket.py`（集成测试）

**验收条件**：
- 必须通过的命令：
  - `pytest Test/integration/test_simulation_websocket.py -v`
  - `ruff check BackEnd/app/`
- 必须产生的文件：
  - 更新的 `BackEnd/app/main.py`
  - `Test/integration/test_simulation_websocket.py`
- 成功标准：
  - WebSocket能推送完整state_update消息
  - 消息格式符合上述定义
  - 至少运行10个时间步无错误
  - 播放控制命令响应正常

**Codex完成说明**：
- [x] WebSocket仿真端点已实现
- [x] state_update消息格式已定义
- [x] 集成测试已通过
- 完成日期：2026-07-23
- 修改的文件：`BackEnd/app/main.py`、`BackEnd/src/environment/v2x_env.py`、`BackEnd/src/models/ppo_agent.py`、`Test/integration/test_simulation_websocket.py`
- 验证记录：完整推送10个真实状态步；播放、暂停、重置、倍速、结束及资源错误协议通过；旧test端点保持兼容

---

#### 任务015：前端接入真实仿真数据
**状态**：🟢 已完成  
**优先级**：高  
**描述**：更新前端组件，从WebSocket接收并渲染真实仿真数据

**需求**：
- 更新 `FrontEnd/src/hooks/useWebSocket.ts`：
  - 区分 `test` 消息（旧）和 `state_update` 消息（新）
  - 解析state_update消息并提供给组件
- 更新 `FrontEnd/src/App.tsx`：
  - 移除mock数据，使用WebSocket实时数据
  - 添加仿真控制面板（播放/暂停/重置/倍速按钮）
- 更新所有可视化组件以接收真实数据：
  - `MapView`：车辆和事件位置实时更新
  - `MessageLayer`：根据实际消息传播绘制动画
  - `RealtimeMetrics`：显示真实指标数值
- 创建 `FrontEnd/src/components/ControlPanel/SimulationControl.tsx`（控制面板）

**验收条件**：
- 必须通过的命令：
  - `cd FrontEnd && npm run lint`
  - `cd FrontEnd && npm run build`
- 必须产生的文件：
  - 更新的 `FrontEnd/src/hooks/useWebSocket.ts`
  - 更新的 `FrontEnd/src/App.tsx`
  - `FrontEnd/src/components/ControlPanel/SimulationControl.tsx`
  - 更新的所有MapView和MetricsPanel组件
- 成功标准：
  - `./start.sh` 后点击"运行仿真"按钮
  - 浏览器显示真实场景（50辆车动态移动）
  - 消息传播动画与真实决策一致
  - 指标实时更新
  - 播放控制按钮功能正常

**Codex完成说明**：
- [x] WebSocket集成已完成
- [x] 仿真控制面板已实现
- [x] 真实数据渲染已验证
- 完成日期：2026-07-23
- 修改的文件：`FrontEnd/src/hooks/useWebSocket.ts`、`FrontEnd/src/App.tsx`、`FrontEnd/src/components/ControlPanel/SimulationControl.tsx`及地图/指标组件
- 验证记录：真实浏览器完成模型连接、车辆动态状态、PPO决策、10步结束、重置和2x控制验证；前端lint与build通过

---

#### 任务016：第3个基线方法（紧急度优先）
**状态**：🟢 已完成  
**优先级**：中  
**描述**：实现紧急度优先基线方法

**需求**：
- 在 `BackEnd/src/evaluation/baselines.py` 添加：
  - **紧急度优先**：根据事件severity分配带宽和优先级
    - High severity (>0.7)：分配50%带宽，高优先级
    - Medium severity (0.4-0.7)：分配30%带宽，中优先级
    - Low severity (<0.4)：分配20%带宽，低优先级
  - 接收者选择：与AI方法相同（300米内）
  - 更新 `select_receivers` 接口支持 `method='urgency'`
- 更新 `BackEnd/src/evaluation/evaluator.py`：
  - 支持4种方法对比（AI + 3个基线）
- 更新测试

**验收条件**：
- 必须通过的命令：
  - `pytest Test/unit/test_baselines.py -v`
  - `pytest Test/unit/test_evaluator.py -v`
  - `ruff check BackEnd/src/evaluation/`
- 必须产生的文件：
  - 更新的 `BackEnd/src/evaluation/baselines.py`
  - 更新的 `BackEnd/src/evaluation/evaluator.py`
  - 更新的测试文件
- 成功标准：
  - 紧急度优先正确按severity分配资源
  - 评估器输出4种方法对比

**Codex完成说明**：
- [x] 紧急度优先基线已实现
- [x] 评估器已更新
- [x] 测试已通过
- 完成日期：2026-07-23
- 修改的文件：`BackEnd/src/evaluation/baselines.py`、`BackEnd/src/evaluation/evaluator.py`及对应测试
- 验证记录：severity边界、300米选择、结构化带宽分配和AI加三基线的四方法输出均通过

---

#### 任务017：城市场景生成（100辆车）
**状态**：🟢 已完成  
**优先级**：中  
**描述**：生成中等规模城市场景，为M2做准备

**需求**：
- 创建 `BackEnd/scripts/generate_urban_scenario.py`：
  - 城市路网：2-3个交叉口，多车道
  - 100辆车，随机初始位置和速度（30-60 km/h）
  - 触发2-3个事件（急刹 + 障碍物 + 交叉口碰撞预警）
  - 输出格式与高速场景一致
- 创建配置文件 `BackEnd/configs/scenarios/urban_intersection.yaml`
- 更新测试

**验收条件**：
- 必须通过的命令：
  - `python BackEnd/scripts/generate_urban_scenario.py --output experiments/test_urban`
  - `pytest Test/unit/test_scenario_generation.py -v`（需更新测试支持城市场景）
- 必须产生的文件：
  - `BackEnd/scripts/generate_urban_scenario.py`
  - `BackEnd/configs/scenarios/urban_intersection.yaml`
  - 更新的测试文件
  - 示例输出：`experiments/test_urban/trajectory.xml`, `events.json`
- 成功标准：
  - 生成的场景可被SUMO加载
  - 车辆数量100辆
  - 包含交叉口结构
  - 事件类型包含3种

**Codex完成说明**：
- [x] 城市场景生成脚本已创建
- [x] 配置文件已创建
- [x] SUMO加载验证通过
- 完成日期：2026-07-23
- 修改的文件：`BackEnd/scripts/generate_urban_scenario.py`、`BackEnd/configs/scenarios/urban_intersection.yaml`、`BackEnd/configs/training_urban.yaml`及对应测试
- 验证记录：真实SUMO生成100辆车、3个信号交叉口和3类事件；100车/3事件环境与PPO预测冒烟通过

---

#### 任务018：升级网络抽象层（3GPP模型）
**状态**：🟢 已完成  
**优先级**：低  
**描述**：将简化网络模型升级为基于3GPP TR 38.901的信道模型

**需求**：
- 更新 `BackEnd/src/environment/network_model.py`：
  - 实现3GPP TR 38.901路径损耗公式
    - Urban Macro场景：`PL = 28.0 + 22*log10(d) + 20*log10(fc)`
    - Highway场景：`PL = 32.4 + 20*log10(d) + 20*log10(fc)`
  - 根据路径损耗计算SINR
  - 根据SINR计算丢包率（查表或公式）
  - 排队时延模型：`queue_delay = f(load, priority)`（考虑优先级）
  - 保持向后兼容（提供 `mode='simple'|'3gpp'` 参数）
- 更新配置以支持模式切换
- 更新测试

**验收条件**：
- 必须通过的命令：
  - `pytest Test/unit/test_network_model.py -v`
  - `ruff check BackEnd/src/environment/`
- 必须产生的文件：
  - 更新的 `BackEnd/src/environment/network_model.py`
  - 更新的测试文件
- 成功标准：
  - 3GPP模式下路径损耗计算正确
  - 丢包率与SINR对应合理
  - 简单模式仍可用（向后兼容）

**Codex完成说明**：
- [x] 3GPP信道模型已实现
- [x] 向后兼容验证通过
- [x] 测试已通过
- 完成日期：2026-07-23
- 修改的文件：`BackEnd/src/environment/network_model.py`、训练配置、环境配置接线及对应测试
- 验证记录：Urban/Highway路径损耗、SINR Logistic丢包、优先级排队时延和simple回归均通过；模式可由训练YAML切换

---

### 被阻塞任务
*暂无*

---

## 💬 通信协议

### 文档职责分工

| 文档 | 职责 | 更新时机 |
|------|------|----------|
| `ARCHITECT_CODEX_BRIDGE.md` | 当前任务、状态、阻塞问题 | 任务状态变化时 |
| `TODO.md` | 路线图与未来工作 | 计划优先级变化时 |
| `task_memory.md` | 已完成任务历史 | 任务完成后 |
| `ARCHITECTURE.md` | 已生效的稳定架构 | 架构决策确认后 |
| `README.md` / `Docs/` | 使用文档 | 用户行为变化时 |

**冲突优先级**：用户指令 > 本文档活跃任务 > ARCHITECTURE.md > TODO.md > task_memory.md

### 沟通流程

**架构师 → Codex**：
1. 在”活跃任务”添加任务（含详细规范和验收条件）
2. 审查完成工作并提供反馈
3. 记录重大架构决策

**Codex → 架构师**：
1. 更新任务状态（🔴 → 🟡 → 🟢 → ⚫）
2. 填写完成说明（修改文件、验证记录、遗留问题）
3. 阻塞时移至”被阻塞任务”并说明原因
4. 需澄清时在任务下添加 **❓ 向架构师提问**

---

## 🔍 决策日志

**格式**：
```markdown
### 决策XXX：[标题]
**日期**：YYYY-MM-DD  
**背景**：[为什么需要]  
**决策**：[决定了什么]  
**理由**：[为什么选择这个方案]  
**影响**：[对实现的影响]
```

### 活跃决策
*暂无*

---

## 🔗 相关文档
- [TODO.md](TODO.md) - 项目路线图
- [task_memory.md](task_memory.md) - 完成任务历史
- [ARCHITECTURE.md](ARCHITECTURE.md) - 稳定架构文档
- [README.md](README.md) - 项目概览

---

**最后更新**：2026-07-23  
**文档版本**：2.0.0
