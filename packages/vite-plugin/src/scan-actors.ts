import { readFileSync } from 'fs';
import { resolve, relative } from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { glob } from 'glob';


export interface ActorInfo {
  className: string;
  threadId: string;
  filePath: string;
  initialState: Record<string, unknown>;
}

/**
 * Scans source files for actors decorated with @thread
 * Returns a map of threadId -> array of actor info
 */
export async function scanForThreadActors(
  rootDir: string,
  sourceDir: string = 'src'
): Promise<Map<string, ActorInfo[]>> {
  const actorsByThread = new Map<string, ActorInfo[]>();

  // Find all TypeScript/JavaScript files
  const pattern = resolve(rootDir, sourceDir, '**/*.{ts,tsx,js,jsx}');
  const files = await glob(pattern, {
    ignore: ['**/node_modules/**', '**/*.test.*', '**/*.spec.*'],
  });

  for (const filePath of files) {
    const actors = parseFileForThreadActors(filePath, rootDir);

    for (const actor of actors) {
      if (!actorsByThread.has(actor.threadId)) {
        actorsByThread.set(actor.threadId, []);
      }
      actorsByThread.get(actor.threadId)!.push(actor);
    }
  }

  return actorsByThread;
}

/**
 * Scans source files for ALL actors (both @thread and main thread)
 * Returns a map of className -> actor info
 */
export async function scanAllActors(
  rootDir: string,
  sourceDir: string = 'src'
): Promise<Map<string, ActorInfo>> {
  const actorsByClass = new Map<string, ActorInfo>();

  // Find all TypeScript/JavaScript files
  const pattern = resolve(rootDir, sourceDir, '**/*.{ts,tsx,js,jsx}');
  const files = await glob(pattern, {
    ignore: ['**/node_modules/**', '**/*.test.*', '**/*.spec.*'],
  });

  for (const filePath of files) {
    const actors = parseFileForAllActors(filePath, rootDir);

    for (const actor of actors) {
      actorsByClass.set(actor.className, actor);
    }
  }

  return actorsByClass;
}

/**
 * Extract initialState literal from a class node
 */
function extractInitialState(classNode: t.ClassDeclaration): Record<string, unknown> {
  const body = classNode.body.body;

  for (const member of body) {
    if (
      t.isClassProperty(member) &&
      member.static &&
      t.isIdentifier(member.key) &&
      member.key.name === 'initialState' &&
      t.isObjectExpression(member.value)
    ) {
      try {
        // Convert AST ObjectExpression to JSON
        return objectExpressionToJson(member.value);
      } catch (error) {
        console.warn(`Failed to extract initialState: ${error}`);
        return {};
      }
    }
  }

  return {};
}

/**
 * Convert Babel ObjectExpression AST node to plain JSON
 */
function objectExpressionToJson(node: t.ObjectExpression): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const prop of node.properties) {
    if (t.isObjectProperty(prop)) {
      const key = t.isIdentifier(prop.key) ? prop.key.name :
                  t.isStringLiteral(prop.key) ? prop.key.value : null;

      if (key === null) continue;

      result[key] = astValueToJson(prop.value);
    }
  }

  return result;
}

/**
 * Convert AST literal values to JSON-compatible values
 */
function astValueToJson(node: t.Node): unknown {
  if (t.isStringLiteral(node)) return node.value;
  if (t.isNumericLiteral(node)) return node.value;
  if (t.isBooleanLiteral(node)) return node.value;
  if (t.isNullLiteral(node)) return null;
  if (t.isObjectExpression(node)) return objectExpressionToJson(node);
  if (t.isArrayExpression(node)) {
    return node.elements.map(el => el ? astValueToJson(el) : null);
  }

  // Unsupported types (functions, computed values, etc.)
  return undefined;
}

/**
 * Parses a single file to find ALL actors (classes extending Actor)
 */
function parseFileForAllActors(filePath: string, rootDir: string): ActorInfo[] {
  const code = readFileSync(filePath, 'utf-8');
  const actors: ActorInfo[] = [];

  try {
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy'],
    });

    traverse(ast, {
      ClassDeclaration(path) {
        const classNode = path.node;
        const className = classNode.id?.name;

        if (!className) return;

        // Check if class extends Actor
        const extendsActor = classNode.superClass &&
          t.isIdentifier(classNode.superClass) &&
          classNode.superClass.name === 'Actor';

        if (!extendsActor) return;

        // Extract @thread decorator if present
        let threadId = 'main';  // Default to main thread
        const decorators = classNode.decorators || [];

        for (const decorator of decorators) {
          if (
            t.isCallExpression(decorator.expression) &&
            t.isIdentifier(decorator.expression.callee) &&
            decorator.expression.callee.name === 'thread'
          ) {
            const args = decorator.expression.arguments;
            if (args.length > 0 && t.isStringLiteral(args[0])) {
              threadId = args[0].value;
            }
          }
        }

        // Extract initialState
        const initialState = extractInitialState(classNode);

        actors.push({
          className,
          threadId,
          filePath: relative(rootDir, filePath),
          initialState,
        });
      },
    });
  } catch (error) {
    // Skip files that can't be parsed
    console.warn(`Failed to parse ${filePath}:`, error);
  }

  return actors;
}

/**
 * Parses a single file to find actors with @thread decorator
 */
function parseFileForThreadActors(filePath: string, rootDir: string): ActorInfo[] {
  const code = readFileSync(filePath, 'utf-8');
  const actors: ActorInfo[] = [];

  try {
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy'],
    });

    traverse(ast, {
      ClassDeclaration(path) {
        const classNode = path.node;
        const decorators = classNode.decorators || [];

        // Look for @thread decorator
        for (const decorator of decorators) {
          if (
            t.isCallExpression(decorator.expression) &&
            t.isIdentifier(decorator.expression.callee) &&
            decorator.expression.callee.name === 'thread'
          ) {
            // Get the threadId argument
            const args = decorator.expression.arguments;
            if (args.length > 0 && t.isStringLiteral(args[0])) {
              const threadId = args[0].value;
              const className = classNode.id?.name;

              if (className) {
                const initialState = extractInitialState(classNode);
                actors.push({
                  className,
                  threadId,
                  filePath: relative(rootDir, filePath),
                  initialState,
                });
              }
            }
          }
        }
      },
    });
  } catch (error) {
    // Skip files that can't be parsed (might not be valid TS/JS)
    console.warn(`Failed to parse ${filePath}:`, error);
  }

  return actors;
}
