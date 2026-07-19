# Langfuse setup — managed evaluator on prod traces

One-time configuration for the managed evaluator that scores sampled production
`/api/chat` traces (spec/eval-harness §6). SDK/keys setup lives in `.env.example`.

> **What was automated.** This project was set up headless (no browser). All
> three pieces were created programmatically via the Langfuse public API: the
> Anthropic **LLM connection** (§2), the project-scoped **Faithfulness
> evaluator**, and the **evaluation rule** that samples live `chat` observations
> (§3). Nothing remains to click in the UI; the sections below document what
> exists and how to reproduce/verify it.
>
> **UI labels drift.** Langfuse's UI wording does not always match the API/SDK
> field names (per the langfuse skill's warning). Where the two differ, the
> exact API field names, ids, and payload values recorded in §3 are the source
> of truth; treat any on-screen UI label as a best-effort approximation of them.

## 1. Project + keys

- cloud.langfuse.com → project `ai-tutor` (EU region). **Already provisioned** —
  project id `cmrq82r4h064ead0d1xfyzxc7`, prod traces are flowing.
- Project settings → API keys → the pk/sk pair is already in `.env.local` and the
  Vercel env vars (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`,
  `LANGFUSE_BASE_URL=https://cloud.langfuse.com`). Nothing to do unless rotating.

## 2. LLM connection (for managed evaluators) — ✅ done programmatically

The evaluator needs an Anthropic LLM connection. **This was created via the
Langfuse public API** (the one write performed during setup):

```bash
# keys read from .env.local (LANGFUSE_* for auth, ANTHROPIC_API_KEY as the secret)
npx langfuse-cli --env .env.local api llm-connections put \
  --provider anthropic --adapter anthropic --secretKey "$ANTHROPIC_API_KEY"
```

Result: connection `id=cmrqm42gw0ujcad0iq1t78wh0`, `provider=anthropic`,
`adapter=anthropic`, `withDefaultModels=true` (HTTP 201). Verify any time with:

```bash
npx langfuse-cli --env .env.local api llm-connections list
```

- Adapter enum (from the bundled OpenAPI spec): `anthropic`, `openai`, `azure`,
  `bedrock`, `google-vertex-ai`, `google-ai-studio`. Use **`anthropic`**.
- In the UI this shows under **Project settings → LLM connections** as provider
  `anthropic`.
- **Model note:** the evaluator (§3) targets **`claude-sonnet-4-6`**. It is
  available via the default models on the `anthropic` adapter; if the model
  dropdown/field does not list it, add it as a custom model on this connection
  (`--custom-models`/UI "Custom models") or type the id explicitly in the
  evaluator's model field.

## 3. Faithfulness evaluator on sampled prod traces — ✅ done programmatically

Created 2026-07-19 via the public **unstable** API surface
(`POST /api/public/unstable/evaluators`, `POST /api/public/unstable/evaluation-rules`).
What exists now:

- **Evaluator `Faithfulness`** — id `cmrr2ckj30x4mad0cojsmdtbv`, **scope
  `project`**, version 1, type `llm_as_judge`, variables `context` + `answer`,
  NUMERIC 0–1 output (score + one-sentence reasoning), model
  **`claude-sonnet-4-6`** on the **`anthropic`** connection from §2.
  - Why "Faithfulness", not "Groundedness": there is **no managed template named
    "Groundedness"**; the RAGAS **`Faithfulness`** template (claims-supported-by-
    context) *is* the groundedness metric.
  - Why project-scoped instead of the managed template: referencing the managed
    `Faithfulness` (scope `managed`, `modelConfig: null`) in a rule fails with
    `422 evaluator_preflight_failed` — *"No valid LLM model found … No default
    model or custom model configured for project"* — because managed evaluators
    resolve to the **project default evaluation model**, which can only be set in
    the UI and is unset here. The project-scoped copy uses the managed template's
    exact prompt + output definition (v2) with an **explicit
    `modelConfig: {provider: "anthropic", model: "claude-sonnet-4-6"}`**, which
    passes preflight against the §2 connection.
- **Evaluation rule `faithfulness-prod-chat`** — id `cmrr2ctud0y0wad0je3ixdrtm`,
  `enabled: true`, `status: active`:
  - **Target `observation`** (the API's live-ingestion equivalent of the UI's
    "traces" target), **filter** `name any of ["chat"]` → matches the root `chat`
    span of every prod trace (child spans are named `retrieval`/`generation`, so
    exactly one observation per chat turn matches).
  - **Sampling `0.2`** (20% — upper end of the planned 10–20% band, chosen for
    faster verification at current low trace volume; lower it if volume grows).
  - **Variable mapping** (the unstable API can only map from the *matched*
    observation's own `input`/`output`/`metadata` — it cannot reach sibling
    observations, so both variables come from the `chat` span's output object
    `{answer, sources}`):
    - `answer` → `output` + jsonPath `$.answer` (final answer text).
    - `context` → `output` + jsonPath `$.sources` (retrieved source slugs; the
      full article bodies live only in the generation prompt, which a rule
      matched on the `chat` span cannot reference — a slug list is the best
      single-observation context available, and is the same deviation the UI
      route would have needed).

Reproduce/verify:

```bash
# inspect the evaluator + rule
npx langfuse-cli --env .env.local api unstable-evaluators list
npx langfuse-cli --env .env.local api unstable-evaluation-rules list

# check for Faithfulness scores on prod traces
npx langfuse-cli --env .env.local api scores list --name Faithfulness
```

The exact create payloads are in the git history of this file's authoring task
(task-12 final report) — rediscover request shapes any time with
`npx langfuse-cli api unstable-evaluation-rules create --help`.

> **Verification status (2026-07-19).** After rule creation, 5 live chat turns
> were sent (traces `526ddfdc…`, `c592847b…`, `edeab18e…`, `46f786fe…`,
> `e77c13ec…`, all ingested with `chat`/`retrieval`/`generation` observations
> and generation output tokens > 0). **No `Faithfulness` score had appeared
> 12+ hours later** — at 20% sampling the chance all 5 miss is 0.8⁵ ≈ 33%, and
> the rule reports healthy (`status: active`, `pausedReason: null`; creation
> preflight ran the judge model successfully). Most likely the sampling
> lottery; the first score should appear organically as prod traffic flows. If
> none shows after ~20 more traces, re-run the commands above and inspect the
> rule for a paused/error state (a silent per-execution failure — e.g. the
> jsonPath mapping — would not be visible in the rule status).

## 4. Where things live in the UI

- **Traces:** every prod chat turn is a trace named `chat` → child observations
  `retrieval` (typed retriever: `output.slugs` + `output.similarities`) and
  `generation` (model + token usage incl. cache reads). Trace-level
  `input.question` / `output.answer` + `output.sources`.
- **Datasets → `rag-golden`:** the golden items (26 curated) + one experiment run
  per `npm run eval` (`eval-<git-sha>-<n>`), with per-item scores + judge
  rationales.
- **Scores:** the `Faithfulness` evaluator's (project-scoped, §3) groundedness
  scores on sampled prod traces (20% of `chat` observations); offline runs' four
  judge dimensions on dataset-run items.
- **Project settings → LLM connections:** the `anthropic` connection from §2.

---

### Setup log (what this doc's author did programmatically)

| Action | Method | Result |
|---|---|---|
| Discover API surface | `langfuse-cli api __schema` + `<resource> --help` | Found `llm-connections`, `unstable-evaluators`, `unstable-evaluation-rules` |
| Verify prod traces named `chat` | `traces list --name chat` | ✅ present, `input.question` + `output.answer` populated |
| Read managed template catalog | `unstable-evaluators list` | No "Groundedness"; `Faithfulness` (`context`,`answer`) is the match |
| Upsert Anthropic LLM connection | `llm-connections put` | ✅ HTTP 201, id `cmrqm42gw0ujcad0iq1t78wh0` |
| Rule on managed `Faithfulness` | `POST unstable/evaluation-rules` | ❌ 422 `evaluator_preflight_failed` (no project default eval model — UI-only setting) |
| Project-scoped `Faithfulness` evaluator | `POST unstable/evaluators` | ✅ HTTP 200, id `cmrr2ckj30x4mad0cojsmdtbv`, model `claude-sonnet-4-6` via `anthropic` connection |
| Rule `faithfulness-prod-chat` | `POST unstable/evaluation-rules` | ✅ HTTP 200, id `cmrr2ctud0y0wad0je3ixdrtm`, active, 20% sampling, filter `name any of ["chat"]` |
