"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { linkDetectedRepositoryToProjectAction } from "@/app/actions/github";

type Project = { id: string; name: string };

interface LinkRepoFormProps {
  detectedRepositoryId: string;
  existingProjects: Project[];
}

/**
 * Inline expand/collapse form that lets the user link a detected repository
 * to an existing Prisom project (instead of importing as a new project).
 */
export function LinkRepoForm({
  detectedRepositoryId,
  existingProjects,
}: LinkRepoFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Nothing to show if there are no projects without a repo
  if (existingProjects.length === 0) return null;

  const handleLink = () => {
    if (!selectedProjectId) return;
    setError(null);
    startTransition(async () => {
      const result = await linkDetectedRepositoryToProjectAction(
        detectedRepositoryId,
        selectedProjectId
      );
      if (result?.error) {
        setError(result.error);
      } else {
        // Server action revalidated paths; refresh the RSC tree
        router.refresh();
        setOpen(false);
      }
    });
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-xs gap-1.5 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Link2 className="h-3.5 w-3.5" />
        Link to project
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring min-w-[160px]"
          disabled={isPending}
        >
          <option value="">Select project…</option>
          {existingProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={handleLink}
          disabled={!selectedProjectId || isPending}
          type="button"
        >
          {isPending ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : null}
          Link
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            setOpen(false);
            setError(null);
            setSelectedProjectId("");
          }}
          type="button"
        >
          Cancel
        </Button>
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
