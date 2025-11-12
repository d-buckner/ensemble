import { test, expect } from '@playwright/test';

/**
 * Counter Demo Integration Tests
 *
 * These tests validate the React counter demo works correctly with:
 * - Actor system initialization
 * - Worker thread communication (CounterActor runs in worker thread)
 * - State updates and UI reactivity
 * - ensemble.json configuration
 */

test.describe('Counter React Demo', () => {
  test('should load the counter demo page', async ({ page }) => {
    await page.goto('/');

    // Verify the title is present
    await expect(page.locator('h1')).toHaveText('Ensemble Counter Demo');

    // Verify the counter card is present
    await expect(page.locator('.counter-card')).toBeVisible();
  });

  test('should display initial counter value', async ({ page }) => {
    await page.goto('/');

    // Verify counter starts at 0
    await expect(page.locator('.counter-value')).toHaveText('Counter: 0');
  });

  test('should increment counter when clicking increment button', async ({ page }) => {
    await page.goto('/');

    // Click increment button
    await page.getByRole('button', { name: 'Increment' }).click();

    // Verify counter increased to 1
    await expect(page.locator('.counter-value')).toHaveText('Counter: 1');

    // Click again
    await page.getByRole('button', { name: 'Increment' }).click();

    // Verify counter increased to 2
    await expect(page.locator('.counter-value')).toHaveText('Counter: 2');
  });

  test('should decrement counter when clicking decrement button', async ({ page }) => {
    await page.goto('/');

    // Start by incrementing to 5
    const incrementBtn = page.getByRole('button', { name: 'Increment' });
    for (let i = 0; i < 5; i++) {
      await incrementBtn.click();
    }
    await expect(page.locator('.counter-value')).toHaveText('Counter: 5');

    // Click decrement button
    await page.getByRole('button', { name: 'Decrement' }).click();

    // Verify counter decreased to 4
    await expect(page.locator('.counter-value')).toHaveText('Counter: 4');

    // Click again
    await page.getByRole('button', { name: 'Decrement' }).click();

    // Verify counter decreased to 3
    await expect(page.locator('.counter-value')).toHaveText('Counter: 3');
  });

  test('should reset counter to 0 when clicking reset button', async ({ page }) => {
    await page.goto('/');

    // Increment counter several times
    const incrementBtn = page.getByRole('button', { name: 'Increment' });
    for (let i = 0; i < 10; i++) {
      await incrementBtn.click();
    }
    await expect(page.locator('.counter-value')).toHaveText('Counter: 10');

    // Click reset button
    await page.getByRole('button', { name: 'Reset' }).click();

    // Verify counter is back to 0
    await expect(page.locator('.counter-value')).toHaveText('Counter: 0');
  });

  test('should handle rapid clicks correctly', async ({ page }) => {
    await page.goto('/');

    // Rapidly click increment button multiple times
    const incrementBtn = page.getByRole('button', { name: 'Increment' });

    // Click 20 times in quick succession
    const clickPromises = [];
    for (let i = 0; i < 20; i++) {
      clickPromises.push(incrementBtn.click());
    }
    await Promise.all(clickPromises);

    // Wait a bit for all state updates to propagate from worker thread
    await page.waitForTimeout(100);

    // Verify counter is at 20 (worker thread handled all messages)
    await expect(page.locator('.counter-value')).toHaveText('Counter: 20');
  });

  test('should maintain counter state through multiple operations', async ({ page }) => {
    await page.goto('/');

    const incrementBtn = page.getByRole('button', { name: 'Increment' });
    const decrementBtn = page.getByRole('button', { name: 'Decrement' });
    const resetBtn = page.getByRole('button', { name: 'Reset' });

    // Complex sequence of operations
    await incrementBtn.click();
    await incrementBtn.click();
    await incrementBtn.click();
    await expect(page.locator('.counter-value')).toHaveText('Counter: 3');

    await decrementBtn.click();
    await expect(page.locator('.counter-value')).toHaveText('Counter: 2');

    await incrementBtn.click();
    await incrementBtn.click();
    await expect(page.locator('.counter-value')).toHaveText('Counter: 4');

    await resetBtn.click();
    await expect(page.locator('.counter-value')).toHaveText('Counter: 0');

    await decrementBtn.click();
    await expect(page.locator('.counter-value')).toHaveText('Counter: -1');
  });

  test('should have all three buttons visible and enabled', async ({ page }) => {
    await page.goto('/');

    const incrementBtn = page.getByRole('button', { name: 'Increment' });
    const decrementBtn = page.getByRole('button', { name: 'Decrement' });
    const resetBtn = page.getByRole('button', { name: 'Reset' });

    // Verify all buttons are visible
    await expect(incrementBtn).toBeVisible();
    await expect(decrementBtn).toBeVisible();
    await expect(resetBtn).toBeVisible();

    // Verify all buttons are enabled
    await expect(incrementBtn).toBeEnabled();
    await expect(decrementBtn).toBeEnabled();
    await expect(resetBtn).toBeEnabled();
  });
});
