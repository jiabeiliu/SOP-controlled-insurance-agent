import { configuredModel } from "./model.ts";
import { createSession, handleMessage, publicSession } from "./engine.ts";
import type { Session } from "./types.ts";

const globalStore = globalThis as typeof globalThis & { __insuranceSessions?: Map<string, Session> };
const sessions = globalStore.__insuranceSessions ??= new Map<string, Session>();

export function startSession() {
  const model = configuredModel(); const session = createSession(undefined, model.mode); sessions.set(session.id, session); return publicSession(session);
}
export async function sendMessage(id: string, text: string) {
  const session = sessions.get(id); if (!session) return null;
  const model = configuredModel(); session.modelMode = model.mode; await handleMessage(session, text, model); return publicSession(session);
}
