# CI/CD 与代码合并规范

更新时间：2026-07-22

## 自动检查

GitHub Actions 工作流位于 `.github/workflows/ci.yml`，以下事件会触发检查：

- 向任意分支 push；
- 创建或更新 pull request；
- pull request 进入 merge queue；
- 在 GitHub Actions 页面手动运行。

每次运行包含三个并行、只读的检查任务：

| 检查名称 | 运行内容 |
|---|---|
| `Frontend checks` | `npm ci`、ESLint、TypeScript/Vite 生产构建 |
| `Backend checks` | 安装后端开发依赖、Ruff lint/格式检查、pytest |
| `Project checks` | 校验根目录一键启动脚本的 Bash 语法 |

同一分支有新提交时，旧的未完成运行会自动取消。工作流使用 npm 与 pip 缓存，并为每个任务设置 10 分钟超时。

## 推荐的 push 与合并流程

1. 从最新的 `main` 创建功能分支，不直接向 `main` 开发。
2. push 前在本地执行与 CI 相同的检查：

   ```bash
   cd FrontEnd
   npm ci
   npm run lint
   npm run build

   cd ../BackEnd
   python -m pip install -e '.[dev]'
   python -m ruff check . ../Test
   python -m ruff format --check . ../Test
   python -m pytest

   cd ..
   bash -n start.sh
   ```

3. push 功能分支并通过 pull request 合并。
4. CI 两项检查全部通过后再进行审查与合并；检查失败时先在 Actions 日志中定位失败步骤。

## GitHub 仓库保护设置

工作流首次运行成功后，由仓库管理员为 `main` 配置 ruleset 或 branch protection：

- 要求通过 pull request 才能合并；
- 要求状态检查 `Frontend checks`、`Backend checks` 和 `Project checks` 通过；
- 禁止 force push 和删除 `main`；
- 团队需要时再启用至少一名审查者、线性历史或 merge queue。

仓库保护属于 GitHub 远端设置，不能仅通过本仓库文件强制启用。

## CD 边界

当前尚未确定部署平台、环境和凭据，因此流水线不执行自动部署。确定部署目标后，应新增独立部署 job，并使用 GitHub Environment 管理测试/生产环境、审批和密钥；生产部署仅由已通过 CI 的受保护分支或版本标签触发。
