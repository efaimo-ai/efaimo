---
name: csv-cleanup
description: Clean and validate CSV data. Use when the user asks to deduplicate, trim, or sanity-check a CSV before import.
license: Apache-2.0
---

# CSV cleanup

Use this when the user wants to tidy CSV data.

## Steps
1. Detect the delimiter (comma, tab, or semicolon) from the header row.
2. Trim leading and trailing whitespace from every cell.
3. Drop rows that are exact duplicates of an earlier row.
4. Report the final row and column counts, and how many duplicates were removed.

Always show the cleaned result and a one-line summary of what changed.
