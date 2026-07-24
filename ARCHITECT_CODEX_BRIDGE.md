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

**当前阶段**: M2 - 算法优化与演示准备（并行GPU训练）

#### 任务030：完整奖励函数实现与权重优化
**状态**：🟡 进行中（实现与3125组离线smoke完成，GPU正式复训待执行）
**优先级**：高
**描述**：实现完整的分段奖励函数并在验证集上优化权重

**需求**：
- 更新 `BackEnd/src/environment/reward_calculator.py`：
  - 实现完整奖励函数：
    ```python
    reward = α·有效送达率 + β·覆盖率 - γ·分段时延 - δ·通信开销 - ε·漏送惩罚 + ζ·公平性
    ```
  - **分段时延**：
    - 决策延迟（Transformer + PPO推理时间）
    - 排队延迟（网络层负载排队）
    - 传输延迟（物理传播时间）
    - 分别记录并加权求和
  - **紧急度加权**：
    - 根据事件severity调整送达率权重
    - High severity (>0.7)：权重×2
    - Medium severity (0.4-0.7)：权重×1
    - Low severity (<0.4)：权重×0.5
  - **公平性指标**：
    - 计算受影响车辆的覆盖方差
    - 惩罚只关注部分车辆忽略其他车辆的情况
- 实现权重优化 `BackEnd/scripts/optimize_reward_weights.py`：
  - 在验证集上进行网格搜索
  - 搜索空间：α, β, γ, δ, ε ∈ [0.1, 0.5, 1.0, 2.0, 5.0]
  - 目标：最大化验证集上的综合性能（覆盖率×0.4 + (1-归一化时延)×0.3 + (1-开销)×0.3）
  - 使用交叉验证（7个验证场景）
  - 输出最优权重配置
- 更新配置文件以支持权重切换
- 创建测试

**验收条件**：
- 必须通过的命令：
  - `python BackEnd/scripts/optimize_reward_weights.py --config configs/reward_optimization.yaml --output experiments/reward_weights`
  - `pytest Test/unit/test_reward_calculator.py -v`
  - `ruff check BackEnd/src/environment/ BackEnd/scripts/`
- 必须产生的文件：
  - 更新的 `BackEnd/src/environment/reward_calculator.py`
  - `BackEnd/scripts/optimize_reward_weights.py`
  - `BackEnd/configs/reward_optimization.yaml`
  - `experiments/reward_weights/best_weights.json`
  - `experiments/reward_weights/grid_search_results.csv`
- 成功标准：
  - 分段时延正确计算（3个组成部分）
  - 紧急度加权生效
  - 网格搜索完成（5^5 = 3125个配置，可采样减少）
  - 最优权重在验证集上性能优于默认权重至少10%

**Codex完成说明**：
- [x] 完整奖励函数已实现
- [x] 权重优化脚本已创建
- [x] 网格搜索已完成（离线smoke，未作为正式实验结论）
- [ ] 最优权重已确定

---

#### 任务031：特征工程增强
**状态**：🟡 进行中（特征实现与兼容性测试完成，正式性能对比待GPU）
**优先级**：高
**描述**：增强车辆和事件的特征提取，提供更丰富的信息给模型

**需求**：
- 更新 `BackEnd/src/models/utils.py` 添加特征提取函数：
  - **相对特征**（车辆-车辆）：
    - 相对距离（欧氏距离）
    - 相对速度（速度差的模）
    - 相对航向角（角度差）
    - 是否同车道
  - **相对特征**（车辆-事件）：
    - 到事件的距离
    - 朝向事件的角度差
    - 是否在事件影响区域（300米）
  - **高阶特征**：
    - 加速度（速度变化率）
    - TTC (Time-to-Collision)：当前速度下多久会到达事件位置
    - 车道变化频率（如适用）
  - **历史特征**（时序）：
    - 过去5步的位置轨迹
    - 过去5步的速度变化
    - 使用滑动窗口编码
  - **环境特征**：
    - 当前车道ID
    - 前方车辆数量（100米内）
    - 后方车辆数量（100米内）
