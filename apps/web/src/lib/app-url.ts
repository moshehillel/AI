/** Canonical public app origin for server-side redirects (install callbacks, etc.). */
export function getAppBaseUrl() {
  const fromPublicEnv = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (fromPublicEnv && !fromPublicEnv.includes("localhost")) {
    return fromPublicEnv;
  }

  const railwayDomain =
    process.env.RAILWAY_PUBLIC_DOMAIN ?? process.env.RAILWAY_STATIC_URL;
  if (railwayDomain) {
    const host = railwayDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${host}`;
  }

  return fromPublicEnv ?? "http://localhost:3000";
}

export function appAdminUrl(path: string) {
  return new URL(path.startsWith("/") ? path : `/${path}`, getAppBaseUrl());
}
