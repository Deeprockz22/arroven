# Training export format

Exports are JSON Lines (`.jsonl`), schema version 1. The first line is a manifest; every other line is one labelled
example. Created in Settings, Training data, by an admin or owner.

## What is included

- Only cases with a recorded training permission (case Overview, Training use).
- Only lines from records that are authorised, current (not superseded) and not withdrawn.
- Only labels an engineer decided: unreviewed drafts and statements waiting for a re-check are left out.
- Negative examples (lines nobody cited) only from cases whose whole chronology was reviewed.
- Free text has email addresses and Indian-format phone numbers removed. People's names are not detectable this way and
  must be pseudonymised by the partner before transfer (agreement clause 5.1).

## Manifest

```json
{"type":"manifest","export_id":"…","created_at":"2026-10-30T09:00:00.000Z","purpose":"Train extraction model v0.2",
 "schema_version":1,"model_contract":"2026-10-30","cases":["CASE-2026-001"],"excluded_cases":1,
 "counts":{"extraction":9,"extraction_negative":0,"evidence_decision":2,"assessment":1,"proposal_decision":0,
 "comparison_decision":0,"flag_decision":1},"body_sha256":"…"}
```

`body_sha256` is the SHA-256 of every line after the manifest. The whole file's SHA-256 is shown in the app and kept in
the export log, which is the record of which data each model version used (agreement clause 6.4).

## Example types

| `type` | Trains | Label |
| --- | --- | --- |
| `case` | Context | Question, system, cutoff, whether the chronology is fully reviewed |
| `extraction` | Statement extraction | For one record line: each statement's draft, the engineer's final text, verdict (`accepted`, `edited`, `rejected`), kind, date, conditions. Empty `statements` = a line nobody cited |
| `evidence_decision` | Evidence ranking | Explanation + statement → engineer's relation and reason, with the model's earlier suggestion if any |
| `assessment` | Explanation assessment | Engineer's assessment and note |
| `proposal_decision` | Proposals | Proposed explanation or question → adopted, rejected or unresolved, with the note |
| `comparison_decision` | Comparisons | Comparison → turned into a question or dismissed |
| `flag_decision` | Conflict and gap flags | Flag → turned into a question or dismissed |

## Deletion

Deleting an export removes the file and keeps its log entry, marked deleted, as evidence for the agreement's deletion
clause. Every create, download and delete is in the audit trail, and each included case's Activity tab records it.
