import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestApp, createTestApp, type TestApp } from '../helpers/app.js';
import { registerCustomer, safeJson, uniqueEmail } from '../helpers/api.js';

let h: TestApp;

beforeAll(async () => {
  h = await createTestApp(process.env.TEST_DATABASE_URL!);
});
afterAll(async () => {
  await closeTestApp(h);
});

const PASSWORD = 'Password-123!';

interface RegisterResponse {
  readonly tokens: { readonly accessToken: string; readonly refreshToken: string };
  readonly customer: { readonly id: string; readonly role: string };
}

async function registerFull(
  email: string,
): Promise<{ statusCode: number; body: RegisterResponse }> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { email, fullName: 'Auth Test', password: PASSWORD },
  });
  return { statusCode: res.statusCode, body: safeJson(res.body) as RegisterResponse };
}

describe('authentication', () => {
  it('registers a customer and issues usable tokens', async () => {
    const email = uniqueEmail('auth');
    const { statusCode, body } = await registerFull(email);
    expect(statusCode).toBe(201);
    expect(body.tokens.accessToken).toBeTruthy();
    expect(body.tokens.refreshToken).toBeTruthy();

    const me = await h.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${body.tokens.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(email);
  });

  it('logs in with correct credentials', async () => {
    const email = uniqueEmail('login');
    await registerFull(email);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tokens.accessToken).toBeTruthy();
  });

  it('rejects a wrong password', async () => {
    const email = uniqueEmail('wrongpw');
    await registerFull(email);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'WrongPassword-999!' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('does not reveal whether an account exists (enumeration resistance)', async () => {
    const known = uniqueEmail('known');
    await registerFull(known);

    const wrongPassword = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: known, password: 'Definitely-Wrong-1!' },
    });
    const unknownEmail = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: uniqueEmail('ghost'), password: 'Definitely-Wrong-1!' },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json().error.code).toBe(unknownEmail.json().error.code);
    expect(wrongPassword.json().error.message).toBe(unknownEmail.json().error.message);
  });

  it('rotates refresh tokens and detects reuse of a revoked token', async () => {
    const email = uniqueEmail('refresh');
    const { body } = await registerFull(email);
    const originalRefresh: string = body.tokens.refreshToken;

    const rotated = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: originalRefresh },
    });
    expect(rotated.statusCode).toBe(200);
    const newRefresh: string = rotated.json().refreshToken;
    expect(newRefresh).not.toBe(originalRefresh);

    // Reusing the rotated (revoked) token is treated as theft and revokes the family.
    const reuse = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: originalRefresh },
    });
    expect(reuse.statusCode).toBe(401);

    // The whole family is now revoked, including the token issued after rotation.
    const afterFamilyRevocation = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: newRefresh },
    });
    expect(afterFamilyRevocation.statusCode).toBe(401);
  });

  it('rejects an invalid access token', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('registers customers without privilege escalation', async () => {
    const { body } = await registerFull(uniqueEmail('rolecheck'));
    const me = await h.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${body.tokens.accessToken}` },
    });
    expect(me.json().role).toBe('customer');
  });

  it('exposes a registered customer helper for other suites', async () => {
    const customer = await registerCustomer(h.app);
    expect(customer.token).toBeTruthy();
  });
});
