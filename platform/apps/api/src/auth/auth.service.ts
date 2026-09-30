import { createHash, randomBytes } from 'node:crypto';

import type { LoginInput, User } from '@linepool/contracts';
import { HttpStatus, Injectable } from '@nestjs/common';
import { compare } from 'bcryptjs';

import { EnvironmentService } from '../config/environment.service.js';
import { DatabaseService } from '../database/database.service.js';
import { ApiException } from '../errors/api-exception.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  is_demo: boolean;
  points_balance: number;
  created_at: Date;
}

const DUMMY_PASSWORD_HASH =
  '$2b$12$C6UzMDM.H6dfI/f/IKcEe.5Jt4p9bK7W1C6kqu1hGdFQj9Hkk6dMS';

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isDemo: row.is_demo,
    pointsBalance: row.points_balance,
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly environment: EnvironmentService,
  ) {}

  async login(input: LoginInput): Promise<{ token: string; user: User }> {
    const result = await this.database.query<UserRow>(
      `
        SELECT id, email, password_hash, display_name, is_demo,
               points_balance, created_at
        FROM users
        WHERE email = $1
        LIMIT 1
      `,
      [input.email],
    );
    const row = result.rows[0];
    const passwordMatches = await compare(
      input.password,
      row?.password_hash ?? DUMMY_PASSWORD_HASH,
    );

    if (!row || !passwordMatches) {
      throw new ApiException(
        'INVALID_CREDENTIALS',
        '邮箱或密码不正确',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(
      Date.now() + this.environment.sessionTtlHours * 60 * 60 * 1000,
    );
    await this.database.query(
      `
        INSERT INTO sessions(token_hash, user_id, expires_at)
        VALUES ($1, $2, $3)
      `,
      [tokenHash, row.id, expiresAt],
    );

    return { token, user: mapUser(row) };
  }

  async userForToken(token: string): Promise<User | null> {
    const result = await this.database.query<UserRow>(
      `
        SELECT u.id, u.email, u.password_hash, u.display_name, u.is_demo,
               u.points_balance, u.created_at
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()
        LIMIT 1
      `,
      [hashSessionToken(token)],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.database.query('DELETE FROM sessions WHERE token_hash = $1', [
      hashSessionToken(token),
    ]);
  }
}
