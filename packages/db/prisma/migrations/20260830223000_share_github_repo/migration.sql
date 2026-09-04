-- Allow multiple projects to share one GitHub repository (monorepo / open-access default).
DROP INDEX IF EXISTS "Repository_githubOwner_githubRepo_key";
