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

**当前阶段**: M1 - 简单场景原型（Week 3-5）

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

**最后更新**：2026-07-22  
**文档版本**：2.0.0
