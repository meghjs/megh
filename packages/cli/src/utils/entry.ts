import fs from "fs";
import path from "path";
import { readTsConfig, findTsConfig } from "./tsconfig";

export type ProjectLayout = {
  root: string;
  srcDir: string;
  outDir: string;
  compilerOptions: Record<string, any>;
  tsconfig: string | null;
};

export function projectLayout(root: string, preferBuildConfig = false): ProjectLayout {
  const tsconfig = findTsConfig(root, preferBuildConfig);
  const compilerOptions = tsconfig ? readTsConfig(tsconfig).compilerOptions : {};
  return {
    root,
    tsconfig,
    compilerOptions,
    srcDir: compilerOptions.rootDir ?? path.join(root, "src"),
    outDir: compilerOptions.outDir ?? path.join(root, "dist"),
  };
}

const DEFAULT_ENTRIES = ["serve.js", "server.js", "main.js", "index.js"];

/**
 * Where `megh serve` compiles the app: `.megh/build`, owned by Megh and safe
 * to delete, so the dev server never touches the `megh build` output.
 */
export function devBuildDir(root: string): string {
  return path.join(root, ".megh", "build");
}

const isWithin = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/**
 * Candidate entry files, most specific first: `--entry`, `megh.entry` in
 * package.json, `main` (mapped from `src/*.ts` to the output dir), then the
 * conventional names in the output dir.
 *
 * `buildDir` is where the compiled app is: the tsconfig `outDir` for
 * `megh start`, `.megh/build` for `megh serve`. With another folder than
 * `outDir`, an entry inside `outDir` (`dist/serve.js`, or tsc's nested
 * `dist/src/serve.js`) is mapped into it, so existing settings keep working.
 */
export function entryCandidates(
  layout: ProjectLayout,
  pkg: Record<string, any>,
  explicit?: string,
  buildDir: string = layout.outDir,
): string[] {
  const list: string[] = [];
  const srcFromRoot = path.relative(layout.root, layout.srcDir);
  const toBuild = (file: string) => {
    if (buildDir === layout.outDir || !isWithin(layout.outDir, file)) return file;
    let rel = path.relative(layout.outDir, file);
    // tsc without rootDir nests the source folder: dist/src/serve.js.
    if (srcFromRoot && rel.startsWith(srcFromRoot + path.sep)) rel = rel.slice(srcFromRoot.length + 1);
    return path.join(buildDir, rel);
  };
  const add = (p: string) => list.push(toBuild(path.resolve(layout.root, p)));
  if (explicit) add(explicit);
  if (typeof pkg?.megh?.entry === "string") add(pkg.megh.entry);
  if (typeof pkg?.main === "string") {
    const main = path.resolve(layout.root, pkg.main);
    const rel = path.relative(layout.srcDir, main);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      list.push(path.join(buildDir, rel).replace(/\.ts$/, ".js"));
    } else {
      add(main);
    }
  }
  for (const name of DEFAULT_ENTRIES) list.push(path.join(buildDir, name));
  return [...new Set(list)];
}

export function resolveEntry(candidates: string[], explicit?: string): string | null {
  // An explicit --entry must exist itself; no silent fallback.
  if (explicit) return fs.existsSync(candidates[0]) ? candidates[0] : null;
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}
