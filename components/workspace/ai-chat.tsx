"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { Send, Loader2, Bot, User, AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveAiPromptAction, createAiSessionAction } from "@/app/actions/workspace-modules";

type ChatMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

type Session = { id: string; title: string | null };

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "USER";
  return (
    <div
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      <div
        className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {isUser ? (
          <User className="h-3.5 w-3.5" />
        ) : (
          <Bot className="h-3.5 w-3.5" />
        )}
      </div>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted text-foreground rounded-tl-sm"
        }`}
      >
        {msg.content}
        <div
          className={`text-[10px] mt-1 ${
            isUser ? "text-primary-foreground/60" : "text-muted-foreground"
          }`}
        >
          {formatTime(msg.createdAt)}
        </div>
      </div>
    </div>
  );
}

export function AiChat({
  projectId,
  session,
  initialMessages,
}: {
  projectId: string;
  session: Session;
  initialMessages: ChatMessage[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isNewSession, startNewSessionTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isPending) return;
    setInput("");
    setError(null);

    startTransition(async () => {
      const result = await saveAiPromptAction(session.id, trimmed);
      if (result.error) {
        setError(result.error);
        setInput(trimmed); // restore on error
        return;
      }
      if (result.userMessage && result.assistantMessage) {
        setMessages((prev) => [
          ...prev,
          result.userMessage!,
          result.assistantMessage!,
        ]);
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleNewSession = () => {
    startNewSessionTransition(async () => {
      await createAiSessionAction(projectId);
      // The page will reload via revalidatePath; just clear local state
      window.location.reload();
    });
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Warning banner */}
      <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300 shrink-0">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Claude API not connected — prompts are saved to the database but not
        sent to Claude yet.
      </div>

      {/* Session header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-background shrink-0">
        <span className="text-sm font-medium text-muted-foreground">
          {session.title ?? "AI Session"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={handleNewSession}
          disabled={isNewSession}
        >
          <Plus className="h-3 w-3" />
          New session
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground max-w-xs">
              Start a conversation. Prompts are stored in your database for
              when Claude API is wired up.
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {isPending && (
          <div className="flex gap-3">
            <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
              <Bot className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20 text-xs text-destructive shrink-0">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="border-t p-3 bg-background shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about your project… (Enter to send, Shift+Enter for newline)"
            rows={2}
            disabled={isPending}
            className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <Button
            onClick={() => handleSubmit()}
            disabled={isPending || !input.trim()}
            size="icon"
            className="h-10 w-10 shrink-0"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-right">
          {input.length}/4000
        </p>
      </div>
    </div>
  );
}
