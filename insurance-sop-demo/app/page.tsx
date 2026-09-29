"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Phase, PublicSession } from "@/lib/sop/types.ts";
import "./globals.css";

const phases: Array<{ id: Phase; label: string }> = [
  { id: "VERIFY_ID", label: "Verify identity" }, { id: "RESOLVE_INTENT", label: "Resolve intent" },
  { id: "PROCESS_CASE", label: "Process case" }, { id: "POST_PROCESS", label: "Post-process" },
];
const scenarios = [
  "I already told you who I am. This is ridiculous. Just tell me why my claim was denied.",
  "What is reinforcement learning?",
];

export default function Home() {
  const [session, setSession] = useState<PublicSession | null>(null);
  const [input, setInput] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function reset() {
    setBusy(true); setError("");
    try { const response = await fetch("/api/session", { method: "POST" }); if (!response.ok) throw new Error("Could not start session"); setSession(await response.json()); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not start session"); } finally { setBusy(false); }
  }
  useEffect(() => { void reset(); }, []);
  async function submit(raw?: string) {
    const text = (raw ?? input).trim(); if (!text || !session || busy || session.complete) return;
    setInput(""); setBusy(true); setError("");
    try {
      const response = await fetch(`/api/session/${encodeURIComponent(session.id)}/message`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (!response.ok) throw new Error("The server could not process that message"); setSession(await response.json());
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); } finally { setBusy(false); }
  }
  const phase = session?.phase ?? "VERIFY_ID"; const phaseIndex = phases.findIndex((p) => p.id === phase);
  return <main>
    <header className="topbar"><div className="brand"><span className="mark">N</span><div><strong>Northstar</strong><small>Claims support lab</small></div></div><button className="settings" onClick={() => void reset()} disabled={busy}>↻ New secure session</button></header>
    <section className="hero"><div><span className="eyebrow">SERVER-ENFORCED SOP HARNESS</span><h1>Natural conversation.<br/><em>Non-negotiable controls.</em></h1><p>The browser holds no policyholder or claim records. Identity gates, workflow state, fixture access, and model calls run on the server.</p></div><div className="gate-card"><span>Disclosure gate</span><strong className={phase === "VERIFY_ID" ? "locked" : "open"}>{phase === "VERIFY_ID" ? "● Locked" : "● Unlocked"}</strong><small>{phase === "VERIFY_ID" ? "Protected records unavailable" : "Server verified identity"}</small></div></section>
    <nav className="phasebar" aria-label="Workflow phases">{phases.map((p,i) => <div className={`phase ${i === phaseIndex ? "active" : ""} ${i < phaseIndex ? "done" : ""}`} key={p.id}><span>{i < phaseIndex ? "✓" : i+1}</span><div><small>{p.id}</small><strong>{p.label}</strong></div></div>)}</nav>
    <section className="workspace">
      <article className="chat-card"><div className="chat-head"><div><span className="avatar">AV</span><div><strong>Avery</strong><small><i></i> {session?.modelMode === "openai" ? "OpenAI structured reasoning" : "Deterministic fallback"}</small></div></div><span className="case-tag">{session ? `Session ${session.id.slice(0,8)}` : "Starting…"}</span></div>
        <div className="messages">{session?.messages.map((m,i) => <div className={`message ${m.role}`} key={i}><span>{m.role === "agent" ? "A" : "You"}</span><div>{m.text}</div></div>)}{busy && <div className="complete">Processing securely…</div>}{error && <div className="complete">{error}</div>}</div>
        <div className="quick-tests"><small>TRY A SCENARIO</small>{scenarios.map((s,i) => <button key={i} onClick={() => void submit(s)} disabled={busy || !session || session.complete}>{["Frustrated caller","Off-topic retry"][i]}</button>)}</div>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); void submit(); }}><input value={input} onChange={(e) => setInput(e.target.value)} placeholder={session?.complete ? "Session complete" : "Reply as the caller…"} disabled={busy || !session || session.complete}/><button aria-label="Send" disabled={busy || !input.trim() || !session || session.complete}>↑</button></form>
      </article>
      <aside><section className="panel state"><div className="panel-title"><span>SERVER STATE</span><b>{phase.replace("_", " ")}</b></div><div className="meter"><div style={{width:`${Math.min(100,(session?.matchedFields.length ?? 0)/3*100)}%`}}/></div><div className="meter-label"><span>Identity evidence</span><strong>{session?.matchedFields.length ?? 0} / 3 matched</strong></div><div className="chips">{["Full name","Date of birth","Phone","Email","SSN/ID last 4"].map((x) => <span className={session?.matchedFields.includes(x) || (x === "SSN/ID last 4" && session?.matchedFields.some((m) => m.endsWith("last 4"))) ? "yes" : ""} key={x}>{x}</span>)}</div></section>
        <section className="panel memory"><div className="panel-title"><span>REMEMBERED HINTS</span><b>Server-owned</b></div><p className="empty">{session ? Object.entries(session.rememberedHints).filter(([,v]) => v != null).map(([k,v]) => `${k}: ${v}`).join(" · ") || "Future-phase details said early are stored here without opening the disclosure gate." : "Starting session…"}</p></section>
        <section className="panel audit"><div className="panel-title"><span>CONTROL LOG</span><b>Auditable</b></div>{session?.audit.slice(0,8).map((x,i) => <div className="log" key={`${x.at}-${i}`}><i/><span>{x.event}: {x.reason}</span><time>{i === 0 ? "now" : "earlier"}</time></div>)}</section></aside>
    </section>
    <footer><span>Server fixture-backed · Synthetic data</span><span>Strict gates <b>·</b> Validated model proposals <b>·</b> Explicit consent</span></footer>
  </main>;
}
