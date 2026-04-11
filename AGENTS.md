# 🤖 AGENT.md — Simple AI Guidelines (Next.js 16 + Supabase)

## 📌 Project Goal

Build a system that:

* Detects duplicate client records (based on SSN)
* Suggests a merged record
* Allows user to review & approve merges
* Data in data/operation-clean-slate.json

---

## ⚙️ Tech Stack

* **Frontend + Backend:** Next.js 16 (App Router)
* **Database:** Supabase (PostgreSQL)
* **AI (optional):** Simple logic first (no heavy ML needed) - use ai sdk

---

## 🧠 Core Logic (Keep It Simple)

### 1. Duplicate Detection

👉 Rule:

* Group records by **same SSN**

```ts
// Example
groupBy(records, "ssn")
```

👉 Only groups with >1 records = duplicates

---

### 2. Merge Recommendation

For each group, create one final record:

| Field      | Rule                          |
| ---------- | ----------------------------- |
| first_name | most frequent                 |
| last_name  | most frequent                 |
| dob        | most frequent                 |
| phone      | most frequent (latest if tie) |
| email      | latest                        |
| address    | normalize + latest            |

---

### 3. Address Normalization (Simple)

Replace common terms:

```ts
Street → St
Avenue → Ave
Road → Rd
```

Lowercase + trim → compare

---

### 4. Confidence Score (Basic)

No AI needed, just logic:

```ts
confidence = (most_common_count / total_records) * 100
```

Example:

* 2 out of 3 → 66%
* 3 out of 3 → 100%

---

### 5. Review System

User should see:

* All duplicate records
* Suggested merged record
* Confidence %

Actions:

* ✅ Approve
* ❌ Reject

---

### 6. Merge Execution

On approval:

* Keep one record (or create new)
* Delete/mark others as duplicates
* Save audit log

---

## 🗄️ Supabase Tables

### clients

```sql
id
ssn
first_name
last_name
dob
address
phone
email
created_at
```

---

### merge_logs

```sql
id
ssn
merged_record (json)
removed_ids (json)
created_at
```

---

## 📁 Folder Structure

```bash
/app
  /api
    /detect
    /merge
/lib
  merge.ts
  group.ts
  normalize.ts
/components
  ReviewCard.tsx
```

---

## 🔌 API Design

### POST `/api/detect`

* Input: records
* Output: grouped duplicates

---

### POST `/api/merge`

* Input: group
* Output: merged record + DB update

---

## 🧪 Rules to Follow

* ❌ Do NOT overcomplicate with ML
* ✅ Start with rule-based logic
* ✅ Keep functions small & testable
* ✅ Always show data before merging

---

## 🚀 Future (Optional)

* Add fuzzy matching
* Add AI scoring
* Bulk merge

---

## ✅ Definition of Done

* Duplicate groups detected
* Merge suggestion works
* User can approve/reject
* DB updates correctly
* Logs are saved

---

## 🧠 Philosophy

> Keep it simple.
> Correctness > complexity.
> Human control > automation.

---


Problem Statement


# Problem Statement: Operation Clean Slate

## Background

A financial institution maintains a large client database accumulated over years of onboarding, migrations, and data imports. Over time, the same client may have been entered multiple times — under slightly different names, addresses, or contact details — resulting in **duplicate client records**.

A client's true identity is anchored by their **Social Security Number (SSN)**. When two or more records share an SSN, they represent the same person and must be consolidated.

Your job is to build a system that detects these duplicates, recommends the best consolidated record, and allows operations staff to review and approve merges. **AI/ML techniques are encouraged** — use them where they add value, such as smarter duplicate detection, intelligent field selection, or confidence-based triaging of merge recommendations.

---

## The Problem

Duplicate client records cause downstream issues: incorrect mailings, split transaction histories, compliance failures, and inaccurate reporting. Manual deduplication at scale is error-prone and slow.

A dataset of client records will be provided. Each record looks like:

```json
{
  "record_id": "REC-1042",
  "ssn": "123-45-6789",
  "first_name": "John",
  "last_name": "Doe",
  "date_of_birth": "1985-03-22",
  "address": "123 Main St, New York, NY 10001",
  "phone_number": "+1-212-555-0100",
  "email": "john.doe@example.com",
  "created_at": "2021-07-14T09:30:00Z"
}
```

The dataset will contain **1000s of client records** across ** multiple unique SSNs**, meaning a significant portion of records are duplicates.

---

## What You Must Build

### 1. Duplicate Detection

Identify all groups of records that share the same SSN. Each group with more than one record is a **duplicate group** requiring consolidation.

> **AI opportunity:** Beyond exact SSN matching, consider using an AI/ML model (e.g., a similarity model or a fine-tuned classifier) to detect *near-duplicate* records where SSNs may contain typos or OCR errors. The model should produce a **match confidence score (0–100%)** for each candidate duplicate pair.

### 2. Merge Recommendation Engine

For each duplicate group, produce a single **recommended consolidated record** by applying field-level selection rules:

| Field | Recommended Rule |
|-------|-----------------|
| `first_name` | Most frequently occurring value |
| `last_name` | Most frequently occurring value |
| `date_of_birth` | Most frequently occurring value |
| `address` | Addresses must be **fuzzy-matched** before comparison — treat suffix variants as equivalent (e.g. `Street` = `St` = `St.`, `Avenue` = `Ave` = `Av`); select the value from the most recently created record within the matched group |
| `phone_number` | Most frequently occurring value; tie-break: most recent |
| `email` | Value from the most recently created record |

Participants may implement additional or alternative rules — document your reasoning clearly.

> **AI opportunity:** Use an AI model to score each candidate field value and assign a **per-field confidence score (0–100%)** reflecting how likely that value is to be the correct canonical value. For example, a name appearing in 4 out of 5 records might score 92%, while a one-off address variant might score 40%. These scores feed directly into the review interface.
> 
> **Address fuzzy matching note:** The dataset deliberately contains address variants that refer to the same physical location but differ in notation (e.g. `123 Main Street` vs `123 Main St` vs `123 Main St.`). A naive string equality check will treat these as different addresses. Your solution must normalise or fuzzy-match addresses before applying the selection rule — consider token-level normalisation, edit-distance matching, or a learned address embedding model.

### 3. Review Interface

Present the merge recommendations to the user before any data is changed. For each duplicate group, show:

- All source records side-by-side
- The proposed consolidated record with the selected value for each field **highlighted and labelled** with the rule that chose it (e.g., `most frequent`, `latest entry`) and its **AI confidence score** (e.g., `92% confident`)
- A **group-level overall confidence score** summarising how certain the system is that all records in the group belong to the same person — high-confidence groups may be auto-approvable; low-confidence groups must require mandatory human review
- A clear **approve / reject** action per group

### 4. Merge & Purge

Upon user approval of a group:

- Write the consolidated record as the single canonical entry (retaining the oldest `record_id` or generating a new one — your choice, document it)
- Mark or delete all redundant duplicate records
- Produce an **audit log** of every merge action taken

---

## Input / Output

**Input:** A JSON array of client records:

```json
[
  {
    "record_id": "REC-1001",
    "ssn": "123-45-6789",
    "first_name": "John",
    "last_name": "Doe",
    "date_of_birth": "1985-03-22",
    "address": "123 Main St, New York, NY 10001",
    "phone_number": "+1-212-555-0100",
    "email": "john.doe@example.com",
    "created_at": "2019-04-10T08:00:00Z"
  },
  {
    "record_id": "REC-1042",
    "ssn": "123-45-6789",
    "first_name": "Jon",
    "last_name": "Doe",
    "date_of_birth": "1985-03-22",
    "address": "456 Broadway, New York, NY 10002",
    "phone_number": "+1-212-555-0100",
    "email": "jdoe@gmail.com",
    "created_at": "2023-11-01T14:22:00Z"
  }
]
```

