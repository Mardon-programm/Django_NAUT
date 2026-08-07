// DRF Explorer: endpoint URL derivation for DefaultRouter routes.
const path = require('path');
const { test, eq, loadFunctions, repoRoot } = require('./lib');

const renderer = path.join(repoRoot(), 'renderer.js');
const { nautDrfEndpointUrls: eps } = loadFunctions(renderer, ['nautDrfEndpointUrls']);

test('api/posts route produces 6 CRUD endpoints', () => {
  eq(eps('api/posts', 'http://127.0.0.1:8000'), [
    { method: 'GET', url: 'http://127.0.0.1:8000/api/posts/' },
    { method: 'POST', url: 'http://127.0.0.1:8000/api/posts/' },
    { method: 'GET', url: 'http://127.0.0.1:8000/api/posts/{id}/' },
    { method: 'PUT', url: 'http://127.0.0.1:8000/api/posts/{id}/' },
    { method: 'PATCH', url: 'http://127.0.0.1:8000/api/posts/{id}/' },
    { method: 'DELETE', url: 'http://127.0.0.1:8000/api/posts/{id}/' },
  ]);
});

test('prefix and base slash normalization', () => {
  eq(eps('posts', 'http://localhost:9000'), [
    { method: 'GET', url: 'http://localhost:9000/posts/' },
    { method: 'POST', url: 'http://localhost:9000/posts/' },
    { method: 'GET', url: 'http://localhost:9000/posts/{id}/' },
    { method: 'PUT', url: 'http://localhost:9000/posts/{id}/' },
    { method: 'PATCH', url: 'http://localhost:9000/posts/{id}/' },
    { method: 'DELETE', url: 'http://localhost:9000/posts/{id}/' },
  ]);
  eq(eps('/api/posts/', 'http://x.test/')[0].url, 'http://x.test/api/posts/');
  eq(eps('', 'http://127.0.0.1:8000')[0].url, 'http://127.0.0.1:8000/');
  eq(eps(undefined, 'http://127.0.0.1:8000')[0].url, 'http://127.0.0.1:8000/');
  eq(eps('posts', undefined)[0].url, 'http://127.0.0.1:8000/posts/');
});
