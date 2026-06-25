/**
 * lib/ecommerce/ecommerce-test-types.ts
 *
 * Sprint 62: Type definitions for the Sardar Ecommerce Test Harness.
 *
 * Safety: these types describe test-mode / staging checks only.
 * No real charges, no production orders, no secrets.
 */

export type EcommerceTestStatus =
  | "not_started"
  | "ready"
  | "warning"
  | "blocked"
  | "running"
  | "passed"
  | "failed"
  | "complete"
  | "unknown";

export type EcommerceTestCategory =
  | "storefront"
  | "products"
  | "cart"
  | "checkout"
  | "stripe"
  | "webhooks"
  | "orders"
  | "email"
  | "cloudinary"
  | "admin"
  | "database"
  | "security"
  | "manual";

export type EcommerceTestCheck = {
  id:                   string;
  category:             EcommerceTestCategory;
  label:                string;
  status:               "pass" | "warning" | "fail" | "manual" | "pending";
  required:             boolean;
  message:              string;
  evidence?:            string[];
  linkHref?:            string;
  command?:             string;
  warning?:             string;
  confirmationRequired?: string;
};

export type EcommerceTestReport = {
  projectId:    string;
  generatedAt:  string;
  status:       EcommerceTestStatus;
  targetDomain: string;
  checks:       EcommerceTestCheck[];
  blockers:     string[];
  warnings:     string[];
  nextSteps:    string[];
  summary: {
    total:    number;
    passed:   number;
    warnings: number;
    failed:   number;
    manual:   number;
    pending:  number;
  };
};

export type EcommerceSmokeCheckResult = {
  id:          string;
  label:       string;
  url:         string;
  status:      "pass" | "warning" | "fail";
  httpStatus?: number;
  message:     string;
  evidence?:   string[];
};

export type EcommerceSmokeReport = {
  projectId:    string;
  generatedAt:  string;
  targetDomain: string;
  status:       "passed" | "warning" | "failed";
  results:      EcommerceSmokeCheckResult[];
  warnings:     string[];
};
