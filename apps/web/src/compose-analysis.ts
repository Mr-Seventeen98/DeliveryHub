export interface ComposeServiceOption {
  name: string;
}

export async function analyzeComposeContent(
  content: string,
): Promise<ComposeServiceOption[]> {
  if (!content.trim()) return [];
  try {
    const { parse } = await import("yaml");
    const document = parse(content) as unknown;
    if (!document || typeof document !== "object") return [];
    const services = (document as { services?: unknown }).services;
    if (!services || typeof services !== "object" || Array.isArray(services))
      return [];
    return Object.keys(services).map((name) => ({ name }));
  } catch {
    return [];
  }
}
