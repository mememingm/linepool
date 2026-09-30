import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hash } from 'bcryptjs';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';

const seedConfigSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(12).max(128),
  displayName: z.string().trim().min(1).max(80),
});

export interface SeedConfig {
  email: string;
  password: string;
  displayName: string;
}

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HISTORICAL_ORDER_ID = '40000000-0000-4000-8000-000000000001';

const projects = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    slug: 'us-verification',
    name: '美国验证码',
    countryCode: 'US',
    countryName: '美国',
    description: '适用于演示注册和验证码接收流程的美国号码项目。',
    accentColor: '#246BFD',
    sortOrder: 1,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    slug: 'uk-services',
    name: '英国服务号码',
    countryCode: 'GB',
    countryName: '英国',
    description: '用于演示英国区服务和订单管理的号码资源。',
    accentColor: '#171717',
    sortOrder: 2,
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    slug: 'sg-business',
    name: '新加坡商务号码',
    countryCode: 'SG',
    countryName: '新加坡',
    description: '面向演示商务验证场景的新加坡号码项目。',
    accentColor: '#18794E',
    sortOrder: 3,
  },
] as const;

const plans = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    projectId: projects[0].id,
    name: '标准验证包',
    description: '30 天有效，适合单次演示流程。',
    unitPoints: 1200,
    durationDays: 30,
    sortOrder: 1,
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    projectId: projects[0].id,
    name: '长期验证包',
    description: '90 天有效，适合多轮演示。',
    unitPoints: 2800,
    durationDays: 90,
    sortOrder: 2,
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    projectId: projects[1].id,
    name: '英国标准包',
    description: '30 天有效的英国演示号码。',
    unitPoints: 1500,
    durationDays: 30,
    sortOrder: 1,
  },
  {
    id: '30000000-0000-4000-8000-000000000004',
    projectId: projects[2].id,
    name: '新加坡标准包',
    description: '30 天有效的新加坡演示号码。',
    unitPoints: 1800,
    durationDays: 30,
    sortOrder: 1,
  },
  {
    id: '30000000-0000-4000-8000-000000000005',
    projectId: projects[2].id,
    name: '新加坡季度包',
    description: '90 天有效，适合持续演示。',
    unitPoints: 4200,
    durationDays: 90,
    sortOrder: 2,
  },
] as const;

const phoneNumbers = [
  ['50000000-0000-4000-8000-000000000001', projects[0].id, '+12025550101', true],
  ['50000000-0000-4000-8000-000000000002', projects[0].id, '+12025550102', false],
  ['50000000-0000-4000-8000-000000000003', projects[0].id, '+12025550103', false],
  ['50000000-0000-4000-8000-000000000004', projects[0].id, '+12025550104', false],
  ['50000000-0000-4000-8000-000000000005', projects[0].id, '+12025550105', false],
  ['50000000-0000-4000-8000-000000000006', projects[0].id, '+12025550106', false],
  ['50000000-0000-4000-8000-000000000007', projects[1].id, '+442079460101', false],
  ['50000000-0000-4000-8000-000000000008', projects[1].id, '+442079460102', false],
  ['50000000-0000-4000-8000-000000000009', projects[1].id, '+442079460103', false],
  ['50000000-0000-4000-8000-000000000010', projects[1].id, '+442079460104', false],
  ['50000000-0000-4000-8000-000000000011', projects[1].id, '+442079460105', false],
  ['50000000-0000-4000-8000-000000000012', projects[2].id, '+6565550101', false],
  ['50000000-0000-4000-8000-000000000013', projects[2].id, '+6565550102', false],
  ['50000000-0000-4000-8000-000000000014', projects[2].id, '+6565550103', false],
  ['50000000-0000-4000-8000-000000000015', projects[2].id, '+6565550104', false],
  ['50000000-0000-4000-8000-000000000016', projects[2].id, '+6565550105', false],
] as const;

async function seedProjects(client: PoolClient): Promise<void> {
  for (const project of projects) {
    await client.query(
      `
        INSERT INTO projects(
          id, slug, name, country_code, country_name, description,
          accent_color, is_active, sort_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
        ON CONFLICT (id) DO UPDATE SET
          slug = EXCLUDED.slug,
          name = EXCLUDED.name,
          country_code = EXCLUDED.country_code,
          country_name = EXCLUDED.country_name,
          description = EXCLUDED.description,
          accent_color = EXCLUDED.accent_color,
          sort_order = EXCLUDED.sort_order,
          updated_at = now()
      `,
      [
        project.id,
        project.slug,
        project.name,
        project.countryCode,
        project.countryName,
        project.description,
        project.accentColor,
        project.sortOrder,
      ],
    );
  }
}

