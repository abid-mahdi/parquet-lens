import type { SchemaElement, SchemaTree } from 'hyparquet'

export function describeLogicalType(element: SchemaElement): string | null {
  const logical = element.logical_type
  if (logical) {
    switch (logical.type) {
      case 'DECIMAL':
        return `DECIMAL(${logical.precision}, ${logical.scale})`
      case 'TIMESTAMP':
        return `TIMESTAMP(${logical.unit}${logical.isAdjustedToUTC ? ', UTC' : ''})`
      case 'TIME':
        return `TIME(${logical.unit})`
      case 'INTEGER':
        return `${logical.isSigned ? 'INT' : 'UINT'}${logical.bitWidth}`
      default:
        return logical.type
    }
  }
  return element.converted_type ?? null
}

export function isRepeatedGroup(node: SchemaTree): boolean {
  return node.element.converted_type === 'LIST' || node.element.converted_type === 'MAP'
}

export function topLevelColumns(schema: SchemaTree): SchemaTree[] {
  return schema.children
}

export function schemaFingerprint(schema: SchemaTree): string {
  return topLevelColumns(schema)
    .map((child) => `${child.element.name}:${child.element.type ?? 'GROUP'}:${child.element.converted_type ?? ''}`)
    .join('|')
}
