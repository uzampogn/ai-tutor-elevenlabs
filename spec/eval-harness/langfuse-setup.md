# Langfuse setup — managed evaluator on prod traces

One-time configuration for the managed evaluator that scores sampled production
`/api/chat` traces (spec/eval-harness §6). SDK/keys setup lives in `.env.example`.

> **What was automated vs. what remains a human step.** This project was set up
> headless (no browser). The Anthropic **LLM connection** — the only piece the
> Langfuse public API lets us write safely — was created programmatically via the
> CLI (§2 below). The **evaluator + evaluation rule** (which decide *what* gets
> sampled and *how* variables map) are documented here as one-time steps; do them
> in the UI (recommended, matches this doc) or via the CLI commands in §3b. They
> were **not** executed automatically.
>
> **UI labels drift.** Langfuse's UI wording does not always match the API/SDK
> field names (per the langfuse skill's warning). Labels below marked _(approx.)_
> are best-effort; trust the on-screen wording if it differs, and the API field
> names in §3b are exact.

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

## 3. Groundedness evaluator on sampled prod traces — ⏳ one-time human step

### 3a. Via the UI (recommended)

- **Evaluators → New evaluator → from a template.** There is **no template named
  literally "Groundedness"** in the managed catalog. The RAG groundedness metric
  is the RAGAS **`Faithfulness`** template (variables `context`, `answer`; scores
  0–1 NUMERIC) — it measures whether the answer's claims are supported by the
  retrieved context, which is exactly "groundedness". _(Alternative:_ the
  `Hallucination` template, variables `query`, `generation`, is the inverse
  framing if you prefer that.) This deviation from the brief's "Groundedness"
  wording is because the catalog exposes the RAGAS names.
- **Target:** _(approx. UI label)_ **Traces** (live production traces), filtered
  to **`name = chat`**. Confirmed present: prod traces named `chat` exist (e.g.
  `0a66f9d957c09fd1247718f3431b7461`, `a94cd71d194d5cea56b067cd5c800026`), with
  `input.question` and `output.answer` set at trace level.
- **Sampling:** start at **10%** (raise toward 20% once daily volume is known).
- **Variable mapping** (map each template variable to a trace/observation field):
  - `answer` → trace **`output.answer`** (the final answer text; set via
    `setTraceIO`, verified populated on prod traces).
  - `context` → the **`retrieval`** observation's **`output.slugs`** (the
    retrieved source slugs; the retriever observation also carries
    `output.similarities`). _If the template scores better on full text than on
    slug ids,_ map `context` to the **`generation`** observation's input instead
    (the retrieved article bodies are in the generation's prompt) — pick whichever
    the template accepts. Trace-level `output.sources` is an equivalent slug list.
- **Model:** the **`anthropic`** connection from §2, model **`claude-sonnet-4-6`**.
- **Save**, then send one live chat turn and confirm a `Faithfulness` score
  appears on a fresh `chat` trace within a few minutes.

### 3b. Via the CLI (alternative to the UI — NOT executed during setup)

The public API exposes evaluator config under the **unstable** surface
(`unstable-evaluators`, `unstable-evaluation-rules`). Setup did **not** run these
(only the LLM-connection write in §2 was authorized), but they are the
programmatic equivalent of §3a. Discover exact args first:

```bash
npx langfuse-cli --env .env.local api unstable-evaluators --help
npx langfuse-cli --env .env.local api unstable-evaluation-rules create --help
```

Notes for whoever runs these:
- `Faithfulness` already exists as a **managed** evaluator (scope `managed`,
  variables `context`, `answer`) — you likely only need an **evaluation rule**
  that references it by `name=Faithfulness` + `scope=managed`, not a new
  evaluator.
- The rule's **`target`** field is **`observation`** or `experiment` (API
  wording) — the UI's "Traces" option maps to observation-scoped live sampling;
  filter to root observations named `chat`. This is the UI-vs-API label drift
  called out above.
- For `llm_as_judge` rules every template variable must be mapped exactly once
  (`context`, `answer`), or the API returns `400 missing_variable_mapping`.
- At most 50 active rules per project.

## 4. Where things live in the UI

- **Traces:** every prod chat turn is a trace named `chat` → child observations
  `retrieval` (typed retriever: `output.slugs` + `output.similarities`) and
  `generation` (model + token usage incl. cache reads). Trace-level
  `input.question` / `output.answer` + `output.sources`.
- **Datasets → `rag-golden`:** the golden items (26 curated) + one experiment run
  per `npm run eval` (`eval-<git-sha>-<n>`), with per-item scores + judge
  rationales.
- **Scores:** the managed `Faithfulness` evaluator's groundedness scores on
  sampled prod traces; offline runs' four judge dimensions on dataset-run items.
- **Project settings → LLM connections:** the `anthropic` connection from §2.

---

### Setup log (what this doc's author did programmatically)

| Action | Method | Result |
|---|---|---|
| Discover API surface | `langfuse-cli api __schema` + `<resource> --help` | Found `llm-connections`, `unstable-evaluators`, `unstable-evaluation-rules` |
| Verify prod traces named `chat` | `traces list --name chat` | ✅ present, `input.question` + `output.answer` populated |
| Read managed template catalog | `unstable-evaluators list` | No "Groundedness"; `Faithfulness` (`context`,`answer`) is the match |
| Upsert Anthropic LLM connection | `llm-connections put` (only write) | ✅ HTTP 201, id `cmrqm42gw0ujcad0iq1t78wh0` |
| Evaluator + evaluation rule | — | ⏳ left as one-time UI/CLI step (§3) |
