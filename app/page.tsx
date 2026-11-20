import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { Onboarding } from "@/components/app/Onboarding";

export default async function Landing() {
  const session = await auth();
  if (session?.user?.id) redirect("/buy");

  async function tryDemo() {
    "use server";
    await signIn("demo", { redirectTo: "/buy" });
  }

  async function continueWithGoogle() {
    "use server";
    await signIn("google", { redirectTo: "/buy" });
  }

  return (
    <Onboarding
      googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)}
      demoAction={tryDemo}
      googleAction={continueWithGoogle}
    />
  );
}
