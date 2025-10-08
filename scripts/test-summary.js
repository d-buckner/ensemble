#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Ensure we're running from the monorepo root
function findMonorepoRoot() {
  let currentDir = __dirname;

  // Walk up from the script directory to find turbo.json
  while (currentDir !== path.parse(currentDir).root) {
    const turboJsonPath = path.join(currentDir, 'turbo.json');
    if (fs.existsSync(turboJsonPath)) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  // Fallback: assume script is in <root>/scripts
  return path.dirname(__dirname);
}

const monorepoRoot = findMonorepoRoot();
process.chdir(monorepoRoot);

// Track test results by package
const packageResults = new Map();
let currentPackage = null;
const failureDetails = [];

// Run turbo test
const turbo = spawn('npx', ['turbo', 'run', 'test'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true,
  cwd: monorepoRoot,
});

let buffer = '';

// Process stdout line by line
turbo.stdout.on('data', (data) => {
  const chunk = data.toString();
  process.stdout.write(chunk); // Pass through to terminal
  buffer += chunk;

  // Parse for test results
  const lines = buffer.split('\n');
  buffer = lines.pop() || ''; // Keep incomplete line in buffer

  lines.forEach(line => {
    // Strip ANSI color codes for parsing
    // eslint-disable-next-line no-control-regex
    const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');

    // Extract package name from lines like "@d-buckner/ensemble-core:test:"
    const packageMatch = cleanLine.match(/(@[\w-]+\/[\w-]+):test:/);
    if (packageMatch) {
      currentPackage = packageMatch[1];
      if (!packageResults.has(currentPackage)) {
        packageResults.set(currentPackage, { files: 0, tests: 0, filesFailed: 0, testsFailed: 0 });
      }
    }

    // Match pattern: "Test Files  X failed | Y passed (Z)" or just "X passed (Y)"
    const fileMatchWithFail = cleanLine.match(/Test Files\s+(\d+)\s+failed\s+\|\s+(\d+)\s+passed\s+\((\d+)\)/);
    const fileMatch = cleanLine.match(/Test Files\s+(\d+)\s+passed\s+\((\d+)\)/);

    // Match pattern: "Tests  X failed | Y passed (Z)" or just "X passed (Y)"
    const testMatchWithFail = cleanLine.match(/Tests\s+(\d+)\s+failed\s+\|\s+(\d+)\s+passed\s+\((\d+)\)/);
    const testMatch = cleanLine.match(/Tests\s+(\d+)\s+passed\s+\((\d+)\)/);

    // Match failed test names like "❯ src/foo.test.ts > should do something"
    const failedTestMatch = cleanLine.match(/[✕×].*?(?:src\/[\w\/.-]+\.test\.(?:ts|tsx|js|jsx))/);

    if (currentPackage) {
      const result = packageResults.get(currentPackage);

      if (fileMatchWithFail && result) {
        const failed = parseInt(fileMatchWithFail[1]);
        const passed = parseInt(fileMatchWithFail[2]);
        if (failed > result.filesFailed) result.filesFailed = failed;
        if (passed > result.files) result.files = passed;
      } else if (fileMatch && result) {
        const passed = parseInt(fileMatch[1]);
        if (passed > result.files) result.files = passed;
      }

      if (testMatchWithFail && result) {
        const failed = parseInt(testMatchWithFail[1]);
        const passed = parseInt(testMatchWithFail[2]);
        if (failed > result.testsFailed) result.testsFailed = failed;
        if (passed > result.tests) result.tests = passed;
      } else if (testMatch && result) {
        const passed = parseInt(testMatch[1]);
        if (passed > result.tests) result.tests = passed;
      }

      if (failedTestMatch) {
        failureDetails.push(`${currentPackage}: ${cleanLine.trim()}`);
      }
    }
  });
});

// Also process stderr
turbo.stderr.on('data', (data) => {
  process.stderr.write(data); // Pass through to terminal
});

turbo.on('close', (code) => {
  // Calculate totals
  let totalFiles = 0;
  let totalTests = 0;
  let totalFilesFailed = 0;
  let totalTestsFailed = 0;

  packageResults.forEach((result, pkg) => {
    totalFiles += result.files;
    totalTests += result.tests;
    totalFilesFailed += result.filesFailed;
    totalTestsFailed += result.testsFailed;
  });

  // Print aggregate summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 AGGREGATE TEST SUMMARY');
  console.log('='.repeat(60));

  // Per-package breakdown
  if (packageResults.size > 0) {
    console.log('\nBy Package:');
    packageResults.forEach((result, pkg) => {
      const pkgName = pkg.replace('@d-buckner/ensemble-', '');
      const hasFailures = result.filesFailed > 0 || result.testsFailed > 0;

      if (hasFailures) {
        console.log(`  ${pkgName}:`);
        console.log(`    Files: ${result.filesFailed} failed | ${result.files} passed`);
        console.log(`    Tests: ${result.testsFailed} failed | ${result.tests} passed`);
      } else {
        console.log(`  ${pkgName}: ${result.files} files, ${result.tests} tests ✓`);
      }
    });
    console.log();
  }

  // Overall totals
  if (totalFilesFailed > 0 || totalTestsFailed > 0) {
    console.log(`Overall:`);
    console.log(`  Test Files: ${totalFilesFailed} failed | ${totalFiles} passed`);
    console.log(`       Tests: ${totalTestsFailed} failed | ${totalTests} passed`);

    if (failureDetails.length > 0) {
      console.log('\n' + '─'.repeat(60));
      console.log('❌ FAILURES:');
      console.log('─'.repeat(60));
      failureDetails.forEach(detail => console.log(detail));
    }
  } else {
    console.log(`Overall:`);
    console.log(`  Test Files: ${totalFiles} passed`);
    console.log(`       Tests: ${totalTests} passed`);
  }

  console.log('='.repeat(60) + '\n');

  process.exit(code);
});
