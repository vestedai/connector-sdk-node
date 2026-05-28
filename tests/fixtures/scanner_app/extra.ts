/**
 * A second file in the fixture directory — only a plain class.
 * Verifies the scanner walks multiple files but doesn't pick up non-decorated classes.
 */

export class ExtraHelper {
  greet(name: string): string {
    return `hello ${name}`;
  }
}
