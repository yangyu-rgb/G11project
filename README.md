# G11project

**AI-Driven Intelligent V2X Communication Optimization for Autonomous Driving in 6G Networks**

面向6G自动驾驶的人工智能驱动车联网智能通信优化项目。采用 Transformer 环境理解与强化学习调度的融合方法，实现安全消息的智能选择性传播。

---

## 项目架构

前后端分离 + ML训练管道 + 可视化演示系统：

```text
G11project/
├── FrontEnd/          # React + TypeScript + Vite 前端界面
├── BackEnd/           # FastAPI 后端 + ML/RL 核心算法
│   ├── app/           # FastAPI 服务与 WebSocket
│   ├── src/           # 核心算法实现
│   │   ├── models/         # Transformer + PPO 模型
│   │   ├── environment/    # SUMO 仿真 + 网络抽象层
│   │   ├── training/       # 训练循环
│   │   ├── evaluation/     # 指标计算与基线对比
│   │   └── deployment/     # 模型导出
│   ├── configs/       # 配置文件与场景定义
│   ├── experiments/   # 实验日志和结果（git忽略）
│   ├── notebooks/     # Jupyter notebooks
│   └── scripts/       # 工具脚本
├── Test/              # 单元/集成/端到端测试
├── Docs/              # 技术文档与协作规范
├── README.md          # 项目入口说明（本文件）
├── ARCHITECTURE.md    # 系统架构详细说明
├── ARCHITECT_CODEX_BRIDGE.md  # 架构师-Codex 任务桥接
├── task_memory.md     # 工作交接历史记录
└── TODO.md            # 项目路线图与待办事项
```

---

## 快速开始

### 前置要求
- Python 3.12（项目基准版本）
- Node.js 18+
- SUMO 交通仿真器（安装说明见下方）

### 一键启动

首次启动会自动安装前端依赖，并创建包含仿真和PPO运行依赖的后端虚拟环境。

第一次执行 `./start.sh` 后，如果终端提示演示资源尚未准备，请保持服务运行并另开终端执行以下命令。生成与训练不会由启动脚本自动执行：

```bash
BackEnd/.venv/bin/python BackEnd/scripts/generate_highway_scenario.py --output experiments/test_scenario
BackEnd/.venv/bin/python BackEnd/src/training/train_ppo.py --config configs/training_config.yaml --episodes 10 --output experiments/test_ppo
```

日常开发使用一条命令同时启动前后端：

```bash
./start.sh
```

按 `Ctrl+C` 同时停止前后端。

**默认地址**：
- 前端：http://localhost:5173
- 后端：http://localhost:8000
- API 文档：http://localhost:8000/docs
- 健康检查：http://localhost:8000/api/v1/health

**自定义端口**：
```bash
FRONTEND_PORT=3000 BACKEND_PORT=9000 ./start.sh
```

可配置环境变量：`FRONTEND_HOST`, `FRONTEND_PORT`, `BACKEND_HOST`, `BACKEND_PORT`

---

## 安装依赖

### Python 环境（后端）

```bash
# 创建虚拟环境（推荐 Python 3.12）
cd BackEnd
python3.12 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt
```

**核心依赖**：PyTorch, Stable-Baselines3, Gymnasium, SUMO (traci), FastAPI

也可以使用 Conda 创建等价环境：

```bash
conda env create -f BackEnd/environment.yml
conda activate g11-v2x
```

### SUMO 交通仿真器

