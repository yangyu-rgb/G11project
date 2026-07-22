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

#### 任务000：后端目录结构完善
**状态**：🟢 已完成  
**优先级**：高  
**描述**：在既有四个顶层业务目录约束内，完善 BackEnd 的 AI/ML 项目结构

**需求**：
创建以下目录结构：
```
BackEnd/
├── app/                        # FastAPI服务（已存在）
├── src/
│   ├── models/                 # Transformer + RL模型定义
│   ├── environment/            # SUMO + 网络抽象层
│   ├── training/               # 训练循环和工具
│   ├── evaluation/             # 指标和基准测试
│   └── deployment/             # 模型导出工具
├── configs/                    # 配置文件（YAML/JSON）
│   └── scenarios/              # 场景配置子目录
├── experiments/                # 实验日志和结果（添加到.gitignore）
├── notebooks/                  # Jupyter notebooks
└── scripts/                    # 实用脚本
```

创建以下测试目录结构：
```
Test/
├── unit/                       # 单元测试
├── integration/                # 集成测试
└── e2e/                        # 端到端测试
```

**验收条件**：
- 必须通过的命令：`tree BackEnd Test -L 2`（验证目录存在）
- 必须产生的文件：所有上述目录，每个目录包含 `__init__.py`（Python包标识）
- 不允许修改：现有 `BackEnd/app/` 的内容
- 成功标准：
  - 目录结构符合规范
  - `.gitignore` 已添加 `experiments/`, `*.pyc`, `__pycache__/`, `.ipynb_checkpoints/`
  - README.md 已更新项目结构说明

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
**优先级**：高  
**描述**：配置Python环境并安装核心ML/RL依赖

**需求**：
创建 `BackEnd/requirements.txt`，包含：
- **ML框架**: `torch>=2.0.0`, `torchvision`, `torchaudio`
- **RL**: `gymnasium>=0.29.0`, `stable-baselines3>=2.0.0`
- **数据处理**: `numpy>=1.24.0`, `pandas>=2.0.0`
- **可视化**: `matplotlib>=3.7.0`, `tensorboard>=2.13.0`
- **SUMO**: `traci`, `sumolib`
- **配置**: `pyyaml>=6.0`, `python-dotenv>=1.0.0`
- **测试**: `pytest>=7.3.0`, `pytest-cov>=4.1.0`
- **代码质量**: `ruff>=0.1.0`

创建 `BackEnd/environment.yml` (conda环境)

在 `README.md` 添加安装说明部分

**验收条件**：
- 必须通过的命令：
  - `pip install -r BackEnd/requirements.txt`（在Python 3.10+虚拟环境）
  - `python -c "import torch; import gymnasium; import stable_baselines3; print('Success')"`
- 必须产生的文件：`BackEnd/requirements.txt`, `BackEnd/environment.yml`, 更新的 `README.md`
- 不允许修改：现有代码文件
- 成功标准：
  - 依赖安装成功（Mac CPU环境测试）
  - 核心库可导入
  - README.md 包含清晰的安装步骤

**Codex完成说明**：
- [x] requirements.txt 已创建
- [x] environment.yml 已创建
- [x] 在虚拟环境中测试安装
- [x] README.md 已添加安装说明
- 修改的文件：`BackEnd/requirements.txt`、`BackEnd/environment.yml`、`README.md`
- 验证记录：Python 3.12.13环境安装成功；PyTorch 2.13.0、Gymnasium 1.3.0、Stable-Baselines3 2.9.0导入成功；`pip check` 无冲突

---

#### 任务003：SUMO安装验证
**状态**：🟢 已完成
**优先级**：高  
**描述**：安装SUMO并创建简单验证脚本

**需求**：
- 在 `README.md` 中添加SUMO安装指南（Mac/Linux/Windows）
- 创建 `BackEnd/scripts/verify_sumo.py`：
  - 检查SUMO是否安装
  - 检查 `traci` 和 `sumolib` 是否可用
  - 生成一个最简单的SUMO场景并运行1秒
- 在 `Test/integration/` 创建 `test_sumo_integration.py`

**验收条件**：
- 必须通过的命令：
  - `python BackEnd/scripts/verify_sumo.py`（输出 "SUMO installation verified"）
  - `pytest Test/integration/test_sumo_integration.py -v`
- 必须产生的文件：
  - `BackEnd/scripts/verify_sumo.py`
  - `Test/integration/test_sumo_integration.py`
  - 更新的 `README.md`
- 成功标准：验证脚本成功运行，确认SUMO可用

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
**优先级**：高  
**描述**：实现后端WebSocket推送，前端接收测试消息

**需求**：
- 在 `BackEnd/app/main.py` 添加 WebSocket 端点 `/ws/simulation`
- 实现每秒推送测试消息：
  ```json
  {
    "type": "test",
    "timestamp": 1234567890.123,
    "message": "Hello from backend"
  }
  ```
- 在 `FrontEnd/src/hooks/useWebSocket.ts` 实现 WebSocket 连接
- 在 `FrontEnd/src/App.tsx` 显示接收到的消息

**验收条件**：
- 必须通过的命令：
  - `./start.sh` 启动前后端
  - 浏览器打开 `http://localhost:5173`，控制台显示接收到的消息
- 必须产生的文件：
  - 更新的 `BackEnd/app/main.py`
  - `FrontEnd/src/hooks/useWebSocket.ts`
  - 更新的 `FrontEnd/src/App.tsx`
- 成功标准：
  - 前端成功连接WebSocket
  - 每秒接收并显示测试消息
  - 断开重连机制正常工作

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
**优先级**：中  
**描述**：创建详细的技术规范、实施路线图和演示指南文档

**需求**：
根据已讨论的项目方向，创建以下文档：
- `Docs/TECHNICAL_SPECIFICATION.md`：完整技术方案总结
- `Docs/IMPLEMENTATION_ROADMAP.md`：分阶段实施路线图（M0-M5）
- `Docs/DEMO_GUIDE.md`：演示脚本与指南

**验收条件**：
- 必须产生的文件：上述3个文档
- 成功标准：
  - 文档结构清晰，包含所有必要章节
  - 技术规范涵盖所有模块设计
  - 路线图包含具体任务和验收标准
  - 演示指南按课程正式评分规范包含20分钟演示脚本

**Codex完成说明**：
- [x] TECHNICAL_SPECIFICATION.md 已创建
- [x] IMPLEMENTATION_ROADMAP.md 已创建
- [x] DEMO_GUIDE.md 已创建
- [x] 文档已添加到 ARCHITECTURE.md 的相关文档列表
- 修改的文件：`Docs/TECHNICAL_SPECIFICATION.md`、`Docs/IMPLEMENTATION_ROADMAP.md`、`Docs/DEMO_GUIDE.md`、`ARCHITECTURE.md`
- 验证记录：三份文档路径和链接存在；演示时长按正式评分规范修正为20分钟

---

### 已完成任务

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
