/**
 * lib/migration/replit-media-detector.ts
 *
 * Sprint 24: Media/uploads detection and migration plan generation.
 */

import type { MediaDetection, MediaMigrationPlan } from "./replit-detection-types";

// ── Media detection ───────────────────────────────────────────────────────────

export function detectMedia(
  allContent:  string,
  fileList:    string[],
  deps:        Record<string, string>,
): MediaDetection | undefined {
  const hasCloudinary = !!deps["cloudinary"] || !!deps["next-cloudinary"] ||
    allContent.includes("CLOUDINARY_") || allContent.includes("cloudinary");
  const hasS3 = !!deps["@aws-sdk/client-s3"] || !!deps["aws-sdk"] ||
    allContent.includes("AWS_ACCESS_KEY_ID") || allContent.includes("S3_BUCKET");
  const hasR2 = allContent.includes("R2_") || allContent.includes("R2_ACCOUNT_ID") ||
    allContent.includes("R2_BUCKET");
  const hasMulter   = !!deps["multer"] || allContent.includes("multer(");
  const hasFsWrite  = allContent.includes("fs.writeFile") || allContent.includes("fs.createWriteStream");

  // Detect local upload paths
  const localPaths: string[] = [];
  const localDirs = ["public/uploads", "uploads", "public/media", "attached_assets", "videos"];
  for (const dir of localDirs) {
    if (fileList.some((f) => f.startsWith(dir + "/") || f === dir)) {
      localPaths.push(dir);
    }
  }
  // Also check if code references these paths
  if (allContent.includes("/uploads/") || allContent.includes("uploads/")) {
    if (!localPaths.includes("uploads")) localPaths.push("uploads (referenced in code)");
  }
  if (allContent.includes("attached_assets") && !localPaths.includes("attached_assets")) {
    localPaths.push("attached_assets (referenced in code)");
  }

  const hasLocalUploads = localPaths.length > 0 || hasMulter || hasFsWrite;

  if (hasCloudinary) {
    return { provider: "cloudinary", hasLocalUploads, localUploadPaths: localPaths };
  }
  if (hasR2) {
    return { provider: "r2", hasLocalUploads, localUploadPaths: localPaths };
  }
  if (hasS3) {
    return { provider: "s3", hasLocalUploads, localUploadPaths: localPaths };
  }
  if (hasLocalUploads) {
    return { provider: "local", hasLocalUploads: true, localUploadPaths: localPaths };
  }

  return undefined;
}

// ── Migration plan ────────────────────────────────────────────────────────────

export function buildMediaMigrationPlan(media: MediaDetection): MediaMigrationPlan {
  if (media.provider === "cloudinary") {
    return {
      provider:   "Cloudinary",
      isExternal: true,
      steps: [
        "Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to the Secrets Vault.",
        "Media files are already stored externally — no file migration needed.",
        "Test image upload/retrieval after first deploy.",
      ],
      notes: "Cloudinary is external storage. All existing media stays accessible at its current URLs.",
    };
  }

  if (media.provider === "s3") {
    return {
      provider:   "Amazon S3",
      isExternal: true,
      steps: [
        "Add AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, and S3_BUCKET to Secrets Vault.",
        "Media files remain in S3 — no file migration needed.",
        "Verify bucket CORS settings allow requests from your new domain.",
      ],
      notes: "S3 is external storage. All existing media stays accessible.",
    };
  }

  if (media.provider === "r2") {
    return {
      provider:   "Cloudflare R2",
      isExternal: true,
      steps: [
        "Add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET to Secrets Vault.",
        "Media files remain in R2 — no file migration needed.",
        "Ensure R2 public access is configured for your new domain.",
      ],
      notes: "R2 is external storage. All existing media stays accessible.",
    };
  }

  if (media.provider === "local" || media.hasLocalUploads) {
    const uploadDirs = media.localUploadPaths.length > 0
      ? media.localUploadPaths.join(", ")
      : "uploads/";
    return {
      provider:   "Local filesystem",
      isExternal: false,
      steps: [
        `Identify upload directories: ${uploadDirs}`,
        "Export/download these directories from Replit before deletion.",
        "Import them to the project storage on VPS (via Import tab or SCP).",
        "For new uploads, consider migrating to Cloudinary or S3 to avoid disk-space issues.",
        "Ensure the uploads path is consistent between Replit and VPS (use env var UPLOAD_DIR if possible).",
      ],
      notes: "Local file storage is not recommended for PM2/multi-process deployments. Files written by one process may not be visible to others. Consider object storage.",
    };
  }

  return {
    provider:   "None detected",
    isExternal: false,
    steps:      ["No media storage detected. No action required."],
    notes:      "",
  };
}
