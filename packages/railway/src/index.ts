const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

function mockEnabled() {
  return process.env.RAILWAY_MOCK === "1" || !process.env.RAILWAY_API_TOKEN;
}

async function railwayGraphql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token) throw new Error("RAILWAY_API_TOKEN is not configured");

  const response = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Railway API HTTP ${response.status}`);
  }

  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) throw new Error("Railway API returned no data");
  return json.data;
}

/**
 * Managed PR Environments are preferred. This helper polls Railway for an
 * ephemeral environment / service domain associated with a PR when needed.
 */
export async function findPreviewUrlForPr(input: {
  railwayProjectId: string;
  prNumber: number;
}): Promise<{ url: string | null; environmentId?: string; mock?: boolean }> {
  if (mockEnabled()) {
    return {
      url: `https://pr-${input.prNumber}-mock.up.railway.app`,
      environmentId: `mock-env-${input.prNumber}`,
      mock: true,
    };
  }

  const data = await railwayGraphql<{
    project: {
      environments: {
        edges: Array<{
          node: {
            id: string;
            name: string;
            serviceInstances: {
              edges: Array<{
                node: {
                  domains: { serviceDomains: Array<{ domain: string }> };
                };
              }>;
            };
          };
        }>;
      };
    };
  }>(
    `
    query ($id: String!) {
      project(id: $id) {
        environments {
          edges {
            node {
              id
              name
              serviceInstances {
                edges {
                  node {
                    domains {
                      serviceDomains { domain }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `,
    { id: input.railwayProjectId },
  );

  const match = data.project.environments.edges.find((edge) => {
    const name = edge.node.name.toLowerCase();
    return (
      name.includes(`pr-${input.prNumber}`) ||
      name.includes(`pr${input.prNumber}`) ||
      name.includes(`${input.prNumber}`)
    );
  });

  if (!match) return { url: null };

  for (const instance of match.node.serviceInstances.edges) {
    const domain = instance.node.domains.serviceDomains[0]?.domain;
    if (domain) {
      return {
        url: domain.startsWith("http") ? domain : `https://${domain}`,
        environmentId: match.node.id,
      };
    }
  }

  return { url: null, environmentId: match.node.id };
}
