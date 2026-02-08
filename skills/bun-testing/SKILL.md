---
name: Bun Testing & Bundling
description: >-
  Use this skill when the user wants to write tests with bun:test, configure
  the test runner, use mocks/spies/snapshots, set up code coverage, bundle
  code with Bun.build(), configure the bundler, write bundler plugins, use
  macros, manage packages with bun install, configure workspaces, patch
  packages, or use bunfig.toml. Triggers on: "write tests", "bun test",
  "mock a function", "snapshot test", "bundle", "Bun.build", "bun install",
  "workspace", "bunfig.toml", "code coverage", "minify", "tree shaking".
version: 1.0.0
---

Use `search_bun_docs` and `read_bun_doc` to verify the latest API details when writing test or bundler code.

## Test Runner (`bun:test`)

### Running Tests

```bash
bun test                              # all tests
bun test ./test/specific.test.ts      # specific file
bun test --watch                      # watch mode
bun test --coverage                   # code coverage
bun test --bail                       # stop on first failure
bun test --timeout 10000              # per-test timeout (ms)
bun test --test-name-pattern "login"  # filter by test name regex
bun test --update-snapshots           # update snapshots
bun test --rerun-each 100             # flaky test detection
```

File discovery: `*.test.{ts,js,tsx,jsx}`, `*_test.*`, `*.spec.*`, `*_spec.*`

### Core API

```typescript
import {
  describe,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  mock,
  spyOn,
} from 'bun:test';

describe('group', () => {
  beforeAll(() => {
    /* once before all */
  });
  beforeEach(() => {
    /* before each test */
  });
  afterEach(() => {
    /* after each test */
  });
  afterAll(() => {
    /* once after all */
  });

  test('basic', () => {
    expect(2 + 2).toBe(4);
  });

  test('async', async () => {
    const data = await fetchData();
    expect(data).toBeDefined();
  });

  test('with timeout', async () => {
    /* ... */
  }, 500);
});
```

### Test Modifiers

```typescript
test.skip('skipped', () => {});
test.only('exclusive', () => {}); // run with --only
test.todo('planned', () => {});
test.if(process.platform === 'linux')('linux only', () => {});
test.skipIf(process.platform === 'win32')('not windows', () => {});
test.failing('known bug', () => {
  expect(0.1 + 0.2).toBe(0.3);
});
test.concurrent('parallel', async () => {});
test.serial('sequential', () => {}); // force serial even with --concurrent
```

### Parametrized Tests

```typescript
test.each([
  [1, 2, 3],
  [3, 4, 7],
])('%d + %d = %d', (a, b, expected) => {
  expect(a + b).toBe(expected);
});

// Object form
test.each([
  { input: 'hello', expected: 5 },
  { input: 'world', expected: 5 },
])('length of $input is $expected', ({ input, expected }) => {
  expect(input.length).toBe(expected);
});
```

### Matchers Reference

**Value:** `toBe`, `toEqual`, `toStrictEqual`, `toBeNull`, `toBeUndefined`, `toBeDefined`, `toBeNaN`, `toBeFalsy`, `toBeTruthy`

**Numbers:** `toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeLessThan`, `toBeLessThanOrEqual`, `toBeCloseTo`

**Strings/Arrays:** `toContain`, `toHaveLength`, `toMatch(regex)`, `toContainEqual`

**Objects:** `toHaveProperty`, `toMatchObject`

**Functions:** `toThrow`, `toBeInstanceOf`

**Promises:** `expect(promise).resolves.toBe()`, `expect(promise).rejects.toThrow()`

**Asymmetric:** `expect.anything()`, `expect.any(Number)`, `expect.stringContaining()`, `expect.stringMatching()`, `expect.arrayContaining()`, `expect.objectContaining()`

**Assertion counting:** `expect.assertions(2)`, `expect.hasAssertions()`

### Mocking

```typescript
// Function mock
const fn = mock(() => 42);
fn();
expect(fn).toHaveBeenCalled();
expect(fn).toHaveBeenCalledTimes(1);
expect(fn).toHaveReturnedWith(42);

// Mock implementations
fn.mockReturnValue(100);
fn.mockImplementation(() => 'overridden');
fn.mockResolvedValue({ data: true });

// Spy on existing object
const spy = spyOn(console, 'log');
console.log('test');
expect(spy).toHaveBeenCalledWith('test');
spy.mockRestore();

// Module mocking
mock.module('./api', () => ({
  fetchUsers: mock(() => [{ name: 'Alice' }]),
}));
```

### Snapshot Testing

```typescript
test('snapshot', () => {
  expect({ a: 1, b: [2, 3] }).toMatchSnapshot();
});

test('inline snapshot', () => {
  expect({ hello: 'world' }).toMatchInlineSnapshot(`
{
  "hello": "world",
}
`);
});

// Dynamic value matchers
test('with dates', () => {
  expect({ id: 1, createdAt: new Date() }).toMatchSnapshot({
    createdAt: expect.any(Date),
  });
});
```

