# Research Engineering Workflow / 科研工程流程

## 1. Source-of-truth hierarchy

1. executable code, versioned configuration, tests and generated manifests;
2. [`ARCHITECTURE.md`](../ARCHITECTURE.md) for implemented module boundaries;
3. [`TECHNICAL_SPECIFICATION.md`](TECHNICAL_SPECIFICATION.md) for model and metric contracts;
4. [`EXPERIMENTS.md`](EXPERIMENTS.md) for evaluation semantics and current evidence;
5. [`REPRODUCIBILITY.md`](REPRODUCIBILITY.md) for commands and artifact lineage;
6. `ARCHITECT_CODEX_BRIDGE.md`, `task_memory.md`, and `TODO.md` for internal history and hand-off.

If narrative documentation conflicts with an artifact manifest, stop and resolve the discrepancy before presenting a result.

## 2. Change workflow

```text
Define question and scope
        ↓
Inspect current code, configuration and artifact contract
        ↓
Implement the smallest coherent change
        ↓
Run unit, integration, lint and build checks
        ↓
Regenerate evidence from source artifacts
        ↓
Update architecture / experiment / reproduction documents
        ↓
Review claims, limitations and repository diff
```

## 3. Experiment workflow

```text
Versioned scenario groups + seeds
        ↓
SUMO preflight and trace generation
        ↓
Train candidates on train groups
        ↓
Select candidate using validation groups
        ↓
Evaluate once on isolated test groups
        ↓
Run schema, hash and behavioral gates
        ↓
Promote immutable champion bundle
        ↓
Serve the bundle to the live demo
```

Do not select reward weights or checkpoints by repeatedly consulting test results. Do not edit plot values by hand. Do not copy a checkpoint without its manifest and evidence bundle.

## 4. Definition of done

A change is complete when relevant code and documents agree, automated checks pass, generated results retain their provenance, UI claims match backend semantics, and limitations are stated. A visually successful run is insufficient if model source or metric meaning cannot be audited.

## 5. Documentation style

- Root README is English-first with a short Chinese summary after each major section.
- Public figures must come from real UI captures, code-derived diagrams, or real experiment artifacts.
- Every result figure states protocol, scope and metric-specific sample size.
- Historical planning documents remain historical; current public documents must not describe planned components as implemented.
- Never store tokens, private credentials, unredacted personal data, or machine-specific absolute paths.
