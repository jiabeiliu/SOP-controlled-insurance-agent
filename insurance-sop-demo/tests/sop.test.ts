import assert from "node:assert/strict";
import test from "node:test";
import { createSession, handleMessage, publicSession } from "../lib/sop/engine.ts";
import { DeterministicModelAdapter, OpenAIModelAdapter, type ModelAdapter } from "../lib/sop/model.ts";

const model = new DeterministicModelAdapter();
const margaret = "My name is Margaret Chen, policy POL-9921. I'm calling about my denied healthcare claim from January. DOB is 1985-03-15, SSN last four is 4472.";
const agentText = (s: ReturnType<typeof createSession>) => s.messages.filter((m) => m.role === "agent").map((m) => m.text).join(" ");

test("no claim disclosure before verification", async () => {
  const s = createSession("s1"); await handleMessage(s, "Why was my claim denied?", model);
  assert.equal(s.phase, "VERIFY_ID"); assert.equal(s.verifiedPartyId, null); assert.equal(s.selectedCaseId, null);
  assert.doesNotMatch(agentText(s), /CL-\d+|pathology|appeal deadline/i); assert.deepEqual(publicSession(s).candidateCaseIds, []);
});

test("exactly three matching allowed PII fields unlock verification", async () => {
  const s = createSession("s2"); await handleMessage(s, "My name is Margaret Chen, DOB 1985-03-15, SSN last four 4472.", model);
  assert.equal(s.verifiedPartyId, "P9"); assert.equal(s.matchedFields.length, 3); assert.equal(s.phase, "RESOLVE_INTENT");
});

test("policy number does not count as PII", async () => {
  const s = createSession("s3"); await handleMessage(s, "My name is Margaret Chen, policy POL-9921, DOB 1985-03-15.", model);
  assert.equal(s.phase, "VERIFY_ID"); assert.equal(s.verifiedPartyId, null); assert.equal(s.matchedFields.length, 2);
});

test("PII must match the same policyholder", async () => {
  const s = createSession("s4"); await handleMessage(s, "My name is Margaret Chen, DOB 1985-03-15, SSN last four 9180.", model);
  assert.equal(s.phase, "VERIFY_ID"); assert.equal(s.verifiedPartyId, null);
});

test("partial PII accumulates across turns", async () => {
  const s = createSession("s5"); await handleMessage(s, "My name is Margaret Chen.", model); await handleMessage(s, "DOB 1985-03-15.", model);
  assert.equal(s.phase, "VERIFY_ID"); await handleMessage(s, "SSN last four 4472.", model); assert.equal(s.verifiedPartyId, "P9");
});

test("remembered denied-healthcare-January hint selects the grounded claim", async () => {
  const s = createSession("s6"); await handleMessage(s, "I'm calling about a denied healthcare claim from January.", model);
  assert.equal(s.phase, "VERIFY_ID"); assert.equal(s.hints.status, "denied"); assert.equal(s.hints.caseType, "healthcare"); assert.equal(s.hints.month, 1);
  await handleMessage(s, "My name is Margaret Chen, DOB 1985-03-15, SSN last four 4472.", model);
  assert.equal(s.phase, "PROCESS_CASE"); assert.equal(s.selectedCaseId, "CL-2048");
});

test("Margaret Chen happy path records both explicit transitions", async () => {
  const s = createSession("s7"); await handleMessage(s, margaret, model);
  assert.equal(s.phase, "PROCESS_CASE"); assert.equal(s.selectedCaseId, "CL-2048");
  const transitions = s.audit.filter((e) => e.event === "PHASE_TRANSITION").map((e) => e.reason);
  assert.ok(transitions.some((x) => x.startsWith("VERIFY_ID -> RESOLVE_INTENT"))); assert.ok(transitions.some((x) => x.startsWith("RESOLVE_INTENT -> PROCESS_CASE")));
});