async function seedPlans(client: PoolClient): Promise<void> {
  for (const plan of plans) {
    await client.query(
      `
        INSERT INTO plans(
          id, project_id, name, description, unit_points,
          duration_days, is_active, sort_order
        ) VALUES ($1, $2, $3, $4, $5, $6, true, $7)
        ON CONFLICT (id) DO UPDATE SET
          project_id = EXCLUDED.project_id,
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          unit_points = EXCLUDED.unit_points,
          duration_days = EXCLUDED.duration_days,
          sort_order = EXCLUDED.sort_order,
          updated_at = now()
      `,
      [
        plan.id,
        plan.projectId,
        plan.name,
        plan.description,
        plan.unitPoints,
        plan.durationDays,
        plan.sortOrder,
      ],
    );
  }
}

async function seedInventory(client: PoolClient): Promise<void> {
  for (const [id, projectId, phoneNumber, isAssigned] of phoneNumbers) {
    await client.query(
      `
        INSERT INTO phone_numbers(
          id, project_id, phone_number, status, assigned_user_id,
          assigned_order_id, assigned_at, expires_at
        ) VALUES (
          $1, $2, $3, $4,
          CASE WHEN $5 THEN $6::uuid ELSE NULL END,
          CASE WHEN $5 THEN $7::uuid ELSE NULL END,
          CASE WHEN $5 THEN now() - interval '2 days' ELSE NULL END,
          CASE WHEN $5 THEN now() + interval '28 days' ELSE NULL END
        )
        ON CONFLICT (id) DO UPDATE SET
          project_id = EXCLUDED.project_id,
          phone_number = EXCLUDED.phone_number
      `,
      [
        id,
        projectId,
        phoneNumber,
        isAssigned ? 'ASSIGNED' : 'AVAILABLE',
        isAssigned,
        USER_ID,
        HISTORICAL_ORDER_ID,
      ],
    );
  }
}

export async function seedDatabase(
  pool: Pool,
  input: SeedConfig,
): Promise<void> {
  const seed = seedConfigSchema.parse(input);
  const passwordHash = await hash(seed.password, 12);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `
        INSERT INTO users(
          id, email, password_hash, display_name, is_demo, points_balance
        ) VALUES ($1, $2, $3, $4, true, 18800)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          password_hash = EXCLUDED.password_hash,
          display_name = EXCLUDED.display_name,
          is_demo = true,
          updated_at = now()
      `,
      [USER_ID, seed.email, passwordHash, seed.displayName],
    );

    await seedProjects(client);
    await seedPlans(client);

    await client.query(
      `
        INSERT INTO orders(
          id, order_number, user_id, project_id, plan_id, quantity,
          total_points, status, idempotency_key, created_at
        ) VALUES (
          $1, 'LP-DEMO-0001', $2, $3, $4, 1,
          1200, 'COMPLETED', '40000000-0000-4000-8000-000000000099',
          now() - interval '2 days'
        ) ON CONFLICT (id) DO NOTHING
      `,
      [HISTORICAL_ORDER_ID, USER_ID, projects[0].id, plans[0].id],
    );

    await seedInventory(client);

    await client.query(
      `
        INSERT INTO point_ledger(
          id, user_id, type, delta, balance_after, description, reference_id, created_at
        ) VALUES
          ('60000000-0000-4000-8000-000000000001', $1, 'SEED_CREDIT', 20000, 20000, '演示账户初始积分', NULL, now() - interval '3 days'),
          ('60000000-0000-4000-8000-000000000002', $1, 'ORDER_DEBIT', -1200, 18800, '购买美国验证码 / 标准验证包', $2, now() - interval '2 days')
        ON CONFLICT (id) DO NOTHING
      `,
      [USER_ID, HISTORICAL_ORDER_ID],
    );

    await client.query(
      `
        INSERT INTO sms_messages(
          id, user_id, phone_number_id, sender, body,
          verification_code, received_at, is_read
        ) VALUES
          ('70000000-0000-4000-8000-000000000001', $1, $2, 'LINEPOOL Demo', '您的演示验证码是 482913，请勿向他人透露。', '482913', now() - interval '5 hours', false),
          ('70000000-0000-4000-8000-000000000002', $1, $2, 'Sample Service', '欢迎使用 LINEPOOL 演示号码，本消息不来自真实服务。', NULL, now() - interval '1 day', true)
        ON CONFLICT (id) DO NOTHING
      `,
      [USER_ID, phoneNumbers[0][0]],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const seed = seedConfigSchema.parse({
    email: process.env.DEMO_USER_EMAIL,
    password: process.env.DEMO_USER_PASSWORD,
    displayName: process.env.DEMO_USER_NAME,
  });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await seedDatabase(pool, seed);
    console.info(`Seeded demo account ${seed.email}.`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
