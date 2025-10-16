# Publishing Guide

This document describes how to publish Ensemble packages to npm using Lerna.

## Prerequisites

Before publishing, ensure:

1. ✅ **Authentication**: You're logged into npm with publishing access
   ```bash
   npm login
   npm whoami  # Verify you're logged in
   ```

2. ✅ **Tests Pass**: All tests are passing
   ```bash
   npm test
   ```

3. ✅ **Build Succeeds**: All packages build successfully
   ```bash
   npm run build
   ```

4. ✅ **Clean Working Directory**: No uncommitted changes
   ```bash
   git status
   ```

## Publishing Process

Ensemble uses **Lerna** with **fixed/locked versioning**, meaning all packages share the same version number and are released together atomically.

### Step 1: Version Packages

```bash
npm run version
```

This will:
- Prompt you to select a single version bump for all packages
- Update all package.json files to the same version
- Create a git commit with the version changes
- Create a single git tag (e.g., v0.1.0)

**Version Bump Options:**
- **patch**: Bug fixes (0.1.0 → 0.1.1)
- **minor**: New features (0.1.0 → 0.2.0)
- **major**: Breaking changes (0.1.0 → 1.0.0)
- **prerelease**: Pre-release version (0.1.0 → 0.1.1-alpha.0)

### Step 2: Push to GitHub

```bash
git push --follow-tags
```

The `--follow-tags` flag ensures version tags are pushed along with the commit.

### Step 3: Publish to npm

```bash
npm run publish
```

This will:
- Build all packages (if not already built)
- Publish changed packages to npm
- Prompt for confirmation before publishing

**For CI/CD (no prompts):**
```bash
npm run publish:ci
```

## First Release (0.0.0 → 0.1.0)

For the initial release from version 0.0.0:

```bash
# 1. Ensure everything is clean and tested
npm run build
npm test

# 2. Version all packages (select "minor" for 0.0.0 → 0.1.0)
npm run version

# 3. Push tags
git push --follow-tags

# 4. Publish
npm run publish
```

## Package Structure

All packages are configured for publication:

- **`@d-buckner/ensemble-core`** - Core actor framework
- **`@d-buckner/ensemble-react`** - React bindings
- **`@d-buckner/ensemble-solidjs`** - SolidJS bindings
- **`@d-buckner/ensemble-vite-plugin`** - Vite plugin for Web Workers

Each package includes:
- ✅ Apache 2.0 License
- ✅ README.md
- ✅ Repository links
- ✅ Keywords for discoverability
- ✅ `publishConfig.access: "public"` for scoped packages

## Troubleshooting

### "You do not have permission to publish"

Ensure you're logged in with an account that has publishing rights to the `@d-buckner` scope:

```bash
npm login
# Login with credentials that have access to @d-buckner scope
```

### "Package already published"

If a version is already published, you'll need to bump the version:

```bash
npm run version
# Select a higher version number
```

### "Tests failing"

Do not publish with failing tests. Fix all tests first:

```bash
npm test
# Fix any failing tests
npm run build
```

### Build errors

Ensure all packages build successfully:

```bash
npm run build
# Check for TypeScript errors or build failures
```

## CI/CD Publishing

For automated publishing in CI/CD:

1. Set `NPM_TOKEN` environment variable in your CI system
2. Create `.npmrc` in CI:
   ```
   //registry.npmjs.org/:_authToken=${NPM_TOKEN}
   ```
3. Run publishing script:
   ```bash
   npm run publish:ci
   ```

## Lerna Configuration

Configuration is in `lerna.json`:

- **Fixed/Locked versioning**: All packages share the same version number
- **Conventional commits**: Version bumps based on commit messages
- **Atomic releases**: All packages released together
- **Ignore patterns**: Don't trigger versions for test/doc changes

## Package Dependencies

- **Core** has no dependencies on other Ensemble packages
- **React** depends on `@d-buckner/ensemble-core`
- **SolidJS** depends on `@d-buckner/ensemble-core`
- **Vite Plugin** depends on `@d-buckner/ensemble-core`

Lerna handles publishing in the correct order to ensure dependencies are available.

## Post-Publishing

After publishing:

1. ✅ Verify packages on npm:
   ```bash
   npm view @d-buckner/ensemble-core
   npm view @d-buckner/ensemble-react
   npm view @d-buckner/ensemble-solidjs
   npm view @d-buckner/ensemble-vite-plugin
   ```

2. ✅ Test installation in a fresh project:
   ```bash
   mkdir test-install
   cd test-install
   npm init -y
   npm install @d-buckner/ensemble-core @d-buckner/ensemble-react
   ```

3. ✅ Update documentation if needed

4. ✅ Announce the release (GitHub Releases, Twitter, Discord, etc.)
