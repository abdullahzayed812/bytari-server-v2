import type { Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApiDocument } from './document.js';

/**
 * Serve the OpenAPI document and Swagger UI.
 *   GET /openapi.json  → raw spec
 *   GET /docs          → interactive UI
 */
export function mountOpenApi(app: Express, version: string): void {
  const document = buildOpenApiDocument(version);

  app.get('/openapi.json', (_req, res) => {
    res.json(document);
  });

  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(document as unknown as swaggerUi.JsonObject, {
      customSiteTitle: 'Bytari API Docs',
    }),
  );
}