- 更新 `BackEnd/src/environment/v2x_env.py`：
  - 在构建observation时调用增强特征提取
  - 保持向后兼容（可通过配置开关）
- 更新Transformer输入维度以适应新特征
- 创建测试验证特征计算正确性

**验收条件**：
- 必须通过的命令：
  - `pytest Test/unit/test_feature_extraction.py -v`
  - `ruff check BackEnd/src/models/ BackEnd/src/environment/`
- 必须产生的文件：
  - 更新的 `BackEnd/src/models/utils.py`
  - 更新的 `BackEnd/src/environment/v2x_env.py`
  - `Test/unit/test_feature_extraction.py`
  - 更新的配置文件（支持特征开关）
- 成功标准：
  - 所有新特征计算正确
  - TTC计算合理（考虑零速度情况）
  - 历史特征正确维护滑动窗口
  - 与简单特征版本性能对比（至少持平或提升）

**Codex完成说明**：
- [x] 特征提取函数已实现
- [x] v2x_env已更新
- [x] 测试已通过
- [x] 向后兼容已验证

---

#### 任务032：Transformer架构优化搜索
**状态**：🟡 进行中（搜索框架与Graph Transformer完成，正式54组GPU搜索待执行）
**优先级**：中
**描述**：搜索最优Transformer架构配置

**需求**：
- 创建 `BackEnd/scripts/search_transformer_arch.py`：
  - 搜索空间：
    - 层数：[2, 4, 6]
    - 注意力头数：[4, 8, 12]
    - 嵌入维度：[128, 256, 512]
    - FFN维度比例：[2, 4]（相对于嵌入维度）
  - 训练配置：每个架构在5个场景上训练20 episodes
  - 在验证集上评估性能
  - 使用Ray Tune或Optuna进行自动搜索
- 实现Graph Transformer变体：
  - 将车辆建模为图节点
  - 边权重基于距离（邻接矩阵）
  - 使用图注意力机制
- 创建配置支持架构切换
- 对比标准Transformer vs Graph Transformer

**验收条件**：
- 必须通过的命令：
  - `python BackEnd/scripts/search_transformer_arch.py --config configs/arch_search.yaml --output experiments/arch_search`
  - `ruff check BackEnd/scripts/`
- 必须产生的文件：
  - `BackEnd/scripts/search_transformer_arch.py`
  - `BackEnd/src/models/graph_transformer.py`（Graph Transformer实现）
  - `BackEnd/configs/arch_search.yaml`
  - `experiments/arch_search/best_architecture.json`
  - `experiments/arch_search/search_results.csv`
- 成功标准：
  - 架构搜索完成（至少测试3×3×3×2 = 54个配置的子集）
  - Graph Transformer可运行
  - 找到比默认配置（4层8头256维）更好的架构，或确认默认配置合理

**Codex完成说明**：
- [x] 架构搜索脚本已创建
- [x] Graph Transformer已实现
- [ ] 搜索已完成
- [ ] 最优架构已确定

---

#### 任务033：UI/UX专业化改造
**状态**：🟢 已完成
**优先级**：中
**描述**：提升前端界面的专业度和视觉效果

**需求**：
- 设计并实现专业配色方案：
  - 使用Material Design或Ant Design配色palette
  - 统一主题色、强调色、中性色
  - 支持深色模式（可选）
- 优化布局和间距：
  - 统一边距、内边距规范（8px网格系统）
  - 改进信息层次（标题、正文、辅助文本）
  - 响应式布局优化（适配1920×1080投影）
- 动画和过渡效果：
  - 添加页面切换过渡动画
  - 组件加载骨架屏
  - 数据更新平滑过渡（不突兀跳变）
  - 按钮悬停、点击反馈
- 改进组件样式：
  - 美化按钮（圆角、阴影、渐变）
  - 美化卡片（边框、阴影、间距）
  - 美化面板（背景、分隔线）
  - 统一图标风格（使用统一图标库如Lucide或Heroicons）
- 添加加载状态和错误提示：
  - 仿真加载中的优雅提示
  - WebSocket断开的友好提示
  - 操作反馈（成功/失败 Toast）
- 创建 `FrontEnd/src/styles/theme.ts`（主题配置文件）

