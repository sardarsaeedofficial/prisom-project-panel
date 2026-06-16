"use client";

/**
 * components/projects/payment-webhook-checklist.tsx
 *
 * Stripe payment / webhook migration checklist for Replit → Prisom imports.
 * Shown when the project has any STRIPE_* env vars.
 */

import { useState } from "react";
import {
  CreditCard,
  CheckCircle2,
  Circle,
  ExternalLink,
  AlertTriangle,
  Copy,
  CheckCheck,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

interface Props {
  domain:         string | null;   // live domain (e.g. "myapp.doorstepmanchester.uk")
  hasStripeVars:  boolean;         // whether any STRIPE_* vars are present
  envVarNames:    string[];        // all env var names for this project
}

export function PaymentWebhookChecklist({ domain, hasStripeVars, envVarNames }: Props) {
  const [copiedUrl, setCopiedUrl] = useState(false);

  if (!hasStripeVars) return null;

  const webhookUrl   = domain ? `https://${domain}/api/webhooks/stripe` : null;
  const hasSecretKey = envVarNames.includes("STRIPE_SECRET_KEY");
  const hasWebhookSecret = envVarNames.includes("STRIPE_WEBHOOK_SECRET");
  const hasPubKey    = envVarNames.includes("STRIPE_PUBLISHABLE_KEY") ||
                       envVarNames.includes("VITE_STRIPE_PUBLISHABLE_KEY");

  const steps = [
    {
      id:   "secret_key",
      done: hasSecretKey,
      text: "STRIPE_SECRET_KEY added to env vars",
      help: "Copy from Stripe Dashboard → Developers → API Keys → Secret key",
    },
    {
      id:   "pub_key",
      done: hasPubKey,
      text: "STRIPE_PUBLISHABLE_KEY (or VITE_STRIPE_PUBLISHABLE_KEY) added",
      help: "Public key for frontend — safe to expose, but store in env vars for easy rotation.",
    },
    {
      id:   "webhook_secret",
      done: hasWebhookSecret,
      text: "STRIPE_WEBHOOK_SECRET added to env vars",
      help: "Create a new webhook endpoint in Stripe pointing to your Prisom domain.",
    },
    {
      id:   "domain",
      done: !!domain,
      text: "Domain published and live",
      help: "Publish a domain on the Domains tab before creating the Stripe webhook.",
    },
    {
      id:   "webhook_updated",
      done: false,
      text: `Update Stripe webhook URL from Replit to: ${webhookUrl ?? "<publish domain first>"}`,
      help: "Stripe Dashboard → Developers → Webhooks → Edit endpoint → Update URL",
    },
  ];

  return (
    <Card className="border-amber-200 dark:border-amber-800">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          <CardTitle className="text-base text-amber-800 dark:text-amber-300">
            Stripe Payment Migration
          </CardTitle>
        </div>
        <CardDescription>
          This project uses Stripe. Complete these steps to keep payments working after moving off Replit.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Checklist */}
        <ul className="space-y-2">
          {steps.map((step) => (
            <li key={step.id} className="flex items-start gap-2.5">
              {step.done ? (
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              )}
              <div>
                <p className={`text-sm ${step.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                  {step.text}
                </p>
                {!step.done && (
                  <p className="text-xs text-muted-foreground mt-0.5">{step.help}</p>
                )}
              </div>
            </li>
          ))}
        </ul>

        {/* Webhook URL */}
        {webhookUrl && (
          <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5 space-y-1.5">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
              New webhook URL for Stripe dashboard:
            </p>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono text-amber-900 dark:text-amber-200 flex-1 break-all">
                {webhookUrl}
              </code>
              <button
                type="button"
                className="shrink-0 text-amber-600 hover:text-amber-800 transition-colors"
                onClick={() => {
                  void navigator.clipboard.writeText(webhookUrl);
                  setCopiedUrl(true);
                  setTimeout(() => setCopiedUrl(false), 2000);
                }}
              >
                {copiedUrl ? <CheckCheck className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              In Stripe Dashboard: Developers → Webhooks → Edit endpoint → paste URL above.
            </p>
          </div>
        )}

        {/* Warning */}
        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <p>
            Until STRIPE_WEBHOOK_SECRET matches the new endpoint, webhook signature verification
            will fail. Test with{" "}
            <a
              href="https://dashboard.stripe.com/webhooks"
              target="_blank"
              rel="noopener noreferrer"
              className="underline inline-flex items-center gap-0.5"
            >
              Stripe Dashboard <ExternalLink className="h-3 w-3" />
            </a>
            {" "}after updating.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
