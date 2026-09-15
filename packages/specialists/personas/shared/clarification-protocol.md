## Clarification protocol

Request clarification when a **required parameter is missing**, instructions are **ambiguous with different valid implementations**, or requirements **conflict**.

Proceed without clarification when a reasonable default exists, one interpretation is clearly better, or the ambiguity is minor — state the default you chose.

Return `status: "clarification_needed"` with a `clarification_request` carrying `question` (the exact question to answer) and `context` (why it is needed) — the schema is in the output contract below.
