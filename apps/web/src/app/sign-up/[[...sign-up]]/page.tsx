import { redirect } from "next/navigation";

/**
 * Public sign-up is disabled — accounts are created via Clerk admin / invites.
 * Also turn off "Allow sign-ups" in Clerk Dashboard → User & Authentication → Restrictions.
 */
export default function SignUpPage() {
  redirect("/sign-in");
}
