import { db }             from "@/lib/db";
import { isSardarProject } from "@/lib/migration/sardar-migration-types";
import type {
  PostLaunchIssueTemplate,
  PostLaunchBugCaptureReport,
} from "./post-launch-bug-types";

export async function generatePostLaunchBugCaptureReport(input: {
  projectId: string;
}): Promise<PostLaunchBugCaptureReport> {
  const { projectId } = input;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, slug: true },
  });

  const domains = project
    ? await db.domain.findMany({
        where:  { projectId },
        select: { hostname: true, isPrimary: true },
      })
    : [];

  const isSardar = project
    ? (isSardarProject(project.name) || isSardarProject(project.slug ?? ""))
    : false;
  const domain = domains.find((d) => d.isPrimary)?.hostname
    ?? domains[0]?.hostname
    ?? "<domain>";

  const issueTemplates: PostLaunchIssueTemplate[] = [
    // ── critical ──────────────────────────────────────────────────────────────
    {
      id:       "site-down",
      severity: "critical",
      category: "availability",
      title:    "Site is down / returning 5xx",
      description:
        "The production domain is not responding or returning 500/502/503 errors.",
      evidenceToCollect: [
        `curl -I https://${domain}/ — capture HTTP status code`,
        "PM2 status output",
        "nginx error log snippet (sudo tail -50 /var/log/nginx/error.log)",
        "PM2 logs for the project process",
      ],
      immediateChecks: [
        "pm2 status — confirm process is running",
        "sudo nginx -t — confirm nginx config is valid",
        `curl -I https://${domain}/api/healthz — check health endpoint`,
        "sudo tail -50 /var/log/nginx/error.log",
      ],
      escalationRule: "Escalate immediately if site is down > 2 minutes. Initiate rollback if down > 5 minutes.",
    },
    {
      id:       "health-failing",
      severity: "critical",
      category: "availability",
      title:    "Health endpoint returning non-200",
      description: `https://${domain}/api/healthz is not returning 200.`,
      evidenceToCollect: [
        `curl -I https://${domain}/api/healthz — capture response`,
        "PM2 log output for the project process",
      ],
      immediateChecks: [
        `curl -v https://${domain}/api/healthz`,
        "pm2 logs --lines 30",
        "Check DB connectivity if health check includes DB ping",
      ],
      escalationRule: "Escalate if health endpoint is not recovering within 3 minutes.",
    },
    // ── checkout/payments (Sardar) ─────────────────────────────────────────
    {
      id:       "checkout-failing",
      severity: "critical",
      category: "checkout",
      title:    "Checkout flow is broken",
      description: "The checkout page or payment step is returning errors or not completing.",
      evidenceToCollect: [
        "Browser console errors screenshot",
        "Network tab showing failed API calls",
        "Stripe dashboard — check if payment attempt was created",
      ],
      immediateChecks: [
        "Open checkout page in browser and note exact error",
        "Check Stripe dashboard for any failed payment intents",
        "Check server logs for checkout-related errors",
        "Confirm STRIPE_SECRET_KEY env var is set to the live key",
      ],
      escalationRule:
        "Critical if checkout is completely broken. Escalate immediately — do not attempt code changes without approval.",
    },
    {
      id:       "stripe-webhook-failing",
      severity: "high",
      category: "payments",
      title:    "Stripe webhook not being received",
      description: "Order confirmations or payment events are not triggering correctly after payment.",
      evidenceToCollect: [
        "Stripe dashboard → Webhooks → check for failed deliveries",
        "Server logs for webhook endpoint hits",
      ],
      immediateChecks: [
        "Check Stripe dashboard webhook logs for delivery failures",
        "Confirm STRIPE_WEBHOOK_SECRET env var matches the live webhook secret",
        `Confirm webhook endpoint is accessible: curl -I https://${domain}/api/webhooks/stripe`,
      ],
      escalationRule: "Escalate if webhooks have been failing for > 10 minutes. Do not change secrets without approval.",
    },
    // ── orders ─────────────────────────────────────────────────────────────
    {
      id:       "order-confirmation-missing",
      severity: "high",
      category: "orders",
      title:    "Order confirmation emails not sending",
      description: "Customers are not receiving order confirmation emails after payment.",
      evidenceToCollect: [
        "Check email provider dashboard (Resend / SMTP) for failed sends",
        "Test order ID that should have triggered confirmation",
      ],
      immediateChecks: [
        "Confirm EMAIL_FROM / RESEND_API_KEY env var is set correctly",
        "Check email provider dashboard for failed deliveries",
        "Check server logs for email send errors",
      ],
      escalationRule: "Escalate if email sending is completely broken. Check env vars before any code change.",
    },
    // ── content ──────────────────────────────────────────────────────────────
    {
      id:       "product-images-missing",
      severity: "medium",
      category: "content",
      title:    "Product images not loading",
      description: "Images on product pages are broken or returning 404.",
      evidenceToCollect: [
        "Browser network tab screenshot showing failed image requests",
        "Example URL of a failing image",
      ],
      immediateChecks: [
        "Check if images are stored in Cloudinary/S3 or served locally",
        "Confirm CLOUDINARY_URL / AWS credentials env vars are set",
        "Check if the image paths are correct for the production domain",
      ],
      escalationRule: "Medium severity. Escalate if > 50% of product images are missing.",
    },
    // ── admin ─────────────────────────────────────────────────────────────
    {
      id:       "admin-login-issue",
      severity: "high",
      category: "admin",
      title:    "Admin login is not working",
      description: "Administrators cannot log into the backend admin panel.",
      evidenceToCollect: [
        "Browser console errors on login page",
        "Server logs for auth errors",
      ],
      immediateChecks: [
        "Confirm NEXTAUTH_SECRET / AUTH_SECRET env var is set",
        "Confirm NEXTAUTH_URL is set to the production domain",
        "Check server logs for session/auth errors",
      ],
      escalationRule: "Escalate if admin login is completely broken. Do not change auth secrets without approval.",
    },
    // ── routing ───────────────────────────────────────────────────────────
    {
      id:       "404-route-issue",
      severity: "medium",
      category: "routing",
      title:    "Key routes returning 404",
      description: "Important pages (shop, product, checkout) are returning 404 not found.",
      evidenceToCollect: [
        "URL of affected route",
        "Expected vs. actual HTTP response",
      ],
      immediateChecks: [
        "sudo nginx -t — confirm nginx config is valid",
        `curl -I https://${domain}/shop — confirm shop route`,
        "Check if the Next.js app is running on the correct port",
      ],
      escalationRule: "Escalate if checkout or payment routes are returning 404.",
    },
    // ── performance ───────────────────────────────────────────────────────
    {
      id:       "slow-page-load",
      severity: "medium",
      category: "performance",
      title:    "Pages loading very slowly (> 5s)",
      description: "Production pages are taking more than 5 seconds to load.",
      evidenceToCollect: [
        "Browser DevTools Network tab waterfall screenshot",
        "Specific slow pages",
      ],
      immediateChecks: [
        "Check PM2 CPU/memory usage: pm2 monit",
        "Check if DB queries are blocking: review server logs",
        "Check if static assets are being served correctly",
      ],
      escalationRule: "Monitor first. Escalate if load time exceeds 10 seconds or causes checkout failure.",
    },
    // ── email ─────────────────────────────────────────────────────────────
    {
      id:       "email-delivery-issue",
      severity: "medium",
      category: "email",
      title:    "Transactional emails not delivering",
      description: "Emails are being sent but not received by users.",
      evidenceToCollect: [
        "Email provider dashboard delivery logs",
        "Recipient email address and expected email type",
      ],
      immediateChecks: [
        "Check email provider dashboard for bounce/spam classification",
        "Confirm SPF/DKIM records are set on the sending domain",
        "Test with a known-good email address",
      ],
      escalationRule: "Escalate if all transactional emails are failing. Check DNS records before any config change.",
    },
    // ── logs ─────────────────────────────────────────────────────────────
    {
      id:       "log-noise-burst",
      severity: "low",
      category: "logs",
      title:    "Unexpected warning burst in logs",
      description: "PM2 or nginx logs are showing a high volume of warnings or non-critical errors.",
      evidenceToCollect: [
        "Log snippet showing the repeating warning pattern",
        "Approximate start time of the burst",
      ],
      immediateChecks: [
        "pm2 logs --lines 100 — identify the repeating pattern",
        "sudo tail -100 /var/log/nginx/error.log",
        "Determine if the warnings are actionable or expected startup noise",
      ],
      escalationRule: "Low severity unless warnings indicate DB or auth failures. Monitor and note pattern.",
    },
    // ── content (wrong pricing) ───────────────────────────────────────────
    {
      id:       "wrong-content-pricing",
      severity: "medium",
      category: "content",
      title:    "Wrong content or pricing displayed",
      description: "Product prices, descriptions, or other content do not match what was expected.",
      evidenceToCollect: [
        "Screenshot of affected page with wrong content",
        "Expected value vs. actual value",
      ],
      immediateChecks: [
        "Check if the DB has the correct data (admin panel)",
        "Confirm the correct DB is being used (production vs. staging)",
        "Check if content is cached and needs a cache bust",
      ],
      escalationRule: "Escalate if wrong pricing is causing financial impact. Do not update pricing in code without approval.",
    },
  ];

  const triageRules = [
    "Critical: site down, checkout broken, health endpoint failing → escalate immediately.",
    "High: payments failing, admin login broken, order confirmation missing → fix within 30 min.",
    "Medium: images missing, 404 routes, slow load, email delivery → fix within same day.",
    "Low: log noise, cosmetic issues → log and fix in next deploy.",
    "Never change secrets, DB connections, or nginx config without operator approval.",
    "Always collect evidence before attempting a fix.",
    "Roll back before trying to fix-forward if the issue is critical and time-sensitive.",
  ];

  const immediateFixAllowed = [
    "Copy fixes that don't affect business logic",
    "Broken internal link fixes",
    "Missing static asset path corrections (not DB changes)",
    "Log verbosity adjustments",
    "Environment variable value corrections (with approval)",
  ];

  const changesRequiringApproval = [
    "Any DB schema or data change",
    "Stripe or payment provider configuration",
    "Secret / env var rotations",
    "nginx or PM2 configuration changes",
    "New feature deployments",
    "DNS changes",
    "Auth/session configuration changes",
  ];

  const recommendedNextSteps = [
    "Identify the severity and category of each issue.",
    "Collect required evidence before attempting a fix.",
    "For critical issues: escalate and consider rollback if not resolved in 5 minutes.",
    "For all changes requiring approval: notify the operator/client before proceeding.",
    "Export POST_LAUNCH_BUG_CAPTURE.md for handover documentation.",
  ];

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    issueTemplates: isSardar
      ? issueTemplates
      : issueTemplates.filter((t) => !["checkout-failing", "stripe-webhook-failing"].includes(t.id)),
    triageRules,
    immediateFixAllowed,
    changesRequiringApproval,
    recommendedNextSteps,
  };
}