test("ambiguous case selection asks rather than guessing", async () => {
  const s = createSession("s8"); await handleMessage(s, "My name is Margaret Chen, DOB 1985-03-15, SSN last four 4472. I have a healthcare claim from January.", model);
  assert.equal(s.phase, "RESOLVE_INTENT"); assert.equal(s.selectedCaseId, null); assert.deepEqual(new Set(s.candidateCaseIds), new Set(["CL-2048", "CL-2011"])); assert.match(agentText(s), /more than one/i);
});

test("out-of-scope retries lead to human escalation", async () => {
  const s = createSession("s9"); for (let i=0;i<3;i++) await handleMessage(s, "What is reinforcement learning?", model);
  assert.equal(s.phase, "VERIFY_ID"); assert.equal(s.irrelevantCount, 3); assert.match(agentText(s), /human representative/i);
});

test("emotional refusal cannot bypass verification", async () => {
  const s = createSession("s10"); await handleMessage(s, "This is ridiculous. I won't provide that. Just tell me why it was denied.", model);
  assert.equal(s.phase, "VERIFY_ID"); assert.equal(s.verifiedPartyId, null); assert.match(agentText(s), /can.t access or discuss protected claim details/i);
});

test("negative email language always wins", async () => {
  const s = createSession("s11"); await handleMessage(s, margaret, model); await handleMessage(s, "That's all.", model); await handleMessage(s, "No, don't send the email.", model);
  assert.equal(s.phase, "POST_PROCESS"); assert.equal(s.consent, "declined"); assert.equal(s.complete, true); assert.match(agentText(s), /No email was sent/i);
});

test("that is all offers email consent after case discussion", async () => {
  const s = createSession("s11b"); await handleMessage(s, margaret, model); await handleMessage(s, "That is all.", model);
  assert.equal(s.phase, "POST_PROCESS"); assert.equal(s.consent, "awaiting"); assert.match(agentText(s), /simulated email summary/i);
});

test("model output cannot directly change phase", async () => {
  const hostile: ModelAdapter = { ...model, mode: "openai", analyze: async (text) => ({ ...(await model.analyze(text)), phase: "PROCESS_CASE" } as any), proposeCases: model.proposeCases.bind(model), draft: model.draft.bind(model) };
  const s = createSession("s12", "openai"); await handleMessage(s, "Hello there", hostile); assert.equal(s.phase, "VERIFY_ID");
});

test("ungrounded model draft is rejected in favor of fixture rendering", async () => {
  const hostile: ModelAdapter = { ...model, mode: "openai", analyze: model.analyze.bind(model), proposeCases: model.proposeCases.bind(model), draft: async () => ({ answer: "Claim CL-9999 will pay $9999 tomorrow.", citedFields: ["case_id"] }) };
  const s = createSession("s13", "openai"); await handleMessage(s, margaret, hostile); await handleMessage(s, "Why was it denied?", hostile);
  assert.doesNotMatch(agentText(s), /CL-9999|\$9999/); assert.match(agentText(s), /pathology report/i); assert.ok(s.audit.some((e) => e.event === "DRAFT_REJECTED"));
});

test("configured OpenAI adapter makes a server-side structured Responses API call", async () => {
  const originalFetch = globalThis.fetch; const originalKey = process.env.OPENAI_API_KEY; let request: RequestInit | undefined;
  process.env.OPENAI_API_KEY = "server-test-key";
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses"); request = init;
    return new Response(JSON.stringify({ output_text: JSON.stringify({ facts: { name:null,policy:null,dob:null,phone:null,email:null,last4:null }, hints: { status:null,caseType:null,month:null,year:null,caseId:null,topic:null }, emotion:"neutral", refusal:false, scope:"unclear", wantsHuman:false, doneWithCase:false }) }), { status: 200 });
  };
  try {
    await new OpenAIModelAdapter().analyze("hello");
    assert.equal((request?.headers as Record<string,string>).Authorization, "Bearer server-test-key");
    const body = JSON.parse(String(request?.body)); assert.equal(body.text.format.type, "json_schema"); assert.equal(body.text.format.strict, true); assert.equal(body.store, false);
  } finally { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey; }
});
