import type ts from 'typescript';

/** Literal-only parser used by maintenance scripts; never executes native code. */
export function literal(node: ts.Node): unknown;
export function strings(node: ts.Node): string[];
