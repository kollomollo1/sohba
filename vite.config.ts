import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

function devApiPlugin(): Plugin {
  return {
    name: 'dev-api-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0];
        if (url === '/api/cloudinary-sign' || url === '/api/cloudinary-delete') {
          const chunks: any[] = [];
          req.on('data', (chunk) => chunks.push(chunk));
          req.on('end', async () => {
            const rawBody = Buffer.concat(chunks).toString('utf-8');
            try {
              (req as any).body = rawBody ? JSON.parse(rawBody) : {};
            } catch {
              (req as any).body = {};
            }

            (res as any).status = (code: number) => {
              res.statusCode = code;
              return res;
            };
            (res as any).json = (data: any) => {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(data));
              return res;
            };

            try {
              const file = url === '/api/cloudinary-sign' ? '/api/cloudinary-sign.ts' : '/api/cloudinary-delete.ts';
              const mod = await server.ssrLoadModule(file);
              const handler = mod.default;
              await handler(req, res);
            } catch (err: any) {
              console.error('[dev-api] Error executing route:', err);
              (res as any).status(500).json({ error: err.message || 'Internal Dev Server Error' });
            }
          });
          return;
        }
        next();
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Expose server-side environment variables to process.env during local dev
  Object.assign(process.env, env);

  return {
    plugins: [react(), devApiPlugin()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    optimizeDeps: {
      exclude: ['lucide-react'],
    },
  };
});

