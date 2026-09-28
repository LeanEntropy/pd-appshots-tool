import { spawn } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";

export const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export const MAX_BODY = 64 * 1024;

export function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

export function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-store" });
  res.end(html);
}

export function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

export async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error("too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Only requests addressed to this machine by name are served (blocks DNS-rebinding pages). */
export function localHost(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  return host === "127.0.0.1" || host === "localhost";
}

/** Browsers send Origin on cross-site requests; only this server's own origin is accepted. */
export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return (
      (o.hostname === "127.0.0.1" || o.hostname === "localhost") && o.host === req.headers.host
    );
  } catch {
    return false;
  }
}

/**
 * Every write request: same origin, the page's token, JSON only, at most 64 KB. Returns the
 * parsed body, or null after answering with the refusal.
 */
export async function writeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
): Promise<{ body: unknown } | null> {
  if (!sameOrigin(req) || req.headers["x-ssr-token"] !== token) {
    send(res, 403, { problems: ["This request did not come from the tool's page."] });
    return null;
  }
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
    send(res, 415, { problems: ["Expected JSON."] });
    return null;
  }
  try {
    return { body: await readBody(req) };
  } catch {
    send(res, 400, { problems: ["The page sent something the tool cannot read."] });
    return null;
  }
}

export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}
