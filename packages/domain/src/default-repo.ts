/**
 * Platform default GitHub repo for live Cursor plan mode when a project
 * has no connected repository yet (open-access / early onboarding).
 */
export type DefaultGithubRepoConfig = {
  githubOwner: string;
  githubRepo: string;
  installationId: string | null;
  defaultBranch: string;
  repoUrl: string;
};

export function getDefaultGithubRepoConfig(): DefaultGithubRepoConfig | null {
  const githubOwner =
    process.env.DEFAULT_GITHUB_OWNER?.trim() ||
    process.env.CURSOR_DEFAULT_REPO_OWNER?.trim() ||
    "";
  const githubRepo =
    process.env.DEFAULT_GITHUB_REPO?.trim() ||
    process.env.CURSOR_DEFAULT_REPO_NAME?.trim() ||
    "";
  if (!githubOwner || !githubRepo) return null;

  return {
    githubOwner,
    githubRepo,
    installationId:
      process.env.DEFAULT_GITHUB_INSTALLATION_ID?.trim() ||
      process.env.CURSOR_DEFAULT_INSTALLATION_ID?.trim() ||
      null,
    defaultBranch:
      process.env.DEFAULT_GITHUB_BRANCH?.trim() ||
      process.env.CURSOR_DEFAULT_REPO_BRANCH?.trim() ||
      "main",
    repoUrl: `https://github.com/${githubOwner}/${githubRepo}`,
  };
}

/** True when the worker can call the live Cursor agent API (not mock/template). */
export function isLiveCursorConfigured(): boolean {
  return (
    process.env.CURSOR_MOCK !== "1" && Boolean(process.env.CURSOR_API_KEY?.trim())
  );
}