**验收条件**：
- 必须通过的命令：
  - `cd FrontEnd && npm run lint`
  - `cd FrontEnd && npm run build`
- 必须产生的文件：
  - `FrontEnd/src/styles/theme.ts`
  - 更新的所有组件样式文件
  - `FrontEnd/src/components/common/LoadingSkeleton.tsx`
  - `FrontEnd/src/components/common/Toast.tsx`
- 成功标准：
  - 视觉效果显著提升（截图对比）
  - 配色统一协调
  - 动画流畅（60fps）
  - 响应式在1920×1080和1280×720都正常显示

**Codex完成说明**：
- [x] 主题配置已创建
- [x] 组件样式已更新
- [x] 动画效果已添加
- [x] 浏览器验证通过（1920×1080、1280×720）

---

#### 任务034：演示模式与自动播放
**状态**：🟡 进行中（控制与真实高速场景已验证，城市/多事件正式模型待GPU）
**优先级**：中
**描述**：实现自动演示模式，方便presentation展示

**需求**：
- 创建 `FrontEnd/src/components/DemoMode/DemoController.tsx`：
  - 预设演示场景列表（3-5个精选场景）
  - 场景1：高速急刹，AI vs 全量广播对比
  - 场景2：城市交叉口遮挡，AI vs 距离筛选对比
  - 场景3：复杂多事件场景，展示泛化能力
  - 自动播放控制器：
    - 播放/暂停
    - 上一场景/下一场景
    - 循环播放（演示完自动回到第一个）
    - 播放速度调节（1x, 2x, 5x）
- 关键时刻高亮功能：
  - 事件发生时：闪烁提示 + 文字说明
  - AI决策时：高亮选中车辆 + 决策原因弹窗
  - 消息送达时：成功/失败动画增强
- 实现演示解说文字：
  - 每个场景自动显示解说词
  - "当前场景：高速急刹"
  - "AI选择了5辆关键车辆"
  - "基线广播了15辆车，造成拥塞"
  - 解说词自动切换，跟随仿真进度
- 更新 `App.tsx` 添加"演示模式"开关
- 演示模式下简化界面（隐藏复杂控制，突出核心可视化）

**验收条件**：
- 必须通过的命令：
  - `cd FrontEnd && npm run lint`
  - `cd FrontEnd && npm run build`
- 必须产生的文件：
  - `FrontEnd/src/components/DemoMode/DemoController.tsx`
  - `FrontEnd/src/components/DemoMode/DemoScenarios.ts`（场景配置）
  - `FrontEnd/src/components/DemoMode/NarratorOverlay.tsx`（解说文字）
  - 更新的 `FrontEnd/src/App.tsx`
- 成功标准：
  - 点击"演示模式"后自动播放3-5个场景
  - 关键时刻有明显视觉提示
  - 解说文字清晰易读，跟随进度
  - 整个演示流畅无卡顿
  - 可用于20分钟presentation的核心部分

**Codex完成说明**：
- [x] DemoController已实现
- [x] 预设场景已配置（缺失模型时明确禁用，不伪造结果）
- [x] 关键时刻高亮已实现
- [x] 演示模式验证通过（高速场景真实WebSocket对比）

---

#### 任务024：高速场景批量训练（500轮）
**状态**：🟡 进行中（流水线已完成，正式GPU训练待执行）
**优先级**：高
**描述**：进行大规模训练，验证模型在高速场景的收敛性和性能

**需求**：
- 创建 `BackEnd/scripts/batch_train.py`：
  - 批量生成50个不同场景配置（变化参数：车辆数30-50、初始速度分布、事件时间和位置）
  - 每个配置运行10个不同随机种子
  - 总计：50 × 10 = 500轮训练episode
  - 每轮训练：使用PPO训练至少100 episodes
  - 保存：每个配置的最佳模型、训练曲线、最终性能指标
- 创建训练配置 `BackEnd/configs/batch_training_highway.yaml`：
  - 训练参数：episodes_per_config=100, learning_rate=3e-4
  - 验证频率：每10 episodes验证一次
