import { startSession } from "@/lib/sop/store.ts";

export const runtime = "nodejs";
export async function POST() { return Response.json(startSession(), { headers: { "Cache-Control": "no-store" } }); }
