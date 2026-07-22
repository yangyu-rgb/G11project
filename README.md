# G11project

G11project 采用前后端分离架构：前端负责用户界面与 API 调用，后端负责业务逻辑、数据访问和对外接口。

## 目录结构

```text
.
├── FrontEnd/          # React + TypeScript + Vite
├── BackEnd/           # FastAPI
├── Docs/              # 项目扩展文档与协作规范
├── Test/              # 统一测试目录
├── README.md          # 项目入口说明
├── ARCHITECTURE.md    # 系统架构说明
├── task_memory.md     # 工作交接记录
└── TODO.md            # 未来工作计划
```

除工具生成且被 Git 忽略的缓存或依赖目录外，项目源码只使用上述四个业务目录。项目说明、架构、任务记忆和 TODO 均为根目录下的独立文档。

## 本地启动

首次启动会自动安装缺失的前端依赖，并创建后端虚拟环境。之后统一从项目根目录运行：

```bash
./start.sh
```

按 `Ctrl+C` 会同时停止前后端。默认地址：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:8000`
- API 文档：`http://localhost:8000/docs`
- 健康检查：`GET http://localhost:8000/api/v1/health`

如需覆盖监听地址或端口，可在命令前设置环境变量：

```bash
FRONTEND_PORT=3000 BACKEND_PORT=9000 ./start.sh
```

可配置项为 `FRONTEND_HOST`、`FRONTEND_PORT`、`BACKEND_HOST` 和 `BACKEND_PORT`。

## 项目文档

- [Capstone Project Proposal](Docs/Capstone_Project_Proposal.pdf)：AI-driven Intelligent V2X Communication Optimization for Autonomous Driving in 6G Networks。
- [CI/CD 与代码合并规范](Docs/CI_CD.md)：push/PR 自动检查、本地检查命令和 `main` 分支保护建议。
- [ARCHITECT_CODEX_BRIDGE.md](ARCHITECT_CODEX_BRIDGE.md)：架构师与 Codex 的当前任务、决策和阻塞沟通入口。
- [ARCHITECTURE.md](ARCHITECTURE.md)：软件系统架构说明。
- [task_memory.md](task_memory.md)：按时间追加的任务交接记录。
- [TODO.md](TODO.md)：当前计划与后续事项。

## 工作交接

每次任务完成后必须同步维护：

1. 按实际变化更新 `ARCHITECTURE.md` 或 `Docs/` 中的相关说明；
2. 在 `task_memory.md` 追加任务交接记录；
3. 更新 `TODO.md` 中的任务状态和后续计划。

记录只包含时间、内容、验证结果和后续事项，暂不记录操作者。详细规则见 [Docs/WORKFLOW.md](Docs/WORKFLOW.md)。
