"use client";

/**
 * components/projects/project-ai-assistant.tsx
 *
 * Sprint 5: project-aware AI assistant UI.
 *
 * Read/Analyse/Suggest mode only.
 * No file writes, no terminal execution, no PM2 restarts, no auto-commits.
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useTransition,
} from "react";
import {
  Bot,
  Send,
  Copy,
  Check,
  RefreshCcw,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
  Loader2,
  KeyRound,
  Sparkles,
} from "lucide-react";
import {
  getProjectAiBootstrapAction,
  askProjectAiAction,
  type AiBootstrapInfo,
} from "@/app/actions/project-ai";
import type { AiMessage } from "@/lib/ai/provider";

// ── Types ──────────────────────────────────────────────────────────────────

interface ChatMessage {
  id:      string;
  role:    "user" | "assistant" | "error";
  content: string;
  tokens?: { input: number; output: number };
  model?:  string;
}

interface ContextToggles {
  includeEnvKeys:    boolean;
  includeDomains:    boolean;
  includeDeployment: boolean;
  includeLiveStatus: boolean;
  includeGitInfo:    boolean;
}

interface Props {
  projectId:    string;
  initialInfo?: AiBootstrapInfo | null;
}

// ── Suggested prompts ──────────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  "Is my project currently running? What's its status?",
  "Explain my deployment configuration and suggest any improvements.",
  "What environment variables does this project use and why might each be needed?",
  "My project isn't starting. What are the common causes for a Node.js app to fail with PM2?",
  "How do I set up a custom domain with HTTPS for this project?",
  "Generate a health-check endpoint I can add to my Express/Next.js app.",
];

// ── Helpers ────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(text).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button
      onClick={copy}
      title="Copy response"
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// Simple markdown-ish renderer: code blocks + bold + line breaks
function MessageBody({ content }: { content: string }) {
  // Split on fenced code blocks
  const parts = content.split(/(```[\s\S]*?```)/g);
  return (
    <div className="text-sm leading-relaxed space-y-2">
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const lines = part.split("\n");
          const lang = lines[0].replace("```", "").trim();
          const code = lines.slice(1, lines.length - 1).join("\n");
          return (
            <div key={i} className="relative group">
              {lang && (
                <div className="text-[10px] text-muted-foreground bg-muted/60 px-3 py-0.5 rounded-t border border-border border-b-0 font-mono">
                  {lang}
                </div>
              )}
              <pre className={`bg-muted/80 border border-border text-xs font-mono p-3 overflow-x-auto whitespace-pre ${lang ? "rounded-b rounded-tr" : "rounded"}`}>
                <code>{code}</code>
              </pre>
              <div className="absolute top-1 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <CopyButton text={code} />
              </div>
            </div>
          );
        }
        // Plain text — handle **bold** and newlines
        return (
          <div key={i}>
            {part.split("\n").map((line, j) => {
              // Bold: **text**
              const boldParts = line.split(/(\*\*[^*]+\*\*)/g);
              return (
                <p key={j} className={j > 0 ? "mt-1" : ""}>
                  {boldParts.map((bp, k) =>
                    bp.startsWith("**") && bp.endsWith("**")
                      ? <strong key={k}>{bp.slice(2, -2)}</strong>
                      : <span key={k}>{bp}</span>
                  )}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Setup card shown when API key is missing ───────────────────────────────

function SetupCard() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-6 text-center">
      <div className="rounded-full bg-muted/60 p-4">
        <KeyRound className="h-8 w-8 text-muted-foreground" />
      </div>
      <div className="max-w-sm space-y-2">
        <h2 className="text-base font-semibold">AI Assistant not configured</h2>
        <p className="text-sm text-muted-foreground">
          Add your Anthropic API key to enable the AI assistant for this project.
        </p>
      </div>
      <div className="w-full max-w-sm text-left bg-muted/50 border border-border rounded-lg p-4 space-y-2">
        <p className="text-xs font-medium text-foreground">Add to your <code className="font-mono">.env</code> file:</p>
        <pre className="text-xs font-mono bg-background border border-border rounded p-2 overflow-x-auto">
          {`ANTHROPIC_API_KEY=sk-ant-...your-key...`}
        </pre>
        <p className="text-xs text-muted-foreground">
          Optionally set <code className="font-mono">ANTHROPIC_MODEL</code> to override
          the default model (<code className="font-mono">claude-opus-4-8</code>).
        </p>
        <p className="text-xs text-muted-foreground">
          Get your key at{" "}
          <a
            href="https://console.anthropic.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            console.anthropic.com
          </a>
        </p>
      </div>
      <p className="text-xs text-muted-foreground max-w-sm">
        After adding the key, restart the panel process and reload this page.
      </p>
    </div>
  );
}

// ── Context toggles ────────────────────────────────────────────────────────

function ContextTogglesPanel({
  toggles,
  onChange,
}: {
  toggles: ContextToggles;
  onChange: (k: keyof ContextToggles, v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const items: { key: keyof ContextToggles; label: string }[] = [
    { key: "includeDeployment", label: "Deployment config" },
    { key: "includeLiveStatus", label: "Live / PM2 status" },
    { key: "includeDomains",    label: "Domains" },
    { key: "includeEnvKeys",    label: "Env var keys" },
    { key: "includeGitInfo",    label: "Git info" },
  ];
  const activeCount = Object.values(toggles).filter(Boolean).length;
  return (
    <div className="border-b border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" />
          Context sent to AI
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
            {activeCount}/{items.length}
          </span>
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="px-4 pb-3 flex flex-wrap gap-3">
          {items.map((item) => (
            <label key={item.key} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={toggles[item.key]}
                onChange={(e) => onChange(item.key, e.target.checked)}
                className="h-3 w-3 rounded"
              />
              {item.label}
            </label>
          ))}
          <p className="w-full text-[10px] text-muted-foreground mt-1">
            Only key names are sent for env vars — never values.
            Secret values are never included in any context.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function ProjectAiAssistant({ projectId, initialInfo }: Props) {
  const [info, setInfo]             = useState<AiBootstrapInfo | null>(initialInfo ?? null);
  const [messages, setMessages]     = useState<ChatMessage[]>([]);
  const [input, setInput]           = useState("");
  const [isPending, startTransition] = useTransition();
  const [isBuoting, setIsBoooting]  = useState(!initialInfo);
  const bottomRef                   = useRef<HTMLDivElement>(null);
  const textareaRef                 = useRef<HTMLTextAreaElement>(null);

  const [toggles, setToggles] = useState<ContextToggles>({
    includeEnvKeys:    true,
    includeDomains:    true,
    includeDeployment: true,
    includeLiveStatus: true,
    includeGitInfo:    true,
  });

  // Bootstrap on mount if not pre-fetched
  useEffect(() => {
    if (initialInfo) return;
    setIsBoooting(true);
    getProjectAiBootstrapAction(projectId)
      .then((res) => {
        if (res.ok && res.data) setInfo(res.data);
      })
      .finally(() => setIsBoooting(false));
  }, [projectId, initialInfo]);

  // Scroll to bottom after new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  const handleToggle = useCallback(
    (key: keyof ContextToggles, value: boolean) => {
      setToggles((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isPending) return;

      const userMsg: ChatMessage = { id: uid(), role: "user", content: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");

      startTransition(async () => {
        // Build conversation history for the action
        const history: AiMessage[] = [
          ...messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          { role: "user" as const, content: trimmed },
        ];

        const result = await askProjectAiAction({
          projectId,
          messages: history,
          contextOptions: toggles,
        });

        if (result.ok && result.data) {
          setMessages((prev) => [
            ...prev,
            {
              id:      uid(),
              role:    "assistant",
              content: result.data!.text,
              tokens:  { input: result.data!.inputTokens, output: result.data!.outputTokens },
              model:   result.data!.model,
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id:      uid(),
              role:    "error",
              content: result.ok ? "Unknown error" : (result as { ok: false; error: string }).error,
            },
          ]);
        }
      });
    },
    [isPending, messages, projectId, toggles],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      sendMessage(input);
    },
    [input, sendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input);
      }
    },
    [input, sendMessage],
  );

  const clearConversation = useCallback(() => {
    setMessages([]);
  }, []);

  // ── Loading ────────────────────────────────────────────────────────────
  if (isBuoting) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── No API key ─────────────────────────────────────────────────────────
  if (info && !info.hasApiKey) {
    return <SetupCard />;
  }

  // ── Chat UI ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Context toggles bar */}
      <ContextTogglesPanel toggles={toggles} onChange={handleToggle} />

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Welcome / empty state */}
        {messages.length === 0 && (
          <div className="max-w-2xl mx-auto space-y-6 pt-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-primary/10 p-2">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">
                  AI Assistant{info ? ` — ${info.projectName}` : ""}
                </p>
                {info?.contextSummary && (
                  <p className="text-xs text-muted-foreground">{info.contextSummary}</p>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground rounded-lg bg-muted/50 border border-border px-3 py-2">
              <strong>Read-only mode.</strong> The assistant can read project context and suggest
              fixes, but cannot execute commands, modify files, or restart processes.
              Env var values are never included.
            </p>
            <div className="grid gap-2">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  disabled={isPending}
                  className="text-left text-sm rounded-lg border border-border bg-background hover:bg-muted/60 px-3 py-2 transition-colors disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message bubbles */}
        {messages.map((msg) => {
          if (msg.role === "user") {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm">
                  {msg.content}
                </div>
              </div>
            );
          }

          if (msg.role === "error") {
            return (
              <div key={msg.id} className="max-w-2xl mx-auto">
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
                  <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  <p className="text-sm text-destructive">{msg.content}</p>
                </div>
              </div>
            );
          }

          // Assistant message
          return (
            <div key={msg.id} className="max-w-2xl mx-auto space-y-1">
              <div className="flex items-center gap-2 mb-1">
                <div className="rounded-full bg-muted/80 p-1">
                  <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <span className="text-xs text-muted-foreground">AI Assistant</span>
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-muted/50 border border-border px-4 py-3">
                <MessageBody content={msg.content} />
              </div>
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <CopyButton text={msg.content} />
                  {msg.tokens && (
                    <span className="text-[10px] text-muted-foreground">
                      {msg.tokens.input + msg.tokens.output} tokens
                    </span>
                  )}
                </div>
                {msg.model && (
                  <span className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                    {msg.model}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {/* Thinking indicator */}
        {isPending && (
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-muted/50 border border-border px-4 py-3 w-fit">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Thinking…</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Toolbar */}
      {messages.length > 0 && (
        <div className="flex justify-end px-4 pb-1">
          <button
            onClick={clearConversation}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCcw className="h-3 w-3" />
            Clear conversation
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-border px-4 py-3">
        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this project…"
            disabled={isPending}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 min-h-[42px] max-h-[160px] overflow-y-auto"
          />
          <button
            type="submit"
            disabled={isPending || !input.trim()}
            className="shrink-0 rounded-xl bg-primary text-primary-foreground p-2.5 hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Send className="h-4 w-4" />
            }
          </button>
        </form>
        <p className="mt-1.5 text-[10px] text-muted-foreground text-center">
          Press Enter to send · Shift+Enter for new line · Read-only mode
        </p>
      </div>
    </div>
  );
}
