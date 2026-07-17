---
name: good-skill
description: Format and validate CSV files. Use when the user asks to clean, deduplicate, or check a CSV before import.
license: Apache-2.0
metadata:
  version: "1.0.0"
---

# CSV cleanup

Use this skill when the user wants to tidy a CSV file.

## Steps
1. Read the file and detect the delimiter.
2. Trim whitespace from every cell.
3. Drop fully duplicate rows.
4. Report row and column counts.

See [the reference](reference.md) for edge cases.
