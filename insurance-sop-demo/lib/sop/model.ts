import type { Analysis, Claim, ExtractedFacts, IntentHints } from "./types.ts";
import { emptyFacts, emptyHints } from "./types.ts";

export type CaseProposal = { candidateCaseIds: string[]; clarification: string | null };
export type Draft = { answer: string; citedFields: string[] };
export interface ModelAdapter {
  readonly mode: "openai" | "deterministic-fallback";
  analyze(text: string): Promise<Analysis>;
  proposeCases(text: string, hints: IntentHints, safeCaseIndex: Array<Pick<Claim, "case_id" | "case_type" | "created_at" | "status">>): Promise<CaseProposal>;
  draft(text: string, claim: Claim, guidance: unknown): Promise<Draft>;
}

const ANALYSIS_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["facts", "hints", "emotion", "refusal", "scope", "wantsHuman", "doneWithCase"],
  properties: {
    facts: { type: "object", additionalProperties: false, required: ["name", "policy", "dob", "phone", "email", "last4"], properties: Object.fromEntries(["name","policy","dob","phone","email","last4"].map((k) => [k, { type: ["string", "null"] }])) },
    hints: { type: "object", additionalProperties: false, required: ["status","caseType","month","year","caseId","topic"], properties: {
      status: { type: ["string","null"], enum: ["denied","open","closed",null] }, caseType: { type: ["string","null"], enum: ["healthcare","dental","auto",null] },
      month: { type: ["integer","null"], minimum: 1, maximum: 12 }, year: { type: ["integer","null"], minimum: 2000, maximum: 2100 }, caseId: { type: ["string","null"] },
      topic: { type: ["string","null"], enum: ["status","denial_reason","documents","deadline","submission","processing_time","general",null] }
    }},
    emotion: { type: "string", enum: ["neutral","frustrated","anxious","angry","confused"] }, refusal: { type: "boolean" },
    scope: { type: "string", enum: ["insurance","out_of_scope","unclear"] }, wantsHuman: { type: "boolean" }, doneWithCase: { type: "boolean" }
  }
} as const;

function isStringOrNull(v: unknown): v is string | null { return typeof v === "string" || v === null; }
function validateAnalysis(v: unknown): Analysis {
  if (!v || typeof v !== "object") throw new Error("invalid analysis");
  const x = v as Record<string, unknown>, f = x.facts as Record<string, unknown>, h = x.hints as Record<string, unknown>;
  if (!f || !h || !["neutral","frustrated","anxious","angry","confused"].includes(String(x.emotion)) || !["insurance","out_of_scope","unclear"].includes(String(x.scope))) throw new Error("invalid analysis enums");
  for (const k of ["name","policy","dob","phone","email","last4"]) if (!isStringOrNull(f[k])) throw new Error(`invalid fact ${k}`);
  if (!isStringOrNull(h.status) || !isStringOrNull(h.caseType) || !isStringOrNull(h.caseId) || !isStringOrNull(h.topic)) throw new Error("invalid hints");
  if (!(h.month === null || Number.isInteger(h.month)) || !(h.year === null || Number.isInteger(h.year))) throw new Error("invalid date hints");
  if (typeof x.refusal !== "boolean" || typeof x.wantsHuman !== "boolean" || typeof x.doneWithCase !== "boolean") throw new Error("invalid flags");
  return x as unknown as Analysis;
}

function outputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) for (const content of Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : []) {
    const text = (content as Record<string, unknown>).text; if (typeof text === "string") return text;
  }
  throw new Error("model returned no text");
}

async function structuredRequest(name: string, schema: object, instructions: string, input: string): Promise<unknown> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  const configuredTimeout = Number(process.env.OPENAI_TIMEOUT_MS || 8000);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 8000;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-5-mini", store: false, instructions, input, text: { format: { type: "json_schema", name, strict: true, schema } } }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status})`);
  return JSON.parse(outputText(await response.json() as Record<string, unknown>));
}

