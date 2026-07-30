# Technical Specification / 技术规范

## 1. Scope

The project is an end-to-end research prototype for selective emergency-message scheduling in a simulated V2X highway. Its evidence boundary ends at SUMO traffic simulation, a 3GPP-inspired network abstraction, trained-policy inference, and a browser-based academic demo. It does not modify a cellular protocol stack or claim vehicle deployment readiness.

项目交付的是可训练、可评价、可审计、可演示的概念验证系统，而非真实道路通信产品。

## 2. Observation model

The observation schema v2 contains padded vehicle features \(V_t\), vehicle mask \(M_t^V\), event features \(E_t\), event mask \(M_t^E\), and network state \(N_t\):

\[
o_t=\{V_t,M_t^V,E_t,M_t^E,N_t\}.
\]

Vehicle and event features are projected separately and combined under masked self-attention:

\[
H_t=\operatorname{Transformer}([\phi_v(V_t);\phi_e(E_t)]).
\]

The mask is part of the model contract: padded tokens cannot become receivers or contribute as real traffic actors.

## 3. Structured PPO action

The accepted action mode is `directional_corridor`:

\[
a_t=(r_t,\ell_t,p_t,b_t),
\]

where

\[
r_t\in\{75,150,225,300,375\}\text{ m},\quad
\ell_t\in\{\text{same lane},\text{same+adjacent lanes}\},
\]

\[
p_t\in\{0,1,2\},\qquad
b_t\in\{0.1,0.2,\ldots,1.0\}.
\]

The PPO clipped surrogate is

\[
L^{\mathrm{CLIP}}(\theta)=\mathbb E_t\left[
\min\left(\rho_t(\theta)\hat A_t,
\operatorname{clip}(\rho_t(\theta),1-\epsilon,1+\epsilon)\hat A_t\right)
\right].
\]

Geometry maps the action to receiver identities. A vehicle must be behind the incident along the relevant travel direction and satisfy lane/radius scope; forward and opposite-direction vehicles are illegal even if their Euclidean distance is small.

## 4. Reward

The configurable multi-objective reward is expressed as

\[
R_t=w_dD_t+w_cC_t-w_lL_t-w_oO_t-w_mM_t-w_bB_t-w_sS_t-w_fF_t,
\]

where \(D_t\) is effective delivery, \(C_t\) affected-vehicle coverage, \(L_t\) latency, \(O_t\) redundant-message overhead, \(M_t\) missed-risk penalty, \(B_t\) bandwidth cost, \(S_t\) safety violation penalty, and \(F_t\) fairness penalty. Exact weights are experiment configuration, not UI constants.

## 5. Network abstraction

The network layer models delivery probability, segmented delay, contention/load effects, and resource cost using highway geometry and 5.9 GHz configuration. It remains an abstraction rather than a packet-level implementation. P95 latency measures valid delivered-message latency; channel cost includes the allocated resource fraction and differs from raw receiver count.

## 6. Baseline contracts

| ID | Receiver rule | Resource rule |
|---|---|---|
| `broadcast` | all non-sender vehicles | full bandwidth, high priority |
| `distance` | all vehicles within 300 m | full bandwidth, high priority |
| `urgency` | same 300 m set | severity-dependent priority/bandwidth |
| `fixed_directional_corridor` | fixed 300 m rear corridor | 50% bandwidth, high priority |
| `ai` | learned radius/lane scope | learned priority/bandwidth |

All methods are evaluated from the same scenario state and network seed. The live presentation exposes AI versus one selected baseline; batch evaluation includes all five.

## 7. Model eligibility

The formal inference path checks:

- checkpoint and manifest existence;
- SHA-256 integrity;
- observation schema v2;
- `directional_corridor` action compatibility;
- protocol `directional-v2` and metric schema v2;
- held-out evaluation artifact;
- receiver/action diversity;
- nearest-follower coverage;
- zero forward notification.

The currently referenced accepted checkpoint hash is `b4119963acd28d87283ca5d9108897621da3a8aec0ba0dccb3cdac49758f2465`. A replacement model must publish its own manifest and must not inherit this value.

## 8. API and frontend responsibilities

FastAPI owns model eligibility, scenario/session state, synchronized AI/baseline computation, and WebSocket evidence. React owns user input and presentation state. Three.js renders vehicles, road environment, directional communication links, highlights, camera control, and evidence panels. Continuous visual interpolation may occur between backend keyframes; inference and metric truth may not be fabricated client-side.

## 9. Evaluation semantics

For affected set \(A\) and receiver set \(R\):

\[
\mathrm{Coverage}=\frac{|A\cap R|}{|A|},\quad |A|>0.
\]

If \(|A|=0\), coverage is undefined and is excluded from its aggregate mean. Every aggregate therefore reports a metric-specific valid sample count. See [Experimental Protocol](EXPERIMENTS.md).
