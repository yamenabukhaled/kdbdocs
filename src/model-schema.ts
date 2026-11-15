/** Native JSON Schema, rather than helper instances with computed required fields. */
export function nativeSchema(schema: object): Record<string, unknown> {
  const plain = JSON.parse(JSON.stringify(schema));
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    delete node.nullable;
    delete node.optionalProperties;
    if (node.type === "object") {
      node.additionalProperties = false;
      for (const child of Object.values(node.properties ?? {})) visit(child);
    }
    if (node.items) visit(node.items);
  };
  visit(plain);
  return plain;
}
export function constrainReview(schema: object, ids: string[]) {
  const result = nativeSchema(schema) as any;
  result.properties.categoryId.enum = ["", ...new Set(ids)];
  return result;
}
