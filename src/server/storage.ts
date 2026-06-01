import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/** Local-disk object store rooted at STORAGE_DIR (./storage by default, gitignored). */
const root = () => resolve(process.env.STORAGE_DIR ?? "storage");

function pathFor(key: string) {
  const p = resolve(root(), key);
  if (!p.startsWith(root() + sep)) throw new Error("storage key escapes the storage root");
  return p;
}

export async function putObject(key: string, data: Buffer) {
  const p = pathFor(key);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, p);
}

export async function deleteObject(key: string) {
  await rm(pathFor(key), { force: true });
}

export async function objectExists(key: string) {
  return access(pathFor(key)).then(
    () => true,
    () => false,
  );
}

export async function getObject(key: string) {
  return readFile(pathFor(key));
}

export const storageRoot = root;
export { join };
