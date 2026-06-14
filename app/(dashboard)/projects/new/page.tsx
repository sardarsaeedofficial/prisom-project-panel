import type { Metadata } from "next";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { CreateProjectForm } from "@/components/projects/create-project-form";

export const metadata: Metadata = { title: "New Project" };

export default function NewProjectPage() {
  return (
    <DashboardShell>
      <CreateProjectForm />
    </DashboardShell>
  );
}
