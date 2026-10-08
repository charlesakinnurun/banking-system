import type { Customer } from '../domain/customer.js';
import type { CustomerId } from '../domain/enums.js';
import { ForbiddenError } from '../domain/errors.js';
import { assertPasswordStrength, normalizeEmail } from '../domain/password-policy.js';
import { sha256Hex } from '../shared/hash.js';
import type { Clock, IdGenerator, PasswordHasher, Repositories, TokenService } from './ports.js';

export interface RegisterRequest {
  readonly email: string;
  readonly fullName: string;
  readonly password: string;
}

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
  readonly userAgent?: string | null;
  readonly ip?: string | null;
}

export interface RefreshRequest {
  readonly refreshToken: string;
  readonly userAgent?: string | null;
  readonly ip?: string | null;
}

export interface AuthTokens {
  readonly tokenType: 'Bearer';
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}

export interface AuthenticatedResult {
  readonly customer: Customer;
  readonly tokens: AuthTokens;
}

/**
 * Login/refresh return a RESULT rather than throwing, because they record
 * security side effects (failed-attempt counters, refresh-token family
 * revocation) that MUST be committed. Throwing inside the unit of work would
 * roll those writes back — silently defeating brute-force protection and reuse
 * detection. The HTTP layer maps the failure reason to a response AFTER commit.
 */
export type LoginOutcome =
  | { readonly ok: true; readonly customer: Customer; readonly tokens: AuthTokens }
  | { readonly ok: false; readonly reason: 'invalid_credentials' | 'account_locked' | 'inactive' };

export type RefreshOutcome =
  | { readonly ok: true; readonly tokens: AuthTokens }
  | { readonly ok: false; readonly reason: 'invalid' | 'reuse' | 'inactive' };

