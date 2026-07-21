export interface GitLabBranch {
  name: string;
  default: boolean;
}

export function resolveRepositoryRef(
  requestedRef: string,
  branches: GitLabBranch[],
): string {
  const normalizedRef = requestedRef.trim();
  if (branches.some((branch) => branch.name === normalizedRef)) {
    return normalizedRef;
  }
  return (
    branches.find((branch) => branch.default)?.name ?? branches[0]?.name ?? ""
  );
}
