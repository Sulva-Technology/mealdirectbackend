import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function run() {
  const jsonPath = join(process.cwd(), 'docs', 'openapi.json');
  const openapiContent = await readFile(jsonPath, 'utf-8');

  const html = `<!DOCTYPE html>
<html>
  <head>
    <title>Meal Direct API Documentation</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
    <style>
      body {
        margin: 0;
        padding: 0;
      }
    </style>
    <script>
      // Workaround for Redoc's dependencies checking process.env in browser contexts
      window.process = { env: { NODE_ENV: 'production' } };
    </script>
  </head>
  <body>
    <div id="redoc-container"></div>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"> </script>
    <script>
      const spec = ${openapiContent};
      Redoc.init(spec, {
        theme: {
          colors: {
            primary: {
              main: '#3F51B5'
            }
          }
        }
      }, document.getElementById('redoc-container'));
    </script>
  </body>
</html>
`;

  await writeFile(join(process.cwd(), 'docs', 'api-docs.html'), html);
  console.log('Interactive HTML portal generated successfully!');
}

run().catch(console.error);
