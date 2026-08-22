import { parseImageUrl } from './github.js';

// Where images land when the caller does not spell out a full destination.
// Overridable per deployment so the defaults are not baked into the code.
export const DEFAULT_DESTINATION_REGISTRY =
  process.env.DEFAULT_DESTINATION_REGISTRY || 'registry.cn-shenzhen.aliyuncs.com';

export const DEFAULT_DESTINATION_SCOPE =
  process.env.DEFAULT_DESTINATION_SCOPE || 'charles1416';

// True when the string starts with something that looks like a registry host
// (a dotted hostname, optionally with a port, followed by a path segment).
function hasRegistry(imageUrl: string): boolean {
  return /^[^/]*\.[^/]*\//.test(imageUrl);
}

// "ghcr.io/owner/repo:tag" -> "repo:tag"  (or just "repo" when dropping the tag)
function repoPathFromSource(sourceImage: string, includeTag: boolean): string {
  const parts = parseImageUrl(sourceImage);
  return includeTag && parts.tag ? `${parts.repo}:${parts.tag}` : parts.repo;
}

/**
 * Fill in the destination the same way the web UI does, so the CLI can say
 * `sdi copy nginx:1.27` and get the same result as the form.
 *
 * copy (destination is a repo:tag):
 *   omitted           -> <registry>/<scope>/<name>:<tag>
 *   "nginx:1.27"      -> <registry>/<scope>/nginx:1.27
 *   "me/nginx:1.27"   -> <registry>/me/nginx:1.27
 *
 * sync (destination is a scope, since every tag is copied into it):
 *   omitted           -> <registry>/<scope>/<name>
 *   "me"              -> <registry>/me
 *   "me/nginx"        -> <registry>/me/nginx
 *
 * A fully-qualified destination is returned unchanged, which makes this
 * idempotent for the browser client — it already sends complete URLs.
 */
export function normalizeDestination(
  sourceImage: string,
  destinationImage: string | null | undefined,
  workflowType: 'copy' | 'sync' = 'copy'
): string {
  const dest = (destinationImage || '').trim();

  if (dest && hasRegistry(dest)) {
    return dest;
  }

  if (workflowType === 'sync') {
    // A bare "me" is a scope, not an image name, so it keeps its own segment
    return dest
      ? `${DEFAULT_DESTINATION_REGISTRY}/${dest}`
      : `${DEFAULT_DESTINATION_REGISTRY}/${DEFAULT_DESTINATION_SCOPE}/${repoPathFromSource(sourceImage, false)}`;
  }

  const repoPath = dest || repoPathFromSource(sourceImage, true);

  // A bare "nginx:1.27" has no namespace, so add the default scope
  if (!repoPath.includes('/')) {
    return `${DEFAULT_DESTINATION_REGISTRY}/${DEFAULT_DESTINATION_SCOPE}/${repoPath}`;
  }

  return `${DEFAULT_DESTINATION_REGISTRY}/${repoPath}`;
}
