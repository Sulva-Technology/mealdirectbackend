import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function resolveSchema(schema, components) {
  if (!schema) return 'any';
  if (schema.$ref) {
    const refName = schema.$ref.split('/').pop();
    const resolved = components.schemas?.[refName];
    if (resolved) {
      return resolveSchema(resolved, components);
    }
    return refName;
  }
  if (schema.type === 'array') {
    return `Array<${resolveSchema(schema.items, components)}>`;
  }
  if (schema.type === 'object') {
    if (schema.properties) {
      const props = {};
      for (const [key, prop] of Object.entries(schema.properties)) {
        props[key] = resolveSchema(prop, components);
      }
      return props;
    }
    return 'Object';
  }
  if (schema.oneOf) {
    return schema.oneOf.map((s) => resolveSchema(s, components)).join(' | ');
  }
  if (schema.anyOf) {
    return schema.anyOf.map((s) => resolveSchema(s, components)).join(' | ');
  }
  if (schema.allOf) {
    return schema.allOf.map((s) => resolveSchema(s, components)).join(' & ');
  }
  return schema.type || 'any';
}

function formatSchemaSample(resolved) {
  if (typeof resolved === 'string') return resolved;
  return JSON.stringify(resolved, null, 2);
}

async function run() {
  const jsonPath = join(process.cwd(), 'docs', 'openapi.json');
  const openapi = JSON.parse(await readFile(jsonPath, 'utf-8'));
  const components = openapi.components || {};

  let markdown = `# Meal Direct API Reference & Request Shapes\n\n`;
  markdown += `This document provides the exact shapes of queries, request bodies, parameters, and responses for the Meal Direct API, parsed from [openapi.json](file:///c:/sulvatech/mealdirectbackend/docs/openapi.json).\n\n`;

  // Group by tags
  const groups = {};

  for (const [path, pathItem] of Object.entries(openapi.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
        const tag = operation.tags?.[0] || 'General';
        if (!groups[tag]) groups[tag] = [];
        groups[tag].push({ path, method: method.toUpperCase(), operation });
      }
    }
  }

  for (const [tag, operations] of Object.entries(groups)) {
    markdown += `## ${tag} Endpoints\n\n`;

    for (const op of operations) {
      const { path, method, operation } = op;
      markdown += `### \`${method} ${path}\`\n\n`;
      if (operation.summary) markdown += `**Summary:** ${operation.summary}\n\n`;
      if (operation.description) markdown += `${operation.description}\n\n`;

      // Parameters
      const parameters = operation.parameters || [];
      const pathParams = parameters.filter((p) => p.in === 'path');
      const queryParams = parameters.filter((p) => p.in === 'query');
      const headerParams = parameters.filter((p) => p.in === 'header');

      if (pathParams.length > 0) {
        markdown += `#### Path Parameters\n\n| Parameter | Type | Required | Description |\n| :--- | :--- | :--- | :--- |\n`;
        for (const p of pathParams) {
          markdown += `| \`${p.name}\` | \`${p.schema?.type || 'string'}\` | ${p.required ? 'Yes' : 'No'} | ${p.description || ''} |\n`;
        }
        markdown += `\n`;
      }

      if (queryParams.length > 0) {
        markdown += `#### Query Parameters\n\n| Parameter | Type | Required | Description |\n| :--- | :--- | :--- | :--- |\n`;
        for (const p of queryParams) {
          markdown += `| \`${p.name}\` | \`${p.schema?.type || 'string'}\` | ${p.required ? 'Yes' : 'No'} | ${p.description || ''} |\n`;
        }
        markdown += `\n`;
      }

      // Request Body
      if (operation.requestBody) {
        markdown += `#### Request Body Shape\n\n`;
        const content = operation.requestBody.content?.['application/json'];
        if (content && content.schema) {
          const resolved = resolveSchema(content.schema, components);
          markdown += `\`\`\`json\n${formatSchemaSample(resolved)}\n\`\`\`\n\n`;
        } else {
          markdown += `Custom or dynamic body format.\n\n`;
        }
      }

      // Responses
      markdown += `#### Responses\n\n`;
      for (const [statusCode, response] of Object.entries(operation.responses || {})) {
        markdown += `* **Status ${statusCode}**: ${response.description || ''}\n`;
        const content = response.content?.['application/json'];
        if (content && content.schema) {
          const resolved = resolveSchema(content.schema, components);
          markdown += `  \`\`\`json\n${formatSchemaSample(resolved).replace(/\n/g, '\n  ')}\n  \`\`\`\n`;
        }
      }
      markdown += `\n---\n\n`;
    }
  }

  await writeFile(join(process.cwd(), 'docs', 'api-reference.md'), markdown);
  console.log('API Reference generated successfully!');
}

run().catch(console.error);
