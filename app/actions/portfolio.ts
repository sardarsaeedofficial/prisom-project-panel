"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentWorkspaceId, getCurrentUser } from "@/lib/current-workspace";
import { slugify } from "@/lib/utils";

// ── Schema ────────────────────────────────────────────────────────────────────

const createSchema = z.object({
  title: z.string().min(1, "Title is required").max(100, "Title too long"),
  description: z.string().max(1000, "Description too long").optional().or(z.literal("")),
  liveUrl: z
    .string()
    .url("Must be a valid URL")
    .optional()
    .or(z.literal("")),
  githubUrl: z
    .string()
    .url("Must be a valid URL")
    .optional()
    .or(z.literal("")),
  tags: z.string().max(300, "Too many tags").optional().or(z.literal("")),
  featured: z.string().optional(), // checkbox sends "on" when checked
});

// ── Types ─────────────────────────────────────────────────────────────────────

export type PortfolioFormState = {
  success?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

// ── Actions ───────────────────────────────────────────────────────────────────

export async function createPortfolioItemAction(
  _prevState: PortfolioFormState,
  formData: FormData
): Promise<PortfolioFormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = createSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const d = parsed.data;

  try {
    const [workspaceId, user] = await Promise.all([
      getCurrentWorkspaceId(),
      getCurrentUser(),
    ]);

    // Generate a unique slug from the title
    let slug = slugify(d.title);
    if (!slug) slug = `item-${Date.now()}`;

    // Append timestamp if slug already exists to ensure uniqueness
    const existing = await db.portfolioItem.findFirst({
      where: { workspaceId, slug },
      select: { id: true },
    });
    if (existing) slug = `${slug}-${Date.now()}`;

    const tags = d.tags
      ? d.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    await db.portfolioItem.create({
      data: {
        workspaceId,
        userId: user.id,
        title: d.title,
        slug,
        description: d.description || null,
        liveUrl: d.liveUrl || null,
        githubUrl: d.githubUrl || null,
        tags,
        featured: d.featured === "on",
      },
    });

    revalidatePath("/portfolio");
    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create portfolio item.";
    return { error: msg };
  }
}

export async function deletePortfolioItemAction(id: string): Promise<void> {
  const workspaceId = await getCurrentWorkspaceId();
  // Scope the delete to the current workspace to prevent IDOR
  await db.portfolioItem.deleteMany({ where: { id, workspaceId } });
  revalidatePath("/portfolio");
}
