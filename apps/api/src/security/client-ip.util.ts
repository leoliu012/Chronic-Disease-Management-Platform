import { ipInCidrList, normalizeIp } from '../gateway/utils/cidr-match.util';

type HeaderValue = string | string[] | undefined;

export type ClientIpRequest = {
  headers?: Record<string, HeaderValue>;
  socket?: { remoteAddress?: string | null };
  ip?: string | null;
};

export type ClientIpResolution = {
  clientIp: string | null;
  remoteAddress: string | null;
  forwardedFor: string | null;
  trustedProxy: boolean;
};

export function trustedProxyCidrs(): string[] {
  return String(process.env.TRUSTED_PROXY_CIDRS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isTrustedProxyAddress(rawIp?: string | null): boolean {
  const remote = normalizeIp(rawIp);
  const allowlist = trustedProxyCidrs();
  return Boolean(remote && allowlist.length > 0 && ipInCidrList(remote, allowlist));
}

export function resolveClientIp(request: ClientIpRequest): ClientIpResolution {
  const remoteAddress = normalizeIp(request.socket?.remoteAddress ?? request.ip ?? null);
  const forwardedHeader = request.headers?.['x-forwarded-for'];
  const forwardedFor = normalizeIp(Array.isArray(forwardedHeader) ? forwardedHeader[0] : forwardedHeader);
  const trustedProxy = isTrustedProxyAddress(remoteAddress);
  return {
    clientIp: trustedProxy && forwardedFor ? forwardedFor : remoteAddress,
    remoteAddress,
    forwardedFor: trustedProxy ? forwardedFor : null,
    trustedProxy,
  };
}
