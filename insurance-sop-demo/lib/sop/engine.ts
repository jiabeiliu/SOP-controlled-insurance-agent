import { bestIdentityEvidence, claimById, claimsForParty, guidelines, policyholders, resolveVerifiedHolder } from "./fixtures.ts";
import { DeterministicModelAdapter, type Draft, type ModelAdapter } from "./model.ts";
import { emptyFacts, emptyHints, type Analysis, type Claim, type Phase, type PublicSession, type Session } from "./types.ts";

const fallback = new DeterministicModelAdapter();
const now = () => new Date().toISOString();
const initialAgent = "Hi, I’m Avery with Northstar Claims Support. Before I access protected claim details, please provide any three: full name, date of birth, phone, email, or SSN/ID last four.";

export function createSession(id = crypto.randomUUID(), modelMode: Session["modelMode"] = "deterministic-fallback"): Session {
  return { id, phase: "VERIFY_ID", facts: emptyFacts(), hints: emptyHints(), verifiedPartyId: null, matchedFields: [], candidateCaseIds: [], selectedCaseId: null, consent: "not_asked", irrelevantCount: 0, complete: false, modelMode, audit: [{ at: now(), event: "SESSION_CREATED", reason: "Disclosure gate locked; no protected data accessed" }], messages: [{ role: "agent", text: initialAgent }] };
}

export function publicSession(s: Session): PublicSession {
  return { id: s.id, phase: s.phase, matchedFields: s.matchedFields, candidateCaseIds: s.verifiedPartyId ? s.candidateCaseIds : [], selectedCaseId: s.verifiedPartyId ? s.selectedCaseId : null, consent: s.consent, irrelevantCount: s.irrelevantCount, complete: s.complete, audit: s.audit, messages: s.messages, modelMode: s.modelMode, rememberedHints: s.hints };
}

function audit(s: Session, event: string, reason: string) { s.audit.unshift({ at: now(), event, reason }); s.audit = s.audit.slice(0, 30); }
function say(s: Session, text: string) { s.messages.push({ role: "agent", text }); }
function transition(s: Session, to: Phase, reason: string) {
  const allowed: Record<Phase, Phase | null> = { VERIFY_ID: "RESOLVE_INTENT", RESOLVE_INTENT: "PROCESS_CASE", PROCESS_CASE: "POST_PROCESS", POST_PROCESS: null };
  if (allowed[s.phase] !== to) throw new Error(`Illegal phase transition ${s.phase} -> ${to}`);
  const from = s.phase; s.phase = to; audit(s, "PHASE_TRANSITION", `${from} -> ${to}: ${reason}`);
}
function merge<T extends Record<string, unknown>>(current: T, next: T): T { const result = { ...current }; for (const [k,v] of Object.entries(next)) if (v !== null && v !== "") (result as Record<string, unknown>)[k] = v; return result; }

async function analyze(adapter: ModelAdapter, text: string, s: Session): Promise<Analysis> {
  try { return await adapter.analyze(text); }
  catch { audit(s, "MODEL_FALLBACK", "Structured analysis failed; deterministic parser used"); return fallback.analyze(text); }
}

function intentPresent(s: Session) { return Boolean(s.hints.status || s.hints.caseType || s.hints.month || s.hints.year || s.hints.caseId || s.hints.topic); }

async function resolveIntent(s: Session, text: string, adapter: ModelAdapter) {
  if (!s.verifiedPartyId) throw new Error("Protected case resolution attempted before verification");
  const partyClaims = claimsForParty(s.verifiedPartyId);
  const safeIndex = partyClaims.map(({ case_id, case_type, created_at, status }) => ({ case_id, case_type, created_at, status }));
  let proposal;
  try { proposal = await adapter.proposeCases(text, s.hints, safeIndex); }
  catch { audit(s, "MODEL_FALLBACK", "Case proposal failed; deterministic matcher used"); proposal = await fallback.proposeCases(text, s.hints, safeIndex); }
  const allowed = new Set(safeIndex.map((c) => c.case_id));
  s.candidateCaseIds = [...new Set(proposal.candidateCaseIds.filter((id) => allowed.has(id)))];
  audit(s, "INTENT_RESOLVED", `Remembered hints evaluated against ${partyClaims.length} verified-customer claim(s); ${s.candidateCaseIds.length} candidate(s)`);
  if (s.candidateCaseIds.length === 1) {
    s.selectedCaseId = s.candidateCaseIds[0];
    transition(s, "PROCESS_CASE", `Unique grounded case selected: ${s.selectedCaseId}`);
    say(s, `Your identity is verified. I used the details you already shared and found one matching claim: ${s.selectedCaseId}. What would you like to know about it?`);
  } else if (s.candidateCaseIds.length > 1) {
    say(s, "Your identity is verified. I found more than one possible claim. Could you share the claim type, approximate month, status, or claim ID?");
  } else if (!intentPresent(s)) {
    say(s, "Your identity is verified. What can I help with: a claim status, denial, required documents, submission, payment, or next steps?");
  } else {
    say(s, "Your identity is verified, but I couldn’t match those details to one of your claims. Please provide the claim type, approximate month, status, or claim ID.");
  }
}

function consentFrom(text: string): "granted" | "declined" | "ambiguous" {
  if (/\b(?:no|nope|decline|skip|do not|don't|dont|would not|wouldn't|stop)\b/i.test(text)) return "declined";
  if (/\b(?:yes|send it|please send|please do|go ahead|email me)\b/i.test(text)) return "granted";
  return "ambiguous";
}

