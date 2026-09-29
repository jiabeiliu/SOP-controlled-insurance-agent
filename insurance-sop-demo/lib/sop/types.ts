export type Phase = "VERIFY_ID" | "RESOLVE_INTENT" | "PROCESS_CASE" | "POST_PROCESS";
export type Emotion = "neutral" | "frustrated" | "anxious" | "angry" | "confused";
export type Scope = "insurance" | "out_of_scope" | "unclear";
export type Consent = "not_asked" | "awaiting" | "granted" | "declined";

export type ExtractedFacts = {
  name: string | null;
  policy: string | null;
  dob: string | null;
  phone: string | null;
  email: string | null;
  last4: string | null;
};

export type IntentHints = {
  status: "denied" | "open" | "closed" | null;
  caseType: "healthcare" | "dental" | "auto" | null;
  month: number | null;
  year: number | null;
  caseId: string | null;
  topic: "status" | "denial_reason" | "documents" | "deadline" | "submission" | "processing_time" | "general" | null;
};

export type Analysis = {
  facts: ExtractedFacts;
  hints: IntentHints;
  emotion: Emotion;
  refusal: boolean;
  scope: Scope;
  wantsHuman: boolean;
  doneWithCase: boolean;
};

export type Policyholder = {
  party_id: string;
  name: string;
  name_aliases?: string[];
  policy_number: string;
  dob: string;
  id_type: string;
  id_last4: string;
  phone: string;
  phone_aliases?: string[];
  email: string;
  email_aliases?: string[];
};

export type Claim = {
  case_id: string;
  party_id: string;
  case_type: "healthcare" | "dental" | "auto";
  created_at: string;
  status: "denied" | "open" | "closed";
  summary: string;
  denial_reason?: string;
  documents_needed?: string[];
  appeal_deadline?: string;
  expected_reimbursement_amount: string;
  allowed_max_amount: string;
  net_pay: string;
  net_fee: string;
};

export type ChatMessage = { role: "agent" | "caller"; text: string };
export type AuditEvent = { at: string; event: string; reason: string };

export type Session = {
  id: string;
  phase: Phase;
  facts: ExtractedFacts;
  hints: IntentHints;
  verifiedPartyId: string | null;
  matchedFields: string[];
  candidateCaseIds: string[];
  selectedCaseId: string | null;
  consent: Consent;
  irrelevantCount: number;
  complete: boolean;
  audit: AuditEvent[];
  messages: ChatMessage[];
  modelMode: "openai" | "deterministic-fallback";
};

export type PublicSession = Pick<Session, "id" | "phase" | "matchedFields" | "candidateCaseIds" | "consent" | "irrelevantCount" | "complete" | "audit" | "messages" | "modelMode"> & {
  rememberedHints: IntentHints;
  selectedCaseId: string | null;
};

export const emptyFacts = (): ExtractedFacts => ({ name: null, policy: null, dob: null, phone: null, email: null, last4: null });
export const emptyHints = (): IntentHints => ({ status: null, caseType: null, month: null, year: null, caseId: null, topic: null });
