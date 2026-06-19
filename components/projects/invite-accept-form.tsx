"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { acceptProjectInviteAction } from "@/app/actions/project-team";
import { CheckCircle, Loader2, XCircle } from "lucide-react";

type Props = {
  token:       string;
  projectName: string;
  projectSlug: string;
  projectId:   string;
  expiresAt:   string;
};

export function InviteAcceptForm({
  token,
  projectName,
  projectId,
  expiresAt,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const expiryDate = new Date(expiresAt);
  const daysLeft   = Math.max(
    0,
    Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  );

  async function handleAccept() {
    setStatus("loading");
    setErrorMsg("");
    try {
      const result = await acceptProjectInviteAction(token);
      if (result.ok) {
        setStatus("success");
        // Brief pause so the user sees the success state, then redirect
        setTimeout(() => {
          router.push(`/projects/${result.data.projectId}/settings`);
        }, 1500);
      } else {
        setStatus("error");
        setErrorMsg(result.error);
      }
    } catch {
      setStatus("error");
      setErrorMsg("An unexpected error occurred. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md bg-green-50 border border-green-200 px-4 py-6 text-center">
        <CheckCircle className="h-8 w-8 text-green-600" />
        <div>
          <p className="text-sm font-medium text-green-800">
            You have joined <strong>{projectName}</strong>!
          </p>
          <p className="text-xs text-green-700 mt-1">Redirecting to project…</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setStatus("idle"); setErrorMsg(""); }}
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        This invite expires in{" "}
        <strong>{daysLeft === 1 ? "1 day" : `${daysLeft} days`}</strong>{" "}
        ({expiryDate.toLocaleDateString()}).
      </p>
      <Button
        onClick={handleAccept}
        disabled={status === "loading"}
        className="w-full"
      >
        {status === "loading" && (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        )}
        {status === "loading" ? "Accepting…" : `Accept invitation to ${projectName}`}
      </Button>
    </div>
  );
}