export class OpenAIModelAdapter implements ModelAdapter {
  readonly mode = "openai" as const;
  async analyze(text: string) {
    const value = await structuredRequest("insurance_turn_analysis", ANALYSIS_SCHEMA, "Extract only what the caller explicitly said. Classify emotion, refusal, scope, intent hints, and whether the caller is done. Never infer PII. Never make workflow decisions.", text);
    return validateAnalysis(value);
  }
  async proposeCases(text: string, hints: IntentHints, safeCaseIndex: Array<Pick<Claim, "case_id" | "case_type" | "created_at" | "status">>) {
    const schema = { type: "object", additionalProperties: false, required: ["candidateCaseIds","clarification"], properties: { candidateCaseIds: { type: "array", items: { type: "string" } }, clarification: { type: ["string","null"] } } };
    const value = await structuredRequest("case_match_proposal", schema, "Propose zero or more case IDs using only the supplied verified-customer index. Do not invent IDs. If multiple plausible cases remain, provide a concise clarification question.", JSON.stringify({ callerText: text, rememberedHints: hints, cases: safeCaseIndex }));
    if (!value || typeof value !== "object") throw new Error("invalid case proposal");
    const x = value as Record<string, unknown>; if (!Array.isArray(x.candidateCaseIds) || !x.candidateCaseIds.every((id) => typeof id === "string") || !isStringOrNull(x.clarification)) throw new Error("invalid case proposal fields");
    const allowed = new Set(safeCaseIndex.map((c) => c.case_id));
    return { candidateCaseIds: x.candidateCaseIds.filter((id): id is string => typeof id === "string" && allowed.has(id)), clarification: x.clarification as string | null };
  }
  async draft(text: string, claim: Claim, guidance: unknown) {
    const allowedFields = Object.keys(claim);
    const schema = { type: "object", additionalProperties: false, required: ["answer","citedFields"], properties: { answer: { type: "string" }, citedFields: { type: "array", items: { type: "string", enum: allowedFields } } } };
    const value = await structuredRequest("grounded_claim_answer", schema, "Draft a concise customer-service answer using only the supplied claim record and guidance. Do not add facts, dates, amounts, promises, or requirements not present. List every claim field used in citedFields.", JSON.stringify({ question: text, claim, guidance }));
    if (!value || typeof value !== "object") throw new Error("invalid draft");
    const x = value as Record<string, unknown>; if (typeof x.answer !== "string" || !Array.isArray(x.citedFields) || !x.citedFields.every((k) => typeof k === "string" && allowedFields.includes(k))) throw new Error("ungrounded draft");
    return { answer: x.answer, citedFields: x.citedFields as string[] };
  }
}

