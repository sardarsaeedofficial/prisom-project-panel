export type HelpProjectMapNodeKind =
  | "page"
  | "component"
  | "server_action"
  | "library"
  | "export"
  | "route"
  | "service"
  | "config"
  | "schema"
  | "unknown";

export type HelpProjectMapNode = {
  id: string;
  kind: HelpProjectMapNodeKind;
  label: string;
  path?: string;
  summary: string;
  relatedPaths: string[];
  keywords: string[];
  safetyNotes: string[];
};

export type HelpProjectMapEdge = {
  from: string;
  to: string;
  relationship:
    | "imports"
    | "renders"
    | "calls_action"
    | "generates_export"
    | "uses_library"
    | "links_to"
    | "documents"
    | "unknown";
  evidence?: string;
};

export type HelpProjectDeepMap = {
  projectId: string;
  generatedAt: string;
  nodes: HelpProjectMapNode[];
  edges: HelpProjectMapEdge[];
  routeMap: Array<{
    route: string;
    pagePath: string;
    panels: string[];
    actions: string[];
    exports: string[];
  }>;
  actionMap: Array<{
    actionFile: string;
    actions: string[];
    permissions: string[];
    auditEvents: string[];
    exportsGenerated: string[];
  }>;
  exportMap: Array<{
    filename: string;
    sourcePath: string;
    purpose: string;
    relatedPanels: string[];
  }>;
  warnings: string[];
};
