// Plain object, so that the config resolves without importing vitest: the
// repository may be checked out on its own, without the dependency
// installed yet.
export default {
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.mjs'],
  },
}
