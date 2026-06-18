"use client";

/**
 * components/projects/database-explorer-panel.tsx
 *
 * Sprint 12: Safe read-only database explorer panel.
 *
 * Features:
 *  - Environment selector (production / preview / development)
 *  - Connection status + metadata (never shows DATABASE_URL)
 *  - Schema / table tree
 *  - Table detail (columns, indexes, estimated rows)
 *  - Sample rows with pagination
 *  - Safe read-only SQL query runner with LIMIT injection warning
 *  - CSV export (optional)
 *
 * Safety: All queries go through server actions which run validateReadOnlySql.
 *         Raw HTML from DB values is never rendered.
 */

import { useState, useCallback, useTransition } from "react";
import {
  Database,
  Table2,
  Eye,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Play,
  Download,
  Copy,
  Check,
  Info,
  Key,
  Server,
} from "lucide-react";

import {
  getProjectDbConnectionAction,
  listProjectDbSchemasAction,
  getProjectDbTableDetailAction,
  getProjectDbTableRowsAction,
  runProjectReadOnlyQueryAction,
  type DbExplorerConnectionInfo,
  type DbSchemaInfo,
  type DbTableDetail,
  type DbQueryResult,
} from "@/app/actions/project-database-explorer";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ENVIRONMENTS = ["production", "preview", "development"] as const;
type Env = (typeof ENVIRONMENTS)[number];

const LIMIT_OPTIONS = [50, 100, 250, 500] as const;

function CellValue({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(false);

  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/50 italic text-xs">NULL</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className={`font-mono text-xs font-semibold ${value ? "text-green-600" : "text-red-500"}`}>
        {String(value)}
      </span>
    );
  }

  const str = String(value);
  const MAX_DISPLAY = 300;

  if (str.length <= MAX_DISPLAY) {
    return <span className="font-mono text-xs break-all">{str}</span>;
  }

  return (
    <span className="font-mono text-xs break-all">
      {expanded ? str : str.slice(0, MAX_DISPLAY) + "…"}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="ml-1 text-primary underline text-[10px]"
      >
        {expanded ? "less" : "more"}
      </button>
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted transition-colors shrink-0"
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
    </button>
  );
}