Update: `bun test --update-snapshots`

### Lifecycle Hooks & Preload

```toml
# bunfig.toml - global setup
[test]
preload = ["./test/setup.ts"]
```

```typescript
// test/setup.ts
import { beforeAll, afterAll } from 'bun:test';
beforeAll(async () => {
  await startTestServer();
});
afterAll(async () => {
  await stopTestServer();
});
```

### Code Coverage

```bash
bun test --coverage
```

```toml
# bunfig.toml
[test]
coverage = true
coverageReporter = ["text", "lcov"]
coverageDir = "./coverage"
coverageThreshold = { lines = 0.85, functions = 0.90, statements = 0.80 }
coverageSkipTestFiles = true
```

### DOM Testing

```bash
bun add -d @happy-dom/global-registrator
```

```toml
# bunfig.toml
[test]
preload = ["./happydom.ts"]
```

```typescript
// happydom.ts
import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
```

## Bundler (`Bun.build()`)

### API

```typescript
const result = await Bun.build({
  entrypoints: ['./src/index.tsx'],
  outdir: './dist',
  target: 'browser', // "browser" | "bun" | "node"
  format: 'esm', // "esm" | "cjs" | "iife"
  splitting: true,
  minify: true, // or { whitespace, syntax, identifiers }
  sourcemap: 'linked', // "none" | "linked" | "external" | "inline"
  external: ['react'],
  naming: '[dir]/[name]-[hash].[ext]',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  drop: ['console', 'debugger'],
  plugins: [myPlugin],
  env: 'inline', // inline all process.env vars
  publicPath: 'https://cdn.example.com/',
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
}
```

### CLI

```bash
bun build ./src/index.tsx --outdir ./dist --minify --splitting --sourcemap linked
bun build ./cli.tsx --compile --outfile mycli  # single executable
bun build ./src/index.tsx --outdir ./dist --watch
bun build ./src/index.tsx --target bun
```

### Built-in Loaders

TS, TSX, JS, JSX, JSON, JSONC, TOML, YAML, CSS, HTML, WASM - all handled natively. No babel, ts-loader, css-loader, or postcss needed for standard use cases.

### Plugins

```typescript
import type { BunPlugin } from 'bun';

const myPlugin: BunPlugin = {
  name: 'my-plugin',
  setup(build) {
    build.onResolve({ filter: /^virtual:/ }, (args) => ({
      path: args.path,
      namespace: 'virtual',
    }));
    build.onLoad({ filter: /.*/, namespace: 'virtual' }, (args) => ({
      contents: `export default "virtual module"`,
      loader: 'js',
    }));
  },
};
```

### Macros (Compile-time Code Execution)

```typescript
// build-info.ts
export function gitHash() {
  return Bun.spawnSync({ cmd: ['git', 'rev-parse', 'HEAD'], stdout: 'pipe' })
    .stdout.toString()
    .trim();
}

// app.ts
import { gitHash } from './build-info' with { type: 'macro' };
console.log(`Build: ${gitHash()}`); // Inlined at bundle time
```

### HTML Imports (Full-stack Bundling)

```typescript
import homepage from './index.html';

Bun.serve({
  routes: { '/': homepage }, // Serves fully bundled frontend
});
```

## Package Management

### Core Commands

```bash
bun install                    # install all deps
bun add react                  # add dependency
bun add -d typescript          # dev dependency
bun add --exact react          # pin exact version
bun remove react               # remove
bun update                     # update to latest compatible
bun update --latest            # update to latest (ignoring ranges)
bun outdated                   # check outdated
bunx cowsay hello              # execute package binary
bun pm pack                    # create tarball
bun publish                    # publish to npm
```

### Workspaces

```json
{
  "workspaces": ["packages/*"],
  "devDependencies": {
    "shared": "workspace:*"
  }
}
```

Protocols: `workspace:*` (exact version on publish), `workspace:^`, `workspace:~`

Filter: `bun install --filter "pkg-*"`

### Overrides

```json
{
  "overrides": { "vulnerable-package": "~1.2.0" }
}
```

### Patch Packages

```bash
bun patch react              # prepare for patching
# edit node_modules/react/...
bun patch --commit react     # save patch to patches/
```

### `trustedDependencies`

Bun skips postinstall scripts by default. Allowlist packages that need them:

```json
{
  "trustedDependencies": ["sharp", "esbuild"]
}
```

### `bunfig.toml` (Full Config Reference)

```toml
[test]
preload = ["./setup.ts"]
timeout = 10000
coverage = true
coverageReporter = ["text", "lcov"]
coverageThreshold = { lines = 0.85 }

[install]
exact = false
frozenLockfile = false

[install.scopes]
"@mycompany" = { url = "https://registry.mycompany.com/", token = "$TOKEN" }

[install.lockfile]
save = true
```
