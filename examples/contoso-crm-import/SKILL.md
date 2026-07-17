---
name: contoso-crm-import
description: Format a contact list as a Contoso CRM bulk-import file. Use when the user asks to prepare, convert, or export contacts for Contoso CRM import.
license: Apache-2.0
---

# Contoso CRM bulk-import format

Convert a contact list into the exact file Contoso CRM accepts on import. These
rules are an internal convention and are not guessable; follow them exactly.

## Output rules
1. Semicolon-delimited. No header row.
2. Four columns, in this order: member_id;display_name;email;source
3. member_id: the first three letters of the last name, uppercased, then a hyphen,
   then a row number zero-padded to four digits starting at 0001 (0001, 0002, ...).
4. display_name: the full name exactly as given.
5. email: lowercased.
6. source: always the literal value import-2026.

Output only the rows.
