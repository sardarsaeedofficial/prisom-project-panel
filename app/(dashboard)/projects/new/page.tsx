import type { Metadata } from "next";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { CreateProjectForm } from "@/components/projects/create-project-form";
import { ProjectTemplateSelector } from "@/components/projects/project-template-selector";

export const metadata: Metadata = { title: "New Project" };

export default function NewProjectPage() {
  const aiAvailable = !!process.env.ANTHROPIC_API_KEY;

  return (
    <DashboardShell>
      <CreateProjectForm aiAvailable={aiAvailable} />

      {/* Sprint 72: Migration template reference — no projectId, standalone guidance */}
      <div className="max-w-3xl mt-8">
        <ProjectTemplateSelector />
      </div>
    </DashboardShell>
  );
}