- 早停条件：连续20个训练episode无提升则停止（每10个episode验证一次，即连续2次验证）
- 实现训练监控：
  - TensorBoard日志（reward、loss、指标）
  - 进度保存（可中断恢复）
  - 异常处理（单个配置失败不影响整体）
- 创建 `Test/integration/test_batch_training.py`（小规模冒烟测试：2配置×2种子）

**验收条件**：
- 必须通过的命令：
  - `python BackEnd/scripts/batch_train.py --config configs/batch_training_highway.yaml --output experiments/highway_batch`
  - `pytest Test/integration/test_batch_training.py -v`
  - `ruff check BackEnd/scripts/`
- 必须产生的文件：
  - `BackEnd/scripts/batch_train.py`
  - `BackEnd/configs/batch_training_highway.yaml`
  - `Test/integration/test_batch_training.py`
  - 训练输出：
    - `experiments/highway_batch/config_*/seed_*/model_best.zip`
    - `experiments/highway_batch/config_*/seed_*/training_log.csv`
    - `experiments/highway_batch/summary.json`（汇总统计）
- 成功标准：
  - 500轮训练完成（预计耗时：GPU 8-12小时，CPU 24-48小时）
  - 平均最终reward > 0.6（相比初始0.2-0.3有显著提升）
  - 至少80%的配置成功收敛
  - TensorBoard可查看所有训练曲线

**Codex完成说明**：
- [x] batch_train.py已创建，支持断点续训、分片、失败隔离、TensorBoard和独立验证集选冠军
- [ ] 500轮训练已完成
- [x] 训练日志、最佳模型和汇总输出格式已实现，并完成真实Mac smoke
- [x] 收敛率统计已实现；正式数值待团队GPU训练

---

#### 任务025：城市场景批量训练（500轮）
**状态**：🟡 进行中（流水线已完成，正式GPU训练待执行）
**优先级**：高
**描述**：在更复杂的城市场景中验证模型性能

**需求**：
- 复用 `BackEnd/scripts/batch_train.py`
- 创建城市场景配置 `BackEnd/configs/batch_training_urban.yaml`：
  - 使用 `generate_urban_scenario.py` 生成场景
  - 50个配置（变化参数：车辆数80-100、交叉口信号配置、事件类型组合）
  - 每个配置10个随机种子
  - 训练episodes可增加到150（城市场景更复杂）
- 使用3GPP网络模型（`network_mode: '3gpp'`）
- 其他要求同任务024

**验收条件**：
- 必须通过的命令：
  - `python BackEnd/scripts/batch_train.py --config configs/batch_training_urban.yaml --output experiments/urban_batch`
- 必须产生的文件：
  - `BackEnd/configs/batch_training_urban.yaml`
  - 训练输出：`experiments/urban_batch/config_*/seed_*/`
  - `experiments/urban_batch/summary.json`
- 成功标准：
  - 500轮训练完成（预计耗时：GPU 12-18小时，CPU 36-72小时）
  - 平均最终reward > 0.5（城市场景更难，标准略低）
  - 至少70%的配置成功收敛
  - 与高速场景对比：泛化性能下降 < 20%

**Codex完成说明**：
- [x] batch_training_urban.yaml已创建，支持80–100车、1–3类事件和三种信号配置
- [ ] 500轮训练已完成
- [ ] 城市场景正式性能待团队GPU验证
- [ ] 与高速场景对比统计已生成

---

#### 任务026：完整性能对比实验（AI vs 3基线）
**状态**：🟡 进行中（代码和统计流程已完成，等待正式模型）
**优先级**：高
**描述**：在固定测试集上对比AI方法和3个基线的性能

**需求**：
- 创建 `BackEnd/scripts/run_comparison.py`：
  - 加载训练好的模型（从任务024/025）
  - 在固定测试集上运行4种方法：
    1. AI方法（PPO + Transformer）
    2. 全量广播基线
    3. 距离筛选基线（300米）
    4. 紧急度优先基线
  - 测试集：10个高速场景 + 10个城市场景，每个3个随机种子
  - 记录5个指标：
    - 端到端时延（均值、P50/P95/P99）
    - 有效送达率
    - 受影响车辆覆盖率
    - 通信开销
    - 紧急响应及时率（安全时间窗内送达比例）
