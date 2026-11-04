/** First non-empty line of a recipe body, used by list rows. */
export function firstLine(body: string): string {
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed !== '') {
      return trimmed.replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, '');
    }
  }
  return '';
}
