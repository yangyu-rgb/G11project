# TODO

更新时间：2026-07-22 23:00（Asia/Hong_Kong）

## 当前阶段
**M0: 环境搭建与基础框架** (Week 1-2)

## 进行中

- 暂无。

## 待办

### M0: 环境搭建 (Week 1-2)
- [x] 完成后端目录结构完善（任务000）
- [x] 配置Python环境和核心依赖（任务001）
- [x] SUMO安装与简单示例验证
- [x] 实现WebSocket基础通信（后端推送测试消息，前端接收）
- [x] 编写基础测试框架

### M1: 简单场景原型 (Week 3-5)
- [ ] 实现SUMO高速公路场景生成（30-50辆车，急刹事件）
- [ ] 实现Transformer模型（4层，8头注意力）
- [ ] 实现简化网络抽象层
- [ ] 实现Gymnasium Environment Wrapper
- [ ] 实现PPO Agent基础版（使用Stable-Baselines3）
- [ ] 实现基线方法（全量广播、距离筛选）
- [ ] 前端集成Leaflet地图可视化
- [ ] 前端实现消息传播动画
- [ ] 前端实现基础指标面板

### 架构与文档
- [x] 创建 `Docs/TECHNICAL_SPECIFICATION.md`（技术规范详细说明）
- [x] 创建 `Docs/IMPLEMENTATION_ROADMAP.md`（分阶段实施路线图）
- [x] 创建 `Docs/DEMO_GUIDE.md`（演示脚本与指南）
- [ ] 确认项目提案最终版本

## 已完成

- [x] 2026-07-21：初始化 Git 仓库基础文件。
- [x] 2026-07-21：建立 React + TypeScript + Vite 前端骨架。
- [x] 2026-07-21：建立 FastAPI 后端骨架和健康检查接口。
- [x] 2026-07-21：建立 `Docs/`、`task_memory.md` 与 TODO 维护机制。
- [x] 2026-07-21：将仓库统一为 `FrontEnd`、`BackEnd`、`Docs`、`Test` 四个业务目录，并将项目记录改为根目录独立文档。
- [x] 2026-07-21：统一四目录下的 AI/ML 模块映射，并明确桥接文档、架构、TODO 与 task memory 的职责边界。
- [x] 2026-07-22：建立前后端 GitHub Actions 持续集成流程和 push/PR 合并规范。
- [x] 2026-07-22：提供根目录 `./start.sh` 一键初始化并启动前后端服务。
- [x] 2026-07-22：完成交接任务000、001、003、004、005及全部核心验收。

## 维护规则

- 开始任务时，将对应事项放入“进行中”。
- 完成任务时，将其移入“已完成”并标注日期。
- 每次任务结束时同步更新本文件、`ARCHITECTURE.md`/相关 `Docs/` 和 `task_memory.md`。
