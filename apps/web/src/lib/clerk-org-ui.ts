/**
 * Hide "Create organization" in Clerk UI components.
 * Enforcement also requires Clerk Dashboard → Organizations →
 * disable "Allow users to create organizations" (admins create orgs in the dashboard).
 *
 * Note: createOrganizationMode only accepts "modal" | "navigation" in @clerk/nextjs v6 —
 * there is no "none". Appearance overrides are the supported app-side equivalent.
 */
export const hideCreateOrganizationAppearance = {
  elements: {
    organizationSwitcherPopoverActionButton__createOrganization: {
      display: "none",
    },
    organizationListCreateOrganizationActionButton: {
      display: "none",
    },
    taskChooseOrganizationCreateOrganizationActionButton: {
      display: "none",
    },
  },
} as const;