- 创建 `BackEnd/configs/comparison_test.yaml`（测试集配置）
- 输出格式：
  - CSV：每行一个测试case的详细结果
  - JSON：汇总统计（均值、标准差、置信区间）

**验收条件**：
- 必须通过的命令：
  - `python BackEnd/scripts/run_comparison.py --config configs/comparison_test.yaml --output experiments/comparison_results`
  - `ruff check BackEnd/scripts/`
- 必须产生的文件：
  - `BackEnd/scripts/run_comparison.py`
  - `BackEnd/configs/comparison_test.yaml`
  - `experiments/comparison_results/detailed_results.csv`
  - `experiments/comparison_results/summary.json`
- 成功标准：
  - 4种方法 × 20场景 × 3种子 = 240个测试case全部完成
  - AI方法在至少3个指标上显著优于所有基线（统计显著性检验）
  - 结果可复现（相同种子得到相同结果）

**Codex完成说明**：
- [x] run_comparison.py和comparison_test.yaml已创建
- [ ] 240个测试case已完成
- [x] CSV/JSON结果、bootstrap置信区间、配对Wilcoxon与Holm校正已实现
- [ ] 统计显著性结论等待正式240个case

---

#### 任务027：消融实验（Transformer、RL、完整方法）
**状态**：🟡 进行中（干净消融流水线已完成，正式训练待执行）
**优先级**：高
**描述**：验证Transformer和RL各自的贡献

**需求**：
- 创建 `BackEnd/scripts/run_ablation.py`：
  - 训练并测试3个变体：
    1. **仅Transformer**：用Transformer提取特征，但用固定规则调度（如：选择注意力权重最高的前K辆车）
    2. **仅RL**：不使用Transformer，用简单手工特征（距离、速度、相对位置）训练PPO
    3. **完整方法**：Transformer + RL（已有模型）
  - 在相同测试集上对比（复用任务026的测试集）
  - 训练规模：每个变体20个场景配置 × 5个种子 = 100轮
- 创建配置：
  - `BackEnd/configs/ablation_transformer_only.yaml`
  - `BackEnd/configs/ablation_rl_only.yaml`

**验收条件**：
- 必须通过的命令：
  - `python BackEnd/scripts/run_ablation.py --config configs/ablation_transformer_only.yaml --output experiments/ablation_transformer`
  - `python BackEnd/scripts/run_ablation.py --config configs/ablation_rl_only.yaml --output experiments/ablation_rl`
  - `ruff check BackEnd/scripts/`
- 必须产生的文件：
  - `BackEnd/scripts/run_ablation.py`
  - 配置文件和训练输出
  - `experiments/ablation_summary.json`（3个变体对比）
- 成功标准：
  - 完整方法性能 > 仅Transformer
  - 完整方法性能 > 仅RL
  - 证明两个组件都有贡献

**Codex完成说明**：
- [x] run_ablation.py及两份配置已创建；Transformer-only为监督排序+验证集Top-K，RL-only为手工特征PPO
- [ ] 3个变体训练已完成
- [x] 消融明细与汇总输出流程已实现
- [ ] 组件贡献已量化

---

#### 任务028：泛化性测试（高速→城市）
**状态**：🟡 进行中（测试流水线已完成，等待正式模型）
**优先级**：中
**描述**：测试模型的跨场景泛化能力

**需求**：
- 创建 `BackEnd/scripts/run_generalization.py`：
  - 测试3种泛化场景：
    1. **场景内泛化**：训练场景 → 同类型测试场景（正常情况）
    2. **跨场景泛化**：高速训练 → 城市测试
    3. **跨道路类型**：城市训练 → 高速测试
  - 对比性能下降幅度
- 使用已训练模型（任务024/025）
- 测试集：10个未见过的高速场景 + 10个未见过的城市场景

**验收条件**：
- 必须通过的命令：
  - `python BackEnd/scripts/run_generalization.py --output experiments/generalization_results`
  - `ruff check BackEnd/scripts/`
