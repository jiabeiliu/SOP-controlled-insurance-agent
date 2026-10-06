# Northstar Insurance SOP Harness

A claims-support demo that keeps workflow authority and protected records on the server while using an AI model only for bounded, schema-validated language tasks.

Public demo: [Northstar Insurance SOP Harness](https://northstar-insurance-sop-harness.nicoleliuuuuu.chatgpt.site). The hosted demo currently uses deterministic fallback with synthetic fixture data; no OpenAI key is configured on the Site. The model-backed path is available when a server-side key is supplied in your own deployment.

## Architecture

- `app/page.tsx` is an untrusted chat client. It has no policyholder records, claim records, API key, or phase-transition authority.
- `app/api/session/**` owns the HTTP session boundary.
- `lib/sop/engine.ts` is the deterministic state machine: `VERIFY_ID -> RESOLVE_INTENT -> PROCESS_CASE -> POST_PROCESS`. Only this module changes phase.
- `lib/sop/store.ts` keeps authoritative demo sessions in server memory.
- `lib/sop/model.ts` calls the OpenAI Responses API when `OPENAI_API_KEY` exists and validates Structured Outputs again at runtime. Without a key it uses the deterministic fallback in the same module.
- `lib/sop/fixtures.ts` loads the supplied synthetic policyholder, claim, and guidance JSON. Protected claim lookup is unreachable until three allowed PII fields match one policyholder.

The five allowed verification fields are full name, DOB, phone, email, and SSN/ID last four. Policy number may help capture context but never counts toward the three-field threshold.

## Model responsibilities

When configured, the server calls the OpenAI Responses API for:

1. Entity extraction
2. Emotion, refusal, and scope classification
3. Intent proposal
4. Case-match proposal against an allowed verified-customer index
5. Grounded response drafting from the selected fixture record

The model cannot change phase, verify identity, retrieve records, select an unauthorized claim, or perform email actions. During `VERIFY_ID`, the model receives only caller-supplied text; policyholder and claim fixtures are not included. Model outputs use strict JSON Schema and application-level validation. Invalid or unavailable model output falls back to deterministic behavior.

## Run locally

Node 22.13 or newer is required.

```bash
npm ci
cp .env.example .env.local
# Set OPENAI_API_KEY in .env.local to exercise real model calls.
npm run dev
```

Without `OPENAI_API_KEY`, the UI clearly reports `Deterministic fallback`. This mode exists for repeatable local testing; it uses regex extraction, deterministic matching, and fixture-backed answer templates.

The API key is read only in server code and is never returned to the browser. `OPENAI_MODEL` defaults to `gpt-5-mini`. `OPENAI_TIMEOUT_MS` defaults to 8000; request failures and timeouts fall back to deterministic processing without changing the server-controlled phase.

## Tests and build

```bash
npm test
npm run build
```

The test suite covers disclosure gating, three-field verification, same-record matching, policy-number exclusion, partial answers, cross-phase memory, ambiguity, out-of-scope escalation, refusal, explicit email consent, phase authority, and grounded-response rejection.

## Docker

```bash
docker build -t insurance-sop-harness .
docker run --rm -p 3000:3000 --env OPENAI_API_KEY --env OPENAI_MODEL=gpt-5-mini insurance-sop-harness
```

Omit the environment variables to run deterministic fallback mode.

## Fixture grounding

After verification, case resolution is limited to claims whose `party_id` belongs to the verified policyholder. The model may propose IDs only from a reduced index supplied by the server; the server filters proposals against that allowlist. If multiple claims remain, the state machine stays in `RESOLVE_INTENT` and asks for clarification. `PROCESS_CASE` drafting receives only the selected claim and supplied guidance. Drafts that cite unknown fields or introduce unsupported IDs, dates, or numeric claims are rejected and replaced with deterministic fixture rendering.

## Email behavior

This demo has no email provider. `POST_PROCESS` explicitly asks for send/skip consent, records the choice, and labels a positive action as simulated. Negative language is evaluated first, so “No, don’t send the email” always declines. No real email is sent.

## Demo limitations

- Server sessions are in-memory and may be lost on restart or worker eviction; production should use a durable session store.
- The deterministic fallback intentionally supports a smaller language surface than the model-backed path.
- Grounding validation combines schema constraints, claim ownership checks, allowed field citations, and specific-value checks; a production system should add policy evaluation and broader adversarial tests.
- All included customer and claim data is synthetic.