**macOS**：优先使用 [SUMO 官方安装包](https://sumo.dlr.de/docs/Downloads.php)。也可以使用 Homebrew：
```bash
brew tap dlr-ts/sumo
brew install sumo
```

**Ubuntu/Debian**:
```bash
sudo add-apt-repository ppa:sumo/stable
sudo apt-get update
sudo apt-get install sumo sumo-tools sumo-doc
```

**Windows**：从 [SUMO Releases](https://sumo.dlr.de/docs/Downloads.php) 下载64位安装包或压缩包，将安装目录的 `bin` 加入 `PATH`，并将 `SUMO_HOME` 指向SUMO安装目录。

安装后确认 `sumo --version` 和 `netgenerate --version` 均可运行。图形界面不是自动验证的必需条件。

**验证安装**:
```bash
BackEnd/.venv/bin/python BackEnd/scripts/verify_sumo.py
```

### 前端依赖

```bash
cd FrontEnd
npm install
```

---

## 开发指南

### 代码检查

**后端**（Python）:
```bash
cd BackEnd
ruff check .           # Lint 检查
ruff format --check .  # 格式检查
pytest                 # 运行测试
```

**前端**（TypeScript）:
```bash
cd FrontEnd
npm run lint           # ESLint 检查
npm run build          # 生产构建测试
```

### 训练模型

```bash
BackEnd/.venv/bin/python BackEnd/src/training/train_ppo.py \
  --config configs/training_config.yaml \
  --episodes 10 \
  --output experiments/test_ppo
```

### Google Colab Pro正式实验

任务024–032的GPU训练使用
[`BackEnd/notebooks/colab_formal_training.ipynb`](BackEnd/notebooks/colab_formal_training.ipynb)。
Notebook负责挂载Google Drive、安装SUMO、验证CUDA，并通过统一可恢复流水线依次完成奖励、特征、架构选择、
高速/城市批训练及后续对比、消融、泛化和论文图表。单次运行默认在9小时内安全暂停；Runtime重建后重复同一命令即可恢复。
不要同时使用多个Colab Runtime写入同一个实验目录，也不要加入自动点击或Keep Alive代码。

### Google Colab课程演示轻量实验

若只需要为课程展示生成高速场景的初步比较结果，使用
[`BackEnd/notebooks/colab_demo_lite_training.ipynb`](BackEnd/notebooks/colab_demo_lite_training.ipynb)。
该入口固定轻量Transformer和默认奖励，跳过奖励/特征/架构搜索、城市训练、消融与泛化，只运行
4配置×2种子的高速训练以及5个锁定测试配置×2种子×4方法的40行比较。结果写入独立的
`G11project-demo-lite` Drive目录，不读取或覆盖`G11project-formal`进度。所有输出必须标注为
highway-only preliminary course-demo results，不得作为论文级正式结论。

正式三维答辩使用的方向走廊模型通过
[`BackEnd/notebooks/colab_directional_corridor_v2.ipynb`](BackEnd/notebooks/colab_directional_corridor_v2.ipynb)
训练。v2保持Transformer-PPO和四维方向走廊动作不变，使用与现场演示一致的单事故协议、全新留出集及五方法比较；输出写入独立的
`G11project-directional-corridor-v2` Drive目录。metric schema v2会保留但排除无受影响车辆用例的未定义Coverage/Timely均值，重新验证已有champion，并导出逐事故四维动作证据。只有覆盖率、风险范围内最近后车覆盖、前车误通知、跨事故动作多样性和效率门禁全部通过时才生成可晋级的模型清单。

### 演示模式

```bash
./start.sh
```

打开前端后先在三维高速场景中选择事故车，再点击“开始演示”。系统会为同一事故预载PPO选择性通信与全量广播结果，并按38秒五幕时间线自动展示正常行驶、急刹事故、传统广播、AI精准通知和总结对比。演示支持暂停、重播和重新选择事故车；后端不可用时会明确标注“规则降级演示”，不会把规则结果冒充为模型结果。

M2城市100车场景可单独生成并开始训练：

```bash
BackEnd/.venv/bin/python BackEnd/scripts/generate_urban_scenario.py --output experiments/test_urban
BackEnd/.venv/bin/python BackEnd/src/training/train_ppo.py \
  --config configs/training_urban.yaml \
  --episodes 10 \
  --output experiments/urban_ppo
```

---

## 项目文档

### 核心文档
- [ARCHITECTURE.md](ARCHITECTURE.md) - 系统架构详细说明
- [ARCHITECT_CODEX_BRIDGE.md](ARCHITECT_CODEX_BRIDGE.md) - 当前任务与协作
- [TODO.md](TODO.md) - 项目路线图
- [task_memory.md](task_memory.md) - 工作交接历史

### 技术文档（Docs/）
- [Capstone Project Proposal](Docs/Capstone_Project_Proposal.pdf) - 项目提案
- [CI/CD 规范](Docs/CI_CD.md) - 持续集成与代码合并
- [技术规范](Docs/TECHNICAL_SPECIFICATION.md) - 详细技术方案
- [实施路线图](Docs/IMPLEMENTATION_ROADMAP.md) - 分阶段计划
- [演示指南](Docs/DEMO_GUIDE.md) - 演示脚本

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React + TypeScript + Vite |
| 3D高速场景 | Three.js + React Three Fiber |
| 指标与界面 | React + CSS |
| 后端框架 | FastAPI |
| 通信协议 | WebSocket |
| ML框架 | PyTorch |
| RL库 | Stable-Baselines3 |
| 仿真工具 | SUMO |
| 环境接口 | Gymnasium |
| 测试框架 | Pytest（后端）, Node test + tsx（前端） |
| 代码检查 | Ruff（后端）, ESLint（前端） |
| CI/CD | GitHub Actions |

---

## 贡献指南

### 工作流程
1. 从 `main` 分支创建功能分支
2. 完成开发并通过本地检查
3. 提交 Pull Request
4. 等待 CI 检查通过
5. Code Review 后合并

### 任务完成后必须同步维护
1. 更新 `ARCHITECTURE.md` 或 `Docs/` 相关文档
2. 在 `task_memory.md` 追加任务记录
3. 更新 `TODO.md` 任务状态

详细规则见 [Docs/WORKFLOW.md](Docs/WORKFLOW.md)

---

## 许可证

待定

---

## 联系方式

项目负责人：Yang Yu  
课程：6G 与人工智能物联网（AIoT）
