// Adaptador del puerto AccessTokens: JWT HS256 de vida corta (AD-11).
// Solo se acepta el algoritmo, el emisor y la audiencia propios.
import { jwtVerify, SignJWT } from 'jose';
import type { AccessTokens, IssuedAccessToken } from '../../aplicacion/access-tokens.js';
import type { Clock } from '../../aplicacion/clock.js';
import type { SecurityContext } from '../../aplicacion/security-context.js';
import { isRole } from '../../dominio/roles.js';

const ALGORITHM = 'HS256';
const ISSUER = 'pos-api';
const AUDIENCE = 'pos-web';
const MIN_SECRET_LENGTH = 32;
export const ACCESS_TOKEN_TTL_SECONDS = 5 * 60;

export class JoseAccessTokens implements AccessTokens {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly clock: Clock,
    private readonly ttlSeconds = ACCESS_TOKEN_TTL_SECONDS,
  ) {
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error('AUTH_TOKEN_SECRET es demasiado corto. Corré `npm run db:setup`.');
    }
    this.key = new TextEncoder().encode(secret);
  }

  async issue(context: SecurityContext): Promise<IssuedAccessToken> {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    const expiresAt = issuedAt + this.ttlSeconds;
    const token = await new SignJWT({
      tid: context.tenantId,
      rol: context.activeRole,
      suc: context.branchIds,
      sid: context.sessionId,
    })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(context.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.key);
    return { token, expiresAt: new Date(expiresAt * 1000) };
  }

  async verify(token: string): Promise<SecurityContext | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [ALGORITHM],
        issuer: ISSUER,
        audience: AUDIENCE,
        currentDate: this.clock.now(),
      });
      const { sub, tid, rol, suc, sid } = payload;
      if (
        typeof sub !== 'string' ||
        (tid !== null && typeof tid !== 'string') ||
        (rol !== null && !isRole(rol)) ||
        !Array.isArray(suc) ||
        !suc.every((branch) => typeof branch === 'string') ||
        typeof sid !== 'string'
      ) {
        return null;
      }
      return { userId: sub, tenantId: tid, activeRole: rol, branchIds: suc, sessionId: sid };
    } catch {
      return null;
    }
  }
}
