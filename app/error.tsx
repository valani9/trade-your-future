"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-app flex-col justify-center px-5">
      <EmptyState
        title="Something broke on our side."
        body="Nothing was charged. Try again, and if it keeps happening come back later."
        action={
          <Button variant="ghost" onClick={reset}>
            Try again
          </Button>
        }
      />
    </main>
  );
}
