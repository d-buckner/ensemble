# Pre-Publishing Checklist

Before publishing Ensemble packages to npm for the first time, verify these items:

## ✅ Completed Setup

- [x] **Apache 2.0 License** added to repository root
- [x] **Lerna** installed and configured with independent versioning
- [x] **Publication metadata** added to all package.json files:
  - description
  - repository
  - keywords
  - author
  - license (Apache-2.0)
  - publishConfig.access: "public"
  - files array
- [x] **README files** created for all packages
- [x] **Design documentation** organized (proposals → designs)
- [x] **Build system** verified - all packages build successfully
- [x] **Tests** verified - all tests pass

## 📦 Package Status

All packages are currently at version **0.1.0**:

1. **@d-buckner/ensemble-core@0.1.0** - Core actor framework
   - Build: ✅ Passing
   - Tests: ✅ 250 tests passing

2. **@d-buckner/ensemble-react@0.1.0** - React bindings
   - Build: ✅ Passing
   - Tests: ✅ 10 tests passing

3. **@d-buckner/ensemble-solidjs@0.1.0** - SolidJS bindings
   - Build: ✅ Passing
   - Tests: ✅ 9 tests passing

4. **@d-buckner/ensemble-vite-plugin@0.1.0** - Vite plugin
   - Build: ✅ Passing (CommonJS)
   - Tests: ✅ 44 tests passing

## 🚀 Publishing Steps

When ready to publish:

### 1. Pre-Flight Checks

```bash
# Verify everything is clean
git status

# Run full build
npm run build

# Run all tests
npm test

# Run type checking
npm run typecheck

# Run linter
npm run lint
```

### 2. Authentication

```bash
# Login to npm
npm login

# Verify you're logged in
npm whoami
```

### 3. Version Packages

```bash
# Interactive version bump (choose "minor" for 0.0.0 → 0.1.0)
npm run release:version

# This will:
# - Prompt for version bumps
# - Update package.json files
# - Create git commit
# - Create git tags
```

### 4. Push Changes

```bash
# Push commits and tags to GitHub
git push --follow-tags
```

### 5. Publish to npm

```bash
# Publish packages (with confirmation prompts)
npm run release:publish

# Alternative: CI/CD mode (no prompts)
npm run release:publish:ci
```

### 6. Verification

```bash
# Check packages on npm
npm view @d-buckner/ensemble-core
npm view @d-buckner/ensemble-react
npm view @d-buckner/ensemble-solidjs
npm view @d-buckner/ensemble-vite-plugin

# Test installation
mkdir /tmp/test-install && cd /tmp/test-install
npm init -y
npm install @d-buckner/ensemble-core @d-buckner/ensemble-react
```

## 📝 Notes

- **Fixed versioning**: All packages share the same version number and are released atomically
- **No circular dependencies**: Packages depend on core, but core has no dependencies on other Ensemble packages
- **Publishing order**: Lerna automatically publishes in dependency order (core first, then react/solidjs/vite-plugin)
- **Scoped packages**: All packages use `@d-buckner/` scope and require `publishConfig.access: "public"`

## 🔗 Documentation

- Full publishing guide: `PUBLISHING.md`
- Lerna configuration: `lerna.json`
- Individual package READMEs: `packages/*/README.md`

## ⚠️ Important

- **DO NOT** publish with failing tests
- **DO NOT** publish with uncommitted changes
- **DO NOT** skip the version step - always use `npm run release:version`
- **DO** test installation after publishing
- **DO** announce releases appropriately
