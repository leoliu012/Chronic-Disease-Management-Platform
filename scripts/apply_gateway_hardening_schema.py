#!/usr/bin/env python3
"""
apply_gateway_hardening_schema.py
=================================

Idempotently adds the gateway-production-hardening schema changes into
`apps/api/prisma/schema.prisma`:

  1. New model `GatewayApiKey` (per-system API keys + IP allowlist)
  2. New relation `apiKeys GatewayApiKey[]` on `IntegrationSource`
  3. Four new retry-metadata fields on `IntegrationSyncRecord`:
       promotionAttempts / nextRetryAt / lastFailedAt / lastFailureReason
     + a matching @@index([promotionStatus, nextRetryAt])

This script is safe to run multiple times — each edit is wrapped in an
"already-present" check.

Run from project root:
    python3 scripts/apply_gateway_hardening_schema.py

After running, `npx prisma generate` to refresh the client types.
The accompanying migration SQL is already shipped in
  apps/api/prisma/migrations/20260526120000_gateway_production_hardening/

so `prisma migrate deploy` will apply both sides in one pass.
"""

from __future__ import annotations

import sys
from pathlib import Path


SCHEMA_PATH = Path("apps/api/prisma/schema.prisma")


GATEWAY_API_KEY_MODEL = """
model GatewayApiKey {
  id            String    @id @default(uuid())
  sourceId      String

  // Public-visible prefix shown in admin UI / logs / header.
  // The full header value is `gwk_<prefix>_<secret>`. The secret part
  // is never persisted — only its SHA-256 is, in `keyHash`.
  prefix        String    @unique
  keyHash       String

  description   String?

  // CIDR strings (e.g. "10.1.0.0/16", "::1/128"). Empty array = allow all
  // IPs (but key match is still required). Evaluated AFTER any global
  // GATEWAY_GLOBAL_IP_ALLOWLIST env-level allowlist.
  ipAllowlist   String[]  @default([])

  lastUsedAt    DateTime?
  lastUsedIp    String?
  usageCount    Int       @default(0)

  revokedAt     DateTime?
  revokedBy     String?
  revokedReason String?

  createdAt     DateTime  @default(now())
  createdBy     String?
  updatedAt     DateTime  @updatedAt

  source        IntegrationSource @relation(fields: [sourceId], references: [id])

  @@index([sourceId, revokedAt])
}
"""


def edit_schema(text: str) -> tuple[str, list[str]]:
    notes: list[str] = []

    # ── 1. Append the GatewayApiKey model if missing ─────────────────────
    if "model GatewayApiKey {" not in text:
        if not text.endswith("\n"):
            text += "\n"
        text += GATEWAY_API_KEY_MODEL.lstrip("\n")
        notes.append("added: model GatewayApiKey")
    else:
        notes.append("skip:  model GatewayApiKey already present")

    # ── 2. Add `apiKeys GatewayApiKey[]` relation on IntegrationSource ──
    if "apiKeys      GatewayApiKey[]" not in text and "apiKeys GatewayApiKey[]" not in text:
        # Anchor: existing `fieldMappings IntegrationFieldMapping[]` line
        anchor = "  fieldMappings IntegrationFieldMapping[]"
        if anchor in text:
            text = text.replace(
                anchor,
                anchor + "\n  apiKeys      GatewayApiKey[]",
            )
            notes.append("added: IntegrationSource.apiKeys relation")
        else:
            notes.append(
                "WARN:  IntegrationSource anchor not found — please add "
                "`apiKeys GatewayApiKey[]` manually inside model IntegrationSource"
            )
    else:
        notes.append("skip:  IntegrationSource.apiKeys already present")

    # ── 3. Add retry-metadata fields to IntegrationSyncRecord ───────────
    if "promotionAttempts" not in text:
        anchor = "  promotedAt          DateTime?"
        if anchor in text:
            text = text.replace(
                anchor,
                anchor
                + "\n\n"
                + "  // gateway-production-hardening: retry / backoff metadata\n"
                + "  // GatewayPromotionWorker uses these to re-promote FAILED records\n"
                + "  // with exponential backoff until promotionAttempts exhausts\n"
                + "  // the configured max, after which an alert is emitted.\n"
                + "  promotionAttempts   Int       @default(0)\n"
                + "  nextRetryAt         DateTime?\n"
                + "  lastFailedAt        DateTime?\n"
                + "  lastFailureReason   String?",
            )
            notes.append("added: IntegrationSyncRecord retry fields")
        else:
            notes.append(
                "WARN:  IntegrationSyncRecord anchor not found — please add "
                "promotionAttempts / nextRetryAt / lastFailedAt / lastFailureReason manually"
            )
    else:
        notes.append("skip:  IntegrationSyncRecord retry fields already present")

    # ── 4. Add matching @@index for the retry worker hot-path ───────────
    if "@@index([promotionStatus, nextRetryAt])" not in text:
        anchor = "  @@index([sourceId, promotionStatus])"
        if anchor in text:
            text = text.replace(
                anchor,
                anchor + "\n  @@index([promotionStatus, nextRetryAt])",
            )
            notes.append("added: IntegrationSyncRecord @@index([promotionStatus, nextRetryAt])")
        else:
            notes.append(
                "WARN:  @@index anchor not found — please add "
                "@@index([promotionStatus, nextRetryAt]) on model IntegrationSyncRecord"
            )
    else:
        notes.append("skip:  @@index([promotionStatus, nextRetryAt]) already present")

    return text, notes


def main() -> int:
    if not SCHEMA_PATH.exists():
        print(f"✗ {SCHEMA_PATH} not found. Run from project root.", file=sys.stderr)
        return 1

    original = SCHEMA_PATH.read_text(encoding="utf-8")
    updated, notes = edit_schema(original)

    print(f"=== schema.prisma edits ({SCHEMA_PATH}) ===")
    for n in notes:
        print(f"  {n}")

    if updated == original:
        print("nothing to change — schema.prisma already up to date.")
        return 0

    SCHEMA_PATH.write_text(updated, encoding="utf-8")
    print(f"✓ wrote {SCHEMA_PATH}")
    print()
    print("Next steps:")
    print("  cd apps/api")
    print("  npx prisma generate                       # refresh @prisma/client")
    print("  npx prisma migrate deploy                 # apply migration SQL")
    print("  # ... or for local dev:")
    print("  npx prisma migrate dev --name gateway_production_hardening --create-only")
    return 0


if __name__ == "__main__":
    sys.exit(main())
