/**
 * Generates an ASCII progress bar string.
 * @param percent The progress percentage (0-100)
 * @param length The total character length of the visual bar (exclusive of brackets)
 * @returns A formatted string e.g., `[####      ]`
 */
export function generateProgressBar(percent: number, length: number = 20): string {
  // Ensure percent is between 0 and 100
  const clampedPercent = Math.max(0, Math.min(100, Math.round(percent)));
  
  // Calculate the number of filled characters based on percentage
  // Ensure the filled length is at least 1 so the bar is never completely empty
  const filledLength = Math.max(1, Math.round((clampedPercent / 100) * length));
  const emptyLength = Math.max(0, length - filledLength);
  
  const filledStr = '#'.repeat(filledLength);
  const emptyStr = ' '.repeat(emptyLength);

  // Format the percentage to always be 3 characters wide, right-aligned
  const formattedPercent = clampedPercent.toString().padStart(3, ' ');
  
  return `[${filledStr}${emptyStr}] ${formattedPercent}%`;
}