const monthNames: Record<string, number> = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
export class DeterministicModelAdapter implements ModelAdapter {
  readonly mode = "deterministic-fallback" as const;
  async analyze(text: string): Promise<Analysis> {
    const facts = emptyFacts(), hints = emptyHints();
    facts.policy = text.match(/\bPOL[-\s]?\d{4}\b/i)?.[0].toUpperCase().replace(" ", "-") ?? null;
    facts.dob = text.match(/\b(?:19|20)\d{2}[-/]\d{2}[-/]\d{2}\b/)?.[0].replaceAll("/", "-") ?? null;
    facts.last4 = text.match(/(?:last\s*(?:four|4)|ssn|national id)[^\d]{0,18}(\d{4})/i)?.[1] ?? null;
    facts.email = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0].toLowerCase() ?? null;
    facts.phone = text.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/)?.[0].replace(/[^\d+]/g, "") ?? null;
    facts.name = text.match(/(?:name is|i(?:'m| am))\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/)?.[1] ?? null;
    hints.status = /denied|denial/i.test(text) ? "denied" : /\bopen\b|in progress/i.test(text) ? "open" : /closed|settled|completed/i.test(text) ? "closed" : null;
    hints.caseType = /health|medical/i.test(text) ? "healthcare" : /dental|teeth/i.test(text) ? "dental" : /auto|car|vehicle/i.test(text) ? "auto" : null;
    for (const [name, number] of Object.entries(monthNames)) if (new RegExp(`\\b${name.slice(0,3)}(?:${name.slice(3)})?\\b`, "i").test(text)) hints.month = number;
    hints.year = Number(text.match(/\b20\d{2}\b/)?.[0]) || null; hints.caseId = text.match(/\bCL-\d{4}\b/i)?.[0].toUpperCase() ?? null;
    hints.topic = /why|reason/i.test(text) ? "denial_reason" : /document|paperwork|report|office note/i.test(text) ? "documents" : /deadline|when.*(?:send|submit)/i.test(text) ? "deadline" : /upload|where.*send|how.*submit/i.test(text) ? "submission" : /how long|processing|review time/i.test(text) ? "processing_time" : /status|outcome/i.test(text) ? "status" : /claim|denied|coverage|policy/i.test(text) ? "general" : null;
    const scope = /reinforcement learning|photosynthesis|weather|recipe|capital of|poem|bitcoin|sports score/i.test(text) ? "out_of_scope" : (hints.topic || hints.caseType || hints.status || Object.values(facts).some(Boolean)) ? "insurance" : "unclear";
    const emotion = /angry|furious|ridiculous/i.test(text) ? "angry" : /frustrat|already told/i.test(text) ? "frustrated" : /worried|anxious|scared/i.test(text) ? "anxious" : /confused|don't understand/i.test(text) ? "confused" : "neutral";
    return { facts, hints, emotion, refusal: /refuse|won't|will not|not giving|don't want to (?:give|provide)/i.test(text), scope, wantsHuman: /human|representative|agent|supervisor/i.test(text), doneWithCase: /that's all|nothing else|\bi'?m done\b|wrap up|finish/i.test(text) };
  }
  async proposeCases(_text: string, hints: IntentHints, index: Array<Pick<Claim, "case_id" | "case_type" | "created_at" | "status">>): Promise<CaseProposal> {
    let matches = index;
    if (hints.caseId) matches = matches.filter((c) => c.case_id === hints.caseId);
    if (hints.status) matches = matches.filter((c) => c.status === hints.status);
    if (hints.caseType) matches = matches.filter((c) => c.case_type === hints.caseType);
    if (hints.month) matches = matches.filter((c) => Number(c.created_at.slice(5,7)) === hints.month);
    if (hints.year) matches = matches.filter((c) => Number(c.created_at.slice(0,4)) === hints.year);
    return { candidateCaseIds: matches.map((c) => c.case_id), clarification: matches.length > 1 ? "I found more than one possible claim. Could you share the claim type, approximate month, status, or claim ID?" : null };
  }
  async draft(text: string, claim: Claim, guidance: any): Promise<Draft> {
    if (/why|reason|denied/i.test(text) && claim.denial_reason) return { answer: `Claim ${claim.case_id} was denied because ${claim.denial_reason}.`, citedFields: ["case_id","denial_reason"] };
    if (/document|need|paperwork|report|office note/i.test(text) && claim.documents_needed?.length) return { answer: `The record requests ${claim.documents_needed.join(" and ")} for claim ${claim.case_id}.`, citedFields: ["documents_needed","case_id"] };
    if (/deadline|when.*(?:send|submit)/i.test(text) && claim.appeal_deadline) return { answer: `The appeal deadline recorded for claim ${claim.case_id} is ${claim.appeal_deadline}.`, citedFields: ["appeal_deadline","case_id"] };
    if (/upload|where|how.*submit/i.test(text)) return { answer: `${guidance.default_guidance.en} This guidance applies to claim ${claim.case_id}.`, citedFields: ["case_id"] };
    if (/how long|processing|review time/i.test(text)) return { answer: `After complete files are received, the documented average processing time is ${guidance.claim_followup_settings.average_processing_time_after_submission.en}.`, citedFields: [] };
    return { answer: `Claim ${claim.case_id} is ${claim.status}. ${claim.summary}.`, citedFields: ["case_id","status","summary"] };
  }
}

export function configuredModel(): ModelAdapter { return process.env.OPENAI_API_KEY ? new OpenAIModelAdapter() : new DeterministicModelAdapter(); }
