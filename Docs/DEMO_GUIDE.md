# Classroom Demonstration Guide / 课堂演示指南

## 1. What the demo must prove

The demonstration should make one defensible claim: under the locked simulated highway protocol, Transformer-PPO uses contextual risk and network state to choose a smaller legal receiver corridor and communication-resource action, achieving a different coverage–latency–overhead trade-off from deterministic baselines.

演示的目标不是“播放一段好看的动画”，而是让老师看见同一事故、同一时刻、不同决策，以及每个决策对应的可核查证据。

## 2. Pre-demo checklist

1. Start with `./start.sh` and confirm backend health.
2. Confirm the UI reports an eligible `directional-v2` model rather than a rule fallback.
3. Select environment, incident type, accident vehicle, and baseline at the entry screen.
4. Prefer an incident vehicle with enough traffic behind and across multiple lanes to expose method differences.
5. Rehearse camera orbit, zoom, pan, and “follow accident vehicle” reset.
6. Keep a static held-out result slide ready in case the live browser fails.

## 3. Four-stage live script

| Stage | Presenter action | Evidence to explain |
|---|---|---|
| Normal traffic | Establish road direction, lanes, sender and candidate vehicles | This is a configurable simulation, not a video |
| Incident | Trigger/observe hard braking and sender highlight | The event defines a safety-relevant rear-risk context |
| Synchronized comparison | Show AI and selected baseline simultaneously; adjust camera if needed | Same incident state, different receiver/resource policy |
| Result summary | Point to coverage, receiver count, latency, overhead and channel cost | Explain trade-off and sample scope, not universal superiority |

The current timeline is approximately 38 seconds. Stage navigation can be used during rehearsal and Q&A; it must not be described as rerunning training.

## 4. Recommended narration

> 左右两侧使用同一事故车、同一交通状态和同一网络条件。传统方法根据固定规则选择接收者；我们的Transformer先编码车辆、事件与网络关系，PPO再在安全合法的后向走廊中联合选择半径、车道范围、优先级和带宽。黄色车辆表示风险候选而非必然接收者，发光方向线表示本次实际通知。最后的数值来自锁定测试协议，不是前端随机生成。

If asked “why not simply notify every vehicle behind?”, answer that direction is a safety constraint, while AI still decides corridor size, lane scope, priority, and bandwidth according to context. A fixed corridor is included specifically to isolate that distinction.

## 5. Validation laboratory

The laboratory is a frozen-frame evidence inspector, not a second simulation mode. Use it only when a teacher asks:

- Why was this vehicle selected or rejected?
- Was any forward vehicle notified?
- Which action did PPO output?
- Is this model a trained checkpoint or fallback rule?
- Which held-out result supports the headline claim?

The panel should expose incident-relative geometry, lane eligibility, affected/receiver state, decision source, action tuple, checkpoint/manifest identity, and the relevant held-out statistic. A value that does not change with the inspected vehicle should be described as run-level provenance, not live telemetry.

## 6. Interpreting the baselines

- **Broadcast:** maximizes reach but creates the largest recipient set and resource demand.
- **Distance:** removes far vehicles but ignores direction and uses fixed resources.
- **Urgency:** uses the same distance receiver set in the current implementation and changes priority/bandwidth; similar coverage and overhead are expected.
- **Fixed directional corridor:** is the strongest rule baseline for answering whether AI does more than “send backward.”
- **Transformer-PPO:** adapts four action dimensions inside the legal corridor.

During the live presentation, compare AI against one baseline to keep the scene legible. Use the held-out five-method table when asked about the other methods.

## 7. Claims and limits

Safe claims:

- the full simulation–training–evaluation–serving–visualization pipeline is implemented;
- the accepted model passes zero-forward-notification and diversity gates;
- current held-out evidence shows highest affected coverage and lowest channel cost for AI;
- fixed directional corridor remains better on P95 latency and message overhead in this artifact.

Do not claim real-road safety, 6G deployment, causal superiority, or publication-level significance. State clearly that city roads, concurrent incidents, packet-level networking and hardware validation are future work.
