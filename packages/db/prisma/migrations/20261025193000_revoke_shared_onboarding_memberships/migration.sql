-- customer-onboarding was a shared self-serve workspace. Membership there
-- let every employee start a program. Remove those memberships only.
-- Assignments on every other project stay intact, as do the project and its chats.
DELETE FROM "ProjectMember" AS pm
USING "Project" AS p
WHERE pm."projectId" = p."id"
  AND p."slug" = 'customer-onboarding';
