import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDataset } from "@hooks/useDataset";
import { useAiContext } from "@/hooks/useAiContext";
import { PageHeader } from "@components/common/PageHeader";
import { LoadingState } from "@components/common/LoadingState";
import { DatasetEmptyState } from "@components/datasets/DatasetEmptyState";
import { Markdown } from "@components/common/Markdown";
import { AiAnalysisNote, AiPrivacyNote } from "@components/ai/AiNotes";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@components/ui/Card";
import { Button } from "@components/ui/Button";
import { Input } from "@components/ui/Input";
import { cn } from "@lib/utils";
import { askAiAboutDataset } from "@/lib/api";
import { isValidAiChatResponse } from "@/lib/ai/contextBuilder";
import { aiResultStore } from "@/lib/ai/resultStore";
import type { AiChatMessage } from "@/types";

const HEADER_DESCRIPTION = "Ask questions about your dataset in natural language";
const MAX_QUESTION_LENGTH = 2000;

const SUGGESTED_QUESTIONS = [
  "What does this dataset contain?",
  "Which columns have the most missing values?",
  "Which variables are most strongly related?",
  "What are the most important findings?",
  "Are there any unusual patterns?",
  "Which columns should I investigate further?",
  "Explain the statistical results in simple language.",
  "What are the limitations of this dataset?",
];

function MessageBubble({ message, isUser }: { message: AiChatMessage; isUser: boolean }) {
  return (
    <div className={cn("mb-4 flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] break-words rounded-2xl p-4 text-sm leading-relaxed",
          isUser ? "whitespace-pre-wrap rounded-tr-none bg-primary text-primary-foreground" : "rounded-tl-none bg-muted text-foreground"
        )}
        dir="auto"
      >
        {isUser ? message.content : <Markdown markdown={message.content} className="space-y-2" />}
      </div>
    </div>
  );
}

export function AIChat() {
  const navigate = useNavigate();
  const { dataset, isLoading, error } = useDataset();
  const { context, ready, analysisFailed } = useAiContext();
  const datasetId = dataset?.id;

  const [history, setHistory] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failedQuestion, setFailedQuestion] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The conversation survives leaving the page, but never leaks into another dataset.
  useEffect(() => {
    abortRef.current?.abort();
    setHistory(datasetId ? aiResultStore.getChat(datasetId) : []);
    setStatus("idle");
    setErrorMessage(null);
    setFailedQuestion(null);
  }, [datasetId]);
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history, status]);

  const ask = useCallback(
    async (text: string, base: AiChatMessage[]) => {
      if (!context || !datasetId) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const withQuestion: AiChatMessage[] = [...base, { role: "user", content: text }];
      setHistory(withQuestion);
      aiResultStore.setChat(datasetId, withQuestion);
      setStatus("loading");
      setErrorMessage(null);
      setFailedQuestion(null);
      try {
        const response = await askAiAboutDataset(datasetId, context, text, base, controller.signal);
        if (controller.signal.aborted) return;
        if (!isValidAiChatResponse(response)) throw new Error("The AI returned an unrecognized response.");
        const next: AiChatMessage[] = [...withQuestion, { role: "model", content: response.text }];
        setHistory(next);
        aiResultStore.setChat(datasetId, next);
        setStatus("idle");
      } catch (err) {
        if (controller.signal.aborted) return;
        // The unanswered question is taken back out of the conversation so the next turn stays well-formed,
        // and offered for a retry.
        setHistory(base);
        aiResultStore.setChat(datasetId, base);
        setFailedQuestion(text);
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Failed to get a response.");
      } finally {
        inputRef.current?.focus();
      }
    },
    [context, datasetId]
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || status === "loading") return;
    setInput("");
    void ask(text, history);
  }, [input, status, history, ask]);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <PageHeader title="Dataset Assistant" description={HEADER_DESCRIPTION} />
        <LoadingState text="Loading dataset…" />
      </div>
    );
  }

  if (!dataset || dataset.columns.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader title="Dataset Assistant" description={HEADER_DESCRIPTION} />
        {error && !dataset ? (
          <DatasetEmptyState variant="error" message={error} onRetry={() => navigate("/upload")} onUpload={() => navigate("/upload")} />
        ) : (
          <DatasetEmptyState variant="no-dataset" onUpload={() => navigate("/upload")} />
        )}
      </div>
    );
  }

  const busy = status === "loading";

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dataset Assistant"
        description={`${dataset.filename} — ask anything about your data`}
        badge={history.length > 0 ? `${history.length} message${history.length !== 1 ? "s" : ""}` : undefined}
        badgeVariant="info"
      />

      <Card>
        <CardHeader>
          <CardTitle>Conversation</CardTitle>
          <CardDescription>Questions and answers are scoped to this dataset only and are kept until you load another one.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="rounded-xl border border-border bg-background">
            <div ref={scrollRef} className="h-[420px] overflow-y-auto p-4" aria-live="polite">
              {history.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <span className="text-muted-foreground">No conversation yet. Ask a question about your dataset.</span>
                </div>
              )}
              {history.map((message, i) => (
                <MessageBubble key={i} message={message} isUser={message.role === "user"} />
              ))}
              {busy && (
                <div className="mb-4 flex justify-start">
                  <div className="max-w-[80%] rounded-2xl rounded-tl-none bg-muted p-4 text-sm text-foreground">
                    <LoadingState size="sm" text="Thinking…" className="py-2" />
                  </div>
                </div>
              )}
              {status === "error" && errorMessage && (
                <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <p>{errorMessage}</p>
                  {failedQuestion && (
                    <Button variant="outline" size="sm" className="mt-2" onClick={() => void ask(failedQuestion, history)}>
                      Retry “{failedQuestion.length > 40 ? `${failedQuestion.slice(0, 40)}…` : failedQuestion}”
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {history.length === 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">Suggested questions</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {SUGGESTED_QUESTIONS.map((question) => (
              <Button
                key={question}
                variant="outline"
                size="sm"
                disabled={!ready || busy}
                onClick={() => void ask(question, history)}
                className="h-auto whitespace-normal text-left text-sm"
              >
                {question}
              </Button>
            ))}
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex gap-2"
      >
        <Input
          ref={inputRef}
          aria-label="Your question"
          placeholder="Ask about your dataset…"
          value={input}
          maxLength={MAX_QUESTION_LENGTH}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          className="flex-1"
        />
        <Button type="submit" disabled={busy || !ready || !input.trim()}>
          {busy ? "Sending…" : "Send"}
        </Button>
      </form>
      <div className="space-y-2">
        <AiAnalysisNote preparing={!ready} failed={analysisFailed} />
        <AiPrivacyNote />
      </div>

      {history.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            setHistory([]);
            setStatus("idle");
            setErrorMessage(null);
            if (datasetId) aiResultStore.setChat(datasetId, []);
          }}
        >
          New conversation
        </Button>
      )}
    </div>
  );
}
