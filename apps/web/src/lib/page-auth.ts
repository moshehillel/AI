import { redirect } from "next/navigation";
import { AuthError } from "@automation-studio/auth";
import { isDemoAuthEnabled } from "@/lib/access-mode";
import { getRequestAuth } from "@/lib/request-auth";

/**
 * Page-safe auth: redirects instead of throwing so Server Components do not
 * surface opaque production digests.
 */
export async function requirePageAuth() {
  try {
    return await getRequestAuth();
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.status === 401) {
        redirect(isDemoAuthEnabled() ? "/projects" : "/sign-in");
      }
      if (
        error.status === 400 ||
        error.status === 403 ||
        error.status === 404 ||
        /organization|synced|company|member/i.test(error.message)
      ) {
        redirect(isDemoAuthEnabled() ? "/projects" : "/select-org");
      }
    }
    throw error;
  }
}
