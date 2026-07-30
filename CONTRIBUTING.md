# Contributing / 贡献指南

Thank you for contributing to this research prototype. Changes must preserve reproducibility,
traceable evidence, and the separation between learned-policy output and rule-based fallback.

感谢参与本科研原型。所有改动必须保持实验可复现、证据可追溯，并明确区分真实模型输出与规则降级结果。

## Development workflow / 开发流程

1. Create a focused branch from `main`.
2. Keep algorithm, evaluation, visualization, and documentation changes in clearly described commits.
3. Run the relevant checks before opening a pull request.
4. Explain any change to public schemas, metric definitions, seeds, data splits, or model gates.
5. Do not commit credentials, private Colab paths, large model checkpoints, or unreviewed raw data.

## Research integrity / 科研完整性

- Every numerical claim must point to a saved manifest, summary, table, or generation script.
- Synthetic or illustrative values must be labelled as such and must not appear in result conclusions.
- Test configurations must remain isolated from training and validation configuration selection.
- Attention weights may be presented as diagnostic evidence, not as strict causal explanations.
- Rule-based fallback output must never be labelled as PPO inference.

## Required checks / 必要检查

```bash
cd FrontEnd
npm ci
npm run lint
npm test
npm run build

cd ../BackEnd
.venv/bin/python -m ruff check . ../Test
.venv/bin/python -m ruff format --check . ../Test
.venv/bin/python -m pytest
```

Documentation-only changes must also keep all relative links and committed assets valid.
See [Docs/WORKFLOW.md](Docs/WORKFLOW.md) for the internal hand-off process.
