import policyholdersJson from "../fixtures/policyholders.json" with { type: "json" };
import claimsJson from "../fixtures/claims.json" with { type: "json" };
import guidelineJson from "../fixtures/required_document_guideline.json" with { type: "json" };
import type { Claim, Policyholder } from "./types.ts";

export const policyholders = policyholdersJson as Policyholder[];
export const claims = claimsJson as Claim[];
export const guidelines = guidelineJson;

const norm = (value: string) => value.trim().toLowerCase();
const digits = (value: string) => value.replace(/\D/g, "");

export function matchedIdentityFields(facts: Record<string, string | null>, holder: Policyholder): string[] {
  const fields: string[] = [];
  if (facts.name && [holder.name, ...(holder.name_aliases ?? [])].some((v) => norm(v) === norm(facts.name!))) fields.push("Full name");
  if (facts.dob === holder.dob) fields.push("Date of birth");
  if (facts.phone && [holder.phone, ...(holder.phone_aliases ?? [])].some((v) => digits(v) === digits(facts.phone!))) fields.push("Phone");
  if (facts.email && [holder.email, ...(holder.email_aliases ?? [])].some((v) => norm(v) === norm(facts.email!))) fields.push("Email");
  if (facts.last4 === holder.id_last4) fields.push(holder.id_type === "ssn_last4" ? "SSN last 4" : "ID last 4");
  return fields;
}

export function resolveVerifiedHolder(facts: Record<string, string | null>) {
  const candidates = policyholders.map((holder) => ({ holder, fields: matchedIdentityFields(facts, holder) })).filter((x) => x.fields.length >= 3);
  return candidates.length === 1 ? candidates[0] : null;
}

export function bestIdentityEvidence(facts: Record<string, string | null>): string[] {
  return policyholders.map((holder) => matchedIdentityFields(facts, holder)).sort((a, b) => b.length - a.length)[0] ?? [];
}

export function claimsForParty(partyId: string) { return claims.filter((claim) => claim.party_id === partyId); }
export function claimById(id: string | null) { return id ? claims.find((claim) => claim.case_id === id) ?? null : null; }
