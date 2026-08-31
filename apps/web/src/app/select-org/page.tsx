import { OrganizationList } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { isDemoAuthEnabled } from "@/lib/access-mode";

export const dynamic = "force-dynamic";

export default async function SelectOrgPage() {
  if (isDemoAuthEnabled()) {
    redirect("/projects");
  }

  const session = await auth();
  if (!session.userId) {
    redirect("/sign-in");
  }

  return (
    <main className="app-frame-narrow flex min-h-screen flex-col items-center justify-center gap-6">
      <div className="text-center">
        <p className="brand-mark text-4xl">Koda</p>
        <h1 className="mt-3 text-2xl font-medium">Select an organization</h1>
        <p className="muted mt-2 max-w-md">
          Koda needs an active Clerk organization. Create one or pick an
          existing membership, then continue to your programs.
        </p>
      </div>
      <OrganizationList
        hidePersonal
        afterCreateOrganizationUrl="/projects"
        afterSelectOrganizationUrl="/projects"
      />
      <Link className="btn btn-ghost" href="/">
        Back to home
      </Link>
    </main>
  );
}
