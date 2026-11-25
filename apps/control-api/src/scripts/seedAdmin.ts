import { hashPassword } from '@web-legend/auth';
import { loadEnv } from '@web-legend/config';
import {
  BASE_CONTENT_BUNDLE,
  contentChecksum,
  validateContentBundle,
} from '@web-legend/content-schema';
import {
  activateContentRelease,
  createDatabase,
  findAdminByNormalizedUsername,
  findContentReleaseById,
  findDefaultActiveRelease,
  insertAdminUser,
  insertContentRelease,
  listActiveRealms,
  listContentReleases,
} from '@web-legend/persistence';
import { z } from 'zod';

const seedEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  ADMIN_SEED_USERNAME: z
    .string()
    .regex(/^[A-Za-z0-9_.-]{3,32}$/u)
    .default('admin'),
  ADMIN_SEED_PASSWORD: z.string().min(8).max(128).optional(),
});

const env = loadEnv(seedEnvSchema);

const isProduction = env.NODE_ENV === 'production';
if (isProduction && env.ADMIN_SEED_PASSWORD === undefined) {
  throw new Error('ADMIN_SEED_PASSWORD is required when seeding a production environment');
}
const password = env.ADMIN_SEED_PASSWORD ?? 'web-legend-admin';
const usernameNormalized = env.ADMIN_SEED_USERNAME.toLowerCase();

const database = createDatabase(env.DATABASE_URL, { max: 1 });

try {
  const realm = (await listActiveRealms(database.db))[0];
  if (realm === undefined) {
    throw new Error('no active realm; run `pnpm db:migrate` and the persistence seed first');
  }

  let admin = await findAdminByNormalizedUsername(database.db, usernameNormalized);
  if (admin === undefined) {
    admin = await insertAdminUser(database.db, {
      username: env.ADMIN_SEED_USERNAME,
      usernameNormalized,
      passwordHash: await hashPassword(password),
      role: 'super_admin',
    });
    process.stdout.write(`Created admin "${admin.username}" (${admin.role})\n`);
  } else {
    process.stdout.write(`Admin "${admin.username}" already exists; password unchanged\n`);
  }

  let release = (await listContentReleases(database.db, 1))[0];
  if (release === undefined) {
    const validation = validateContentBundle(BASE_CONTENT_BUNDLE);
    if (!validation.valid || validation.bundle === null) {
      throw new Error('baseline content bundle is invalid');
    }
    release = await insertContentRelease(database.db, {
      version: 'baseline',
      schemaVersion: validation.bundle.schemaVersion,
      checksum: contentChecksum(validation.bundle),
      payload: validation.bundle,
      changeSummary: { added: 0, removed: 0, changed: 0 },
      createdBy: admin.id,
      createdByUsername: admin.username,
      note: '随代码发布的基线内容',
      createdAt: new Date(),
    });
    process.stdout.write(`Created baseline content release ${release.version}\n`);
  } else {
    process.stdout.write(`Content release ${release.version} already exists\n`);
  }

  const active = await findDefaultActiveRelease(database.db);
  if (active === undefined) {
    const target = await findContentReleaseById(database.db, release.id);
    if (target === undefined) {
      throw new Error('baseline release disappeared during seeding');
    }
    await activateContentRelease(database.db, {
      realmId: realm.id,
      releaseId: target.id,
      adminUserId: admin.id,
      adminUsername: admin.username,
      reason: '初始化基线内容',
      now: new Date(),
    });
    process.stdout.write(`Activated content ${target.version} for realm ${realm.code}\n`);
  } else {
    process.stdout.write(`Realm ${realm.code} already uses content ${active.release.version}\n`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Admin seed failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  await database.close();
}
