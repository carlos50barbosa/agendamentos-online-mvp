import net from 'node:net';

function sanitizeHeaderValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean).join(', ');
  }
  return String(value ?? '').trim();
}

function readHeader(req, name) {
  const lowerName = String(name || '').toLowerCase();
  const headers = req?.headers || {};
  return sanitizeHeaderValue(headers[lowerName] ?? headers[name]);
}

function splitHeaderIps(value) {
  return sanitizeHeaderValue(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripIpDecoration(value) {
  let normalized = String(value ?? '').trim();
  if (!normalized) return '';

  normalized = normalized.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '').trim();
  if (!normalized) return '';

  const bracketedIpv6 = normalized.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketedIpv6) return bracketedIpv6[1].trim();

  const ipv4WithPort = normalized.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (ipv4WithPort) return ipv4WithPort[1];

  if (normalized.toLowerCase().startsWith('::ffff:')) {
    const mapped = normalized.slice(7);
    if (net.isIP(mapped) === 4) return mapped;
  }

  return normalized;
}

export function normalizeIpCandidate(value) {
  const normalized = stripIpDecoration(value);
  if (!normalized) return '';
  return net.isIP(normalized) ? normalized : '';
}

function firstValidIp(value) {
  for (const candidate of splitHeaderIps(value)) {
    const ip = normalizeIpCandidate(candidate);
    if (ip) return ip;
  }
  return '';
}

function validIpList(value) {
  const source = Array.isArray(value) ? value : splitHeaderIps(value);
  return source.map(normalizeIpCandidate).filter(Boolean);
}

export function hasTrustedProxy(req, options = {}) {
  const explicit = Object.prototype.hasOwnProperty.call(options, 'trustProxy')
    ? options.trustProxy
    : undefined;
  const setting = explicit !== undefined
    ? explicit
    : (typeof req?.app?.get === 'function' ? req.app.get('trust proxy') : undefined);

  if (setting === true || typeof setting === 'function') return true;
  if (setting === false || setting === undefined || setting === null) return false;
  if (typeof setting === 'number') return setting > 0;

  const normalized = String(setting).trim().toLowerCase();
  if (!normalized) return false;
  if (['false', 'no', 'off', '0'].includes(normalized)) return false;
  if (['true', 'yes', 'on'].includes(normalized)) return true;

  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) return numeric > 0;

  return true;
}

export function getClientIpInfo(req, options = {}) {
  const trustedProxy = hasTrustedProxy(req, options);
  const xForwardedFor = readHeader(req, 'x-forwarded-for');
  const xRealIp = readHeader(req, 'x-real-ip');
  const cfConnectingIp = readHeader(req, 'cf-connecting-ip');
  const reqIp = normalizeIpCandidate(req?.ip);
  const reqIps = validIpList(req?.ips || []);
  const socketRemoteAddress = normalizeIpCandidate(req?.socket?.remoteAddress || req?.connection?.remoteAddress);

  const trustedCandidates = [
    ['header:cf-connecting-ip', firstValidIp(cfConnectingIp)],
    ['header:x-real-ip', firstValidIp(xRealIp)],
    ['req.ip', reqIp],
    ['req.ips', reqIps[0] || ''],
    ['header:x-forwarded-for', firstValidIp(xForwardedFor)],
    ['socket.remoteAddress', socketRemoteAddress],
  ];
  const directCandidates = [
    ['req.ip', reqIp],
    ['socket.remoteAddress', socketRemoteAddress],
  ];
  const candidates = trustedProxy ? trustedCandidates : directCandidates;
  const selected = candidates.find(([, ip]) => Boolean(ip)) || [null, ''];

  return {
    ip: selected[1] || null,
    source: selected[0],
    trusted_proxy: trustedProxy,
    req_ip: reqIp || null,
    req_ips: reqIps,
    socket_remote_address: socketRemoteAddress || null,
    x_forwarded_for: xForwardedFor || null,
    x_real_ip: xRealIp || null,
    cf_connecting_ip: cfConnectingIp || null,
  };
}

export function getClientIp(req, options = {}) {
  return getClientIpInfo(req, options).ip || '';
}