export interface AuthServiceDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly hasher: PasswordHasher;
  readonly tokens: TokenService;
  readonly accessTtlSeconds: number;
  readonly refreshTokenTtlDays: number;
  readonly loginMaxFailedAttempts: number;
  readonly loginLockoutSeconds: number;
}

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  async register(repos: Repositories, input: RegisterRequest): Promise<AuthenticatedResult> {
    assertPasswordStrength(input.password);
    const email = normalizeEmail(input.email);

    const existing = await repos.customers.findByEmail(email);
    if (existing) {
      // NOTE: this reveals that the email is taken. Login is enumeration-safe;
      // registration is a documented, rate-limited tradeoff (see SECURITY.md).
      throw new ForbiddenError('An account with this email already exists');
    }

    const passwordHash = await this.deps.hasher.hash(input.password);
    const customer = await repos.customers.create({
      email,
      fullName: input.fullName,
      passwordHash,
      role: 'customer',
    });

    await repos.audit.record({
      actorId: customer.id,
      action: 'customer.registered',
      entityType: 'customer',
      entityId: customer.id,
      requestId: null,
      ip: null,
      metadata: { email: customer.email },
    });

    const tokens = await this.issueTokens(repos, customer.id, 'customer', {});
    return { customer, tokens };
  }

  async login(repos: Repositories, input: LoginRequest): Promise<LoginOutcome> {
    const email = normalizeEmail(input.email);
    const customer = await repos.customers.findByEmail(email);

    if (!customer) {
      // Equalize timing with the found-user path so response time does not
      // reveal whether the account exists (enumeration resistance).
      await this.deps.hasher.hash(input.password);
      return { ok: false, reason: 'invalid_credentials' };
    }

    const passwordOk = await this.deps.hasher.verify(input.password, customer.passwordHash);
    if (!passwordOk) {
      const { lockedUntil } = await repos.customers.recordFailedLogin(
        customer.id,
        this.deps.loginMaxFailedAttempts,
        this.deps.loginLockoutSeconds,
      );
      await repos.audit.record({
        actorId: customer.id,
        action: 'auth.login_failed',
        entityType: 'customer',
        entityId: customer.id,
        requestId: null,
        ip: input.ip ?? null,
        metadata: { lockedUntil: lockedUntil?.toISOString() ?? null },
      });
      return { ok: false, reason: 'invalid_credentials' };
    }

    // Password is correct from here on, so account state may be revealed.
    if (customer.lockedUntil && customer.lockedUntil.getTime() > this.deps.clock.now().getTime()) {
      return { ok: false, reason: 'account_locked' };
    }
    if (customer.status !== 'active') {
      return { ok: false, reason: 'inactive' };
    }

    await repos.customers.recordSuccessfulLogin(customer.id);
    await repos.audit.record({
      actorId: customer.id,
      action: 'auth.login_succeeded',
      entityType: 'customer',
      entityId: customer.id,
      requestId: null,
      ip: input.ip ?? null,
      metadata: {},
    });

    const tokens = await this.issueTokens(repos, customer.id, customer.role, {
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      ...(input.ip ? { ip: input.ip } : {}),
    });
    return { ok: true, customer, tokens };
  }

  async refresh(repos: Repositories, input: RefreshRequest): Promise<RefreshOutcome> {
    const tokenHash = sha256Hex(input.refreshToken);
    const record = await repos.refreshTokens.findByHash(tokenHash);
    if (!record) return { ok: false, reason: 'invalid' };

    if (record.revokedAt) {
      // Reuse of a rotated/revoked token: assume theft, revoke the whole family,
      // then let the caller return 401 AFTER this transaction commits.
      await repos.refreshTokens.revokeAllForCustomer(record.customerId);
      return { ok: false, reason: 'reuse' };
    }
    if (record.expiresAt.getTime() <= this.deps.clock.now().getTime()) {
      return { ok: false, reason: 'invalid' };
    }

    const customer = await repos.customers.findById(record.customerId);
    if (!customer) return { ok: false, reason: 'invalid' };
    if (customer.status !== 'active') return { ok: false, reason: 'inactive' };

    const next = await this.createRefreshToken(repos, record.customerId, {
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      ...(input.ip ? { ip: input.ip } : {}),
    });
    await repos.refreshTokens.revokeWithReplacement(record.id, next.id);

    return {
      ok: true,
      tokens: {
        tokenType: 'Bearer',
        accessToken: this.deps.tokens.signAccessToken({ sub: customer.id, role: customer.role }),
        expiresInSeconds: this.deps.accessTtlSeconds,
        refreshToken: next.plaintext,
        refreshExpiresAt: next.expiresAt,
      },
    };
  }

  async logout(repos: Repositories, refreshToken: string): Promise<void> {
    const tokenHash = sha256Hex(refreshToken);
    const record = await repos.refreshTokens.findByHash(tokenHash);
    if (record && !record.revokedAt) {
      await repos.refreshTokens.revoke(record.id);
    }
    // Idempotent: logging out an unknown token is not an error.
  }

  async logoutAll(repos: Repositories, customerId: CustomerId): Promise<void> {
    await repos.refreshTokens.revokeAllForCustomer(customerId);
  }

  private async issueTokens(
    repos: Repositories,
    customerId: CustomerId,
    role: Customer['role'],
    context: { userAgent?: string; ip?: string },
  ): Promise<AuthTokens> {
    const refresh = await this.createRefreshToken(repos, customerId, context);
    return {
      tokenType: 'Bearer',
      accessToken: this.deps.tokens.signAccessToken({ sub: customerId, role }),
      expiresInSeconds: this.deps.accessTtlSeconds,
      refreshToken: refresh.plaintext,
      refreshExpiresAt: refresh.expiresAt,
    };
  }

  private async createRefreshToken(
    repos: Repositories,
    customerId: CustomerId,
    context: { userAgent?: string; ip?: string },
  ): Promise<{ id: string; plaintext: string; expiresAt: Date }> {
    const plaintext = this.deps.ids.opaqueToken(32);
    const expiresAt = new Date(
      this.deps.clock.now().getTime() + this.deps.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );
    const created = await repos.refreshTokens.create({
      customerId,
      tokenHash: sha256Hex(plaintext),
      expiresAt,
      userAgent: context.userAgent ?? null,
      ip: context.ip ?? null,
    });
    return { id: created.id, plaintext, expiresAt };
  }
}