- 必须产生的文件：
  - `BackEnd/scripts/run_generalization.py`
  - `experiments/generalization_results/summary.json`
- 成功标准：
  - 场景内泛化：性能下降 < 5%
  - 跨场景泛化：性能下降 < 20%（可接受范围）
  - 结果支持"模型有泛化能力"的结论

**Codex完成说明**：
- [x] run_generalization.py已创建，复用锁定测试集和统一指标口径
- [ ] 泛化测试已完成
- [x] 同域基准与双向跨域性能下降计算已实现；正式数值待运行

---

#### 任务029：实验结果分析和可视化
**状态**：🟡 进行中（生成器已完成，等待正式实验输入）
**优先级**：中
**描述**：生成论文级别的表格和图表

**需求**：
- 创建 `BackEnd/scripts/generate_results.py`：
  - 读取任务024-028的所有结果
  - 生成以下输出：
    1. **性能对比表**（LaTeX格式）：
       - 4种方法 × 5个指标
       - 包含均值、标准差、统计显著性标记
    2. **训练曲线图**（PNG）：
       - Reward随episode变化
       - 高速 vs 城市对比
    3. **消融实验图**（PNG）：
       - 柱状图对比3个变体
    4. **泛化性能图**（PNG）：
       - 折线图展示跨场景性能下降
    5. **典型案例可视化**：
       - 截图或视频：AI成功案例 vs 基线失败案例
- 所有图表使用统一配色和字体（论文质量）
- 生成 `experiments/RESULTS_SUMMARY.md`（实验结果报告）

**验收条件**：
- 必须通过的命令：
  - `python BackEnd/scripts/generate_results.py --output experiments/paper_figures`
  - `ruff check BackEnd/scripts/`
- 必须产生的文件：
  - `BackEnd/scripts/generate_results.py`
  - `experiments/paper_figures/table_comparison.tex`
  - `experiments/paper_figures/fig_training_curves.png`
  - `experiments/paper_figures/fig_ablation.png`
  - `experiments/paper_figures/fig_generalization.png`
  - `experiments/RESULTS_SUMMARY.md`
- 成功标准：
  - 所有图表清晰可读
  - LaTeX表格可直接用于论文
  - RESULTS_SUMMARY.md 包含完整实验结论

**Codex完成说明**：
- [x] generate_results.py已创建，并带formal完整性门禁
- [x] LaTeX表格、四类PNG图和RESULTS_SUMMARY.md生成流程已通过smoke
- [ ] 正式图表与实验结论等待任务024–028的GPU结果

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

#### 任务019：Transformer注意力可视化
**状态**：🟢 已完成
**优先级**：高
**描述**：实现Transformer注意力权重的可视化，展示AI的决策依据

**需求**：
- 更新后端 `BackEnd/app/main.py`：
  - 在 `state_update` 消息中添加 `attention_weights` 字段
  - 格式：`{"vehicle_id": "v0", "event_id": "e0", "weight": 0.85}`
  - 从Transformer模型提取注意力权重（top-k最高的权重对）
- 创建 `FrontEnd/src/components/AttentionViz/AttentionHeatmap.tsx`：
  - 地图叠加：车辆标记的颜色深浅表示注意力强度
  - 颜色映射：低注意力（蓝色）→ 高注意力（红色）
- 创建 `FrontEnd/src/components/AttentionViz/AttentionLinks.tsx`：
  - 绘制高注意力（>0.6）的车辆-事件连接线
  - 线条粗细表示注意力强度
  - 动画效果：连接线淡入淡出
- 在 `App.tsx` 添加注意力可视化开关（默认开启）

**验收条件**：
- 必须通过的命令：
  - `cd FrontEnd && npm run lint`
  - `cd FrontEnd && npm run build`
  - `pytest Test/integration/test_simulation_websocket.py -v`（验证attention_weights字段）
- 必须产生的文件：
  - 更新的 `BackEnd/app/main.py`
  - `FrontEnd/src/components/AttentionViz/AttentionHeatmap.tsx`
  - `FrontEnd/src/components/AttentionViz/AttentionLinks.tsx`
  - 更新的 `FrontEnd/src/App.tsx`
