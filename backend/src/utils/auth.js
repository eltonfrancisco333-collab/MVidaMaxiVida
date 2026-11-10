export function getSessionToken(request) {
  const bearerToken = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearerToken) return bearerToken;

  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== 'string') return '';
  const sessionCookie = cookieHeader.split(';').map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith('mvida_session='));
  return sessionCookie?.slice('mvida_session='.length) || '';
}

export function sessionCookie(request, token) {
  const forwardedProtocol = request.headers['x-forwarded-proto']?.split(',')[0].trim();
  const secure = forwardedProtocol === 'https' || request.socket.encrypted;
  return `mvida_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure ? '; Secure' : ''}`;
}

export function expiredSessionCookie(request) {
  const forwardedProtocol = request.headers['x-forwarded-proto']?.split(',')[0].trim();
  const secure = forwardedProtocol === 'https' || request.socket.encrypted;
  return `mvida_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
