/**
 * Where to go after a login or profile step: the `returnUrl` query param set by a guard,
 * or the app root. Only in-app paths are accepted, so a crafted link cannot redirect elsewhere.
 */
export function safeReturnUrl(url: string | null | undefined): string {
  const isInAppPath = !!url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\');
  return isInAppPath ? url : '/';
}