- 成功标准：
  - 浏览器显示车辆颜色深浅变化
  - 高注意力车辆与事件之间有连接线
  - 可通过开关控制显示/隐藏

**Codex完成说明**：
- [x] attention_weights字段已添加：最终层多头均值、逐事件归一化、全局Top 10
- [x] AttentionHeatmap组件已实现：蓝到红的相对注意力热区
- [x] AttentionLinks组件已实现：仅显示权重大于0.6的事件—车辆连线
- [x] 浏览器验证通过：事件时间点显示10个热区和10条高权重连线，开关可控制显隐

---

#### 任务020：RL决策过程面板
**状态**：🟢 已完成
**优先级**：高
**描述**：实现RL决策过程的详细展示面板

**需求**：
- 更新后端 `BackEnd/app/main.py`：
  - 在 `state_update` 消息的 `decision` 字段中添加：
    - `candidate_vehicles`：候选车辆列表（300米内）
    - `selected_vehicles`：选中车辆列表（PPO决策结果）
    - `selection_reason`：简短原因（如 "high_attention", "critical_distance"）
- 创建 `FrontEnd/src/components/DecisionPanel/DecisionPanel.tsx`：
  - 主面板容器（右侧侧边栏，可折叠）
- 创建 `FrontEnd/src/components/DecisionPanel/CandidateList.tsx`：
  - 显示候选车辆列表（ID、距离、状态）
  - 高亮选中的车辆（绿色背景）
- 创建 `FrontEnd/src/components/DecisionPanel/ResourceChart.tsx`：
  - 使用D3.js绘制条形图
  - 显示每辆选中车辆的带宽分配比例
- 安装依赖：`d3`，`@types/d3`

**验收条件**：
- 必须通过的命令：
  - `cd FrontEnd && npm run lint`
  - `cd FrontEnd && npm run build`
- 必须产生的文件：
  - 更新的 `BackEnd/app/main.py`
  - `FrontEnd/src/components/DecisionPanel/DecisionPanel.tsx`
  - `FrontEnd/src/components/DecisionPanel/CandidateList.tsx`
  - `FrontEnd/src/components/DecisionPanel/ResourceChart.tsx`
  - 更新的 `FrontEnd/package.json`（含D3.js依赖）
- 成功标准：
  - 右侧面板显示候选车辆列表
  - 选中车辆高亮显示
  - 条形图正确显示带宽分配

**Codex完成说明**：
- [x] decision字段已扩展并保留旧字段兼容
- [x] DecisionPanel组件已实现，候选车辆包含距离、状态和选择原因
- [x] D3.js条形图已实现，并支持较多接收车辆滚动查看
- [x] 浏览器验证通过：候选列表、高亮和资源图均使用真实后端状态

---

#### 任务021：时序指标图表
**状态**：🟢 已完成
**优先级**：高
**描述**：实现实时指标的时序曲线图

**需求**：
- 创建 `FrontEnd/src/components/MetricsPanel/TimeSeriesChart.tsx`：
  - 使用D3.js绘制三条折线图：
    - 时延（毫秒）
    - 覆盖率（百分比）
    - 通信开销（倍数）
  - X轴：仿真时间（秒）
  - Y轴：指标数值
  - 保留最近30个时间点的数据
  - 实时滚动更新
- 更新 `FrontEnd/src/components/MetricsPanel/RealtimeMetrics.tsx`：
  - 将时序图表集成到指标面板
  - 布局：上方数值卡片，下方时序图表

**验收条件**：
- 必须通过的命令：
  - `cd FrontEnd && npm run lint`
  - `cd FrontEnd && npm run build`
- 必须产生的文件：
  - `FrontEnd/src/components/MetricsPanel/TimeSeriesChart.tsx`
  - 更新的 `FrontEnd/src/components/MetricsPanel/RealtimeMetrics.tsx`
- 成功标准：
  - 浏览器显示三条动态曲线
  - 曲线随仿真实时更新
  - 数据点保留最近30个