**Output:**
- `merged_clients.json` — the deduplicated canonical client list
- `duplicates_removed.json` — all records that were purged
- `audit_log.json` — a record of every merge decision, including which rule selected each field value and the AI confidence scores at the time of approval

---

## Evaluation

| Criterion | Example |
|-----------|---------|
| Correct duplicate group detection (all SSN collisions found) | SSN `123-45-6789` appears on REC-1001, REC-1042, and REC-1087 — all three must be identified as one duplicate group; missing any one of them is a detection failure |
| Merge recommendation accuracy (rules applied correctly per field) | `first_name = "John"` appears in 2 of 3 records vs `"Jon"` in 1 — the recommended value must be `"John"` (most frequent); for `address`, `"123 Main Street"`, `"123 Main St."`, and `"123 Main St"` must be recognised as the same address via fuzzy matching before the most-recent rule is applied — failing to normalise them first is scored as incorrect |
| Review interface clarity (source records, proposed merge, rule labels, confidence scores) | The UI shows all three source records side-by-side, the proposed consolidated record highlights `address = "789 Park Ave"` labelled `latest entry — 78% confident`, and presents an Approve / Reject button for the group |
| Correct merge & purge execution (canonical record written, duplicates removed) | After approval, `merged_clients.json` contains exactly one record for SSN `123-45-6789`; `duplicates_removed.json` contains the two retired records; neither file contains a duplicate SSN |
| Audit log completeness and accuracy | `audit_log.json` contains an entry for the John Doe merge recording: timestamp, which records were retired, which value was chosen per field, and the rule + confidence score that drove each choice |
| Code quality & extensibility of rule engine | Adding a new field selection rule (e.g. `earliest entry`) requires changing only the rule configuration — not modifying merge or detection logic |

---

## Example Walkthrough

**John Doe** appears three times in the dataset, all with SSN `123-45-6789`:

| record_id | first_name | address | phone_number | created_at |
|-----------|------------|---------|--------------|------------|
| REC-1001 | John | 123 Main Street, New York, NY 10001 | +1-212-555-0100 | 2019-04-10 |
| REC-1042 | Jon | 123 Main St., New York, NY 10001 | +1-212-555-0100 | 2023-11-01 |
| REC-1087 | John | 123 Main St, New York, NY 10001 | +1-212-555-0199 | 2024-06-15 |

Your system should:
1. **Detect** all three records as a duplicate group (same SSN) — AI match confidence: **98%** (exact SSN match across all three)
2. **Fuzzy-match addresses** — `"123 Main Street"`, `"123 Main St."`, and `"123 Main St"` all resolve to the same location after suffix normalisation; a string equality check alone would incorrectly treat them as three distinct addresses
3. **Recommend** field values with per-field AI confidence scores:
   - `first_name = "John"` — most frequent (2 vs 1), confidence **91%**
   - `address = "123 Main St, New York, NY 10001"` — most recent after fuzzy grouping, confidence **85%**
   - `phone_number = "+1-212-555-0100"` — most frequent (2 vs 1), confidence **95%**
4. **Present** this recommendation for user review with rule labels and confidence scores shown alongside each field
5. On approval, **write** one canonical John Doe record and **purge** REC-1042 and REC-1087 (or whichever duplicates are retired)

---

## Stretch Goals (for fast teams)

- Use an **AI-powered fuzzy matching model** — go beyond SSN to detect potential duplicates using a combination of name similarity, date of birth, and address proximity even when SSNs differ; present these as low-confidence candidate groups for manual review.
- Support **bulk approval** — allow operations staff to approve all low-risk merge groups (e.g., where all fields agree except address) in a single action.
- Produce a **data quality report**: total duplicates found, fields most commonly in conflict, and estimated data quality score before and after deduplication.
- Allow **custom rule configuration** — let the user override the default field selection rule (e.g., prefer `earliest entry` over `most frequent` for a specific field) before running the merge.