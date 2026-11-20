import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-app flex-col justify-center px-5">
      <EmptyState
        title="That page isn't here."
        body="The link may be old, or the plan it pointed at is gone."
        action={
          <Link href="/buy" className="inline-flex min-h-11 items-center px-2 text-[14px] font-medium text-coral">
            Back to the deck
          </Link>
        }
      />
    </main>
  );
}