function grounded(draft: Draft, claim: Claim): boolean {
  const allowedFields = new Set(Object.keys(claim));
  if (!draft.answer.trim() || !draft.citedFields.every((key) => allowedFields.has(key))) return false;
  const source = JSON.stringify({ claim, guidelines }).toLowerCase();
  const specifics = draft.answer.match(/\b(?:CL-\d+|POL-\d+|\d{4}-\d{2}-\d{2}|\$?\d+(?:\.\d{2})?)\b/gi) ?? [];
  return specifics.every((value) => source.includes(value.toLowerCase().replace(/^\$/, "")));
}

export async function handleMessage(s: Session, text: string, adapter: ModelAdapter): Promise<Session> {
  const clean = text.trim(); if (!clean || s.complete) return s;
  s.messages.push({ role: "caller", text: clean });
  const turn = await analyze(adapter, clean, s);
  s.facts = merge(s.facts as unknown as Record<string, unknown>, turn.facts as unknown as Record<string, unknown>) as unknown as Session["facts"];
  s.hints = merge(s.hints as unknown as Record<string, unknown>, turn.hints as unknown as Record<string, unknown>) as unknown as Session["hints"];
  if (intentPresent(s)) audit(s, "MEMORY_UPDATED", "Caller-provided future-phase intent hints stored without advancing the workflow");

  if (turn.scope === "out_of_scope") {
    s.irrelevantCount += 1; audit(s, "OUT_OF_SCOPE_BLOCKED", `Attempt ${s.irrelevantCount}; phase unchanged`);
    say(s, s.irrelevantCount >= 3 ? "I can only help with insurance service questions. Because this has come up repeatedly, I can connect you with a human representative, or we can return to your insurance request." : "I can’t help with that topic, but I can help with policy, claim, document, payment, or next-step questions.");
    return s;
  }

  if (s.phase === "VERIFY_ID") {
    const verified = resolveVerifiedHolder(s.facts);
    s.matchedFields = verified?.fields ?? bestIdentityEvidence(s.facts);
    if (verified) {
      s.verifiedPartyId = verified.holder.party_id; s.matchedFields = verified.fields;
      audit(s, "IDENTITY_VERIFIED", `${verified.fields.length} allowed PII fields matched one policyholder; policy number excluded`);
      transition(s, "RESOLVE_INTENT", "Server-side identity threshold satisfied");
      await resolveIntent(s, clean, adapter);
      return s;
    }
    const empathy = turn.emotion !== "neutral" ? "I hear how frustrating this is. " : "";
    if (turn.refusal || turn.wantsHuman) {
      audit(s, "VERIFICATION_REFUSAL", "Mandatory gate held; alternatives and human support offered");
      say(s, `${empathy}I can’t access or discuss protected claim details without three matching identity fields. You may use any three of full name, DOB, phone, email, or SSN/ID last four, or I can help arrange a human representative who will also need to verify identity.`);
    } else {
      audit(s, "VERIFICATION_PENDING", `${s.matchedFields.length}/3 allowed fields currently match one record`);
      say(s, `${empathy}I still need ${Math.max(1, 3 - s.matchedFields.length)} more matching identity ${3 - s.matchedFields.length === 1 ? "detail" : "details"}. Policy number does not count. You can use full name, DOB, phone, email, or SSN/ID last four.`);
    }
    return s;
  }

  if (s.phase === "RESOLVE_INTENT") { await resolveIntent(s, clean, adapter); return s; }

  if (s.phase === "PROCESS_CASE") {
    if (turn.doneWithCase) {
      transition(s, "POST_PROCESS", "Caller indicated case discussion is complete"); s.consent = "awaiting";
      const holder = policyholders.find((p) => p.party_id === s.verifiedPartyId);
      say(s, `Would you like a simulated email summary prepared for ${holder?.email ?? "your verified email"}? Say “send it” or “skip it.” No email provider is configured in this demo.`); return s;
    }
    const claim = claimById(s.selectedCaseId); if (!claim || claim.party_id !== s.verifiedPartyId) throw new Error("Selected claim is not authorized for this session");
    let draft: Draft;
    try { draft = await adapter.draft(clean, claim, guidelines); } catch { audit(s, "MODEL_FALLBACK", "Grounded draft failed; deterministic renderer used"); draft = await fallback.draft(clean, claim, guidelines); }
    if (!grounded(draft, claim)) { audit(s, "DRAFT_REJECTED", "Model draft failed grounding validation; deterministic renderer used"); draft = await fallback.draft(clean, claim, guidelines); }
    audit(s, "GROUNDED_RESPONSE", `Answer restricted to fixture claim ${claim.case_id}; cited fields: ${draft.citedFields.join(", ") || "guideline only"}`);
    say(s, `${draft.answer} Is there anything else about this claim?`); return s;
  }

  const consent = consentFrom(clean);
  if (consent === "declined") { s.consent = "declined"; s.complete = true; audit(s, "EMAIL_DECLINED", "Explicit negative language took precedence; no email action performed"); say(s, "Understood. No email was sent. Thanks for calling Northstar."); }
  else if (consent === "granted") { s.consent = "granted"; s.complete = true; audit(s, "EMAIL_SIMULATED", "Explicit consent recorded; demo has no email provider"); say(s, "Consent recorded. This demo simulated preparing the summary; no real email was sent because no email provider is configured."); }
  else { s.consent = "awaiting"; audit(s, "EMAIL_CONSENT_AMBIGUOUS", "No explicit send or skip decision detected"); say(s, "I want to make sure I have your choice right. Should I simulate preparing the email summary, or skip it?"); }
  return s;
}
