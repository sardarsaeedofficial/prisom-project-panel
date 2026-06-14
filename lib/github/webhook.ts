import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verifies the HMAC-SHA256 signature GitHub attaches to every webhook delivery.
 *
 * Security notes:
 * - Uses Node.js timingSafeEqual to prevent timing-oracle attacks.
 * - The webhook secret is read from GITHUB_WEBHOOK_SECRET — never logged or returned.
 * - Buffers must be the same length for timingSafeEqual, handled explicitly.
 *
 * DEV bypass: set GITHUB_WEBHOOK_DEV_BYPASS=true to skip verification in development.
 *   This is gated on NODE_ENV !== "production" and is never allowed in prod.
 */
export function verifyGitHubWebhookSignature(
  rawBody: string,
  signatureHeader: string | null
): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!secret) {
    if (
      process.env.NODE_ENV !== "production" &&
      process.env.GITHUB_WEBHOOK_DEV_BYPASS === "true"
    ) {
      console.warn(
        "[GitHub Webhook] ⚠️  DEV BYPASS: signature verification skipped. " +
          "Remove GITHUB_WEBHOOK_DEV_BYPASS before deploying."
      );
      return true;
    }
    // No secret and no bypass → reject
    return false;
  }

  if (!signatureHeader) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;

  const expected = `sha256=${createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex")}`;

  try {
    const received = Buffer.from(signatureHeader);
    const computed = Buffer.from(expected);
    // Different lengths → definitely not equal; avoids timingSafeEqual length requirement
    if (received.length !== computed.length) return false;
    return timingSafeEqual(received, computed);
  } catch {
    return false;
  }
}
