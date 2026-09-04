# ETHOnline 2026 — Sponsor Tracks

Prize reference for the sponsors we are considering. `🔁` marks prizes open **only**
to teams registered in the Continuity Track (extending an existing project).

## Pool at a glance

| Sponsor | Pool | Focus | Continuity prizes |
|---|---:|---|---|
| [The Graph](#the-graph--15000) | $15,000 | Composable data products, AI tooling | ✅ |
| [Hedera](#hedera--15000) | $15,000 | Agentic payments, tokenization, tooling | ✅ |
| [Arc (Circle)](#arc--10000) | $10,000 | Stablecoin DeFi, agent payments | ✅ |
| [World](#world--7000) | $7,000 | Proof of human, agent identity | ✅ |
| [1inch](#1inch--7000) | $7,000 | Aqua / SwapVM DeFi positions | ✅ |
| [ENS](#ens--5000) | $5,000 | ENSv2 registries and resolvers | ✅ |
| [Uniswap Foundation](#uniswap-foundation--5000) | $5,000 | Any part of the Uniswap stack | ✅ |
| [Ledger](#ledger--5000) | $5,000 | Hardware-backed agent security | ✅ |
| [Privy](#privy--5000) | $5,000 | Wallets, B2B and consumer money flows | — |
| [Chainlink](#chainlink--3000) | $3,000 | CRE Confidential Workflows | ✅ |
| [Bazantic](#bazantic--3000) | $3,000 | Agent-usable APIs, x402 gateways | ✅ |
| **Total** | **$80,000** | | |

### Requirements that repeat almost everywhere

- Public repo, open source, README a judge can follow.
- Demo video — **2–4 min** (The Graph) or **≤5 min** (Hedera, Ledger, Chainlink).
- **Live data only.** Mocked, local-only or static datasets disqualify Graph submissions.
- Continuity entries must separate *what existed before* from *what is new*, with commit history to back it up.
- 1inch is explicit: **proper git history, no single-commit entries on the final day.**

---

## The Graph — $15,000

Blockchain data infrastructure across 50+ networks. Products: Subgraphs, Firehose, Substreams, Amp.

### 🧩 Composable or Standardized Graph Products — $5,000

`1st $2,500 · 2nd $1,500 · 3rd $1,000`

Show the leverage of standards: one query pattern spanning many protocols, or one pipeline reused across chains.

- Compose **two or more** Graph products, **or** build on a standardized schema (e.g. Messari Standardized Subgraphs).
- Consume live data — Subgraph Studio for Subgraphs, The Graph Market for Substreams.
- Querying a single Subgraph with no composition **does not qualify** → use the AI track instead.
- Authoring a Standardized Subgraph or a reusable Substreams module is in scope (e.g. ERC-4626 vault flows).

### 🤖 AI Tooling or AI Use Case — $5,000 (From Scratch)

`1st $2,500 · 2nd $1,500 · 3rd $1,000`

### 🤖 AI Tooling or AI Use Case — $5,000 🔁 (Continuity)

`1st $2,500 · 2nd $1,500 · 3rd $1,000`

Same brief, two judging pools so you compete against projects built the same way.

- **Tooling side:** MCP servers, agent SKILLs, x402 payment tooling, A2A integrations, framework plugins. Must be reusable infrastructure, not one end-user app.
- **Agent side:** research assistants, trading agents, portfolio copilots, risk monitors using The Graph as their live data source.
- Featured challenge: single natural-language prompt → deployed Substreams pipeline, via the Substreams SKILLs.
- Do real work with the data — reasoning, decisions, automation, natural-language interface. Not a raw query dump.
- **Net-new pool:** open-source starter kits fine, project-specific prior code is not.
- **Continuity pool:** document pre-existing work; only work done during the event is judged.

**Resources:** [Standard Subgraphs](https://thegraph.com/docs/en/subgraphs/existing-subgraphs/standard-subgraphs/) · [Agent0/ERC-8004](https://thegraph.com/docs/en/subgraphs/existing-subgraphs/agent0/) · [Subgraph MCP](https://thegraph.com/docs/en/subgraphs/tooling/subgraph-mcp/introduction/) · [Subgraph SKILLs](https://github.com/graphprotocol/subgraphs-skills) · [Substreams SKILLs](https://github.com/streamingfast/substreams-skills) · [Standardized Substreams](https://github.com/streamingfast/substreams-chain-modules) · [Pinax EVM primitives](https://github.com/pinax-network/substreams-evm)

---

## Hedera — $15,000

EVM-compatible L1. 10,000+ TPS, 3s finality, USD-priced fees, aBFT security.

### 🤖 AI & Agentic Payments — $6,000

`Up to 3 teams × $2,000`

x402 on Hedera exists; what is missing is services you can actually pay for.

- Host a **live x402-gated service** on testnet or mainnet, settled through the **Blocky402 facilitator**.
- Build the agent or platform that consumes it and completes **at least one real paid request end to end**.
- Ideas: pay-per-call inference, metered data feeds, agent marketplaces, micropayment streaming.

**Extra points:** metering over flat fees · A2A/ACP negotiation · ERC-8004 or HCS-14 identity · UCP discovery · HTS custom fee schedules · HCS audit trails · Scheduled Transactions for recurring payments.

### 🛠️ Open Source — Improve the Hedera Harness — $2,000

`Up to 2 teams × $1,000`

- A meaningful PR to the Hedera Harness (unmerged is fine), **or** a new harness inspired by it.
- Ideas: thin service coverage, ports to other languages, local-dev mode without testnet round trips.
- **Extra points:** fewer lines to a working transaction · tests and docs · before/after DX evidence.

### 🪙 Tokenization of Anything — $6,000

`Up to 3 teams × $2,000`

- Use the **Asset Tokenization Studio** (SDK, contracts, web app) to issue or manage a tokenized asset.
- Deploy on testnet, verify contracts on HashScan, demo **at least one lifecycle operation**.
- Ideas: tokenized repo collateral, bonds with coupons and maturity, ATS secondary markets, KYC-gated equities, invoice and receivable cashflows.
- **Extra points:** compliance controls in use · oracle pricing or NAV · Scheduled Transactions for vesting · upstream contributions to ATS.

### ♻️ Continuity — $1,000 🔁

- Project must predate the event on Hedera.
- **Substantive new work required** — new features, new services, architectural change. Polish and bug fixes will not qualify.
- README must clearly separate old from new, backed by commit history or a diff.

**Resources:** [Docs](https://docs.hedera.com/) · [Harness](https://github.com/hedera-dev/hedera-harness) · [Skills](https://github.com/hedera-dev/hedera-skills) · [Agent Kit](https://github.com/hashgraph/hedera-agent-kit-js) · [ATS monorepo](https://github.com/hashgraph/asset-tokenization-studio) · [Blocky402](https://blocky402.com/) · [x402 PoC](https://github.com/hedera-dev/x402-inference-pay-per-request-poc) · [scaffold-hbar](https://github.com/hedera-dev/scaffold-hbar) · [Workshop](https://www.youtube.com/watch?v=-nkd3aorELM)

---

## Arc — $10,000

Circle's purpose-built EVM L1 — the settlement layer where capital, humans and machines coordinate.

| Prize | Amount | Notes |
|---|---:|---|
| 🏆 Best DeFi / Onchain Finance App | $1,667 | Lending, swaps, FX, yield, treasury on Arc + USDC |
| 🏆 Best Agentic Economy App (Agent Stack) | $1,667 | Agents holding wallets, paying, settling in USDC |
| 🏆 Best DeFi or Agentic App 🔁 | $1,666 | Continuity version of the two above |
| 🏆 Launch on Testnet & Push to Mainnet | $3,500 | `1st $2,500 · 2nd $1,000` |
| 🏆 Launch on Testnet & Push to Mainnet 🔁 | $1,500 | Add Arc to a project you already own |

**Every Arc prize requires:** a working frontend **and** backend, an **architecture diagram**, a video walkthrough naming which bounty you are entering, detailed documentation, and a repo link. Mainnet tracks must be deployed or deployment-ready **by September 30**.

**Core products:** Arc · USDC · App Kits · Circle Wallets · Circle Contracts · CCTP · Gateway · StableFX · Agent Stack · Nanopayments · Paymaster.

**Resources:** [Arc Docs](https://docs.arc.io/) · [App Kits](https://docs.arc.io/app-kit) · [Circle Dev Docs](https://developers.circle.com/) · [Agent Stack starter kits](https://github.com/circlefin/agent-stack-starter-kits)

---

## World — $7,000

World ID proves unique humanness without revealing identity.

### 🤖 AgentKit Continuity — $3,500 🔁

- Extend an existing project with **AgentKit** to distinguish a bot from an agent acting on behalf of a real, unique human.
- Register or resolve agents through **AgentBook** where relevant.
- Test remotely via the **World ID Sandbox App**.

### 🤳 Selfie Check — $3,500

- Low-friction, low-assurance biometric credential — a live person behind the screen, no Orb required.
- Treat it as a **risk, eligibility, fairness, continuity or abuse-prevention signal**, not as hard identity.

**Both tracks require a feedback document** covering docs and integration flow, Developer Portal navigation and debugging, Sandbox states and edge cases, and what was confusing, missing or broken.

**Resources:** [AgentKit](https://docs.world.org/agents/agent-kit/integrate) · [AgentKit repo](https://github.com/worldcoin/agentkit) · [Selfie Check](https://docs.world.org/world-id/credentials/11) · [Sandbox testing](https://docs.world.org/world-id/sandbox/testing-selfie-check) · [Developer Portal](https://developer.world.org/) · [Sandbox access form](https://forms.gle/mqbaiwMvX5MzmKdY8)

---

## 1inch — $7,000

Aqua reimagines DEX design with self-custodial liquidity provisioning — yield without depositing into another contract.

### 💧 Build an Aqua App — $5,000

`1st $2,500 · 2nd $1,500 · 3rd $1,000`

### 💦 Build an Aqua App — $2,000 🔁

`1st $1,500 · 2nd $500`

- Implement a **sophisticated DeFi position**; demonstrate it through test scripts or a UI.
- **SwapVM scores higher** — you may modify opcodes and define your own instructions.
- Official Aqua/SwapVM contracts required (redeploying a modified SwapVM is allowed).
- Onchain token transfers shown during the demo; local forks are acceptable.
- ⚠️ **Proper git commit history — no single-commit entries on the final day.**

**Resources:** [SwapVM](https://github.com/1inch/swap-vm/tree/main) · [Aqua contracts](https://github.com/1inch/aqua) · [Aqua SDK](https://github.com/1inch/sdks/tree/master/typescript/aqua) · [SwapVM whitepaper](https://github.com/1inch/swap-vm/blob/release/1.1/docs/whitepaper-swap-vm-1.0.pdf) · [Aqua whitepaper](https://github.com/1inch/aqua/blob/main/docs/whitepaper-aqua-1.0.pdf)

---

## ENS — $5,000

ENSv2 beta is live on **Sepolia** — hierarchical registries, wildcard resolution, Enhanced Access Control, Permissioned Resolvers, record and namespace aliasing.

### 🧬 Best Use of ENSv2 — $4,500

`1st $1,500 · 2nd $1,500 · 3rd $1,000 · Runner-up $500`

- Deploy your own subname registry, or resolve subnames straight off a parent's resolver.
- Build subname setups: expiring, revocable, non-transferable versus transferable, or forever names with no parent control.
- **Bonus:** AI agents as namespaces, each with its own identity and permissions.

### 🔗 Best ENSv2 Integration into an Existing Project — $500 🔁

- Integrate ENSv2 against an existing project's **testnet** deployment.

**Both:** ENSv2 must be central, not cosmetic. Demo must be functional — **no hard-coded values**. Video and/or live demo, open source.

**Resources:** [ENSv2 overview](https://docs.ens.domains/ensv2/overview) · [Permissioned Registry](https://docs.ens.domains/ensv2/permissioned-registry) · [Permissioned Resolver](https://docs.ens.domains/ensv2/permissioned-resolver) · [Enhanced Access Control](https://docs.ens.domains/ensv2/enhanced-access-control) · [Contract dev guide](https://docs.ens.domains/ensv2/tutorial-contract-developers) · [App dev guide](https://docs.ens.domains/ensv2/tutorial-app-developers) · [ens-cli](https://github.com/ensdomains/ens-cli) · [ENSIP-25](https://docs.ens.domains/ensip/25/) · [ENSIP-26](https://docs.ens.domains/ensip/26/)

---

## Uniswap Foundation — $5,000

### 🦄 Best Uniswap Stack Contribution — $3,000

`Up to 3 teams × $1,000`

### 🦄 Best Uniswap Stack Contribution — $2,000 🔁

`1st $1,000 · 2nd $1,000`

- Build on the Uniswap API, the AMM (v2/v3/v4), CCA, or any Uniswap protocol — new v4 hooks, upstream improvements, or ecosystem tooling.
- **Required:** public repo, a `FEEDBACK.md`, **and** a submitted [Developer Feedback Form](https://developers.uniswap.org/hackathon-feedback) linking to it.
- README must point at the exact contracts and lines so judges can verify the integration.

**Resources:** [Docs](https://developers.uniswap.org/docs) · [Developer Platform](https://developers.uniswap.org/dashboard) · [Uniswap AI](https://github.com/Uniswap/uniswap-ai) · [Workshop](https://www.youtube.com/watch?v=APm0hY6_KpQ)

---

## Ledger — $5,000

Device-backed security as the trust layer for agents.

### 🤖 AI Agents × Ledger — $3,500

`1st $2,000 · 2nd $1,000 · 3rd $500`

- Agents that hold **secrets they cannot leak** — a broker hands out scoped capabilities, never the API key.
- Bring the **Key Ring** to hosts with no USB port: a VPS, a CI runner, a hosted agent.
- Both of the above must build on the **Ledger Agent Stack**, specifically the Key Ring CLI (`wallet-cli ring`).
- Also in scope: agents paying for APIs with Ledger-secured flows (x402-style), and human-in-the-loop approval before anything irreversible.

### 🛣️ Continuity — $1,500 🔁

`1st $1,000 · 2nd $500`

- Add a hardware signer to something you already shipped, using the DMK skills.
- Make `wallet-cli ring` the key backend for the `.env`, sops or age files your repo already has.
- Put a device confirmation in front of an action that previously had none, or land an open issue on a Ledger repo.

**Resources:** [Track details](https://developers.ledger.com/ethonline)

---

## Privy — $5,000

Auth, embedded self-custodial wallets, no seed phrases. *(No Continuity-only prize.)*

### 🏢 Best B2B Financial Product — $2,500

Treasury platforms, business accounts, payroll, spend management, payment ops, shared organization wallets.

- Create or use **at least one Privy wallet**.
- Implement **at least one functional B2B workflow** — a payment, approval, treasury operation, or wallet administration flow.
- Use **at least one Privy control**: policies, signers, key quorums, or intents.

### 💸 Best Financial Flow — $2,500

Payments, remittances, cross-chain transfers, stablecoin conversions, swaps, savings, payouts, card-like spending.

- Complete at least one functional flow using a **generally available** Privy feature.
- Eligible: transfers, bridging, stablecoin conversions, swaps, self-service Earn vaults, onramps.
- ⚠️ Privy Cards needs guided onboarding — a mocked card experience is allowed but **does not count** as the required live integration.

**Resources:** [Docs](https://docs.privy.io/) · [Quickstart](https://docs.privy.io/basics/get-started/quickstart) · [GitHub](https://github.com/privy-io)

---

## Chainlink — $3,000

⚠️ Use **CRE** — Functions and Automation are being deprecated.

### 🔗 Best Confidential Workflow — $2,000

`Up to 2 teams × $1,000`

Designate sensitive parts of a CRE Workflow to execute inside a hardware-isolated TEE. You control what stays in the enclave and what leaves for consensus, delivery or settlement.

- Register and use a confidential TEE handler — `handlerInTee` (TypeScript) or `cre.HandlerInTee` (Go).
- Process at least one secret, sensitive input, confidential API response or intermediate value **inside the enclave**.
- Must be core functionality — a placeholder handler or isolated example will not qualify.
- Evidence required: CLI simulation or live deployment, shown via demo video, terminal output, logs or deployment details.

### 🏆 Best Chainlink-Powered Upgrade — $500 🔁

- Integrate CRE, Price Feeds, Data Streams, Proof of Reserve or VRF into an existing project.
- The integration **must drive an onchain state change** — displaying data in a frontend is not enough.

### 🔒 Automated Liquidation Protection Challenge — $500

Protect a virtual ETH-collateral / USDC-debt position through simulated market moves: avoid liquidation, preserve the benefit of keeping the loan open, use emergency capital efficiently, and keep protection rules and credentials private.

**Resources:** [CRE Docs](https://docs.chain.link/cre) · [Hello Confidential Workflows](https://docs.chain.link/cre-templates/hello-confidential-workflows) · [Audit firewall template](https://docs.chain.link/cre-templates/ai-audit-firewall) · [Liquidation protection template](https://docs.chain.link/cre-templates/automated-liquidation-protection) · [Starter templates](https://github.com/smartcontractkit/cre-templates/tree/main/starter-templates/confidential-workflows) · [Bootcamp](https://www.youtube.com/watch?v=ArHoB1JDSlE)

---

## Bazantic — $3,000

Turn an API into something agents can understand, use and pay for: x402/MPP gateways, MCP servers, and "Recipes" that explain when, why and how to use a service.

**Every Bazantic prize requires** a bazantic.com account, an x402/MPP Gateway for your project, a screen recording, and your account username in the submission.

### 🤖 Help an Agent Use Your Project — $1,000 🔁

`Up to 2 teams × $500`

Run the same task twice with the same model, prompt, settings and API access — once raw, once with your Recipe. **The Recipe must be the only difference.** Show a meaningful, repeatable improvement, with both results in the submission.

### 🍳 Best Recipe Using Sponsor APIs — $1,000

`1st $500 · 2nd $300 · 3rd $200`

Chain multiple APIs into one workflow that completes a task neither could solve alone. At least one other service already on Bazantic or from an ETHGlobal sponsor. The final result must depend meaningfully on **both**.

### 👨‍🍳 Agentify a New API — $1,000

`1st $500 · 2nd $300 · 3rd $200`

Add a service that was **not** already on Bazantic and **not** available from another sponsor when the event began, then bring it into a reusable recipe — not a one-off connection built only for the demo.
