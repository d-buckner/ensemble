/**
 * Deep readonly type that recursively marks all properties as readonly.
 * Used to enforce immutability of event payloads at compile time.
 */
export type DeepReadonly<T> = T extends (infer R)[]
  ? ReadonlyArray<DeepReadonly<R>>
  : T extends Function
  ? T
  : T extends object
  ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
  : T;
