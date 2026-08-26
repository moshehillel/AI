export function slugify(input: string, maxLength = 40): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return (slug || "change").slice(0, maxLength).replace(/-+$/g, "");
}

export function buildBranchName(input: {
  userSlug: string;
  taskId: string | number;
  shortDescription: string;
}): string {
  const user = slugify(input.userSlug, 24);
  const desc = slugify(input.shortDescription, 48);
  return `ai/${user}/${input.taskId}-${desc}`;
}

export function shortTitleFromPrompt(prompt: string): string {
  const firstLine = prompt.split("\n")[0]?.trim() ?? "Change request";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}
