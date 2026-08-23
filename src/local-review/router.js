import { asErrorPayload, ControlPlaneError } from "../core/errors.js";
import { readJson, sendJson } from "../core/http.js";
import { dispatchedPage, reviewErrorPage, reviewPage } from "./page.js";

const DEFAULT_PAGE_ORIGINS = new Set([
  "https://chatgpt.com",
  "https://chat.deepseek.com",
]);

function isLoopback(address) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
}

function isLoopbackOrigin(origin) {
  if (!origin || origin === "null") return true;
  try {
    const url = new URL(origin);
    return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function candidateCors(request) {
  const origin = request.headers.origin;
  const declared = request.headers["x-acp-page-origin"];
  if (!origin || origin !== declared) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-acp-page-origin",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function sendLocalHtml(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
  });
  response.end(body);
}

async function readForm(request, maxBytes = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new ControlPlaneError("request_too_large", "Review form is too large");
    }
    chunks.push(chunk);
  }
  const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  return Object.fromEntries(params.entries());
}

function errorStatus(error) {
  if (!(error instanceof ControlPlaneError)) return 500;
  if (error.code.endsWith("_not_found")) return 404;
  if (error.code.endsWith("_expired")) return 410;
  if (error.code.endsWith("_conflict")) return 409;
  if (error.code.endsWith("_denied")) return 403;
  if (error.code === "candidate_limit_reached") return 429;
  return 400;
}

export class LocalReviewRouter {
  constructor({ service, getOptions, port, allowedPageOrigins = null }) {
    this.service = service;
    this.getOptions = getOptions;
    this.port = port;
    this.allowedPageOrigins = new Set(allowedPageOrigins ?? DEFAULT_PAGE_ORIGINS);
  }

  matches(url) {
    return (
      url.pathname === "/v1/local-review/candidates" ||
      url.pathname === "/local-review/review" ||
      url.pathname === "/local-review/confirm"
    );
  }

  originAllowed(request, url) {
    if (!this.matches(url)) return false;
    if (url.pathname.startsWith("/local-review/")) {
      return isLoopbackOrigin(request.headers.origin);
    }
    const declared = request.headers["x-acp-page-origin"];
    if (!this.allowedPageOrigins.has(declared)) return false;
    const origin = request.headers.origin;
    return (
      !origin ||
      origin === declared ||
      origin.startsWith("chrome-extension://") ||
      origin.startsWith("moz-extension://")
    );
  }

  async handle(request, response, url) {
    if (!isLoopback(request.socket.remoteAddress)) {
      sendJson(response, 403, {
        error: { code: "local_review_requires_loopback", message: "Local review requires loopback" },
      });
      return true;
    }

    const cors = candidateCors(request);
    try {
      if (request.method === "OPTIONS" && url.pathname === "/v1/local-review/candidates") {
        response.writeHead(204, cors);
        response.end();
        return true;
      }

      if (request.method === "POST" && url.pathname === "/v1/local-review/candidates") {
        const pageOrigin = request.headers["x-acp-page-origin"];
        if (!this.allowedPageOrigins.has(pageOrigin)) {
          throw new ControlPlaneError(
            "candidate_origin_denied",
            "The page origin is not allowed to create candidates",
          );
        }
        const body = await readJson(request, 16 * 1024);
        const created = this.service.create(body, { pageOrigin });
        const hostHeader = request.headers.host ?? "";
        const host = /^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(hostHeader)
          ? hostHeader
          : `127.0.0.1:${this.port}`;
        const reviewUrl = new URL(`http://${host}/local-review/review`);
        reviewUrl.searchParams.set("id", created.candidate.id);
        reviewUrl.searchParams.set("secret", created.reviewSecret);
        sendJson(
          response,
          201,
          { candidate: created.candidate, review_url: reviewUrl.toString() },
          cors,
        );
        return true;
      }

      if (request.method === "GET" && url.pathname === "/local-review/review") {
        const review = this.service.beginReview(
          url.searchParams.get("id"),
          url.searchParams.get("secret"),
        );
        sendLocalHtml(
          response,
          200,
          reviewPage({
            candidate: review.candidate,
            approvalSecret: review.approvalSecret,
            options: this.getOptions(),
          }),
        );
        return true;
      }

      if (request.method === "POST" && url.pathname === "/local-review/confirm") {
        const body = await readForm(request);
        const result = this.service.approve(body.id, body.approval_secret, {
          workspace: body.workspace,
          executor: body.executor,
          profile: body.profile,
        });
        sendLocalHtml(response, 200, dispatchedPage(result));
        return true;
      }

      sendJson(response, 404, {
        error: { code: "not_found", message: "Local review route not found" },
      });
      return true;
    } catch (error) {
      const status = errorStatus(error);
      if (url.pathname.startsWith("/local-review/")) {
        sendLocalHtml(response, status, reviewErrorPage(error));
      } else {
        sendJson(response, status, { error: asErrorPayload(error) }, cors);
      }
      return true;
    }
  }
}
