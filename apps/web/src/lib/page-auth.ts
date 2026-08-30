import { redirect } from "next/navigation";
import { AuthError } from "@automation-studio/auth";
import { isOpenAccess } from "@/lib/open-access";
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
        redirect(isOpenAccess() ? "/projects" : "/sign-in");
      }
      if (
        error.status === 400 ||
        error.status === 403 ||
        error.status === 404 ||
        /organization|synced|company|member/i.test(error.message)
      ) {
        redirect(isOpenAccess() ? "/projects" : "/select-org");
      }
    }
    throw error;
  }
}
