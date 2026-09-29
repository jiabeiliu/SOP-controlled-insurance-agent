import { sendMessage } from "@/lib/sop/store.ts";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const text = (body as { text?: unknown })?.text;
  if (typeof text !== "string" || !text.trim() || text.length > 4000) return Response.json({ error: "text must be 1-4000 characters" }, { status: 400 });
  const session = await sendMessage(id, text); if (!session) return Response.json({ error: "Session not found" }, { status: 404 });
  return Response.json(session, { headers: { "Cache-Control": "no-store" } });
}
