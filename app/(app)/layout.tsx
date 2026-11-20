import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { TabBar } from "@/components/ui/TabBar";
import { OfflineBanner } from "@/components/app/OfflineBanner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  return (
    <div className="relative mx-auto min-h-dvh w-full max-w-app pb-[calc(env(safe-area-inset-bottom)+72px)]">
      <OfflineBanner />
      {children}
      <TabBar />
    </div>
  );
}
