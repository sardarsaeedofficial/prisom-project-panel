export type HelpTroubleshootingPlaybook = {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  symptoms: string[];
  likelyCauses: string[];
  checks: string[];
  commands: string[];
  safeFixes: string[];
  unsafeFixes: string[];
  escalation: string[];
  relatedPages: string[];
  relatedExports: string[];
};

export type HelpTroubleshootingLibrary = {
  projectId: string;
  generatedAt: string;
  playbooks: HelpTroubleshootingPlaybook[];
  warnings: string[];
};
