export interface NormalizedRepository {
  full: string;
  path: string;
}

function normalizePath(path: string): string {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Keep malformed but still comparable legacy repository paths unchanged.
  }
  return decoded
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

export function normalizeRepositoryUrl(
  repositoryUrl: string,
): NormalizedRepository | null {
  const value = repositoryUrl.trim();
  if (!value) return null;

  const scpStyle = value.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/);
  if (scpStyle?.[1] && scpStyle[2] && !value.includes("://")) {
    const path = normalizePath(scpStyle[2]);
    return path ? { full: `${scpStyle[1].toLowerCase()}/${path}`, path } : null;
  }

  try {
    const url = new URL(value);
    const path = normalizePath(url.pathname);
    return path ? { full: `${url.host.toLowerCase()}/${path}`, path } : null;
  } catch {
    const path = normalizePath(value);
    return path ? { full: path, path } : null;
  }
}
