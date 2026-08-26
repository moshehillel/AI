import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

export {
  buildGitHubAppManifest,
  convertGitHubAppManifestCode,
  getGitHubAppManifestFormAction,
  manifestToEnvVars,
  type GitHubAppManifest,
  type GitHubAppManifestConversion,
} from "./manifest.js";

function mockEnabled() {
  return process.env.GITHUB_MOCK === "1" || !process.env.GITHUB_APP_ID;
}

export async function getInstallationOctokit(
  installationId: string,
): Promise<Octokit | null> {
  if (mockEnabled()) {
    return null;
  }

  const privateKey = (process.env.GITHUB_APP_PRIVATE_KEY ?? "").replace(
    /\\n/g,
    "\n",
  );

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID!,
      privateKey,
      installationId: Number(installationId),
    },
  });
}

export async function createBranchFromDefault(input: {
  installationId: string;
  owner: string;
  repo: string;
  branchName: string;
  defaultBranch?: string;
}) {
  if (mockEnabled()) {
    return {
      ref: `refs/heads/${input.branchName}`,
      sha: `mock-sha-${Date.now()}`,
      mock: true as const,
    };
  }

  const octokit = await getInstallationOctokit(input.installationId);
  if (!octokit) throw new Error("GitHub App not configured");

  const base = input.defaultBranch ?? "main";
  const { data: refData } = await octokit.git.getRef({
    owner: input.owner,
    repo: input.repo,
    ref: `heads/${base}`,
  });

  try {
    await octokit.git.createRef({
      owner: input.owner,
      repo: input.repo,
      ref: `refs/heads/${input.branchName}`,
      sha: refData.object.sha,
    });
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    if (status !== 422) throw error;
  }

  return { ref: `refs/heads/${input.branchName}`, sha: refData.object.sha };
}

export async function createPullRequest(input: {
  installationId: string;
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base?: string;
}) {
  if (mockEnabled()) {
    const number = Math.floor(Math.random() * 900) + 100;
    return {
      number,
      url: `https://github.com/${input.owner}/${input.repo}/pull/${number}`,
      headSha: `mock-head-${Date.now()}`,
      baseSha: `mock-base-${Date.now()}`,
      mock: true as const,
    };
  }

  const octokit = await getInstallationOctokit(input.installationId);
  if (!octokit) throw new Error("GitHub App not configured");

  const { data } = await octokit.pulls.create({
    owner: input.owner,
    repo: input.repo,
    title: input.title,
    body: input.body,
    head: input.head,
    base: input.base ?? "main",
  });

  return {
    number: data.number,
    url: data.html_url,
    headSha: data.head.sha,
    baseSha: data.base.sha,
  };
}

export async function mergePullRequest(input: {
  installationId: string;
  owner: string;
  repo: string;
  pullNumber: number;
}) {
  if (mockEnabled()) {
    return { merged: true, mock: true as const };
  }

  const octokit = await getInstallationOctokit(input.installationId);
  if (!octokit) throw new Error("GitHub App not configured");

  const { data } = await octokit.pulls.merge({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
    merge_method: "squash",
  });

  return { merged: data.merged };
}

export async function getCombinedStatus(input: {
  installationId: string;
  owner: string;
  repo: string;
  ref: string;
}) {
  if (mockEnabled()) {
    return { state: "success" as const, statuses: [] };
  }

  const octokit = await getInstallationOctokit(input.installationId);
  if (!octokit) throw new Error("GitHub App not configured");

  const { data } = await octokit.repos.getCombinedStatusForRef({
    owner: input.owner,
    repo: input.repo,
    ref: input.ref,
  });

  return { state: data.state, statuses: data.statuses };
}

export async function verifyBranchProtection(input: {
  installationId: string;
  owner: string;
  repo: string;
  branch?: string;
}) {
  if (mockEnabled()) {
    return {
      protected: true,
      requiresReviews: true,
      requiresStatusChecks: true,
      mock: true as const,
    };
  }

  const octokit = await getInstallationOctokit(input.installationId);
  if (!octokit) throw new Error("GitHub App not configured");

  try {
    const { data } = await octokit.repos.getBranchProtection({
      owner: input.owner,
      repo: input.repo,
      branch: input.branch ?? "main",
    });
    return {
      protected: true,
      requiresReviews: Boolean(data.required_pull_request_reviews),
      requiresStatusChecks: Boolean(data.required_status_checks),
    };
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    if (status === 404) {
      return {
        protected: false,
        requiresReviews: false,
        requiresStatusChecks: false,
      };
    }
    throw error;
  }
}

export function getGitHubAppInstallUrl(state?: string) {
  const slug = process.env.GITHUB_APP_SLUG;
  if (!slug) {
    return null;
  }
  const url = new URL(`https://github.com/apps/${slug}/installations/new`);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export async function compareBranchToDefault(input: {
  installationId: string;
  owner: string;
  repo: string;
  branch: string;
  defaultBranch?: string;
}) {
  if (mockEnabled()) {
    return {
      aheadBy: 1,
      behindBy: 0,
      needsRebase: false,
      mock: true as const,
    };
  }

  const octokit = await getInstallationOctokit(input.installationId);
  if (!octokit) throw new Error("GitHub App not configured");

  const base = input.defaultBranch ?? "main";
  const { data } = await octokit.repos.compareCommits({
    owner: input.owner,
    repo: input.repo,
    base,
    head: input.branch,
  });

  return {
    aheadBy: data.ahead_by,
    behindBy: data.behind_by,
    needsRebase: data.behind_by > 0,
  };
}

