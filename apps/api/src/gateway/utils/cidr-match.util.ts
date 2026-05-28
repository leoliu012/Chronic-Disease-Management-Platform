/**
 * cidr-match.util.ts
 *
 * 零依赖 CIDR 匹配, 给 GatewayApiKeyGuard 做 IP 白名单用.
 *
 * 设计:
 *   - 支持 IPv4 单 IP / 网段
 *   - 支持 IPv6 完整地址 (业务上极少, 但 ::1 / 链路本地 至少要能匹配)
 *   - x-forwarded-for 形如 "203.0.113.1, 10.0.0.5" 取第一个
 *   - 当 IP 是 IPv6 mapped IPv4 (e.g. "::ffff:192.168.1.10") 时自动剥掉前缀
 *
 * 不依赖 ip / cidr-matcher / netmask 等 npm 包 ——
 * 医院内网部署希望 npm 依赖越少越好.
 */

export function normalizeIp(rawIp: string | undefined | null): string | null {
  if (!rawIp) return null;
  const first = rawIp.split(',')[0]?.trim() ?? '';
  if (!first) return null;
  // ::ffff:192.168.1.10 -> 192.168.1.10
  const v4Mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(first);
  if (v4Mapped) return v4Mapped[1];
  return first;
}

/**
 * 判断 ip 是否落在 allowlist 中任意 CIDR. allowlist 为空数组时返回 true
 * (调用方决定空数组表示 "未配置 = 放行" 还是 "未配置 = 拒绝").
 */
export function ipInCidrList(ip: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  for (const cidr of allowlist) {
    if (ipInCidr(ip, cidr)) return true;
  }
  return false;
}

/**
 * 单个 CIDR 匹配. cidr 可以是 "10.1.0.0/16" 或裸 IP "10.1.0.5"
 * (后者等价于 /32 完全匹配).
 */
export function ipInCidr(ip: string, cidr: string): boolean {
  const trimmed = cidr.trim();
  if (!trimmed) return false;
  const slash = trimmed.indexOf('/');
  if (slash < 0) {
    return ip === trimmed;
  }
  const network = trimmed.slice(0, slash);
  const mask = Number.parseInt(trimmed.slice(slash + 1), 10);
  if (!Number.isFinite(mask) || mask < 0) return false;

  // 都看作 IPv4
  if (!network.includes(':') && !ip.includes(':')) {
    return ipv4InCidr(ip, network, mask);
  }
  // 都看作 IPv6 — 精度只到 128 位, 用 BigInt
  if (network.includes(':') && ip.includes(':')) {
    return ipv6InCidr(ip, network, mask);
  }
  // 不同家族 — 不匹配
  return false;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number.parseInt(p, 10);
    if (!Number.isFinite(v) || v < 0 || v > 255) return null;
    // 注意要用 *2^8 而不是 << 8, 因为 << 在 JS 是 32-bit signed,
    // 高位为 1 的 IP (>=128.0.0.0) 会出负数. * 256 走 64-bit float, 安全.
    n = n * 256 + v;
  }
  return n;
}

function ipv4InCidr(ip: string, network: string, mask: number): boolean {
  if (mask > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const netInt = ipv4ToInt(network);
  if (ipInt === null || netInt === null) return false;
  if (mask === 0) return true;
  // 用 BigInt 做位掩码避免符号位坑
  const shift = BigInt(32 - mask);
  const maskBig = ((1n << 32n) - 1n) ^ ((1n << shift) - 1n);
  return (BigInt(ipInt) & maskBig) === (BigInt(netInt) & maskBig);
}

function ipv6ToBigInt(ip: string): bigint | null {
  // 仅支持完整或 :: 压缩格式
  if (!/^[0-9a-fA-F:]+$/.test(ip)) return null;
  let head: string[] = [];
  let tail: string[] = [];
  if (ip.includes('::')) {
    const [h, t] = ip.split('::');
    head = h ? h.split(':') : [];
    tail = t ? t.split(':') : [];
    const gap = 8 - head.length - tail.length;
    if (gap < 0) return null;
    head = head.concat(Array(gap).fill('0')).concat(tail);
  } else {
    head = ip.split(':');
  }
  if (head.length !== 8) return null;
  let result = 0n;
  for (const part of head) {
    const v = Number.parseInt(part || '0', 16);
    if (!Number.isFinite(v) || v < 0 || v > 0xffff) return null;
    result = (result << 16n) | BigInt(v);
  }
  return result;
}

function ipv6InCidr(ip: string, network: string, mask: number): boolean {
  if (mask > 128) return false;
  const ipBig = ipv6ToBigInt(ip);
  const netBig = ipv6ToBigInt(network);
  if (ipBig === null || netBig === null) return false;
  if (mask === 0) return true;
  const shift = BigInt(128 - mask);
  const maskBig = ((1n << 128n) - 1n) ^ ((1n << shift) - 1n);
  return (ipBig & maskBig) === (netBig & maskBig);
}
