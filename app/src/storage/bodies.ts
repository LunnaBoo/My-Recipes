import { Directory, File, Paths } from 'expo-file-system';

/**
 * Markdown bodies are the source of truth and live outside SQLite:
 * `<documentDirectory>/recipes/<id>.md`.
 */
const recipesDirectory = () => new Directory(Paths.document, 'recipes');

export function bodyFilePath(id: string): string {
  return `recipes/${id}.md`;
}

export function bodyUri(id: string): string {
  return new File(recipesDirectory(), `${id}.md`).uri;
}

export async function ensureRecipeDir(): Promise<void> {
  const directory = recipesDirectory();
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
}

export async function writeBody(id: string, body: string): Promise<void> {
  await ensureRecipeDir();
  const file = new File(recipesDirectory(), `${id}.md`);
  await file.write(body);
}

export async function readBody(id: string): Promise<string> {
  const file = new File(recipesDirectory(), `${id}.md`);
  if (!file.exists) return '';
  return file.text();
}

export async function deleteBody(id: string): Promise<void> {
  const file = new File(recipesDirectory(), `${id}.md`);
  if (file.exists) file.delete();
}
