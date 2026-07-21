# 系统架构

更新时间：2026-07-21

## 总览

```text
Browser
   │
   ▼
FrontEnd (React + TypeScript + Vite, :5173)
   │  HTTP /api/v1/*
   ▼
BackEnd (FastAPI, :8000)
   │
   └── 后续接入数据库、缓存和外部服务
```

前后端作为独立应用维护，可分别开发、测试、构建与部署。开发期间，Vite 将 `/api` 代理到后端，避免在业务代码中写死后端地址。

## 前端边界

- `FrontEnd/src/`：页面、组件、状态与 API 调用。
- `FrontEnd/public/`：后续存放无需构建处理的静态资源。
- 前端不直接访问数据库或保存服务端密钥。

## 后端边界

- `BackEnd/app/main.py`：应用入口。
- `BackEnd/app/api/router.py`：API 路由汇总。
- `BackEnd/app/api/routes/`：按业务域拆分接口。
- `Test/`：前后端统一自动化测试目录。
- 新接口默认使用 `/api/v1` 前缀，便于后续版本演进。

## 配置原则

- 本地配置从各应用的 `.env` 读取，仓库只提交 `.env.example`。
- 密钥、令牌和真实连接信息不得提交到 Git。
- 生产环境的跨域、数据库和认证配置在相关功能引入时补充。
