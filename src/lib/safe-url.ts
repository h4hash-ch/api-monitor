/**
 * Reject destinations that should never be reachable from user-controlled
 * monitor and webhook URLs. Cloudflare Workers do not expose a DNS resolver
 * that lets us pin a validated address to the outgoing connection, so this
 * protects literal/private destinations and revalidates every redirect.
 */
export function isPublicHttpUrl(value: string, requireHttps = false): boolean {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    (requireHttps && url.protocol !== 'https:') ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    return false;
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');

  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home') ||
    hostname.endsWith('.test') ||
    hostname.endsWith('.invalid') ||
    hostname.endsWith('.example') ||
    (!hostname.includes('.') && !hostname.includes(':'))
  ) {
    return false;
  }

  if (/^[0-9.]+$/.test(hostname)) {
    return isPublicIpv4(hostname);
  }

  if (hostname.includes(':')) {
    return isPublicIpv6(hostname);
  }

  return true;
}

function isPublicIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [a, b] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function isPublicIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  // Reject IPv4-mapped addresses rather than having to interpret an embedded
  // address through a second set of textual IPv6 representations.
  if (normalized.includes('.')) return false;

  const halves = normalized.split('::');
  if (halves.length > 2) return false;

  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const compressed = halves.length === 2;
  const missing = 8 - left.length - right.length;
  if ((!compressed && missing !== 0) || (compressed && missing < 1)) return false;

  const groups = [
    ...left,
    ...Array(compressed ? missing : 0).fill('0'),
    ...right,
  ];
  if (groups.length !== 8 || groups.some((group) => !/^[\da-f]{1,4}$/.test(group))) {
    return false;
  }

  const first = Number.parseInt(groups[0], 16);
  const second = Number.parseInt(groups[1], 16);
  const allZero = groups.every((group) => Number.parseInt(group, 16) === 0);
  const loopback = allZero && Number.parseInt(groups[7], 16) === 1;
  const ipv4Mapped =
    groups.slice(0, 5).every((group) => Number.parseInt(group, 16) === 0) &&
    Number.parseInt(groups[5], 16) === 0xffff;
  const ipv4Compatible = groups
    .slice(0, 6)
    .every((group) => Number.parseInt(group, 16) === 0);

  return !(
    allZero ||
    loopback ||
    ipv4Mapped ||
    ipv4Compatible ||
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link local fe80::/10
    (first & 0xff00) === 0xff00 || // multicast ff00::/8
    (first === 0x2001 && second === 0x0db8) // documentation 2001:db8::/32
  );
}
