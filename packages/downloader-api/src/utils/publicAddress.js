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
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b:1::', 48],
]) blocked.addSubnet(address, prefix, 'ipv6');

function isPublicAddress(value) {
  let address = String(value || '').replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const family = net.isIP(address);
  if (!family) return false;
  if (family === 6) {
    // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) addresses carry an IPv4 destination.
    const mapped = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]);
    if (/^::ffff:/i.test(address)) return false;
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
