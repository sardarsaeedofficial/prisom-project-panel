export type HelpFileCategory =
  | "page"
  | "component"
  | "server_action"
  | "library"
  | "schema"
  | "config"
  | "script"
  | "export"
  | "style"
  | "test"
  | "unknown";

export type HelpFileInventoryItem = {
  path: string;
  category: HelpFileCategory;
  language: "typescript" | "tsx" | "javascript" | "json" | "markdown" | "css" | "prisma" | "shell" | "unknown";
  sizeBytes?: number;
  summary: string;
  importantExports: string[];
  importantImports: string[];
  routes?: string[];
  actions?: string[];
  safetyNotes: string[];
};

export type HelpKnowledgeSection = {
  id: string;
  title: string;
  category:
    | "overview"
    | "architecture"
    | "file_inventory"
    | "routes"
    | "server_actions"
    | "components"
    | "exports"
    | "commands"
    | "resources"
    | "languages"
    | "safety"
    | "deployment"
    | "sardar"
    | "troubleshooting";
  content: string;
  sourcePaths: string[];
  keywords: string[];
};

export type HelpSearchResult = {
  sectionId: string;
  title: string;
  category: HelpKnowledgeSection["category"];
  snippet: string;
  score: number;
  sourcePaths: string[];
};

export type HelpAnswer = {
  question: string;
  answer: string;
  confidence: "high" | "medium" | "low";
  matchedSections: HelpSearchResult[];
  missingInformation: string[];
  safetyNotes: string[];
};

export type ProjectHelpCenterReport = {
  projectId: string;
  generatedAt: string;
  fileCount: number;
  languages: Record<string, number>;
  frameworks: string[];
  resources: string[];
  sections: HelpKnowledgeSection[];
  inventory: HelpFileInventoryItem[];
  warnings: string[];
  excludedPaths: string[];
};
