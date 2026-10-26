export function InviteNote() {
  return (
    <p className="muted mt-2 text-sm">
      Create logins in the Clerk Dashboard (public sign-up is off). Invite people
      to the Clerk organization for company access, then assign them to a project
      below (by email or from the member list) so they can open planning chat.
      Role sync also runs via the Clerk webhook (`/api/webhooks/clerk`).
    </p>
  );
}
