import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { today } from "../kb/open.ts";
import { approveBulk, decide, reviewList } from "../kb/review.ts";
import { kbFiles } from "../storage/kb-files.ts";
import { kbReviewPage } from "../view/kb-review.ts";
import type { AppContext } from "./app-context.ts";
import { send, sendHtml, writeRequest } from "./http-util.ts";

/**
 * The knowledge base's review list (decision D8), shared by all projects: GET /knowledge (the
 * page), GET /api/kb/review (the list), POST /api/kb/decision (one entry) and POST
 * /api/kb/approve-bulk (every waiting unverified entry, decision D4). Saved in the tool's kb/.
 */
const Decision = z.strictObject({
  entryId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(500).optional(),
});

export async function kbRoute(
  app: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  p: string,
): Promise<boolean> {
  const get = req.method === "GET";
  if (p === "/knowledge" && get) {
    sendHtml(res, kbReviewPage(app.token));
    return true;
  }
  if (p === "/api/kb/review" && get) {
    send(res, 200, reviewList(kbFiles(app.root), today()));
    return true;
  }
  if (p === "/api/kb/decision" && req.method === "POST") {
    const w = await writeRequest(req, res, app.token);
    if (!w) return true;
    const b = Decision.safeParse(w.body);
    if (!b.success) {
      send(res, 400, {
        problems: ["The page sent a decision the tool cannot read. Reload the page."],
      });
      return true;
    }
    const r = decide(
      kbFiles(app.root),
      today(),
      b.data.entryId,
      b.data.decision,
      "user",
      b.data.note,
    );
    if (r.ok) send(res, 200, { saved: true, item: r.item });
    else send(res, 409, { problems: [r.problem] });
    return true;
  }
  if (p === "/api/kb/approve-bulk" && req.method === "POST") {
    const w = await writeRequest(req, res, app.token);
    if (!w) return true;
    send(res, 200, { saved: true, approved: approveBulk(kbFiles(app.root), today(), "user") });
    return true;
  }
  return false;
}
