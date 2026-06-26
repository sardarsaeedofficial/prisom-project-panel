export type HelpSopAudience =
  | "admin"
  | "operator"
  | "developer"
  | "client";

export type HelpSopCategory =
  | "daily_ops"
  | "deployment"
  | "launch"
  | "rollback"
  | "monitoring"
  | "logs"
  | "backups"
  | "help_center"
  | "sardar"
  | "security"
  | "troubleshooting";

export type HelpSop = {
  id: string;
  title: string;
  audience: HelpSopAudience;
  category: HelpSopCategory;
  summary: string;
  whenToUse: string[];
  steps: string[];
  commands: string[];
  safetyNotes: string[];
  relatedPages: string[];
  relatedExports: string[];
};

export type HelpSopLibrary = {
  projectId: string;
  generatedAt: string;
  sops: HelpSop[];
  warnings: string[];
};