**Codex完成说明**：
- [x] TimeSeriesChart三联图已实现，使用同步时间轴和独立Y轴
- [x] 时序图表已集成到MetricsPanel，保留最近30点并在运行/重置时清空
- [x] 浏览器验证通过：真实仿真过程中曲线实时更新

---

#### 任务022：对比视图（左右分屏）
**状态**：🟢 已完成
**优先级**：中
**描述**：实现AI方法与基线方法的并排对比展示

**需求**：
- 更新后端 `BackEnd/app/main.py`：
  - 新增 `/ws/simulation/compare` 端点
  - 同时运行AI方法和指定基线方法
  - 推送两个独立的 `state_update` 消息（标记method字段）
- 创建 `FrontEnd/src/components/ComparisonView/ComparisonView.tsx`：
  - 左右分屏布局（50%-50%）
  - 左侧：AI方法
  - 右侧：基线方法
  - 顶部：方法选择器（全量广播/距离筛选/紧急度优先）
- 创建 `FrontEnd/src/components/ComparisonView/SplitMapView.tsx`：
  - 复用MapView组件，独立渲染左右两侧
- 更新 `App.tsx`：
  - 添加"对比模式"切换按钮
  - 对比模式下显示ComparisonView，否则显示单一视图

**验收条件**：
- 必须通过的命令：
  - `cd FrontEnd && npm run lint`
  - `cd FrontEnd && npm run build`
  - `pytest Test/integration/ -v`（验证compare端点）
- 必须产生的文件：
  - 更新的 `BackEnd/app/main.py`
  - `FrontEnd/src/components/ComparisonView/ComparisonView.tsx`
  - `FrontEnd/src/components/ComparisonView/SplitMapView.tsx`
  - 更新的 `FrontEnd/src/App.tsx`
- 成功标准：
  - 点击"对比模式"后显示左右分屏
  - 左右两侧同步播放同一场景
  - 可以选择不同基线方法对比
  - 能明显看出AI与基线的差异（消息数量、覆盖车辆）

**Codex完成说明**：
- [x] compare端点已实现：相同场景与种子下成对推送AI和白名单基线状态
- [x] ComparisonView组件已实现：左右地图显示独立指标与消息数量
- [x] 对比模式与三种基线切换已验证，切换后清空旧状态并要求重新运行
- [x] 浏览器验证通过：AI/距离基线按相同时间戳原子更新，统一控制有效

---

#### 任务023：动画流畅度优化
**状态**：🟢 已完成
**优先级**：高
**描述**：优化车辆移动动画，解决"PPT切换"问题

**需求**：
- 更新 `FrontEnd/src/components/MapView/VehicleLayer.tsx`：
  - 实现车辆位置插值算法：
    - 保存前一帧位置（prevX, prevY）
    - 收到新位置后，在100-200ms内平滑过渡（CSS transition或requestAnimationFrame）
  - 车辆图标添加旋转动画（根据heading角度）
- 创建 `FrontEnd/src/utils/interpolation.ts`：
  - 提供线性插值函数：`lerp(start, end, t)`
  - 提供平滑插值函数：`smoothstep(start, end, t)`
- 性能优化（如果需要）：
  - 批量更新DOM（使用React.memo）
  - 降低非关键更新频率

**验收条件**：
- 必须通过的命令：
  - `cd FrontEnd && npm run lint`
  - `cd FrontEnd && npm run build`
- 必须产生的文件：
  - 更新的 `FrontEnd/src/components/MapView/VehicleLayer.tsx`
  - `FrontEnd/src/utils/interpolation.ts`
- 成功标准：
  - 车辆移动平滑连续（不再像PPT）
  - 车辆图标旋转跟随方向
  - 50辆车场景下帧率 ≥30fps
  - 100辆车场景下帧率 ≥20fps

**Codex完成说明**：
- [x] 位置插值已实现：单RAF、150ms smoothstep并从当前显示位置续接
- [x] 车辆旋转动画已实现：方向箭头按最短航向角变化
- [x] 性能优化已完成：React.memo、批量状态更新、RAF清理和reduced-motion支持
- [x] 浏览器验证流畅度：50辆约59.8fps，100辆约56.4fps（各连续测量5秒）

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
