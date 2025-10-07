import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { readFileSync } from 'fs';
import { glob } from 'glob';
import { resolve, relative } from 'path';

export interface ActorInfo {
  className: string;
  threadId: string;
  filePath: string;
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
                actors.push({
                  className,
                  threadId,
                  filePath: relative(rootDir, filePath),
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
