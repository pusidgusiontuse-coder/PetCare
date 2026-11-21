"""HTTP hardening without trusting forwarded headers from arbitrary clients."""
from starlette.responses import JSONResponse

CSP = "; ".join([
    "default-src 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'",
    "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:",
    "connect-src 'self'", "worker-src 'self' blob:", "form-action 'self'",
])


class SecurityMiddleware:
    def __init__(self, app, production=False):
        self.app, self.production = app, production

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        path = scope['path']
        headers = dict(scope.get('headers', []))
        limit = 16 * 1024 if path.startswith(('/api/v1/auth/', '/api/v1/admin/')) else 14 * 1024 * 1024
        try:
            length = int(headers.get(b'content-length', b'0'))
            if length < 0: raise ValueError
        except ValueError:
            return await JSONResponse({'detail': 'Некорректный размер запроса'}, 400)(scope, receive, send)
        if length > limit:
            return await JSONResponse({'detail': 'Слишком большой запрос'}, 413)(scope, receive, send)
        # Bound chunked requests as well; never buffer an unbounded body.
        chunks, size = [], 0
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect': return
            body = message.get('body', b'')
            size += len(body)
            if size > limit:
                return await JSONResponse({'detail': 'Слишком большой запрос'}, 413)(scope, receive, send)
            chunks.append(body)
            if not message.get('more_body', False): break
        delivered = False
        async def bounded_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type': 'http.request', 'body': b''.join(chunks), 'more_body': False}
            return await receive()
        async def secure_send(message):
            if message['type'] == 'http.response.start':
                response_headers = list(message.get('headers', []))
                response_headers.extend([
                    (b'x-content-type-options', b'nosniff'), (b'x-frame-options', b'DENY'),
                    (b'referrer-policy', b'no-referrer'),
                    (b'permissions-policy', b'camera=(), microphone=(), geolocation=()'),
                ])
                if path in ('/', '/about', '/admin') or path.startswith('/static/') and any(k.lower() == b'content-type' and b'text/html' in v for k, v in response_headers): response_headers.append((b'content-security-policy', CSP.encode()))
                if path in ('/', '/admin') or path.startswith('/api/') or path == '/static/frontend/index.html':
                    response_headers = [(k, v) for k, v in response_headers if k.lower() != b'cache-control']
                    response_headers.append((b'cache-control', b'no-store'))
                if path in ('/admin', '/docs', '/redoc', '/openapi.json', '/static/frontend/index.html') or path.startswith('/api/'):
                    response_headers.append((b'x-robots-tag', b'noindex'))
                if self.production: response_headers.append((b'strict-transport-security', b'max-age=31536000'))
                message = {**message, 'headers': response_headers}
            await send(message)
        await self.app(scope, bounded_receive, secure_send)
