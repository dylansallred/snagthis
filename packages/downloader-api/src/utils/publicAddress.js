const dns = require('dns');
const net = require('net');

// Destinations that server-side inspection never contacts: this machine, the
// local network and other non-public ranges. Checked after DNS resolution, so a
// public-looking host name that resolves to one of them is refused too.
const blocked = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
]) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 96], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10],
  ['ff00::', 8], ['2001::', 32], ['2002::', 16], ['64:ff9b:1::', 48],
]) blocked.addSubnet(address, prefix, 'ipv6');

function parseIpv6Groups(address) {
  let raw = address.toLowerCase();
  // Expand trailing dotted-quad IPv4 (e.g. ::ffff:127.0.0.1) into two 16-bit hex groups.
  const lastColon = raw.lastIndexOf(':');
  if (lastColon >= 0 && raw.slice(lastColon + 1).includes('.')) {
    const octets = raw.slice(lastColon + 1).split('.').map(Number);
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    raw = `${raw.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const halves = raw.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - (left.length + right.length);
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const parts = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right];
  const groups = parts.map((part) => (/^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : -1));
  return groups.every((n) => n >= 0 && n <= 0xffff) ? groups : null;
}

function groupsToIpv4(hi, lo) {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isPublicAddress(value) {
  let address = String(value || '').replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const family = net.isIP(address);
  if (!family) return false;
  if (family === 6) {
    const groups = parseIpv6Groups(address);
    if (!groups) return false;
    // IPv4-mapped (::ffff:a.b.c.d / ::ffff:7f00:1) and well-known NAT64 (64:ff9b::/96)
    // carry an embedded IPv4 destination regardless of hex vs dotted-quad encoding.
    const isIpv4Mapped = groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff;
    const isNat64 = groups[0] === 0x0064 && groups[1] === 0xff9b && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0;
    if (isIpv4Mapped || isNat64) {
      return isPublicAddress(groupsToIpv4(groups[6], groups[7]));
    }
    address = address.toLowerCase();
    return !blocked.check(address, 'ipv6');
  }
  return !blocked.check(address, 'ipv4');
}

const lookupAll = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/** Resolves a URL's host and refuses it unless every address is public. */
async function assertPublicUrl(value, { lookup = lookupAll } = {}) {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const error = () => Object.assign(new Error('SnagThis only checks links to public websites, not this computer or your local network.'), { code: 'NON_PUBLIC_ADDRESS' });
  if (!host || host === 'localhost' || host.endsWith('.localhost')) throw error();
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host).catch(() => {
    throw Object.assign(new Error('This link\'s website could not be found.'), { code: 'HOST_NOT_FOUND' });
  });
  if (!addresses.length || !addresses.every((entry) => isPublicAddress(entry.address))) throw error();
  return url;
}

module.exports = { isPublicAddress, assertPublicUrl };
