import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import { buttonStyles } from "@components/ui/button-styles";

/** Friendly error screen for a page that crashed or whose code failed to download (for example when offline). */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "An unexpected error occurred.";
  const isChunkError = error instanceof Error && /dynamically imported module|Importing a module script failed|Loading chunk/i.test(error.message);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div role="alert" className="max-w-md space-y-4 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          {isChunkError
            ? "This page could not be loaded. Check your connection, or reload to get the latest version of the app."
            : "This page hit an unexpected error. Your dataset is stored in this browser and is not affected."}
        </p>
        <p className="break-words rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground" dir="ltr">{message}</p>
        <div className="flex justify-center gap-3">
          <button type="button" className={buttonStyles({ variant: "primary" })} onClick={() => window.location.reload()}>
            Reload page
          </button>
          <Link to="/" className={buttonStyles({ variant: "outline" })}>
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
