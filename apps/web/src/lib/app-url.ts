/** Canonical public app origin for server-side redirects (install callbacks, etc.). */
export function getAppBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

export function appAdminUrl(path: string) {
  return new URL(path.startsWith("/") ? path : `/${path}`, getAppBaseUrl());
}