function ResultTable({ result }: { result: DbQueryResult }) {
  if (result.columns.length === 0 || result.rows.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
        Query returned no rows.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border rounded">
      <table className="text-xs w-full border-collapse">
        <thead>
          <tr className="bg-muted/50">
            {result.columns.map((col) => (
              <th
                key={col}
                className="px-3 py-1.5 text-left font-semibold text-foreground border-b whitespace-nowrap"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? "bg-background" : "bg-muted/20"}>
              {result.columns.map((col) => (
                <td key={col} className="px-3 py-1 border-b align-top max-w-[300px]">
                  <CellValue value={row[col]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function exportCsv(result: DbQueryResult, filename: string) {
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const header = result.columns.map(escape).join(",");
  const lines  = result.rows.map((row) =>
    result.columns.map((c) => escape(row[c])).join(","),
  );
  const csv  = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main component ────────────────────────────────────────────────────────────

export function DatabaseExplorerPanel({ projectId }: Props) {
  // ── Env + connection ─────────────────────────────────────────────────────
  const [env,        setEnv]        = useState<Env>("production");
  const [connInfo,   setConnInfo]   = useState<DbExplorerConnectionInfo | null>(null);
  const [connError,  setConnError]  = useState<string | null>(null);
  const [connLoading, setConnLoading] = useState(false);

  // ── Schema tree ──────────────────────────────────────────────────────────
  const [schemas,       setSchemas]       = useState<DbSchemaInfo[]>([]);
  const [schemasLoaded, setSchemasLoaded] = useState(false);
  const [schemasError,  setSchemasError]  = useState<string | null>(null);
  const [schemasLoading, setSchemasLoading] = useState(false);
  const [collapsedSchemas, setCollapsedSchemas] = useState<Set<string>>(new Set());

  // ── Selected table ───────────────────────────────────────────────────────
  const [selectedSchema, setSelectedSchema] = useState<string | null>(null);
  const [selectedTable,  setSelectedTable]  = useState<string | null>(null);
  const [tableDetail,    setTableDetail]    = useState<DbTableDetail | null>(null);
  const [tableDetailError, setTableDetailError] = useState<string | null>(null);
  const [tableDetailLoading, setTableDetailLoading] = useState(false);

  // ── Sample rows ──────────────────────────────────────────────────────────
  const [sampleRows,   setSampleRows]   = useState<DbQueryResult | null>(null);
  const [sampleError,  setSampleError]  = useState<string | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [sampleOffset, setSampleOffset] = useState(0);
  const [sampleLimit,  setSampleLimit]  = useState<(typeof LIMIT_OPTIONS)[number]>(50);

  // ── Query runner ─────────────────────────────────────────────────────────
  const [queryText,    setQueryText]    = useState("");
  const [queryLimit,   setQueryLimit]   = useState<(typeof LIMIT_OPTIONS)[number]>(100);
  const [queryResult,  setQueryResult]  = useState<DbQueryResult | null>(null);
  const [queryError,   setQueryError]   = useState<string | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);

  const [, startTransition] = useTransition();

  // ── Connect ───────────────────────────────────────────────────────────────

  const handleConnect = useCallback(() => {
    setConnLoading(true);
    setConnError(null);
    startTransition(async () => {
      const res = await getProjectDbConnectionAction(projectId, env);
      setConnLoading(false);
      if (res.ok) {
        setConnInfo(res.data);
        if (!res.data.connected) {
          setConnError(res.data.error ?? "Connection failed.");
        } else {
          setConnError(null);
        }
      } else {
        setConnInfo(null);
        setConnError(res.error);
      }
    });
  }, [projectId, env]);

  // ── Load schemas ──────────────────────────────────────────────────────────

  const handleLoadSchemas = useCallback(() => {
    setSchemasLoading(true);
    setSchemasError(null);
    startTransition(async () => {
      const res = await listProjectDbSchemasAction(projectId, env);
      setSchemasLoading(false);
      setSchemasLoaded(true);
      if (res.ok) {
        setSchemas(res.data);
      } else {
        setSchemasError(res.error);
      }
    });
  }, [projectId, env]);

  // ── Select table ──────────────────────────────────────────────────────────

  const handleSelectTable = useCallback((schema: string, table: string) => {
    setSelectedSchema(schema);
    setSelectedTable(table);
    setTableDetail(null);
    setTableDetailError(null);
    setSampleRows(null);
    setSampleError(null);
    setSampleOffset(0);
    setTableDetailLoading(true);
    setSampleLoading(true);

    startTransition(async () => {
      const [detailRes, rowsRes] = await Promise.all([
        getProjectDbTableDetailAction({ projectId, environment: env, schema, table }),
        getProjectDbTableRowsAction({ projectId, environment: env, schema, table, limit: sampleLimit, offset: 0 }),
      ]);
      setTableDetailLoading(false);
      setSampleLoading(false);

      if (detailRes.ok) setTableDetail(detailRes.data);
      else setTableDetailError(detailRes.error);

      if (rowsRes.ok) setSampleRows(rowsRes.data);
      else setSampleError(rowsRes.error);
    });
  }, [projectId, env, sampleLimit]);

  // ── Paginate sample rows ──────────────────────────────────────────────────

  const handleSamplePage = useCallback((newOffset: number) => {
    if (!selectedSchema || !selectedTable) return;
    setSampleOffset(newOffset);
    setSampleLoading(true);
    setSampleError(null);
    startTransition(async () => {
      const res = await getProjectDbTableRowsAction({
        projectId, environment: env,
        schema: selectedSchema, table: selectedTable,
        limit: sampleLimit, offset: newOffset,
      });
      setSampleLoading(false);
      if (res.ok) setSampleRows(res.data);
      else setSampleError(res.error);
    });
  }, [projectId, env, selectedSchema, selectedTable, sampleLimit]);

  // ── Run query ─────────────────────────────────────────────────────────────

  const handleRunQuery = useCallback(() => {
    if (!queryText.trim()) return;
    setQueryLoading(true);
    setQueryError(null);
    setQueryResult(null);
    startTransition(async () => {
      const res = await runProjectReadOnlyQueryAction({
        projectId, environment: env,
        query: queryText, limit: queryLimit,
      });
      setQueryLoading(false);
      if (res.ok) setQueryResult(res.data);
      else setQueryError(res.error);
    });
  }, [projectId, env, queryText, queryLimit]);

  // ── Example queries ───────────────────────────────────────────────────────

  const examples = selectedTable && selectedSchema
    ? [
        `SELECT * FROM "${selectedSchema}"."${selectedTable}" LIMIT 50`,
        `SELECT COUNT(*) FROM "${selectedSchema}"."${selectedTable}"`,
        `SELECT * FROM "${selectedSchema}"."${selectedTable}" ORDER BY 1 DESC LIMIT 50`,
      ]
    : [
        "SELECT 1",
        "SELECT current_database(), current_user, version()",
        "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = 'public' LIMIT 50",
      ];

  // ── Derived state ─────────────────────────────────────────────────────────
  const isConnected = connInfo?.connected === true;

  // ── Toggle schema collapse ────────────────────────────────────────────────
  const toggleSchema = (schema: string) => {
    setCollapsedSchemas((prev) => {
      const next = new Set(prev);
      if (next.has(schema)) next.delete(schema); else next.add(schema);
      return next;
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">Database Explorer</h2>
          {isConnected && (
            <span className="inline-flex items-center gap-1 text-[10px] bg-green-500/10 text-green-600 border border-green-500/20 rounded-full px-2 py-0.5 font-medium">
              <CheckCircle2 className="h-3 w-3" /> Connected
            </span>
          )}
          {connInfo && !isConnected && (
            <span className="inline-flex items-center gap-1 text-[10px] bg-red-500/10 text-red-600 border border-red-500/20 rounded-full px-2 py-0.5 font-medium">
              <XCircle className="h-3 w-3" /> Disconnected
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Environment selector */}
          <select
            value={env}
            onChange={(e) => {
              setEnv(e.target.value as Env);
              setConnInfo(null);
              setSchemas([]);
              setSchemasLoaded(false);
              setSelectedSchema(null);
              setSelectedTable(null);
              setTableDetail(null);
              setSampleRows(null);
              setQueryResult(null);
            }}
            className="text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {ENVIRONMENTS.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>

          <button
            onClick={handleConnect}
            disabled={connLoading}
            className="flex items-center gap-1 text-xs rounded border border-border px-2 py-1 hover:bg-muted transition-colors disabled:opacity-40"
          >
            {connLoading
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <RefreshCw className="h-3 w-3" />}
            {connInfo ? "Reconnect" : "Connect"}
          </button>
        </div>
      </div>

      {/* ── Connection error ── */}
      {connError && (
        <div className="flex items-start gap-2 px-3 py-2 rounded border bg-destructive/10 text-destructive border-destructive/20 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{connError}</span>
        </div>
      )}

      {/* ── Connection info ── */}
      {connInfo?.connected && (
        <div className="flex items-center gap-4 flex-wrap px-3 py-2 rounded border bg-muted/20 text-xs text-muted-foreground">
          {connInfo.host && (
            <span className="flex items-center gap-1">
              <Server className="h-3 w-3" />
              <span className="font-mono">{connInfo.host}</span>
            </span>
          )}
          {connInfo.databaseName && (
            <span className="flex items-center gap-1">
              <Database className="h-3 w-3" />
              <span className="font-mono">{connInfo.databaseName}</span>
            </span>
          )}
          {connInfo.ssl !== undefined && (
            <span className="flex items-center gap-1">
              <Key className="h-3 w-3" />
              SSL {connInfo.ssl ? "on" : "off"}
            </span>
          )}
          {connInfo.latencyMs !== undefined && (
            <span className="text-green-600 font-medium">{connInfo.latencyMs}ms</span>
          )}
          <span className="text-primary/70 uppercase font-semibold">{connInfo.provider}</span>
        </div>
      )}

      {/* ── Not-connected placeholder ── */}
      {!connInfo && !connLoading && (
        <div className="flex flex-col items-center justify-center py-8 gap-3 text-center rounded border border-dashed border-border">
          <Database className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            Click <strong>Connect</strong> to test the project's DATABASE_URL.
          </p>
          <p className="text-xs text-muted-foreground/60">
            Only PostgreSQL is supported. DATABASE_URL is never shown.
          </p>
        </div>
      )}

      {/* ── Schema browser + detail ── */}
      {isConnected && (
        <div className="flex gap-4 min-h-0" style={{ minHeight: 0 }}>
          {/* Left: schema tree */}
          <div className="w-56 shrink-0 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Tables
              </span>
              <button
                onClick={handleLoadSchemas}
                disabled={schemasLoading}
                className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground disabled:opacity-40"
                title="Refresh tables"
              >
                {schemasLoading
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <RefreshCw className="h-3 w-3" />}
              </button>
            </div>

            {schemasError && (
              <p className="text-xs text-destructive">{schemasError}</p>
            )}

            {!schemasLoaded && !schemasLoading && (
              <button
                onClick={handleLoadSchemas}
                className="text-xs text-primary underline text-left"
              >
                Load tables
              </button>
            )}

            {schemasLoaded && schemas.length === 0 && (
              <p className="text-xs text-muted-foreground">No tables found.</p>
            )}

            <div className="space-y-1">
              {schemas.map((s) => {
                const collapsed = collapsedSchemas.has(s.schema);
                return (
                  <div key={s.schema}>
                    <button
                      onClick={() => toggleSchema(s.schema)}
                      className="flex items-center gap-1 w-full text-left text-xs font-medium text-muted-foreground hover:text-foreground py-0.5"
                    >
                      {collapsed
                        ? <ChevronRight className="h-3 w-3 shrink-0" />
                        : <ChevronDown  className="h-3 w-3 shrink-0" />}
                      <span className="truncate">{s.schema}</span>
                    </button>

                    {!collapsed && (
                      <div className="ml-3 space-y-0.5">
                        {s.tables.map((t) => {
                          const isSelected =
                            selectedSchema === s.schema && selectedTable === t.name;
                          return (
                            <button
                              key={t.name}
                              onClick={() => handleSelectTable(s.schema, t.name)}
                              className={`flex items-center gap-1.5 w-full text-left text-xs py-0.5 px-1.5 rounded transition-colors ${
                                isSelected
                                  ? "bg-primary/10 text-primary"
                                  : "text-foreground/75 hover:bg-muted hover:text-foreground"
                              }`}
                            >
                              {t.type === "view" || t.type === "materialized_view"
                                ? <Eye     className="h-3 w-3 shrink-0 text-blue-400" />
                                : <Table2  className="h-3 w-3 shrink-0 text-muted-foreground" />}
                              <span className="truncate flex-1">{t.name}</span>
                              {t.estimatedRows !== null && t.estimatedRows !== undefined && (
                                <span className="text-[10px] text-muted-foreground/50 shrink-0">
                                  ~{t.estimatedRows.toLocaleString()}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: table detail */}
          <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-x-hidden">
            {!selectedTable && (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-2 text-muted-foreground rounded border border-dashed border-border">
                <Table2 className="h-8 w-8 opacity-30" />
                <p className="text-sm">Select a table from the left to explore it.</p>
              </div>
            )}

            {selectedTable && (
              <>
                {/* Table header */}
                <div className="flex items-center gap-2">
                  <Table2 className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-semibold text-sm">
                    {selectedSchema}.{selectedTable}
                  </span>
                  {tableDetail?.estimatedRows !== null && tableDetail?.estimatedRows !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      ~{tableDetail.estimatedRows.toLocaleString()} rows (estimated)
                    </span>
                  )}
                </div>

                {tableDetailLoading && (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading schema…
                  </div>
                )}

                {tableDetailError && (
                  <div className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> {tableDetailError}
                  </div>
                )}

                {/* Columns */}
                {tableDetail && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                      Columns
                    </p>
                    <div className="overflow-x-auto border rounded">
                      <table className="text-xs w-full border-collapse">
                        <thead>
                          <tr className="bg-muted/50">
                            <th className="px-3 py-1.5 text-left border-b font-semibold">Column</th>
                            <th className="px-3 py-1.5 text-left border-b font-semibold">Type</th>
                            <th className="px-3 py-1.5 text-left border-b font-semibold">Nullable</th>
                            <th className="px-3 py-1.5 text-left border-b font-semibold">Default</th>
                            <th className="px-3 py-1.5 text-left border-b font-semibold">PK</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tableDetail.columns.map((col, i) => (
                            <tr key={col.name} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                              <td className="px-3 py-1 border-b font-mono font-medium">{col.name}</td>
                              <td className="px-3 py-1 border-b font-mono text-blue-600/80">{col.dataType}</td>
                              <td className="px-3 py-1 border-b">
                                {col.isNullable
                                  ? <span className="text-muted-foreground">yes</span>
                                  : <span className="font-medium">no</span>}
                              </td>
                              <td className="px-3 py-1 border-b font-mono text-muted-foreground">
                                {col.defaultValue ?? "—"}
                              </td>
                              <td className="px-3 py-1 border-b text-center">
                                {col.isPrimaryKey && (
                                  <span className="text-amber-500 font-bold" title="Primary key">🔑</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Indexes */}
                {tableDetail && tableDetail.indexes.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                      Indexes
                    </p>
                    <div className="overflow-x-auto border rounded">
                      <table className="text-xs w-full border-collapse">
                        <thead>
                          <tr className="bg-muted/50">
                            <th className="px-3 py-1.5 text-left border-b font-semibold">Name</th>
                            <th className="px-3 py-1.5 text-left border-b font-semibold">Columns</th>
                            <th className="px-3 py-1.5 text-left border-b font-semibold">Unique</th>
                            <th className="px-3 py-1.5 text-left border-b font-semibold">Primary</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tableDetail.indexes.map((idx, i) => (
                            <tr key={idx.name} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                              <td className="px-3 py-1 border-b font-mono">{idx.name}</td>
                              <td className="px-3 py-1 border-b font-mono">{idx.columns.join(", ")}</td>
                              <td className="px-3 py-1 border-b">{idx.isUnique ? "yes" : "—"}</td>
                              <td className="px-3 py-1 border-b">{idx.isPrimary ? "yes" : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Sample rows */}
                <div>
                  <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Sample Rows
                    </p>
                    <div className="flex items-center gap-2">
                      <select
                        value={sampleLimit}
                        onChange={(e) => {
                          const l = parseInt(e.target.value) as typeof sampleLimit;
                          setSampleLimit(l);
                          setSampleOffset(0);
                          handleSelectTable(selectedSchema!, selectedTable!);
                        }}
                        className="text-xs border border-border rounded px-1.5 py-0.5 bg-background focus:outline-none"
                      >
                        {LIMIT_OPTIONS.map((l) => (
                          <option key={l} value={l}>{l} rows</option>
                        ))}
                      </select>
                      {sampleRows && (
                        <button
                          onClick={() => exportCsv(sampleRows, `${selectedTable}-sample.csv`)}
                          className="flex items-center gap-1 text-xs border border-border rounded px-2 py-0.5 hover:bg-muted transition-colors"
                        >
                          <Download className="h-3 w-3" /> CSV
                        </button>
                      )}
                    </div>
                  </div>

                  {sampleLoading && (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading rows…
                    </div>
                  )}

                  {sampleError && (
                    <div className="text-xs text-destructive flex items-center gap-1 py-2">
                      <AlertTriangle className="h-3 w-3" /> {sampleError}
                    </div>
                  )}

                  {sampleRows && !sampleLoading && (
                    <>
                      <ResultTable result={sampleRows} />
                      <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                        <span>
                          Rows {sampleOffset + 1}–{sampleOffset + sampleRows.rowCount}
                          {sampleRows.truncated && " (more available)"}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            disabled={sampleOffset === 0}
                            onClick={() => handleSamplePage(Math.max(0, sampleOffset - sampleLimit))}
                            className="px-2 py-0.5 border border-border rounded hover:bg-muted disabled:opacity-40 transition-colors"
                          >
                            ← Prev
                          </button>
                          <button
                            disabled={!sampleRows.truncated}
                            onClick={() => handleSamplePage(sampleOffset + sampleLimit)}
                            className="px-2 py-0.5 border border-border rounded hover:bg-muted disabled:opacity-40 transition-colors"
                          >
                            Next →
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Query runner ── */}
      {isConnected && (
        <div className="flex flex-col gap-3 border-t pt-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Play className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">SQL Query Runner</span>
              <span className="text-[10px] bg-amber-500/10 text-amber-600 border border-amber-400/20 rounded px-1.5 py-0.5 font-medium">
                Read-only
              </span>
            </div>

            {/* Example queries dropdown */}
            <div className="flex items-center gap-2">
              <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <select
                value=""
                onChange={(e) => { if (e.target.value) setQueryText(e.target.value); }}
                className="text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none max-w-[240px] truncate"
              >
                <option value="">Examples…</option>
                {examples.map((ex) => (
                  <option key={ex} value={ex}>{ex.slice(0, 60)}</option>
                ))}
              </select>
            </div>
          </div>

          <textarea
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="SELECT * FROM your_table LIMIT 50"
            rows={4}
            className="w-full font-mono text-xs rounded border border-border bg-background px-3 py-2 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
          />

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={queryLimit}
              onChange={(e) => setQueryLimit(parseInt(e.target.value) as typeof queryLimit)}
              className="text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none"
            >
              {LIMIT_OPTIONS.map((l) => (
                <option key={l} value={l}>Limit {l}</option>
              ))}
            </select>

            <button
              onClick={handleRunQuery}
              disabled={queryLoading || !queryText.trim()}
              className="flex items-center gap-1.5 text-xs rounded bg-primary text-primary-foreground px-3 py-1.5 hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              {queryLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Run Query
            </button>

            {queryText.trim() && (
              <CopyButton text={queryText} />
            )}
          </div>

          {queryError && (
            <div className="flex items-start gap-2 px-3 py-2 rounded border bg-destructive/10 text-destructive border-destructive/20 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{queryError}</span>
            </div>
          )}

          {queryResult && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                <span className="font-medium text-foreground">
                  {queryResult.rowCount} row{queryResult.rowCount !== 1 ? "s" : ""}
                </span>
                <span>{queryResult.durationMs}ms</span>
                {queryResult.truncated && (
                  <span className="flex items-center gap-1 text-amber-600">
                    <AlertTriangle className="h-3 w-3" /> Result limited
                  </span>
                )}
                <button
                  onClick={() => exportCsv(queryResult, "query-result.csv")}
                  className="flex items-center gap-1 border border-border rounded px-2 py-0.5 hover:bg-muted transition-colors ml-auto"
                >
                  <Download className="h-3 w-3" /> CSV
                </button>
              </div>

              {queryResult.query !== queryText.trim().replace(/;$/, "").trim() && (
                <div className="flex items-start gap-1.5 text-xs text-amber-600 bg-amber-500/10 border border-amber-400/20 rounded px-3 py-1.5">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    A LIMIT was injected or adjusted. Executed:{" "}
                    <code className="font-mono">{queryResult.query.slice(0, 200)}</code>
                  </span>
                </div>
              )}

              <ResultTable result={queryResult} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
