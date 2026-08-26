export function InviteNote() {
  return (
    <p className="muted mt-2 text-sm">
      Invite and remove employees through Clerk Organizations. Role sync is handled
      via the Clerk webhook (`/api/webhooks/clerk`).
    </p>
  );
}
