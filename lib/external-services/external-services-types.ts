/**
 * lib/external-services/external-services-types.ts
 *
 * Sprint 54: Types for the External Services Readiness system.
 * Pure types — no imports, no side effects.
 *
 * Safety rules:
 *  - no secret values in any type
 *  - status shows Configured / Missing / Placeholder / Suspicious only
 *  - never return raw secret values from any function
 */

export type ExternalServiceStatus =
  | "ready"
  | "warning"
  | "blocked"
  | "unknown";

export type ExternalServiceProvider =
  | "stripe"
  | "cloudinary"
  | "email"
  | "webhook"
  | "manual";

export type SecretPresenceStatus =
  | "configured"
  | "missing"
  | "placeholder"
  | "suspicious"
  | "unknown";

export type ExternalServiceCheck = {
  id:        string;
  provider:  ExternalServiceProvider;
  label:     string;
  status:    "pass" | "warning" | "fail" | "manual";
  required:  boolean;
  message:   string;
  evidence?: string[];
  linkHref?: string;
  command?:  string;
};

export type ExternalServiceReadinessReport = {
  projectId:   string;
  generatedAt: string;
  status:      ExternalServiceStatus;
  checks:      ExternalServiceCheck[];
  blockers:    string[];
  warnings:    string[];
  nextSteps:   string[];
  summary: {
    total:    number;
    passed:   number;
    warnings: number;
    failed:   number;
    manual:   number;
  };
};

export type ServiceKeyStatus = {
  name:   string;
  status: SecretPresenceStatus;
};

export type StripeReadiness = {
  secretKey:      ServiceKeyStatus;
  publishableKey: ServiceKeyStatus;
  webhookSecret:  ServiceKeyStatus;
  modeWarning?:   string;
};

export type CloudinaryReadiness = {
  cloudName:  ServiceKeyStatus;
  apiKey:     ServiceKeyStatus;
  apiSecret:  ServiceKeyStatus;
};

export type EmailReadiness = {
  provider:    "resend" | "sendgrid" | "smtp" | "unknown";
  senderFrom:  ServiceKeyStatus | null;
  apiKey:      ServiceKeyStatus | null;
  smtpHost?:   ServiceKeyStatus;
  smtpUser?:   ServiceKeyStatus;
};

export type AppUrlReadiness = {
  appUrl:    ServiceKeyStatus | null;
  matches:   boolean | null;
  domain:    string | null;
  localhost: boolean;
};
