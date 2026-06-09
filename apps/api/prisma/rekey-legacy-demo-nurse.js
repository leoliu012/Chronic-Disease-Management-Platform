#!/usr/bin/env node
/*
 * Rekey the historical fixed demo nurse ID without keeping the old identifier
 * in application source. Run once after applying clinical-access-scope-v4.
 *
 *   node prisma/rekey-legacy-demo-nurse.js --dry-run
 *   node prisma/rekey-legacy-demo-nurse.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const legacyId = ['nurse', '001'].join('-');
const nextId = 'demo-care-nurse-a';

function qident(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function scanReferences(tx) {
  const columns = await tx.$queryRawUnsafe(`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND data_type = 'text'
     ORDER BY table_name, ordinal_position
  `);
  const refs = [];
  for (const { table_name: tableName, column_name: columnName } of columns) {
    if (tableName === '_prisma_migrations') continue;
    if (tableName === 'User' && columnName === 'id') continue;
    const rows = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM ${qident(tableName)} WHERE ${qident(columnName)} = $1`,
      legacyId,
    );
    const count = Number(rows[0]?.count || 0);
    if (count > 0) refs.push({ tableName, columnName, count });
  }
  return refs;
}

async function main() {
  const oldUser = await prisma.user.findUnique({ where: { id: legacyId } });
  const newUser = await prisma.user.findUnique({ where: { id: nextId } });
  if (!oldUser) {
    console.log('[done] no historical fixed demo nurse ID found. Nothing to migrate.');
    if (newUser) console.log(`[ok] current demo nurse exists: ${nextId}`);
    return;
  }

  const refs = await scanReferences(prisma);
  console.log(`[found] historical demo nurse user: ${oldUser.username}`);
  console.log(`[target] ${nextId}`);
  for (const ref of refs) console.log(`  - ${ref.tableName}.${ref.columnName}: ${ref.count}`);
  if (DRY_RUN) {
    console.log('[dry-run] no changes written. Re-run without --dry-run to apply.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    let target = await tx.user.findUnique({ where: { id: nextId } });
    if (!target) {
      const originalUsername = oldUser.username;
      await tx.user.update({
        where: { id: legacyId },
        data: { username: `${originalUsername}__legacy_rekey_${Date.now()}` },
      });
      target = await tx.user.create({
        data: {
          id: nextId,
          username: originalUsername,
          displayName: oldUser.displayName,
          role: oldUser.role,
          passwordHash: oldUser.passwordHash,
          isActive: oldUser.isActive,
          hospitalTenantId: oldUser.hospitalTenantId,
          createdAt: oldUser.createdAt,
        },
      });
    }

    const liveRefs = await scanReferences(tx);
    for (const { tableName, columnName } of liveRefs) {
      await tx.$executeRawUnsafe(
        `UPDATE ${qident(tableName)} SET ${qident(columnName)} = $1 WHERE ${qident(columnName)} = $2`,
        nextId,
        legacyId,
      );
    }
    await tx.user.delete({ where: { id: legacyId } });
  });

  console.log(`[done] migrated historical demo nurse references to ${nextId} and removed the old user row.`);
}

main()
  .catch((error) => {
    console.error('[err] rekey failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
