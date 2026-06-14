"use client";

import { useEffect } from "react";
import { markProjectOpenedAction } from "@/app/actions/projects";

export function MarkOpened({ projectId }: { projectId: string }) {
  useEffect(() => {
    markProjectOpenedAction(projectId);
  }, [projectId]);
  return null;
}
