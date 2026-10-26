const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

async function railwayGraphql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token) {
    throw new Error("RAILWAY_API_TOKEN is not configured");
  }

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

export async function upsertRailwayServiceVariables(input: {
  serviceId: string;
  variables: Record<string, string>;
  skipDeploys?: boolean;
}) {
  const projectId = process.env.RAILWAY_PROJECT_ID;
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
  if (!projectId || !environmentId) {
    throw new Error("RAILWAY_PROJECT_ID and RAILWAY_ENVIRONMENT_ID are required");
  }

  await railwayGraphql<{ variableCollectionUpsert: boolean }>(
    `
      mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
        variableCollectionUpsert(input: $input)
      }
    `,
    {
      input: {
        projectId,
        environmentId,
        serviceId: input.serviceId,
        variables: input.variables,
        skipDeploys: input.skipDeploys ?? false,
      },
    },
  );
}

export async function applyGitHubAppCredentialsToRailway(
  variables: Record<string, string>,
) {
  const webServiceId = process.env.RAILWAY_SERVICE_ID;
  const workerServiceId = process.env.RAILWAY_WORKER_SERVICE_ID;
  if (!webServiceId || !workerServiceId) {
    throw new Error(
      "RAILWAY_SERVICE_ID and RAILWAY_WORKER_SERVICE_ID must be set on web",
    );
  }

  await upsertRailwayServiceVariables({
    serviceId: webServiceId,
    variables,
    skipDeploys: true,
  });
  await upsertRailwayServiceVariables({
    serviceId: workerServiceId,
    variables,
    skipDeploys: false,
  });
}
