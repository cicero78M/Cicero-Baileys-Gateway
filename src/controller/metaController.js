import { readFile } from 'fs/promises';
import { sendSuccess } from '../utils/response.js';

let cached;

async function getPackage() {
  if (!cached) {
    const data = await readFile(new URL('../../package.json', import.meta.url), 'utf-8');
    cached = JSON.parse(data);
  }
  return cached;
}

export const getMetadata = async (req, res, next) => {
  try {
    const pkg = await getPackage();
    const metadata = {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      repository: pkg.repository?.url,
      uptime: process.uptime(),
      node: process.version,
    };
    sendSuccess(res, metadata);
  } catch (err) {
    next(err);
  }
};
